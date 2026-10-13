/**
 * 平衡性验收基准（GDD §12）：
 * T1: 87 分队对 72 分队 BO3 胜率 68-78%
 * T2: 同分队伍 BO3 胜率 47-53%
 * 若失败：调整 strength.ts 的 ROUND_BASE_SCALE / 修正项，不改测试阈值。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Rng } from "../src/core/rng.ts";
import { makeSyntheticTeam } from "../src/core/worldgen.ts";
import { generateWorld } from "../src/core/worldgen.ts";
import { simMatch } from "../src/core/sim/match.ts";

function benchState(seed = 2026) {
  const state = generateWorld(seed);
  state.day = 30;
  return state;
}

/** 重置全员活力状态（模拟周结算恢复）。simMatch 会改 form/morale/fatigue，
 *  基准若在同 state 连跑 N 场而不恢复，会形成"赢家棘轮"放大胜率——非引擎不公。 */
function resetVitality(state: ReturnType<typeof benchState>): void {
  for (const p of Object.values(state.players)) {
    p.form = 70;
    p.morale = 68;
    p.fatigue = 10;
    p.injuredUntilDay = 0;
  }
}

test("T1：87 vs 72 → BO3 胜率 68-78%（1000 场）", () => {
  const state = benchState();
  const rng = new Rng(31337);
  const strong = makeSyntheticTeam("B1", "STR", 87, rng);
  const weak = makeSyntheticTeam("B2", "WEK", 72, rng);
  state.teams["B1"] = strong.team;
  state.teams["B2"] = weak.team;
  for (const p of strong.players) state.players[p.id] = p;
  for (const p of weak.players) state.players[p.id] = p;
  const N = 1000;
  let wins = 0;
  for (let i = 0; i < N; i++) {
    resetVitality(state);
    const r = simMatch(state, "B1", "B2", 3, 50000 + i, `T1-${i}`);
    if (r.winner === "A") wins++;
  }
  const rate = wins / N;
  assert.ok(rate >= 0.68 && rate <= 0.78, `强队胜率 ${rate.toFixed(3)} 超出 [0.68, 0.78]`);
});

test("T2：同分 → BO3 胜率 47-53%（600 场）", () => {
  const state = benchState(999);
  const rng = new Rng(777);
  const t1 = makeSyntheticTeam("E1", "EQ1", 78, rng);
  const t2 = makeSyntheticTeam("E2", "EQ2", 78, rng);
  state.teams["E1"] = t1.team;
  state.teams["E2"] = t2.team;
  for (const p of t1.players) state.players[p.id] = p;
  for (const p of t2.players) state.players[p.id] = p;
  const N = 600;
  let wins = 0;
  for (let i = 0; i < N; i++) {
    resetVitality(state);
    const r = simMatch(state, "E1", "E2", 3, 80000 + i, `T2-${i}`);
    if (r.winner === "A") wins++;
  }
  const rate = wins / N;
  assert.ok(rate >= 0.47 && rate <= 0.53, `同分胜率 ${rate.toFixed(3)} 超出 [0.47, 0.53]`);
});

test("T3：地图内先攻方回合胜率接近 50%（防守 +1.5 下攻方不应被压制）", () => {
  const state = benchState(55);
  const rng = new Rng(4242);
  const t1 = makeSyntheticTeam("S1", "SYM1", 78, rng);
  const t2 = makeSyntheticTeam("S2", "SYM2", 78, rng);
  state.teams["S1"] = t1.team;
  state.teams["S2"] = t2.team;
  for (const p of t1.players) state.players[p.id] = p;
  for (const p of t2.players) state.players[p.id] = p;
  const N = 300;
  let atkRoundWins = 0;
  let totalRounds = 0;
  for (let i = 0; i < N; i++) {
    resetVitality(state);
    const r = simMatch(state, "S1", "S2", 3, 60000 + i, `T3-${i}`);
    for (const m of r.maps) {
      // 只统计非手枪回合（经济因素干扰小）
      for (const rd of m.rounds) {
        if (rd.n === 1 || rd.n === 13) continue;
        totalRounds++;
        if (
          (rd.atk === "A" && rd.end.win === "A") ||
          (rd.atk === "B" && rd.end.win === "B")
        ) {
          atkRoundWins++;
        }
      }
    }
  }
  const rate = atkRoundWins / totalRounds;
  assert.ok(rate >= 0.46 && rate <= 0.56, `进攻方回合胜率 ${rate.toFixed(3)} 超出 [0.46, 0.56]`);
});
