using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using Kairo.Core;
using Xunit;

namespace Kairo.Core.Tests;

/// <summary>rumors 黄金轨迹回放：多 seed 工程化夹具（弱队挂牌/绯闻三档/成交与告吹）全路径逐位。</summary>
public sealed class RumorsGoldenTests
{
    private static readonly Lazy<JsonObject> Golden = new(() =>
        JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Golden", "rumors.golden.json")))!.AsObject());

    private static string Hex(double v) => BitConverter.DoubleToInt64Bits(v).ToString("x16");

    private static GameState BuildWorld()
    {
        WorldgenTestsState.EnsureLoaded();
        return Worldgen.GenerateWorld(42, resetSeq: true);
    }

    /// <summary>按 TS 录制器 runScenario 重建工程化夹具并推进 8 周。</summary>
    private static JsonObject RunScenario(long seed)
    {
        var state = BuildWorld();
        var teams = state.Teams.Values.ToList();
        state.MyTeamId = teams[0].Id;

        void MovePlayer(string pid, Team toTeam)
        {
            var p = state.Players[pid];
            var from = state.Teams[p.TeamId!];
            from.Roster = from.Roster.Where(x => x != pid).ToList();
            from.Starters = from.Starters.Where(x => x != pid).ToList();
            p.TeamId = toTeam.Id;
            toTeam.Roster.Add(pid);
        }
        for (int i = 5; i < 9; i++)
        {
            var t = teams[i];
            for (int g = 0; g < 6; g++)
            {
                state.Fixtures.Add(new Fixture
                {
                    Id = $"FX_diag_{t.Id}_{g}", Day = 60 + g, Stage = "stage1", Comp = "diag", TeamA = t.Id,
                    TeamB = teams[(i + 1) % teams.Count].Id, Bo = 3, Label = "diag", Played = true,
                    WinnerTeamId = teams[(i + 1) % teams.Count].Id,
                });
            }
        }
        var candidates = state.Players.Values.Where(p => p.TeamId != null && p.TeamId != teams[0].Id && !p.Listed).ToList();
        for (int i = 0; i < 4; i++)
        {
            var p = candidates[i * 7];
            p.Overall = 85;
            p.Morale = 40;
            p.ContractYears = 2;
            MovePlayer(p.Id, teams[5 + i]);
        }
        teams[3].Reputation = 90;
        teams[3].Budget = 8_000_000;
        var overflow = teams[3].Roster[^1];
        teams[3].Roster.RemoveAt(teams[3].Roster.Count - 1);
        state.Players[overflow].TeamId = null;
        for (int i = 0; i < teams.Count; i++)
        {
            if (i == 0 || i == 3 || (i >= 5 && i <= 8)) continue;
            teams[i].Reputation = Math.Min(teams[i].Reputation, 65);
        }
        for (int i = 5; i < 9; i++) teams[i].Reputation = 50;

        var weeks = new List<JsonObject>();
        var rng = new Rng((uint)seed);
        void RunWeek(int day, string tag)
        {
            state.Day = day;
            var notes = new List<NewsItem>();
            Rumors.WeeklyRumors(state, rng, notes);
            weeks.Add(new JsonObject
            {
                ["tag"] = tag,
                ["day"] = state.Day,
                ["notes"] = new JsonArray(notes.Select(n => (JsonNode)new JsonObject
                {
                    ["day"] = n.Day, ["kind"] = n.Kind, ["text"] = n.Text,
                }).ToArray()),
                ["feed"] = new JsonArray(state.TransferFeed.Select(DumpFeed).ToArray()),
                ["listed"] = new JsonArray(state.Players.Values.Where(p => p.Listed).Select(p => JsonValue.Create(p.Id)).ToArray()),
            });
        }
        foreach (var day in new[] { 100, 107, 114 }) RunWeek(day, $"pre-{day}");
        foreach (var day in new[] { 123, 128, 133, 138, 143, 148, 151 }) RunWeek(day, $"win-{day}");

        return new JsonObject
        {
            ["seed"] = seed,
            ["weeks"] = new JsonArray(weeks.ToArray()),
            ["budgets"] = new JsonArray(teams.Take(10).Select(t => (JsonNode)new JsonObject
            {
                ["id"] = t.Id, ["budget"] = t.Budget, ["reputation"] = t.Reputation,
            }).ToArray()),
            ["finLog"] = new JsonArray(state.Finances.Log.Select(e => (JsonNode)new JsonObject
            {
                ["day"] = e.Day, ["label"] = e.Label, ["amount"] = e.Amount,
            }).ToArray()),
        };
    }

    private static JsonObject DumpFeed(TransferFeedItem f) => new()
    {
        ["day"] = f.Day,
        ["year"] = f.Year,
        ["kind"] = f.Kind,
        ["c"] = f.C,
        ["toTeamId"] = f.ToTeamId,
        ["playerId"] = f.PlayerId,
        ["text"] = f.Text,
    };

    [Fact]
    public void Scenarios_BitExact()
    {
        foreach (var caseNode in Golden.Value["cases"]!.AsArray())
        {
            var actual = RunScenario(caseNode!["seed"]!.GetValue<long>());
            AssertDeepEqual(caseNode, actual, $"seed{caseNode["seed"]!.GetValue<long>()}");
        }
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
