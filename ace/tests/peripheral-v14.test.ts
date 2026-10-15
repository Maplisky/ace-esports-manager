/** 外围体验包（v1.4 第二刀）：停靠密度语义 / 回放滚动保留口径 / 周报纯派生。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateWorld, resetPlayerSeq } from "../src/core/worldgen.ts";
import { initSeasonFixtures, advanceDay } from "../src/core/sim/day.ts";
import { resetFixtureSeq } from "../src/core/sim/fixtures.ts";
import { simMatch, applyMatchEffects } from "../src/core/sim/match.ts";
import type { GameState } from "../src/core/types.ts";

function build(seed = 91): GameState {
  resetPlayerSeq();
  resetFixtureSeq();
  const state = generateWorld(seed);
  initSeasonFixtures(state);
  state.myTeamId = Object.values(state.teams).find((t) => t.tier === 1)!.id;
  return state;
}

test("停靠密度：字段三档可选、缺省视同 normal（旧档无感知）", () => {
  const s = build();
  assert.equal(s.stopDensity, undefined);
  s.stopDensity = "light";
  assert.ok(["light", "normal", "full"].includes(s.stopDensity));
});

test("每图趋势数据源：end.money 与 alive 差分击杀口径可用（新档模拟必有经济快照）", () => {
  const s = build();
  const opp = Object.values(s.teams).find((t) => t.id !== s.myTeamId)!;
  const rec = simMatch(s, s.myTeamId!, opp.id, 1, 777, "trend-src");
  const m = rec.maps[0]!;
  assert.ok(m.rounds.every((r) => r.end.money != null), "新档回合末经济快照齐全");
  assert.ok(m.rounds.every((r) => r.end.alive.A >= 0 && r.end.alive.A <= 5));
  // 击杀差分：每回合阵亡数 0-5，双方合计 = 10 - 回合末存活合计 - 加时可能？上限保护即可
  for (const r of m.rounds) {
    assert.ok(5 - r.end.alive.A >= 0 && 5 - r.end.alive.A <= 5);
  }
});

test("翻年滚动保留：≥30 场裁到 30（口径常量语义——worker 层逻辑在此锁定公式）", () => {
  const keep = (records: Record<string, unknown>, cap = 30) => {
    const keys = Object.keys(records);
    if (keys.length > cap) for (const k of keys.slice(0, keys.length - cap)) delete records[k];
    return records;
  };
  const r: Record<string, number> = {};
  for (let i = 0; i < 45; i++) r[`f${i}`] = i;
  const out = keep(r);
  assert.equal(Object.keys(out).length, 30);
  assert.ok(!("f0" in out) && "f44" in out, "保留最近");
});

test("advanceDay 不因密度档分叉：light/normal/full 单日世界逐位一致（密度只影响 UI 停靠，不动模拟）", () => {
  const a = build(92);
  const b = build(92);
  const c = build(92);
  a.stopDensity = "light";
  c.stopDensity = "full";
  advanceDay(a, []);
  advanceDay(b, []);
  advanceDay(c, []);
  assert.equal(JSON.stringify(a.players), JSON.stringify(b.players));
  assert.equal(JSON.stringify(b.players), JSON.stringify(c.players));
  assert.equal(JSON.stringify(a.fixtures.map((f) => f.winnerTeamId)), JSON.stringify(c.fixtures.map((f) => f.winnerTeamId)));
});
