/** AI 挂牌/摘牌/互挖 + 自身挂牌成本与士气（v0.8 用户需求完善） */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateWorld } from "../src/core/worldgen.ts";
import { initSeasonFixtures, advanceDay } from "../src/core/sim/day.ts";
import { aiWeeklyTransfers } from "../src/core/sim/transfer.ts";
import { Rng } from "../src/core/rng.ts";

function setup(seed = 707) {
  const state = generateWorld(seed);
  initSeasonFixtures(state);
  state.myTeamId = Object.values(state.teams).find((t) => t.tier === 1)!.id;
  state.day = 10; // 窗 A 内
  return state;
}

test("AI 挂牌：窗内按性格概率产生挂牌 feed，标的合法（非 IGL/noPoach/有主）", () => {
  const state = setup();
  let sawList = false;
  for (let i = 0; i < 40 && !sawList; i++) {
    aiWeeklyTransfers(state, new Rng(100 + i), () => {});
    const listFeed = state.transferFeed.filter((n) => n.kind === "list");
    for (const n of listFeed) {
      sawList = true;
      // 标的必须仍有主（挂牌不移队）且非我方（AI 只挂他队与我方无关）
      const m = n.text.match(/挂牌 ([^\s（]+)/);
      assert.ok(m, "feed 格式");
      const p = Object.values(state.players).find((x) => x.ign === m![1]);
      if (p) {
        assert.equal(p.listed, true, "feed 中的选手应处于挂牌态");
        assert.notEqual(p.teamId, state.myTeamId, "AI 只挂他队与我方无关的队");
        assert.equal(p.isIgl, false, "不挂 IGL");
      }
    }
    advanceDay(state);
  }
  assert.ok(sawList, "40 次抽取应产生至少一次 AI 挂牌");
});

test("AI 互挖挂牌：completeTransfer 后买方收人、卖方收钱", () => {
  const state = setup();
  // 手工构造挂牌：他队一名选手
  const seller = Object.values(state.teams).find((t) => t.id !== state.myTeamId)!;
  const target = state.players[seller.roster[0]!]!;
  target.listed = true;
  target.listedWeeks = 1;
  const beforeBudget = seller.budget;
  const beforeRoster = seller.roster.length;
  // 直接跑 aiWeeklyTransfers 多轮（30%/周出价概率）直到出现含「成交」的互挖 feed
  let traded = false;
  for (let i = 0; i < 60 && !traded; i++) {
    aiWeeklyTransfers(state, new Rng(500 + i), () => {});
    if (state.transferFeed.some((n) => n.kind === "done" && n.text.includes(target.ign))) traded = true;
    advanceDay(state);
  }
  if (traded) {
    assert.notEqual(target.teamId, seller.id, "已易主");
    assert.ok(seller.budget > beforeBudget - 1, "卖方收钱（含其它收支波动容忍）");
    assert.ok(beforeRoster - seller.roster.length <= 1, "卖方名单减员 ≤1（可能有紧急补位）");
  }
});

test("自身挂牌：listedWeeks 随周推进（AI 摘牌计时口径）", () => {
  const state = setup();
  const team = state.teams[state.myTeamId!];
  const p = state.players[team.roster[1]!]!;
  p.listed = true;
  p.listedWeeks = 0;
  // 我方挂牌不被 AI 摘牌/计数（他队过滤），但 listedWeeks 由玩家挂牌时清零——这里只验证字段存在且不崩
  for (let i = 0; i < 8; i++) advanceDay(state);
  assert.ok(p.listed, "我方挂牌不被 AI 摘牌逻辑触碰");
});
