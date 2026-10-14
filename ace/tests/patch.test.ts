/** 版本系统（meta 二维化，GDD §4.3 v0.9）：rollPatch 产出/meta 生效于强度/平替推荐职责守卫 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateWorld } from "../src/core/worldgen.ts";
import { initSeasonFixtures } from "../src/core/sim/day.ts";
import { rollPatch, currentPatch, recommendReplacement } from "../src/core/sim/patch.ts";
import { computeSide } from "../src/core/sim/strength.ts";
import { MAPS } from "../src/core/data/maps.ts";
import { Rng } from "../src/core/rng.ts";

function setup(seed = 808) {
  const state = generateWorld(seed);
  initSeasonFixtures(state);
  state.myTeamId = Object.values(state.teams).find((t) => t.tier === 1)!.id;
  return state;
}

test("rollPatch：产出 4-6 名英雄变化（有涨有削），首次调用确定性", () => {
  const s = setup();
  const n1 = rollPatch(s, "1", new Rng(11));
  const fresh = { ...s, patchNotes: [] };
  const n1Again = rollPatch(fresh, "1", new Rng(11));
  assert.deepEqual(
    n1.changes.map((c) => [c.agentId, c.meta]),
    n1Again.changes.map((c) => [c.agentId, c.meta]),
    "同 rng + 无 prev → 确定性",
  );
  assert.ok(n1.changes.length >= 4 && n1.changes.length <= 6, `变化数 ${n1.changes.length}`);
  assert.ok(n1.changes.some((c) => c.dir === "buff") && n1.changes.some((c) => c.dir === "nerf"), "应有涨有削");
  assert.equal(currentPatch(s)?.version, n1.version);
});

test("meta 生效于强度：patchMeta 传入 nerf 系数 → atk 低于基线", () => {
  const s = setup();
  const team = s.teams[s.myTeamId!];
  const starter = s.players[team.starters[0]!]!;
  const agentId = starter.agentPool[0]!;
  // nerf 全部英雄（确保覆盖实际分配）：单英雄可能不在该选手的自动分配里
  const withMeta: Record<string, number> = Object.fromEntries([[agentId], team.starters.flatMap((pid) => s.players[pid]!.agentPool)].flat().map((id) => [id, 0.88]));
  const map = MAPS[0]!;
  const withM = computeSide({ team, players: s.players, map, day: 60, patchMeta: withMeta });
  const noM = computeSide({ team, players: s.players, map, day: 60, patchMeta: {} });
  assert.ok(withM.atk < noM.atk, `nerf atk ${withM.atk.toFixed(2)} 应 < 基线 ${noM.atk.toFixed(2)}`);
});

test("平替推荐：同职责候选才推荐，跨职责池拒绝", () => {
  const s = setup();
  // 全先锋池（kayo/sova/fade/breach 均先锋系）：应推荐非 kayo 的同职责英雄
  const rec = recommendReplacement(s, "kayo", "ascent", ["kayo", "sova", "fade", "breach"]);
  assert.ok(rec, "同职责池应有推荐");
  assert.notEqual(rec!.agentId, "kayo");
  // 混合池（其余全决斗者）：职责覆盖 <0.3 全部跳过 → 拒绝
  const rec2 = recommendReplacement(s, "kayo", "ascent", ["kayo", "jett", "raze"]);
  assert.equal(rec2, null, "跨职责池应拒绝");
});
