using System;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using Kairo.Core;
using Xunit;

namespace Kairo.Core.Tests;

/// <summary>
/// worldgen 黄金轨迹回放：C# 重新生成世界 → 规范序列化（与 TS golden-worldgen.mjs 镜像）→
/// 深比对（对象同时校验键序——插入序是确定性红线；数字按原始文本比对；浮点已在两侧转为位型 hex 字符串）。
/// </summary>
public sealed class WorldgenGoldenTests
{
    private static readonly Lazy<JsonObject> Golden = new(() =>
        JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Golden", "worldgen.golden.json")))!.AsObject());

    private static readonly Lazy<string> DataDir = new(() => Path.Combine(AppContext.BaseDirectory, "Core.Data"));

    private static void EnsureData()
    {
        if (WorldgenTestsState.Loaded) return;
        WorldgenTestsState.Loaded = true;
        Worldgen.LoadData(DataDir.Value);
    }

    private static string Hex(double v) => BitConverter.DoubleToInt64Bits(v).ToString("x16");

    private static JsonObject DumpAttrs(PlayerAttrs a) => new()
    {
        ["aim"] = Hex(a.Aim),
        ["reaction"] = Hex(a.Reaction),
        ["awareness"] = Hex(a.Awareness),
        ["utility"] = Hex(a.Utility),
        ["clutch"] = Hex(a.Clutch),
        ["teamwork"] = Hex(a.Teamwork),
        ["communication"] = Hex(a.Communication),
        ["igl"] = Hex(a.Igl),
    };

    private static JsonNode? S(string? s) => s is null ? null : JsonValue.Create(s);

    private static JsonObject DumpPlayer(Player p) => new()
    {
        ["id"] = p.Id,
        ["ign"] = p.Ign,
        ["realName"] = S(p.RealName),
        ["country"] = S(p.Country),
        ["avatar"] = S(p.Avatar),
        ["synthetic"] = S(p.Synthetic),
        ["age"] = p.Age,
        ["teamId"] = S(p.TeamId),
        ["attrs"] = DumpAttrs(p.Attrs),
        ["overall"] = p.Overall,
        ["potential"] = p.Potential,
        ["peakOverall"] = p.PeakOverall,
        ["form"] = p.Form,
        ["morale"] = p.Morale,
        ["fatigue"] = p.Fatigue,
        ["salary"] = p.Salary,
        ["contractYears"] = p.ContractYears,
        ["agentPool"] = new JsonArray(p.AgentPool.Select(x => JsonValue.Create(x)).ToArray()),
        ["agentPro"] = new JsonArray(p.AgentPro.Select(kv => (JsonNode)new JsonArray(JsonValue.Create(kv.Key), kv.Value)).ToArray()),
        ["isIgl"] = p.IsIgl,
        ["focus"] = p.Focus,
        ["listed"] = p.Listed,
        ["releaseClause"] = p.ReleaseClause,
        ["noPoach"] = p.NoPoach,
        ["traits"] = new JsonArray(p.Traits.Select(x => JsonValue.Create(x)).ToArray()),
        ["promisedRole"] = p.PromisedRole,
        ["homegrown"] = p.Homegrown,
        ["birthdayDay"] = p.BirthdayDay,
        ["ambition"] = p.Ambition,
        ["career"] = new JsonObject
        {
            ["maps"] = p.Career.Maps,
            ["rounds"] = p.Career.Rounds,
            ["kills"] = p.Career.Kills,
            ["deaths"] = p.Career.Deaths,
            ["assists"] = p.Career.Assists,
            ["firstKills"] = p.Career.FirstKills,
            ["firstDeaths"] = p.Career.FirstDeaths,
            ["clutches"] = p.Career.Clutches,
            ["mvps"] = p.Career.Mvps,
            ["titles"] = p.Career.Titles,
            ["clubs"] = new JsonArray(p.Career.Clubs.Select(x => JsonValue.Create(x)).ToArray()),
        },
    };

    private static JsonObject DumpTeam(Team t) => new()
    {
        ["id"] = t.Id,
        ["name"] = t.Name,
        ["tag"] = t.Tag,
        ["tier"] = t.Tier,
        ["regionId"] = t.RegionId,
        ["vlrId"] = t.VlrId,
        ["logo"] = S(t.Logo),
        ["roster"] = new JsonArray(t.Roster.Select(x => JsonValue.Create(x)).ToArray()),
        ["starters"] = new JsonArray(t.Starters.Select(x => JsonValue.Create(x)).ToArray()),
        ["coach"] = new JsonObject
        {
            ["name"] = t.Coach.Name,
            ["tactics"] = t.Coach.Tactics,
            ["development"] = t.Coach.Development,
            ["motivation"] = t.Coach.Motivation,
        },
        ["facilities"] = t.Facilities,
        ["budget"] = t.Budget,
        ["reputation"] = t.Reputation,
        ["personality"] = t.Personality,
        ["mapPref"] = new JsonArray(t.MapPref.Select(kv => (JsonNode)new JsonArray(JsonValue.Create(kv.Key), kv.Value)).ToArray()),
        ["bond"] = t.Bond,
        ["sponsors"] = new JsonArray(t.Sponsors.Select(s => (JsonNode)new JsonObject
        {
            ["id"] = s.Id,
            ["name"] = s.Name,
            ["tier"] = s.Tier,
            ["perSeason"] = s.PerSeason,
            ["years"] = s.Years,
            ["signedYear"] = s.SignedYear,
        }).ToArray()),
        ["staff"] = new JsonArray(StaffArray(t)),
        ["academy"] = new JsonArray(t.Academy.Select(x => JsonValue.Create(x)).ToArray()),
    };

    private static JsonNode?[] StaffArray(Team t) =>
        new[] { ("training", t.Staff.Training), ("mapTactics", t.Staff.MapTactics), ("match", t.Staff.Match) }
            .Where(e => e.Item2 != null)
            .Select(e => (JsonNode?)new JsonObject
            {
                ["k"] = e.Item1,
                ["name"] = e.Item2!.Name,
                ["value"] = e.Item2.Value,
            })
            .ToArray();

    private static JsonObject DumpWorld(GameState state) => new()
    {
        ["seed"] = state.Seed,
        ["year"] = state.Year,
        ["day"] = state.Day,
        ["stage"] = state.Stage,
        ["teamSchedule"] = new JsonArray(state.TeamSchedule.Select(x => JsonValue.Create(x)).ToArray()),
        ["trainingMaps"] = new JsonArray(state.TrainingMaps.Select(x => JsonValue.Create(x)).ToArray()),
        ["boardConfidence"] = state.BoardConfidence,
        ["actionPoints"] = state.ActionPoints,
        ["teams"] = new JsonArray(state.Teams.Values.Select(t => (JsonNode)DumpTeam(t)).ToArray()),
        ["players"] = new JsonArray(state.Players.Values.Select(p => (JsonNode)DumpPlayer(p)).ToArray()),
    };

    /// <summary>递归深比对：键序敏感；数字按原始文本；字符串按序。</summary>
    private static void AssertDeepEqual(JsonNode? expected, JsonNode? actual, string path)
    {
        if (expected == null || actual == null)
        {
            Assert.True(expected == null && actual == null,
                $"{path}: one side null (expected={expected?.ToJsonString()}, actual={actual?.ToJsonString()})");
            return;
        }
        var ek = expected!.ToJsonString();
        var ak = actual!.ToJsonString();
        if (ek == ak) return;

        if (expected is JsonArray earr && actual is JsonArray aarr)
        {
            Assert.True(earr.Count == aarr.Count, $"{path}: array count {earr.Count} vs {aarr.Count}");
            for (int i = 0; i < earr.Count; i++)
                AssertDeepEqual(earr[i], aarr[i], $"{path}[{i}]");
            return;
        }
        if (expected is JsonObject eobj && actual is JsonObject aobj)
        {
            var ek2 = eobj.Select(kv => kv.Key).ToArray();
            var ak2 = aobj.Select(kv => kv.Key).ToArray();
            Assert.True(ek2.SequenceEqual(ak2), $"{path}: keys differ ({string.Join(",", ek2)} vs {string.Join(",", ak2)})");
            foreach (var (kv, i) in ek2.WithIndex())
                AssertDeepEqual(eobj[kv], aobj[kv], $"{path}.{kv}");
            return;
        }
        Assert.Fail($"{path}: {expected.ToJsonString()} vs {actual.ToJsonString()}");
    }

    public static TheoryData<long> Seeds() =>
        new(Golden.Value["seeds"]!.AsArray().Select(n => n!["seed"]!.GetValue<long>()).ToArray());

    [Theory]
    [MemberData(nameof(Seeds))]
    public void World_BitExact(long seed)
    {
        EnsureData();
        var expected = Golden.Value["seeds"]!.AsArray().First(s => s!["seed"]!.GetValue<long>() == seed)!;
        Worldgen.ResetPlayerSeq();
        var state = Worldgen.GenerateWorld(seed);
        var actual = DumpWorld(state);
        AssertDeepEqual(expected, actual, $"seed{seed}");
    }

    [Fact]
    public void SalaryFor_MatchesTsVectors()
    {
        foreach (var v in Golden.Value["salary"]!.AsArray())
        {
            var expected = v!["r"]!.GetValue<int>();
            var actual = Worldgen.SalaryFor(v!["o"]!.GetValue<int>(), v!["tier"]!.GetValue<int>());
            Assert.True(expected == actual, $"salary({v["o"]},{v["tier"]}): {expected} vs {actual}");
        }
    }

    [Fact]
    public void ComputeOverall_MatchesTsVectors()
    {
        foreach (var v in Golden.Value["overallVec"]!.AsArray())
        {
            var a = v!["in"]!;
            var attrs = new PlayerAttrs
            {
                Aim = a["aim"]!.GetValue<double>(),
                Reaction = a["reaction"]!.GetValue<double>(),
                Awareness = a["awareness"]!.GetValue<double>(),
                Utility = a["utility"]!.GetValue<double>(),
                Clutch = a["clutch"]!.GetValue<double>(),
                Teamwork = a["teamwork"]!.GetValue<double>(),
                Communication = a["communication"]!.GetValue<double>(),
                Igl = a["igl"]!.GetValue<double>(),
            };
            var expected = v!["r"]!.GetValue<int>();
            var actual = Worldgen.ComputeOverall(attrs);
            Assert.True(expected == actual, $"overall({a.ToJsonString()}): {expected} vs {actual}");
        }
    }
}

internal static class WorldgenTestsState
{
    public static bool Loaded;
}
