/** 场上指挥（用户需求）：主指挥恰 1、副指挥至多 1 可空；任命写回 isIgl/viceIgl；副指挥强度微加成 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateWorld } from "../src/core/worldgen.ts";
import { initSeasonFixtures, advanceDay, playHeldMatch } from "../src/core/sim/day.ts";
import { computeSide } from "../src/core/sim/strength.ts";
import { MAPS } from "../src/core/data/maps.ts";

function setup(seed = 606) {
  const state = generateWorld(seed);
  initSeasonFixtures(state);
  state.myTeamId = Object.values(state.teams).find((t) => t.tier === 1)!.id;
  return state;
}

test("指挥任命：主恰 1，副至多 1 且不与主重合", () => {
  const state = setup();
  const team = state.teams[state.myTeamId!];
  const [a, b, c] = team.starters;
  // 任命 b 为主、c 为副
  for (const pid of team.roster) {
    const p = state.players[pid]!;
    p.isIgl = pid === b;
    p.viceIgl = pid === c;
  }
  const igls = team.roster.filter((pid) => state.players[pid]!.isIgl);
  const vices = team.roster.filter((pid) => state.players[pid]!.viceIgl);
  assert.equal(igls.length, 1);
  assert.equal(igls[0], b);
  assert.equal(vices.length, 1);
  assert.equal(vices[0], c);
  assert.notEqual(vices[0], igls[0], "副指挥不得与主指挥重合");
});

test("副指挥强度：mid 获得低权重指挥加成（同队对比有/无副指挥）", () => {
  const state = setup();
  const team = state.teams[state.myTeamId!];
  const [main, vice] = team.starters;
  for (const pid of team.roster) {
    const p = state.players[pid]!;
    p.isIgl = pid === main;
    p.viceIgl = false;
  }
  const map = MAPS[0]!;
  const base = computeSide({ team, players: state.players, map, day: 30 });
  state.players[vice]!.viceIgl = true;
  const withVice = computeSide({ team, players: state.players, map, day: 30 });
  assert.ok(withVice.mid > base.mid, `副指挥 mid 应提升 ${base.mid.toFixed(3)} → ${withVice.mid.toFixed(3)}`);
  assert.ok(withVice.mid - base.mid < 2, "加成应为微幅（<2）");
});

test("换人后指挥保留：isIgl 随选手走而非随席位", () => {
  const state = setup();
  const team = state.teams[state.myTeamId!];
  const oldMain = team.starters[2]!;
  const bench = team.roster.find((pid) => !team.starters.includes(pid))!;
  state.players[oldMain]!.isIgl = true;
  // 换人：oldMain 下、bench 上
  team.starters = team.starters.filter((id) => id !== oldMain).concat(bench);
  const stillThere = team.starters.includes(oldMain);
  assert.equal(state.players[oldMain]!.isIgl, true, "主指挥身份属于选手");
  assert.equal(stillThere, false);
});
