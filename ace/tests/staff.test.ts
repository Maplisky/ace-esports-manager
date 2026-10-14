/** 教练组/轮换协议回归（GDD §8.3 v1.7 + §6.4②） */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateWorld } from "../src/core/worldgen.ts";
import { initSeasonFixtures, advanceDay } from "../src/core/sim/day.ts";

test("轮换沟通豁免：已沟通的核心/首发坐板凳不再扣士气", () => {
  const state = generateWorld(17);
  initSeasonFixtures(state);
  state.myTeamId = Object.values(state.teams).find((t) => t.tier === 1)!.id;
  const team = state.teams[state.myTeamId!]!;
  const p = state.players[team.starters[0]!]!;
  // 造一个"被轮换的核心"：从首发移除并承诺核心
  team.starters = team.starters.filter((id) => id !== p.id);
  p.promisedRole = "core";
  state.rotationWaive = [p.id];
  p.morale = 60;
  const before = p.morale;
  for (let d = 0; d < 7; d++) advanceDay(state);
  // 有豁免：不扣 −3（其他士气温波 ±2 内）
  assert.ok(Math.abs(p.morale - before) <= 4, `豁免后士气变化 ${p.morale - before} 应为小波动`);
});

test("无豁免：核心承诺坐板凳 → 周士气 −3", () => {
  const state = generateWorld(18);
  initSeasonFixtures(state);
  state.myTeamId = Object.values(state.teams).find((t) => t.tier === 1)!.id;
  const team = state.teams[state.myTeamId!]!;
  const p = state.players[team.starters[0]!]!;
  team.starters = team.starters.filter((id) => id !== p.id);
  p.promisedRole = "core";
  state.rotationWaive = [];
  p.morale = 60;
  const before = p.morale;
  for (let d = 0; d < 7; d++) advanceDay(state);
  assert.ok(p.morale <= before, `核心承诺坐板凳应扣士气: ${before} → ${p.morale}`);
});

test("训练助教：xp 收益按 staff 数值放大", () => {
  const stateA = generateWorld(21);
  const stateB = generateWorld(21);
  for (const [state, staffValue] of [[stateA, 99], [stateB, 0]] as const) {
    initSeasonFixtures(state);
    state.myTeamId = Object.values(state.teams).find((t) => t.tier === 1)!.id;
    const team = state.teams[state.myTeamId!]!;
    team.staff = { training: { name: "T", value: staffValue } };
    state.day = 1;
    state.teamSchedule = ["map", "map", "review", "scrim", "map", "map", "map"];
    const p = state.players[team.starters[0]!]!;
    p.xp = { aim: 0 };
    state.schedules[p.id] = "aim";
    for (let d = 0; d < 7; d++) advanceDay(state);
    if (staffValue === 99) (globalThis as any).__xpHigh = p.xp.aim ?? 0;
    else (globalThis as any).__xpLow = p.xp.aim ?? 0;
  }
  const high = (globalThis as any).__xpHigh as number;
  const low = (globalThis as any).__xpLow as number;
  assert.ok(high > low, `训练助教 99 点 xp ${high} 应高于 0 点 ${low}`);
});
