/** 年度选秀回归（v1.0-4）：倒序选人反垄断 / 新秀入队 / 我队选秀卡结算 / 确定性 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateWorld, resetPlayerSeq } from "../src/core/worldgen.ts";
import { initSeasonFixtures, advanceDay } from "../src/core/sim/day.ts";
import { resetFixtureSeq } from "../src/core/sim/fixtures.ts";
import { resolveEvent } from "../src/core/sim/events.ts";
import { Rng } from "../src/core/rng.ts";

/** 快进到选秀次日（draftDay 280 已跑） */
function runToAfterDraft(state: ReturnType<typeof generateWorld>): void {
  for (let d = 0; d < 500 && state.day !== 281; d++) advanceDay(state);
}

test("选秀：积分最低 t1 队拿 1 号签，新秀 16-18 岁入队，落选者进自由市场", () => {
  resetPlayerSeq();
  resetFixtureSeq();
  const state = generateWorld(5);
  initSeasonFixtures(state);
  state.myTeamId = null; // 纯观察者
  runToAfterDraft(state);
  assert.equal(state.day, 281);
  assert.ok(state.lastDraft, "选秀已进行");
  const picks = state.lastDraft!.picks.filter((x) => x.playerId);
  assert.ok(picks.length >= 40, `大部分签位兑现（实际 ${picks.length}）`);
  // 1 号签 = 冠军积分最低的 t1 队（上赛季倒序反垄断；积分翻年才清零，此刻仍可复核）
  const lowest = Object.values(state.teams)
    .filter((t) => t.tier === 1)
    .sort(
      (a, b) =>
        (state.circuitPoints?.[a.id] ?? 0) - (state.circuitPoints?.[b.id] ?? 0) ||
        (a.id < b.id ? -1 : 1),
    )[0]!;
  assert.equal(picks[0]!.teamId, lowest.id, "1 号签属于积分最低队");
  const p1 = state.players[picks[0]!.playerId]!;
  assert.ok(p1.age >= 16 && p1.age <= 18, `新秀年龄 16-18（实际 ${p1.age}）`);
  assert.equal(p1.teamId, picks[0]!.teamId, "新秀已入队");
  assert.ok(p1.contractYears === 3 && p1.salary > 0, "新秀 3 年合同");
  // 落选新秀留在自由市场
  const leftover = Object.values(state.players).filter((p) => p.synthetic === "rookie" && !p.teamId);
  assert.ok(leftover.length > 0, "有落选者进自由市场");
  // 新闻有选秀开幕条目
  assert.ok(state.news.some((n) => n.text.includes("选秀大会开幕")), "选秀新闻");
});

test("我队选秀卡：7 选项 + 放弃，resolve 首选签入我队且卡出队", () => {
  resetPlayerSeq();
  resetFixtureSeq();
  const state = generateWorld(6);
  initSeasonFixtures(state);
  state.myTeamId = Object.values(state.teams).find((t) => t.tier === 1)!.id;
  runToAfterDraft(state);
  const card = state.pendingEvents.find((e) => e.cardId === "draft");
  assert.ok(card, "我队收到选秀卡");
  assert.equal(card!.options.length, 8, "7 推荐 + 1 放弃");
  const ids = (card!.payload as { playerIds: string[] }).playerIds;
  assert.equal(ids.length, 7);
  const before = state.teams[state.myTeamId!]!.roster.length + state.teams[state.myTeamId!]!.academy.length;
  const res = resolveEvent(state, card!.uid, 0, new Rng(1));
  assert.ok(res?.result.includes("选中"), `结算文案：${res?.result ?? "无"}`);
  const chosen = state.players[ids[0]!]!;
  assert.equal(chosen.teamId, state.myTeamId, "新秀已入我队");
  const after = state.teams[state.myTeamId!]!.roster.length + state.teams[state.myTeamId!]!.academy.length;
  assert.equal(after, before + 1, "员额 +1");
  assert.ok(!state.pendingEvents.some((e) => e.uid === card!.uid), "卡已出队不残留");
  // 留档补记
  const myRow = state.lastDraft!.picks.find((x) => x.teamId === state.myTeamId);
  assert.equal(myRow?.playerId, chosen.id, "lastDraft 我队行已补记");
});

test("确定性：同种子两跑，1 号签队伍与新秀一致", () => {
  const run = (seed: number): string => {
    resetPlayerSeq();
    resetFixtureSeq();
    const s = generateWorld(seed);
    initSeasonFixtures(s);
    s.myTeamId = null;
    runToAfterDraft(s);
    const p0 = s.lastDraft!.picks.find((x) => x.playerId)!;
    return `${p0.teamId}:${p0.playerId}`;
  };
  assert.equal(run(9), run(9));
});
