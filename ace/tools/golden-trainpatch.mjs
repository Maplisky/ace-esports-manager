/**
 * training + patch 黄金轨迹记录器。
 * patch 夹具复用 generateWorld(42)（两赛段连发验证惯性 + 平替推荐）。
 * 运行：node tools/golden-trainpatch.mjs（ace/ 下）
 */
import { generateWorld } from '../src/core/worldgen.ts';
import { INDIVIDUAL_OPTIONS, recommendFocus, recommendPlan } from '../src/core/data/training.ts';
import { rollPatch, recommendReplacement } from '../src/core/sim/patch.ts';
import { Rng } from '../src/core/rng.ts';
import { writeFileSync, mkdirSync } from 'node:fs';

const hex64 = (x) => {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  return dv.getBigUint64(0).toString(16).padStart(16, '0');
};

// training：recommendFocus 全矩阵 + recommendPlan 状态扫描（无 RNG，纯函数）
const focusVec = [];
for (const duty of ['duelist', 'initiator', 'controller', 'sentinel']) {
  for (const isIgl of [false, true]) focusVec.push({ duty, isIgl, r: recommendFocus(duty, isIgl) });
}
const planVec = [];
const mkAttrs = (base, igl) => ({ aim: base, reaction: base - 4, awareness: base + 2, utility: base - 1, clutch: base, teamwork: base + 1, communication: base + 3, igl });
for (const duty of ['duelist', 'initiator', 'controller', 'sentinel']) {
  for (const fat of [30, 70, 71]) {
    for (const base of [50, 88, 96]) {
      for (const igl of [false, true]) {
        const attrs = mkAttrs(base, igl ? 80 : base - 8);
        const p = { attrs, potential: base + 5, fatigue: fat, isIgl: igl };
        const r = recommendPlan(p, duty);
        planVec.push({ duty, fat, base, igl, key: r.key, reason: r.reason });
      }
    }
  }
}

// patch：两赛段连发（惯性路径）+ 平替推荐
const state = generateWorld(42);
const notes = [];
const r1 = rollPatch(state, 'stage1', new Rng(31));
notes.push({
  version: r1.version,
  changes: r1.changes.map((c) => ({ agentId: c.agentId, meta: hex64(c.meta), dir: c.dir, pct: c.pct })),
  mapNotes: r1.mapNotes.map((m) => ({ mapId: m.mapId, text: m.text })),
});
const r2 = rollPatch(state, 'stage2', new Rng(32));
notes.push({
  version: r2.version,
  changes: r2.changes.map((c) => ({ agentId: c.agentId, meta: hex64(c.meta), dir: c.dir, pct: c.pct })),
  mapNotes: r2.mapNotes.map((m) => ({ mapId: m.mapId, text: m.text })),
});
const replVec = [];
for (const cut of ['jett', 'omen', 'sage']) {
  for (const mapId of ['ascent', 'haven']) {
    const r = recommendReplacement(state, cut, mapId, ['raze', 'neon', 'breach', 'sky', 'viper', 'cypher']);
    replVec.push({ cut, mapId, r: r ? { agentId: r.agentId, score: hex64(r.score) } : null });
  }
}

const out = {
  meta: { generator: 'ace/tools/golden-trainpatch.mjs', authority: 'ace/src/core/data/training.ts + sim/patch.ts' },
  options: INDIVIDUAL_OPTIONS.map((o) => ({ key: o.key, name: o.name, attr: o.attr, desc: o.desc })),
  focusVec, planVec, notes, replVec,
};

mkdirSync('../kairo/Core.Tests/Golden', { recursive: true });
writeFileSync('../kairo/Core.Tests/Golden/trainpatch.golden.json', JSON.stringify(out));
console.log(`trainpatch golden written: ${planVec.length} plans, ${notes.length} patches, ${replVec.length} replacements`);
