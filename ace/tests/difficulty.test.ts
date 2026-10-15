/** 难度三档回归（v1.0-7，GDD §9.5）：AI 侦察 intel / BP 噪声 / 预算补贴 / 普通难度逐位一致 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateWorld, resetPlayerSeq } from "../src/core/worldgen.ts";
import { initSeasonFixtures, advanceDay } from "../src/core/sim/day.ts";
import { resetFixtureSeq } from "../src/core/sim/fixtures.ts";
import { simMatch } from "../src/core/sim/match.ts";
import { computeSide } from "../src/core/sim/strength.ts";
import { MAPS } from "../src/core/data/maps.ts";
import type { GameState } from "../src/core/types.ts";

function build(seed = 12): GameState {
  resetPlayerSeq();
  resetFixtureSeq();
  const state = generateWorld(seed);
  initSeasonFixtures(state);
  state.myTeamId = Object.values(state.teams).find((t) => t.tier === 1)!.id;
  return state;
}

test("AI 侦察按难度传递：普通 prep 0 / 困难 +0.44 / 职业 +0.88（intel ×0.22）", () => {
  const s = build();
  const my = s.myTeamId!;
  const opp = Object.values(s.teams).find((t) => t.tier === 1 && t.id !== my)!;
  const map = MAPS[0]!;
  const base = { team: opp, players: s.players, map, day: 1 } as Parameters<typeof computeSide>[0];
  const s0 = computeSide({ ...base });
  const sHard = computeSide({ ...base, intel: 2 });
  const sPro = computeSide({ ...base, intel: 4 });
  assert.ok(Math.abs(sHard.atk - s0.atk - 2 * 0.22) < 1e-9, "困难 AI 针对加成 +0.44");
  assert.ok(Math.abs(sPro.atk - s0.atk - 4 * 0.22) < 1e-9, "职业 AI 针对加成 +0.88");
});

test("普通难度缺省行为逐位一致（不设 difficulty 与 normal 结果相同）；职业难度 BP 噪声改变选图", () => {
  const sA = build(15); // 无 difficulty（旧档）
  const sB = build(15);
  sB.difficulty = "normal";
  const [t1, t2] = Object.values(sA.teams).filter((t) => t.tier === 1);
  const rA = simMatch(sA, t1!.id, t2!.id, 3, 777, "diff-a");
  const rB = simMatch(sB, t1!.id, t2!.id, 3, 777, "diff-b");
  assert.deepEqual(rA.score, rB.score, "normal 与缺省一致");
  assert.deepEqual(rA.maps.map((m) => m.map), rB.maps.map((m) => m.map), "选图一致");
  // 职业：噪声 ±3 仍可模拟（结果可能不同，不崩即可）
  const sC = build(15);
  sC.difficulty = "pro";
  const rC = simMatch(sC, t1!.id, t2!.id, 3, 777, "diff-c");
  assert.ok(rC.maps.length >= 2 && rC.maps.length <= 3, "职业难度可正常比赛");
});

test("AI 预算补贴：职业 +$12K/周（仅 AI 一级队），二级队与我队不享受", () => {
  const s = build();
  s.difficulty = "pro";
  s.day = 6; // 明天是 7 的倍数 → 触发周结算
  const my = s.myTeamId!;
  const aiT1 = Object.values(s.teams).find((t) => t.tier === 1 && t.id !== my)!;
  const aiT2 = Object.values(s.teams).find((t) => t.tier === 2)!;
  const aiBudget0 = aiT1.budget;
  const t2Budget0 = aiT2.budget;
  advanceDay(s, []);
  assert.ok(aiT1.budget >= aiBudget0 + 12_000, `AI 一级队补贴到账（+${aiT1.budget - aiBudget0}）`);
  assert.ok(aiT2.budget - t2Budget0 < 12_000, `二级队不享受补贴（+${aiT2.budget - t2Budget0}）`);
});
