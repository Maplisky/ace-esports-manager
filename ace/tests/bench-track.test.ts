import { test } from "node:test";
import assert from "node:assert/strict";
import { generateWorld, resetPlayerSeq } from "../src/core/worldgen.ts";
import { evaluateOffer, type OfferTerms } from "../src/core/sim/transfer.ts";
import type { GameState, Player } from "../src/core/types.ts";

function build(seed = 5): { state: GameState; myTeamId: string } {
  resetPlayerSeq();
  const s = generateWorld(seed);
  const myTeamId = Object.values(s.teams).find((t) => t.tier === 1)!.id;
  for (const t of Object.values(s.teams)) t.reputation = 50;
  return { state: s, myTeamId };
}

function youngPlayer(s: GameState, age = 20): Player {
  const pid = "young_test";
  s.players[pid] = {
    id: pid, ign: "小将", name: "小将", age, overall: 68, potential: 82, teamId: null,
    role: "duelist", agentPool: ["jett"], agentPro: { jett: 50 },
    attrs: { aim: 65, reaction: 68, awareness: 55, utility: 50, clutch: 55, teamwork: 60, communication: 55, igl: 30 },
    career: { maps: 20, rounds: 50, kills: 30, deaths: 25, assists: 6, firstKills: 4, firstDeaths: 5, clutches: 0, mvps: 0, titles: 0 },
    morale: 65, fatigue: 10, form: 65, salary: 90_000, contractYears: 1,
    promisedRole: "starter", listed: false, listedWeeks: 0, benchedWeeks: 0,
    injuredUntilDay: 0, isIgl: false, homegrown: false, noPoach: false,
    seed: 2, ambition: 60,
  } as unknown as Player;
  return s.players[pid]!;
}

function offerOf(track?: "successor" | "mentor" | "learner", role: "bench" | "starter" = "bench"): OfferTerms {
  return { fee: 500_000, salary: 120_000, years: 3, signingBonus: 50_000, promisedRole: role, track };
}

test("替补三正路谈判：接班人 ≤21 降档转收益（+8）", () => {
  const { state, myTeamId } = build();
  const p = youngPlayer(state, 20);
  const to = state.teams[myTeamId]!;
  const without = evaluateOffer(state, p, offerOf(undefined), to);
  const withTrack = evaluateOffer(state, p, offerOf("successor"), to);
  // 接班人计划：替补定位的负分（-16）翻转为 +8 → 态度显著更高
  assert.ok(withTrack.chance > without.chance, `接班人未提升意愿：无=${without.chance.toFixed(2)} 有=${withTrack.chance.toFixed(2)}`);
});

test("替补三正路谈判：导师型 ≥28 降档惩罚减半", () => {
  const { state, myTeamId } = build();
  const p = youngPlayer(state, 29);
  const to = state.teams[myTeamId]!;
  const without = evaluateOffer(state, p, offerOf(undefined), to);
  const withTrack = evaluateOffer(state, p, offerOf("mentor"), to);
  assert.ok(withTrack.chance > without.chance, `导师型未减轻降档惩罚：无=${without.chance.toFixed(2)} 有=${withTrack.chance.toFixed(2)}`);
});

test("替补三正路谈判：超龄接班人 / 低龄导师 不满足条件无加成", () => {
  const { state, myTeamId } = build();
  const old = youngPlayer(state, 24);
  const to = state.teams[myTeamId]!;
  const a1 = evaluateOffer(state, old, offerOf(undefined), to);
  const a2 = evaluateOffer(state, old, offerOf("successor"), to);
  assert.equal(a2.chance, a1.chance, "超龄接班人不应有加成");
  const kid = youngPlayer(state, 19);
  const b1 = evaluateOffer(state, kid, offerOf(undefined), to);
  const b2 = evaluateOffer(state, kid, offerOf("mentor"), to);
  assert.equal(b2.chance, b1.chance, "低龄导师不应有加成");
});
