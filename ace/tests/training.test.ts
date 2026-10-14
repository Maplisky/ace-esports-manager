/** 并行训练回归（GDD §6.3 v1.1：团队课表与个人训练并行、具体指标可见） */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateWorld } from "../src/core/worldgen.ts";
import { initSeasonFixtures, advanceDay } from "../src/core/sim/day.ts";

test("训练：个人经验按周积累，攒满 100 属性 +1；团队图池熟练只按天加成", () => {
  const state = generateWorld(11);
  initSeasonFixtures(state);
  state.myTeamId = Object.values(state.teams).find((t) => t.tier === 1)!.id;
  state.day = 1;
  // 团队：5 个跑图日 + 复盘/对抗；个人：首发第一人练枪法
  state.teamSchedule = ["map", "map", "review", "scrim", "map", "map", "map"];
  state.trainingMaps = ["ascent"];
  const team = state.teams[state.myTeamId!]!;
  const p = state.players[team.starters[0]!]!;
  state.schedules[p.id] = "aim";
  p.potential = 99; // 保证有成长空间
  p.fatigue = 10;
  p.morale = 70;

  const beforeAim = p.attrs.aim;
  const beforeMp = team.mapPref["ascent"]!;
  for (let d = 0; d < 7; d++) advanceDay(state);

  // 个人：经验池有积累（或已转化 +1）
  const gained = (p.xp?.aim ?? 0) > 0 || p.attrs.aim > beforeAim;
  assert.ok(gained, `个人经验应积累：xp.aim=${p.xp?.aim}, aim ${beforeAim}→${p.attrs.aim}`);
  // 经验跨过 100 不应死循环（v1.9 检错：while 读旧值曾导致 Worker 挂死）
  p.xp = { aim: 158 };
  const attrBefore = p.attrs.aim;
  for (let d = 0; d < 7; d++) advanceDay(state); // 覆盖下一个周结算日
  assert.equal(p.attrs.aim, attrBefore + 1, "跨过 100 应恰好 +1");
  assert.ok((p.xp.aim ?? 0) < 100, `余量应回落到 100 内: ${p.xp?.aim}`);
  // 团队：两次周结算 × 5 个跑图日 × 0.4 = +4（按天一次，不被人数放大）
  const mpGain = team.mapPref["ascent"]! - beforeMp;
  assert.ok(mpGain >= 3.5 && mpGain <= 4.5, `图池熟练增益 ${mpGain} 应在 3.5-4.5 之间（两次结算×0.4×5天）`);
});
