/**
 * business 黄金轨迹记录器：赞助意向刷新/签约检定/解约/周收入（业绩条款+直播 60/40）/商务邀约/直播合同。
 * 世界夹具 generateWorld(42)，myTeam=teams[2]。运行：node tools/golden-business.mjs（ace/ 下）
 */
import { generateWorld } from '../src/core/worldgen.ts';
import {
  refreshCommercialWeek, sponsorSignChance, signSponsorOffer, cancelSponsorById,
  weeklySponsorIncome, acceptGig, declineGig, signStream, cancelStream,
} from '../src/core/sim/business.ts';
import { Rng } from '../src/core/rng.ts';
import { writeFileSync, mkdirSync } from 'node:fs';

const state = generateWorld(42);
state.myTeamId = Object.values(state.teams)[2].id;
const myTeam = state.teams[state.myTeamId];
const rng = new Rng(4242);

const dumpOffer = (o) => ({ id: o.id, name: o.name, tier: o.tier, perSeason: o.perSeason, years: o.years, signedYear: o.signedYear, expires: o.expires });
const dumpSponsor = (s) => ({ id: s.id, name: s.name, tier: s.tier, perSeason: s.perSeason, years: s.years, signedYear: s.signedYear, bonus: s.bonus ?? null });
const dumpGig = (g) => ({ id: g.id, playerId: g.playerId, brand: g.brand, pay: g.pay, day: g.day });

const trace = [];
state.day = 100;
// 第 1-3 周：商务刷新（邀约+赞助意向）
for (const w of [0, 1, 2]) {
  state.day = 100 + w * 7;
  refreshCommercialWeek(state, rng);
  trace.push({
    tag: `refresh-w${w}`,
    gigOffers: state.gigOffers.map(dumpGig),
    sponsorOffers: state.sponsorOffers.map(dumpOffer),
  });
}
// 签约：检定概率向量 + 逐个签意向（概率驱动，ok/fail 都记录）
const chances = [1, 2, 3].map((t) => ({ tier: t, chance: sponsorSignChance(state, t) }));
for (const offer of [...state.sponsorOffers]) {
  const r = signSponsorOffer(state, offer, rng);
  trace.push({ tag: `sign-${offer.id}`, ok: r.ok, text: r.text });
}
// 解约一支
if (myTeam.sponsors.length > 0) trace.push({ tag: 'cancel-sponsor', text: cancelSponsorById(state, myTeam.sponsors[0].id) });
// 周收入 × 3 周（含业绩条款倍率对照）
const incomes = [];
for (const mult of [undefined, 1.2, 1.5]) {
  state.sponsorMult = mult;
  incomes.push({ mult: mult ?? null, income: weeklySponsorIncome(state) });
}
state.sponsorMult = undefined;
// 直播合同：签 + 周收入（钱包/人气变化）+ 取消
const streamPid = myTeam.roster[0];
const sr = signStream(state, streamPid, 3, rng);
state.day = 130;
const incomeWithStream = weeklySponsorIncome(state);
const walletAfter = state.players[streamPid].wallet ?? 0;
const popAfter = state.players[streamPid].popularity ?? null;
const cr = cancelStream(state, streamPid);
// 商务邀约接受/婉拒
let gigOk = null, gigDecline = null;
if (state.gigOffers.length > 0) {
  const g = state.gigOffers[0];
  const popBefore = state.players[g.playerId]?.popularity ?? 0;
  const r = acceptGig(state, g.id);
  gigOk = { id: g.id, ok: r.ok, text: r.text, popBefore, finLog: state.finances.log.map((e) => ({ day: e.day, label: e.label, amount: e.amount })) };
}
if (state.gigOffers.length > 0) {
  const g = state.gigOffers[0];
  declineGig(state, g.id);
  gigDecline = { declined: g.id, remaining: state.gigOffers.length };
}

const out = {
  meta: { generator: 'ace/tools/golden-business.mjs', authority: 'ace/src/core/sim/business.ts' },
  chances, trace, incomes,
  stream: { text: sr.text, incomeWithStream, walletAfter, popAfter, cancelText: cr },
  gigOk, gigDecline,
  finalSponsors: myTeam.sponsors.map(dumpSponsor),
};

mkdirSync('../kairo/Core.Tests/Golden', { recursive: true });
writeFileSync('../kairo/Core.Tests/Golden/business.golden.json', JSON.stringify(out));
console.log(`business golden written: ${trace.length} trace entries, sponsors=${myTeam.sponsors.length}`);
