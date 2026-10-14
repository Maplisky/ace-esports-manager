/** 练英雄（GDD §6.3 v0.8）：≤5 人/周、+4.2×效率、池外 34 入池、100 封顶、伤停/离队跳过 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateWorld } from "../src/core/worldgen.ts";
import { initSeasonFixtures, advanceDay } from "../src/core/sim/day.ts";

function setup(seed = 77) {
  const state = generateWorld(seed);
  initSeasonFixtures(state);
  state.myTeamId = Object.values(state.teams).find((t) => t.tier === 1)!.id;
  return state;
}

function settleWeeks(state: ReturnType<typeof setup>, weeks: number) {
  for (let i = 0; i < weeks * 7; i++) advanceDay(state);
}

test("练英雄：池内英雄按效率增长，池外 34 起步并达标入池", () => {
  const state = setup();
  const team = state.teams[state.myTeamId!];
  const p1 = state.players[team.roster[0]!]!;
  const p2 = state.players[team.roster[1]!]!;
  const poolAgent = p1.agentPool[0]!;
  const before = p1.agentPro[poolAgent] ?? 0;
  // 池外英雄：选一个不在 p2 池内的
  const newAgent = ["omen", "jett", "sova", "cypher"].find((a) => !p2.agentPool.includes(a))!;
  state.agentTraining = { [p1.id]: poolAgent, [p2.id]: newAgent };
  settleWeeks(state, 1);
  const eff1 = 0.7 + (p1.attrs.awareness + p1.attrs.utility) / 400;
  const gain1 = p1.agentPro[poolAgent]! - before;
  assert.ok(Math.abs(gain1 - 4.2 * eff1) < 0.01, `池内周增 ${gain1.toFixed(2)} 应 ≈ 4.2×${eff1.toFixed(2)}`);
  assert.ok((p2.agentPro[newAgent] ?? 0) >= 34 - 4.2, "池外从 34 起步结算");
  assert.ok(p2.agentPool.includes(newAgent), "达标（≥34）自动入池");
  assert.ok(state.news.some((n) => n.text.includes("正式进入英雄池")), "入池新闻");
});

test("练英雄：≤5 人守卫（core 结算截断）、满 100 封顶", () => {
  const state = setup();
  const team = state.teams[state.myTeamId!];
  const pids = team.roster.slice(0, 7);
  const picks: Record<string, string> = {};
  pids.forEach((pid) => { picks[pid] = state.players[pid]!.agentPool[0]!; });
  state.agentTraining = picks; // 7 人提交
  // core 结算只取前 5——第 6/7 人无增长
  const before = pids.map((pid) => state.players[pid]!.agentPro[state.players[pid]!.agentPool[0]!] ?? 0);
  settleWeeks(state, 1);
  const after = pids.map((pid) => state.players[pid]!.agentPro[state.players[pid]!.agentPool[0]!] ?? 0);
  const grown = before.map((b, i) => after[i]! - b).filter((d) => d > 0.1).length;
  assert.ok(grown <= 5, `增长人数 ${grown} ≤5`);
  // 封顶：直接拉满再结算
  const p0 = state.players[pids[0]!]!;
  p0.agentPro[p0.agentPool[0]!] = 100;
  settleWeeks(state, 1);
  assert.equal(p0.agentPro[p0.agentPool[0]!], 100);
});
