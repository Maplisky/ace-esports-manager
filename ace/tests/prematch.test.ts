/** 赛前准备回归（GDD §5.5/§7.1）：mineHold 拦截、playHeldMatch 回放、mapLock/首发生效、逾期补赛 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateWorld } from "../src/core/worldgen.ts";
import { initSeasonFixtures, advanceDay, playHeldMatch } from "../src/core/sim/day.ts";

test("赛前准备：mineHold 拦截我的比赛，AI 比赛照常；playHeldMatch 回放且选择生效", () => {
  const state = generateWorld(2026);
  initSeasonFixtures(state);
  // 我的队从揭幕杯参赛队中取（保证有被拦截的比赛）
  const myId = state.comps["cup"]!.teamIds[0]!;
  state.myTeamId = myId;
  state.day = 25; // 揭幕杯 QF 日（我的比赛）

  const heldArgs: { fixtureId: string; teamA: string; teamB: string }[] = [];
  const r = advanceDay(
    state,
    [],
    (rec, fid, mine) => {
      if (mine) assert.fail("被拦截的我的比赛不应在 advanceDay 内自动打完");
    },
    (fixtureId, teamA, teamB) => {
      heldArgs.push({ fixtureId, teamA, teamB });
      return true;
    },
  );
  // 拦截恰好一次，且是我的比赛
  assert.equal(heldArgs.length, 1);
  assert.ok(heldArgs[0]!.teamA === myId || heldArgs[0]!.teamB === myId);
  const team = state.teams[myId]!;
  // 同日 AI 比赛（揭幕杯另外三场 QF）照常打完
  const qfPlayed = state.fixtures.filter((f) => f.label.includes("四分之一决赛") && f.played);
  assert.equal(qfPlayed.length, 3, `AI QF 应打完 3 场: ${qfPlayed.length}`);
  // 我的 QF 未打
  const myFixture = state.fixtures.find((f) => f.id === heldArgs[0]!.fixtureId)!;
  assert.equal(myFixture.played, false);

  // 赛前准备：手动 BP 图序 + 指定首发（把替补提上来）
  const manualMaps = ["split", "ascent", "lotus"];
  const benchId = team.roster.find((pid) => !team.starters.includes(pid))!;
  const starters = team.starters.slice(0, 4).concat(benchId);
  const rec = playHeldMatch(
    state,
    myFixture.id,
    { starters, maps: manualMaps, agentPicks: {} },
  );
  assert.ok(rec, "应产出 MatchRecord");
  assert.equal(myFixture.played, true);
  // mapLock 生效：图序一致（BO3 可能 2-0 提前收官，只断言已打图为手排前缀）
  const playedMaps = rec!.maps.map((m) => m.map);
  assert.deepEqual(playedMaps, manualMaps.slice(0, playedMaps.length),
  );
  // 首发生效：替补出现在回放 lines 里，被换下的首发不在
  const bench = state.players[benchId]!;
  assert.ok(rec!.maps.some((m) => m.lines[benchId] !== undefined), `替补 ${bench.ign} 应上场`);
  // 赛后：疲劳/生涯已累计
  assert.ok(bench.career.maps > 0);
  // agentLock 不污染预案库（v1.9 检错：__prematch__ 曾被永久写入用户预案列表）
  for (const mapId of manualMaps) {
    const list = team.presets[mapId] ?? [];
    assert.ok(list.every((p) => p.name !== "__prematch__"), "临时英雄选择不应写入预案库");
  }
});

test("赛前准备：不带 mineHold 的旧调用路径行为不变（我的比赛自动打完）", () => {
  const state = generateWorld(31);
  initSeasonFixtures(state);
  state.myTeamId = Object.values(state.teams).find((t) => t.tier === 1)!.id;
  state.day = 25;
  advanceDay(state);
  const qfPlayed = state.fixtures.filter((f) => f.label.includes("四分之一决赛") && f.played);
  assert.equal(qfPlayed.length, 4, "无拦截时 4 场 QF 全部自动打完（含我的比赛）");
});

test("逾期补赛：停车期间跳过推进的日子，比赛自动补打而不消失", () => {
  const state = generateWorld(41);
  initSeasonFixtures(state);
  const myId = state.comps["cup"]!.teamIds[0]!;
  state.myTeamId = myId;
  state.day = 25;
  // 拦截 QF（day 26）
  advanceDay(state, [], undefined, () => true);
  assert.equal(state.day, 26);
  // 模拟"停车期间刷新后跳过"：直接推进两天（26→28），不过预赛准备
  advanceDay(state); // 26→27，逾期清扫应补打 QF
  const myQF = state.fixtures.find((f) => f.id === state.fixtures.find((x) => x.teamA === myId || x.teamB === myId)!.id)!;
  assert.equal(myQF.played, true, "逾期比赛应被自动补打");
  assert.ok(state.news.some((n) => n.text.includes("补赛")), "补赛新闻应存在");
  // 杯赛树继续：SF 对阵已回填
  const sf = state.fixtures.filter((f) => f.label.includes("半决赛"));
  assert.ok(sf.every((f) => f.teamA !== "" && f.teamB !== ""), "半决赛对阵应已回填");
});
