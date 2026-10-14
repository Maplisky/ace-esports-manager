/** 问价（GDD §8.2 原作式异步）：花 1 行动力、2-5 天反馈要价+意向、反馈置顶数据正确 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateWorld } from "../src/core/worldgen.ts";
import { initSeasonFixtures, advanceDay } from "../src/core/sim/day.ts";
import { askInquiry, resolveInquiries, marketValue } from "../src/core/sim/transfer.ts";
import { Rng } from "../src/core/rng.ts";

function setup(seed = 202) {
  const state = generateWorld(seed);
  initSeasonFixtures(state);
  state.myTeamId = Object.values(state.teams).find((t) => t.tier === 1)!.id;
  return state;
}

test("问价：窗内发起写 2-5 天反馈计划；关窗拒绝；重复问价拒绝", () => {
  const state = setup();
  state.day = 10;
  const fa = Object.values(state.players).find((p) => !p.teamId)!;
  const msg = askInquiry(state, fa.id, new Rng(1));
  assert.ok(msg.includes("等待答复"), msg);
  assert.equal(state.inquiries.length, 1);
  const q = state.inquiries[0]!;
  assert.ok(q.resolveDay - q.askDay >= 2 && q.resolveDay - q.askDay <= 5, `反馈期 ${q.resolveDay - q.askDay} 天应 2-5`);
  // 重复问价
  const again = askInquiry(state, fa.id, new Rng(2));
  assert.ok(again.includes("问价中"));
  // 关窗
  state.day = 60;
  const closed = askInquiry(state, Object.values(state.players).find((p) => !p.teamId)!.id, new Rng(3));
  assert.ok(closed.includes("窗口已关闭"));
});

test("问价：到反馈日出要价（身价×0.9-1.3）+ 意向文案；未到期不出", () => {
  const state = setup();
  state.day = 10;
  const fa = Object.values(state.players).find((p) => !p.teamId)!;
  askInquiry(state, fa.id, new Rng(5));
  const q = state.inquiries[0]!;
  // 第 1 天后：未到期不出
  state.day = q.askDay + 1;
  resolveInquiries(state);
  assert.equal(q.done, false);
  // 到 resolveDay：出结果
  state.day = q.resolveDay;
  resolveInquiries(state);
  assert.equal(q.done, true);
  const expected = marketValue(fa, 1);
  assert.ok(q.askingFee >= expected * 0.9 && q.askingFee <= expected * 1.3, `要价 ${q.askingFee} 应在身价±30% 内`);
  assert.ok(q.intent.length > 0);
  // 跨天重复结算安全
  resolveInquiries(state);
  assert.equal(q.done, true);
});

test("问价：结算挂在日推进（advanceDay 自动出结果）", () => {
  const state = setup();
  state.day = 10;
  const fa = Object.values(state.players).find((p) => !p.teamId)!;
  askInquiry(state, fa.id, new Rng(9));
  const q = state.inquiries[0]!;
  for (let i = 0; i < 8 && !q.done; i++) advanceDay(state);
  assert.equal(q.done, true, "推进 8 天内应出结果");
  assert.ok(q.askingFee > 0);
});
