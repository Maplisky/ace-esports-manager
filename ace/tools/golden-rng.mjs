/**
 * 黄金轨迹记录器（RNG 部分）— TS 侧是唯一权威实现。
 * 用固定 seed 录制 Rng 全部 API 的输出（浮点按 IEEE754 位型记录为 16-hex），
 * 由 kairo/Core.Tests 回放做逐位比对；另含 Math.log/cos/sqrt 平台实现探针。
 * 运行：node tools/golden-rng.mjs（在 ace/ 下）
 */
import { Rng, hashString } from '../src/core/rng.ts';
import { detLog, detCos, detSin, detExp } from '../src/core/detmath.ts';
import { writeFileSync, mkdirSync } from 'node:fs';

const hex64 = (x) => {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  return dv.getBigUint64(0).toString(16).padStart(16, '0');
};

const SEEDS = [0, 1, 2, 0xdeadbeef, 0x7fffffff, 0xffffffff, 123456789];
const WEIGHT_CASES = [
  [1, 2, 3],
  [0, 5, 0],
  [0, 0, 0],
  [10, 0, 1, 0.5],
];

const recordSeed = (seed) => {
  const r = new Rng(seed);
  const ops = [];
  for (let i = 0; i < 8; i++) ops.push({ op: 'int', args: [0, 9], r: r.int(0, 9) });
  ops.push({ op: 'int', args: [5, 5], r: r.int(5, 5) });
  ops.push({ op: 'int', args: [7, 3], r: r.int(7, 3) });
  for (let i = 0; i < 4; i++) ops.push({ op: 'range', args: [1.5, 9.5], r: hex64(r.range(1.5, 9.5)) });
  for (const p of [0.3, 0.5, 0.7, 0.9, 0.3, 0.5, 0.7, 0.9]) ops.push({ op: 'chance', args: [p], r: r.chance(p) ? 1 : 0 });
  for (const w of WEIGHT_CASES) for (let i = 0; i < 3; i++) ops.push({ op: 'weighted', args: [w], r: r.weightedIndex(w) });
  ops.push({ op: 'shuffle', args: [[1, 2, 3, 4, 5, 6, 7, 8]], r: r.shuffle([1, 2, 3, 4, 5, 6, 7, 8]) });
  ops.push({ op: 'shuffle', args: [['a', 'b', 'c']], r: r.shuffle(['a', 'b', 'c']) });
  for (let i = 0; i < 8; i++) ops.push({ op: 'norm', args: [], r: hex64(r.norm()) });
  for (let i = 0; i < 4; i++) ops.push({ op: 'clampNorm', args: [50, 15, 0, 100], r: hex64(r.clampNorm(50, 15, 0, 100)) });
  ops.push({ op: 'norm2', args: [100, 20], r: hex64(r.norm(100, 20)) });
  const forkA = r.fork('alpha');
  const forkB = r.fork(12345);
  ops.push({ op: 'fork-string', args: ['alpha'], r: [0, 1, 2, 3].map(() => hex64(forkA.next())) });
  ops.push({ op: 'fork-number', args: [12345], r: [0, 1, 2, 3].map(() => hex64(forkB.next())) });
  ops.push({ op: 'afterfork', args: [], r: hex64(r.next()) });
  return { seed, next: Array.from({ length: 64 }, () => hex64(r.next())), ops };
};

const seeds = SEEDS.map(recordSeed);

const hash = ['', 'ASCENT', 'kairo', '队名测试', 'seed:42:map'].map((s) => ({ s, h: hashString(s).toString(16) }));

// Math 平台实现探针：输入即分布（Rng 均匀流），C# 侧重算逐位比对
const probe = new Rng(777);
const inputs = [];
while (inputs.length < 4096) {
  const x = probe.next();
  if (x > 0) inputs.push(hex64(x));
}
const dv = new DataView(new ArrayBuffer(8));
const readHex = (h) => (dv.setBigUint64(0, BigInt('0x' + h)), dv.getFloat64(0));
const mathprobe = {
  inputs,
  log: inputs.map((h) => hex64(Math.log(readHex(h)))),
  cos: inputs.map((h) => hex64(Math.cos(2 * Math.PI * readHex(h)))),
  sqrt: inputs.map((h) => hex64(Math.sqrt(readHex(h)))),
  // exp 探针：logistic 实际输入域 [-5,5]（x*10-5）+ 原始 (0,1)
  expInputs: inputs.slice(0, 2048).map((h) => hex64(readHex(h) * 10 - 5)),
  exp: null,
  detExp: null,
  // 确定性数学（双端权威实现，0 容断言对象）
  detLog: inputs.map((h) => hex64(detLog(readHex(h)))),
  detCos: inputs.map((h) => hex64(detCos(2 * Math.PI * readHex(h)))),
  detSin: inputs.map((h) => hex64(detSin(2 * Math.PI * readHex(h)))),
};
mathprobe.exp = mathprobe.expInputs.map((h) => hex64(Math.exp(readHex(h))));
mathprobe.detExp = mathprobe.expInputs.map((h) => hex64(detExp(readHex(h))));

const out = {
  meta: {
    generator: 'ace/tools/golden-rng.mjs',
    node: process.version,
    authority: 'ace/src/core/rng.ts',
    note: '浮点为 IEEE754 位型 16-hex；比对必须逐位而非十进制',
  },
  hash,
  seeds,
  mathprobe,
};

mkdirSync('../kairo/Core.Tests/Golden', { recursive: true });
writeFileSync('../kairo/Core.Tests/Golden/rng.golden.json', JSON.stringify(out));
console.log(`golden written: ${seeds.length} seeds, ${inputs.length} mathprobe inputs`);
