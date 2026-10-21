using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using Kairo.Core;
using Xunit;

namespace Kairo.Core.Tests;

/// <summary>training + patch 黄金轨迹回放：训练推荐矩阵 / 版本重掷（含惯性）/ 平替推荐 逐位比对。</summary>
public sealed class TrainPatchGoldenTests
{
    private static readonly Lazy<JsonObject> Golden = new(() =>
        JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Golden", "trainpatch.golden.json")))!.AsObject());

    private static string Hex(double v) => BitConverter.DoubleToInt64Bits(v).ToString("x16");

    [Fact]
    public void Options_Match()
    {
        var expected = Golden.Value["options"]!.AsArray().Select(o => (
            o!["key"]!.GetValue<string>(), o["name"]!.GetValue<string>(), o["attr"]?.GetValue<string>() ?? "", o["desc"]!.GetValue<string>()
        )).ToArray();
        var actual = Training.IndividualOptions.Select(o => (o.Key, o.Name, o.Attr ?? "", o.Desc)).ToArray();
        Assert.Equal(expected, actual);
    }

    [Fact]
    public void RecommendFocus_Matches()
    {
        foreach (var v in Golden.Value["focusVec"]!.AsArray())
            Assert.Equal(v!["r"]!.GetValue<string>(), Training.RecommendFocus(v["duty"]!.GetValue<string>(), v["isIgl"]!.GetValue<bool>()));
    }

    [Fact]
    public void RecommendPlan_Matches()
    {
        foreach (var v in Golden.Value["planVec"]!.AsArray())
        {
            int b = v!["base"]!.GetValue<int>();
            var attrs = new PlayerAttrs
            {
                Aim = b, Reaction = b - 4, Awareness = b + 2, Utility = b - 1,
                Clutch = b, Teamwork = b + 1, Communication = b + 3, Igl = v["igl"]!.GetValue<bool>() ? 80 : b - 8,
            };
            var r = Training.RecommendPlan(attrs, b + 5, v["fat"]!.GetValue<int>(), v["igl"]!.GetValue<bool>(), v["duty"]!.GetValue<string>());
            Assert.True(r.Key == v["key"]!.GetValue<string>() && r.Reason == v["reason"]!.GetValue<string>(),
                $"plan({v["duty"]},{v["fat"]},{v["base"]},{v["igl"]}): {r.Key}/{r.Reason} vs {v["key"]}/{v["reason"]}");
        }
    }

    private static GameState PatchWorld()
    {
        WorldgenTestsState.EnsureLoaded();
        return Worldgen.GenerateWorld(42, resetSeq: true);
    }

    [Fact]
    public void RollPatch_And_Replacement_Match()
    {
        var state = PatchWorld();
        var notes = Golden.Value["notes"]!.AsArray();
        var seeds = new[] { 31, 32 };
        for (int i = 0; i < notes.Count; i++)
        {
            var note = Patch.RollPatch(state, i == 0 ? "stage1" : "stage2", new Rng(seeds[i]));
            var e = notes[i]!;
            Assert.Equal(e["version"]!.GetValue<string>(), note.Version);
            Assert.Equal(
                e["changes"]!.AsArray().Select(c => (
                    c!["agentId"]!.GetValue<string>(), c["meta"]!.GetValue<string>(), c["dir"]!.GetValue<string>(), c["pct"]!.GetValue<int>())),
                note.Changes.Select(c => (c.AgentId, Hex(c.Meta), c.Dir, c.Pct)));
            Assert.Equal(
                e["mapNotes"]!.AsArray().Select(m => (m!["mapId"]!.GetValue<string>(), m["text"]!.GetValue<string>())),
                note.MapNotes.Select(kv => (kv.Key, kv.Value)));
        }

        foreach (var v in Golden.Value["replVec"]!.AsArray())
        {
            var r = Patch.RecommendReplacement(state, v!["cut"]!.GetValue<string>(), v["mapId"]!.GetValue<string>(),
                new List<string> { "raze", "neon", "breach", "sky", "viper", "cypher" });
            var exp = v["r"];
            if (exp is JsonObject eo)
            {
                Assert.NotNull(r);
                Assert.Equal(eo["agentId"]!.GetValue<string>(), r!.Value.AgentId);
                Assert.Equal(eo["score"]!.GetValue<string>(), Hex(r.Value.Score));
            }
            else
            {
                Assert.Null(r);
            }
        }
    }
}
