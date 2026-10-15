/** 开局体验完整版（v1.2，GDD §3）：天赋分配红线 + 预制配置口径 + 引导清单状态语义。
 *  红线：applyTalents 只写 manager.skills 初值、零 RNG——同 seed 世界（选手/队伍）逐位一致。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateWorld, resetPlayerSeq } from "../src/core/worldgen.ts";
import { initSeasonFixtures } from "../src/core/sim/day.ts";
import { resetFixtureSeq } from "../src/core/sim/fixtures.ts";
import { applyTalents, TALENT_PRESETS, TALENT_POOL, TALENT_BASE, TALENT_CAP, initCareer, SKILL_CN, type ManagerSkillKey } from "../src/core/sim/career.ts";
import type { GameState } from "../src/core/types.ts";

function build(seed = 61): GameState {
  resetPlayerSeq();
  resetFixtureSeq();
  const state = generateWorld(seed);
  initSeasonFixtures(state);
  state.myTeamId = Object.values(state.teams).find((t) => t.tier === 1)!.id;
  return state;
}

test("推荐配置：四套各恰好用满天赋池，键与八维一致", () => {
  const keys = Object.keys(SKILL_CN) as ManagerSkillKey[];
  assert.equal(keys.length, 8, "八维技能");
  for (const p of TALENT_PRESETS) {
    const sum = keys.reduce((s, k) => s + (p.points[k] ?? 0), 0);
    assert.equal(sum, TALENT_POOL, `${p.label} 应恰好用满 ${TALENT_POOL} 点`);
    for (const k of keys) assert.ok(k in p.points, `${p.label} 覆盖 ${k}`);
  }
});

test("applyTalents：只改 manager.skills，世界逐位不变（RNG 红线）", () => {
  const s = build(62);
  const playersBefore = JSON.stringify(s.players);
  const teamsBefore = JSON.stringify(s.teams);
  const fixturesBefore = JSON.stringify(s.fixtures);
  applyTalents(s, { tactics: 7, scouting: 5, training: 4, locker: 3, negotiation: 2, medical: 1, business: 1, youth: 1 });
  assert.equal(JSON.stringify(s.players), playersBefore, "选手逐位一致");
  assert.equal(JSON.stringify(s.teams), teamsBefore, "队伍逐位一致");
  assert.equal(JSON.stringify(s.fixtures), fixturesBefore, "赛程逐位一致");
  assert.equal(s.manager.skills.tactics, TALENT_BASE + 7);
  assert.equal(s.manager.skills.youth, TALENT_BASE + 1);
});

test("applyTalents：超出上限钳制；缺省项回落基础值", () => {
  const s = build(63);
  applyTalents(s, { tactics: 99 });
  assert.equal(s.manager.skills.tactics, TALENT_CAP, `单项封顶 ${TALENT_CAP}`);
  assert.equal(s.manager.skills.business, TALENT_BASE, "未分配项回落基础值");
});

test("出身加成叠加在天赋之上（顺序：applyTalents → initCareer）", () => {
  const s = build(64);
  applyTalents(s, { negotiation: 5, scouting: 8 });
  initCareer(s, "legend");
  assert.equal(s.manager.skills.negotiation, TALENT_BASE + 5 + 5, "名宿谈判 +5 叠加");
  const s2 = build(64);
  applyTalents(s2, { scouting: 8 });
  initCareer(s2, "grassroots");
  assert.equal(s2.manager.skills.scouting, TALENT_BASE + 8 + 8, "草根眼光 +8 叠加");
});

test("同 seed 双跑：世界与赛程逐位一致（生成流与天赋无关）", () => {
  const a = build(65);
  const b = build(65);
  assert.equal(JSON.stringify(a.players), JSON.stringify(b.players));
  assert.equal(JSON.stringify(a.fixtures), JSON.stringify(b.fixtures));
});
