/**
 * matchstats 黄金轨迹记录器：Rng(999) 生成确定性合成比赛夹具（2 图 × 12-9 回合 × 击杀事件流），
 * 覆盖 liveAcs/liveLines（多探针位置）/liveMeta/summarizeMatch/pickMvps。运行：node tools/golden-matchstats.mjs（ace/ 下）
 */
import { liveAcs, liveLines, liveMeta, summarizeMatch, pickMvps } from '../src/core/sim/matchstats.ts';
import { Rng } from '../src/core/rng.ts';
import { writeFileSync, mkdirSync } from 'node:fs';

const SEED = 999;
const PIDS = ['A1', 'A2', 'A3', 'A4', 'A5', 'B1', 'B2', 'B3', 'B4', 'B5'];
const MAP_NAMES = ['ascent', 'haven'];
const ROUND_COUNTS = [12, 9];
const HOWS = ['elim', 'spike', 'defuse', 'time'];
const TIERS = ['core', 'harvest', 'combo'];
const TACTICS = ['default', 'fast', 'slow', 'stack'];

const buildFixture = (seed) => {
  const rng = new Rng(seed);
  return MAP_NAMES.map((mapName, mi) => {
    const total = ROUND_COUNTS[mi];
    let scoreA = 0, scoreB = 0;
    const rounds = [];
    for (let ri = 0; ri < total; ri++) {
      const atk = (ri % 2 === 0) ? 'A' : 'B';
      const winner = rng.chance(0.55) ? 'A' : 'B';
      if (winner === 'A') scoreA++; else scoreB++;
      const killCount = rng.int(3, 6);
      const alive = { A: 0, B: 0 };
      const dead = new Set();
      const events = [];
      for (let ei = 0; ei < killCount; ei++) {
        const side = rng.chance(0.5) ? 'A' : 'B';
        const pool = PIDS.filter((p) => p[0] === side && !dead.has(p));
        const victims = PIDS.filter((p) => p[0] !== side && !dead.has(p));
        if (pool.length === 0 || victims.length === 0) break;
        const s = rng.pick(pool);
        const v = rng.pick(victims);
        dead.add(v);
        const e = { t: 'kill', s, v, first: ei === 0, dmg: rng.chance(0.7) ? rng.int(80, 300) : undefined };
        if (rng.chance(0.25)) e.vs = rng.int(1, 3);
        events.push(e);
      }
      for (const side of ['A', 'B']) {
        let aliveN = 0;
        for (const p of PIDS) if (p[0] === side && !dead.has(p)) aliveN++;
        alive[side] = aliveN;
      }
      // 尾奏事件
      if (rng.chance(0.4)) events.push({ t: 'plant', s: rng.pick(PIDS.filter((p) => p[0] === atk)), side: atk });
      if (rng.chance(0.3)) events.push({ t: 'ultReady', tier: rng.pick(TIERS), side: rng.chance(0.5) ? 'A' : 'B' });
      if (rng.chance(0.2)) events.push({ t: 'clutch', s: rng.pick(PIDS), vs: rng.int(1, 3), side: winner });
      const dmgBonus = {};
      const nBonus = rng.int(0, 3);
      for (let b = 0; b < nBonus; b++) {
        const pid = rng.pick(PIDS);
        dmgBonus[pid] = (dmgBonus[pid] ?? 0) + rng.int(10, 150);
      }
      const assists = PIDS.filter((p) => rng.chance(0.15));
      const ults = {};
      for (const p of PIDS) ults[p] = rng.int(0, 7);
      rounds.push({
        n: ri + 1,
        atk,
        buys: { A: rng.pick(['full', 'force', 'eco']), B: rng.pick(['full', 'force', 'eco']) },
        tacticAtk: rng.pick(TACTICS),
        tacticDef: rng.pick(TACTICS),
        events,
        end: {
          win: winner,
          how: rng.pick(HOWS),
          alive,
          score: [scoreA, scoreB],
          assists,
          dmgBonus,
          ults,
          money: { A: rng.int(500, 60000), B: rng.int(500, 60000) },
          timeouts: { A: rng.int(0, 2), B: rng.int(0, 2) },
        },
      });
    }
    // 赛后 lines（与 rounds 事件弱一致即可：合成口径，测试只比对面板函数）
    const lines = {};
    for (const pid of PIDS) {
      lines[pid] = {
        kills: rng.int(5, 30), deaths: rng.int(5, 25), assists: rng.int(0, 12),
        firstKills: rng.int(0, 6), firstDeaths: rng.int(0, 5), clutches: rng.int(0, 3),
        damage: rng.int(1000, 5000), rounds: rng.int(15, 25),
        acs: rng.int(120, 320),
      };
    }
    return {
      map: mapName, score: [scoreA, scoreB], rounds, lines, mvp: null,
      agents: Object.fromEntries(PIDS.map((p) => [p, rng.pick(['jett', 'sova', 'omen', 'sage'])])),
      edges: { A: {}, B: {} },
    };
  });
};

const maps = buildFixture(SEED);
const teamAPids = new Set(PIDS.filter((p) => p[0] === 'A'));

// 探针位置：起点/中段/回合中/回合尾/图尾/越界
const probes = [
  { mi: 0, ri: 0, ei: 0 },
  { mi: 0, ri: 0, ei: 2 },
  { mi: 0, ri: 3, ei: 4 },
  { mi: 0, ri: 5, ei: 999 },
  { mi: 0, ri: 11, ei: 1 },
  { mi: 1, ri: 0, ei: 3 },
  { mi: 1, ri: 4, ei: 2 },
  { mi: 1, ri: 8, ei: 999 },
  { mi: 2, ri: 0, ei: 0 },
];

const acsVec = [];
for (const [dmg, rounds] of [[0, 0], [100, 10], [2345, 13], [999, 3], [1, 1], [4321, 21]]) {
  acsVec.push({ dmg, rounds, r: liveAcs(dmg, rounds) });
}

const liveOut = probes.map((upTo) => {
  const lines = liveLines(maps, upTo);
  const meta = liveMeta(maps, upTo);
  return {
    upTo,
    rounds: lines.rounds,
    lines: Object.entries(lines.lines).map(([pid, l]) => ({ pid, k: l.k, d: l.d, a: l.a, fk: l.fk, dmg: l.dmg })),
    ults: Object.entries(meta.ults),
    money: meta.money,
  };
});

const summary = summarizeMatch(maps, teamAPids);
const mvps = pickMvps(summary, 'A');

const out = {
  meta: { generator: 'ace/tools/golden-matchstats.mjs', seed: SEED, authority: 'ace/src/core/sim/matchstats.ts' },
  acsVec,
  liveOut,
  summary,
  mvps,
};

mkdirSync('../kairo/Core.Tests/Golden', { recursive: true });
writeFileSync('../kairo/Core.Tests/Golden/matchstats.golden.json', JSON.stringify(out));
console.log(`matchstats golden written: ${liveOut.length} probes, ${summary.length} statrows`);
