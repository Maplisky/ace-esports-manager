/** 情报系统回归（GDD §7.2 v0.5-3）：侦察积累/上限/衰减/★级评估/针对准备加成进引擎 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Rng } from "../src/core/rng.ts";
import { generateWorld, makeSyntheticTeam, resetPlayerSeq } from "../src/core/worldgen.ts";
import { initSeasonFixtures } from "../src/core/sim/day.ts";
import { addIntel, decayIntel, intelOf, intelLevel, estimateMapStrength, starsOf } from "../src/core/sim/intel.ts";
import { computeSide } from "../src/core/sim/strength.ts";
import { MAPS } from "../src/core/data/maps.ts";
import { simMatch } from "../src/core/sim/match.ts";

function setup() {
  resetPlayerSeq();
  const state = generateWorld(88);
  initSeasonFixtures(state);
  state.myTeamId = Object.values(state.teams).find((t) => t.tier === 1)!.id;
  state.day = 30;
  return state;
}

test("侦察：+2/次上限 10，周衰减 0.5 不为负，等级映射", () => {
  const state = setup();
  addIntel(state, "T1");
  addIntel(state, "T1");
  assert.equal(intelOf(state, "T1"), 4);
  for (let i = 0; i < 10; i++) addIntel(state, "T1");
  assert.equal(intelOf(state, "T1"), 10, "上限 10");
  decayIntel(state);
  assert.equal(intelOf(state, "T1"), 9.5);
  for (let i = 0; i < 30; i++) decayIntel(state);
  assert.equal(intelOf(state, "T1"), 0, "衰减不为负");
  assert.equal(intelLevel(9.5), 3);
  assert.equal(intelLevel(4), 2);
  assert.equal(intelLevel(1), 1);
  assert.equal(intelLevel(0), 0);
});

test("图池评估：★级映射与边界", () => {
  const state = setup();
  const opp = Object.values(state.teams).find((t) => t.id !== state.myTeamId)!;
  const m = MAPS[0]!;
  opp.mapPref[m.id] = 90;
  assert.equal(starsOf(estimateMapStrength(state, opp, m)), 3);
  opp.mapPref[m.id] = 20;
  assert.equal(starsOf(estimateMapStrength(state, opp, m)), 1);
});

test("针对准备：情报转化为强度加成（10 点 = +2.2）", () => {
  const state = setup();
  const rng = new Rng(5);
  const t1 = makeSyntheticTeam("IA", "IA", 78, rng);
  const t2 = makeSyntheticTeam("IB", "IB", 78, rng);
  state.teams["IA"] = t1.team;
  state.teams["IB"] = t2.team;
  for (const p of t1.players) state.players[p.id] = p;
  for (const p of t2.players) state.players[p.id] = p;
  const m = MAPS[0]!;
  const base = computeSide({ team: t1.team, players: state.players, map: m, day: 30 });
  const scouted = computeSide({ team: t1.team, players: state.players, map: m, day: 30, intel: 10 });
  assert.equal(scouted.edge.prep, 2.2);
  assert.ok(scouted.atk > base.atk);
});

test("比赛：我方有情报时 MatchRecord 中针对准备为 2.2", () => {
  const state = setup();
  const rng = new Rng(11);
  const t1 = makeSyntheticTeam("MA", "MA", 78, rng);
  const t2 = makeSyntheticTeam("MB", "MB", 78, rng);
  state.teams["MA"] = t1.team;
  state.teams["MB"] = t2.team;
  for (const p of t1.players) state.players[p.id] = p;
  for (const p of t2.players) state.players[p.id] = p;
  addIntel(state, "MB", 10);
  state.myTeamId = "MA"; // 情报属于"我方对对手"——simMatch 按我方视角读取
  const rec = simMatch(state, "MA", "MB", 3, 424242, "INT");
  assert.ok(rec.maps.length > 0);
  assert.equal(rec.maps[0]!.edges.A.prep, 2.2, "我方对已侦察对手应有满额针对准备");
});
