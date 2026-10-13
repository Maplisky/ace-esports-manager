import { test } from "node:test";
import assert from "node:assert/strict";
import { Rng, hashString } from "../src/core/rng.ts";
import { generateWorld, computeOverall } from "../src/core/worldgen.ts";
import { initSeasonFixtures, advanceDay, isLeapYear, daysInYear } from "../src/core/sim/day.ts";

test("RNG：同种子序列一致，不同种子不同", () => {
  const a = new Rng(12345);
  const b = new Rng(12345);
  const c = new Rng(54321);
  const seqA = Array.from({ length: 50 }, () => a.next());
  const seqB = Array.from({ length: 50 }, () => b.next());
  const seqC = Array.from({ length: 50 }, () => c.next());
  assert.deepEqual(seqA, seqB);
  assert.notDeepEqual(seqA, seqC);
});

test("RNG：分布与边界", () => {
  const rng = new Rng(42);
  const n = 20000;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = rng.next();
    assert.ok(v >= 0 && v < 1);
    sum += v;
  }
  assert.ok(Math.abs(sum / n - 0.5) < 0.01, `均值偏离: ${sum / n}`);
  for (let i = 0; i < 1000; i++) {
    const v = rng.int(3, 7);
    assert.ok(v >= 3 && v <= 7);
  }
  const arr = rng.shuffle([1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(arr.length, 8);
  assert.equal(new Set(arr).size, 8);
});

test("hashString：确定性且发散", () => {
  assert.equal(hashString("abc"), hashString("abc"));
  assert.notEqual(hashString("abc"), hashString("abd"));
});

test("世界生成：规模与健全性", () => {
  const state = generateWorld(2026);
  const teams = Object.values(state.teams);
  assert.equal(teams.length, 18);
  const t1 = teams.filter((t) => t.tier === 1);
  const t2 = teams.filter((t) => t.tier === 2);
  assert.equal(t1.length, 10);
  assert.equal(t2.length, 8);
  // 每队 7 人，5 首发，恰 1 名 IGL
  for (const t of teams) {
    assert.equal(t.roster.length, 7, `${t.name} 人数`);
    assert.equal(t.starters.length, 5);
    const igls = t.roster.filter((pid) => state.players[pid]?.isIgl);
    assert.equal(igls.length, 1, `${t.name} IGL 数`);
    for (const pid of t.roster) {
      const p = state.players[pid] as import("../src/core/types.ts").Player;
      assert.ok(p.overall >= 50 && p.overall <= 95, `${p.ign} overall ${p.overall}`);
      assert.ok(p.agentPool.length >= 3, `${p.ign} 英雄池`);
      assert.ok(p.salary > 0);
      assert.equal(p.homegrown, false);
    }
  }
  // 一级整体强于次级
  const avg = (ts: typeof teams) =>
    ts.reduce((s, t) => s + t.roster.reduce((x, pid) => x + (state.players[pid]?.overall ?? 0), 0) / t.roster.length, 0) / ts.length;
  assert.ok(avg(t1) > avg(t2) + 3, `一级均值 ${avg(t1).toFixed(1)} 应高于次级 ${avg(t2).toFixed(1)}`);
});

test("computeOverall：权重合成在 30-99 内", () => {
  const rng = new Rng(7);
  for (let i = 0; i < 100; i++) {
    const attrs = {
      aim: rng.int(30, 99), reaction: rng.int(30, 99), awareness: rng.int(30, 99),
      utility: rng.int(30, 99), clutch: rng.int(30, 99), teamwork: rng.int(30, 99),
      communication: rng.int(30, 99), igl: rng.int(30, 99),
    };
    const o = computeOverall(attrs);
    assert.ok(o >= 30 && o <= 99);
  }
});

test("赛历与翻年：自然年日历（含 Stage2/休赛期），年末按实际天数翻年", () => {
  const state = generateWorld(777);
  initSeasonFixtures(state);
  state.myTeamId = "T0";
  // 赛程数量：杯 7；Stage1 90+56；Stage2 90+56
  assert.equal(state.fixtures.length, 7 + 90 + 56 + 90 + 56);
  // 推进到 Stage1 收官前夕（121）：杯赛 + Stage1 全部打完，Stage2 未开打
  for (let d = 0; d < 400 && state.day < 121; d++) {
    advanceDay(state);
  }
  assert.equal(state.day, 121, "应推进到 Stage1 收官前夕");
  const unplayedBefore = state.fixtures.filter((f) => f.teamA !== "" && f.teamB !== "" && !f.played);
  assert.ok(unplayedBefore.every((f) => f.stage === "stage2"), "121 天前未打的只能是 Stage2");
  assert.equal(unplayedBefore.length, 146, `Stage2 应有 146 场未打: ${unplayedBefore.length}`);
  // Stage1 积分守恒（90 场 = 180 胜负）
  const comp = state.comps["stage1-t1"]!;
  const totalPlayed = Object.values(comp.standings).reduce((s, e) => s + e.w + e.l, 0);
  assert.equal(totalPlayed, 180);
  // 翻年：推进到自然年末（2026 非闰年 = 365 天），收官 + 新赛季
  const aPlayer = Object.values(state.players)[0]!;
  const ageAtStart = aPlayer.age;
  let ended = false;
  for (let d = 0; d < 400 && !ended; d++) {
    const r = advanceDay(state);
    ended = r.seasonEnded;
  }
  assert.ok(ended, "年末应触发赛季收官");
  assert.equal(state.year, 2027, "应进入 2027 赛季");
  assert.equal(state.day, 1, "翻年后天数重置");
  assert.equal(state.fixtures.length, 299, "新赛季赛程已生成（含 Stage2）");
  assert.ok(state.news.some((n) => n.text.includes("收官")));
  assert.ok(state.news.some((n) => n.text.includes("2027 赛季开始")));
  assert.ok(state.news.some((n) => n.text.includes("Stage 2 联赛进入前四")));
  assert.equal(aPlayer.age, ageAtStart + 1, "翻年年龄 +1");
  assert.ok(aPlayer.contractYears >= 0, "合同年递减不越界");
});

test("闰年：2028 为 366 天（GDD 日期表考虑闰年）", () => {
  assert.equal(daysInYear(2026), 365);
  assert.equal(daysInYear(2028), 366);
  assert.equal(daysInYear(2000), 366);
  assert.equal(daysInYear(2100), 365);
});
