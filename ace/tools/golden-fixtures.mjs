/**
 * fixtures 黄金轨迹记录器：联赛（奇偶队数）/ 揭幕杯树 / 瑞士轮配对（避同赛区重赛）/ 双败树 / 回填。
 * 运行：node tools/golden-fixtures.mjs（ace/ 下）
 */
import { buildLeague, buildCup, buildSwissRound, buildDoubleElim, pairSwissRound, fillNextSlot, resetFixtureSeq } from '../src/core/sim/fixtures.ts';
import { Rng } from '../src/core/rng.ts';
import { writeFileSync, mkdirSync } from 'node:fs';

const dump = (fixtures) => fixtures.map((f) => ({
  id: f.id, day: f.day, stage: f.stage, comp: f.comp, teamA: f.teamA, teamB: f.teamB,
  bo: f.bo, label: f.label, nextFixtureId: f.nextFixtureId ?? null, nextLoserFixtureId: f.nextLoserFixtureId ?? null,
  winnerTeamId: f.winnerTeamId ?? null,
}));

const out = { meta: { generator: 'ace/tools/golden-fixtures.mjs', authority: 'ace/src/core/sim/fixtures.ts' }, cases: [] };

// 联赛：奇数 5 队 + 偶数 6 队，双循环
{
  resetFixtureSeq();
  const fx = [];
  buildLeague(fx, { comp: 'L5', name: '五队联赛', stage: 'stage1', teamIds: ['t1', 't2', 't3', 't4', 't5'], startDay: 55, endDay: 122, bo: 3, rng: new Rng(11) });
  buildLeague(fx, { comp: 'L6', name: '六队联赛', stage: 'stage1', teamIds: ['t1', 't2', 't3', 't4', 't5', 't6'], startDay: 55, endDay: 122, bo: 3, rng: new Rng(12) });
  out.cases.push({ name: 'league', fixtures: dump(fx) });
}

// 杯赛树 + 回填（QF 胜者进 SF）
{
  resetFixtureSeq();
  const fx = [];
  const rounds = buildCup(fx, { comp: 'cup', name: '揭幕杯', stage: 'cup', teamIds: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8'], startDay: 26, gapDays: 8, bo: 3, rng: new Rng(21) });
  // 回填：QF[0] 胜 c1、QF[1] 胜 c3、QF[2] 胜 c5、QF[3] 胜 c7
  fillNextSlot(fx, fx[0], 'c1');
  fillNextSlot(fx, fx[1], 'c3');
  fillNextSlot(fx, fx[2], 'c5');
  fillNextSlot(fx, fx[3], 'c7');
  fillNextSlot(fx, fx[4], 'c1');
  out.cases.push({ name: 'cup', fixtures: dump(fx), roundFixtureIds: rounds.roundFixtureIds });
}

// 瑞士轮配对：2-0 / 1-1 / 0-2 梯队 + 避同赛区 + 避重赛
{
  const entries = [
    { teamId: 'w1', wins: 2, losses: 0 }, { teamId: 'w2', wins: 2, losses: 0 },
    { teamId: 'm1', wins: 1, losses: 1 }, { teamId: 'm2', wins: 1, losses: 1 },
    { teamId: 'm3', wins: 1, losses: 1 }, { teamId: 'm4', wins: 1, losses: 1 },
    { teamId: 'l1', wins: 0, losses: 2 }, { teamId: 'l2', wins: 0, losses: 2 },
  ];
  const regionOf = (id) => (id === 'w1' || id === 'm1' || id === 'l1' ? 'americas' : 'emea');
  const pairs1 = pairSwissRound(entries, regionOf, new Set());
  const played = new Set(pairs1.map(([a, b]) => (a < b ? `${a}|${b}` : `${b}|${a}`)));
  const pairs2 = pairSwissRound(entries, regionOf, played);
  resetFixtureSeq();
  const fx = [];
  buildSwissRound(fx, { comp: 'masters', name: 'Masters', stage: 'masters', pairs: pairs1, day: 130, roundNo: 1, bo: 3 });
  out.cases.push({ name: 'swiss', fixtures: dump(fx), pairs1, pairs2 });
}

// 双败树
{
  resetFixtureSeq();
  const fx = [];
  const rounds = buildDoubleElim(fx, { comp: 'masters', name: 'Masters', stage: 'masters', pairs: [['s1', 's2'], ['s3', 's4'], ['d1', 'd2'], ['d3', 'd4']], startDay: 150, gapDays: 3, bo: 3 });
  out.cases.push({ name: 'doubleElim', fixtures: dump(fx), roundFixtureIds: rounds.roundFixtureIds });
}

mkdirSync('../kairo/Core.Tests/Golden', { recursive: true });
writeFileSync('../kairo/Core.Tests/Golden/fixtures.golden.json', JSON.stringify(out));
console.log(`fixtures golden written: ${out.cases.map((c) => `${c.name}:${c.fixtures.length}`).join(', ')}`);
