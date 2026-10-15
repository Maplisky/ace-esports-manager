/** 开局引导骨架回归（v1.0-11，GDD §3/§9.1）：教学脚本局 + D1-D20 解锁表。
 *  口径：教学局不计生涯统计与成就（§3/§5.1）；script 优势为固定常量零 RNG；
 *  解锁由当年天数+赛季数推导（旧档/第二赛季天然全开，零迁移）。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resetPlayerSeq, generateWorld } from "../src/core/worldgen.ts";
import { initSeasonFixtures, playHeldMatch, settleMatch } from "../src/core/sim/day.ts";
import { resetFixtureSeq } from "../src/core/sim/fixtures.ts";
import { initCareer } from "../src/core/sim/career.ts";
import { evaluateAchievements } from "../src/core/sim/achievements.ts";
import { pageUnlocked, pageUnlockDay } from "../src/app/guide.ts";
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

test("教学脚本局：生涯首场自动标记 +8 优势；结算不计生涯统计与成就；第二场不再是教学局", () => {
  const s = build();
  const f = myFixture(s);
  const rec = playHeldMatch(s, f.id, {});
  assert.ok(rec);
  assert.equal(f.tutorial, true, "生涯首场（0 胜 0 负、首赛季）标记教学局");
  const p = s.players[s.teams[f.teamA === s.myTeamId ? f.teamA : f.teamB]!.starters[0]!]!;
  const kills0 = p.career.kills;
  const news0 = s.news.length;
  assert.equal(settleMatch(s, f.id, rec, () => {}), true);
  assert.equal(p.career.kills, kills0, "教学局不计选手生涯统计");
  assert.equal(s.manager.career!.wins + s.manager.career!.losses, 0, "教学局不计教练胜负");
  assert.ok(s.news.length > news0, "联赛赛果新闻照常（含「教学局」标注）");
  assert.ok(s.news.some((n) => n.text.includes("教学局")));
  assert.equal(s.manager.career!.tutorialDone, true, "教学局完成标记");
  evaluateAchievements(s, dummy());
  assert.ok(!s.achievements?.["g-firstwin"], "教学局胜利不解锁首胜成就");
  // 第二场：不再标记
  s.day = f.day + 2;
  const f2 = myFixture(s);
  const rec2 = playHeldMatch(s, f2.id, {});
  assert.ok(rec2);
  assert.notEqual(f2.tutorial, true, "第二场非教学局");
  settleMatch(s, f2.id, rec2, () => {});
  assert.equal(s.manager.career!.wins + s.manager.career!.losses, 1, "第二场正常计胜负");
});

test("script 优势红线：非教学局（tutorial 缺省）模拟逐位一致；教学局允许分叉", () => {
  const sA = build(131);
  const sB = build(131);
  const [t1, t2] = Object.values(sA.teams).filter((t) => t.tier === 1);
  const rA = simMatch(sA, t1!.id, t2!.id, 3, 8888, "tut-none");
  const rB = simMatch(sB, t1!.id, t2!.id, 3, 8888, "tut-none");
  assert.equal(JSON.stringify(rA), JSON.stringify(rB), "缺省 script 零影响");
});

test("解锁表：D1 基础四页开；D4 训练/D8 转会/D12 商务/D20 成就；第二赛季全开（旧档兼容）", () => {
  const s = build();
  s.day = 1;
  assert.equal(pageUnlocked("overview", s), true);
  assert.equal(pageUnlocked("tactics", s), true);
  assert.equal(pageUnlocked("training", s), false);
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
  assert.ok(pageUnlockDay("training") === 4 && pageUnlockDay("transfer") === 8 && pageUnlockDay("business") === 12);
});
