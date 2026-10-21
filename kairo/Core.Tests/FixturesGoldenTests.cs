using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using Kairo.Core;
using Xunit;

namespace Kairo.Core.Tests;

/// <summary>fixtures 黄金轨迹回放：联赛/杯赛树/瑞士轮配对/双败树全字段逐位（含树接线 id）。</summary>
public sealed class FixturesGoldenTests
{
    private static readonly Lazy<JsonObject> Golden = new(() =>
        JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Golden", "fixtures.golden.json")))!.AsObject());

    private static JsonNode? S(string? s) => s is null ? null : JsonValue.Create(s);

    private static JsonObject DumpFixture(Fixture f) => new()
    {
        ["id"] = f.Id,
        ["day"] = f.Day,
        ["stage"] = f.Stage,
        ["comp"] = f.Comp,
        ["teamA"] = f.TeamA,
        ["teamB"] = f.TeamB,
        ["bo"] = f.Bo,
        ["label"] = f.Label,
        ["nextFixtureId"] = S(f.NextFixtureId),
        ["nextLoserFixtureId"] = S(f.NextLoserFixtureId),
        ["winnerTeamId"] = S(f.WinnerTeamId),
    };

    private static JsonArray DumpFixtures(IEnumerable<Fixture> fixtures) =>
        new(fixtures.Select(f => (JsonNode)DumpFixture(f)).ToArray());

    [Fact]
    public void AllCases_BitExact()
    {
        foreach (var caseNode in Golden.Value["cases"]!.AsArray())
        {
            var name = caseNode!["name"]!.GetValue<string>();
            List<Fixture> fx;
            switch (name)
            {
                case "league":
                {
                    Fixtures.ResetFixtureSeq();
                    fx = new List<Fixture>();
                    Fixtures.BuildLeague(fx, "L5", "五队联赛", "stage1", new List<string> { "t1", "t2", "t3", "t4", "t5" }, 55, 122, 3, new Rng(11));
                    Fixtures.BuildLeague(fx, "L6", "六队联赛", "stage1", new List<string> { "t1", "t2", "t3", "t4", "t5", "t6" }, 55, 122, 3, new Rng(12));
                    break;
                }
                case "cup":
                {
                    Fixtures.ResetFixtureSeq();
                    fx = new List<Fixture>();
                    var rounds = Fixtures.BuildCup(fx, "cup", "揭幕杯", "cup", new List<string> { "c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8" }, 26, 8, 3, new Rng(21));
                    Fixtures.FillNextSlot(fx, fx[0], "c1");
                    Fixtures.FillNextSlot(fx, fx[1], "c3");
                    Fixtures.FillNextSlot(fx, fx[2], "c5");
                    Fixtures.FillNextSlot(fx, fx[3], "c7");
                    Fixtures.FillNextSlot(fx, fx[4], "c1");
                    Assert.Equal(
                        caseNode["roundFixtureIds"]!.AsArray().Select(r => r!.AsArray().Select(x => x!.GetValue<string>()).ToArray()).ToArray(),
                        rounds.Select(r => r.ToArray()).ToArray());
                    break;
                }
                case "swiss":
                {
                    var entries = new List<(string, int, int)>
                    {
                        ("w1", 2, 0), ("w2", 2, 0), ("m1", 1, 1), ("m2", 1, 1),
                        ("m3", 1, 1), ("m4", 1, 1), ("l1", 0, 2), ("l2", 0, 2),
                    };
                    string RegionOf(string id) => id == "w1" || id == "m1" || id == "l1" ? "americas" : "emea";
                    var pairs1 = Fixtures.PairSwissRound(entries, RegionOf, new HashSet<string>());
                    var played = pairs1.Select(p => string.CompareOrdinal(p.A, p.B) < 0 ? $"{p.A}|{p.B}" : $"{p.B}|{p.A}").ToHashSet();
                    var pairs2 = Fixtures.PairSwissRound(entries, RegionOf, played);
                    Assert.Equal(
                        caseNode["pairs1"]!.AsArray().Select(p => (p![0]!.GetValue<string>(), p[1]!.GetValue<string>())).ToArray(),
                        pairs1);
                    Assert.Equal(
                        caseNode["pairs2"]!.AsArray().Select(p => (p![0]!.GetValue<string>(), p[1]!.GetValue<string>())).ToArray(),
                        pairs2);
                    Fixtures.ResetFixtureSeq();
                    fx = new List<Fixture>();
                    Fixtures.BuildSwissRound(fx, "masters", "Masters", "masters", pairs1, 130, 1, 3);
                    break;
                }
                case "doubleElim":
                {
                    Fixtures.ResetFixtureSeq();
                    fx = new List<Fixture>();
                    var pairs = caseNode["roundFixtureIds"]![0]!.AsArray().Count > 0
                        ? ParsePairsFromGolden(caseNode) // 由 golden 反推种子对阵
                        : new List<(string, string)>();
                    var rounds = Fixtures.BuildDoubleElim(fx, "masters", "Masters", "masters", pairs, 150, 3, 3);
                    Assert.Equal(
                        caseNode["roundFixtureIds"]!.AsArray().Select(r => r!.AsArray().Select(x => x!.GetValue<string>()).ToArray()).ToArray(),
                        rounds.Select(r => r.ToArray()).ToArray());
                    break;
                }
                default:
                    throw new InvalidOperationException(name);
            }
            AssertDeepEqual(caseNode["fixtures"]!, DumpFixtures(fx), name);
        }
    }

    /// <summary>双败树的种子对阵 = golden 胜者组第1轮 4 场 fixtures 的 teamA/teamB（label 含「胜者组第1轮」）。</summary>
    private static List<(string A, string B)> ParsePairsFromGolden(JsonNode caseNode)
    {
        return caseNode["fixtures"]!.AsArray()
            .Where(f => f!["label"]!.GetValue<string>().Contains("胜者组第1轮"))
            .Select(f => (f["teamA"]!.GetValue<string>(), f["teamB"]!.GetValue<string>()))
            .ToList();
    }

    private static void AssertDeepEqual(JsonNode? expected, JsonNode? actual, string path)
    {
        if (expected == null || actual == null)
        {
            Assert.True(expected == null && actual == null, $"{path}: one side null");
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
