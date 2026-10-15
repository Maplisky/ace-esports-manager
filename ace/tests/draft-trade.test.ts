/** 选秀权交易回归（v1.0-8，GDD §13「选秀权可交易」）：
 *  买卖经 draftPickMoves 转移签位 → runDraft 按转移后归属发卡/选人 → 账本应用即清空。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resetPlayerSeq } from "../src/core/worldgen.ts";
import { generateWorld } from "../src/core/worldgen.ts";
import { resetFixtureSeq } from "../src/core/sim/fixtures.ts";
import { initSeasonFixtures } from "../src/core/sim/day.ts";
import { runDraft, draftPickTrade, draftPickInfo, resolveDraftSlots } from "../src/core/sim/draft.ts";
import type { GameState, NewsItem } from "../src/core/types.ts";

function build(seed = 71): GameState {
  resetPlayerSeq();
  resetFixtureSeq();
  const state = generateWorld(seed);
  initSeasonFixtures(state);
  state.myTeamId = Object.values(state.teams).find((t) => t.tier === 1)!.id;
  return state;
}

const dummy = (): NewsItem[] => [];

test("估值与行情：1 号签 $500K 地板 $120K；我队默认 1 签且有买卖报价", () => {
  const s = build();
  assert.equal(resolveDraftSlots(s).length, Object.values(s.teams).filter((t) => t.tier === 1).length, "基础顺位 = t1 队数");
  const info = draftPickInfo(s);
  assert.equal(info.windowOpen, true, "D1 处于季前窗 A");
  assert.equal(info.mySlots, 1);
  assert.ok(info.myProjected !== null);
  assert.ok(info.sellPrice !== null && info.sellPrice >= 108_000);
});

test("卖出选秀权：入账 + 签位转移 + 选秀日无我的卡；二次卖出被拒", () => {
  const s = build();
  s.day = 10; // 窗 A 内
  const my = s.teams[s.myTeamId!]!;
  const budget0 = my.budget;
  const msg = draftPickTrade(s, "sell", dummy());
  assert.ok(!msg.includes("只在转会窗"), `应成功卖出：${msg}`);
  assert.ok(my.budget > budget0, "卖出入账");
  assert.ok((s.draftPickMoves ?? []).length === 1);
  assert.ok(!resolveDraftSlots(s).includes(my.id), "我队签位已转出");
  const again = draftPickTrade(s, "sell", dummy());
  assert.ok(again.includes("没有可卖"), "二次卖出被拒");

  // 选秀日：无我的卡，账本被清空
  runDraft(s, dummy());
  assert.ok(!s.pendingEvents.some((c) => c.cardId === "draft"), "卖出后选秀日不再给我发卡");
  assert.equal(s.draftPickMoves!.length, 0, "账本应用即清空");
});

test("买入选秀权：扣款 + 我队持双签 → 选秀日两张卡", () => {
  const s = build();
  s.day = 10;
  const my = s.teams[s.myTeamId!]!;
  my.budget = 5_000_000; // 保证买得起
  const msg = draftPickTrade(s, "buy", dummy());
  assert.ok(!msg.includes("没有") && !msg.includes("资金"), `应成功买进：${msg}`);
  const info = draftPickInfo(s);
  assert.equal(info.mySlots, 2, "买进后持双签");
  runDraft(s, dummy());
  const cards = s.pendingEvents.filter((c) => c.cardId === "draft");
  assert.equal(cards.length, 2, "双签两张选秀卡");
});

test("非转会窗交易被拒", () => {
  const s = build();
  s.day = 60; // Stage 1 关窗期
  const msg = draftPickTrade(s, "buy", dummy());
  assert.ok(msg.includes("只在转会窗"), "关窗期拒绝交易");
});
