/**
 * 确定性 RNG — xoshiro128** + splitmix32 播种（GDD §11.1）
 * 规则：一切模拟随机必须经 Rng 实例，禁止 Math.random（CI 双跑比对依赖此约定）。
 */
import { detCos, detLog } from './detmath.ts';

/** FNV-1a：字符串 → 32 位种子 */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** splitmix32：单个种子扩散为 4 个状态字 */
function splitmix32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e3779b9) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 16), 0x21f0aaad);
    t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
    return (t ^ (t >>> 15)) >>> 0;
  };
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

export class Rng {
  private s0 = 0;
  private s1 = 0;
  private s2 = 0;
  private s3 = 0;

  constructor(seed: number) {
    const next = splitmix32(seed);
    this.s0 = next();
    this.s1 = next();
    this.s2 = next();
    this.s3 = next();
    // 避免全零状态
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) this.s0 = 1;
  }

  private nextU32(): number {
    const result = (rotl(Math.imul(this.s1, 5) >>> 0, 7) + this.s2) >>> 0;
    const t = (this.s1 << 9) >>> 0;
    this.s2 ^= this.s0;
    this.s3 ^= this.s1;
    this.s1 ^= this.s2;
    this.s0 ^= this.s3;
    this.s2 ^= t;
    this.s3 = rotl(this.s3, 11);
    return result;
  }

  /** [0,1) 均匀浮点 */
  next(): number {
    return this.nextU32() / 0x100000000;
  }

  /** [minIncl, maxIncl] 整数 */
  int(minIncl: number, maxIncl: number): number {
    if (maxIncl <= minIncl) return minIncl;
    return minIncl + Math.floor(this.next() * (maxIncl - minIncl + 1));
  }

  /** [min, max) 浮点 */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length - 1)];
  }

  /** 按权重取下标（权重无需归一化，非正权重忽略） */
  weightedIndex(weights: readonly number[]): number {
    let total = 0;
    for (const w of weights) total += w > 0 ? w : 0;
    if (total <= 0) return this.int(0, weights.length - 1);
    let roll = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      const w = weights[i] ?? 0;
      if (w <= 0) continue;
      roll -= w;
      if (roll <= 0) return i;
    }
    return weights.length - 1;
  }

  shuffle<T>(items: readonly T[]): T[] {
    const arr = items.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      const tmp = arr[i] as T;
      arr[i] = arr[j] as T;
      arr[j] = tmp;
    }
    return arr;
  }

  /** Box–Muller 正态（detLog/detCos：确定性数学，双端逐位一致） */
  norm(mean = 0, sd = 1): number {
    let u = 0;
    let v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    return mean + sd * Math.sqrt(-2 * detLog(u)) * detCos(2 * Math.PI * v);
  }

  clampNorm(mean: number, sd: number, min: number, max: number): number {
    let v = this.norm(mean, sd);
    if (v < min) v = min;
    if (v > max) v = max;
    return v;
  }

  /** 从当前状态派生子 RNG（不影响自身序列） */
  fork(salt: number | string): Rng {
    return new Rng((hashString(String(salt)) ^ this.nextU32()) >>> 0);
  }
}

/** clamp */
export function clamp(v: number, min: number, max: number): number {
  if (v < min) return min;
  if (v > max) return max;
  return v;
}
