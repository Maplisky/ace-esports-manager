/**
 * worldgen 黄金轨迹记录器：固定 seed 生成完整世界 → 规范序列化（创建序数组 + IEEE754 位型 hex）。
 * C# 侧 (kairo/Core.Tests) 重新生成并逐项比对。运行：node tools/golden-worldgen.mjs（在 ace/ 下）
 */
import { generateWorld, salaryFor, computeOverall, resetPlayerSeq } from '../src/core/worldgen.ts';
import { writeFileSync, mkdirSync } from 'node:fs';

const hex64 = (x) => {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  return dv.getBigUint64(0).toString(16).padStart(16, '0');
};

const SEEDS = [1, 42, 2026, 0xdeadbeef];

// salaryFor / computeOverall 向量（detPowInt 与 overall 合成的独立校验）
const salary = [];
for (let o = 30; o <= 99; o += 3) for (const tier of [1, 2]) salary.push({ o, tier, r: salaryFor(o, tier) });
const overallVec = [];
for (let base = 40; base <= 90; base += 5) {
  const attrs = { aim: base, reaction: base - 5, awareness: base + 3, utility: base - 2, clutch: base + 1, teamwork: base - 1, communication: base + 4, igl: base - 8 };
  overallVec.push({ in: attrs, r: computeOverall(attrs) });
}

const dumpAttrs = (a) => ({ aim: hex64(a.aim), reaction: hex64(a.reaction), awareness: hex64(a.awareness), utility: hex64(a.utility), clutch: hex64(a.clutch), teamwork: hex64(a.teamwork), communication: hex64(a.communication), igl: hex64(a.igl) });

const dumpPlayer = (p) => ({
  id: p.id, ign: p.ign, realName: p.realName ?? null, country: p.country ?? null, avatar: p.avatar ?? null,
  synthetic: p.synthetic ?? null, age: p.age, teamId: p.teamId, attrs: dumpAttrs(p.attrs),
  overall: p.overall, potential: p.potential, peakOverall: p.peakOverall, form: p.form, morale: p.morale,
  fatigue: p.fatigue, salary: p.salary, contractYears: p.contractYears,
  agentPool: p.agentPool, agentPro: Object.entries(p.agentPro), isIgl: p.isIgl,
  focus: p.focus, listed: p.listed, releaseClause: p.releaseClause, noPoach: p.noPoach,
  traits: p.traits ?? null, promisedRole: p.promisedRole, homegrown: p.homegrown,
  birthdayDay: p.birthdayDay, ambition: p.ambition ?? null,
  career: { ...p.career },
});

const dumpTeam = (t) => ({
  id: t.id, name: t.name, tag: t.tag, tier: t.tier, regionId: t.regionId, vlrId: t.vlrId ?? null, logo: t.logo ?? null,
  roster: t.roster, starters: t.starters,
  coach: { name: t.coach.name, tactics: t.coach.tactics, development: t.coach.development, motivation: t.coach.motivation },
  facilities: t.facilities, budget: t.budget, reputation: t.reputation, personality: t.personality,
  mapPref: Object.entries(t.mapPref), bond: t.bond,
  sponsors: t.sponsors.map((s) => ({ id: s.id, name: s.name, tier: s.tier, perSeason: s.perSeason, years: s.years, signedYear: s.signedYear })),
  staff: ['training', 'mapTactics', 'match'].filter((k) => t.staff[k]).map((k) => ({ k, name: t.staff[k].name, value: t.staff[k].value })),
  academy: t.academy,
});

const dumpWorld = (state) => ({
  seed: state.seed, year: state.year, day: state.day, stage: state.stage,
  teamSchedule: state.teamSchedule, trainingMaps: state.trainingMaps,
  boardConfidence: state.boardConfidence, actionPoints: state.actionPoints,
  teams: Object.values(state.teams).map(dumpTeam),   // 插入序（确定性红线之一）
  players: Object.values(state.players).map(dumpPlayer), // 创建序
});

const seeds = SEEDS.map((seed) => {
  resetPlayerSeq();
  return dumpWorld(generateWorld(seed));
});

const out = {
  meta: {
    generator: 'ace/tools/golden-worldgen.mjs',
    node: process.version,
    authority: 'ace/src/core/worldgen.ts',
    note: 'teams/players 为创建序；对象字段以 [k,v] 对保插入序；浮点位型 hex',
  },
  salary, overallVec, seeds,
};

mkdirSync('../kairo/Core.Tests/Golden', { recursive: true });
writeFileSync('../kairo/Core.Tests/Golden/worldgen.golden.json', JSON.stringify(out));
const counts = seeds.map((s) => `${s.seed}:${s.teams.length}t/${s.players.length}p`).join(', ');
console.log(`worldgen golden written: ${counts}`);
