/**
 * 地图平面数据 v2（v0.9-5 对局美术打磨二期，GDD §5.4）：
 * 真实俯视图（valorant-api displayicon，本地 assets/maps/*.png）+ 官方 callouts 标定区域
 * （mapplans.gen.ts，node calibrate.mjs 生成）。坐标系 400×400，与底图逐像素对齐。
 * 站位锚点按 开局战术×职责×攻防×回合事件 推演：布置 → 交火压进 → 下包收拢。
 */
import { MAPS } from "./maps.ts";
import { hashString } from "../rng.ts";
import { GEN_ZONES } from "./mapplans.zones.ts";

export const PLAN_W = 400;
export const PLAN_H = 400;

export const MAP_ART: Record<string, string> = Object.fromEntries(MAPS.map((m) => [m.id, `assets/maps/${m.id}.png`]));

export interface PlanZone {
  id: string;
  kind: "site" | "mid" | "lane" | "spawnA" | "spawnB";
  label?: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MapPlan {
  zones: PlanZone[];
  sites: PlanZone[];
  spawnAtk: PlanZone;
  spawnDef: PlanZone;
  mid: PlanZone | null;
}

const PLANS: Record<string, MapPlan> = {};
for (const [mapId, gen] of Object.entries(GEN_ZONES)) {
  const zones = gen as PlanZone[];
  PLANS[mapId] = {
    zones,
    sites: zones.filter((z) => z.kind === "site"),
    spawnAtk: zones.find((z) => z.id === "spawnA") ?? zones[0]!,
    spawnDef: zones.find((z) => z.id === "spawnB") ?? zones[0]!,
    mid: zones.find((z) => z.kind === "mid") ?? null,
  };
}

export function planOf(mapId: string): MapPlan | null {
  return PLANS[mapId] ?? null;
}

/** 本回合的预期下包点（确定性）。快攻战术强制下包点=快攻目标，保证动画因果一致 */
export function plantZoneOf(mapId: string, roundN: number, tacticAtk?: string): PlanZone | null {
  const plan = PLANS[mapId];
  if (!plan) return null;
  const rush = tacticAtk?.match(/^atk:rush:([ABC])$/);
  if (rush) {
    const forced = plan.zones.find((z) => z.id === "site" + rush[1]);
    if (forced) return forced;
  }
  const h = hashString(`${mapId}:${roundN}:plant`);
  return plan.sites[h % plan.sites.length] ?? null;
}

export type AnchorDuty = "duelist" | "initiator" | "controller" | "sentinel" | "flex";
export type Side2 = "top" | "bottom";

export interface PosOpts {
  duty: AnchorDuty;
  isAttacking: boolean;
  roundN: number;
  pid: string;
  plantRevealed: boolean;
  /** 该棋子所在队伍的画布方位（teamB=top） */
  side: Side2;
  /** 引擎开局战术：如 "atk:rush:A" / "def:stack:B" / "atk:default" / "def:aggro"（旧档缺省 default/standard） */
  tactic: string;
  /** 本回合已揭示击杀数——驱动压进程度 */
  killsRevealed: number;
  /** 同区第几个棋子（错开重叠） */
  slot: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function zoneCenter(z: PlanZone): { x: number; y: number } {
  return { x: z.x + z.w / 2, y: z.y + z.h / 2 };
}

/** 战术 → 进攻方各职责的布置区（参考 valoplant 预设：默认 2-1-2 分推 / 快攻 4-1 / 中路夹击 2-1-2 / eco 抱团） */
function atkSetupZone(plan: MapPlan, tactic: string, duty: AnchorDuty, plant: PlanZone | null): PlanZone {
  const lane = (L: string) => plan.zones.find((z) => z.id === "lane" + L);
  const site = (L: string) => plan.zones.find((z) => z.id === "site" + L);
  const midZ = plan.mid;
  const fallback = plan.sites[0] ?? plan.spawnAtk;
  const other = plant ? plan.sites.find((s) => s.id !== plant.id) ?? plant : fallback;
  const kind = tactic.split(":")[1] ?? "default";
  const target = tactic.split(":")[2] ?? "";
  const rushSite = target ? (site(target) ?? plant ?? fallback) : (plant ?? fallback);
  switch (kind) {
    case "rush": { // 快攻 4-1：4 人压目标通道口，1 人（哨卫）中路策应
      const mainLane = (target ? lane(target) : undefined) ?? lane("A") ?? plan.zones.find((z) => z.kind === "lane");
      if (duty === "sentinel") return midZ ?? mainLane ?? plan.spawnAtk;
      return mainLane ?? rushSite;
    }
    case "midSplit": // 中路夹击 2-1-2：控场+先锋控中，决斗+哨卫走 A 侧，机动位 B 侧
      if (duty === "controller" || duty === "initiator") return midZ ?? other;
      if (duty === "duelist" || duty === "sentinel") return lane("A") ?? rushSite;
      return lane("B") ?? other;
    case "ecoStack": // eco 抱团：全员缩在进攻出生压后（避免分散送头）
      return plan.spawnAtk;
    default: { // 默认分推 2-1-2：决斗+哨卫包点通道、先锋+机动位次通道、控场中路
      const mainLane = lane(plant?.id.replace("site", "") ?? "A") ?? midZ ?? plant ?? plan.spawnAtk;
      const secondLane = plan.zones.find((z) => z.kind === "lane" && z.id !== mainLane.id) ?? midZ ?? plan.spawnAtk;
      if (duty === "duelist" || duty === "sentinel") return mainLane;
      if (duty === "initiator" || duty === "flex") return secondLane;
      return midZ ?? plan.spawnAtk;
    }
  }
}

/** 战术 → 防守方各职责的布置区（参考 valoplant 预设：常规 2-2-1 / 重心 3-1-1 / 前顶 1-2-2 顶通道口） */
function defSetupZone(plan: MapPlan, tactic: string, duty: AnchorDuty): PlanZone {
  const kind = tactic.split(":")[1] ?? "standard";
  const target = tactic.split(":")[2] ?? "";
  const site = (L: string) => plan.zones.find((z) => z.id === "site" + L);
  const [s1, s2, s3] = [site("A"), site("B"), site("C")];
  const midZ = plan.mid;
  const lane = (L: string) => plan.zones.find((z) => z.id === "lane" + L);
  switch (kind) {
    case "stack": { // 重心 3-1-1：3 人囤目标点，先锋看另一侧，机动位中路
      const t = site(target) ?? s1!;
      const others = [s1, s2, s3].filter((s) => s && s.id !== t.id);
      if (duty === "sentinel" || duty === "controller" || duty === "duelist") return t;
      if (duty === "initiator") return others[0] ?? midZ ?? t;
      return midZ ?? others[1] ?? t;
    }
    case "aggro": // 前顶压制：1 人守点，其余顶到通道口（哨卫留守最稳）
      if (duty === "sentinel") return s1!;
      if (duty === "controller") return midZ ?? lane("B") ?? s2!;
      if (duty === "initiator") return lane("B") ?? s2!;
      return lane("C") ?? lane("A") ?? midZ ?? s2!;
    default: { // 常规布防：两点图 2-2-1（A 哨卫+B 控场决斗+中先锋机动），三点图 1-1-1-2
      if (plan.sites.length >= 3) {
        if (duty === "sentinel") return s1!;
        if (duty === "controller") return s2!;
        if (duty === "initiator") return s3!;
        if (duty === "duelist") return midZ ?? s2!;
        return s2 ?? midZ!;
      }
      if (duty === "sentinel") return s1!;
      if (duty === "controller" || duty === "duelist") return s2 ?? s1!;
      return midZ ?? s2!;
    }
  }
}

/** 站位主函数：布置位 →（击杀压进）→（下包收拢），全部确定性 */
export function positionFor(mapId: string, opts: PosOpts): { x: number; y: number; zoneId: string } {
  const plan = PLANS[mapId];
  if (!plan) return { x: PLAN_W / 2, y: PLAN_H / 2, zoneId: "mid" };
  const plant = plantZoneOf(mapId, opts.roundN, opts.tactic);
  const isAtk = opts.isAttacking;
  const setupZone = isAtk ? atkSetupZone(plan, opts.tactic, opts.duty, plant) : defSetupZone(plan, opts.tactic, opts.duty);

  // 目标区：下包后全员涌向包点；未下包时仅进攻方随击杀压向包点，防守方轻微收缩
  const targetZone = opts.plantRevealed
    ? plant ?? setupZone
    : isAtk && opts.killsRevealed > 0
      ? plant ?? setupZone
      : setupZone;
  const blend = opts.plantRevealed
    ? 1
    : isAtk ? Math.min(0.45, opts.killsRevealed * 0.16)
      : Math.min(0.3, opts.killsRevealed * 0.1);

  const jitterOf = (z: PlanZone, salt: string) => {
    const c = zoneCenter(z);
    const h = hashString(`${mapId}:${opts.pid}:${opts.roundN}:${z.id}:${salt}`);
    const jx = ((h % 100) / 100 - 0.5) * Math.max(10, z.w * 0.55);
    const jy = (((h >>> 9) % 100) / 100 - 0.5) * Math.max(10, z.h * 0.55);
    return { jx, jy };
  };
  const slotShift = (slot: number) => ({ dx: ((slot % 3) - 1) * 15, dy: (Math.floor(slot / 3) - 0.5) * 15 });

  const sj = jitterOf(setupZone, "s");
  const sc = zoneCenter(setupZone);
  const sx = clamp(sc.x + sj.jx + slotShift(opts.slot).dx, 8, PLAN_W - 8);
  const sy = clamp(sc.y + sj.jy + slotShift(opts.slot).dy, 8, PLAN_H - 8);

  let fx: number;
  let fy: number;
  if (blend <= 0) {
    fx = sx;
    fy = sy;
  } else {
    const tj = jitterOf(targetZone, "t");
    const tc = zoneCenter(targetZone);
    const tx = clamp(tc.x + tj.jx + slotShift(opts.slot).dx, 8, PLAN_W - 8);
    const ty = clamp(tc.y + tj.jy + slotShift(opts.slot).dy, 8, PLAN_H - 8);
    fx = lerp(sx, tx, blend);
    fy = lerp(sy, ty, blend);
  }
  return { x: clamp(fx, 10, PLAN_W - 10), y: clamp(fy, 10, PLAN_H - 10), zoneId: setupZone.id };
}

/** 开局战术中文标签（RoundRecord.tacticAtk/tacticDef → 展示） */
export const TACTIC_LABEL: Record<string, string> = {
  "atk:default": "默认分推",
  "atk:midSplit": "中路夹击",
  "atk:ecoStack": "抢攻抱团",
  "def:standard": "常规布防",
  "def:aggro": "前顶压制",
  "def:stack:A": "重心 A",
  "def:stack:B": "重心 B",
  "def:stack:C": "重心 C",
};
export function tacticLabel(tactic: string): string {
  return TACTIC_LABEL[tactic] ?? tactic.split(":")[1] ?? tactic;
}
