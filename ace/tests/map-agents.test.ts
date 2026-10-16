/** 用户反馈批次②：地图成分（开阔/走廊/点位/垂直）必须影响自动英雄分配——
 *  同一套阵容在不同结构图的英雄组合应随之变化（此前 assignAgents 完全图盲）。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateWorld, makeSyntheticTeam, resetPlayerSeq } from "../src/core/worldgen.ts";
import { Rng } from "../src/core/rng.ts";
import { computeSide } from "../src/core/sim/strength.ts";
import { MAPS } from "../src/core/data/maps.ts";
import type { GameState } from "../src/core/types.ts";

function buildLineup(): { state: GameState; initPid: string } {
  resetPlayerSeq();
  const rng = new Rng(3);
  const t1 = makeSyntheticTeam("TA", "我队", 80, rng);
  const t2 = makeSyntheticTeam("TB", "对手", 78, rng);
  const state = generateWorld(3);
  state.teams["TA"] = t1.team;
  state.teams["TB"] = t2.team;
  for (const p of t1.players) state.players[p.id] = p;
  for (const p of t2.players) state.players[p.id] = p;
  state.day = 60;
  // 定制池：各标准位职责单一、等熟练度（60），让地图成分成为唯一决定因素；
  // initiator 位双候选 sova（侦察，开阔图增值）vs breach（强开，封闭走廊图增值）
  const poolPlan = [["jett", "raze"], ["sova", "breach"], ["brimstone", "omen"], ["killjoy", "sage"], ["jett", "brimstone"]];
  const team = state.teams["TA"]!;
  team.starters.forEach((pid, i) => {
    const p = state.players[pid]!;
    const pool = poolPlan[i]!;
    p.agentPool = [...pool];
    p.agentPro = Object.fromEntries(pool.map((a) => [a, 60]));
  });
  return { state, initPid: team.starters[1]! };
}

test("地图成分驱动自动英雄分配：开阔图选侦察系 initiator、封闭走廊图选强开系", () => {
  const { state, initPid } = buildLineup();
  const team = state.teams["TA"]!;
  const breeze = MAPS.find((m) => m.id === "breeze")!; // openness 0.85 / corridor 0.70 → sova fit 1.175 vs breach 0.97
  const bind = MAPS.find((m) => m.id === "bind")!; // openness 0.40 / corridor 0.40 → breach 1.015 vs sova 0.95
  const sBreeze = computeSide({ team, players: state.players, map: breeze, day: state.day });
  const sBind = computeSide({ team, players: state.players, map: bind, day: state.day });
  assert.equal(sBreeze.agents[initPid], "sova", "开阔图侦察增值 → 自动分配 sova");
  assert.equal(sBind.agents[initPid], "breach", "封闭图强开增值 → 自动分配 breach");
  assert.notDeepEqual(sBreeze.agents, sBind.agents, "同一阵容跨图的英雄组合随地图成分变化");
});

test("玩家预案/手动锁仍最高优先：agentAssign 覆盖自动分配（GDD §7.1 口径不回归）", () => {
  const { state } = buildLineup();
  const team = state.teams["TA"]!;
  const bind = MAPS.find((m) => m.id === "bind")!;
  const starters = team.starters;
  // 手动把 initiator 位锁到 sova（图盲选择）→ 引擎尊重锁定
  const lock = Object.fromEntries(starters.map((pid, i) => [pid, i === 1 ? "sova" : ["jett", "breach", "brimstone", "killjoy", "jett"][i]!]));
  const s = computeSide({ team, players: state.players, map: bind, day: state.day, agentAssign: lock });
  assert.equal(s.agents[starters[1]!], "sova", "手动锁优先于图适建议");
});
