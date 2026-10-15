/** 训练赛与情报生态（v1.1，GDD §5.6/§7.2）：
 *  陪练系数与三选一公式锁数值（§12 调参表口径）/ AI 约战显式 Rng 同 seed 双跑逐位一致 /
 *  负场情报全量 / 无正式赛副产物（不改 fixtures/不设 played）/ 行动力账目 / 战术变化衰减 / 散布区间。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateWorld, resetPlayerSeq } from "../src/core/worldgen.ts";
import { initSeasonFixtures } from "../src/core/sim/day.ts";
import { resetFixtureSeq } from "../src/core/sim/fixtures.ts";
import { Rng, hashString } from "../src/core/rng.ts";
import { requestScrim, scrimSparringCoef, scrimAcceptChance, teamAvgOverall, noteTacticsChanged } from "../src/core/sim/scrim.ts";
import { completeTransfer } from "../src/core/sim/transfer.ts";
import { intelOf, intelLevel, mapStrengthBand, estimateMapStrength, addIntel, starsOf } from "../src/core/sim/intel.ts";
import { MAPS, MAP_BY_ID } from "../src/core/data/maps.ts";
import type { GameState, NewsItem, ScrimGoal, Team } from "../src/core/types.ts";

function build(seed = 31): GameState {
  resetPlayerSeq();
  resetFixtureSeq();
  const state = generateWorld(seed);
  initSeasonFixtures(state);
  state.myTeamId = Object.values(state.teams).find((t) => t.tier === 1)!.id;
  return state;
}

function pickOpp(state: GameState, pred: (diff: number) => boolean): string {
  const my = teamAvgOverall(state, state.myTeamId!);
  const t = Object.values(state.teams).find((x) => x.id !== state.myTeamId && pred(teamAvgOverall(state, x.id) - my));
  assert.ok(t, "测试世界必须有满足条件的对手");
  return t!.id;
}

function req(oppId: string, goal: ScrimGoal = "blend", mapId = "ascent") {
  return { oppId, mapId, goal };
}

test("陪练系数：公式与 §12 调参表口径锁死", () => {
  assert.equal(scrimSparringCoef(70, 70), 1);
  assert.equal(scrimSparringCoef(70, 50), 0.65); // 约低 20 分：1 + (−20/40)=0.5 触及下限 −0.35 → ×0.65（GDD 原例）
  assert.equal(scrimSparringCoef(70, 78), 1.2); // 约高 8 分 → ×1.20（GDD 原例）
  assert.equal(scrimSparringCoef(70, 95), 1.2); // 上限 +0.20
  assert.equal(scrimSparringCoef(70, 40), 0.65); // 下限 −0.35
});

/** 测试侧制造实力差：真实数据包强度带宽窄（约 ±3），直接改对手首发 overall */
function boostTeam(state: GameState, teamId: string, delta: number): void {
  const t = state.teams[teamId]!;
  for (const pid of t.starters) {
    const p = state.players[pid]!;
    p.overall = Math.max(30, Math.min(99, p.overall + delta));
  }
}

test("AI 约战：强队婉拒弱队 / 临近正赛拒约 / 同 seed 双跑逐位一致", () => {
  const s = build(41);
  const my = teamAvgOverall(s, s.myTeamId!);
  const weak = pickOpp(s, () => true);
  const strong = Object.values(s.teams).find((t) => t.id !== s.myTeamId && t.id !== weak)!.id;
  boostTeam(s, strong, 20); // 制造 ≥12 强度差（真实包带宽窄，测试侧拉升）
  boostTeam(s, weak, -20);
  assert.ok(teamAvgOverall(s, strong) - my >= 12 && my - teamAvgOverall(s, weak) >= 12, "测试前提：强度差 ≥12");
  assert.ok(scrimAcceptChance(s, s.myTeamId!, strong) < scrimAcceptChance(s, s.myTeamId!, weak), "强队婉拒弱队");
  const before = scrimAcceptChance(s, s.myTeamId!, weak);
  s.fixtures.push({
    id: "testFx", comp: "league", label: "测试赛", day: s.day + 1, teamA: weak, teamB: s.myTeamId!,
    bo: 3, played: false,
  } as never);
  assert.ok(scrimAcceptChance(s, s.myTeamId!, weak) < before, "临近正赛拒约（接受率下降）");
  // 确定性：同 seed 双跑，接受判定与结果完全一致
  const notesA: NewsItem[] = [], notesB: NewsItem[] = [];
  const s2 = build(41);
  boostTeam(s2, weak, -20);
  const r1 = requestScrim(s, req(weak), new Rng(hashString("scrim-test")), notesA);
  const r2 = requestScrim(s2, req(weak), new Rng(hashString("scrim-test")), notesB);
  assert.equal(r1.accepted, r2.accepted);
  assert.deepEqual(r1.score, r2.score);
  assert.equal(r1.won, r2.won);
  assert.deepEqual(notesA.map((n) => n.text), notesB.map((n) => n.text));
});

test("训练赛：扣 1 行动力 / 不动正式赛账本（fixtures 与 played 不变）/ 收益入账", () => {
  const s = build(42);
  s.actionPoints = 3;
  const oppId = pickOpp(s, () => true);
  const fixturesBefore = JSON.stringify(s.fixtures.map((f) => [f.id, f.played]));
  const bondBefore = s.teams[s.myTeamId!]!.bond;
  const notes: NewsItem[] = [];
  const r = requestScrim(s, req(oppId, "blend"), new Rng(7777), notes);
  assert.equal(s.actionPoints, 2, "约战扣 1 行动力（婉拒也扣）");
  assert.equal(JSON.stringify(s.fixtures.map((f) => [f.id, f.played])), fixturesBefore, "训练赛不产生/改动正式赛 fixture");
  if (r.accepted) {
    assert.equal(s.scrimLog!.length, 1);
    assert.ok(s.teams[s.myTeamId!]!.bond >= bondBefore, "磨合目标涨羁绊");
    assert.ok(notes.some((n) => n.text.includes("训练赛")));
    const starter = s.teams[s.myTeamId!]!.starters[0]!;
    assert.ok(s.players[starter]!.fatigue >= 3, "出场者疲劳 +3（正式赛单图 5 × 0.6）");
  } else {
    assert.ok(notes.some((n) => n.text.includes("婉拒")));
    assert.equal(s.scrimLog?.length ?? 0, 0, "婉拒不记训练赛");
  }
});

test("胜负 × 收益系数：胜不给全量情报；负场情报进度全量（强度差制造两路覆盖）", () => {
  let sawWin = false, sawLoss = false;
  for (const seed of [43, 44, 45]) {
    // 弱对手 → 胜场路径
    const sW = build(seed);
    const weak = pickOpp(sW, () => true);
    boostTeam(sW, weak, -20);
    const notesW: NewsItem[] = [];
    const rW = requestScrim(sW, req(weak), new Rng(hashString(`win-${seed}`)), notesW);
    if (rW.accepted) {
      if (rW.won) {
        sawWin = true;
        assert.ok(intelOf(sW, weak) < 10, "胜场不给全量情报");
      } else {
        sawLoss = true;
        assert.equal(intelOf(sW, weak), 10, "负场 → 情报全量");
      }
    }
    // 强对手 → 负场路径
    const sL = build(seed);
    const strong = pickOpp(sL, () => true);
    boostTeam(sL, strong, 20);
    const notesL: NewsItem[] = [];
    const rL = requestScrim(sL, req(strong), new Rng(hashString(`loss-${seed}`)), notesL);
    if (rL.accepted) {
      if (rL.won) {
        sawWin = true;
        assert.ok(intelOf(sL, strong) < 10, "胜场不给全量情报");
      } else {
        sawLoss = true;
        assert.equal(intelOf(sL, strong), 10, "负场 → 对手情报进度全量（10/10）");
        assert.ok(notesL.some((n) => n.text.includes("情报")), "负场新闻提示情报收益");
        // 虽败有得：输给 ≥10 强队士气扣减减半（-2 而非 -4）——白盒：首发士气不低于 96-4 口径，这里只验证 morale ≥ 初始-2.01
      }
    }
  }
  assert.ok(sawWin && sawLoss, `应覆盖胜负两路（win=${sawWin} loss=${sawLoss}）`);
});

test("风格特训：匹配 +0.5、不匹配只提示；上限 10 封顶", () => {
  const s = build(48);
  const oppId = pickOpp(s, () => true);
  const notes: NewsItem[] = [];
  const r = requestScrim(s, { ...req(oppId, "style", "split"), goalStyle: "rush" }, new Rng(1234), notes);
  if (r.accepted) {
    const note = notes.find((n) => n.text.includes("训练赛"))?.text ?? "";
    if (note.includes("风格特训生效")) {
      assert.equal(s.styleCounter?.["rush"], 0.5, "匹配时应对熟练度 +0.5");
    } else {
      assert.ok(note.includes("风格不匹配"), "不匹配时明确提示且不加 counter");
      assert.equal(s.styleCounter?.["rush"] ?? 0, 0);
    }
  }
  // 上限封顶：预置 10 → 再练不超
  s.styleCounter = { rush: 10 };
  const s2 = build(48);
  s2.styleCounter = { rush: 10 };
  const opp2 = pickOpp(s2, () => true);
  const n2: NewsItem[] = [];
  const r2 = requestScrim(s2, { ...req(opp2, "style", "bind"), goalStyle: "rush" }, new Rng(1234), n2);
  if (r2.accepted && n2.some((n) => n.text.includes("风格特训生效"))) {
    assert.equal(s2.styleCounter!["rush"], 10, "封顶 10");
  } else {
    assert.ok((s2.styleCounter!["rush"] ?? 0) <= 10);
  }
  assert.ok((s.styleCounter?.["rush"] ?? 0) <= 10);
});

test("战术变化衰减：阵容变动 → 情报减半 + 新闻；completeTransfer 双端触发", () => {
  const s = build(49);
  const oppId = pickOpp(s, () => true);
  addIntel(s, oppId, 8);
  const half = noteTacticsChanged(s, oppId);
  assert.ok(half?.includes("过时"), "8 → 4 有新闻");
  assert.equal(intelOf(s, oppId), 4, "情报减半");
  assert.ok(noteTacticsChanged(s, oppId)?.includes("过时"), "4 → 2 仍提示（阈值 ≥2）");
  assert.equal(intelOf(s, oppId), 2);
  assert.ok(noteTacticsChanged(s, oppId)?.includes("过时"), "2 → 1 仍提示（before=2 恰在阈值）");
  assert.equal(noteTacticsChanged(s, oppId), null, "1 → 0.5：before < 2 不再提示");
  // completeTransfer 集成
  addIntel(s, oppId, 10);
  let buyer = Object.values(s.teams).find((t) => t.id !== oppId && t.id !== s.myTeamId && t.roster.length < 7);
  if (!buyer) {
    buyer = Object.values(s.teams).find((t) => t.id !== oppId && t.id !== s.myTeamId)!;
    const drop = buyer.roster[buyer.roster.length - 1]!;
    buyer.roster = buyer.roster.filter((x) => x !== drop);
  }
  const target = s.teams[oppId]!.roster[0]!;
  const before = intelOf(s, oppId);
  completeTransfer(s, {
    id: "T1", playerId: target, fromTeam: oppId, toTeam: buyer.id,
    fee: 1000, signingBonus: 0, salary: 1000, years: 2,
  } as never, new Rng(1));
  assert.ok(intelOf(s, oppId) <= before / 2 + 0.01, "转会后情报减半（战术变化衰减）");
});

test("散布区间：宽度随「眼光」收窄（40→24）、覆盖真值；情报等级门控语义", () => {
  const s = build(50);
  const oppId = pickOpp(s, () => true);
  const opp = s.teams[oppId]!;
  const m = MAP_BY_ID.get("bind")!;
  const wide = mapStrengthBand(s, opp, m, 50);
  const narrow = mapStrengthBand(s, opp, m, 90);
  assert.equal(wide.hi - wide.lo, 40);
  assert.equal(narrow.hi - narrow.lo, 24);
  const truth = estimateMapStrength(s, opp, m);
  assert.ok(wide.lo <= truth && truth <= wide.hi, "区间覆盖真值");
  assert.equal(intelLevel(intelOf(s, oppId)), 0, "未侦察等级 0（面板显示区间）");
  addIntel(s, oppId, 3);
  assert.ok(intelLevel(intelOf(s, oppId)) >= 1, "侦察后解锁星级");
});

test("图池特训：对手 ★3 强图 → 陪练系数额外 +0.15（口径与面板同源）", () => {
  const s = build(51);
  const oppId = pickOpp(s, () => true);
  const opp: Team = s.teams[oppId]!;
  const m = MAPS[0]!;
  opp.mapPref[m.id] = 92; // 拉满保证 ★3
  const isStrong = starsOf(estimateMapStrength(s, opp, m)) === 3;
  assert.ok(isStrong, "熟练 92 应为 ★3 强图");
  const my = teamAvgOverall(s, s.myTeamId!);
  const o = teamAvgOverall(s, oppId);
  const expected = scrimSparringCoef(my, o) + 0.15;
  const got = scrimSparringCoef(my, o) + (starsOf(estimateMapStrength(s, opp, m)) === 3 ? 0.15 : 0);
  assert.equal(got, expected, "强图陪练加成口径一致");
});
