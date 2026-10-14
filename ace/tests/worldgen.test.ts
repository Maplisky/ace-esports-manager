import { test } from "node:test";
import assert from "node:assert/strict";
import { Rng, hashString } from "../src/core/rng.ts";
import { generateWorld, computeOverall } from "../src/core/worldgen.ts";
import { initSeasonFixtures, advanceDay, daysInYear, migrateLegacyComps } from "../src/core/sim/day.ts";
import { migrateMapsToRealPool } from "../src/core/worldgen.ts";

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

test("世界生成：规模与健全性（v0.7 真实数据包）", () => {
  const state = generateWorld(2026);
  const teams = Object.values(state.teams);
  assert.equal(teams.length, 64);
  const t1 = teams.filter((t) => t.tier === 1);
  const t2 = teams.filter((t) => t.tier === 2);
  assert.ok(t1.length >= 40 && t1.length <= 56, `VCT 合作队 ${t1.length}`);
  assert.equal(t1.length + t2.length, 64);
  // 四大赛区（vlr.gg）：每区 16 队 = VCT 合作队（partnered 铁证判定，≥10）+ 挑战者
  for (const rid of ["americas", "emea", "pacific", "china"]) {
    const rs = teams.filter((t) => t.regionId === rid);
    assert.equal(rs.length, 16, `${rid} 总数`);
    assert.ok(rs.filter((t) => t.tier === 1).length >= 10, `${rid} VCT`);
  }
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
    }
  }
  // 真实选手带 vlr 数据与头像；虚拟生成的必须标注 synthetic
  const rostered = Object.values(state.players).filter((p) => p.teamId);
  const real = rostered.filter((p) => p.id.startsWith("R"));
  assert.ok(real.length >= 300, `真实选手 ${real.length} 应 ≥300（staff 已分离不占名额）`);
  assert.ok(real.every((p) => p.avatar && p.ign && p.agentPool.length >= 3), "真实选手应有头像与英雄池");
  const syn = rostered.filter((p) => p.synthetic === "academy");
  assert.ok(syn.length > 0 && syn.every((p) => p.homegrown), "青训补充需标注 academy 且 homegrown");
  // 一级整体强于次级
  const avg = (ts: typeof teams) =>
    ts.reduce((s, t) => s + t.roster.reduce((x, pid) => x + (state.players[pid]?.overall ?? 0), 0) / t.roster.length, 0) / ts.length;
  assert.ok(avg(t1) > avg(t2), `一级均值 ${avg(t1).toFixed(1)} 应高于次级 ${avg(t2).toFixed(1)}`);
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

test("赛历与翻年：自然年日历（含四赛区 Stage2/休赛期），年末按实际天数翻年", () => {
  const state = generateWorld(777);
  initSeasonFixtures(state);
  state.myTeamId = Object.values(state.teams).find((t) => t.tier === 1)!.id;
  // 赛程数量：揭幕杯 7（跨赛区）；四赛区 × 双 Stage 各 (VCT 90 + 挑战者 30)
  const expectFixtures = 7 + Object.values(state.comps).filter((c) => c.key !== "cup").reduce((sum, c) => {
    const n = c.teamIds.length;
    return sum + (n >= 2 ? n * (n - 1) : 0);
  }, 0);
  assert.equal(state.fixtures.length, expectFixtures);
  // 推进到 Stage1 收官前夕（121）：杯赛 + 四赛区 Stage1 全部打完，Stage2 未开打
  for (let d = 0; d < 400 && state.day < 121; d++) {
    advanceDay(state);
  }
  assert.equal(state.day, 121, "应推进到 Stage1 收官前夕");
  const unplayedBefore = state.fixtures.filter((f) => f.teamA !== "" && f.teamB !== "" && !f.played);
  assert.ok(unplayedBefore.every((f) => f.stage === "stage2"), "121 天前未打的只能是 Stage2");
  assert.equal(unplayedBefore.length, state.fixtures.filter((f) => f.stage === "stage2").length, "Stage2 全部未打");
  // Stage1 积分守恒（Americas VCT 双循环 = n(n-1) 胜负）
  const comp = state.comps["stage1-americas-t1"]!;
  const totalPlayed = Object.values(comp.standings).reduce((s, e) => s + e.w + e.l, 0);
  const n1 = Object.keys(comp.standings).length;
  assert.equal(totalPlayed, 2 * n1 * (n1 - 1));
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
  assert.ok(state.fixtures.length > 1000, "新赛季赛程已生成（四赛区，Masters 待抽签）");
  assert.ok(state.news.some((n) => n.text.includes("收官")));
  assert.ok(state.news.some((n) => n.text.includes("2027 赛季开始")));
  assert.ok(state.news.some((n) => n.text.includes("联赛进入前四")));
  assert.equal(aPlayer.age, ageAtStart + 1, "翻年年龄 +1");
  assert.ok(aPlayer.contractYears >= 0, "合同年递减不越界");
});

test("Masters 国际赛：Stage1 四赛区各前二晋级，单败淘汰 7 场，冠军记荣誉", () => {
  const state = generateWorld(99);
  initSeasonFixtures(state);
  state.myTeamId = Object.values(state.teams).find((t) => t.tier === 1)!.id;
  // 推进过夏季窗口首日（123）：Masters 已抽签
  for (let d = 0; d < 400 && state.day < 124; d++) {
    advanceDay(state);
  }
  const masters = state.comps["masters"]!;
  assert.ok(masters, "夏季窗口首日应完成 Masters 抽签");
  assert.equal(masters.teamIds.length, 8);
  // 四赛区各 2 队，且都是一级队
  for (const rid of ["americas", "emea", "pacific", "china"]) {
    const fromRegion = masters.teamIds.filter((id) => state.teams[id]?.regionId === rid);
    assert.equal(fromRegion.length, 2, `${rid} 应 2 队晋级`);
    assert.ok(fromRegion.every((id) => state.teams[id]?.tier === 1));
    // 晋级队 = 该赛区 Stage1 积分前二（与 buildMasters 同一套同分裁决：积分→图差→回合差）
    const table = Object.values(state.comps[`stage1-${rid}-t1`]!.standings).sort(
      (a, b) => b.pts - a.pts || (b.mapW - b.mapL) - (a.mapW - a.mapL) || (b.roundW - b.roundL) - (a.roundW - a.roundL),
    );
    assert.deepEqual(new Set(fromRegion), new Set(table.slice(0, 2).map((s) => s.teamId)));
  }
  const mastersFixtures = state.fixtures.filter((f) => f.comp === "masters");
  assert.equal(mastersFixtures.length, 7, "8 队单败 = QF4 + SF2 + 决赛 1");
  assert.ok(mastersFixtures.every((f) => f.stage === "masters"));
  assert.ok(state.news.some((n) => n.text.includes("Masters")));
  // 打完 Masters（3 轮至 140 天）
  for (let d = 0; d < 60 && state.fixtures.some((f) => f.comp === "masters" && !f.played && f.teamA !== ""); d++) {
    advanceDay(state);
  }
  const played = state.fixtures.filter((f) => f.comp === "masters" && f.played);
  assert.equal(played.length, 7, "Masters 应全部打完");
  const finalF = played.find((f) => f.label.includes("总决赛"))!;
  const champId = Object.values(masters.standings).sort((a, b) => b.w - a.w)[0]!.teamId;
  const champTeam = state.teams[champId]!;
  assert.ok(champTeam.roster.every((pid) => state.players[pid]!.career.titles > 0), "冠军全队荣誉 +1");
  assert.ok(state.news.some((n) => n.text.includes("Masters 国际赛冠军")), "冠军新闻");
});

test("闰年：2028 为 366 天（GDD 日期表考虑闰年）", () => {
  assert.equal(daysInYear(2026), 365);
  assert.equal(daysInYear(2028), 366);
  assert.equal(daysInYear(2000), 366);
  assert.equal(daysInYear(2100), 365);
});

test("旧档迁移：comp key 改名后过渡年结算与翻年不失效（v0.5/v0.6 兼容）", () => {
  const state = generateWorld(2026);
  initSeasonFixtures(state);
  // 模拟 v0.5 旧档：单赛区、旧 comp key、无 regionId（四个联赛 comp 齐全）
  const legacyState = generateWorld(2026);
  legacyState.fixtures = [];
  legacyState.comps = {};
  // 旧档世界 = 霞赛区（Americas VCT 队扮演旧档队伍）
  const oldRegionTeams = Object.values(state.teams).filter((t) => t.regionId === "americas");
  for (const t of Object.values(legacyState.teams)) {
    const keep = oldRegionTeams.some((x) => x.id === t.id);
    if (!keep) {
      for (const pid of t.roster) delete legacyState.players[pid];
      delete legacyState.teams[t.id];
    }
  }
  legacyState.myTeamId = oldRegionTeams.find((t) => t.tier === 1)!.id;
  const t1 = oldRegionTeams.filter((t) => t.tier === 1).map((t) => t.id);
  const t2 = oldRegionTeams.filter((t) => t.tier === 2).map((t) => t.id);
  legacyState.comps["stage1-t1"] = { key: "stage1-t1", name: "旧", stage: "stage1", teamIds: t1, standings: {} };
  legacyState.comps["stage1-t2"] = { key: "stage1-t2", name: "旧", stage: "stage1", teamIds: t2, standings: {} };
  legacyState.comps["stage2-t1"] = { key: "stage2-t1", name: "旧", stage: "stage2", teamIds: t1, standings: {} };
  legacyState.comps["stage2-t2"] = { key: "stage2-t2", name: "旧", stage: "stage2", teamIds: t2, standings: {} };
  for (const comp of Object.values(legacyState.comps)) {
    for (const id of comp.teamIds) {
      comp.standings[id] = { teamId: id, w: 0, l: 0, mapW: 0, mapL: 0, roundW: 0, roundL: 0, pts: 0 };
    }
  }
  for (const t of Object.values(legacyState.teams)) t.regionId = "xia";
  // 迁移
  migrateLegacyComps(legacyState);
  assert.ok(legacyState.comps["stage1-xia-t1"], "旧 key 应改名");
  assert.ok(!legacyState.comps["stage1-t1"], "旧 key 应删除");
  // 重复迁移幂等
  migrateLegacyComps(legacyState);
  assert.ok(legacyState.comps["stage1-xia-t1"]);
  // 旧档比赛走补赛通道：手造一轮对阵验证结算与冠军荣誉发生（修复前静默丢失）
  legacyState.fixtures.push({
    id: "FX1", day: 100, stage: "stage1", comp: "stage1-xia-t1",
    teamA: t1[0]!, teamB: t1[1]!, bo: 3, label: "旧档补赛 第1轮", played: false,
  });
  for (let d = 0; d < 400 && legacyState.day < 123; d++) advanceDay(legacyState);
  assert.ok(legacyState.news.some((n) => n.text.includes("Stage 1目标")), "过渡年目标结算生效");
  assert.ok(legacyState.news.some((n) => n.text.includes("加冕")), "过渡年冠军荣誉生效");
});

test("tier-2 球队：目标对挑战者联赛结算（v0.6-1 检错：此前静默跳过）", () => {
  const state = generateWorld(31);
  initSeasonFixtures(state);
  state.myTeamId = Object.values(state.teams).find((t) => t.tier === 2)!.id;
  for (let d = 0; d < 400 && state.day < 123; d++) advanceDay(state);
  // 目标文案按级别给出，结算对该队所在挑战者联赛生效（达成或未达成都应有判定新闻）
  assert.ok(state.news.some((n) => n.text.includes("挑战者联赛进入前四")), "挑战者目标文案");
  assert.ok(state.news.some((n) => n.text.includes("Stage 1目标")), "结算已发生（修复前 findIndex=0 直接 return）");
});

test("自由人池：64 队世界开局 50 人（与队伍数等比），虚拟生成需标注", () => {
  const state = generateWorld(55);
  const fas = Object.values(state.players).filter((p) => !p.teamId);
  assert.equal(fas.length, 50);
  assert.ok(fas.every((p) => p.synthetic === "free"), "自由池为虚拟生成，必须标注");
});


test("旧档地图迁移：虚构 id 全量映射真实池，合并取大/求和，幂等", () => {
  const state = generateWorld(2026);
  initSeasonFixtures(state);
  const t = Object.values(state.teams)[0]!;
  t.mapPref = { jingjie: 70, ascent: 60, xueyuan: 80 };
  t.patternUsage = { ascent: 2, jingjie: 3 };
  t.presets = { jingjie: [{ name: "旧预案", agents: {}, preferred: true } as never] };
  state.trainingMaps = ["jingjie", "kongting"];
  state.fixtures.push({ id: "FXM", day: 60, stage: "stage1", comp: "cup", teamA: t.id, teamB: Object.values(state.teams)[1]!.id, bo: 3, label: "迁移测试", played: false, mapLock: ["xueyuan", "jingjie"], agentLock: { fenlu: { X: "jett" } } });
  migrateMapsToRealPool(state);
  assert.equal(t.mapPref["ascent"], 70);
  assert.equal(t.mapPref["split"], 80);
  assert.ok(!("jingjie" in t.mapPref) && !("xueyuan" in t.mapPref));
  assert.equal(t.patternUsage["ascent"], 5);
  assert.equal(t.presets["ascent"]?.[0]?.name, "旧预案");
  assert.deepEqual(state.trainingMaps, ["ascent", "lotus"]);
  assert.deepEqual(state.fixtures.at(-1)!.mapLock, ["split", "ascent"]);
  assert.deepEqual(Object.keys(state.fixtures.at(-1)!.agentLock!), ["sunset"]);
  migrateMapsToRealPool(state);
  assert.equal(t.mapPref["ascent"], 70);
  assert.equal(t.patternUsage["ascent"], 5);
});