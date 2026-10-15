/** 财务可视化核心（v1.3，GDD §8.1）：finances.log 为唯一事实源。
 *  对账不变量（窗口终点 === 当前预算）/ 分类口径 / logFinance 裁剪 / 顶栏外推。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateWorld, resetPlayerSeq } from "../src/core/worldgen.ts";
import { initSeasonFixtures } from "../src/core/sim/day.ts";
import { resetFixtureSeq } from "../src/core/sim/fixtures.ts";
import { financeWindow, financeBreakdown, categorize, logFinance, cashFlowForecast } from "../src/core/sim/finance.ts";
import type { GameState } from "../src/core/types.ts";

function build(seed = 71): GameState {
  resetPlayerSeq();
  resetFixtureSeq();
  const state = generateWorld(seed);
  initSeasonFixtures(state);
  state.myTeamId = Object.values(state.teams).find((t) => t.tier === 1)!.id;
  return state;
}

test("对账不变量：窗口终点恒等于当前预算（任意流水组合）", () => {
  const s = build();
  logFinance(s, "转会支出 · A（含签字费）", -800_000);
  logFinance(s, "转会收入 · B", 450_000);
  logFinance(s, "商务周收入（赞助/直播）", 96_000);
  s.day += 3;
  logFinance(s, "选秀权出售（预计第 2 顺位）", 320_000);
  s.day += 10;
  logFinance(s, "解约赔付 · C", -60_000);
  s.teams[s.myTeamId!]!.budget += 96_000 + 450_000 + 320_000 - 800_000 - 60_000; // 与流水同步
  const win = financeWindow(s, 30);
  assert.equal(win.end, s.teams[s.myTeamId!]!.budget, "终点=当前预算");
  assert.equal(win.steps.length, 6, "期初 + 5 笔流水");
  assert.equal(win.start + win.entries.reduce((a, e) => a + e.amount, 0), win.end);
});

test("窗口边界：30 天窗口剔除更早流水；7/90 天参数化", () => {
  const s = build();
  s.day = 100;
  logFinance(s, "商务周收入（赞助/直播）", 50_000); // D100
  s.day = 60;
  logFinance(s, "商务周收入（赞助/直播）", 10_000); // D60 → 30 天窗口外、90 天窗口内
  s.day = 100;
  const w30 = financeWindow(s, 30);
  assert.equal(w30.entries.length, 1, "30 天窗口只有 D100");
  const w90 = financeWindow(s, 90);
  assert.equal(w90.entries.length, 2, "90 天窗口含 D60");
});

test("分类口径：label 前缀映射六类", () => {
  assert.equal(categorize("转会支出 · X（含签字费）"), "transfer");
  assert.equal(categorize("解约赔付 · X"), "release");
  assert.equal(categorize("选秀权出售（预计第 2 顺位）"), "draft");
  assert.equal(categorize("商务周收入（赞助/直播）"), "business");
  assert.equal(categorize("商务活动 · 品牌（选手）"), "business");
  assert.equal(categorize("事件 · 赞助商惊喜"), "event");
  assert.equal(categorize("别的什么"), "other");
});

test("logFinance：入账并裁剪到 100 条", () => {
  const s = build();
  for (let i = 0; i < 130; i++) logFinance(s, `流水 ${i}`, 100);
  assert.equal(s.finances.log.length, 100, "裁剪到 100");
  assert.equal(s.finances.log[0]!.label, "流水 30", "保留最近");
});

test("分类占比：收入/支出分开聚合；顶栏外推无流水为 null", () => {
  const s = build();
  assert.equal(cashFlowForecast(s), null, "无流水 → null");
  logFinance(s, "转会收入 · A", 400_000);
  logFinance(s, "解约赔付 · B", -100_000);
  const bd = financeBreakdown(financeWindow(s, 30).entries);
  const tr = bd.find((x) => x.cat === "transfer")!;
  const rel = bd.find((x) => x.cat === "release")!;
  assert.equal(tr.income, 400_000);
  assert.equal(tr.expense, 0);
  assert.equal(rel.expense, 100_000);
  const f = cashFlowForecast(s)!;
  assert.equal(f.week, 300_000);
  assert.ok(Math.abs(f.perDay - 300_000 / 7) < 1e-6);
});
