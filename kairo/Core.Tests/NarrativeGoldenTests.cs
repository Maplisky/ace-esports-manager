using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using Kairo.Core;
using Xunit;

namespace Kairo.Core.Tests;

/// <summary>narrative 黄金轨迹回放：七类叙事（旧部/反戈/王朝/告别/MVP/首秀/更衣室）文案逐字符。</summary>
public sealed class NarrativeGoldenTests
{
    private static readonly Lazy<JsonObject> Golden = new(() =>
        JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Golden", "narrative.golden.json")))!.AsObject());

    private static GameState BuildWorld()
    {
        WorldgenTestsState.EnsureLoaded();
        var state = Worldgen.GenerateWorld(42, resetSeq: true);
        var teams = state.Teams.Values.ToList();
        state.MyTeamId = teams[0].Id;
        // 夹具①：旧部 + 反戈教练
        var oldBoy = state.Players.Values.First(p => p.TeamId != teams[1].Id);
        oldBoy.Career.Clubs.Add(teams[0].Id);
        oldBoy.Career.Titles = 2;
        if (!teams[1].Roster.Contains(oldBoy.Id)) teams[1].Roster.Add(oldBoy.Id);
        teams[1].Coach.Name = "捏造名宿教练";
        state.RetireLog.Add(new RetireLogItem { Year = 2024, Ign = "捏造名宿", Name = "捏造名宿教练", Age = 45, Titles = 1, Mvps = 0, Overall = 80, Path = "coach", TeamName = teams[0].Name });
        return state;
    }

    private static MatchRecord BuildRec(GameState state, string winner, string mvpId, int[] mapAcs)
    {
        var teams = state.Teams.Values.ToList();
        return new MatchRecord
        {
            Id = "M", Seed = 1, Format = 3, TeamA = teams[0].Id, TeamB = teams[1].Id, Stage = "stage1", Day = state.Day,
            Maps = mapAcs.Select((acs, i) => new MapRecord
            {
                Map = $"m{i}", ScoreA = 13, ScoreB = 5,
                Lines = new OrderedDict<string, PlayerLine> { [mvpId] = new PlayerLine { Rounds = 13, Acs = acs } },
            }).ToList(),
            ScoreA = winner == "A" ? 2 : 1,
            ScoreB = winner == "A" ? 1 : 2,
            Winner = winner,
            Mvp = mvpId,
        };
    }

    private static JsonArray DumpNotes(List<NewsItem> notes) =>
        new(notes.Select(n => (JsonNode)new JsonObject
        {
            ["day"] = n.Day,
            ["kind"] = n.Kind,
            ["important"] = n.Important,
            ["text"] = n.Text,
        }).ToArray());

    [Fact]
    public void AllNarratives_BitExact()
    {
        var state = BuildWorld();
        var teams = state.Teams.Values.ToList();
        string myName = teams[0].Name;

        // ① 败局叙事（普通 + 国际赛淘汰）
        var notes1 = new List<NewsItem>();
        Narrative.NarrativeAfterMyLoss(state, "联赛 第5轮", teams[0].Id, teams[1].Id, "B", notes1);
        Narrative.NarrativeAfterMyLoss(state, "Masters 败者组决赛", teams[0].Id, teams[1].Id, "B", notes1);
        AssertDeepEqual(Golden.Value["notes1"]!, DumpNotes(notes1), "notes1");

        // ② 王朝里程碑（2/4/5 三档）
        state.Manager.Career = new ManagerCareer { StartYear = 2026, Seasons = 2, Titles = 2, Wins = 40, Losses = 20 };
        var notes2 = new List<NewsItem>();
        Narrative.NarrativeOnTitle(state, notes2);
        state.Manager.Career.Titles = 4;
        Narrative.NarrativeOnTitle(state, notes2);
        state.Manager.Career.Titles = 5;
        Narrative.NarrativeOnTitle(state, notes2);
        AssertDeepEqual(Golden.Value["notes2"]!, DumpNotes(notes2), "notes2");

        // ③ 名宿告别（满足 + 不满足对照）
        var notes3 = new List<NewsItem>();
        Narrative.NarrativeOnRetire(state, new RetireLogItem { Year = 2026, Ign = "老将A", Name = myName, Age = 33, Titles = 3, Mvps = 2, Overall = 82, Path = "fade", TeamName = myName }, notes3);
        Narrative.NarrativeOnRetire(state, new RetireLogItem { Year = 2026, Ign = "太年轻", Name = myName, Age = 25, Titles = 0, Mvps = 0, Overall = 70, Path = "fade", TeamName = myName }, notes3);
        AssertDeepEqual(Golden.Value["notes3"]!, DumpNotes(notes3), "notes3");

        // ④ MVP 高光 + 更衣室（胜局）
        var myStarter = teams[0].Starters[0];
        var notes4 = new List<NewsItem>();
        Narrative.NarrativeOnMyMatch(state, "FX_win", BuildRec(state, "A", myStarter, new[] { 250, 310, 280 }), notes4);
        AssertDeepEqual(Golden.Value["notes4"]!, DumpNotes(notes4), "notes4");

        // ⑤ 小将首战（captureDebuts + ≤19 过滤）
        var kidIds = teams[0].Roster.Skip(1).Take(2).ToList();
        foreach (var (kid, i) in kidIds.WithIndex())
        {
            state.Players[kid].Career.Maps = 0;
            state.Players[kid].Age = i == 0 ? 18 : 19;
        }
        var debutPids = Narrative.CaptureDebuts(state).ToHashSet();
        Assert.Equal(
            Golden.Value["debutsDump"]!["debutPids"]!.AsArray().Select(x => x!.GetValue<string>()),
            debutPids);
        var notes5 = new List<NewsItem>();
        Narrative.NarrativeOnMyMatch(state, "FX_debut", BuildRec(state, "B", teams[0].Starters[0], new[] { 200 }), notes5, debutPids);
        AssertDeepEqual(Golden.Value["notes5"]!, DumpNotes(notes5), "notes5");

        // ⑥ 更衣室尖锐版（败局 + 发言人士气 <40）
        int voiceIdx = 2 % teams[0].Starters.Count;
        state.Players[teams[0].Starters[voiceIdx]].Morale = 30;
        var notes6 = new List<NewsItem>();
        Narrative.NarrativeOnMyMatch(state, "FX_grim", BuildRec(state, "B", teams[1].Starters[0], new[] { 180 }), notes6);
        AssertDeepEqual(Golden.Value["notes6"]!, DumpNotes(notes6), "notes6");
    }

    private static void AssertDeepEqual(JsonNode? expected, JsonNode? actual, string path)
    {
        if (expected == null || actual == null)
        {
            Assert.True(expected == null && actual == null,
                $"{path}: one side null (expected={expected?.ToJsonString()}, actual={actual?.ToJsonString()})");
            return;
        }
        if (expected.ToJsonString() == actual.ToJsonString()) return;
        if (expected is JsonArray earr && actual is JsonArray aarr)
        {
            Assert.True(earr.Count == aarr.Count, $"{path}: array count {earr.Count} vs {aarr.Count}");
            for (int i = 0; i < earr.Count; i++)
                AssertDeepEqual(earr[i], aarr[i], $"{path}[{i}]");
            return;
        }
        if (expected is JsonObject eobj && actual is JsonObject aobj)
        {
            var ek = eobj.Select(kv => kv.Key).ToArray();
            var ak = aobj.Select(kv => kv.Key).ToArray();
            Assert.True(ek.SequenceEqual(ak), $"{path}: keys differ");
            foreach (var (kv, i) in ek.WithIndex())
                AssertDeepEqual(eobj[kv], aobj[kv], $"{path}.{kv}");
            return;
        }
        Assert.Fail($"{path}: {expected.ToJsonString()} vs {actual.ToJsonString()}");
    }
}
