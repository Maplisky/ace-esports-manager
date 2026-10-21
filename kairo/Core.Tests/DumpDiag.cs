using System.Text.Json.Nodes;
using Kairo.Core;
using Xunit;

namespace Kairo.Core.Tests;

/// <summary>临时诊断导出（默认跳过；需要时把 Skip 去掉跑一次，产物在 builds/，已 gitignore）。</summary>
public sealed class DumpDiag
{
    [Fact(Skip = "诊断工具：需要时移除 Skip 运行")]
    public void Dump_Seed2026()
    {
        WorldgenTestsState.EnsureLoaded();
        var s = Worldgen.GenerateWorld(2026, resetSeq: true);
        var m = typeof(WorldgenGoldenTests).GetMethod("DumpWorld", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static)!;
        var dump = (JsonObject)m.Invoke(null, new object?[] { s })!;
        File.WriteAllText("G:/WorkLoad/vct/kairo/builds/seed2026.cs.json", dump.ToJsonString());
    }
}
