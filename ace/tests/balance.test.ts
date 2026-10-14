/**
 * 平衡性验收基准（GDD §12）：
 * T1: 87 分队对 72 分队 BO3 胜率 68-78%
 * T2: 同分队伍 BO3 胜率 47-53%
 * v0.7 注：单对合成夹具在 BP 环境下存在 ±5% 的实现差（英雄池×选图交互），
 * 对称性基准必须用多对独立夹具取均值——测的是引擎，不是某对队伍的运气。
 * 若失败：调整 strength.ts 的 ROUND_BASE_SCALE / 修正项，不改测试阈值。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Rng } from "../src/core/rng.ts";
import { makeSyntheticTeam, generateWorld } from "../src/core/worldgen.ts";
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

/** 装载一对合成夹具（不同 pair 用独立 Rng，避免同一对夹具的实现差淹没引擎信号） */
function loadPair(state: ReturnType<typeof benchState>, pair: number, targetA: number, targetB: number) {
  const rng = new Rng(1000 + pair * 17);
  const t1 = makeSyntheticTeam(`B${pair}A`, `S${pair}A`, targetA, rng);
  const t2 = makeSyntheticTeam(`B${pair}B`, `S${pair}B`, targetB, rng);
  state.teams[t1.team.id] = t1.team;
  state.teams[t2.team.id] = t2.team;
  for (const p of t1.players) state.players[p.id] = p;
  for (const p of t2.players) state.players[p.id] = p;
  return { a: t1.team.id, b: t2.team.id };
}

test("T1：87 vs 72 → BO3 胜率 68-78%（5 对夹具 × 400 场均值）", () => {
  const state = benchState();
  let wins = 0;
  let total = 0;
  for (let pair = 0; pair < 5; pair++) {
    const { a, b } = loadPair(state, pair, 87, 72);
    for (let i = 0; i < 400; i++) {
      resetVitality(state);
      const r = simMatch(state, a, b, 3, 50000 + pair * 100000 + i, `T1-${pair}-${i}`);
      if (r.winner === "A") wins++;
      total++;
    }
  }
  const rate = wins / total;
  assert.ok(rate >= 0.68 && rate <= 0.78, `强队胜率 ${rate.toFixed(3)} 超出 [0.68, 0.78]`);
});

test("T2：同分 → BO3 胜率 47-53%（6 对夹具 × 400 场均值）", () => {
  const state = benchState(999);
  let wins = 0;
  let total = 0;
  for (let pair = 0; pair < 6; pair++) {
    const { a, b } = loadPair(state, pair, 78, 78);
    for (let i = 0; i < 400; i++) {
      resetVitality(state);
      const r = simMatch(state, a, b, 3, 41277 + pair * 100000 + i, `T2-${pair}-${i}`);
      if (r.winner === "A") wins++;
      total++;
    }
  }
  const rate = wins / total;
  assert.ok(rate >= 0.47 && rate <= 0.53, `同分胜率 ${rate.toFixed(3)} 超出 [0.47, 0.53]`);
});

test("T3：地图内先攻方回合胜率接近 50%（防守 +1.5 下攻方不应被压制）", () => {
  const state = benchState(55);
  let atkRoundWins = 0;
  let totalRounds = 0;
  for (let pair = 0; pair < 2; pair++) {
    const { a, b } = loadPair(state, pair, 78, 78);
    for (let i = 0; i < 150; i++) {
      resetVitality(state);
      const r = simMatch(state, a, b, 3, 60000 + pair * 100000 + i, `T3-${pair}-${i}`);
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
  }
  const rate = atkRoundWins / totalRounds;
  assert.ok(rate >= 0.46 && rate <= 0.56, `进攻方回合胜率 ${rate.toFixed(3)} 超出 [0.46, 0.56]`);
});
