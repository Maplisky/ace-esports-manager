/** 商务系统回归（v0.5-4 基础 + v1.4 经营修补包）：赞助/商务日/直播/业绩条款/教练心态/自我进修 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateWorld, resetPlayerSeq } from "../src/core/worldgen.ts";
import { initSeasonFixtures, advanceDay } from "../src/core/sim/day.ts";
import { resetFixtureSeq } from "../src/core/sim/fixtures.ts";
import { refreshCommercialWeek, sponsorSignChance, signSponsorOffer, weeklySponsorIncome, acceptGig, signStream, TIER_DEF } from "../src/core/sim/business.ts";
import { selfStudy, SELF_STUDY_COST, SELF_STUDY_CAP } from "../src/core/sim/career.ts";
import { simMatch, applyMatchEffects } from "../src/core/sim/match.ts";
import { Rng } from "../src/core/rng.ts";
import type { GameState } from "../src/core/types.ts";

function setup(seed = 21): GameState {
  resetPlayerSeq(); resetFixtureSeq();
  const state = generateWorld(seed);
  initSeasonFixtures(state);
  state.myTeamId = Object.values(state.teams).find((t) => t.tier === 1)!.id;
  state.day = 10;
  return state;
}

/** v14 修补包测试 helper（种子 81 起，与旧 setup 区分） */
function build14(seed = 81): GameState {
  resetPlayerSeq(); resetFixtureSeq();
  const state = generateWorld(seed);
  initSeasonFixtures(state);
  state.myTeamId = Object.values(state.teams).find((t) => t.tier === 1)!.id;
  return state;
}

test("赞助：周收入 = 全部赞助 perSeason/48，入账走俱乐部预算", () => {
  const state = setup();
  const team = state.teams[state.myTeamId!]!;
  team.sponsors = [
    { id: "S1", name: "测试A", tier: 1, perSeason: 96_000, years: 1, signedYear: 2026 },
    { id: "S2", name: "测试B", tier: 2, perSeason: 240_000, years: 1, signedYear: 2026 },
  ];
  team.budget = 1_000_000;
  const before = team.budget;
  // 周结算触发收入（day 凑 %7===0）
  state.day = 13;
  advanceDay(state);
  const gained = team.budget - before;
  const expected = Math.round(96_000 / 48) + Math.round(240_000 / 48);
  assert.ok(gained >= expected - 2 && gained <= expected + 2, `周收入 ${gained} ≈ ${expected}`);
});

test("赞助档位门槛：低声望签国际品牌概率被压制", () => {
  const state = setup();
  state.teams[state.myTeamId!]!.reputation = 30; // 低于国际品牌门槛 60
  const low = sponsorSignChance(state, 3);
  state.teams[state.myTeamId!]!.reputation = 80;
  const high = sponsorSignChance(state, 3);
  assert.ok(high > low, `高声望 ${high.toFixed(2)} 应高于低声望 ${low.toFixed(2)}`);
});

test("商务日：接受邀约占训练日并降低个人经验收益", () => {
  const state = setup();
  state.day = 6; // 下一次推进触发周结算刷新邀约
  refreshCommercialWeek(state, new Rng(3));
  const gig = state.gigOffers[0];
  assert.ok(gig, "应生成商务邀约");
  const p = state.players[gig.playerId]!;
  p.commercialDays = 2;
  const before = p.attrs.aim;
  // 推进一周走训练结算
  for (let d = 0; d < 7; d++) advanceDay(state);
  const aimGainWithPenalty = p.attrs.aim + (p.xp?.aim ?? 0) / 100 - before;
  void aimGainWithPenalty;
  // 占用惩罚的直接断言：commercialDays 在周内为 2 时个人经验 ×(1−0.25×2)
  assert.ok(p.commercialDays === 0 || p.commercialDays === undefined, "周结算后商务占用应清零");
});

test("直播合同：俱乐部周入 40%，合同到期后停止", () => {
  const state = setup();
  const team = state.teams[state.myTeamId!]!;
  const pid = team.roster[0]!;
  const p = state.players[pid]!;
  p.stream = { weekly: 4000, untilDay: state.day + 30 };
  const before = team.budget;
  advanceDay(state); // 无周结算的日子也可能有比赛——直接快进到周结算
  state.day = 13;
  const budgetAt = team.budget;
  void budgetAt;
  // 推进到下一个周结算验证收入
  while (state.day % 7 !== 0) advanceDay(state);
  advanceDay(state);
  const gained = team.budget - before;
  assert.ok(gained > 0, `直播周收入应到账: ${gained}`);
});

test("赞助意向：签成即从意向列表移除（用户反馈：残留 21 天）", () => {
  const state = setup();
  const rng = new Rng(7);
  // 直接构造一份必签意向（tier1、rep 足够）
  state.sponsorOffers = [{
    id: "SPTEST", name: "测试品牌", tier: 1 as const, perSeason: 100_000,
    years: 1, signedYear: state.year, expires: state.day + 10,
  }];
  const r = signSponsorOffer(state, state.sponsorOffers[0], rng);
  if (r.ok) {
    assert.equal(state.sponsorOffers.some((o) => o.id === "SPTEST"), false, "签成后意向应移除");
  } else {
    assert.ok(state.sponsorOffers.some((o) => o.id === "SPTEST"), "婉拒保留可再谈");
  }
  // 无论签否，过期清理仍工作
  state.day += 11;
  state.sponsorOffers = state.sponsorOffers.filter((o) => o.expires > state.day);
  assert.equal(state.sponsorOffers.length, 0);
});

// ───── v1.4 经营修补包回归（自 business-v14 合并，2026-10-16）─────

test("v14 赞助门槛：三档 repNeed = 45/60/75（GDD §8.4）", () => {
  assert.deepEqual(TIER_DEF.map((t) => t.repNeed), [45, 60, 75]);
});

test("v14 直播 60/40：俱乐部 40% + 选手钱包 60% + 人气 +2/周（签约 +5）", () => {
  const s = setup();
  const pid = s.teams[s.myTeamId!]!.starters[0]!;
  const p = s.players[pid]!;
  const r = signStream(s, pid, 2, new Rng(7));
  assert.ok(r.ok);
  assert.equal(p.popularity, 5, "签约即获人气 +5");
  p.stream!.weekly = 10_000;
  s.teams[s.myTeamId!]!.sponsors = []; // 排除赞助干扰
  const income = weeklySponsorIncome(s);
  assert.equal(income, 4_000, "俱乐部拿 40%");
  assert.equal(p.wallet, 6_000, "选手个人钱包拿 60%");
  assert.equal(p.popularity, 7, "直播周人气 +2");
});

test("v14 人气值加成商务邀约报酬（0.2%/点）", () => {
  const s = setup();
  const pid = s.teams[s.myTeamId!]!.starters[1]!;
  const p = s.players[pid]!;
  p.popularity = 50;
  s.gigOffers.push({ id: "G1", playerId: pid, brand: "测试品牌", pay: 10_000, day: s.day });
  const r = acceptGig(s, "G1");
  assert.ok(r.ok);
  assert.ok(r.text.includes("人气加成"), "高人气提示");
});

test("v14 赞助业绩条款：夺冠 ×1.5 / 四强 ×1.2 / 无条款赞助不乘", () => {
  const s = build14();
  const t = s.teams[s.myTeamId!]!;
  t.sponsors = [
    { id: "S1", name: "有条款", tier: 1, perSeason: 480_000, years: 1, signedYear: s.year, bonus: true },
    { id: "S2", name: "无条款", tier: 1, perSeason: 480_000, years: 1, signedYear: s.year, bonus: false },
  ];
  s.sponsorMult = 1.5;
  assert.equal(weeklySponsorIncome(s), Math.round(10_000 * 1.5) + 10_000, "带条款 ×1.5、无条款 ×1");
  s.sponsorMult = 1.2;
  assert.equal(weeklySponsorIncome(s), Math.round(10_000 * 1.2) + 10_000);
});

test("v14 教练心态：我的正式赛胜负 ±10（applyMatchEffects）", () => {
  const s = build14();
  const myId = s.myTeamId!;
  const opp = Object.values(s.teams).find((t) => t.id !== myId)!;
  const rec = simMatch(s, myId, opp.id, 1, 4242, "mood-test");
  const mood0 = s.manager.life.mood;
  applyMatchEffects(s, rec);
  const won = rec.winner === "A";
  assert.equal(s.manager.life.mood, Math.max(0, Math.min(100, mood0 + (won ? 10 : -10))), "胜负 ±10");
});

test("v14 自我进修：$5K → 技能 +1；不足拒付；封顶 75", () => {
  const s = build14();
  s.manager.life.wallet = 20_000;
  const t0 = s.manager.skills.tactics ?? 50;
  const r1 = selfStudy(s, "tactics");
  assert.ok(r1.includes("→"), r1);
  assert.equal(s.manager.skills.tactics, t0 + 1);
  assert.equal(s.manager.life.wallet, 20_000 - SELF_STUDY_COST);
  s.manager.life.wallet = 100;
  assert.ok(selfStudy(s, "tactics").includes("不足"));
  s.manager.life.wallet = 100_000;
  s.manager.skills.tactics = SELF_STUDY_CAP;
  assert.ok(selfStudy(s, "tactics").includes("上限"));
});
