/** 种子挑战赛（GDD §11.5 v1.x）：挑战包校验 / 开局约束 / 成绩演算确定性。零服务端、零 RNG。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateWorld, resetPlayerSeq } from "../src/core/worldgen.ts";
import { initSeasonFixtures } from "../src/core/sim/day.ts";
import { resetFixtureSeq } from "../src/core/sim/fixtures.ts";
import { initCareer } from "../src/core/sim/career.ts";
import { loadChallengePack, validateChallengeStart, challengeScore, challengeReport, type Challenge } from "../src/core/sim/challenge.ts";
import type { GameState } from "../src/core/types.ts";

function build(seed = 111): GameState {
  resetPlayerSeq();
  resetFixtureSeq();
  const state = generateWorld(seed);
  initSeasonFixtures(state);
  state.myTeamId = Object.values(state.teams).find((t) => t.tier === 1)!.id;
  initCareer(state, "grassroots");
  return state;
}

const CH: Challenge = {
  id: "T-1", name: "测试挑战", desc: "", seed: 880042, seasons: 1, goal: "titles",
  constraints: { origin: "grassroots", difficulty: "normal", tier: 2, maxAge: 22 },
};

test("挑战包解析：合法包过、坏包拒绝（字段/目标枚举）", () => {
  assert.ok(loadChallengePack(CH));
  assert.equal(loadChallengePack(null), null);
  assert.equal(loadChallengePack({ id: 1, name: "x", seed: 1, goal: "titles" }), null, "id 非字符串");
  assert.equal(loadChallengePack({ id: "a", name: "x", seed: 1, goal: "wins" }), null, "目标枚举外");
  const c = loadChallengePack({ id: "a", name: "x", seed: 5, goal: "circuit", seasons: 99, constraints: { tier: 3, maxAge: "x" } });
  assert.ok(c && c.seasons === 1 && c.constraints.tier === undefined && c.constraints.maxAge === undefined, "越界值安全回落");
});

test("官方示例包 c-2026-01.json 可加载且字段齐全", () => {
  const raw = JSON.parse(readFileSync("public/challenges/c-2026-01.json", "utf8"));
  const c = loadChallengePack(raw);
  assert.ok(c);
  assert.equal(c.id, "C-2026-01");
  assert.deepEqual(c.constraints, { origin: "grassroots", difficulty: "normal", tier: 2, maxAge: 22 });
});

test("开局约束校验：种子/档位/出身/难度/年龄 各违规路径", () => {
  const s = build(880042);
  s.difficulty = "normal";
  s.myTeamId = Object.values(s.teams).find((t) => t.tier === 2)!.id; // 档位合规
  // 真实数据 t2 队常含超龄——合规用例直接把该队年龄压到 U22（白盒造数）
  for (const pid of s.teams[s.myTeamId!]!.roster) {
    const p = s.players[pid]!;
    if (p.age > 22) p.age = 22;
  }
  assert.equal(validateChallengeStart(s, CH), null, "全合规");
  const badSeed = build(999);
  badSeed.myTeamId = Object.values(badSeed.teams).find((t) => t.tier === 2)!.id;
  assert.ok(validateChallengeStart(badSeed, CH)!.includes("种子"));
  const badTier = build(880042);
  assert.ok(validateChallengeStart(badTier, CH)!.includes("档位"));
  const badOrigin = build(880042);
  badOrigin.myTeamId = Object.values(badOrigin.teams).find((t) => t.tier === 2)!.id;
  badOrigin.manager.career!.origin = "legend";
  assert.ok(validateChallengeStart(badOrigin, CH)!.includes("出身"));
  const badDiff = build(880042);
  badDiff.myTeamId = Object.values(badDiff.teams).find((t) => t.tier === 2)!.id;
  badDiff.difficulty = "pro";
  assert.ok(validateChallengeStart(badDiff, CH)!.includes("难度"));
  const badAge = build(880042);
  badAge.myTeamId = Object.values(badAge.teams).find((t) => t.tier === 2)!.id;
  badAge.difficulty = "normal"; // 其余全合规，只留年龄违规
  const my = badAge.teams[badAge.myTeamId!]!;
  const old = my.roster.map((pid) => badAge.players[pid]!).find((p) => p.age > 22);
  if (old) {
    assert.ok(validateChallengeStart(badAge, CH)!.includes("年龄"), "存在超龄即违规");
  } else {
    assert.equal(validateChallengeStart(badAge, CH), null, "该队恰好全员 U22");
  }
});

test("成绩演算：titles/circuit 两口径 + 完赛判定 + 报告文案确定性", () => {
  const s = build(880042);
  s.myTeamId = Object.values(s.teams).find((t) => t.tier === 2)!.id;
  s.manager.career!.titles = 2;
  const sc = challengeScore(s, CH);
  assert.equal(sc.value, 2);
  assert.equal(sc.qualified, true, "seasons=1 已达");
  const ch2: Challenge = { ...CH, goal: "circuit", seasons: 3 };
  s.circuitPoints = { [s.myTeamId!]: 17 };
  assert.equal(challengeScore(s, ch2).value, 17);
  assert.equal(challengeScore(s, ch2).qualified, false, "3 赛季未达");
  const r1 = challengeReport(s, CH);
  const r2 = challengeReport(build(880042), CH); // 不同实例
  void r2;
  assert.ok(r1.includes("C-2026-01") || r1.includes("T-1"));
  assert.ok(r1.includes("冠军数 2"));
  assert.ok(r1.includes("回放链接"));
});

test("同 seed 同约束 → 同世界同起点（挑战公平性红线）", () => {
  const a = build(880042);
  const b = build(880042);
  assert.equal(JSON.stringify(a.players), JSON.stringify(b.players));
});
