/**
 * draft 黄金轨迹记录器：选秀日全流程（我队多签多卡 + AI 需求×潜力选人 + 满员弃权 + 落选入池）
 * + 选秀卡结算 + 签位交易（卖出/买进/上限）。运行：node tools/golden-draft.mjs（ace/ 下）
 */
import { generateWorld, resetPlayerSeq } from '../src/core/worldgen.ts';
import { runDraft, resolveDraftCard, draftPickValue, draftPickInfo, draftPickTrade, resolveDraftSlots } from '../src/core/sim/draft.ts';
import { writeFileSync, mkdirSync } from 'node:fs';

const buildState = () => {
  resetPlayerSeq(); // 每案例独立干净世界（与 C# resetSeq 对齐）
  const s = generateWorld(42);
  s.myTeamId = Object.values(s.teams)[0].id; // 我队 = T2355（t1 首位）
  return s;
};

const dumpCard = (c) => ({
  uid: c.uid, cardId: c.cardId, title: c.title, negative: c.negative, day: c.day,
  options: c.options.map((o) => ({ label: o.label, result: o.result })),
  payload: { pickNo: c.payload?.pickNo ?? null, playerIds: c.payload?.playerIds ?? null },
});

const out = { meta: { generator: 'ace/tools/golden-draft.mjs', authority: 'ace/src/core/sim/draft.ts' }, cases: {} };

// ① 选秀日主流程（我队 t1 多签卡；AI 选人）
{
  const state = buildState();
  const notes = [];
  runDraft(state, notes);
  const ld = state.lastDraft;
  out.cases.runDraft = {
    notes: notes.map((n) => ({ text: n.text, important: n.important ?? null })),
    picks: ld.picks.map((p) => ({ pickNo: p.pickNo, teamId: p.teamId, playerId: p.playerId })),
    myCards: state.pendingEvents.map(dumpCard),
    rookies: state.pendingEvents.length === 0 ? [] : state.pendingEvents[0].payload.playerIds.map((pid) => {
      const p = state.players[pid];
      return { pid, overall: p.overall, potential: p.potential, age: p.age, salary: p.salary, teamId: p.teamId };
    }),
  };
}

// ② 选秀卡结算：7 选 1（选第 3 项）+ 补记留档
{
  const state = buildState();
  const notes = [];
  runDraft(state, notes);
  const card = state.pendingEvents[0];
  const r = resolveDraftCard(state, card, 2);
  out.cases.resolveCard = { r, rowFilled: state.lastDraft.picks.find((x) => x.teamId === state.myTeamId && x.playerId) ?? null };
}

// ③ 选秀卡结算：放弃（冻结新秀回池 → teamId 全 null）
{
  const state = buildState();
  const notes = [];
  runDraft(state, notes);
  const card = state.pendingEvents[0];
  const frozen = card.payload.playerIds;
  const r = resolveDraftCard(state, card, 7); // 放弃项
  out.cases.resolveDecline = {
    r,
    frozenFree: frozen.every((pid) => state.players[pid].teamId === null),
  };
}

// ④ 签位交易：卖出 + 买进 + 上限 + 行情
{
  const state = buildState();
  state.day = 150; // 窗内
  const my = state.teams[state.myTeamId];
  my.budget = 2_000_000;
  const notes = [];
  const info0 = draftPickInfo(state);
  const sell1 = draftPickTrade(state, 'sell', notes);
  const sell2 = draftPickTrade(state, 'sell', notes);
  const info1 = draftPickInfo(state);
  const buy1 = draftPickTrade(state, 'buy', notes);
  const slots = resolveDraftSlots(state);
  out.cases.trade = {
    value1: draftPickValue(1), value5: draftPickValue(5),
    info0: { mySlots: info0.mySlots, myProjected: info0.myProjected, sellPrice: info0.sellPrice, buyOffer: info0.buyOffer ? { teamId: info0.buyOffer.teamId, slotNo: info0.buyOffer.slotNo, price: info0.buyOffer.price } : null, windowOpen: info0.windowOpen },
    sell1, sell2, info1: { mySlots: info1.mySlots, sellPrice: info1.sellPrice },
    buy1, slotsAfter: slots,
    budgets: [my.budget, state.teams[info0.buyOffer.teamId].budget],
    finLog: state.finances.log.map((e) => ({ day: e.day, label: e.label, amount: e.amount })),
    notes: notes.map((n) => ({ text: n.text })),
  };
}

mkdirSync('../kairo/Core.Tests/Golden', { recursive: true });
writeFileSync('../kairo/Core.Tests/Golden/draft.golden.json', JSON.stringify(out));
console.log(`draft golden written: ${Object.keys(out.cases).length} cases, picks=${out.cases.runDraft.picks.length}`);
