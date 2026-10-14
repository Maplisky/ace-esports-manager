/** agentLock 回归（v1.9 检错后续）：手动英雄选择进入引擎、每图独立、预案不受污染 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Rng } from "../src/core/rng.ts";
import { generateWorld, makeSyntheticTeam, resetPlayerSeq } from "../src/core/worldgen.ts";
import { simMatch } from "../src/core/sim/match.ts";

test("agentLock：指定英雄出现在 MatchRecord.agents，未指定的图不受影响", () => {
  resetPlayerSeq();
  const state = generateWorld(66);
  state.day = 30;
  const rng = new Rng(3);
  const t1 = makeSyntheticTeam("LA", "LA", 78, rng);
  const t2 = makeSyntheticTeam("LB", "LB", 78, rng);
  state.teams["LA"] = t1.team;
  state.teams["LB"] = t2.team;
  for (const p of t1.players) state.players[p.id] = p;
  for (const p of t2.players) state.players[p.id] = p;

  // 为第一张指定图构造英雄锁：每名首发换成其英雄池第一项
  const lockMap: Record<string, string> = {};
  for (const pid of t1.team.starters) lockMap[pid] = state.players[pid]!.agentPool[0]!;
  const agentLock = { split: lockMap };

  const rec = simMatch(state, "LA", "LB", 3, 999, "AL", ["split", "ascent", "icebox"], agentLock);
  // split（锁定的第一图）上 LA 首发的英雄 = 锁定英雄
  const map1 = rec.maps[0]!;
  assert.equal(map1.map, "split");
  for (const [pid, agentId] of Object.entries(lockMap)) {
    assert.equal(map1.agents[pid], agentId, `选手 ${pid} 应使用锁定英雄 ${agentId}`);
  }
  // 未锁定的图不受影响（正常生成 agents）
  const map2 = rec.maps[1]!;
  assert.ok(Object.keys(map2.agents).length >= 10);
});
