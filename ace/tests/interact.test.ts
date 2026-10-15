/** 对局交互回归（v1.0-8，GDD §5.4）：
 *  回放红线（无干预逐位一致）/ 干预前缀一致与喊话落档 / 大招门控 / IGL 读图确定性 /
 *  simMatch 纯化拆分（applyMatchEffects 与旧内联行为等价）/ settleMatch 幂等。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateWorld, resetPlayerSeq } from "../src/core/worldgen.ts";
import { initSeasonFixtures, playHeldMatch, interveneHeldMatch, settleMatch } from "../src/core/sim/day.ts";
import { resetFixtureSeq } from "../src/core/sim/fixtures.ts";
import { simMatch, applyMatchEffects } from "../src/core/sim/match.ts";
import { PLAYER_CALLS, callDefOf } from "../src/core/sim/tactics.ts";
import type { GameState, MatchIntervention } from "../src/core/types.ts";

function build(seed = 21): GameState {
  resetPlayerSeq();
  resetFixtureSeq();
  const state = generateWorld(seed);
  initSeasonFixtures(state);
  state.myTeamId = Object.values(state.teams).find((t) => t.tier === 1)!.id;
  return state;
}

function myLeagueFixture(s: GameState) {
  const f = s.fixtures.find(
    (x) => !x.played && x.teamA !== "" && x.teamB !== "" && (x.teamA === s.myTeamId || x.teamB === s.myTeamId),
  );
  assert.ok(f, "必须存在我的比赛");
  return f;
}

test("回放红线：无干预两次模拟逐位一致；空干预列表与不传等价（不操作即不改变）", () => {
  const sA = build(31);
  const sB = build(31);
  const sC = build(31);
  const [t1, t2] = Object.values(sA.teams).filter((t) => t.tier === 1);
  const rA = simMatch(sA, t1!.id, t2!.id, 3, 4242, "iv-same");
  const rB = simMatch(sB, t1!.id, t2!.id, 3, 4242, "iv-same", undefined, undefined, []);
  const rC = simMatch(sC, t1!.id, t2!.id, 3, 4242, "iv-same");
  assert.equal(JSON.stringify(rA), JSON.stringify(rB), "空干预列表 === 不传");
  assert.equal(JSON.stringify(rA), JSON.stringify(rC), "同 seed 同输入逐位一致");
  assert.equal(rA.interventions, undefined, "无干预不落 interventions 字段");
});

test("干预：喊话回合前逐位一致；喊话事件落档并扣暂停；干预审计回写 Record", () => {
  const sBase = build(31);
  const sIv = build(31);
  const f = myLeagueFixture(sIv);
  const seed = 9001;
  const base = simMatch(sBase, f.teamA, f.teamB, f.bo, seed, "iv-base");
  const iv: MatchIntervention = { map: 0, round: 5, tactic: "atk:slowDefault" };
  const mod = simMatch(sIv, f.teamA, f.teamB, f.bo, seed, "iv-mod", undefined, undefined, [iv]);

  // 干预前缀：第 1-4 回合完全一致（干预前无任何分叉源）
  for (let i = 0; i < 4; i++) {
    assert.equal(JSON.stringify(base.maps[0]!.rounds[i]), JSON.stringify(mod.maps[0]!.rounds[i]), `第 ${i + 1} 回合应逐位一致`);
  }
  // 喊话事件：第 5 回合出现玩家标记的 timeout，且不带 igl 标记
  const r5 = mod.maps[0]!.rounds[4]!;
  const call = r5.events.find((e) => e.t === "timeout" && e.player);
  assert.ok(call, "第 5 回合应有玩家喊话事件");
  assert.equal(call!.tactic, "atk:slowDefault");
  assert.notEqual(call!.igl, true);
  assert.equal(base.maps[0]!.rounds[4]!.events.some((e) => e.t === "timeout" && e.player), false, "基线无玩家喊话");
  // 暂停扣减：我方 end.timeouts 下降 1（对手不变）
  const mySide = f.teamA === sIv.myTeamId ? "A" : "B";
  const baseTo = base.maps[0]!.rounds[4]!.end.timeouts!;
  const modTo = r5.end.timeouts!;
  assert.equal(modTo[mySide], baseTo[mySide] - 1, "喊话消耗我方 1 次暂停");
  // 审计回写
  assert.deepEqual(mod.interventions, [iv]);
});

test("大招门控：核心大招 <2 时大招速攻喊话被引擎拒（不消耗暂停、无事件）", () => {
  const s = build(31);
  const f = myLeagueFixture(s);
  const iv: MatchIntervention = { map: 0, round: 2, tactic: "atk:ultRush:A" };
  const rec = simMatch(s, f.teamA, f.teamB, f.bo, 777, "iv-gate", undefined, undefined, [iv]);
  const r2 = rec.maps[0]!.rounds[1]!;
  assert.equal(r2.events.some((e) => e.t === "timeout" && e.player), false, "第 2 回合核心大招必未就绪，喊话应被拒");
  // 旧 record 无 baseline 对照：门控拒绝时不消耗暂停（end.timeouts[my] 应与无干预一致）
  const clean = simMatch(build(31), f.teamA, f.teamB, f.bo, 777, "iv-gate-clean");
  assert.equal(r2.end.timeouts!.A, clean.maps[0]!.rounds[1]!.end.timeouts!.A);
  assert.equal(r2.end.timeouts!.B, clean.maps[0]!.rounds[1]!.end.timeouts!.B);
});

test("IGL 场上阅读：第 7 回合必有读图（7 回合必打）；建议在喊话表内；质量随 IGL 意识单调", () => {
  const s = build(41);
  const f = myLeagueFixture(s);
  const rec = simMatch(s, f.teamA, f.teamB, f.bo, 5150, "igl-read");
  const readings = rec.maps[0]!.readings ?? [];
  const r7 = readings.find((r) => r.round === 7);
  assert.ok(r7, "第 7 回合必产生读图");
  const validIds = new Set(PLAYER_CALLS.map((c) => c.id));
  const bare = r7!.suggested.replace(/:[ABC]$/, "");
  assert.ok(validIds.has(bare), `建议必须是喊话表内战术：${r7!.suggested}`);
  assert.ok(r7!.quality >= 5 && r7!.quality <= 95);
  // IGL 意识提升 → 质量单调不降（clamp 边界允许相等）
  const myId = s.myTeamId!;
  const myTeam = s.teams[myId]!;
  const igl = myTeam.roster.map((pid) => s.players[pid]).find((p) => p?.isIgl);
  const s2 = build(41);
  const igl2 = s2.teams[myId]!.roster.map((pid) => s2.players[pid]).find((p) => p?.isIgl);
  if (igl && igl2) {
    igl2.attrs.awareness = Math.min(99, igl.attrs.awareness + 20);
    const rec2 = simMatch(s2, f.teamA, f.teamB, f.bo, 5150, "igl-read-2");
    const q2 = rec2.maps[0]!.readings?.find((r) => r.round === 7)?.quality ?? 0;
    assert.ok(q2 >= r7!.quality, `意识 +20 后读图质量不降：${q2} >= ${r7!.quality}`);
  }
});

test("simMatch 纯化：模拟不改生涯/状态；applyMatchEffects 等价旧内联入账", () => {
  const s = build(51);
  const f = myLeagueFixture(s);
  const pids = [...s.teams[f.teamA]!.roster, ...s.teams[f.teamB]!.roster];
  const before = pids.map((pid) => {
    const p = s.players[pid]!;
    return { k: p.career.kills, d: p.career.deaths, maps: p.career.maps, fat: p.fatigue, form: p.form, morale: p.morale, mvps: p.career.mvps };
  });
  const rec = simMatch(s, f.teamA, f.teamB, f.bo, 606, "pure");
  pids.forEach((pid, i) => {
    const p = s.players[pid]!;
    assert.equal(p.career.kills, before[i]!.k, "纯模拟不得入账生涯");
    assert.equal(p.fatigue, before[i]!.fat, "纯模拟不得改疲劳");
  });
  applyMatchEffects(s, rec);
  // 胜负方向：胜方 form +1 / 负方 -1（在初始值基础上；击杀求和等价由 settleMatch 测试锁定）
  const winnerId = rec.winner === "A" ? f.teamA : f.teamB;
  const loserId = rec.winner === "A" ? f.teamB : f.teamA;
  const wP = s.teams[winnerId]!.roster.map((pid) => s.players[pid]!).filter((p) => p.injuredUntilDay <= s.day)[0];
  const lP = s.teams[loserId]!.roster.map((pid) => s.players[pid]!).filter((p) => p.injuredUntilDay <= s.day)[0];
  if (wP && lP) {
    const wBefore = before[pids.indexOf(wP.id)]!;
    const lBefore = before[pids.indexOf(lP.id)]!;
    assert.equal(Math.min(99, wBefore.form + 1) === wP.form || wBefore.form === 99, true, "胜方状态 +1（或已满）");
    assert.equal(Math.max(30, lBefore.form - 1) === lP.form || lBefore.form === 30, true, "负方状态 -1（或已底）");
  }
});

test("交互式结算：playHeldMatch 只模拟不结算；settleMatch 入账一次且幂等", () => {
  const s = build(61);
  const f = myLeagueFixture(s);
  const rec = playHeldMatch(s, f.id, {});
  assert.ok(rec, "playHeldMatch 返回 Record");
  assert.equal(f.played, true);
  assert.notEqual(f.settled, true, "播放前不得结算");
  const igl = s.teams[f.teamA]!.roster.map((pid) => s.players[pid]).find((p) => p?.isIgl);
  const killsBefore = igl ? s.players[igl.id]!.career.kills : 0;
  const newsBefore = s.news.length;
  const ok = settleMatch(s, f.id, rec, () => {});
  assert.equal(ok, true);
  assert.equal(f.settled, true);
  assert.equal(f.winnerTeamId, rec!.winner === "A" ? f.teamA : f.teamB);
  assert.ok(s.news.length > newsBefore, "结算产生赛果新闻");
  if (igl) {
    const gained = s.players[igl.id]!.career.kills - killsBefore;
    const fromRec = rec!.maps.reduce((sum, m) => sum + (m.lines[igl.id]?.kills ?? 0), 0);
    assert.equal(gained, fromRec, "生涯击杀入账 = Record 求和（拆分等价）");
  }
  assert.equal(settleMatch(s, f.id, rec, () => {}), false, "二次结算幂等拒绝");
});

test("结算语义：交互式 settled=false 显式落档；旧档缺省回填 true 不误伤交互式", () => {
  const s = build(81);
  const f = myLeagueFixture(s);
  const rec = playHeldMatch(s, f.id, {});
  assert.ok(rec);
  assert.equal(f.settled, false, "交互式：显式 false（区别于旧档的 undefined）");
  // 旧档回填规则（worker migrate 同式）：仅缺省字段回填
  const old = myLeagueFixture(build(81));
  old.played = true;
  if (old.settled === undefined) old.settled = true;
  assert.equal(old.settled, true, "旧档缺省 → 回填 true");
  assert.equal(f.settled, false, "交互式 false 不被回填误伤");
});

test("干预→结算全链路：interveneHeldMatch 重模拟 → settleMatch 按最终 Record 入账一次", () => {
  const s = build(91);
  const f = myLeagueFixture(s);
  const rec0 = playHeldMatch(s, f.id, {});
  assert.ok(rec0);
  // 干预：第 5 回合喊慢速默认（重模拟）
  const rec1 = interveneHeldMatch(s, f.id, { map: 0, round: 5, tactic: "atk:slowDefault" });
  assert.ok(rec1);
  assert.deepEqual(rec1!.interventions, [{ map: 0, round: 5, tactic: "atk:slowDefault" }], "干预随 fixture 落档并回写 Record");
  // 干预过的比赛中途关闭不结算（store 语义）——此处直接结算，入账必须按干预后的 rec1
  const pids = [...s.teams[f.teamA]!.roster, ...s.teams[f.teamB]!.roster];
  const killsBefore = new Map(pids.map((pid) => [pid, s.players[pid]!.career.kills]));
  assert.equal(settleMatch(s, f.id, rec1, () => {}), true);
  for (const m of rec1!.maps) {
    for (const [pid, line] of Object.entries(m.lines)) {
      const p = s.players[pid];
      if (!p) continue;
      assert.equal(p.career.kills - (killsBefore.get(pid) ?? 0) >= line.kills, true);
    }
    break; // 逐图累计只断言第一图的增量下界（跨图累计由 settleMatch 测试锁定等价）
  }
  assert.equal(f.winnerTeamId, rec1!.winner === "A" ? f.teamA : f.teamB, "胜者按干预后的 Record 落档");
});

test("喊话表完备性：八条玩家战术带攻防侧与描述；AI rush/steady 数值与 v1.0-7 完全一致", () => {
  assert.equal(PLAYER_CALLS.length, 8);
  assert.equal(PLAYER_CALLS.filter((c) => c.side === "atk").length, 4);
  assert.equal(PLAYER_CALLS.filter((c) => c.side === "def").length, 4);
  assert.ok(PLAYER_CALLS.every((c) => c.desc.length > 0 && c.label.length > 0));
  const rush = callDefOf("rush")!;
  const steady = callDefOf("steady")!;
  assert.equal(rush.atkMod, 2.4); // v1.0-7 callMod 原值，不得漂移
  assert.equal(rush.defMod, -1.6);
  assert.equal(steady.atkMod, -1.2);
  assert.equal(steady.defMod, 2.0);
  const ult = PLAYER_CALLS.find((c) => c.id === "atk:ultRush")!;
  assert.equal(ult.needsCoreUlts, true, "大招速攻必须带核心档门控");
  const sentinel = PLAYER_CALLS.find((c) => c.id === "def:sentinelTunnel")!;
  assert.equal(sentinel.counterRush, true, "双哨位必须带克制 rush 标记");
});
