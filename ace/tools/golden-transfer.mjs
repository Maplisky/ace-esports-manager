/**
 * transfer 黄金轨迹记录器：marketValue/salaryExpectation/evaluateOffer（侮辱线/解约金/noPoach/三正路）/
 * 谈判三轮/finalize/completeTransfer（含情报衰减+紧急补位）/releasePlayer/aiWeeklyTransfers 多周/askInquiry+resolveInquiries。
 * 运行：node tools/golden-transfer.mjs（ace/ 下）
 */
import { generateWorld } from '../src/core/worldgen.ts';
import {
  marketValue, salaryExpectation, evaluateOffer, startNegotiation, reNegotiate, finalizeOffer,
  completeTransfer, releasePlayer, aiWeeklyTransfers, askInquiry, resolveInquiries, graceRemain,
} from '../src/core/sim/transfer.ts';
import { Rng } from '../src/core/rng.ts';
import { writeFileSync, mkdirSync } from 'node:fs';

const hex64 = (x) => {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  return dv.getBigUint64(0).toString(16).padStart(16, '0');
};

const state = generateWorld(42);
const teams = Object.values(state.teams);
state.myTeamId = teams[0].id;
state.day = 130; // 窗内

// ① marketValue / salaryExpectation 矩阵（前 12 选手 × t1/t2）
const mvVec = [];
const pool = Object.values(state.players).slice(0, 12);
for (const p of pool) {
  mvVec.push({ id: p.id, mv1: marketValue(p, 1), mv2: marketValue(p, 2), se1: salaryExpectation(p, 1), se2: salaryExpectation(p, 2) });
}

// ② evaluateOffer 多档报价（对我队某选手）
const target = pool[0];
target.releaseClause = 0;
target.noPoach = false;
const buyer = teams[3];
const offerCases = [];
const mkOffer = (fee, salary, years, signingBonus, promisedRole, track) => ({ fee, salary, years, signingBonus, promisedRole, track });
for (const offer of [
  mkOffer(100000, 3000, 2, 0, 'bench'),          // 侮辱线
  mkOffer(5000000, salaryExpectation(target, 1) * 2, 3, 500000, 'core'), // 高薪核心
  mkOffer(5000000, salaryExpectation(target, 1) * 2, 3, 500000, 'bench', 'successor'), // 三正路接班
]) {
  const ev = evaluateOffer(state, target, offer, buyer);
  offerCases.push({ offer, insulting: ev.insulting, chance: hex64(ev.chance), objection: ev.objection ?? null, score: hex64(ev.score) });
}
// 解约金强制 + noPoach 分支（薪资须过侮辱线，才能真正命中这两个短路分支）
target.releaseClause = 3000000;
for (const offer of [mkOffer(3000000, salaryExpectation(target, 1) * 2, 1, 0, 'bench')]) {
  const ev = evaluateOffer(state, target, offer, buyer);
  offerCases.push({ offer, insulting: ev.insulting, chance: hex64(ev.chance), objection: ev.objection ?? null, score: hex64(ev.score), note: 'release-clause' });
}
target.releaseClause = 0;
target.noPoach = true;
for (const offer of [mkOffer(1000000, salaryExpectation(target, 1) * 2, 2, 0, 'starter')]) {
  const ev = evaluateOffer(state, target, offer, buyer);
  offerCases.push({ offer, insulting: ev.insulting, chance: hex64(ev.chance), objection: ev.objection ?? null, score: hex64(ev.score), note: 'noPoach' });
}
target.noPoach = false;

// ③ 谈判三轮 + finalize
const TransferOffer = { playerId: target.id, toTeam: buyer.id, fee: 5200000, salary: salaryExpectation(target, 1) + 15000, years: 3, signingBonus: 400000, promisedRole: 'starter', round: 0, demand: '', attitude: 0 };
const n1 = startNegotiation(state, TransferOffer);
const n2 = reNegotiate(state, TransferOffer);
TransferOffer.fee += 3000000;
TransferOffer.salary = salaryExpectation(target, 1) * 2;
const n3 = reNegotiate(state, TransferOffer);
const fin = finalizeOffer(state, TransferOffer, new Rng(21));

// ④ completeTransfer（真实成交通路：finalize 成交后再 complete）
let outTransferNotes = [];
{
  const rng = new Rng(33);
  outTransferNotes = completeTransfer(state, TransferOffer, rng);
}

// ⑤ releasePlayer
const relText = releasePlayer(state, Object.values(state.players).find((p) => p.teamId === teams[3].id)?.id);

// ⑥ aiWeeklyTransfers × 6 周（窗内 130/137/144 + Deadline 150/151/152）
const aiWeeks = [];
{
  const rng = new Rng(66);
  const bidsSeen = [];
  for (const day of [130, 137, 144, 150, 151, 152]) {
    state.day = day;
    const notes = aiWeeklyTransfers(state, rng, (offer) => bidsSeen.push({ id: offer.id, playerId: offer.playerId, fromTeam: offer.fromTeam, toTeam: offer.toTeam, fee: offer.fee }));
    aiWeeks.push({ day, notes, bids: [...bidsSeen], incoming: state.incomingBids.map((o) => ({ id: o.id, fee: o.fee })) });
  }
}

// ⑦ askInquiry + resolveInquiries
const inqTrace = [];
{
  const rng = new Rng(70);
  const q1 = askInquiry(state, pool[2].id, rng);
  const q2 = askInquiry(state, pool[3].id, rng);
  inqTrace.push({ q1, q2 });
  state.day = 131;
  resolveInquiries(state);
  inqTrace.push({ inquiries: state.inquiries.map((q) => ({ id: q.id, playerId: q.playerId, done: q.done, askingFee: q.askingFee, intent: q.intent })) });
  state.day = 200;
  resolveInquiries(state); // 清理过期
  inqTrace.push({ remaining: state.inquiries.length, grace: graceRemain(state) });
}

const dumpFeed = (f) => ({ day: f.day, year: f.year, kind: f.kind, c: f.c ?? null, toTeamId: f.toTeamId ?? null, playerId: f.playerId ?? null, text: f.text });

const out = {
  meta: { generator: 'ace/tools/golden-transfer.mjs', authority: 'ace/src/core/sim/transfer.ts' },
  mvVec, offerCases, negotiation: { n1, n2, n3, fin },
  transferNotes: outTransferNotes,
  releaseText: relText,
  aiWeeks, inqTrace,
  feed: state.transferFeed.map(dumpFeed),
  budgets: teams.slice(0, 6).map((t) => ({ id: t.id, budget: t.budget })),
};

mkdirSync('../kairo/Core.Tests/Golden', { recursive: true });
writeFileSync('../kairo/Core.Tests/Golden/transfer.golden.json', JSON.stringify(out));
console.log(`transfer golden written: ${offerCases.length} offer cases, ${aiWeeks.length} ai weeks`);
