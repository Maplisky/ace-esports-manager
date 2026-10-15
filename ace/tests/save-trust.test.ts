/** 存档信任回归（v1.0-9，GDD §11.4）：载荷校验 / 旧结构 golden / 导出导入逐位往返。
 *  save.ts 的 IDB 访问全在函数体内，node 导入安全；此处只测纯函数。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resetPlayerSeq, generateWorld } from "../src/core/worldgen.ts";
import { initSeasonFixtures } from "../src/core/sim/day.ts";
import { resetFixtureSeq } from "../src/core/sim/fixtures.ts";
import { validateSavePayload, importJson, exportJson } from "../src/app/save.ts";
import type { GameState, MatchRecord } from "../src/core/types.ts";

function build(seed = 101): GameState {
  resetPlayerSeq();
  resetFixtureSeq();
  const state = generateWorld(seed);
  initSeasonFixtures(state);
  state.myTeamId = Object.values(state.teams).find((t) => t.tier === 1)!.id;
  return state;
}

test("载荷校验：合法结构通过；垃圾/缺字段/坏 records 拒绝", () => {
  const s = build();
  assert.ok(validateSavePayload({ state: s, records: {}, savedAt: "x" }), "合法载荷通过");
  assert.equal(validateSavePayload(null), null);
  assert.equal(validateSavePayload("string"), null);
  assert.equal(validateSavePayload({ records: {} }), null, "缺 state 拒绝");
  assert.equal(validateSavePayload({ state: { day: 1 }, records: {} }), null, "state 缺 fixtures/year 拒绝");
  assert.equal(validateSavePayload({ state: s, records: [] }), null, "records 非对象拒绝");
  assert.ok(validateSavePayload({ state: s }), "records 缺省补 {}（旧导出兼容）");
});

test("golden save：v1.0-7 时代旧结构（无 settled/interventions/draftPickMoves/difficulty）通过校验", () => {
  const s = build();
  // 剥掉 v1.0-8/9 引入的字段，模拟旧档
  for (const f of s.fixtures) {
    delete f.settled;
    delete f.interventions;
  }
  delete s.draftPickMoves;
  delete s.difficulty;
  const legacy = { state: structuredClone(s), records: {}, savedAt: "2026-10-01T00:00:00.000Z" };
  const ok = validateSavePayload(legacy);
  assert.ok(ok, "旧结构载荷通过校验（worker migrate 负责补字段）");
  assert.equal(ok!.records !== undefined, true);
  // 旧档语义：played 场次 settled 字段缺省（读档回填 true 的前提）
  assert.equal(s.fixtures.every((f) => f.settled === undefined), true);
});

test("导出导入往返：exportJson → importJson 逐位一致（信任玩家的基石）", () => {
  const s = build();
  s.day = 42;
  const records: Record<string, MatchRecord> = {
    F1: { id: "F1", seed: 7, format: 1, teamA: "A", teamB: "B", stage: "cup", day: 10, maps: [], score: [1, 0], winner: "A", mvp: null } as MatchRecord,
  };
  const text = exportJson(s, records);
  const back = importJson(text);
  assert.ok(back, "导出文件可再导入");
  assert.equal(JSON.stringify(back!.state), JSON.stringify(s), "state 逐位一致");
  assert.equal(JSON.stringify(back!.records), JSON.stringify(records), "records 逐位一致");
  assert.equal(importJson("{bad json"), null, "坏 JSON 拒绝");
  assert.equal(importJson(JSON.stringify({ hello: 1 })), null, "非存档 JSON 拒绝");
});
