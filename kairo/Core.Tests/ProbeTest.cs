using System;
using Kairo.Core;
using Xunit;

namespace Kairo.Core.Tests;

public sealed class ProbeTest
{
    [Fact]
    public void Probe()
    {
        double worst = 0, worstX = 0;
        for (double x = -20; x <= 20; x += 0.0007)
        {
            double d = DetMath.Exp(x), m = Math.Exp(x);
            double rel = Math.Abs(d - m) / m;
            if (rel > worst) { worst = rel; worstX = x; }
        }
        Console.Error.WriteLine($"[probe] CS Exp worstRelErr={worst:E3} @x={worstX}");
        Console.Error.WriteLine($"[probe] CS Pow(1.35,1)={DetMath.Pow(1.35, 1.0).ToString("R")}");
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
            Console.Error.WriteLine($"[probe] Exp({x})={actual} expect={hex}");
            Assert.Equal(hex, actual);
        }
        Assert.True(worst < 1e-12, $"worst={worst}");
    }
}
