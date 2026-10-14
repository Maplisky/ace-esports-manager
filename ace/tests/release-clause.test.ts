/** 违约金与有主问价（用户需求完善）：fee≥解约金强制成交；noPoach 拒报价；有主问价溢价与解约金反馈 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateWorld } from "../src/core/worldgen.ts";
import { initSeasonFixtures } from "../src/core/sim/day.ts";
import { evaluateOffer, finalizeOffer, askInquiry, resolveInquiries, marketValue } from "../src/core/sim/transfer.ts";
import { Rng } from "../src/core/rng.ts";

function setup(seed = 909) {
  const state = generateWorld(seed);
  initSeasonFixtures(state);
  state.myTeamId = Object.values(state.teams).find((t) => t.tier === 1)!.id;
  state.day = 10;
  return state;
}

test("违约金：报价 ≥ 解约金 → 强制成交（不受意愿/ logistic 影响）", () => {
  const state = setup();
  const team = state.teams[state.myTeamId!];
  const buyer = Object.values(state.teams).find((t) => t.id !== state.myTeamId)!;
  const target = team.roster.map((id) => state.players[id]!).sort((a, b) => b.overall - a.overall)[0]!;
  target.releaseClause = 5_000_000;
  const offer = {
    id: "RC1", playerId: target.id, fromTeam: team.id, toTeam: buyer.id,
    fee: 5_000_000, salary: 500_000, years: 3, signingBonus: 0,
    promisedRole: "core" as const, day: state.day, round: 0, demand: "", attitude: 0,
  };
  const ev = evaluateOffer(state, target, offer, buyer);
  assert.equal(ev.chance, 1, "解约金触发 → chance=1");
  const r = finalizeOffer(state, offer, new Rng(1));
  assert.equal(r.accepted, true);
  assert.ok(r.reason.includes("解约金条款"), r.reason);
  // 低于解约金 → 正常 logistic（可能拒绝）
  const offer2 = { ...offer, fee: 1_000_000 };
  const ev2 = evaluateOffer(state, target, offer2, buyer);
  assert.notEqual(ev2.chance, 1);
});

test("noPoach：解约金触发前拒报价（objection 指明条款）；触发解约金则放行", () => {
  const state = setup();
  const team = state.teams[state.myTeamId!];
  const buyer = Object.values(state.teams).find((t) => t.id !== state.myTeamId)!;
  const target = team.roster.map((id) => state.players[id]!)[0]!;
  target.noPoach = true;
  target.releaseClause = 3_000_000;
  const low = {
    id: "NP1", playerId: target.id, fromTeam: team.id, toTeam: buyer.id,
    fee: 1_000_000, salary: 400_000, years: 2, signingBonus: 0,
    promisedRole: "starter" as const, day: state.day, round: 0, demand: "", attitude: 0,
  };
  const evLow = evaluateOffer(state, target, low, buyer);
  assert.equal(evLow.chance, 0);
  assert.ok(evLow.objection!.includes("noPoach"));
  const high = { ...low, fee: 3_000_000 };
  const evHigh = evaluateOffer(state, target, high, buyer);
  assert.equal(evHigh.chance, 1, "noPoach 挡不住解约金");
});

test("有主问价：要价含俱乐部溢价（挂牌打折/noPoach 天价）+ 解约金提示进意向", () => {
  const state = setup();
  const team = state.teams[state.myTeamId!];
  const buyer = Object.values(state.teams).find((t) => t.id !== state.myTeamId)!;
  const star = team.roster.map((id) => state.players[id]!).sort((a, b) => b.overall - a.overall)[0]!;
  star.releaseClause = 4_000_000;
  star.noPoach = false;
  star.listed = false;
  const msg = askInquiry(state, star.id, new Rng(4));
  assert.ok(msg.includes("等待答复"));
  // 直接结算
  state.day += 5;
  resolveInquiries(state);
  const q = state.inquiries.find((x) => x.playerId === star.id)!;
  assert.ok(q.done);
  const base = marketValue(star, 1);
  assert.ok(q.askingFee >= base * 1.035, `有主溢价要价 ${q.askingFee} ≥ base×1.15×0.9`);
  assert.ok(q.intent.includes("解约金"), "意向应含解约金提示");
  assert.ok(q.intent.includes("强制放人"));
});
