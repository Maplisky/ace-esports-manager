/** 性能预算回归（v1.0-9，GDD §11.3）：推进 1 天 <50ms / 单图模拟 <30ms / 存档体积 <4MB。
 *  预热后取均值（冷启动 JIT 不计入）；预算按 GDD 验收口径断言。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resetPlayerSeq, generateWorld } from "../src/core/worldgen.ts";
import { initSeasonFixtures, advanceDay } from "../src/core/sim/day.ts";
import { resetFixtureSeq } from "../src/core/sim/fixtures.ts";
import { simMatch, applyMatchEffects } from "../src/core/sim/match.ts";
import { hashString } from "../src/core/rng.ts";
import type { GameState } from "../src/core/types.ts";

function build(seed = 2026): GameState {
  resetPlayerSeq();
  resetFixtureSeq();
  const state = generateWorld(seed);
  initSeasonFixtures(state);
  state.myTeamId = Object.values(state.teams).find((t) => t.tier === 1)!.id;
  return state;
}

test("§11.3：推进 1 天（世界演算）预热均值 < 50ms", () => {
  const s = build();
  for (let i = 0; i < 3; i++) advanceDay(s, []); // 预热 JIT
  const t0 = performance.now();
  const N = 12;
  for (let i = 0; i < N; i++) advanceDay(s, []);
  const avg = (performance.now() - t0) / N;
  console.log(`[bench] advanceDay avg = ${avg.toFixed(1)}ms（预算 50ms）`);
  assert.ok(avg < 50, `推进 1 天均值 ${avg.toFixed(1)}ms 超出 50ms 预算`);
});

test("§11.3：单图模拟（24 回合）预热均值 < 30ms", () => {
  const s = build();
  const teams = Object.values(s.teams).filter((t) => t.tier === 1);
  const mapLock = ["ascent"];
  for (let i = 0; i < 3; i++) {
    const rec = simMatch(s, teams[0]!.id, teams[1]!.id, 1, 1000 + i, "bench-warm", mapLock);
    applyMatchEffects(s, rec);
  }
  const t0 = performance.now();
  const N = 10;
  for (let i = 0; i < N; i++) {
    const rec = simMatch(s, teams[0]!.id, teams[1]!.id, 1, hashString(`bench:${i}`), `bench-${i}`, mapLock);
    applyMatchEffects(s, rec);
  }
  const avg = (performance.now() - t0) / N;
  console.log(`[bench] simMap(BO1) avg = ${avg.toFixed(1)}ms（预算 30ms）`);
  assert.ok(avg < 30, `单图模拟均值 ${avg.toFixed(1)}ms 超出 30ms 预算`);
});

test("§11.3：常规存档体积 < 4MB（40 天进度 + 我的比赛回放）", () => {
  const s = build(77);
  const records: Record<string, unknown> = {};
  for (let i = 0; i < 40; i++) {
    advanceDay(s, [], (rec, fid, mine) => {
      if (mine) records[fid] = rec; // 与 worker 相同的分级持久化口径
    });
  }
  const size = JSON.stringify({ state: s, records }).length;
  console.log(`[bench] save size = ${(size / 1024 / 1024).toFixed(2)}MB（预算 4MB）`);
  assert.ok(size < 4 * 1024 * 1024, `存档体积 ${(size / 1024 / 1024).toFixed(2)}MB 超出 4MB 预算`);
});
