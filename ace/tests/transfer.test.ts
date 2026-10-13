/** 转会市场回归（GDD §8.2）：窗口/估值/谈判 logistic/解约金/挖角与答复 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Rng } from "../src/core/rng.ts";
import { generateWorld } from "../src/core/worldgen.ts";
import { initSeasonFixtures, advanceDay } from "../src/core/sim/day.ts";
import {
  inTransferWindow, marketValue, salaryExpectation, evaluateOffer,
  startNegotiation, finalizeOffer, completeTransfer, releasePlayer, aiWeeklyTransfers,
} from "../src/core/sim/transfer.ts";
import type { GameState, Player, TransferOffer } from "../src/core/types.ts";

function setup() {
  const state = generateWorld(88);
  initSeasonFixtures(state);
  state.myTeamId = "T0";
  state.day = 10; // 窗 A 内
  return state;
}

function offerOf(p: Player, toTeam: string, over: Partial<TransferOffer> = {}): TransferOffer {
  return {
    id: "T1", playerId: p.id, fromTeam: p.teamId, toTeam,
    fee: 100_000, salary: salaryExpectation(p, 1), years: 2,
    signingBonus: 0, promisedRole: "starter", day: 10, round: 0,
    demand: "", attitude: 0, ...over,
  };
}

test("窗口：季前在窗内，夏窗在窗内，常规赛中段关窗", () => {
  assert.ok(inTransferWindow(10));
  assert.ok(inTransferWindow(140));
  assert.ok(inTransferWindow(300));
  assert.equal(inTransferWindow(60), false);
  assert.equal(inTransferWindow(200), false);
});

test("估值与薪资期望：能力越高越贵，挂牌打折", () => {
  const state = setup();
  const ps = Object.values(state.players).filter((p) => p.teamId === "T0").sort((a, b) => b.overall - a.overall);
  const star = ps[0]!;
  const role = ps[ps.length - 1]!;
  assert.ok(marketValue(star, 1) > marketValue(role, 1), "高分球员身价更高");
  const listed = marketValue(star, 1);
  star.listed = true;
  assert.ok(marketValue(star, 1) < listed, "挂牌身价 ×0.75");
  assert.ok(salaryExpectation(star, 1) > 0);
});

test("谈判：侮辱性报价必拒，公平报价给出概率与短板提示", () => {
  const state = setup();
  const team = state.teams["T0"]!;
  const p = team.roster.map((id) => state.players[id]!).sort((a, b) => b.overall - a.overall)[0]!;
  const exp = salaryExpectation(p, 1);
  const low = offerOf(p, "T1", { salary: Math.round(exp * 0.4) });
  const evLow = evaluateOffer(state, p, low, state.teams["T1"]!);
  assert.equal(evLow.insulting, true, "40% 薪资应判定缺乏诚意");
  const fair = offerOf(p, "T1", { salary: Math.round(exp * 1.4), signingBonus: Math.round(exp * 0.5), promisedRole: "core" });
  const evFair = evaluateOffer(state, p, fair, state.teams["T1"]!);
  assert.ok(!evFair.insulting);
  assert.ok(evFair.chance > 0.3 && evFair.chance <= 0.92, `公平报价概率 ${evFair.chance.toFixed(2)}`);
});

test("即时谈判：startNegotiation 写回轮次与态度", () => {
  const state = setup();
  const p = Object.values(state.players).find((x) => x.teamId === "T1")!;
  const offer = offerOf(p, "T0", { salary: salaryExpectation(p, 1) });
  const r = startNegotiation(state, offer);
  assert.equal(offer.round, 1);
  assert.ok(offer.attitude > 0);
  assert.ok(r.demand.length > 0);
});

test("解约：赔付 40% 并进入自由池；阵容 5 人时禁止解约", () => {
  const state = setup();
  const team = state.teams["T0"]!;
  const pid = team.roster[1]!;
  const p = state.players[pid]!;
  p.contractYears = 2;
  p.salary = 100_000;
  const budgetBefore = team.budget;
  const msg = releasePlayer(state, pid);
  assert.ok(msg.includes("解约"));
  assert.equal(team.budget, budgetBefore - 80_000); // 100K × 2 年 × 40%
  assert.equal(p.teamId, null);
  assert.equal(team.roster.includes(pid), false);
  // 名单下限：降到 5 人后继续解约应被拒绝
  while (team.roster.length > 5) {
    releasePlayer(state, team.roster[0]!);
  }
  const last = team.roster[0]!;
  const lastP = state.players[last]!;
  const beforeBudget = team.budget;
  const refuse = releasePlayer(state, last);
  assert.ok(refuse.includes("凑不齐首发"), "5 人名单应禁止解约");
  assert.equal(lastP.teamId, "T0", "选手应留在队中");
  assert.equal(team.budget, beforeBudget, "被拒解决约不应扣钱");
});

test("AI 挖角：周结算产生对我方报价（确定性抽取），7 天答复窗过期清除", () => {
  const state = setup();
  state.day = 6;
  let sawBid = false;
  let tries = 0;
  while (!sawBid && tries < 60) {
    aiWeeklyTransfers(state, new Rng(9000 + tries), () => {});
    sawBid = state.incomingBids.length > 0;
    tries++;
  }
  assert.ok(sawBid, "多次抽取应产生至少一次 AI 挖角");
  const bid = state.incomingBids[0]!;
  assert.ok(bid.fee > 0, "挖角费应为正");
  assert.equal(bid.toTeam, "T0", "挖角对象是我方");
  assert.ok(salaryExpectation(state.players[bid.playerId]!, 1) > 0);
  // 答复窗：报价后 7 天内保留，第 8 天清除
  state.day = bid.day + 6;
  advanceDay(state); // 推进到 bid.day+7：仍 in 窗内
  assert.ok(state.incomingBids.some((b) => b.id === bid.id), "第 7 天仍在答复窗");
  state.day = bid.day + 7;
  advanceDay(state); // 推进到 bid.day+8：逾期清除并扣士气
  assert.equal(state.incomingBids.some((b) => b.id === bid.id), false, "逾期报价应被清除");
});
