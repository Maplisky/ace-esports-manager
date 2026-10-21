/**
 * match 黄金轨迹记录器：完整比赛事件流（MatchRecord 全字段，浮点位型 hex）。
 * 世界夹具 generateWorld(42) + 我队设定（intel/patternUsage/fingerprint 预置）+ 15 个案例
 * （seed × bo × mapLock × agentLock × interventions × difficulty）。运行：node tools/golden-match.mjs（ace/ 下）
 */
import { generateWorld } from '../src/core/worldgen.ts';
import { simMatch, recordPatternFingerprint } from '../src/core/sim/match.ts';
import { addIntel } from '../src/core/sim/intel.ts';
import { writeFileSync, mkdirSync } from 'node:fs';

const hex64 = (x) => {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  return dv.getBigUint64(0).toString(16).padStart(16, '0');
};

const state = generateWorld(42);
const teams = Object.values(state.teams);
state.myTeamId = teams[0].id;
addIntel(state, teams[1].id, 10);
addIntel(state, teams[2].id, 6);
state.styleCounter ??= {};
state.styleCounter['rush'] = 5;
state.patchNotes.push({ version: 'test-1.0', changes: [{ agentId: 'jett', meta: 1.08, dir: 'buff', pct: 8 }, { agentId: 'omen', meta: 0.92, dir: 'nerf', pct: 8 }], mapNotes: {} });
recordPatternFingerprint(state, teams[0].id, 'ascent');
teams[0].patternUsage['ascent'] = 3;

const cases = [
  { seed: 777, bo: 3, a: 0, b: 1 },
  { seed: 42, bo: 3, a: 2, b: 3 },
  { seed: 7, bo: 1, a: 0, b: 4, mapLock: ['ascent'] },
  {
    seed: 123, bo: 3, a: 0, b: 5,
    agentLock: { ascent: { A1: 'jett', A2: 'sova', A3: 'omen', A4: 'sage', A5: 'raze' } },
    interventions: [{ map: 0, round: 3, tactic: 'def:sentinelTunnel' }, { map: 0, round: 8, tactic: 'atk:ultRush', igl: true }],
  },
  { seed: 555, bo: 5, a: 1, b: 2, difficulty: 'pro' },
];

const hex12 = (e) => ({
  base: hex64(e.base), igl: hex64(e.igl), chem: hex64(e.chem), coach: hex64(e.coach),
  meta: hex64(e.meta), map: hex64(e.map), prep: hex64(e.prep), familiarity: hex64(e.familiarity),
  shortHanded: hex64(e.shortHanded), aim: hex64(e.aim), awareness: hex64(e.awareness), mapTactics: hex64(e.mapTactics),
});
const dumpLine = (l) => ({
  kills: l.kills, deaths: l.deaths, assists: l.assists, firstKills: l.firstKills, firstDeaths: l.firstDeaths,
  clutches: l.clutches, damage: hex64(l.damage), rounds: l.rounds, acs: l.acs,
});
const dumpEvent = (e) => ({
  t: e.t, s: e.s ?? null, v: e.v ?? null, first: e.first ?? null, vs: e.vs ?? null, tier: e.tier ?? null,
  side: e.side ?? null, dmg: e.dmg != null ? hex64(e.dmg) : null, player: e.player ?? null, tactic: e.tactic ?? null, igl: e.igl ?? null,
});
const dumpRound = (r) => ({
  n: r.n, atk: r.atk, buyA: r.buys.A, buyB: r.buys.B, tacticAtk: r.tacticAtk ?? null, tacticDef: r.tacticDef ?? null,
  events: r.events.map(dumpEvent),
  end: {
    win: r.end.win, how: r.end.how, aliveA: r.end.alive.A, aliveB: r.end.alive.B,
    scoreA: r.end.score[0], scoreB: r.end.score[1],
    assists: r.end.assists ?? [],
    dmgBonus: Object.entries(r.end.dmgBonus ?? {}).map(([pid, v]) => ({ pid, v: hex64(v) })),
    ults: Object.entries(r.end.ults ?? {}),
    money: r.end.money ? { A: r.end.money.A, B: r.end.money.B } : null,
    timeouts: r.end.timeouts ? { A: r.end.timeouts.A, B: r.end.timeouts.B } : null,
  },
});
const dumpMap = (m) => ({
  map: m.map, scoreA: m.score[0], scoreB: m.score[1], rounds: m.rounds.map(dumpRound),
  lines: Object.entries(m.lines).map(([pid, l]) => ({ pid, ...dumpLine(l) })),
  mvp: m.mvp ?? null,
  agents: Object.entries(m.agents),
  edges: { A: hex12(m.edges.A), B: hex12(m.edges.B) },
  readings: m.readings ?? null,
});
const dumpMatch = (rec) => ({
  id: rec.id, seed: rec.seed, format: rec.format, teamA: rec.teamA, teamB: rec.teamB, stage: rec.stage, day: rec.day,
  scoreA: rec.score[0], scoreB: rec.score[1], winner: rec.winner, mvp: rec.mvp ?? null,
  interventions: rec.interventions ?? null,
  maps: rec.maps.map(dumpMap),
});

const records = cases.map((c, i) => {
  const rec = simMatch(state, teams[c.a].id, teams[c.b].id, c.bo, c.seed, `M${i}`, c.mapLock, c.agentLock, c.interventions);
  return { case: { ...c, teamAId: teams[c.a].id, teamBId: teams[c.b].id }, rec: dumpMatch(rec) };
});

const out = {
  meta: { generator: 'ace/tools/golden-match.mjs', authority: 'ace/src/core/sim/match.ts' },
  records,
};

mkdirSync('../kairo/Core.Tests/Golden', { recursive: true });
writeFileSync('../kairo/Core.Tests/Golden/match.golden.json', JSON.stringify(out));
console.log(`match golden written: ${records.length} records, ${records.reduce((s, r) => s + r.rec.maps.length, 0)} maps`);
