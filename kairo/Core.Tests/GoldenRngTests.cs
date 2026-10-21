using System;
using System.Globalization;
using System.Text.Json;
using Kairo.Core;
using Xunit;

namespace Kairo.Core.Tests;

/// <summary>
/// RNG 黄金轨迹回放：与 ace/src/core/rng.ts（权威实现）的录制输出做逐位比对。
/// 浮点一律以 IEEE754 位型（16-hex）比对，禁止十进制容差。
/// 录制顺序（golden-rng.mjs）：对同一 Rng 实例先依次执行 ops 流，再录 64 个 next。
/// </summary>
public sealed class GoldenRngTests
{
    private static readonly Lazy<JsonElement> Golden = new(() =>
        JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Golden", "rng.golden.json"))).RootElement);

    private static double Bits(string hex) => BitConverter.Int64BitsToDouble(long.Parse(hex, NumberStyles.HexNumber));

    /// <summary>两个位型的 ULP 距离（用于已知平台偏差的显式放行）。</summary>
    private static long Ulps(string hexA, string hexB)
    {
        long a = long.Parse(hexA, NumberStyles.HexNumber), b = long.Parse(hexB, NumberStyles.HexNumber);
        // 有序 int 映射使负数单调（标准 IEEE ulp-distance 技巧）
        long ia = a >= 0 ? a : long.MinValue - a;
        long ib = b >= 0 ? b : long.MinValue - b;
        return Math.Abs(ia - ib);
    }

    private static void AssertFloatOp(string kind, string expectedHex, double actual)
    {
        var actualHex = BitsOf(actual);
        Assert.True(expectedHex == actualHex,
            $"{kind}: {expectedHex} vs {actualHex} ({Ulps(expectedHex, actualHex)} ulps)");
    }

    private static string BitsOf(double v) => BitConverter.DoubleToInt64Bits(v).ToString("x16");

    private static JsonElement SeedRec(uint seed) =>
        Golden.Value.GetProperty("seeds").EnumerateArray().First(s => s.GetProperty("seed").GetUInt32() == seed);

    /// <summary>按录制顺序在 r 上重放 ops 流（消费随机数，不比对）。</summary>
    private static void ReplayOps(Rng r, JsonElement ops)
    {
        foreach (var op in ops.EnumerateArray())
        {
            var args = op.GetProperty("args");
            switch (op.GetProperty("op").GetString())
            {
                case "int": r.Int(args[0].GetInt32(), args[1].GetInt32()); break;
                case "range": r.Range(args[0].GetDouble(), args[1].GetDouble()); break;
                case "chance": r.Chance(args[0].GetDouble()); break;
                case "weighted":
                    r.WeightedIndex(args[0].EnumerateArray().Select(x => x.GetDouble()).ToArray());
                    break;
                case "shuffle" when args[0][0].ValueKind == JsonValueKind.Number:
                    r.Shuffle(args[0].EnumerateArray().Select(x => x.GetInt32()).ToArray());
                    break;
                case "shuffle":
                    r.Shuffle(args[0].EnumerateArray().Select(x => x.GetString()!).ToArray());
                    break;
                case "norm": r.Norm(); break;
                case "norm2": r.Norm(args[0].GetDouble(), args[1].GetDouble()); break;
                case "clampNorm": r.ClampNorm(args[0].GetDouble(), args[1].GetDouble(), args[2].GetDouble(), args[3].GetDouble()); break;
                case "fork-string": r.Fork(args[0].GetString()!); break;
                case "fork-number": r.Fork((uint)args[0].GetInt32()); break;
                case "afterfork": r.Next(); break;
                default: throw new InvalidOperationException("unknown op");
            }
        }
    }

    [Fact]
    public void HashString_MatchesTsVectors()
    {
        foreach (var item in Golden.Value.GetProperty("hash").EnumerateArray())
        {
            var expected = uint.Parse(item.GetProperty("h").GetString()!, NumberStyles.HexNumber, CultureInfo.InvariantCulture);
            Assert.Equal(expected, Rng.HashString(item.GetProperty("s").GetString()!));
        }
    }

    public static TheoryData<uint> Seeds() =>
        new(Golden.Value.GetProperty("seeds").EnumerateArray().Select(s => s.GetProperty("seed").GetUInt32()));

    [Theory]
    [MemberData(nameof(Seeds))]
    public void Next64_AfterOps_BitExact(uint seed)
    {
        var rec = SeedRec(seed);
        var r = new Rng(seed);
        ReplayOps(r, rec.GetProperty("ops"));
        int i = 0;
        foreach (var n in rec.GetProperty("next").EnumerateArray())
        {
            Assert.Equal(n.GetString(), BitsOf(r.Next()));
            i++;
        }
        Assert.Equal(64, i);
    }

    [Theory]
    [MemberData(nameof(Seeds))]
    public void OpStream_BitExact(uint seed)
    {
        var rec = SeedRec(seed);
        var r = new Rng(seed);
        foreach (var op in rec.GetProperty("ops").EnumerateArray())
        {
            var kind = op.GetProperty("op").GetString();
            var args = op.GetProperty("args");
            switch (kind)
            {
                case "int":
                    Assert.Equal(op.GetProperty("r").GetInt32(), r.Int(args[0].GetInt32(), args[1].GetInt32()));
                    break;
                case "range":
                    Assert.Equal(op.GetProperty("r").GetString(), BitsOf(r.Range(args[0].GetDouble(), args[1].GetDouble())));
                    break;
                case "chance":
                    Assert.Equal(op.GetProperty("r").GetInt32() == 1, r.Chance(args[0].GetDouble()));
                    break;
                case "weighted":
                {
                    var w = args[0].EnumerateArray().Select(x => x.GetDouble()).ToArray();
                    Assert.Equal(op.GetProperty("r").GetInt32(), r.WeightedIndex(w));
                    break;
                }
                case "shuffle" when args[0][0].ValueKind == JsonValueKind.Number:
                {
                    var src = args[0].EnumerateArray().Select(x => x.GetInt32()).ToArray();
                    Assert.Equal(op.GetProperty("r").EnumerateArray().Select(x => x.GetInt32()), r.Shuffle(src));
                    break;
                }
                case "shuffle":
                {
                    var src = args[0].EnumerateArray().Select(x => x.GetString()!).ToArray();
                    Assert.Equal(op.GetProperty("r").EnumerateArray().Select(x => x.GetString()), r.Shuffle(src));
                    break;
                }
                case "norm":
                    AssertFloatOp("norm", op.GetProperty("r").GetString()!, r.Norm());
                    break;
                case "norm2":
                    AssertFloatOp("norm2", op.GetProperty("r").GetString()!, r.Norm(args[0].GetDouble(), args[1].GetDouble()));
                    break;
                case "clampNorm":
                    AssertFloatOp("clampNorm", op.GetProperty("r").GetString()!, r.ClampNorm(args[0].GetDouble(), args[1].GetDouble(), args[2].GetDouble(), args[3].GetDouble()));
                    break;
                case "fork-string":
                {
                    var child = r.Fork(args[0].GetString()!);
                    var expected = op.GetProperty("r").EnumerateArray().Select(x => x.GetString()!).ToArray();
                    Assert.Equal(expected, Enumerable.Range(0, 4).Select(_ => BitsOf(child.Next())).ToArray());
                    break;
                }
                case "fork-number":
                {
                    var child = r.Fork((uint)args[0].GetInt32());
                    var expected = op.GetProperty("r").EnumerateArray().Select(x => x.GetString()!).ToArray();
                    Assert.Equal(expected, Enumerable.Range(0, 4).Select(_ => BitsOf(child.Next())).ToArray());
                    break;
                }
                case "afterfork":
                    Assert.Equal(op.GetProperty("r").GetString(), BitsOf(r.Next()));
                    break;
            }
        }
    }

    /// <summary>
    /// 确定性数学逐位裁决：detLog/detCos/detSin/detExp（自实现，纯 IEEE 四则）与 TS 权威实现
    /// 必须零失配。平台 Math.log/cos/exp 的 ±1 ulp 失配已由此收敛（2026-10-21）。
    /// 另输出平台 Math.Exp 基线失配数（仅报告，不作断言）。
    /// </summary>
    [Fact]
    public void DetMath_BitExact()
    {
        var probe = Golden.Value.GetProperty("mathprobe");
        var inputs = probe.GetProperty("inputs").EnumerateArray().Select(x => Bits(x.GetString()!)).ToArray();
        var detLog = probe.GetProperty("detLog").EnumerateArray().Select(x => x.GetString()!).ToArray();
        var detCos = probe.GetProperty("detCos").EnumerateArray().Select(x => x.GetString()!).ToArray();
        var detSin = probe.GetProperty("detSin").EnumerateArray().Select(x => x.GetString()!).ToArray();
        var expInputs = probe.GetProperty("expInputs").EnumerateArray().Select(x => Bits(x.GetString()!)).ToArray();
        var detExp = probe.GetProperty("detExp").EnumerateArray().Select(x => x.GetString()!).ToArray();
        var v8Exp = probe.GetProperty("exp").EnumerateArray().Select(x => x.GetString()!).ToArray();

        int logBad = 0, cosBad = 0, sinBad = 0, expBad = 0;
        for (int i = 0; i < inputs.Length; i++)
        {
            double x = inputs[i];
            if (BitsOf(DetMath.Log(x)) != detLog[i]) logBad++;
            if (BitsOf(DetMath.Cos(2 * Math.PI * x)) != detCos[i]) cosBad++;
            if (BitsOf(DetMath.Sin(2 * Math.PI * x)) != detSin[i]) sinBad++;
        }
        for (int i = 0; i < expInputs.Length; i++)
        {
            if (BitsOf(DetMath.Exp(expInputs[i])) != detExp[i]) expBad++;
        }
        // 平台基线（V8 Math.exp vs .NET Math.Exp，输入域 [-5,5]）：仅报告
        int v8ExpBad = v8Exp.Select((h, i) => (h, i)).Count(t => BitsOf(Math.Exp(expInputs[t.i])) != t.h);
        Console.Error.WriteLine($"[baseline] Math.Exp platform mismatch (V8 vs .NET, [-5,5]): {v8ExpBad}/{expInputs.Length}");
        Assert.True(logBad == 0, $"detLog mismatch: {logBad}/{inputs.Length}");
        Assert.True(cosBad == 0, $"detCos mismatch: {cosBad}/{inputs.Length}");
        Assert.True(sinBad == 0, $"detSin mismatch: {sinBad}/{inputs.Length}");
        Assert.True(expBad == 0, $"detExp mismatch: {expBad}/{expInputs.Length}");
    }
}
