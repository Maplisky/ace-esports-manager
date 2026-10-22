using System;
using System.Collections.Generic;

namespace Kairo.Core;

/// <summary>
/// 确定性 RNG — xoshiro128** + splitmix32 播种（GDD §11.1）。
/// C# 移植自 ace/src/core/rng.ts（权威实现），以黄金轨迹逐位验证。
/// 规则：一切模拟随机必须经 Rng 实例，禁止 Random（双跑比对依赖此约定）。
/// 32 位运算全部使用 uint 回绕语义，对应 TS 的 Math.imul 与 &gt;&gt;&gt;0。
/// </summary>
public sealed class Rng
{
    private uint _s0;
    private uint _s1;
    private uint _s2;
    private uint _s3;

    public Rng(uint seed)
    {
        var next = Splitmix32(seed);
        _s0 = next();
        _s1 = next();
        _s2 = next();
        _s3 = next();
        // 避免全零状态
        if ((_s0 | _s1 | _s2 | _s3) == 0) _s0 = 1;
    }

    public Rng(int seed) : this((uint)seed) { }

    /// <summary>FNV-1a：字符串（UTF-16 码元）→ 32 位种子。</summary>
    public static uint HashString(string s)
    {
        uint h = 0x811c9dc5;
        for (int i = 0; i < s.Length; i++)
        {
            h ^= s[i];
            h *= 0x01000193;
        }
        return h;
    }

    /// <summary>TS Math.imul 镜像：32 位截断乘法（赛程/自由市场种子用）。</summary>
    public static int Imul(int a, int b) => unchecked((int)(a * b));

    /// <summary>splitmix32：单个种子扩散为 4 个状态字。</summary>
    private static Func<uint> Splitmix32(uint seed)
    {
        uint a = seed;
        return () =>
        {
            a += 0x9e3779b9;
            uint t = a;
            t = (t ^ (t >> 16)) * 0x21f0aaad;
            t = (t ^ (t >> 15)) * 0x735a2d97;
            return t ^ (t >> 15);
        };
    }

    private static uint Rotl(uint x, int k) => (x << k) | (x >> (32 - k));

    private uint NextU32()
    {
        uint result = Rotl(_s1 * 5, 7) + _s2;
        uint t = _s1 << 9;
        _s2 ^= _s0;
        _s3 ^= _s1;
        _s1 ^= _s2;
        _s0 ^= _s3;
        _s2 ^= t;
        _s3 = Rotl(_s3, 11);
        return result;
    }

    /// <summary>[0,1) 均匀浮点。</summary>
    public double Next() => NextU32() / 4294967296.0;

    /// <summary>[minIncl, maxIncl] 整数。</summary>
    public int Int(int minIncl, int maxIncl)
    {
        if (maxIncl <= minIncl) return minIncl;
        return (int)(minIncl + Math.Floor(Next() * (maxIncl - minIncl + 1)));
    }

    /// <summary>[min, max) 浮点。</summary>
    public double Range(double min, double max) => min + Next() * (max - min);

    public bool Chance(double p) => Next() < p;

    public T Pick<T>(IReadOnlyList<T> items) => items[Int(0, items.Count - 1)];

    /// <summary>按权重取下标（权重无需归一化，非正权重忽略）。</summary>
    public int WeightedIndex(IReadOnlyList<double> weights)
    {
        double total = 0;
        foreach (double w in weights) total += w > 0 ? w : 0;
        if (total <= 0) return Int(0, weights.Count - 1);
        double roll = Next() * total;
        for (int i = 0; i < weights.Count; i++)
        {
            double w = i < weights.Count ? weights[i] : 0;
            if (w <= 0) continue;
            roll -= w;
            if (roll <= 0) return i;
        }
        return weights.Count - 1;
    }

    public T[] Shuffle<T>(IReadOnlyList<T> items)
    {
        var arr = new T[items.Count];
        for (int i = 0; i < items.Count; i++) arr[i] = items[i];
        for (int i = arr.Length - 1; i > 0; i--)
        {
            int j = Int(0, i);
            (arr[i], arr[j]) = (arr[j], arr[i]);
        }
        return arr;
    }

    /// <summary>Box–Muller 正态（DetMath：确定性数学，与 TS 权威实现逐位一致）。</summary>
    public double Norm(double mean = 0, double sd = 1)
    {
        double u = 0;
        double v = 0;
        while (u == 0) u = Next();
        while (v == 0) v = Next();
        return mean + sd * Math.Sqrt(-2 * DetMath.Log(u)) * DetMath.Cos(2 * Math.PI * v);
    }

    public double ClampNorm(double mean, double sd, double min, double max)
    {
        double v = Norm(mean, sd);
        if (v < min) v = min;
        if (v > max) v = max;
        return v;
    }

    /// <summary>从当前状态派生子 RNG（不影响自身序列）。</summary>
    public Rng Fork(uint salt) => new Rng(HashString(salt.ToString()) ^ NextU32());

    public Rng Fork(string salt) => new Rng(HashString(salt) ^ NextU32());

    /// <summary>克隆当前状态（含状态字，用于检查点回放）。</summary>
    public Rng Clone() => (Rng)MemberwiseClone();
}

public static class MathUtil
{
    public static double Clamp(double v, double min, double max)
    {
        if (v < min) return min;
        if (v > max) return max;
        return v;
    }
}
