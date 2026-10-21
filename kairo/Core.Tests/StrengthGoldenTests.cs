using System;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using Kairo.Core;
using Xunit;

namespace Kairo.Core.Tests;

/// <summary>
/// strength 黄金轨迹回放：fit 矩阵 / 职责权重 / 有效能力 / 风格 / computeSide 全字段逐位比对。
/// 世界夹具复用 generateWorld(42)（与 worldgen 黄金同源），保证两侧阵容一致。
/// </summary>
public sealed class StrengthGoldenTests
{
    private static readonly Lazy<JsonObject> Golden = new(() =>
        JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Golden", "strength.golden.json")))!.AsObject());

    private static readonly Lazy<GameState> World = new(() =>
    {
        WorldgenTestsState.EnsureLoaded();
        return Worldgen.GenerateWorld(42, resetSeq: true);
    });

    private static double BitStringToDouble(string hex) => BitConverter.Int64BitsToDouble(Convert.ToInt64(hex, 16));

    private static string Hex(double v) => BitConverter.DoubleToInt64Bits(v).ToString("x16");

    [Fact]
    public void Constants_Match()
    {
        WorldgenTestsState.EnsureLoaded();
        var c = Golden.Value["constants"]!;
        Assert.Equal(c["roundBaseScale"]!.GetValue<string>(), Hex(Strength.RoundBaseScale));
        Assert.Equal(c["logisticK"]!.GetValue<string>(), Hex(Strength.LogisticK));
        Assert.Equal(c["swingSd"]!.GetValue<string>(), Hex(Strength.SwingSd));
    }

    [Fact]
    public void FitMatrix_BitExact()
    {
        WorldgenTestsState.EnsureLoaded();
        var expected = Golden.Value["fitMatrix"]!.AsArray();
        Assert.Equal(CoreData.Agents.Count, expected.Count);
        foreach (var a in expected)
        {
            var agentId = a!["id"]!.GetValue<string>();
            foreach (var f in a["fits"]!.AsArray())
            {
                var mapId = f!["map"]!.GetValue<string>();
                var map = CoreData.Maps.First(m => m.Id == mapId);
                Assert.Equal(f["fit"]!.GetValue<string>(), Hex(Fit.ComputeFit(agentId, map)));
            }
        }
    }

    [Fact]
    public void DutyWeights_BitExact()
    {
        WorldgenTestsState.EnsureLoaded();
        foreach (var a in Golden.Value["dutyW"]!.AsArray())
        {
            var agent = CoreData.Agent(a!["id"]!.GetValue<string>())!;
            Assert.Equal(a!["kill"]!.GetValue<string>(), Hex(Strength.DutyKillWeight(agent.Duty)));
            Assert.Equal(a["entry"]!.GetValue<string>(), Hex(Strength.DutyEntryWeight(agent.Duty)));
        }
    }

    [Fact]
    public void EffectiveOverall_BitExact()
    {
        foreach (var e in Golden.Value["eff"]!.AsArray())
        {
            var p = World.Value.Players[e!["id"]!.GetValue<string>()]!;
            Assert.Equal(e["v"]!.GetValue<string>(), Hex(Strength.EffectiveOverall(p, e["day"]!.GetValue<int>())));
        }
    }

    [Fact]
    public void StyleVectors_Match()
    {
        foreach (var s in Golden.Value["styleVec"]!.AsArray())
            Assert.Equal(s!["style"]!.GetValue<string>(), Strength.StyleOf(BitStringToDouble(s["aggr"]!.GetValue<string>())));
        foreach (var c in Golden.Value["counterVec"]!.AsArray())
            Assert.Equal(c!["v"]!.GetValue<double>(), Strength.StyleCounterOf(c["a"]!.GetValue<string>(), c["b"]!.GetValue<string>()));
    }

    [Fact]
    public void ComputeSide_BitExact()
    {
        WorldgenTestsState.EnsureLoaded();
        var playersByName = World.Value.Players;
        foreach (var caseNode in Golden.Value["sides"]!.AsArray())
        {
            var team = World.Value.Teams[caseNode!["team"]!.GetValue<string>()]!;
            var map = CoreData.Maps.First(m => m.Id == caseNode["map"]!.GetValue<string>());
            var input = new Strength.SideInput
            {
                Team = team,
                Players = playersByName.ToDictionary(kv => kv.Key, kv => kv.Value),
                Map = map,
                Day = caseNode["day"]!.GetValue<int>(),
                Intel = caseNode["intel"] is JsonValue iv ? iv.GetValue<double>() : null,
                StyleCounter = caseNode["styleCounter"] is JsonValue sv ? sv.GetValue<double>() : null,
                ChokeMod = caseNode["chokeMod"] is JsonValue cv ? cv.GetValue<double>() : null,
                PatchMeta = caseNode["patch"] != null
                    ? new System.Collections.Generic.Dictionary<string, double> { ["jett"] = 1.1, ["omen"] = 0.9, ["sova"] = 1.05 }
                    : null,
            };
            var s = Strength.ComputeSide(input);
            var expected = caseNode["out"]!;

            var pairs = new (string Name, string Expected, string Actual)[]
            {
                ("base", expected["base"]!.GetValue<string>(), Hex(s.Base)),
                ("atk", expected["atk"]!.GetValue<string>(), Hex(s.Atk)),
                ("def", expected["def"]!.GetValue<string>(), Hex(s.Def)),
                ("mid", expected["mid"]!.GetValue<string>(), Hex(s.Mid)),
                ("edge.base", expected["edge"]!["base"]!.GetValue<string>(), Hex(s.Edge.Base)),
                ("edge.igl", expected["edge"]!["igl"]!.GetValue<string>(), Hex(s.Edge.Igl)),
                ("edge.chem", expected["edge"]!["chem"]!.GetValue<string>(), Hex(s.Edge.Chem)),
                ("edge.coach", expected["edge"]!["coach"]!.GetValue<string>(), Hex(s.Edge.Coach)),
                ("edge.meta", expected["edge"]!["meta"]!.GetValue<string>(), Hex(s.Edge.Meta)),
                ("edge.map", expected["edge"]!["map"]!.GetValue<string>(), Hex(s.Edge.Map)),
                ("edge.prep", expected["edge"]!["prep"]!.GetValue<string>(), Hex(s.Edge.Prep)),
                ("edge.familiarity", expected["edge"]!["familiarity"]!.GetValue<string>(), Hex(s.Edge.Familiarity)),
                ("edge.shortHanded", expected["edge"]!["shortHanded"]!.GetValue<string>(), Hex(s.Edge.ShortHanded)),
                ("edge.aim", expected["edge"]!["aim"]!.GetValue<string>(), Hex(s.Edge.Aim)),
                ("edge.awareness", expected["edge"]!["awareness"]!.GetValue<string>(), Hex(s.Edge.Awareness)),
                ("edge.mapTactics", expected["edge"]!["mapTactics"]!.GetValue<string>(), Hex(s.Edge.MapTactics)),
                ("iglAttr", expected["iglAttr"]!.GetValue<string>(), Hex(s.IglAttr)),
                ("clutchAvg", expected["clutchAvg"]!.GetValue<string>(), Hex(s.ClutchAvg)),
            };
            var bad = pairs.Where(t => t.Expected != t.Actual).ToList();
            Assert.True(bad.Count == 0,
                $"case {caseNode["team"]}/{caseNode["map"]}/d{caseNode["day"]}: " +
                string.Join("; ", bad.Select(t => $"{t.Name}: {t.Expected} vs {t.Actual}")));
            Assert.Equal(expected["teamId"]!.GetValue<string>(), s.TeamId);
            Assert.Equal(expected["lineup"]!.AsArray().Select(x => x!.GetValue<string>()), s.Lineup.Select(p => p.Id));
            var agents = expected["agents"]!.AsArray().Select(kv => (kv![0]!.GetValue<string>(), kv[1]!.GetValue<string>())).ToArray();
            Assert.Equal(agents, s.Agents.Select(kv => (kv.Key, kv.Value)));
        }
    }
}
