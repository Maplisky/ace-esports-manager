/** 青训营管线（v0.9，GDD §6.5 落地）：每队 2 学员不占名单、成长 ×1.5、晋升一线 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateWorld } from "../src/core/worldgen.ts";
import { initSeasonFixtures, advanceDay } from "../src/core/sim/day.ts";
import { Rng } from "../src/core/rng.ts";

function setup(seed = 123) {
  const state = generateWorld(seed);
  initSeasonFixtures(state);
  state.myTeamId = Object.values(state.teams).find((t) => t.tier === 1)!.id;
  return state;
}

test("青训营：每队 2 名 ≤18 岁学员，不占一线名单，homegrown 标记", () => {
  const s = setup();
  for (const t of Object.values(s.teams)) {
    assert.equal(t.academy.length, 2, `${t.name} 学员数`);
    for (const pid of t.academy) {
      const p = s.players[pid]!;
      assert.equal(p.homegrown, true);
      assert.ok(p.age <= 18, `学员年龄 ${p.age} 应 ≤18`);
      assert.equal(t.roster.includes(pid), false, "学员不占一线名单");
    }
  }
});

test("青训成长：≤18 岁学员个人训练经验 ×1.5", () => {
  const s = setup();
  s.day = 6;
  const team = s.teams[s.myTeamId!];
  const acadId = team.academy[0]!;
  const first = team.starters[0]!;
  // 让学员与首发练同一项目、条件对齐，直接比较 xp 增速
  s.schedules[acadId] = "aim";
  s.schedules[first] = "aim";
  const acadP = s.players[acadId]!;
  const firstP = s.players[first]!;
  acadP.morale = firstP.morale;
  acadP.fatigue = firstP.fatigue;
  advanceDay(s);
  // 青训在 academy，先发在 roster——both isMine
  const acadXp = acadP.xp?.aim ?? 0;
  const firstXp = firstP.xp?.aim ?? 0;
  assert.ok(acadXp > 0, "青训学员有训练经验");
  assert.ok(acadXp > firstXp, `青训经验 ${acadXp.toFixed(2)} 应高于一线 ${firstXp.toFixed(2)}（×1.5）`);
});
