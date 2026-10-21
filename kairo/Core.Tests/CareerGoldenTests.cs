using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using Kairo.Core;
using Xunit;

namespace Kairo.Core.Tests;

/// <summary>career 黄金轨迹回放：天赋/出身/进修/下课双路径/冠军账本/跳槽/五年之约与十年退休 全路径逐位。</summary>
public sealed class CareerGoldenTests
{
    private static readonly Lazy<JsonObject> Golden = new(() =>
        JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Golden", "career.golden.json")))!.AsObject());

    private static GameState BuildWorld()
    {
        WorldgenTestsState.EnsureLoaded();
        var state = Worldgen.GenerateWorld(42, resetSeq: true);
        state.MyTeamId = state.Teams.Values.ToList()[2].Id;
        return state;
    }

    private static JsonObject DumpSkills(ManagerSkills s) => new()
    {
        ["training"] = s.Training, ["negotiation"] = s.Negotiation, ["tactics"] = s.Tactics, ["scouting"] = s.Scouting,
        ["medical"] = s.Medical, ["business"] = s.Business, ["locker"] = s.Locker, ["youth"] = s.Youth,
    };

    [Fact]
    public void TalentsAndOrigins_BitExact()
    {
        // 预设快照
        Assert.Equal(
            Golden.Value["cases"]!["talents"]!["presets"]!.AsArray().Select(p => (string?)p!["key"]!.GetValue<string>()),
            Career.TalentPresets.Select(p => (string?)p.Key));
        // 应用预设 1 + legend 出身
        var state = BuildWorld();
        var preset1 = Career.TalentPresets[1];
        Career.ApplyTalents(state, preset1.Points);
        Career.InitCareer(state, "legend");
        AssertDeepEqual(Golden.Value["cases"]!["talents"]!["skills"]!, DumpSkills(state.Manager.Skills), "talents.skills");
        Assert.Equal(Golden.Value["cases"]!["talents"]!["reputation"]!.GetValue<int>(), state.Manager.Reputation);
        Assert.Equal(Golden.Value["cases"]!["talents"]!["wallet"]!.GetValue<int>(), state.Manager.Life.Wallet);
        Assert.Equal(Golden.Value["cases"]!["talents"]!["career"]!["titles"]!.GetValue<int>(), state.Manager.Career!.Titles);
        Assert.Equal("legend", state.Manager.Career.Origin);

        // grassroots / analyst
        var s2 = BuildWorld();
        Career.InitCareer(s2, "grassroots");
        AssertDeepEqual(Golden.Value["cases"]!["originGrassroots"]!["skills"]!, DumpSkills(s2.Manager.Skills), "grassroots.skills");
        Assert.Equal(Golden.Value["cases"]!["originGrassroots"]!["budget"]!.GetValue<int>(), s2.Teams[s2.MyTeamId!].Budget);
        var s3 = BuildWorld();
        Career.InitCareer(s3, "analyst");
        AssertDeepEqual(Golden.Value["cases"]!["originAnalyst"]!["skills"]!, DumpSkills(s3.Manager.Skills), "analyst.skills");
        Assert.Equal(Golden.Value["cases"]!["originAnalyst"]!["reputation"]!.GetValue<int>(), s3.Manager.Reputation);
    }

    [Fact]
    public void SelfStudy_BitExact()
    {
        var state = BuildWorld();
        state.Manager.Life.Wallet = 12_000;
        var r1 = Career.SelfStudy(state, "tactics");
        var r2 = Career.SelfStudy(state, "youth");
        var r3 = Career.SelfStudy(state, "youth");
        var r4 = Career.SelfStudy(state, "business");
        var c = Golden.Value["cases"]!["selfStudy"]!;
        Assert.Equal(c["r1"]!.GetValue<string>(), r1);
        Assert.Equal(c["r2"]!.GetValue<string>(), r2);
        Assert.Equal(c["r3"]!.GetValue<string>(), r3);
        Assert.Equal(c["r4"]!.GetValue<string>(), r4);
        Assert.Equal(c["wallet"]!.GetValue<int>(), state.Manager.Life.Wallet);
        Assert.Equal(c["tactics"]!.GetValue<int>(), state.Manager.Skills.Tactics);
    }

    [Fact]
    public void FirePaths_BitExact()
    {
        // 警告后三连败
        var state = BuildWorld();
        state.Manager.Career = new ManagerCareer { StartYear = 2026, Seasons = 1, Titles = 0, Wins = 3, Losses = 5 };
        var notes = new List<NewsItem>();
        state.BoardConfidence = 18;
        Career.CareerWeeklyTick(state, notes);
        Career.NoteMatchResult(state, false, notes);
        Career.NoteMatchResult(state, false, notes);
        Career.NoteMatchResult(state, false, notes);
        AssertDeepEqual(Golden.Value["cases"]!["fireWarn"]!, new JsonObject
        {
            ["notes"] = new JsonArray(notes.Select(n => (JsonNode)new JsonObject { ["text"] = n.Text, ["important"] = n.Important }).ToArray()),
            ["ending"] = DumpEnding(state.Manager.Career.Ending),
        }, "fireWarn");

        // 谷底直接下课
        var state2 = BuildWorld();
        state2.Manager.Career = new ManagerCareer { Seasons = 1 };
        var notes2 = new List<NewsItem>();
        state2.BoardConfidence = 5;
        Career.CareerWeeklyTick(state2, notes2);
        AssertDeepEqual(Golden.Value["cases"]!["fireBottom"]!, new JsonObject
        {
            ["notes"] = new JsonArray(notes2.Select(n => (JsonNode)new JsonObject { ["text"] = n.Text }).ToArray()),
            ["ending"] = DumpEnding(state2.Manager.Career.Ending),
        }, "fireBottom");
    }

    private static JsonObject? DumpEnding(CareerEnding? e) => e == null ? null : new JsonObject
    {
        ["kind"] = e.Kind, ["year"] = e.Year, ["day"] = e.Day,
    };

    [Fact]
    public void TitleJobDisciples_BitExact()
    {
        var state = BuildWorld();
        state.Manager.Career = new ManagerCareer();
        Career.NoteManagerTitle(state, state.MyTeamId!, "league");
        Career.NoteManagerTitle(state, "other-team", "cup");
        Career.NoteManagerTitle(state, state.MyTeamId!, "league");
        var offers = Career.JobOffers(state).Select(t => (JsonObject)new JsonObject { ["id"] = t.Id, ["rep"] = t.Reputation }).ToList();
        int disciples = Career.DiscipleCount(state);
        var notes = new List<NewsItem>();
        var rng = new Rng(99);
        var results = new List<JsonObject>();
        foreach (var offer in offers.Take(3))
        {
            var (ok, text) = Career.ApplyJob(state, offer["id"]!.GetValue<string>(), rng, notes);
            results.Add(new JsonObject { ["team"] = offer["id"]!.GetValue<string>(), ["ok"] = ok, ["text"] = text });
            if (ok) break;
        }
        var c = Golden.Value["cases"]!["titleJob"]!;
        Assert.Equal(
            c["titleKinds"]!.AsObject().Select(kv => (kv.Key, kv.Value!.GetValue<int>())),
            state.Manager.Career!.TitleKinds.Select(kv => (kv.Key, kv.Value)));
        Assert.Equal(c["titles"]!.GetValue<int>(), state.Manager.Career!.Titles);
        Assert.Equal(c["jobHops"]!.GetValue<int>(), state.Manager.Career!.JobHops);
        AssertDeepEqual(c["offers"]!, new JsonArray(offers.ToArray()), "offers");
        Assert.Equal(c["disciples"]!.GetValue<int>(), disciples);
        AssertDeepEqual(c["results"]!, new JsonArray(results.ToArray()), "results");
        AssertDeepEqual(c["notes"]!, new JsonArray(notes.Select(n => (JsonNode)new JsonObject { ["text"] = n.Text, ["important"] = n.Important }).ToArray()), "notes");
        Assert.Equal(c["myTeamId"]!.GetValue<string>(), state.MyTeamId);
    }

    [Fact]
    public void Milestone_BitExact()
    {
        var state = BuildWorld();
        state.Day = 300;
        state.Manager.Career = new ManagerCareer { StartYear = 2022, Seasons = 1, Titles = 1 };
        var notes = new List<NewsItem>();
        Career.CheckCareerMilestone(state, notes);
        var card = state.PendingEvents.FirstOrDefault(e => e.CardId == Career.MilestoneCardId);
        Assert.NotNull(card);
        var rContinue = Career.ResolveMilestoneCard(state, card!, 0);
        state.Year = 2027;
        Career.CheckCareerMilestone(state, notes);
        state.Year = 2031;
        Career.CheckCareerMilestone(state, notes);
        var c = Golden.Value["cases"]!["milestone"]!;
        AssertDeepEqual(c["notes"]!, new JsonArray(notes.Select(n => (JsonNode)new JsonObject { ["text"] = n.Text, ["important"] = n.Important }).ToArray()), "notes");
        Assert.Equal(c["rContinue"]!["result"]!.GetValue<string>(), rContinue.Result);
        Assert.Equal(c["rContinue"]!["note"]!.GetValue<string>(), rContinue.Note);
        Assert.Equal(c["cardUid"]!.GetValue<string>(), card!.Uid);
        Assert.Equal(c["ending"]!["kind"]!.GetValue<string>(), state.Manager.Career!.Ending!.Kind);
        Assert.Equal(c["ending"]!["year"]!.GetValue<int>(), state.Manager.Career.Ending.Year);
        Assert.Equal(c["seasons"]!.GetValue<int>(), state.Manager.Career.Seasons);
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
