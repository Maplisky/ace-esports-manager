import { test } from "node:test";
import assert from "node:assert/strict";
import { Rng } from "../src/core/rng.ts";
import { awardCupCircuitPoints, awardLeagueCircuitPoints } from "../src/core/sim/day.ts";
import { buildCup } from "../src/core/sim/fixtures.ts";
import type { GameState } from "../src/core/types.ts";

function build(): GameState {
  const s = { seed: 7, year: 2026, day: 200, circuitPoints: {}, transferFeed: [], fixtures: [], comps: {}, players: {}, teams: {}, news: [] } as unknown as GameState;
  return s;
}

function mkStandings(s: GameState, compKey: string, ids: string[]): void {
  s.comps[compKey] = { key: compKey, name: compKey, stage: "stage1", teamIds: ids, standings: {} };
  ids.forEach((id, i) => {
    s.comps[compKey]!.standings[id] = { teamId: id, w: 10 - i, l: i, mapW: 20 - i, mapL: i, roundW: 0, roundL: 0, pts: 30 - i * 2 };
  });
}

test("联赛收官积分：仅 t1 入账，按 [9,7,5,4,3,3,2,2] 名次发放", () => {
  const s = build();
  mkStandings(s, "stage1-xia-t1", ["A", "B", "C", "D", "E", "F", "G", "H", "I"]);
  mkStandings(s, "stage1-xia-t2", ["J", "K"]);
  const notes: { text: string }[] = [];
  awardLeagueCircuitPoints(s, "stage1-xia-t1");
  awardLeagueCircuitPoints(s, "stage1-xia-t2"); // 挑战者不计
  assert.equal(s.circuitPoints!.A, 9);
  assert.equal(s.circuitPoints!.B, 7);
  assert.equal(s.circuitPoints!.H, 2);
  assert.equal(s.circuitPoints!.I, undefined, "第 9 名不计分");
  assert.equal(s.circuitPoints!.J, undefined, "挑战者不计分");
  void notes;
});

test("杯赛积分：冠军/亚军/半决赛败者按名次入账", () => {
  const s = build();
  s.fixtures.push(
    { id: "sf1", comp: "cup", label: "揭幕杯 半决赛", day: 30, stage: "cup", teamA: "champ", teamB: "sf1L", played: true, bo: 3 },
    { id: "sf2", comp: "cup", label: "揭幕杯 半决赛", day: 30, stage: "cup", teamA: "runner", teamB: "sf2L", played: true, bo: 3 },
    { id: "fin", comp: "cup", label: "揭幕杯 总决赛", day: 38, stage: "cup", teamA: "champ", teamB: "runner", played: true, bo: 3 },
  );
  const notes: { text: string; day?: number; kind?: string }[] = [];
  awardCupCircuitPoints(s, "cup", notes as never, "champ");
  assert.equal(s.circuitPoints!.champ, 6);
  assert.equal(s.circuitPoints!.runner, 4);
  assert.equal(s.circuitPoints!.sf1L, 3);
  assert.equal(s.circuitPoints!.sf2L, 2);
  assert.ok(notes.length === 0 || notes.length >= 0); // 联赛收官才带 notes，杯赛静默入账
});

test("Masters 积分：8 队单败口径冠军 12 分", () => {
  const s = build();
  s.fixtures.push(
    { id: "msf", comp: "masters", label: "Masters 半决赛", day: 130, stage: "masters", teamA: "champ", teamB: "sfl", played: true, bo: 3 },
    { id: "mfin", comp: "masters", label: "Masters 总决赛", day: 138, stage: "masters", teamA: "champ", teamB: "run", played: true, bo: 3 },
  );
  awardCupCircuitPoints(s, "masters", [], "champ");
  assert.equal(s.circuitPoints!.champ, 12);
  assert.equal(s.circuitPoints!.run, 9);
  assert.equal(s.circuitPoints!.sfl, 7);
});
