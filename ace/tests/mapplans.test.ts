import { test } from "node:test";
import assert from "node:assert/strict";
import { MAPS } from "../src/core/data/maps.ts";
import { planOf, positionFor, plantZoneOf, PLAN_W, PLAN_H, tacticLabel, MAP_ART } from "../src/core/data/mapplans.ts";

const DUTIES = ["duelist", "initiator", "controller", "sentinel", "flex"] as const;
const TACTICS = ["atk:default", "atk:midSplit", "atk:ecoStack", "atk:rush:A", "atk:rush:B", "def:standard", "def:aggro", "def:stack:A", "def:stack:B"];

test("地图平面：每张真实地图都有标定区域、底图与完整结构", () => {
  for (const m of MAPS) {
    const plan = planOf(m.id);
    assert.ok(plan, `${m.id} 缺平面数据`);
    assert.ok(MAP_ART[m.id]?.endsWith(".png"), `${m.id} 缺底图路径`);
    const siteIds = plan!.sites.map((z) => z.id);
    assert.equal(siteIds.length, m.sites, `${m.id} 站点数应=${m.sites}，实际=${siteIds.length}`);
    assert.ok(plan!.zones.some((z) => z.id === "spawnA"), `${m.id} 缺进攻出生区`);
    assert.ok(plan!.zones.some((z) => z.id === "spawnB"), `${m.id} 缺防守出生区`);
    for (const z of plan!.zones) {
      assert.ok(Number.isFinite(z.x) && Number.isFinite(z.y) && z.w > 0 && z.h > 0, `${m.id} zone ${z.id} 尺寸非法`);
      assert.ok(z.x >= 0 && z.y >= 0 && z.x + z.w <= PLAN_W && z.y + z.h <= PLAN_H, `${m.id} zone ${z.id} 越界`);
    }
  }
});

test("站位：战术×职责×事件全组合确定性、界内、下包收拢到包点", () => {
  for (const m of MAPS) {
    for (const duty of DUTIES) {
      for (const tactic of TACTICS) {
        for (const isAtk of [true, false]) {
          for (const kills of [0, 1, 3]) {
            for (const plant of [false, true]) {
              const o = { duty, isAttacking: isAtk, roundN: 7, pid: "p1", plantRevealed: plant, side: "bottom" as const, tactic, killsRevealed: kills, slot: 1 };
              const a = positionFor(m.id, o);
              const b = positionFor(m.id, o);
              assert.deepEqual(a, b, `${m.id}/${tactic}/${duty} 站位不确定`);
              assert.ok(a.x >= 0 && a.x <= PLAN_W && a.y >= 0 && a.y <= PLAN_H, `${m.id}/${tactic}/${duty} 站位越界`);
              assert.ok(a.zoneId.length > 0);
            }
          }
        }
      }
    }
    // 下包后：所有棋子收缩到预期包点区（快攻战术强制下包点=快攻目标）
    const plan = planOf(m.id)!;
    const pz = plantZoneOf(m.id, 9, "atk:rush:A")!;
    for (const duty of DUTIES) {
      const pos = positionFor(m.id, { duty, isAttacking: true, roundN: 9, pid: "px", plantRevealed: true, side: "top", tactic: "atk:rush:A", killsRevealed: 2, slot: 0 });
      assert.ok(pos.x >= pz.x - 1 && pos.x <= pz.x + pz.w + 1 && pos.y >= pz.y - 1 && pos.y <= pz.y + pz.h + 1,
        `${m.id} 下包后未收缩到 ${pz.id}: ${JSON.stringify(pos)}`);
    }
    // 击杀压进：kills 增大时进攻棋子应向包点靠近（距包点中心单调不增的统计趋势）
    const far = positionFor(m.id, { duty: "duelist", isAttacking: true, roundN: 5, pid: "pz", plantRevealed: false, side: "bottom", tactic: "atk:default", killsRevealed: 0, slot: 0 });
    const near = positionFor(m.id, { duty: "duelist", isAttacking: true, roundN: 5, pid: "pz", plantRevealed: false, side: "bottom", tactic: "atk:default", killsRevealed: 3, slot: 0 });
    const d2 = (p: { x: number; y: number }) => Math.hypot(p.x - (pz.x + pz.w / 2), p.y - (pz.y + pz.h / 2));
    assert.ok(d2(near) <= d2(far) + 40, `${m.id} 击杀后未呈现压进趋势`);
  }
});

test("战术标签：全部战术串都有中文标签", () => {
  for (const t of ["atk:default", "atk:midSplit", "atk:ecoStack", "atk:rush:A", "atk:rush:B", "def:standard", "def:aggro", "def:stack:A", "def:stack:B", "def:stack:C"]) {
    assert.ok(tacticLabel(t) !== t, `${t} 缺中文标签`);
  }
});
