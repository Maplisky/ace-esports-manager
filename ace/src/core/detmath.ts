/**
 * 确定性数学函数 — 跨语言/跨平台逐位一致的对数与余弦（M1 内核移植 §5-5 收敛动作）。
 * 背景：V8 与 .NET 的 Math.log/cos 实现存在 ±1 ulp 级失配（2026-10-21 探针：4096 输入下
 * Log 310、Cos 106、Sqrt 0），会在模拟内核中级联放大。本模块只用 IEEE754 四则、位掩码与
 * 固定操作顺序，任何语言/平台运行结果逐位相同（sqrt 为 IEEE 正确舍入，直接用平台实现）。
 * C# 对应实现：kairo/Core/DetMath.cs（两侧必须逐操作对齐，改动需双端同步）。
 */

const bitsOf = (x: number): bigint => {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  return dv.getBigUint64(0);
};
const fromBits = (b: bigint): number => {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setBigUint64(0, b);
  return dv.getFloat64(0);
};

/** 清零低位（精确位操作，双端一致） */
const maskLow = (x: number, lowBitsToZero: number): number =>
  fromBits(bitsOf(x) & ~((1n << BigInt(lowBitsToZero)) - 1n));

// π/2 三段 Cody-Waite 拆分：程序化推导（减 nearby double 由 Sterbenz 引理保证精确）
const PIO2 = Math.PI / 2;
const PIO2_HI = maskLow(PIO2, 28);
const PIO2_REM1 = PIO2 - PIO2_HI;
const PIO2_MID = maskLow(PIO2_REM1, 30);
const PIO2_LO = PIO2_REM1 - PIO2_MID;

/** ln2 双精度常数（最短十进制表示，双端解析为同一位型） */
const LN2 = 0.6931471805599453;

/**
 * 自然对数，x ∈ (0, ∞)。归一到 [1,2) 后用 atanh 变换级数（Horner，固定 18 项）。
 * 输出与 V8/.NET 的 Math.log 可能差若干 ulp —— 这是刻意为之的确定性换位。
 */
export function detLog(x: number): number {
  if (x !== x) return NaN;
  if (x <= 0) return x === 0 ? -Infinity : NaN;
  if (x === 1) return 0;
  // frexp：x = f * 2^e，f ∈ [1,2)。乘除 2 的幂均为精确操作。
  let f = x;
  let e = 0;
  while (f < 1) { f *= 2; e--; }
  while (f >= 2) { f *= 0.5; e++; }
  // log(f) = log(1+t)，t = f-1 ∈ [0,1)：s = t/(2+t) ∈ [0,1/3)
  const t = f - 1;
  const s = t / (2 + t);
  const s2 = s * s;
  // log(1+t) = 2s·Σ_{j≥0} s2^j/(2j+1)，j=0..17 截断，Horner 自尾项起
  let acc = 1 / 35; // j=17 项
  for (let j = 16; j >= 0; j--) acc = 1 / (2 * j + 1) + s2 * acc;
  const logF = 2 * s * acc;
  return logF + e * LN2;
}

/** 整数幂（exp ≥ 0）：固定顺序循环乘，双端逐位一致（替代平台 Math.pow，用于薪资曲线等） */
export function detPowInt(base: number, exp: number): number {
  let result = 1;
  for (let i = 0; i < exp; i++) result *= base;
  return result;
}

/**
 * 定点 2 位小数格式化（替代 toFixed(2) 的平台舍入差异）：
 * q = v·100 半数远离零取整（JsRound 语义）→ 整数 k，再纯整数拼接字符串。
 * 双端（TS/C#）对同一 v 产出逐字符相同的结果。
 */
export function detToFixed2(v: number): string {
  const k = Math.round(v * 100); // Math.round = 半数向 +∞，双端以同一整数结论对齐（k 为整数，无舍入歧义）
  const neg = k < 0;
  const a = Math.abs(k);
  const intPart = Math.floor(a / 100);
  const frac = a % 100;
  return `${neg ? "-" : ""}${intPart}.${frac < 10 ? "0" : ""}${frac}`;
}

/** ln2 三段 Cody-Waite 拆分（exp 归约用）：程序化推导，双端一致 */
const LN2_HI = maskLow(LN2, 28);
const LN2_REM1 = LN2 - LN2_HI;
const LN2_MID = maskLow(LN2_REM1, 30);
const LN2_LO = LN2_REM1 - LN2_MID;

/**
 * 指数函数 exp(x)（fdlibm __ieee754_exp 算法）：k = round(x/ln2) 归约，
 * r = x - k·ln2（三段补偿，|r| ≤ ln2/2），P 多项式 + 1 封闭式，2^k 用精确的逐次乘除。
 * 输出与 V8/.NET 的 Math.exp 可能差若干 ulp —— 刻意的确定性换位。
 * 模拟内核现实输入域 |x| ≤ ~5（logistic），全域实现仍保留（钳位溢出边界）。
 */
export function detExp(x: number): number {
  if (x !== x) return NaN;
  if (x > 709.782712893384) return Infinity;
  if (x < -745.1332191019411) return 0;
  const k = Math.floor(x / LN2 + 0.5); // Floor(+0.5)：双端舍入语义一致
  // r = x - k·ln2，三段补偿
  const r = ((x - k * LN2_HI) - k * LN2_MID) - k * LN2_LO;
  const z = r * r;
  const P1 = 1.66666666666666019037e-01;
  const P2 = -2.77777777770155933842e-03;
  const P3 = 6.61375632143793436117e-05;
  const P4 = -1.65339022054652515390e-06;
  const P5 = 4.13813679705723846039e-08;
  const P6 = -9.96439500486238409018e-10;
  const c = r - z * (P1 + r * (P2 + r * (P3 + r * (P4 + r * (P5 + r * P6)))));
  let y = 1 - ((z * c) / (c + 2) - r);
  // 2^k 精确缩放（乘除 2 的幂无损）
  let e = k;
  while (e > 0) { y *= 2; e--; }
  while (e < 0) { y *= 0.5; e++; }
  return y;
}

/** cos(x)，x ∈ [0, 2π)。π/2 三段归约 + [-π/4,π/4] 核多项式。 */
export function detCos(x: number): number {
  const n = Math.floor(x / PIO2 + 0.5); // Floor(+0.5)：双端舍入语义一致
  const r = ((x - n * PIO2_HI) - n * PIO2_MID) - n * PIO2_LO;
  const q = ((n % 4) + 4) % 4;
  if (q === 0) return KernelCos(r);
  if (q === 2) return -KernelCos(r);
  if (q === 1) return -KernelSin(r);
  return KernelSin(r);
}

/** sin(x)，x ∈ [0, 2π)（供未来需要 sin 的内核函数使用）。 */
export function detSin(x: number): number {
  const n = Math.floor(x / PIO2 + 0.5);
  const r = ((x - n * PIO2_HI) - n * PIO2_MID) - n * PIO2_LO;
  const q = ((n % 4) + 4) % 4;
  if (q === 0) return KernelSin(r);
  if (q === 2) return -KernelSin(r);
  if (q === 1) return KernelCos(r);
  return -KernelCos(r);
}

/** cos 核，r ∈ [-π/4, π/4]。系数取自 fdlibm __kernel_cos（公有领域）。 */
function KernelCos(r: number): number {
  const z = r * r;
  const C1 = 4.16666666666666019037e-02;
  const C2 = -1.38888888888741095749e-03;
  const C3 = 2.48015872894767294178e-05;
  const C4 = -2.75573143513906633035e-07;
  const C5 = 2.08757232129817482790e-09;
  const C6 = -1.13596475577881948265e-11;
  const poly = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  return 1 - z * (0.5 - poly);
}

/** sin 核，r ∈ [-π/4, π/4]。系数取自 fdlibm __kernel_sin（公有领域）。 */
function KernelSin(r: number): number {
  const z = r * r;
  const S1 = -1.66666666666666324348e-01;
  const S2 = 8.33333333332248946124e-03;
  const S3 = -1.98412698298579493134e-04;
  const S4 = 2.75573137070700676789e-06;
  const S5 = -2.50507602534068634195e-08;
  const S6 = 1.58969099521155010221e-10;
  const poly = S1 + z * (S2 + z * (S3 + z * (S4 + z * (S5 + z * S6))));
  return r + r * z * poly;
}
