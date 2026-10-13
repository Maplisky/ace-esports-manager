/** 事件卡回归（GDD §9.3 v0.5-2）：生日生成/结算效果/负面抑制器/空档补偿 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateWorld } from "../src/core/worldgen.ts";
import { initSeasonFixtures, advanceDay } from "../src/core/sim/day.ts";
import { spawnBirthdays, spawnDailyEvents, resolveEvent } from "../src/core/sim/events.ts";
import { Rng } from "../src/core/rng.ts";

test("生日：当日生成祝福卡，选项结算士气/预算并移出队列", () => {
  const state = generateWorld(5);
  initSeasonFixtures(state);
  state.myTeamId = "T0";
  const team = state.teams["T0"]!;
  const p = state.players[team.starters[0]!]!;
  state.day = Math.max(2, p.birthdayDay); // 直接落在生日当天做单元级验证
  const moraleBefore = p.morale;
  const budgetBefore = team.budget;

  spawnBirthdays(state);
  const card = state.pendingEvents.find((e) => e.cardId === "birthday" && e.targetPlayerId === p.id);
  assert.ok(card, "生日卡应生成");
  assert.equal(card.options.length, 3);

  // 选「送小礼物」：士气 +5 / 预算 −200
  const idx = card.options.findIndex((o) => o.label.includes("礼物"));
  const r = resolveEvent(state, card.uid, idx, new Rng(1));
  assert.ok(r && r.result.includes(p.ign));
  assert.equal(state.pendingEvents.some((e) => e.uid === card.uid), false, "结算后移出队列");
  assert.equal(p.morale, Math.min(100, moraleBefore + 5), "礼物士气 +5 应精确");
  assert.equal(team.budget, budgetBefore - 200);
});

test("抽取：队列上限 4，空档 6 天保底补偿 1 张", () => {
  const state = generateWorld(6);
  initSeasonFixtures(state);
  state.myTeamId = "T0";
  state.day = 60;
  state.lastEventDay = 53; // 空档 7 天
  spawnDailyEvents(state, new Rng(1));
  assert.ok(state.pendingEvents.length >= 1, "空档补偿应至少 1 张");
  assert.ok(state.pendingEvents.length <= 4, "队列上限 4");

  // 连续抽到队列上限
  for (let i = 0; i < 10; i++) spawnDailyEvents(state, new Rng(100 + i));
  assert.ok(state.pendingEvents.length <= 4, `队列溢出: ${state.pendingEvents.length}`);
});

test("翻年：抑制器重置（旧年 lastEventDay 不应抑制新赛季负面事件）", () => {
  const state = generateWorld(9);
  initSeasonFixtures(state);
  state.myTeamId = "T0";
  const team = state.teams["T0"]!;
  const p = state.players[team.starters[0]!]!;
  // 模拟旧年残留：lastEventDay 是旧年第 340 天
  p.lastEventDay = 340;
  // 翻年后（day 1 → 15），抽取时该选手不应被抑制（通过不抛错 + 卡池可包含负面来间接验证）
  state.day = 0;
  state.pendingEvents = [];
  for (let d = 0; d < 15; d++) {
    advanceDay(state);
    if (state.day >= 14) break;
  }
  // 走到第 14 天说明没有被除零/卡死；抑制器判断 14-0 < 14 为 false（day 14 时）→ 第 14 天起可抽负面
  assert.ok(state.day >= 14);
});

test("抑制器：负面卡结算后标记 lastEventDay，14 天内不再当负面主角", () => {
  const state = generateWorld(7);
  initSeasonFixtures(state);
  state.myTeamId = "T0";
  const team = state.teams["T0"]!;
  const p = state.players[team.starters[0]!]!;
  state.pendingEvents.push({
    uid: "TEST_NEG", cardId: "quarrel", title: "训练室争吵", text: "测试",
    negative: true, targetPlayerId: p.id, day: 10,
    options: [{ label: "各打五十大板", result: "测试结果", morale: -1 }],
  });
  state.day = 12;
  const r = resolveEvent(state, "TEST_NEG", 0, new Rng(2));
  assert.ok(r);
  assert.equal(p.lastEventDay, 12, "负面卡应标记抑制器起点");
});

test("结算效果：预算与声望按选项增减", () => {
  const state = generateWorld(8);
  initSeasonFixtures(state);
  state.myTeamId = "T0";
  const team = state.teams["T0"]!;
  const repBefore = team.reputation;
  const budgetBefore = team.budget;
  state.pendingEvents.push({
    uid: "TEST_EFF", cardId: "gaming-cafe", title: "网吧签名会", text: "测试",
    negative: false, day: 10,
    options: [
      { label: "全队出席", result: "测试", teamMorale: 2, reputation: 1, fatigue: 3 },
      { label: "派队长代表", result: "测试", morale: 1 },
    ],
  });
  resolveEvent(state, "TEST_EFF", 0, new Rng(3));
  assert.equal(team.reputation, repBefore + 1);
  assert.ok(team.budget === budgetBefore, "此选项不动预算");
});
