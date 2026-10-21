/**
 * strength 黄金轨迹记录器：fit 矩阵 + 职责权重 + 有效能力 + computeSide 全字段。
 * 世界夹具复用 generateWorld(42)（与 worldgen 黄金同源）。运行：node tools/golden-strength.mjs（ace/ 下）
 */
import { generateWorld, resetPlayerSeq } from '../src/core/worldgen.ts';
import { computeFit } from '../src/core/sim/fit.ts';
import {
  computeSide, dutyKillWeight, dutyEntryWeight, effectiveOverall,
  aggrOfLineup, styleOf, styleCounterOf, ROUND_BASE_SCALE, LOGISTIC_K, SWING_SD,
} from '../src/core/sim/strength.ts';
import { AGENTS } from '../src/core/data/agents.ts';
import { MAPS } from '../src/core/data/maps.ts';
import { writeFileSync, mkdirSync } from 'node:fs';

const hex64 = (x) => {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  return dv.getBigUint64(0).toString(16).padStart(16, '0');
};

const fitMatrix = AGENTS.map((a) => ({
  id: a.id,
  fits: MAPS.map((m) => ({ map: m.id, fit: hex64(computeFit(a.id, m)) })),
}));
const dutyW = AGENTS.map((a) => ({ id: a.id, kill: hex64(dutyKillWeight(a.duty)), entry: hex64(dutyEntryWeight(a.duty)) }));

resetPlayerSeq();
const state = generateWorld(42);
const teams = Object.values(state.teams).slice(0, 6);
const days = [1, 30, 120];
const PATCH = { jett: 1.1, omen: 0.9, sova: 1.05 };

const sides = [];
for (const team of teams) {
  for (let mi = 0; mi < 3; mi++) {
    const map = MAPS[mi];
    const intel = mi === 0 ? null : mi === 1 ? 4 : 10;
    const styleCounter = mi === 1 ? 1.8 : mi === 2 ? -1.0 : null;
    const chokeMod = mi === 2 ? -0.8 : null;
    for (const day of days) {
      const input = { team, players: state.players, map, day, intel, styleCounter, chokeMod, patchMeta: mi === 1 ? PATCH : undefined };
      const s = computeSide(input);
      sides.push({
        team: team.id, map: map.id, day, intel, styleCounter, chokeMod, patch: mi === 1 ? 'sample' : null,
        out: {
          teamId: s.teamId,
          base: hex64(s.base), atk: hex64(s.atk), def: hex64(s.def), mid: hex64(s.mid),
          edge: {
            base: hex64(s.edge.base), igl: hex64(s.edge.igl), chem: hex64(s.edge.chem), coach: hex64(s.edge.coach),
            meta: hex64(s.edge.meta), map: hex64(s.edge.map), prep: hex64(s.edge.prep),
            familiarity: hex64(s.edge.familiarity), shortHanded: hex64(s.edge.shortHanded),
            aim: hex64(s.edge.aim), awareness: hex64(s.edge.awareness), mapTactics: hex64(s.edge.mapTactics),
          },
          lineup: s.lineup.map((p) => p.id),
          agents: Object.entries(s.agents),
          iglAttr: hex64(s.iglAttr), clutchAvg: hex64(s.clutchAvg),
        },
      });
    }
  }
}

// 有效能力向量（前 24 名选手 × 3 天）
const players = Object.values(state.players).slice(0, 24);
const eff = players.flatMap((p) => days.map((d) => ({ id: p.id, day: d, v: hex64(effectiveOverall(p, d)) })));

// 风格向量
const styleVec = [];
for (let i = 0; i <= 10; i++) {
  const aggr = i / 10;
  styleVec.push({ aggr: hex64(aggr), style: styleOf(aggr) });
}
const counterVec = ['rush', 'aggro', 'balanced', 'methodical', 'lockdown'].flatMap((a) =>
  ['rush', 'aggro', 'balanced', 'methodical', 'lockdown'].map((b) => ({ a, b, v: styleCounterOf(a, b) })));

const out = {
  meta: { generator: 'ace/tools/golden-strength.mjs', node: process.version, authority: 'ace/src/core/sim/strength.ts' },
  constants: { roundBaseScale: hex64(ROUND_BASE_SCALE), logisticK: hex64(LOGISTIC_K), swingSd: hex64(SWING_SD) },
  fitMatrix, dutyW, eff, styleVec, counterVec, sides,
};

mkdirSync('../kairo/Core.Tests/Golden', { recursive: true });
writeFileSync('../kairo/Core.Tests/Golden/strength.golden.json', JSON.stringify(out));
console.log(`strength golden written: ${sides.length} sides, ${fitMatrix.length} agents, ${eff.length} eff`);
