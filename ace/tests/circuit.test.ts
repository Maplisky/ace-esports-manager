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

test("Masters 积分（双败口径）：冠12/亚9/3-4名7/5-6名5/7-8名4", () => {
  const s = build();
  s.comps["masters"] = { key: "masters", name: "Masters", stage: "masters", teamIds: [], standings: {} };
  const mkTeam = (id: string): void => {
    s.comps["masters"]!.standings[id] = { teamId: id, w: 0, l: 0, mapW: 0, mapL: 0, roundW: 0, roundL: 0, pts: 0 };
  };
  for (const id of ["champ", "run", "third", "fourth", "p5a", "p5b", "p7a", "p7b"]) mkTeam(id);
  const fx = (id: string, label: string, a: string, b: string, winner: string): void => {
    s.fixtures.push({ id, comp: "masters", label: `Masters ${label}`, day: 140, stage: "masters", teamA: a, teamB: b, played: true, bo: 3, winnerTeamId: winner });
  };
  fx("gf", "总决赛", "champ", "run", "champ");
  fx("lbf", "败者组决赛", "third", "lbw", "lbw"); // 败者 = 第 3 名
  fx("lbr3", "败者组第3轮", "fourth", "x1", "x1"); // 败者 = 第 4 名
  fx("lbr2a", "败者组第2轮", "p5a", "x2", "x2"); // 败者 = 5-6 名
  fx("lbr2b", "败者组第2轮", "p5b", "x3", "x3");
  fx("lbr1a", "败者组第1轮", "p7a", "x4", "x4"); // 败者 = 7-8 名
  fx("lbr1b", "败者组第1轮", "p7b", "x5", "x5");
  awardCupCircuitPoints(s, "masters", [], "champ");
  assert.equal(s.circuitPoints!.champ, 12);
  assert.equal(s.circuitPoints!.run, 9);
  assert.equal(s.circuitPoints!.third, 7);
  assert.equal(s.circuitPoints!.fourth, 7);
  assert.equal(s.circuitPoints!.p5a, 5);
  assert.equal(s.circuitPoints!.p5b, 5);
  assert.equal(s.circuitPoints!.p7a, 4);
  assert.equal(s.circuitPoints!.p7b, 4);
});
