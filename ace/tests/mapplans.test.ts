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

test("布置位：全组合确定性、界内；同区多人网格铺开不扎堆", () => {
  for (const m of MAPS) {
    for (const tactic of TACTICS) {
      for (const isAtk of [true, false]) {
        const pos: { duty: string; x: number; y: number; zoneId: string }[] = [];
        DUTIES.forEach((duty, slot) => {
          const o = { duty, isAttacking: isAtk, roundN: 7, pid: duty, side: "bottom" as const, tactic, slot };
          const a = positionFor(m.id, o);
          const b = positionFor(m.id, o);
          assert.deepEqual(a, b, `${m.id}/${tactic}/${duty} 站位不确定`);
          assert.ok(a.x >= 0 && a.x <= PLAN_W && a.y >= 0 && a.y <= PLAN_H, `${m.id}/${tactic}/${duty} 站位越界`);
          pos.push({ duty, x: a.x, y: a.y, zoneId: a.zoneId });
        });
        // 防扎堆：同区任意两人间距 ≥ 13px（网格铺开的下限）。
        // 跨区贴近是地图真实相邻（如 A 主道挨着中路），由播放器碰撞松弛处理
        for (let i = 0; i < pos.length; i++) {
          for (let j = i + 1; j < pos.length; j++) {
            if (pos[i]!.zoneId !== pos[j]!.zoneId) continue;
            const d = Math.hypot(pos[i]!.x - pos[j]!.x, pos[i]!.y - pos[j]!.y);
            assert.ok(d >= 13, `${m.id}/${tactic} ${pos[i]!.duty}-${pos[j]!.duty} 同区间距仅 ${Math.round(d)}px，扎堆`);
          }
        }
      }
    }
  }
});

test("快攻强制下包点语义：rush:X → plantZone 必为 siteX", () => {
  for (const m of MAPS) {
    for (const L of ["A", "B", "C"] as const) {
      if (L === "C" && m.sites < 3) continue;
      const pz = plantZoneOf(m.id, 9, `atk:rush:${L}`);
      assert.equal(pz?.id, "site" + L, `${m.id} rush:${L} 未强制下包点`);
    }
    // 无战术时确定性
    assert.equal(plantZoneOf(m.id, 9)?.id, plantZoneOf(m.id, 9)?.id);
  }
});

test("战术标签：全部战术串都有中文标签", () => {
  for (const t of ["atk:default", "atk:midSplit", "atk:ecoStack", "atk:rush:A", "atk:rush:B", "def:standard", "def:aggro", "def:stack:A", "def:stack:B", "def:stack:C"]) {
    assert.ok(tacticLabel(t) !== t, `${t} 缺中文标签`);
  }
});
