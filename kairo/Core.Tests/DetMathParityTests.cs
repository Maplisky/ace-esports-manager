using System;
using Kairo.Core;
using Xunit;

namespace Kairo.Core.Tests;

/// <summary>DetMath.Exp 双端奇偶门（原 ProbeTest，2026-10-22 detExp fdlibm 修复轮沉淀）：
/// ①精度——[-20,20] 扫描对 Math.Exp 误差 &lt; 1e-12；②双端位型——TS detmath.ts 同点位 16-hex 逐位一致。
/// 改动 DetMath.Exp/TS detExp 后必须跑本测试并重录受影响黄金（transfer/match/day/extra/rng）。</summary>
public sealed class DetMathParityTests
{
    [Fact]
    public void Exp_Precision_And_TsParity()
    {
        double worst = 0, worstX = 0;
        for (double x = -20; x <= 20; x += 0.0007)
        {
            double d = DetMath.Exp(x), m = Math.Exp(x);
            double rel = Math.Abs(d - m) / m;
            if (rel > worst) { worst = rel; worstX = x; }
        }
        Assert.True(worst < 1e-12, $"worst={worst:E3} @x={worstX}");
        // TS 侧同点位位型（node detmath.ts 输出）——双端逐位一致
        var expected = new (double X, string Hex)[]
        {
            (-9.010700000007875, "3f2000dfbc14eb8b"),
            (0.3001045924503381, "3ff599999999999a"),
            (1, "4005bf0a8b14576a"),
            (14.2, "413669c0308d2bb3"),
            (-7.3, "3f4622d4792b6a8d"),
            (0.0007, "3ff002de4299ea89"),
        };
        foreach (var (x, hex) in expected)
        {
            var actual = BitConverter.DoubleToInt64Bits(DetMath.Exp(x)).ToString("x16");
            Assert.Equal(hex, actual);
        }
    }
}
