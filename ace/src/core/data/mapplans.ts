/**
 * 地图平面数据 v2（v0.9-5 对局美术打磨二期，GDD §5.4）：
 * 真实俯视图（valorant-api displayicon，本地 assets/maps/*.png）+ 逐图手工校准区域
 * （mapplans.zones.ts，map-overrides.json 经 apply-overrides.mjs 合并）。坐标系 400×400，与底图逐像素对齐。
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
  /** 该棋子所在队伍的画布方位（teamB=top） */
  side: Side2;
  /** 引擎开局战术：如 "atk:rush:A" / "def:stack:B" / "atk:default"（旧档缺省 default/standard） */
  tactic: string;
  /** 同区第几个棋子（网格铺开错位） */
  slot: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function zoneCenter(z: PlanZone): { x: number; y: number } {
  return { x: z.x + z.w / 2, y: z.y + z.h / 2 };
}

/** 战术 → 进攻方各职责的布置区（参考 valoplant 预设：默认 2-1-2 分推 / 快攻 4-1 / 中路夹击 2-1-2 / eco 抱团） */
function atkSetupZone(plan: MapPlan, tactic: string, duty: AnchorDuty): PlanZone {
  const lane = (L: string) => plan.zones.find((z) => z.id === "lane" + L);
  const site = (L: string) => plan.zones.find((z) => z.id === "site" + L);
  const midZ = plan.mid;
  const fallback = plan.sites[0] ?? plan.spawnAtk;
  const kind = tactic.split(":")[1] ?? "default";
  const target = tactic.split(":")[2] ?? "";
  const rushSite = target ? (site(target) ?? fallback) : fallback;
  switch (kind) {
    case "rush": { // 快攻 4-1：4 人压目标通道口，1 人（哨卫）中路策应
      const mainLane = (target ? lane(target) : undefined) ?? lane("A") ?? plan.zones.find((z) => z.kind === "lane");
      if (duty === "sentinel") return midZ ?? mainLane ?? plan.spawnAtk;
      return mainLane ?? rushSite;
    }
    case "midSplit": // 中路夹击 2-1-2：控场+先锋控中，决斗+哨卫走 A 侧，机动位 B 侧
      if (duty === "controller" || duty === "initiator") return midZ ?? fallback;
      if (duty === "duelist" || duty === "sentinel") return lane("A") ?? rushSite;
      return lane("B") ?? fallback;
    case "ecoStack": // eco 抱团：全员缩在进攻出生压后（避免分散送头）
      return plan.spawnAtk;
    default: { // 默认分推 2-1-2：决斗+哨卫包点通道、先锋+机动位次通道、控场中路
      const mainLane = lane("A") ?? midZ ?? plan.spawnAtk;
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

/** 站位主函数：只算「回合开始布置位」（网格铺开防扎堆）。
 *  回合中的移动（击杀压进/下包收拢）由播放器按事件序列模拟——击杀事件不带走位信息，
 *  必须让击杀者移动到受害者位置，否则会出现 A 点击倒 B 点敌人的荒诞画面。 */
export function positionFor(mapId: string, opts: PosOpts): { x: number; y: number; zoneId: string } {
  const plan = PLANS[mapId];
  if (!plan) return { x: PLAN_W / 2, y: PLAN_H / 2, zoneId: 'mid' };
  const isAtk = opts.isAttacking;
  const setupZone = isAtk ? atkSetupZone(plan, opts.tactic, opts.duty) : defSetupZone(plan, opts.tactic, opts.duty);

  // 网格铺开：同区棋子按槽位 3 列 2 行铺开（单元 ≥22px，抖动 ±20% 单元）——任意两人间距 ≥13px
  const gx = opts.slot % 3;
  const gy = Math.floor(opts.slot / 3) % 2;
  const cellW = Math.max(22, setupZone.w * 0.42);
  const cellH = Math.max(22, setupZone.h * 0.42);
  const h = hashString(`${mapId}:${opts.pid}:${opts.roundN}:${setupZone.id}`);
  const jx = ((h % 100) / 100 - 0.5) * cellW * 0.4;
  const jy = (((h >>> 9) % 100) / 100 - 0.5) * cellH * 0.4;
  const c = zoneCenter(setupZone);
  return {
    x: clamp(c.x + (gx - 1) * cellW + jx, 10, PLAN_W - 10),
    y: clamp(c.y + (gy - 0.5) * cellH + jy, 10, PLAN_H - 10),
    zoneId: setupZone.id,
  };
}

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
