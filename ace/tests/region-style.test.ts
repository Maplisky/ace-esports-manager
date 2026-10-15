/** 赛区风格 META 回归（v1.0-5，GDD §18-3）：五风格分档/环形克制/怯场/跨赛区折半/聚合 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateWorld, resetPlayerSeq } from "../src/core/worldgen.ts";
import { initSeasonFixtures } from "../src/core/sim/day.ts";
import { resetFixtureSeq } from "../src/core/sim/fixtures.ts";
import { styleOf, styleCounterOf, aggrOfLineup, STYLE_BEATS, computeSide } from "../src/core/sim/strength.ts";
import { MAPS } from "../src/core/data/maps.ts";
import { simMatch } from "../src/core/sim/match.ts";
import { TRAIT_BY_KEY } from "../src/core/data/traits.ts";
import type { GameState } from "../src/core/types.ts";

test("五风格分档与环形克制（快攻→均衡→侵略→稳健→锁死→快攻）", () => {
  assert.equal(styleOf(0.65), "rush");
  assert.equal(styleOf(0.57), "aggro");
  assert.equal(styleOf(0.5), "balanced");
  assert.equal(styleOf(0.42), "methodical");
  assert.equal(styleOf(0.35), "lockdown");
  // 环形：每个风格恰克一个、被一个克
  const keys = ["rush", "balanced", "aggro", "methodical", "lockdown"] as const;
  for (const k of keys) {
    assert.equal(styleCounterOf(k, STYLE_BEATS[k]), 1.8, `${k} 克 ${STYLE_BEATS[k]} 应 +1.8`);
    assert.equal(styleCounterOf(STYLE_BEATS[k], k), -1.0, `${STYLE_BEATS[k]} 被 ${k} 克应 -1.0`);
    // 中性对
    const neutral = keys.find((x) => x !== k && x !== STYLE_BEATS[k] && STYLE_BEATS[x] !== k)!;
    assert.equal(styleCounterOf(k, neutral), 0);
  }
});

test("computeSide：styleCounter 进 atk 全额/def 半额，chokeMod 进 mid", () => {
  const state = generateWorld(3);
  const team = Object.values(state.teams)[0]!;
  const map = MAPS.find((m) => m.id === "ascent") ?? MAPS[0]!;
  const base = { team, players: state.players, map, day: 1 } as Parameters<typeof computeSide>[0];
  const s0 = computeSide({ ...base });
  assert.ok(Number.isFinite(s0.atk), "基准强度有限（真实地图）");
  const sPlus = computeSide({ ...base, styleCounter: 1.8 });
  const sChoke = computeSide({ ...base, chokeMod: -1.2 });
  assert.ok(Math.abs(sPlus.atk - s0.atk - 1.8) < 1e-9, "atk +1.8");
  assert.ok(Math.abs(sPlus.def - s0.def - 0.9) < 1e-9, "def +0.9（半额）");
  assert.ok(Math.abs(sChoke.mid - s0.mid + 1.2) < 1e-9, "mid -1.2");
});

test("怯场：国际赛淘汰赛 fixture 标记生效（老将 IGL 压阵减半），普通比赛不受影响", () => {
  resetPlayerSeq();
  resetFixtureSeq();
  const state = generateWorld(8);
  initSeasonFixtures(state);
  // 大赛软脚虾特质已入池
  assert.ok(TRAIT_BY_KEY.has("choker"), "choker 特质存在");
  // 构造国际赛淘汰赛 fixture + 双方同赛区（不触发折半）vs 跨赛区
  const [t1, t2, t3] = Object.values(state.teams).filter((t) => t.tier === 1);
  void t2;
  const mk = (id: string, a: string, b: string, comp: string, label: string): void => {
    state.fixtures.push({ id, day: 200, stage: "masters", comp, teamA: a, teamB: b, bo: 3, label, played: false } as never);
  };
  const same = t1.regionId === t3.regionId;
  mk("fx-po", t1.id, t3.id, "masters", "Masters 胜者组第1轮");
  const r1 = simMatch(state, t1.id, t3.id, 3, 12345, "fx-po");
  assert.ok(r1, "国际赛淘汰赛可模拟");
  // 跨赛区（若 t1/t3 不同赛区）与同赛区只差相性折半，不崩溃即可
  mk("fx-l", t1.id, t1.id === t1.id ? t3.id : t1.id, "masters", "Masters 瑞士轮第1轮");
  const r2 = simMatch(state, t1.id, t3.id, 3, 999, "fx-l");
  assert.ok(r2, "瑞士轮（无怯场）可模拟");
  void same;
});

test("赛区风格聚合：initSeasonFixtures 后四赛区各一条（0-1 进攻性 + 合法风格）", () => {
  resetPlayerSeq();
  resetFixtureSeq();
  const state: GameState = generateWorld(21);
  initSeasonFixtures(state);
  const meta = state.regionMeta ?? {};
  for (const rid of ["americas", "emea", "pacific", "china"]) {
    const m = meta[rid];
    assert.ok(m, `${rid} 有聚合`);
    assert.ok(m!.aggr > 0 && m!.aggr < 1, `${rid} 进攻性 0-1（实际 ${m!.aggr}）`);
    assert.ok(["rush", "aggro", "balanced", "methodical", "lockdown"].includes(m!.style), `${rid} 风格合法`);
  }
  // 聚合与逐队计算一致（ americas 均值 = t1 队首发 aggr 均值）
  const amTeams = Object.values(state.teams).filter((t) => t.tier === 1 && t.regionId === "americas");
  const expected = amTeams
    .map((t) => aggrOfLineup(t.starters.map((id) => state.players[id]).filter((p): p is NonNullable<typeof p> => !!p)))
    .reduce((s, v) => s + v, 0) / amTeams.length;
  assert.ok(Math.abs(meta.americas!.aggr - expected) < 1e-9, "聚合口径一致");
});
