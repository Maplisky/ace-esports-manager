/**
 * 地图数据表 — 7 张虚构地图（GDD §14：原创战术示意图，不做真实地图复刻）
 * 几何标签 0-1 驱动 fit 推导（§4.3 v1.9）。
 */
import type { MapDef } from "../types.ts";

export const MAPS: readonly MapDef[] = [
  { id: "jingjie", name: "净界", sites: 2, openness: 0.7, vertical: 0.4, corridor: 0.6 },
  { id: "xiajing", name: "霞径", sites: 3, openness: 0.5, vertical: 0.3, corridor: 0.5 },
  { id: "panyan", name: "磐岩", sites: 2, openness: 0.35, vertical: 0.6, corridor: 0.35 },
  { id: "yugang", name: "雨港", sites: 2, openness: 0.55, vertical: 0.5, corridor: 0.55 },
  { id: "xueyuan", name: "雪原", sites: 2, openness: 0.8, vertical: 0.2, corridor: 0.7 },
  { id: "kongting", name: "空庭", sites: 3, openness: 0.45, vertical: 0.75, corridor: 0.45 },
  { id: "fenlu", name: "焚炉", sites: 2, openness: 0.6, vertical: 0.55, corridor: 0.5 },
];

export const MAP_BY_ID: ReadonlyMap<string, MapDef> = new Map(MAPS.map((m) => [m.id, m]));
