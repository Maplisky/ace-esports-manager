/** 一键训练推荐（v1.4 用户反馈）：体力优先 / 主职责优先 / 次职责 fallback / 全上限休息 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { recommendPlan } from "../src/core/data/training.ts";

const base = { attrs: { aim: 60, reaction: 60, awareness: 60, utility: 60, clutch: 60, teamwork: 60, communication: 60, igl: 60 }, potential: 90, fatigue: 40, isIgl: false };

test("疲劳 >70 → 休息保状态（即使主职责项还有空间）", () => {
  const r = recommendPlan({ ...base, fatigue: 75 }, "duelist");
  assert.equal(r.key, "rest");
  assert.equal(r.reason, "rest-fatigue");
});

test("主职责项：决斗者练枪法 / 先锋控场主打道具 / 哨卫练意识；指挥优先指挥", () => {
  assert.equal(recommendPlan(base, "duelist").key, "aim");
  assert.equal(recommendPlan(base, "initiator").key, "utility");
  assert.equal(recommendPlan(base, "controller").key, "utility");
  assert.equal(recommendPlan(base, "sentinel").key, "awareness");
  assert.equal(recommendPlan({ ...base, isIgl: true }, "duelist").key, "igl");
});

test("主职责项达上限 → 次职责项 fallback（决斗者→反应 / 先锋控场→意识）", () => {
  const duelist = { ...base, attrs: { ...base.attrs, aim: 95 } };
  assert.equal(recommendPlan(duelist, "duelist").key, "reaction");
  assert.equal(recommendPlan(duelist, "duelist").reason, "secondary");
  const initiator = { ...base, attrs: { ...base.attrs, utility: 95 } };
  assert.equal(recommendPlan(initiator, "initiator").key, "awareness");
  assert.equal(recommendPlan(initiator, "initiator").reason, "secondary");
  const controller = { ...base, attrs: { ...base.attrs, utility: 95 } };
  assert.equal(recommendPlan(controller, "controller").key, "awareness");
});

test("主职责未上限但次职责已上限 → 仍练主项（次职责只做 fallback）", () => {
  const p = { ...base, attrs: { ...base.attrs, reaction: 95 } };
  assert.equal(recommendPlan(p, "duelist").key, "aim");
});

test("全属性接近上限 → 休息保状态", () => {
  const capped = { attrs: { aim: 99, reaction: 99, awareness: 99, utility: 99, clutch: 99, teamwork: 99, communication: 99, igl: 99 }, potential: 95, fatigue: 30, isIgl: false };
  const r = recommendPlan(capped, "duelist");
  assert.equal(r.key, "rest");
  assert.equal(r.reason, "rest-capped");
});

test("上限口径与训练结算一致：potential+5 为界（potential 70 → 属性 75 视为上限）", () => {
  const p = { ...base, potential: 70, attrs: { ...base.attrs, aim: 76 } };
  const r = recommendPlan(p, "duelist");
  assert.equal(r.key, "reaction");
  assert.equal(r.reason, "secondary");
});
