/**
 * 地图平面示意图（v0.9-5 对局美术打磨，GDD §5.4）：
 * 每张真实地图一张专属俯视布局（非 1:1 复刻——区域拓扑按真实地图手工标定），
 * 驱动 2D 战术视图的背景绘制与棋子站位锚点。坐标系固定 400×300 横向。
 */
import { MAP_BY_ID } from "./maps.ts";
import { hashString } from "../rng.ts";

export const PLAN_W = 400;
export const PLAN_H = 300;

export type ZoneKind = "site" | "mid" | "lane" | "spawnA" | "spawnB" | "feature";

export interface PlanZone {
  /** 锚点引用 id：siteA / siteB / siteC / mid / laneA / laneB / spawnA / spawnB */
  id: string;
  kind: ZoneKind;
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
}

export interface MapPlan {
  zones: PlanZone[];
  /** 结构性装饰：细墙/箱体（x, y, w, h） */
  walls?: [number, number, number, number][];
  /** 特殊连接（如 Bind 传送器）：两锚点 zoneId 虚线相连 */
  links?: [string, string, string][]; // [fromId, toId, 标注]
}

/** 所有地图共用：出生带（teamA=下 / teamB=上），站点区按各图排布 */
function spawns(): PlanZone[] {
  return [
    { id: "spawnA", kind: "spawnA", x: 128, y: 264, w: 144, h: 28, label: "A 队出生" },
    { id: "spawnB", kind: "spawnB", x: 128, y: 8, w: 144, h: 28, label: "B 队出生" },
  ];
}

function site(id: string, x: number, y: number, w: number, h: number): PlanZone {
  return { id, kind: "site", x, y, w, h, label: id === "siteC" ? "C 点" : id === "siteA" ? "A 点" : "B 点" };
}
function mid(x: number, y: number, w: number, h: number, label = "中路"): PlanZone {
  return { id: "mid", kind: "mid", x, y, w, h, label };
}
function lane(id: string, x: number, y: number, w: number, h: number): PlanZone {
  return { id, kind: "lane", x, y, w, h };
}

export const MAP_PLANS: Record<string, MapPlan> = {
  // 双点 · 中庭大图：A 右 / B 左 / 中庭纵贯
  ascent: {
    zones: [
      ...spawns(),
      site("siteA", 268, 72, 104, 68),
      site("siteB", 28, 72, 104, 68),
      mid(162, 56, 76, 148),
      lane("laneA", 236, 150, 36, 106),
      lane("laneB", 128, 150, 36, 106),
    ],
    walls: [[190, 20, 20, 36], [190, 244, 20, 20], [280, 96, 30, 18], [90, 96, 30, 18]],
  },
  // 双点 · 无中路：A 右 / B 左，传送器相连（标志性）
  bind: {
    zones: [
      ...spawns(),
      site("siteA", 252, 62, 116, 74),
      site("siteB", 32, 62, 116, 74),
      lane("laneA", 244, 150, 40, 106),
      lane("laneB", 116, 150, 40, 106),
      { id: "mid", kind: "feature", x: 178, y: 118, w: 44, h: 64, label: "无中路" },
    ],
    walls: [[190, 40, 20, 60], [190, 200, 20, 56]],
    links: [["siteA", "siteB", "传送器"]],
  },
  // 双点 · 海岛开阔图：A 右 / B 左 / 中路峡谷
  breeze: {
    zones: [
      ...spawns(),
      site("siteA", 254, 64, 122, 96),
      site("siteB", 24, 64, 122, 96),
      mid(168, 56, 64, 152, "中路·洞窟"),
      lane("laneA", 240, 168, 40, 88),
      lane("laneB", 120, 168, 40, 88),
    ],
    walls: [[192, 24, 16, 32], [192, 244, 16, 20]],
  },
  // 三点 · 天堂：A 右 / B 中 / C 左
  haven: {
    zones: [
      ...spawns(),
      site("siteA", 262, 52, 110, 62),
      site("siteB", 148, 44, 104, 56),
      site("siteC", 28, 52, 110, 62),
      mid(156, 128, 88, 84, "车库·中路"),
      lane("laneA", 282, 122, 36, 134),
      lane("laneB", 168, 220, 64, 36),
      lane("laneC", 82, 122, 36, 134),
    ],
    walls: [[60, 130, 14, 40], [326, 130, 14, 40]],
  },
  // 双点 · 极地寒棚：A 左上 / B 右 / 中路管道
  icebox: {
    zones: [
      ...spawns(),
      site("siteA", 40, 44, 106, 72),
      site("siteB", 254, 44, 116, 72),
      mid(164, 60, 72, 128, "中路·管道"),
      lane("laneA", 64, 124, 36, 132),
      lane("laneB", 300, 124, 36, 132),
    ],
    walls: [[120, 70, 28, 20], [252, 70, 28, 20], [186, 196, 28, 24]],
  },
  // 三点 · 莲华：A 右上 / C 左上 / B 下中，中央庭院
  lotus: {
    zones: [
      ...spawns(),
      site("siteA", 266, 58, 108, 66),
      site("siteC", 26, 58, 108, 66),
      mid(158, 52, 84, 84, "中央庭院"),
      site("siteB", 146, 168, 108, 56),
      lane("laneA", 286, 132, 36, 88),
      lane("laneC", 78, 132, 36, 88),
      lane("laneB", 150, 232, 100, 24),
    ],
    walls: [[190, 144, 20, 20]],
  },
  // 双点 · 玄冥塔楼：A 右 / B 左 / 中路纵贯（绳索）
  split: {
    zones: [
      ...spawns(),
      site("siteA", 264, 52, 110, 72),
      site("siteB", 26, 52, 110, 72),
      mid(168, 44, 64, 148, "中路·绳索"),
      lane("laneA", 282, 132, 36, 124),
      lane("laneB", 82, 132, 36, 124),
      lane("sewer", 168, 200, 64, 56),
    ],
    walls: [[190, 252, 20, 12]],
  },
  // 双点 · 日落之城：A 左 / B 右 / 中路市集
  sunset: {
    zones: [
      ...spawns(),
      site("siteA", 30, 60, 112, 72),
      site("siteB", 258, 60, 112, 72),
      mid(162, 76, 76, 96, "市集·中路"),
      lane("laneA", 68, 140, 36, 116),
      lane("laneB", 296, 140, 36, 116),
      lane("midLane", 168, 180, 64, 76),
    ],
    walls: [[40, 96, 24, 16], [336, 96, 24, 16]],
  },
  // 双点 · 深渊：开阔平台，桥位关键
  abyss: {
    zones: [
      ...spawns(),
      site("siteA", 252, 58, 120, 88),
      site("siteB", 28, 58, 120, 88),
      mid(170, 50, 60, 148, "中路·悬桥"),
      lane("laneA", 262, 154, 36, 102),
      lane("laneB", 102, 154, 36, 102),
    ],
    walls: [[188, 208, 24, 16]],
  },
  // 双点 · 腐蚀：A 左上 / B 右 / 中路走廊
  corrode: {
    zones: [
      ...spawns(),
      site("siteA", 38, 52, 112, 72),
      site("siteB", 250, 52, 112, 72),
      mid(166, 68, 68, 118, "中路走廊"),
      lane("laneA", 68, 132, 36, 124),
      lane("laneB", 296, 132, 36, 124),
    ],
    walls: [[60, 88, 24, 14], [316, 88, 24, 14]],
  },
};

export function planOf(mapId: string): MapPlan | null {
  return MAP_PLANS[mapId] ?? null;
}

/** 本回合的预期下包点（确定性：按图+回合哈希在站点中选一） */
export function plantZoneOf(mapId: string, roundN: number): string {
  const plan = MAP_PLANS[mapId];
  const sites = plan ? plan.zones.filter((z) => z.kind === "site").map((z) => z.id) : ["siteA"];
  const h = hashString(`${mapId}:${roundN}:plant`);
  return sites[h % sites.length]!;
}

/** 站位职责（由所操作英雄的主职责驱动） */
export type AnchorDuty = "duelist" | "initiator" | "controller" | "sentinel" | "flex";

/** 按攻防/职责/事件推站位：返回棋子中心坐标（图内确定性散布）。slot 为同区第几个棋子，用于错开重叠 */
export function positionFor(
  mapId: string,
  opts: {
    duty: AnchorDuty;
    isAttacking: boolean;
    roundN: number;
    pid: string;
    plantRevealed: boolean;
    side: "top" | "bottom"; // 该棋子所在队伍的画布方位（teamB=top）
    slot?: number;
  },
): { x: number; y: number; zoneId: string } {
  const plan = MAP_PLANS[mapId];
  if (!plan) return { x: PLAN_W / 2, y: PLAN_H / 2, zoneId: "mid" };
  const zones = (id: string) => plan.zones.find((z) => z.id === id);
  const sites = plan.zones.filter((z) => z.kind === "site");
  const lanes = plan.zones.filter((z) => z.kind === "lane");
  const plant = plantZoneOf(mapId, opts.roundN);

  let zoneId: string;
  if (opts.isAttacking) {
    if (opts.plantRevealed) {
      // 下包后：进攻方全员涌向包点
      zoneId = plant;
    } else {
      // 推开：决斗走包点对应通道先行，先锋次通道佯攻，控场控中路，哨卫出生压后
      const plantLane = lanes.find((l) => l.id === "lane" + plant.replace("site", "")) ?? lanes[0];
      const secondLane = lanes.find((l) => l.id !== (plantLane?.id ?? "")) ?? plantLane;
      switch (opts.duty) {
        case "duelist": zoneId = plantLane?.id ?? plant; break;
        case "initiator": zoneId = secondLane?.id ?? "mid"; break;
        case "controller": zoneId = plan.zones.some((z) => z.kind === "mid") ? "mid" : secondLane?.id ?? "spawnA"; break;
        default: zoneId = opts.side === "bottom" ? "spawnA" : "spawnB";
      }
    }
  } else {
    if (opts.plantRevealed) {
      // 包点被下：防守方回防收缩
      zoneId = plant;
    } else {
      // 防守布防：哨卫守主点，控场守次点，先锋守第三点（三点图），决斗游走中路
      const ordered = [sites[0]?.id, sites[1]?.id, sites[2]?.id];
      switch (opts.duty) {
        case "sentinel": zoneId = ordered[0] ?? "mid"; break;
        case "controller": zoneId = ordered[1] ?? ordered[0] ?? "mid"; break;
        case "initiator": zoneId = ordered[2] ?? (plan.zones.some((z) => z.kind === "mid") ? "mid" : ordered[1] ?? "mid"); break;
        default: zoneId = plan.zones.some((z) => z.kind === "mid") ? "mid" : ordered[1] ?? "mid";
      }
    }
  }
  const zone = zones(zoneId) ?? plan.zones.find((z) => z.kind === "site") ?? plan.zones[0]!;
  // 区内确定性散布（每人每回合稳定），留 12px 内边距避让边框
  const h = hashString(`${mapId}:${opts.pid}:${opts.roundN}:${zoneId}`);
  const px = 12;
  const jx = zone.w > px * 2 ? h % (zone.w - px * 2) : zone.w / 2;
  const jy = zone.h > px * 2 ? (h >>> 8) % (zone.h - px * 2) : zone.h / 2;
  const slot = opts.slot ?? 0;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const x = clamp(zone.x + px + jx + ((slot % 3) - 1) * 15, zone.x + 10, zone.x + zone.w - 10);
  const y = clamp(zone.y + px + jy + (Math.floor(slot / 3) - 0.5) * 15, zone.y + 10, zone.y + zone.h - 10);
  return { x, y, zoneId };
}
