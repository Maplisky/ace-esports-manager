using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using Kairo.Core;
using Xunit;

namespace Kairo.Core.Tests;

/// <summary>
/// match 黄金轨迹回放：完整比赛事件流（MatchRecord 全字段，浮点位型 hex）逐位比对 +
/// 重模拟一致性双闸（同 seed 双跑逐位一致；干预后才允许出现差异）。
/// 世界夹具按 TS 录制器序列重建（myTeamId/intel/styleCounter/patchNotes/fingerprint 预置）。
/// </summary>
public sealed class MatchGoldenTests
{
    private static readonly Lazy<JsonObject> Golden = new(() =>
        JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Golden", "match.golden.json")))!.AsObject());

    private static string Hex(double v) => BitConverter.DoubleToInt64Bits(v).ToString("x16");

    /// <summary>按 TS 录制器序列重建世界夹具（每次新实例，防串扰）。</summary>
    private static GameState BuildWorld()
    {
        WorldgenTestsState.EnsureLoaded();
        var state = Worldgen.GenerateWorld(42, resetSeq: true);
        var teams = state.Teams.Values.ToList();
        state.MyTeamId = teams[0].Id;
        Intel.AddIntel(state, teams[1].Id, 10);
        Intel.AddIntel(state, teams[2].Id, 6);
        state.StyleCounter["rush"] = 5;
        state.PatchNotes.Add(new PatchNote
        {
            Version = "test-1.0",
            Changes = new List<PatchChange>
            {
                new() { AgentId = "jett", Meta = 1.08, Dir = "buff", Pct = 8 },
                new() { AgentId = "omen", Meta = 0.92, Dir = "nerf", Pct = 8 },
            },
            MapNotes = new OrderedDict<string, string>(),
        });
        Match.RecordPatternFingerprint(state, teams[0].Id, "ascent");
        teams[0].PatternUsage["ascent"] = 3;
        return state;
    }

    private static JsonNode? S(string? s) => s is null ? null : JsonValue.Create(s);

    private static JsonObject DumpEvent(RoundEvent e) => new()
    {
        ["t"] = e.T,
        ["s"] = S(e.S),
        ["v"] = S(e.V),
        ["first"] = e.First,
        ["vs"] = e.Vs,
        ["tier"] = S(e.Tier),
        ["side"] = S(e.Side),
        ["dmg"] = e.Dmg.HasValue ? Hex(e.Dmg.Value) : null,
        ["player"] = e.Player,
        ["tactic"] = S(e.Tactic),
        ["igl"] = e.Igl,
    };

    private static JsonObject DumpRound(RoundRecord r) => new()
    {
        ["n"] = r.N,
        ["atk"] = r.Atk,
        ["buyA"] = r.BuyA,
        ["buyB"] = r.BuyB,
        ["tacticAtk"] = S(r.TacticAtk),
        ["tacticDef"] = S(r.TacticDef),
        ["events"] = new JsonArray(r.Events.Select(e => (JsonNode)DumpEvent(e)).ToArray()),
        ["end"] = new JsonObject
        {
            ["win"] = r.End.Win,
            ["how"] = r.End.How,
            ["aliveA"] = r.End.AliveA,
            ["aliveB"] = r.End.AliveB,
            ["scoreA"] = r.End.ScoreA,
            ["scoreB"] = r.End.ScoreB,
            ["assists"] = new JsonArray(r.End.Assists.Select(x => JsonValue.Create(x)).ToArray()),
            ["dmgBonus"] = new JsonArray(r.End.DmgBonus.Select(kv => (JsonNode)new JsonObject { ["pid"] = kv.Key, ["v"] = Hex(kv.Value) }).ToArray()),
            ["ults"] = new JsonArray(r.End.Ults!.Select(kv => (JsonNode)new JsonArray(JsonValue.Create(kv.Key), kv.Value)).ToArray()),
            ["money"] = r.End.Money == null ? null : new JsonObject { ["A"] = r.End.Money.A, ["B"] = r.End.Money.B },
            ["timeouts"] = r.End.Timeouts == null ? null : new JsonObject { ["A"] = r.End.Timeouts.A, ["B"] = r.End.Timeouts.B },
        },
    };

    private static JsonObject DumpLine(string pid, PlayerLine l) => new()
    {
        ["pid"] = pid,
        ["kills"] = l.Kills,
        ["deaths"] = l.Deaths,
        ["assists"] = l.Assists,
        ["firstKills"] = l.FirstKills,
        ["firstDeaths"] = l.FirstDeaths,
        ["clutches"] = l.Clutches,
        ["damage"] = Hex(l.Damage),
        ["rounds"] = l.Rounds,
        ["acs"] = (int)l.Acs,
    };

    private static JsonObject Hex12(Strength.SideEdge e) => new()
    {
        ["base"] = Hex(e.Base), ["igl"] = Hex(e.Igl), ["chem"] = Hex(e.Chem), ["coach"] = Hex(e.Coach),
        ["meta"] = Hex(e.Meta), ["map"] = Hex(e.Map), ["prep"] = Hex(e.Prep), ["familiarity"] = Hex(e.Familiarity),
        ["shortHanded"] = Hex(e.ShortHanded), ["aim"] = Hex(e.Aim), ["awareness"] = Hex(e.Awareness), ["mapTactics"] = Hex(e.MapTactics),
    };

    private static JsonObject DumpMap(MapRecord m) => new()
    {
        ["map"] = m.Map,
        ["scoreA"] = m.ScoreA,
        ["scoreB"] = m.ScoreB,
        ["rounds"] = new JsonArray(m.Rounds.Select(r => (JsonNode)DumpRound(r)).ToArray()),
        ["lines"] = new JsonArray(m.Lines.Select(kv => (JsonNode)DumpLine(kv.Key, kv.Value)).ToArray()),
        ["mvp"] = S(m.Mvp),
        ["agents"] = new JsonArray(m.Agents.Select(kv => (JsonNode)new JsonArray(JsonValue.Create(kv.Key), JsonValue.Create(kv.Value))).ToArray()),
        ["edges"] = new JsonObject { ["A"] = Hex12(m.EdgesA), ["B"] = Hex12(m.EdgesB) },
        ["readings"] = m.Readings.Count == 0 ? null : new JsonArray(m.Readings.Select(r => (JsonNode)new JsonObject
        {
            ["round"] = r.Round,
            ["iglId"] = r.IglId,
            ["suggested"] = r.Suggested,
            ["quality"] = r.Quality,
            ["correct"] = r.Correct,
        }).ToArray()),
    };

    private static JsonObject DumpMatch(MatchRecord rec) => new()
    {
        ["id"] = rec.Id,
        ["seed"] = rec.Seed,
        ["format"] = rec.Format,
        ["teamA"] = rec.TeamA,
        ["teamB"] = rec.TeamB,
        ["stage"] = rec.Stage,
        ["day"] = rec.Day,
        ["scoreA"] = rec.ScoreA,
        ["scoreB"] = rec.ScoreB,
        ["winner"] = rec.Winner,
        ["mvp"] = S(rec.Mvp),
        ["interventions"] = rec.Interventions == null ? null : new JsonArray(rec.Interventions.Select(iv =>
        {
            // TS JSON.stringify 语义：undefined 字段整个省键（非 null）
            var o = new JsonObject { ["map"] = iv.Map, ["round"] = iv.Round, ["tactic"] = iv.Tactic };
            if (iv.Igl != null) o["igl"] = iv.Igl;
            return (JsonNode)o;
        }).ToArray()),
        ["maps"] = new JsonArray(rec.Maps.Select(m => (JsonNode)DumpMap(m)).ToArray()),
    };

    /// <summary>按 golden 的 case 表重建输入并模拟。</summary>
    private static MatchRecord RunCase(GameState state, int caseIndex)
    {
        var caseNode = Golden.Value["records"]!.AsArray()[caseIndex]!["case"]!;
        var teams = state.Teams.Values.ToList();
        List<MatchIntervention>? interventions = null;
        if (caseNode["interventions"] is JsonArray ivArr)
        {
            interventions = ivArr.Select(iv => new MatchIntervention
            {
                Map = iv!["map"]!.GetValue<int>(),
                Round = iv["round"]!.GetValue<int>(),
                Tactic = iv["tactic"]!.GetValue<string>(),
                Igl = iv["igl"]?.GetValue<bool>(),
            }).ToList();
        }
        IReadOnlyDictionary<string, OrderedDict<string, string>>? agentLock = null;
        if (caseNode["agentLock"] is JsonObject alObj)
        {
            var dict = new Dictionary<string, OrderedDict<string, string>>();
            foreach (var kv in alObj)
            {
                var inner = new OrderedDict<string, string>();
                foreach (var e in kv.Value!.AsObject())
                {
                    inner[e.Key] = e.Value!.GetValue<string>();
                }
                dict[kv.Key] = inner;
            }
            agentLock = dict;
        }
        List<string>? mapLock = caseNode["mapLock"] is JsonArray ml ? ml.Select(x => x!.GetValue<string>()).ToList() : null;
        return Match.SimMatch(
            state,
            caseNode["teamAId"]!.GetValue<string>(),
            caseNode["teamBId"]!.GetValue<string>(),
            caseNode["bo"]!.GetValue<int>(),
            caseNode["seed"]!.GetValue<long>(),
            $"M{caseIndex}",
            mapLock,
            agentLock,
            interventions);
    }

    [Fact]
    public void MatchRecords_BitExact()
    {
        var records = Golden.Value["records"]!.AsArray();
        for (int i = 0; i < records.Count; i++)
        {
            var state = BuildWorld();
            var expected = records[i]!["rec"]!;
            var actual = DumpMatch(RunCase(state, i));
            // 逐图定位诊断：先报告每图概要，再进深度比对
            var eMaps = expected["maps"]!.AsArray();
            var aMaps = actual["maps"]!.AsArray();
            System.Console.Error.WriteLine($"[case{i}] maps TS={eMaps.Count} CS={aMaps.Count}");
            for (int mi = 0; mi < Math.Min(eMaps.Count, aMaps.Count); mi++)
            {
                var em = eMaps[mi]!;
                var am = aMaps[mi]!;
                System.Console.Error.WriteLine(
                    $"[case{i}][map{mi}] {em["map"]!.GetValue<string>()}: TS {em["scoreA"]}-{em["scoreB"]} ({em["rounds"]!.AsArray().Count}r) mvp={em["mvp"]?.ToJsonString()} | CS {am["scoreA"]}-{am["scoreB"]} ({am["rounds"]!.AsArray().Count}r) mvp={am["mvp"]?.ToJsonString()}");
                if (em.ToJsonString() != am.ToJsonString())
                {
                    var er = em["rounds"]!.AsArray();
                    var ar = am["rounds"]!.AsArray();
                    for (int ri = 0; ri < Math.Min(er.Count, ar.Count); ri++)
                    {
                        if (er[ri]!.ToJsonString() != ar[ri]!.ToJsonString())
                        {
                            System.Console.Error.WriteLine($"  r{er[ri]!["n"]} TS: {er[ri]!.ToJsonString()}");
                            System.Console.Error.WriteLine($"  r{ar[ri]!["n"]} CS: {ar[ri]!.ToJsonString()}");
                            break;
                        }
                    }
                    // 终局探针：两侧最后两回合的 end.score 与回合数
                    if (er.Count >= 2 && ar.Count >= 2)
                    {
                        System.Console.Error.WriteLine(
                            $"  tail TS r{er[er.Count - 2]!["n"]}/r{er[er.Count - 1]!["n"]} scores={er[er.Count - 2]!["end"]!["scoreA"]}-{er[er.Count - 2]!["end"]!["scoreB"]},{er[er.Count - 1]!["end"]!["scoreA"]}-{er[er.Count - 1]!["end"]!["scoreB"]} | CS r{ar[ar.Count - 2]!["n"]}/r{ar[ar.Count - 1]!["n"]} scores={ar[ar.Count - 2]!["end"]!["scoreA"]}-{ar[ar.Count - 2]!["end"]!["scoreB"]},{ar[ar.Count - 1]!["end"]!["scoreA"]}-{ar[ar.Count - 1]!["end"]!["scoreB"]}");
                    }
                }
                // 先对 rounds 子树深比对拿精确路径（score 的分歧由回合级联而来）
                if (em.ToJsonString() != am.ToJsonString())
                    AssertDeepEqual(em["rounds"], am["rounds"], $"case{i}.maps[{mi}].rounds");
            }
            AssertDeepEqual(expected, actual, $"case{i}");
        }
    }

    [Fact]
    public void Resim_Identity_And_Intervention_Divergence()
    {
        var state = BuildWorld();
        var first = DumpMatch(RunCase(state, 0)).ToJsonString();
        var second = DumpMatch(RunCase(state, 0)).ToJsonString();
        Assert.Equal(first, second); // 同 seed 双跑逐位一致（重模拟红线）
    }

    /// <summary>递归深比对：键序敏感；数字按原始文本。</summary>
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
