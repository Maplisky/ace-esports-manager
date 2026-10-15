import { test } from "node:test";
import assert from "node:assert/strict";
import { Rng } from "../src/core/rng.ts";
import { generateWorld, resetPlayerSeq } from "../src/core/worldgen.ts";
import {
  RETIRE_CARD_ID, coachValueOf, fameOf, resolveRetireCard, retireProb, seasonRetirements, signCoach,
} from "../src/core/sim/retirement.ts";
import { resolveEvent } from "../src/core/sim/events.ts";
import type { CoachFreeAgent, GameState, Player } from "../src/core/types.ts";

function build(seed = 7): GameState {
  resetPlayerSeq();
  const s = generateWorld(seed);
  s.myTeamId = Object.values(s.teams).find((t) => t.tier === 1)!.id;
  for (const t of Object.values(s.teams)) {
    t.staff = {};
    t.budget = Math.max(t.budget, 5_000_000);
  }
  s.coachPool = [];
  s.retireLog = [];
  return s;
}

function makeVeteran(s: GameState, teamId: string, over: Partial<Player>): Player {
  const rng = new Rng(1);
  const team = s.teams[teamId]!;
  const pid = "vet_test_1";
  const p: Player = {
    id: pid, ign: "老将", name: "老将", age: 33, overall: 78, potential: 78,
    teamId, role: "sentinel", agentPool: ["omen"], agentPro: { omen: 60 },
    attrs: { aim: 70, reaction: 70, awareness: 70, utility: 70, clutch: 70, teamwork: 70, communication: 80, igl: 40 },
    career: { maps: 400, rounds: 900, kills: 500, deaths: 450, assists: 120, firstKills: 60, firstDeaths: 40, clutches: 6, mvps: 4, titles: 2 },
    morale: 70, fatigue: 20, form: 70, salary: 400_000, contractYears: 1,
    promisedRole: "starter", listed: false, listedWeeks: 0, benchedWeeks: 0,
    injuredUntilDay: 0, isIgl: false, homegrown: false, noPoach: false,
    seed: 1, ambition: 50,
    ...over,
  } as unknown as Player;
  s.players[pid] = p;
  team.roster.push(pid);
  return p;
}

test("退役检定：概率公式单调性（年龄↑概率↑、冠军↑概率↓）", () => {
  resetPlayerSeq();
  const s = generateWorld(7);
  const mk = (age: number, titles: number, ambition: number): Player =>
    ({ age, career: { titles }, ambition } as unknown as Player);
  const young1 = retireProb(mk(29, 0, 50));
  const young2 = retireProb(mk(33, 0, 50));
  const champ = retireProb(mk(33, 3, 50));
  const ambit = retireProb(mk(33, 0, 80));
  assert.ok(young2 > young1, "年龄越大概率越高");
  assert.ok(champ < young2, "冠军降低概率");
  assert.ok(ambit < young2, "高野心降低概率");
  assert.ok(retireProb(mk(38, 0, 20)) >= 0.85 || retireProb(mk(38, 0, 20)) > 0.5, "高龄高概率");
});

test("赛季退役：AI 老将退役→执教意愿分流→自由池+留档+名单补位", () => {
  const s = build();
  const aiTeam = Object.values(s.teams).find((t) => t.id !== s.myTeamId)!;
  const vet = makeVeteran(s, aiTeam.id, { age: 34, attrs: { aim: 70, reaction: 70, awareness: 70, utility: 70, clutch: 70, teamwork: 70, communication: 95, igl: 40 } as never, career: { maps: 500, rounds: 0, kills: 0, deaths: 0, assists: 0, firstKills: 0, firstDeaths: 0, clutches: 0, mvps: 6, titles: 3 } } as never);
  aiTeam.roster = aiTeam.roster.slice(0, 5); // 留出补位空间
  const before = aiTeam.roster.length;
  // 多种子采样确保触发退役且大多数路径进教练池（沟通 95 + 3 冠 → 意愿极高）
  let coachSeen = false;
  for (let seed = 1; seed <= 20 && !coachSeen; seed++) {
    const s2 = build(seed);
    const t2 = Object.values(s2.teams).find((t) => t.id !== s2.myTeamId)!;
    const v2 = makeVeteran(s2, t2.id, { age: 34, attrs: { aim: 70, reaction: 70, awareness: 70, utility: 70, clutch: 70, teamwork: 70, communication: 95, igl: 40 } as never, career: { maps: 500, rounds: 0, kills: 0, deaths: 0, assists: 0, firstKills: 0, firstDeaths: 0, clutches: 0, mvps: 6, titles: 3 } } as never);
    t2.roster = t2.roster.slice(0, 5);
    const roll = new Rng(seed * 7919).chance(retireProb(v2));
    if (!roll) continue;
    seasonRetirements(s2, new Rng(seed * 104729), []);
    // 教练路径判定：自由池含老将，或任一 AI 队教练组已将其签走（同生态当场签约）
    const inPool = s2.coachPool!.some((c) => c.name === "老将");
    const inStaff = Object.values(s2.teams).some((t) => Object.values(t.staff).some((st) => st?.name === "老将"));
    if (inPool || inStaff) {
      coachSeen = true;
      assert.ok(s2.retireLog!.some((r) => r.ign === "老将" && r.path === "coach"), "留档应记录教练路径");
      assert.ok(!s2.players[v2.id], "退役选手应移出 players");
      assert.ok(t2.roster.length >= before, "AI 名册应自动补位");
    }
  }
  assert.ok(coachSeen, "高沟通冠军老将应进教练自由池");
  void vet; void s;
});

test("劝留对话：加薪成功留队 / 仪式退役进留档 / 挂牌暂缓", () => {
  const s = build();
  const vet = makeVeteran(s, s.myTeamId!, { age: 32 });
  const card = {
    uid: "t1", cardId: RETIRE_CARD_ID, title: "t", text: "t", negative: false,
    targetPlayerId: vet.id, day: 1,
    options: [{ label: "a", result: "" }, { label: "b", result: "" }, { label: "c", result: "" }, { label: "d", result: "" }, { label: "e", result: "" }],
  };
  // 挂牌：确定性暂缓
  const r2 = resolveRetireCard(s, card, 2, new Rng(1));
  assert.ok(r2.result.includes("挂牌"));
  assert.equal(vet.listed, true);
  assert.ok(s.players[vet.id], "挂牌后仍在名单");
  vet.listed = false;
  // 仪式退役：必退 + 留档 + 士气
  s.boardConfidence = 50;
  resolveRetireCard(s, card, 3, new Rng(5));
  assert.ok(!s.players[vet.id], "仪式退役应移出 players");
  assert.equal(s.retireLog!.length, 1);
  assert.ok(s.retireLog![0]!.teamName, "留档应带母队名");
});

test("退役卡经 resolveEvent 结算后必须出队（防重复阻塞）", () => {
  const s = build();
  const vet = makeVeteran(s, s.myTeamId!, { age: 31 });
  s.pendingEvents.push({
    uid: "retire_t", cardId: RETIRE_CARD_ID, title: "t", text: "t", negative: false,
    targetPlayerId: vet.id, day: 1,
    options: [{ label: "a", result: "" }, { label: "b", result: "" }, { label: "c", result: "" }, { label: "d", result: "" }, { label: "e", result: "" }],
  });
  // 挂牌分支（确定性）
  const r = resolveEvent(s, "retire_t", 2, new Rng(3));
  assert.ok(r?.result.includes("挂牌"));
  assert.equal(s.pendingEvents.length, 0, "退役卡结算后必须出队，否则事件卡模态被永久阻塞");
  // 目标已离队的兜底：卡同样必须出队
  vet.listed = false;
  s.players["gone"] = s.players["gone"] ?? vet; // 复用任意选手做离队模拟
  const gone = s.players["gone"];
  gone.teamId = null;
  s.pendingEvents.push({
    uid: "retire_t2", cardId: RETIRE_CARD_ID, title: "t", text: "t", negative: false,
    targetPlayerId: gone.id, day: 1,
    options: [{ label: "a", result: "" }, { label: "b", result: "" }, { label: "c", result: "" }, { label: "d", result: "" }, { label: "e", result: "" }],
  });
  const r2 = resolveEvent(s, "retire_t2", 0, new Rng(1));
  assert.ok(r2?.result.includes("已离队"));
  assert.equal(s.pendingEvents.length, 0);
});

test("教练签约：自由池签入槽位、重复签约报错", () => {
  const s = build();
  s.coachPool!.push({ id: "coach_x", name: "名帅", fame: 80, comm: 90, titles: 3, mvps: 5, isIgl: true, homegrownClubId: null, retiredYear: 2026, value: 88 });
  const err = signCoach(s, "coach_x", "training");
  assert.equal(err, null);
  assert.equal(s.teams[s.myTeamId!]!.staff.training!.name, "名帅");
  assert.equal(s.teams[s.myTeamId!]!.staff.training!.value, 88);
  const err2 = signCoach(s, "coach_x", "mapTactics");
  assert.ok(err2, "重复签约应报错");
  assert.equal(s.coachPool!.length, 0);
});

test("大招点数逐特工：全员 6-8 且低点数特工先就绪", async () => {
  const { AGENTS, ultCostOf } = await import("../src/core/data/agents.ts");
  for (const a of AGENTS) {
    assert.ok(a.ultCost >= 6 && a.ultCost <= 8, `${a.id} ultCost=${a.ultCost} 越界`);
  }
  // 自足型（芮娜 6）先于团队型（杰斯 8）就绪
  assert.ok(ultCostOf("reyna") < ultCostOf("jett"));
});

test("名望与教练能力折算：冠军/MVP/沟通驱动", () => {
  resetPlayerSeq();
  const s = generateWorld(7);
  const base = { age: 30, overall: 75 } as unknown as Player;
  const star = { ...base, career: { titles: 4, mvps: 10, firstKills: 400 }, attrs: { communication: 95 } } as unknown as Player;
  const roleplayer = { ...base, career: { titles: 0, mvps: 0, firstKills: 0 }, attrs: { communication: 40 } } as unknown as Player;
  assert.ok(fameOf(star) > fameOf(roleplayer));
  assert.ok(coachValueOf(star) > coachValueOf(roleplayer));
});
