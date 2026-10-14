import { test } from "node:test";
import assert from "node:assert/strict";
import { generateWorld } from "../src/core/worldgen.ts";
import { initSeasonFixtures, advanceDay, daysInYear } from "../src/core/sim/day.ts";

test("翻年清仓：跨年时间窗集合统一作废（bids/gigs/sponsorOffers/stream）", () => {
  const state = generateWorld(4321);
  initSeasonFixtures(state);
  state.myTeamId = Object.values(state.teams).find((t) => t.tier === 1)!.id;
  state.fixtures = []; // 清掉赛程：只测翻年路径，不打完整个赛季
  const pid = state.teams[state.myTeamId!]!.roster[0] as string;
  // 去年 12 月产出的"7 天答复窗"报价 / 商务邀约 / 赞助邀约 / 直播合同
  state.incomingBids.push({
    id: "BIDX", playerId: pid, fromTeam: "T1", toTeam: "T0",
    fee: 100_000, salary: 10_000, years: 2, signingBonus: 0,
    promisedRole: "rotation", day: 360, round: 0, demand: "过期报价", attitude: 1,
  });
  state.gigOffers.push({ id: "GIGX", playerId: pid, brand: "测试品牌", pay: 5_000, day: 360 });
  state.sponsorOffers.push({ id: "SPX", name: "测试赞助", tier: 3, perSeason: 50_000, years: 1, signedYear: 2026, expires: 381 });
  const streamP = state.players[pid]!;
  streamP.stream = { untilDay: 380, weekly: 1_000 };

  state.day = daysInYear(2026) - 1;
  advanceDay(state); // day 365 → 触发翻年

  assert.equal(state.year, 2027);
  assert.equal(state.day, 1);
  assert.equal(state.incomingBids.length, 0, "跨年报价应作废");
  assert.equal(state.gigOffers.length, 0, "跨年商务邀约应作废");
  assert.equal(state.sponsorOffers.length, 0, "跨年赞助邀约应作废");
  assert.equal(streamP.stream, null, "跨年直播合同应作废");
  // 修复前：1 - 360 = -359 ≤ 7 → 永不过期、永久残留
});

test("两年不变量巡航：数值/名单/积分守恒/同日双赛/引用/上界", () => {
  const state = generateWorld(2026);
  initSeasonFixtures(state);
  state.myTeamId = Object.values(state.teams).find((t) => t.regionId === "pacific")!.id; // Pacific 赛区球队：覆盖非默认赛区的整年路径
  const problems: string[] = [];
  const check = (tag: string) => {
    for (const p of Object.values(state.players)) {
      for (const v of Object.values(p.attrs)) {
        if (!Number.isFinite(v)) problems.push(`${tag} NaN ${p.ign}.attrs`);
        else if (v < 0 || v > 99.5) problems.push(`${tag} 属性越界 ${p.ign}=${v}`);
      }
      for (const k of ["morale", "form", "fatigue", "salary", "age", "contractYears"] as const) {
        const v = p[k] as number;
        if (!Number.isFinite(v)) problems.push(`${tag} NaN ${p.ign}.${k}`);
        else if (v < -1e6 || v > 1e9) problems.push(`${tag} 越界 ${p.ign}.${k}=${v}`);
      }
    }
    for (const t of Object.values(state.teams)) {
      if (!Number.isFinite(t.budget) || Math.abs(t.budget) > 1e9) problems.push(`${tag} budget ${t.name}=${t.budget}`);
    }
    const rostered = new Set<string>();
    for (const t of Object.values(state.teams)) {
      if (new Set(t.roster).size !== t.roster.length) problems.push(`${tag} ${t.name} roster 重复`);
      if (t.roster.length === 0) problems.push(`${tag} ${t.name} 空名单`);
      if (t.roster.length > 8) problems.push(`${tag} ${t.name} 名单 ${t.roster.length} 人超界`);
      for (const pid of t.roster) {
        if (rostered.has(pid)) problems.push(`${tag} ${pid} 同时在两队`);
        rostered.add(pid);
        const p = state.players[pid];
        if (!p) problems.push(`${tag} ${t.name} 引用不存在选手 ${pid}`);
        else if (p.teamId !== t.id) problems.push(`${tag} ${p.ign} teamId=${p.teamId} 不符 ${t.name}`);
      }
      for (const s of t.starters) if (!t.roster.includes(s)) problems.push(`${tag} ${t.name} 首发 ${s} 不在名单`);
    }
    for (const comp of Object.values(state.comps)) {
      const st = Object.values(comp.standings);
      if (!st.length) continue;
      const w = st.reduce((s, e) => s + e.w, 0);
      const l = st.reduce((s, e) => s + e.l, 0);
      if (w !== l) problems.push(`${tag} ${comp.key} 胜负不守恒 w=${w} l=${l}`);
    }
    const byDay = new Set<string>();
    for (const f of state.fixtures) {
      if (!f.teamA || !f.teamB) continue;
      for (const tid of [f.teamA!, f.teamB!]) {
        const key = `${f.day}:${tid}`;
        if (byDay.has(key)) problems.push(`${tag} ${tid} 第${f.day}天双赛`);
        byDay.add(key);
      }
    }
    for (const b of state.incomingBids) {
      if (!state.players[b.playerId]) problems.push(`${tag} bid 引用不存在选手`);
      if (b.fromTeam != null && !state.teams[b.fromTeam]) problems.push(`${tag} bid 引用不存在队伍`);
    }
    for (const g of state.gigOffers) if (!state.players[g.playerId]) problems.push(`${tag} gig 引用不存在选手`);
    for (const ev of state.pendingEvents ?? []) {
      if (ev.targetPlayerId && !state.players[ev.targetPlayerId]) problems.push(`${tag} 事件卡引用不存在选手`);
    }
    if (state.news.length > 410) problems.push(`${tag} news 超界 ${state.news.length}`);
    if (state.transferFeed.length > 310) problems.push(`${tag} feed 超界 ${state.transferFeed.length}`);
  };
  for (let i = 0; i < 800 && !(state.year >= 2028 && state.day > 8); i++) {
    advanceDay(state);
    if (state.day % 7 === 0) check(`y${state.year}d${state.day}`);
  }
  assert.ok(state.year >= 2028, "应跑过两个完整赛季");
  assert.deepEqual(problems.slice(0, 20), []);
});
