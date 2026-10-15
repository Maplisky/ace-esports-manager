/** 经理人生涯回归（v1.0-6，GDD §9.5）：出身加成 / 下课（谷底+警告连败）/ 跳槽 / 五年之约 / 冠军计数 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateWorld, resetPlayerSeq } from "../src/core/worldgen.ts";
import { initSeasonFixtures } from "../src/core/sim/day.ts";
import { resetFixtureSeq } from "../src/core/sim/fixtures.ts";
import { initCareer, applyJob, jobOffers, noteMatchResult, careerWeeklyTick, noteManagerTitle, checkCareerMilestone, resolveMilestoneCard } from "../src/core/sim/career.ts";
import { Rng } from "../src/core/rng.ts";
import type { GameState } from "../src/core/types.ts";

function build(seed = 4): GameState {
  resetPlayerSeq();
  resetFixtureSeq();
  const state = generateWorld(seed);
  initSeasonFixtures(state);
  state.myTeamId = Object.values(state.teams).find((t) => t.tier === 1)!.id;
  return state;
}

test("出身 3 选 1：名宿声望+15 谈判+5；草根眼光+8 预算+$400K；分析师战术+5 声望-5", () => {
  const base = build();
  const baseRep = base.manager.reputation; // 初始 40（worldgen 定值）
  const s1 = build();
  initCareer(s1, "legend");
  assert.equal(s1.manager.reputation, baseRep + 15);
  assert.equal(s1.manager.skills.negotiation, 55);
  assert.equal(s1.manager.life.wallet, 2000 + 60_000);
  const s2 = build();
  initCareer(s2, "grassroots");
  assert.equal(s2.manager.skills.scouting, 58);
  const s3 = build();
  initCareer(s3, "analyst");
  assert.equal(s3.manager.reputation, baseRep - 5);
  assert.equal(s3.manager.skills.tactics, 55);
  assert.ok(s1.manager.career!.startYear > 0 && s1.manager.career!.seasons === 1);
});

test("下课：信任 ≤6 直接下课；警告后三连败下课；结局卡写入并冻结", () => {
  const s = build();
  initCareer(s, "analyst");
  const notes: never[] = [];
  s.boardConfidence = 5;
  careerWeeklyTick(s, notes as never);
  assert.ok(s.manager.career!.ending?.kind === "fired", "信任谷底直接下课");
  // 冻结：后续比赛不入账
  noteMatchResult(s, true, notes as never);
  assert.equal(s.manager.career!.wins, 0, "终局后胜负不再入账");

  const s2 = build();
  initCareer(s2, "grassroots");
  s2.boardConfidence = 18;
  careerWeeklyTick(s2, notes as never); // 警告
  assert.equal(s2.manager.career!.warned, true);
  noteMatchResult(s2, false, notes as never);
  noteMatchResult(s2, false, notes as never);
  assert.ok(!s2.manager.career!.ending, "两连败不下课");
  noteMatchResult(s2, false, notes as never);
  const endingKind = (x: GameState): string | undefined => (x.manager.career as { ending?: { kind: string } } | undefined)?.ending?.kind;
  assert.ok(endingKind(s2) === "fired", "警告后三连败下课");
  // 信任回暖解除警告
  const s3 = build();
  initCareer(s3, "legend");
  s3.boardConfidence = 15;
  careerWeeklyTick(s3, notes as never);
  s3.boardConfidence = 60;
  careerWeeklyTick(s3, notes as never);
  assert.equal(s3.manager.career!.warned, false, "信任回暖解除警告");
});

test("跳槽：市场按声望过滤；成功切换俱乐部并重置信任；失败声望 -1", () => {
  const s = build();
  initCareer(s, "legend");
  s.stage = "offseason";
  const offers = jobOffers(s);
  assert.ok(offers.length > 0 && offers.length <= 8, "市场 1-8 家");
  const notes: never[] = [];
  // 确定性 rng 强制成功/失败各验一次
  const okRng = { chance: () => true } as unknown as Rng;
  const failRng = { chance: () => false } as unknown as Rng;
  const target = offers[0]!;
  const oldRep = s.manager.reputation;
  const r1 = applyJob(s, target.id, failRng, notes as never);
  assert.equal(r1.ok, false);
  assert.equal(s.manager.reputation, oldRep - 1);
  const r2 = applyJob(s, target.id, okRng, notes as never);
  assert.equal(r2.ok, true);
  assert.equal(s.myTeamId, target.id, "已切换俱乐部");
  assert.equal(s.boardConfidence, 60, "董事会信任重置");
});

test("五年之约与强制退休：第 5 赛季出卡（收官可进名人堂），第 10 赛季强制退休", () => {
  const s = build();
  initCareer(s, "grassroots");
  const notes: never[] = [];
  s.year = s.manager.career!.startYear + 4; // 第 5 赛季
  checkCareerMilestone(s, notes as never);
  const card = s.pendingEvents.find((e) => e.cardId === "milestone");
  assert.ok(card, "五年之约卡已生成");
  const r = resolveMilestoneCard(s, card!, 1);
  assert.ok(r.result.includes("收官"));
  assert.equal(s.manager.career!.ending?.kind, "hall", "名人堂结局");

  const s2 = build();
  initCareer(s2, "legend");
  s2.year = s2.manager.career!.startYear + 9; // 第 10 赛季
  checkCareerMilestone(s2, notes as never);
  assert.equal(s2.manager.career!.ending?.kind, "retired", "第 10 年强制退休");
});

test("经理冠军计数：我队夺冠 +1，他队不计", () => {
  const s = build();
  initCareer(s, "analyst");
  noteManagerTitle(s, s.myTeamId!);
  noteManagerTitle(s, Object.values(s.teams).find((t) => t.id !== s.myTeamId)!.id);
  assert.equal(s.manager.career!.titles, 1);
});
