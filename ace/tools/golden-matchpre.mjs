/**
 * match 前置三叶子（intel/veto/tactics）黄金轨迹记录器。
 * 世界夹具复用 generateWorld(42)。运行：node tools/golden-matchpre.mjs（ace/ 下）
 */
import { generateWorld } from '../src/core/worldgen.ts';
import { intelOf, addIntel, decayIntel, intelLevel, estimateMapStrength, starsOf, mapStrengthBand } from '../src/core/sim/intel.ts';
import { runVeto } from '../src/core/sim/veto.ts';
import { callDefOf, callSideOf, callLabel, callDesc, PLAYER_CALLS } from '../src/core/sim/tactics.ts';
import { Rng } from '../src/core/rng.ts';
import { MAPS } from '../src/core/data/maps.ts';
import { writeFileSync, mkdirSync } from 'node:fs';

const state = generateWorld(42);
const teams = Object.values(state.teams);
const teamIds = teams.slice(0, 8).map((t) => t.id);
state.styleCounter ??= {};

// 情报序列：侦察/衰减/读取
const intelSeq = [];
for (let i = 0; i < 6; i++) intelSeq.push({ op: 'add', id: teamIds[i % 4], amount: i === 2 ? 5 : 2, r: addIntel(state, teamIds[i % 4], i === 2 ? 5 : 2) });
decayIntel(state);
decayIntel(state);
for (const id of teamIds.slice(0, 6)) intelSeq.push({ op: 'of', id, r: intelOf(state, id) });
const levels = [0, 0.5, 1, 2.9, 3, 5.9, 6, 10].map((p) => ({ p, r: intelLevel(p) }));

// 图池预估强度与散布（前 4 队 × 全图 × 3 档眼光）
const estVec = [];
for (const t of teams.slice(0, 4)) {
  for (const m of MAPS) {
    const score = estimateMapStrength(state, t, m);
    estVec.push({ team: t.id, map: m.id, score, stars: starsOf(score) });
    for (const skill of [30, 50, 90]) {
      const band = mapStrengthBand(state, t, m, skill);
      estVec.push({ team: t.id, map: m.id, skill, lo: band.lo, hi: band.hi });
    }
  }
}

// BP：3 队对 × 3 赛制 × 2 噪声（决定性 Rng 流）
const vetoOut = [];
const pairs = [[0, 1], [2, 3], [4, 5]];
for (const [ia, ib] of pairs) {
  for (const bo of [1, 3, 5]) {
    for (const noise of [6, 3]) {
      const rng = new Rng(1000 + bo * 10 + (noise === 6 ? 0 : 1));
      const res = runVeto(teams[ia], teams[ib], bo, rng, noise);
      vetoOut.push({ a: teams[ia].id, b: teams[ib].id, bo, noise, maps: res.maps, log: res.log });
    }
  }
}

// 战术喊话：全 id 矩阵
const callIds = [...PLAYER_CALLS.map((c) => c.id), 'atk:rush:A', 'def:stack:B', 'atk:ultRush:C', 'rush', 'steady', 'unknown:thing'];
const tacticVec = callIds.map((id) => {
  const def = callDefOf(id);
  return {
    id,
    def: def ? { id: def.id, side: def.side, label: def.label, atkMod: def.atkMod, defMod: def.defMod, needsCoreUlts: !!def.needsCoreUlts, needsFullBuy: !!def.needsFullBuy, counterRush: !!def.counterRush, pickSite: !!def.pickSite } : null,
    side: callSideOf(id),
    label: callLabel(id),
    desc: callDesc(id),
  };
});

const out = {
  meta: { generator: 'ace/tools/golden-matchpre.mjs', authority: 'ace/src/core/sim/{intel,veto,tactics}.ts' },
  intelSeq, levels, estVec, vetoOut, tacticVec,
};

mkdirSync('../kairo/Core.Tests/Golden', { recursive: true });
writeFileSync('../kairo/Core.Tests/Golden/matchpre.golden.json', JSON.stringify(out));
console.log(`matchpre golden written: ${intelSeq.length} intel ops, ${vetoOut.length} vetoes, ${tacticVec.length} calls`);
