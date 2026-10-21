using System;

namespace Kairo.Core;

/// <summary>
/// 确定性数学函数 — 跨语言/跨平台逐位一致的对数与余弦（M1 内核移植 §5-5 收敛动作）。
/// C# 镜像自 ace/src/core/detmath.ts（权威实现），必须逐操作对齐，改动需双端同步。
/// 只用 IEEE754 四则、位掩码与固定操作顺序；sqrt 为 IEEE 正确舍入，直接用平台实现。
/// </summary>
public static class DetMath
{
    private static readonly double Pio2 = Math.PI / 2;

    // π/2 三段 Cody-Waite 拆分：程序化推导（与 TS 侧 maskLow/精确减法逐位一致）
    private static readonly double Pio2Hi = MaskLow(Pio2, 28);
    private static readonly double Pio2Rem1 = Pio2 - Pio2Hi;
    private static readonly double Pio2Mid = MaskLow(Pio2Rem1, 30);
    private static readonly double Pio2Lo = Pio2Rem1 - Pio2Mid;

    /// <summary>ln2 三段 Cody-Waite 拆分（exp 归约用，与 TS maskLow 推导逐位一致）。</summary>
    private static readonly double Ln2Hi = MaskLow(Ln2, 28);
    private static readonly double Ln2Rem1 = Ln2 - Ln2Hi;
    private static readonly double Ln2Mid = MaskLow(Ln2Rem1, 30);
    private static readonly double Ln2Lo = Ln2Rem1 - Ln2Mid;

    private const double Ln2 = 0.6931471805599453;

    private static double BitsOf(double x) => BitConverter.DoubleToInt64Bits(x);
    private static double FromBits(long b) => BitConverter.Int64BitsToDouble(b);

    /// <summary>清零低位（精确位操作，双端一致）。</summary>
    private static double MaskLow(double x, int lowBitsToZero)
    {
        long b = BitConverter.DoubleToInt64Bits(x);
        long mask = ~((1L << lowBitsToZero) - 1);
        return BitConverter.Int64BitsToDouble(b & mask);
    }

    /// <summary>
    /// 自然对数，x ∈ (0, ∞)。归一到 [1,2) 后用 atanh 变换级数（Horner，固定 18 项）。
    /// 与 TS detLog 逐位一致；与平台 Math.Log 可能差若干 ulp —— 刻意的确定性换位。
    /// </summary>
    public static double Log(double x)
    {
        if (double.IsNaN(x)) return double.NaN;
        if (x <= 0) return x == 0 ? double.NegativeInfinity : double.NaN;
        if (x == 1) return 0;
        // frexp：x = f * 2^e，f ∈ [1,2)。乘除 2 的幂均为精确操作。
        double f = x;
        long e = 0;
        while (f < 1) { f *= 2; e--; }
        while (f >= 2) { f *= 0.5; e++; }
        // log(f) = log(1+t)，t = f-1 ∈ [0,1)：s = t/(2+t) ∈ [0,1/3)
        double t = f - 1;
        double s = t / (2 + t);
        double s2 = s * s;
        // log(1+t) = 2s·Σ_{j≥0} s2^j/(2j+1)，j=0..17 截断，Horner 自尾项起
        double acc = 1 / 35.0; // j=17 项
        for (long j = 16; j >= 0; j--) acc = 1 / (2.0 * j + 1) + s2 * acc;
        double logF = 2 * s * acc;
        return logF + e * Ln2;
    }

    /// <summary>cos(x)，x ∈ [0, 2π)。π/2 三段归约 + [-π/4,π/4] 核多项式。</summary>
    public static double Cos(double x)
    {
        long n = (long)Math.Floor(x / Pio2 + 0.5); // Floor(+0.5)：双端舍入语义一致
        double r = ((x - n * Pio2Hi) - n * Pio2Mid) - n * Pio2Lo;
        long q = ((n % 4) + 4) % 4;
        if (q == 0) return KernelCos(r);
        if (q == 2) return -KernelCos(r);
        if (q == 1) return -KernelSin(r);
        return KernelSin(r);
    }

    /// <summary>sin(x)，x ∈ [0, 2π)（供未来需要 sin 的内核函数使用）。</summary>
    public static double Sin(double x)
    {
        long n = (long)Math.Floor(x / Pio2 + 0.5);
        double r = ((x - n * Pio2Hi) - n * Pio2Mid) - n * Pio2Lo;
        long q = ((n % 4) + 4) % 4;
        if (q == 0) return KernelSin(r);
        if (q == 2) return -KernelSin(r);
        if (q == 1) return KernelCos(r);
        return -KernelCos(r);
    }

    /// <summary>整数幂（exp ≥ 0）：固定顺序循环乘，与 TS detPowInt 逐位一致（替代平台 Math.Pow）。</summary>
    public static double PowInt(double baseVal, long exp)
    {
        double result = 1;
        for (long i = 0; i < exp; i++) result *= baseVal;
        return result;
    }

    /// <summary>
    /// JS Math.round 语义：最接近值、平局向 +∞（含 0.49999999999999994 边界）。
    /// 与 .NET Math.Round（银行家舍入）不同，模拟内核一切取整必须经此。
    /// </summary>
    public static double JsRound(double x)
    {
        if (double.IsNaN(x) || double.IsInfinity(x)) return x;
        double f = Math.Floor(x);
        double diff = x - f;
        if (diff > 0.5) return f + 1;
        if (diff < 0.5) return f;
        return f + 1; // 恰为 0.5 → 向 +∞（JS Math.round(-0.5) === -0，数值上同为 0）
    }

    /// <summary>
    /// 指数函数 exp(x)（fdlibm __ieee754_exp 算法，与 TS detExp 逐操作对齐）：
    /// k = Floor(x/ln2 + 0.5) 归约，三段补偿，P 多项式，2^k 精确逐次缩放。
    /// </summary>
    public static double Exp(double x)
    {
        if (double.IsNaN(x)) return double.NaN;
        if (x > 709.782712893384) return double.PositiveInfinity;
        if (x < -745.1332191019411) return 0;
        long k = (long)Math.Floor(x / Ln2 + 0.5);
        double r = ((x - k * Ln2Hi) - k * Ln2Mid) - k * Ln2Lo;
        double z = r * r;
        const double P1 = 1.66666666666666019037e-01;
        const double P2 = -2.77777777770155933842e-03;
        const double P3 = 6.61375632143793436117e-05;
        const double P4 = -1.65339022054652515390e-06;
        const double P5 = 4.13813679705723846039e-08;
        const double P6 = -9.96439500486238409018e-10;
        double c = r - z * (P1 + r * (P2 + r * (P3 + r * (P4 + r * (P5 + r * P6)))));
        double y = 1 - ((z * c) / (c + 2) - r);
        long e = k;
        while (e > 0) { y *= 2; e--; }
        while (e < 0) { y *= 0.5; e++; }
        return y;
    }

    /// <summary>
    /// 定点 2 位小数格式化（与 TS detToFixed2 逐字符一致）：k = JsRound(v·100)，
    /// 纯整数拼接。JS Math.round(v*100) 与 JsRound(v*100) 同语义（半数向 +∞）。
    /// </summary>
    public static string ToFixed2(double v)
    {
        long k = (long)JsRound(v * 100);
        bool neg = k < 0;
        long a = Math.Abs(k);
        long intPart = a / 100;
        long frac = a % 100;
        return $"{(neg ? "-" : "")}{intPart}.{(frac < 10 ? "0" : "")}{frac}";
    }

    /// <summary>cos 核，r ∈ [-π/4, π/4]。系数取自 fdlibm __kernel_cos（公有领域）。</summary>
    private static double KernelCos(double r)
    {
        double z = r * r;
        const double C1 = 4.16666666666666019037e-02;
        const double C2 = -1.38888888888741095749e-03;
        const double C3 = 2.48015872894767294178e-05;
        const double C4 = -2.75573143513906633035e-07;
        const double C5 = 2.08757232129817482790e-09;
        const double C6 = -1.13596475577881948265e-11;
        double poly = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
        return 1 - z * (0.5 - poly);
    }

    /// <summary>sin 核，r ∈ [-π/4, π/4]。系数取自 fdlibm __kernel_sin（公有领域）。</summary>
    private static double KernelSin(double r)
    {
        double z = r * r;
        const double S1 = -1.66666666666666324348e-01;
        const double S2 = 8.33333333332248946124e-03;
        const double S3 = -1.98412698298579493134e-04;
        const double S4 = 2.75573137070700676789e-06;
        const double S5 = -2.50507602534068634195e-08;
        const double S6 = 1.58969099521155010221e-10;
        double poly = S1 + z * (S2 + z * (S3 + z * (S4 + z * (S5 + z * S6))));
        return r + r * z * poly;
    }
}
