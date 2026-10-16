/** 开局引导回归：D1-D20 解锁表 + 首场普通赛口径（v1.0-16：教学脚本局已删除，由新手教程模式接管）。
 *  解锁由当年天数+赛季数推导（旧档/第二赛季天然全开，零迁移）。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resetPlayerSeq, generateWorld } from "../src/core/worldgen.ts";
import { initSeasonFixtures, playHeldMatch, settleMatch } from "../src/core/sim/day.ts";
import { resetFixtureSeq } from "../src/core/sim/fixtures.ts";
import { initCareer } from "../src/core/sim/career.ts";
import { evaluateAchievements } from "../src/core/sim/achievements.ts";
import { pageUnlocked, pageUnlockDay } from "../src/app/guide.ts";
import { TUTORIAL_STEPS, PAGE_HELP, TUT_ID, TUTORIAL_GRADUATION } from "../src/app/tutorial/content.ts";
import { simMatch } from "../src/core/sim/match.ts";
import type { GameState, NewsItem } from "../src/core/types.ts";

function build(seed = 121): GameState {
  resetPlayerSeq();
  resetFixtureSeq();
  const state = generateWorld(seed);
  initSeasonFixtures(state);
  state.myTeamId = Object.values(state.teams).find((t) => t.tier === 1)!.id;
  initCareer(state, "grassroots");
  return state;
}

const dummy = (): NewsItem[] => [];

function myFixture(s: GameState) {
  const f = s.fixtures.find((x) => !x.played && x.teamA !== "" && x.teamB !== "" && (x.teamA === s.myTeamId || x.teamB === s.myTeamId));
  assert.ok(f);
  return f;
}

test("v1.0-16 回归：生涯首场即普通赛——全额入账（生涯/成就/胜负），无教学局特殊口径", () => {
  const s = build();
  const f = myFixture(s);
  const rec = playHeldMatch(s, f.id, {});
  assert.ok(rec);
  const myId = f.teamA === s.myTeamId ? f.teamA : f.teamB;
  const oppId = f.teamA === s.myTeamId ? f.teamB : f.teamA;
  const myP = s.players[s.teams[myId]!.starters[0]!]!;
  const kills0 = myP.career.kills;
  const settled = settleMatch(s, f.id, rec, () => {});
  assert.equal(settled, true);
  assert.ok(myP.career.kills > kills0, "首场即计选手生涯统计");
  const iWon = rec.winner === "A" ? f.teamA === s.myTeamId : f.teamB === s.myTeamId;
  assert.equal(s.manager.career!.wins + s.manager.career!.losses, 1, "首场即计教练胜负");
  if (iWon) {
    evaluateAchievements(s, dummy());
    assert.ok(s.achievements?.["g-firstwin"], "首场胜利即可解锁首胜成就");
  }
  void oppId;
});

test("模拟确定性：同 seed 双跑逐位一致（scriptSide 已随教学局删除）", () => {
  const sA = build(131);
  const sB = build(131);
  const [t1, t2] = Object.values(sA.teams).filter((t) => t.tier === 1);
  const rA = simMatch(sA, t1!.id, t2!.id, 3, 8888, "tut-none");
  const rB = simMatch(sB, t1!.id, t2!.id, 3, 8888, "tut-none");
  assert.equal(JSON.stringify(rA), JSON.stringify(rB));
});

test("解锁表：D1 基础页与训练开（v1.2 §3 引导要求）/D8 转会/D12 商务/D20 成就；第二赛季全开（旧档兼容）", () => {
  const s = build();
  s.day = 1;
  assert.equal(pageUnlocked("overview", s), true);
  assert.equal(pageUnlocked("tactics", s), true);
  assert.equal(pageUnlocked("training", s), true, "v1.2：GDD §3 First 30 Minutes 要求开局排课表——训练 D1 即开");
  assert.equal(pageUnlocked("transfer", s), false);
  assert.equal(pageUnlocked("business", s), false);
  assert.equal(pageUnlocked("achievements", s), false);
  s.day = 4;
  assert.equal(pageUnlocked("training", s), true);
  assert.equal(pageUnlocked("transfer", s), false);
  s.day = 8;
  assert.equal(pageUnlocked("transfer", s), true);
  s.day = 12;
  assert.equal(pageUnlocked("business", s), true);
  assert.equal(pageUnlocked("manager", s), true);
  s.day = 20;
  assert.equal(pageUnlocked("achievements", s), true);
  assert.equal(pageUnlocked("career", s), true);
  // 第二赛季 day 1 全开（旧档天然兼容——无新状态无迁移）
  s.manager.career!.seasons = 2;
  s.day = 1;
  for (const pg of ["training", "transfer", "business", "achievements", "career", "manager"] as const) {
    assert.equal(pageUnlocked(pg, s), true, `${pg} 第二赛季应全开`);
  }
  assert.ok(pageUnlockDay("training") === 1 && pageUnlockDay("transfer") === 8 && pageUnlockDay("business") === 12);
});

const ALL_PAGES = ["overview", "schedule", "squad", "tactics", "training", "finance", "business", "transfer", "manager", "achievements", "career", "library", "replays", "challenge", "system"] as const;

test("新手教程内容完整性（v1.0-16）：步骤 id 唯一、页合法、锚点已注册、导读覆盖全部 15 页", () => {
  const ids = new Set<string>();
  const anchorSet = new Set<string>(Object.values(TUT_ID));
  for (const s of TUTORIAL_STEPS) {
    assert.ok(!ids.has(s.id), `步骤 id 重复：${s.id}`);
    ids.add(s.id);
    assert.ok((ALL_PAGES as readonly string[]).includes(s.page), `步骤 ${s.id} 页面非法：${s.page}`);
    if (s.anchor) assert.ok(anchorSet.has(s.anchor), `步骤 ${s.id} 锚点未注册：${s.anchor}`);
    assert.ok(s.title.length >= 4 && s.body.length >= 30, `步骤 ${s.id} 文案过短`);
  }
  assert.ok(TUTORIAL_STEPS.length >= 20, "步骤覆盖量不足");
  assert.ok(TUTORIAL_STEPS.some((s) => s.pause === "awaitMatch"), "有待命步（等首场）");
  // 每个注册锚点至少被一个步骤引用（防止死锚点漂移）
  const used = new Set(TUTORIAL_STEPS.map((s) => s.anchor as string).filter(Boolean));
  for (const a of anchorSet) {
    assert.ok(used.has(a), `锚点 ${a} 已注册但无步骤引用`);
  }
  for (const pg of ALL_PAGES) {
    assert.ok((PAGE_HELP[pg]?.length ?? 0) >= 1, `PAGE_HELP 缺页：${pg}`);
  }
  assert.ok(TUTORIAL_GRADUATION.body.length >= 50);
});

test("教学局已删除：引擎源码不再引用 tutorial 字段（导入层验证）", async () => {
  const { readFileSync } = await import("node:fs");
  for (const f of ["src/core/sim/match.ts", "src/core/sim/day.ts"]) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    assert.ok(!src.includes("tutorial"), `${f} 仍引用 tutorial`);
    assert.ok(!src.includes("scriptSide"), `${f} 仍引用 scriptSide`);
  }
});
