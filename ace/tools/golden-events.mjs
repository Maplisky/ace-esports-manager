/**
 * events + finance 黄金轨迹记录器：多日抽取（正常/保底/Deadline/抑制器）+ 结算 + 生日 + 财务窗口。
 * 世界夹具 generateWorld(42)，myTeam 设为第 3 队（有真实 roster）。运行：node tools/golden-events.mjs（ace/ 下）
 */
import { generateWorld, resetPlayerSeq } from '../src/core/worldgen.ts';
import { spawnDailyEvents, spawnBirthdays, resolveEvent } from '../src/core/sim/events.ts';
import { logFinance, financeWindow, financeBreakdown, cashFlowForecast } from '../src/core/sim/finance.ts';
import { Rng } from '../src/core/rng.ts';
import { writeFileSync, mkdirSync } from 'node:fs';

const hex64 = (x) => {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  return dv.getBigUint64(0).toString(16).padStart(16, '0');
};

const buildState = (seed) => {
  resetPlayerSeq(); // 每个 case 独立干净世界（与 C# resetSeq:true 对齐）
  const state = generateWorld(seed);
  state.myTeamId = Object.values(state.teams)[2].id;
  return state;
};

const dumpCard = (c) => ({
  uid: c.uid, cardId: c.cardId, title: c.title, text: c.text, negative: c.negative,
  targetPlayerId: c.targetPlayerId ?? null, day: c.day,
  options: c.options.map((o) => ({
    label: o.label, result: o.result, morale: o.morale ?? null, teamMorale: o.teamMorale ?? null,
    budget: o.budget ?? null, reputation: o.reputation ?? null, trust: o.trust ?? null,
    grievance: o.grievance ?? null, fatigue: o.fatigue ?? null, bond: o.bond ?? null, boardConfidence: o.boardConfidence ?? null,
  })),
});

const out = { meta: { generator: 'ace/tools/golden-events.mjs', authority: 'ace/src/core/sim/events.ts + finance.ts' }, cases: [] };

// 场景 1：常规推进 12 天（抽取/结算轮替）
{
  const state = buildState(42);
  const rng = new Rng(555);
  const trace = [];
  for (let d = 0; d < 12; d++) {
    state.day = 5 + d * 2;
    spawnDailyEvents(state, rng);
    spawnBirthdays(state);
    while (state.pendingEvents.length > 0) {
      const card = state.pendingEvents[0];
      const r = resolveEvent(state, card.uid, 0, rng);
      trace.push({ day: state.day, resolved: card.uid, result: r ? r.result : null });
    }
    trace.push({ day: state.day, queue: state.pendingEvents.length, budget: state.teams[state.myTeamId].budget, lastEventDay: state.lastEventDay });
  }
  out.cases.push({
    name: 'regular',
    trace,
    pending: state.pendingEvents.map(dumpCard),
    finLog: state.finances.log.map((e) => ({ day: e.day, label: e.label, amount: e.amount })),
  });
}

// 场景 2：Deadline Day（day 152）+ 保底（空 8 天）+ 抑制器（预置 lastEventDay）
{
  const state = buildState(42);
  const rng = new Rng(777);
  const myTeam = state.teams[state.myTeamId];
  const trace = [];
  // 保底场景：day 1 抽卡后跳 8 天
  state.day = 10;
  spawnDailyEvents(state, rng);
  trace.push({ tag: 'starved-day10', queue: state.pendingEvents.length, lastEventDay: state.lastEventDay });
  state.day = 19;
  spawnDailyEvents(state, rng);
  trace.push({ tag: 'starved-day19', queue: state.pendingEvents.length });
  // Deadline：day 150-152 连抽
  state.day = 150;
  state.pendingEvents.length = 0;
  for (const d of [150, 151, 152]) {
    state.day = d;
    spawnDailyEvents(state, rng);
    trace.push({ tag: `deadline-${d}`, uids: state.pendingEvents.map((c) => c.uid) });
  }
  // 抑制器：负面卡结算后 14 天内只来正面
  while (state.pendingEvents.length > 0) {
    const card = state.pendingEvents[0];
    if (card.negative) {
      state.day += 1;
    }
    resolveEvent(state, card.uid, 0, rng);
  }
  const negTargets = state.players;
  out.cases.push({ name: 'deadline-starve-suppress', trace, pending: state.pendingEvents.map(dumpCard) });
}

// 场景 3：财务窗口（预算 500 万 + 混合流水 40 天）
{
  const state = buildState(42);
  state.myTeamId = Object.values(state.teams)[2].id;
  const team = state.teams[state.myTeamId];
  team.budget = 5_000_000;
  state.day = 100;
  const labels = [
    ['事件 · 品牌广告拍摄', 8000], ['商务 · 赞助结算', 120000], ['转会 · 签字费', -450000],
    ['事件 · 设备故障', -1500], ['解约 · 补偿', -80000], ['选秀权 · 交易', 60000],
    ['事件 · 生日礼物', -2500], ['商务 · 直播分成', 30000], ['other · 杂项', -5000],
  ];
  for (let i = 0; i < labels.length; i++) {
    state.day = 70 + i * 3;
    logFinance(state, labels[i][0], labels[i][1]);
  }
  state.day = 100;
  const win = financeWindow(state, 30);
  const w30 = {
    start: win.start, end: win.end,
    entries: win.entries.map((e) => ({ day: e.day, label: e.label, amount: e.amount, cat: e.cat })),
    steps: win.steps.map((s) => ({ day: s.day, balance: s.balance, label: s.label, amount: s.amount })),
  };
  const breakdown = financeBreakdown(win.entries);
  const forecast = cashFlowForecast(state, 7);
  out.cases.push({
    name: 'finance',
    w30,
    breakdown: breakdown.map((b) => ({ cat: b.cat, income: b.income, expense: b.expense })),
    forecast: forecast ? { perDay: hex64(forecast.perDay), week: forecast.week } : null,
  });
}

mkdirSync('../kairo/Core.Tests/Golden', { recursive: true });
writeFileSync('../kairo/Core.Tests/Golden/events.golden.json', JSON.stringify(out));
console.log(`events golden written: ${out.cases.length} cases`);
