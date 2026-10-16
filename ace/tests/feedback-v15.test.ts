/** 玩家反馈批次（v1.5 后）：⑥变阵降摸透（match.ts 泄露指纹）+ ①中段里程碑（day.ts D87/D192） */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateWorld, makeSyntheticTeam, resetPlayerSeq } from "../src/core/worldgen.ts";
import { Rng } from "../src/core/rng.ts";
import { simMatch, patternLeakOf, recordPatternFingerprint } from "../src/core/sim/match.ts";
import { initSeasonFixtures, advanceDay, playHeldMatch, interveneHeldMatch } from "../src/core/sim/day.ts";
import { resetFixtureSeq } from "../src/core/sim/fixtures.ts";
import { AGENTS } from "../src/core/data/agents.ts";
import type { GameState, NewsItem } from "../src/core/types.ts";

// —— ⑥ 变阵降摸透：泄露指纹 ——

function buildMine(seed = 7): GameState {
  resetPlayerSeq();
  const rng = new Rng(seed);
  const t1 = makeSyntheticTeam("TA", "我队", 80, rng);
  const t2 = makeSyntheticTeam("TB", "对手", 78, rng);
  const state = generateWorld(seed);
  state.teams["TA"] = t1.team;
  state.teams["TB"] = t2.team;
  for (const p of t1.players) state.players[p.id] = p;
  for (const p of t2.players) state.players[p.id] = p;
  state.day = 60;
  state.myTeamId = "TA";
  return state;
}

test("patternLeakOf 纯函数：base=min(1.2,usage×0.12)；首战/同指纹满额；变阵 ×0.25；usage=0 无泄露", () => {
  assert.equal(patternLeakOf(undefined, "a|b", 0), 0, "无使用无泄露");
  assert.equal(patternLeakOf(undefined, "a|b", 10), 1.2, "首次记录满额封顶");
  assert.equal(patternLeakOf(undefined, "a|b", 5), 0.6);
  assert.equal(patternLeakOf("a|b", "a|b", 10), 1.2, "同指纹 = 旧路径满额");
  assert.equal(patternLeakOf("a|b", "c|d", 10), 0.3, "变阵 → ×0.25");
  assert.equal(patternLeakOf("a|b", "c|d", 5), 0.15);
});

test("变阵降摸透集成：模拟期纯函数不落指纹；结算点 recordPatternFingerprint 记录；换 agentLock → 指纹变化", () => {
  const s1 = buildMine();
  s1.teams["TA"]!.patternUsage["ascent"] = 5;
  const r1 = simMatch(s1, "TA", "TB", 1, 4242, "L1", ["ascent"]);
  assert.equal(r1.maps.length, 1);
  assert.equal(s1.teams["TA"]!.lastPattern?.["ascent"], undefined, "simMatch 纯函数：模拟期不写 lastPattern");
  recordPatternFingerprint(s1, "TA", "ascent");
  const fp1 = s1.teams["TA"]!.lastPattern?.["ascent"];
  assert.ok(fp1 !== undefined, "结算点记录本图阵容指纹");
  // 换一套手动英雄分配 → 指纹必须不同（泄露走 ×0.25 分支）
  const s2 = buildMine();
  s2.teams["TA"]!.patternUsage["ascent"] = 5;
  const starters = s2.teams["TA"]!.starters;
  const lock: Record<string, Record<string, string>> = {
    ascent: Object.fromEntries(starters.map((pid, i) => [pid, AGENTS[i % AGENTS.length]!.id])),
  };
  recordPatternFingerprint(s2, "TA", "ascent", lock);
  const fp2 = s2.teams["TA"]!.lastPattern?.["ascent"];
  assert.ok(fp2 !== undefined && fp2 !== "", "手动分配同样记录指纹");
  assert.notEqual(fp1, fp2, "变阵后指纹不同 → 下场对手准备大半落空");
});

test("回放红线回归：usage>0 且已变阵时，干预重模拟的干预前回合仍逐位一致（指纹写入不得污染模拟）", () => {
  const s = buildMine();
  s.teams["TA"]!.patternUsage["ascent"] = 5;
  s.teams["TA"]!.lastPattern = { ascent: "old-lineup-fingerprint" }; // 上一场不同阵容（变阵分支）
  s.fixtures.push({ id: "L1", comp: "test", label: "红线测试", day: s.day, teamA: "TA", teamB: "TB", bo: 1, played: false } as never);
  const rec1 = playHeldMatch(s, "L1", { maps: ["ascent"] });
  assert.ok(rec1);
  const rec2 = interveneHeldMatch(s, "L1", { map: 0, round: 6, tactic: "atk:rush:A" });
  assert.ok(rec2);
  const before1 = JSON.stringify(rec1!.maps[0]!.rounds.slice(0, 5));
  const before2 = JSON.stringify(rec2!.maps[0]!.rounds.slice(0, 5));
  assert.equal(before2, before1, "干预前（回合 1-5）与首跑逐位一致");
  // 双跑后指纹保持首跑语义（读旧指纹算泄露），不被中间重模拟覆盖
  assert.equal(s.teams["TA"]!.lastPattern?.["ascent"], "old-lineup-fingerprint", "模拟不写指纹");
});

test("无使用记录（usage=0）不写指纹——赛前准备过一场才开始累计", () => {
  const s = buildMine();
  const r = simMatch(s, "TA", "TB", 1, 4242, "L0", ["ascent"]);
  assert.equal(r.maps.length, 1);
  assert.equal(s.teams["TA"]!.lastPattern?.["ascent"], undefined, "usage=0 时 leakOf 早退、不落指纹");
});

// —— ① 中段里程碑：D87（Stage1 中点）/ D192（Stage2 中点）名次检查 ——

function buildFull(seed = 105): GameState {
  resetPlayerSeq();
  resetFixtureSeq();
  const state = generateWorld(seed);
  initSeasonFixtures(state);
  state.myTeamId = Object.values(state.teams).find((t) => t.tier === 1)!.id;
  return state;
}

test("中段里程碑：D87 按即时名次调整董事会信心——垫底 -2 / 领头 +2，新闻入档", () => {
  const run = (mineFirst: boolean) => {
    const s = buildFull();
    const my = s.teams[s.myTeamId!]!;
    const compKey = `stage1-${my.regionId ?? "xia"}-t${my.tier}`;
    const comp = s.comps[compKey]!;
    assert.ok(comp, "我队联赛 comp 存在");
    // 手工积分榜：控制我队名次（榜首/垫底）
    const ids = comp.teamIds.filter((t) => t !== my.id);
    if (mineFirst) ids.unshift(my.id);
    else ids.push(my.id);
    ids.forEach((tid, i) => {
      comp.standings[tid] = { teamId: tid, w: 0, l: 0, mapW: ids.length - i, mapL: 0, roundW: 0, roundL: 0, pts: ids.length - i };
    });
    s.day = 86;
    const notes: NewsItem[] = [];
    const conf0 = s.boardConfidence;
    advanceDay(s, notes);
    const news = notes.find((n) => n.text.includes("中期检查"));
    assert.ok(news, "D87 触发中期检查新闻");
    assert.ok(news!.text.includes("Stage 1"));
    const expected = Math.max(0, Math.min(100, conf0 + (mineFirst ? 2 : -2)));
    assert.equal(s.boardConfidence, expected, mineFirst ? "榜首 → +2" : "垫底 → -2");
  };
  run(true);
  run(false);
});

test("中段里程碑：只在 D87/D192 触发一次；积分榜不足两队静默", () => {
  const s = buildFull();
  const my = s.teams[s.myTeamId!]!;
  const compKey = `stage1-${my.regionId ?? "xia"}-t${my.tier}`;
  s.comps[compKey]!.standings = {}; // 空榜
  s.day = 86;
  const notes: NewsItem[] = [];
  const conf0 = s.boardConfidence;
  advanceDay(s, notes);
  assert.equal(notes.filter((n) => n.text.includes("中期检查")).length, 0, "空榜静默");
  assert.equal(s.boardConfidence, conf0, "信心不动");
});
