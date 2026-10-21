using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using Kairo.Core;
using Xunit;

namespace Kairo.Core.Tests;

/// <summary>
/// match 前置三叶子（intel/veto/tactics）黄金轨迹回放。
/// 情报/BP 夹具复用 generateWorld(42)（与 worldgen 黄金同源），世界侧状态按 TS 序列重建。
/// </summary>
public sealed class MatchPreGoldenTests
{
    private static readonly Lazy<JsonObject> Golden = new(() =>
        JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Golden", "matchpre.golden.json")))!.AsObject());

    private static readonly Lazy<GameState> World = new(() =>
    {
        WorldgenTestsState.EnsureLoaded();
        return Worldgen.GenerateWorld(42, resetSeq: true);
    });

    [Fact]
    public void Intel_Sequence_Matches()
    {
        var state = World.Value;
        var expectedOps = Golden.Value["intelSeq"]!.AsArray();
        var actualOps = new List<(string Op, string Id, double? R)>();

        for (int i = 0; i < 6; i++)
        {
            var id = (string)expectedOps[i]!["id"]!.GetValue<string>()!;
            var amount = expectedOps[i]!["amount"]!.GetValue<double>();
            var r = Intel.AddIntel(state, id, amount);
            actualOps.Add(("add", id, r));
        }
        Intel.DecayIntel(state);
        Intel.DecayIntel(state);
        foreach (var op in expectedOps.Where(o => o!["op"]!.GetValue<string>() == "of"))
        {
            var id = op!["id"]!.GetValue<string>();
            actualOps.Add(("of", id, Intel.IntelOf(state, id)));
        }

        for (int i = 0; i < expectedOps.Count; i++)
        {
            var e = expectedOps[i]!;
            var (op, id, r) = actualOps[i];
            Assert.Equal(e["op"]!.GetValue<string>() == "add" ? "add" : "of", op);
            Assert.Equal(e["id"]!.GetValue<string>(), id);
            Assert.Equal(e["r"]!.GetValue<double>(), r!.Value);
        }

        foreach (var l in Golden.Value["levels"]!.AsArray())
            Assert.Equal(l!["r"]!.GetValue<int>(), Intel.IntelLevel(l["p"]!.GetValue<double>()));
    }

    [Fact]
    public void EstimateAndBand_Match()
    {
        var state = World.Value;
        foreach (var v in Golden.Value["estVec"]!.AsArray())
        {
            var team = state.Teams[v!["team"]!.GetValue<string>()]!;
            var map = CoreData.Maps.First(m => m.Id == v["map"]!.GetValue<string>());
            if (v["score"] != null)
            {
                var score = Intel.EstimateMapStrength(state, team, map);
                Assert.Equal(v["score"]!.GetValue<int>(), score);
                Assert.Equal(v["stars"]!.GetValue<int>(), Intel.StarsOf(score));
            }
            else
            {
                var (lo, hi) = Intel.MapStrengthBand(state, team, map, v["skill"]!.GetValue<double>());
                Assert.Equal(v["lo"]!.GetValue<int>(), lo);
                Assert.Equal(v["hi"]!.GetValue<int>(), hi);
            }
        }
    }

    public static TheoryData<int, int, double> VetoCases()
    {
        var data = new TheoryData<int, int, double>();
        int i = 0;
        foreach (var v in Golden.Value["vetoOut"]!.AsArray())
        {
            data.Add(i, v!["bo"]!.GetValue<int>(), v["noise"]!.GetValue<double>());
            i++;
        }
        return data;
    }

    [Theory]
    [MemberData(nameof(VetoCases))]
    public void Veto_Matches(int index, int bo, double noise)
    {
        var state = World.Value;
        var teams = state.Teams.Values.ToList();
        var v = Golden.Value["vetoOut"]!.AsArray()[index]!;
        int ia = teams.FindIndex(t => t.Id == v["a"]!.GetValue<string>());
        int ib = teams.FindIndex(t => t.Id == v["b"]!.GetValue<string>());
        var rng = new Rng(1000 + bo * 10 + (noise == 6 ? 0 : 1));
        var res = Veto.RunVeto(teams[ia], teams[ib], bo, rng, noise);
        Assert.Equal(v["maps"]!.AsArray().Select(x => x!.GetValue<string>()), res.Maps);
        Assert.Equal(v["log"]!.AsArray().Select(x => x!.GetValue<string>()), res.Log);
    }

    [Fact]
    public void Tactics_Matches()
    {
        foreach (var t in Golden.Value["tacticVec"]!.AsArray())
        {
            var id = t!["id"]!.GetValue<string>();
            var defNode = t["def"];
            var def = Tactics.CallDefOf(id);
            if (defNode is JsonObject d)
            {
                Assert.NotNull(def);
                Assert.Equal(d["id"]!.GetValue<string>(), def!.Id);
                Assert.Equal(d["side"]!.GetValue<string>(), def.Side);
                Assert.Equal(d["label"]!.GetValue<string>(), def.Label);
                Assert.Equal(d["atkMod"]!.GetValue<double>(), def.AtkMod);
                Assert.Equal(d["defMod"]!.GetValue<double>(), def.DefMod);
                Assert.Equal(d["needsCoreUlts"]!.GetValue<bool>(), def.NeedsCoreUlts);
                Assert.Equal(d["needsFullBuy"]!.GetValue<bool>(), def.NeedsFullBuy);
                Assert.Equal(d["counterRush"]!.GetValue<bool>(), def.CounterRush);
                Assert.Equal(d["pickSite"]!.GetValue<bool>(), def.PickSite);
            }
            else
            {
                Assert.Null(def);
            }
            Assert.Equal(t["side"]!.GetValue<string>(), Tactics.CallSideOf(id));
            Assert.Equal(t["label"]!.GetValue<string>(), Tactics.CallLabel(id));
            Assert.Equal(t["desc"]!.GetValue<string>(), Tactics.CallDesc(id));
        }
    }
}
