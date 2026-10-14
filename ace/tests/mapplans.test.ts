import { test } from "node:test";
import assert from "node:assert/strict";
import { MAPS } from "../src/core/data/maps.ts";
import { MAP_PLANS, planOf, positionFor, plantZoneOf, PLAN_W, PLAN_H } from "../src/core/data/mapplans.ts";

test("地图平面：每张真实地图都有专属布局且结构完整", () => {
  for (const m of MAPS) {
    const plan = planOf(m.id);
    assert.ok(plan, `${m.id} 缺平面布局`);
    const siteIds = plan!.zones.filter((z) => z.kind === "site").map((z) => z.id);
    assert.equal(siteIds.length, m.sites, `${m.id} 站点数应=${m.sites}，实际=${siteIds.length}`);
    assert.ok(plan!.zones.some((z) => z.id === "spawnA"), `${m.id} 缺 A 队出生区`);
    assert.ok(plan!.zones.some((z) => z.id === "spawnB"), `${m.id} 缺 B 队出生区`);
    assert.ok(plan!.zones.some((z) => z.kind === "mid" || z.kind === "lane"), `${m.id} 缺中路/通道`);
    for (const z of plan!.zones) {
      assert.ok(Number.isFinite(z.x) && Number.isFinite(z.y) && z.w > 0 && z.h > 0, `${m.id} zone ${z.id} 尺寸非法`);
      assert.ok(z.x >= 0 && z.y >= 0 && z.x + z.w <= PLAN_W && z.y + z.h <= PLAN_H, `${m.id} zone ${z.id} 越界`);
    }
  }
});

test("地图平面：站位确定性、区内散布、下包后收缩到包点", () => {
  const duties = ["duelist", "initiator", "controller", "sentinel", "flex"] as const;
  for (const m of MAPS) {
    for (const duty of duties) {
      for (const isAtk of [true, false]) {
        for (const plant of [false, true]) {
          const a = positionFor(m.id, { duty, isAttacking: isAtk, roundN: 7, pid: "p1", plantRevealed: plant, side: "bottom" });
          const b = positionFor(m.id, { duty, isAttacking: isAtk, roundN: 7, pid: "p1", plantRevealed: plant, side: "bottom" });
          assert.deepEqual(a, b, `${m.id}/${duty} 站位不确定`);
          assert.ok(a.x >= 0 && a.x <= PLAN_W && a.y >= 0 && a.y <= PLAN_H, `${m.id}/${duty} 站位越界`);
        }
      }
    }
    // 下包后：所有棋子应收缩到预期包点 zone
    const plan = MAP_PLANS[m.id]!;
    const pz = plantZoneOf(m.id, 9);
    const zone = plan.zones.find((z) => z.id === pz)!;
    for (const duty of duties) {
      const pos = positionFor(m.id, { duty, isAttacking: true, roundN: 9, pid: "px", plantRevealed: true, side: "top" });
      assert.ok(pos.x >= zone.x - 1 && pos.x <= zone.x + zone.w + 1 && pos.y >= zone.y - 1 && pos.y <= zone.y + zone.h + 1,
        `${m.id} 下包后未收缩到 ${pz}: ${JSON.stringify(pos)}`);
    }
  }
});
