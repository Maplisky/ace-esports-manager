/**
 * rumors 黄金轨迹记录器（工程化夹具覆盖全路径）：
 * 窗外 3 周囤绯闻 → 窗内 5 周升级链（c1→c2→c3→分晓）；弱队塞强将触发 wants 挂牌；豪门减员满足成交条件。
 * 运行：node tools/golden-rumors.mjs（ace/ 下）
 */
import { generateWorld, resetPlayerSeq } from '../src/core/worldgen.ts';
import { weeklyRumors } from '../src/core/sim/rumors.ts';
import { Rng } from '../src/core/rng.ts';
import { writeFileSync, mkdirSync } from 'node:fs';

const state = generateWorld(42);
const teams = Object.values(state.teams);
state.myTeamId = teams[0].id; // 我队不参与 AI 互挖

const movePlayer = (pid, toTeam) => {
  const p = state.players[pid];
  const from = state.teams[p.teamId];
  from.roster = from.roster.filter((x) => x !== pid);
  from.starters = from.starters.filter((x) => x !== pid);
  p.teamId = toTeam.id;
  toTeam.roster.push(pid);
};

// 弱队捏造战绩：teams[5..8] 各 6 连败（w+l≥6 且胜率<50%）
for (let i = 5; i < 9; i++) {
  const t = teams[i];
  for (let g = 0; g < 6; g++) {
    state.fixtures.push({
      id: `FX_diag_${t.id}_${g}`, day: 60 + g, stage: 'stage1', comp: 'diag', teamA: t.id,
      teamB: teams[(i + 1) % teams.length].id, bo: 3, label: 'diag', played: true,
      winnerTeamId: teams[(i + 1) % teams.length].id,
    });
  }
}
// 强将塞进弱队（overall≥83、morale 40 → wants 触发条件全满足）
const candidates = Object.values(state.players).filter((p) => p.teamId && p.teamId !== teams[0].id && !p.listed);
for (let i = 0; i < 4; i++) {
  const p = candidates[i * 7];
  p.overall = 85;
  p.morale = 40;
  p.contractYears = 2;
  movePlayer(p.id, teams[5 + i]);
}
// 豪门：reputation 90 + 预算 800 万 + 减员（roster<7 满足成交名单条件）
teams[3].reputation = 90;
teams[3].budget = 8_000_000;
const overflow = teams[3].roster.pop();
if (overflow) state.players[overflow].teamId = null;

const dumpFeed = (f) => ({
  day: f.day, year: f.year, kind: f.kind, c: f.c ?? null, toTeamId: f.toTeamId ?? null,
  playerId: f.playerId ?? null, text: f.text,
});

const runScenario = (seed) => {
  resetPlayerSeq(); // 每场景独立干净世界（与 C# resetSeq:true 对齐）
  const state = generateWorld(42);
  const teams = Object.values(state.teams);
  state.myTeamId = teams[0].id;

  const movePlayer = (pid, toTeam) => {
    const p = state.players[pid];
    const from = state.teams[p.teamId];
    from.roster = from.roster.filter((x) => x !== pid);
    from.starters = from.starters.filter((x) => x !== pid);
    p.teamId = toTeam.id;
    toTeam.roster.push(pid);
  };
  for (let i = 5; i < 9; i++) {
    const t = teams[i];
    for (let g = 0; g < 6; g++) {
      state.fixtures.push({
        id: `FX_diag_${t.id}_${g}`, day: 60 + g, stage: 'stage1', comp: 'diag', teamA: t.id,
        teamB: teams[(i + 1) % teams.length].id, bo: 3, label: 'diag', played: true,
        winnerTeamId: teams[(i + 1) % teams.length].id,
      });
    }
  }
  const candidates = Object.values(state.players).filter((p) => p.teamId && p.teamId !== teams[0].id && !p.listed);
  for (let i = 0; i < 4; i++) {
    const p = candidates[i * 7];
    p.overall = 85;
    p.morale = 40;
    p.contractYears = 2;
    movePlayer(p.id, teams[5 + i]);
  }
  teams[3].reputation = 90;
  teams[3].budget = 8_000_000;
  const overflow = teams[3].roster.pop();
  if (overflow) state.players[overflow].teamId = null;
  // 唯一买家：其余队 reputation 压到 70 以下（strongTeams 只剩 teams[3]，roster 6<7 恒满足成交条件）
  for (let i = 0; i < teams.length; i++) {
    if (i === 0 || i === 3 || (i >= 5 && i <= 8)) continue;
    teams[i].reputation = Math.min(teams[i].reputation, 65);
  }
  for (let i = 5; i < 9; i++) teams[i].reputation = 50;

  const weeks = [];
  const rng = new Rng(seed);
  const runWeek = (day, tag) => {
    state.day = day;
    const notes = [];
    weeklyRumors(state, rng, notes);
    weeks.push({
      tag,
      day: state.day,
      notes: notes.map((n) => ({ day: n.day, kind: n.kind, text: n.text })),
      feed: state.transferFeed.map(dumpFeed),
      listed: Object.values(state.players).filter((p) => p.listed).map((p) => p.id),
    });
  };
  for (const day of [100, 107, 114]) runWeek(day, `pre-${day}`, rng);
  for (const day of [123, 128, 133, 138, 143, 148, 151]) runWeek(day, `win-${day}`, rng);

  return {
    seed,
    weeks,
    budgets: teams.slice(0, 10).map((t) => ({ id: t.id, budget: t.budget, reputation: t.reputation })),
    finLog: state.finances.log.map((e) => ({ day: e.day, label: e.label, amount: e.amount })),
  };
};

const out = {
  meta: { generator: 'ace/tools/golden-rumors.mjs', authority: 'ace/src/core/sim/rumors.ts' },
  cases: [888, 889, 890, 891].map(runScenario),
};

mkdirSync('../kairo/Core.Tests/Golden', { recursive: true });
writeFileSync('../kairo/Core.Tests/Golden/rumors.golden.json', JSON.stringify(out));
for (const c of out.cases) {
  const kinds = {};
  for (const w of c.weeks) for (const f of w.feed) kinds[f.kind + (f.c ? ':' + f.c : '')] = (kinds[f.kind + (f.c ? ':' + f.c : '')] || 0) + 1;
  console.log(`seed ${c.seed}: kinds=${JSON.stringify(kinds)}`);
}
