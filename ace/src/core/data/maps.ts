/**
 * 地图数据表 — 真实竞技图池（v0.7 真实数据包，名称对应 Valorant 现役地图）
 * 几何标签 0-1 驱动 fit 推导（§4.3 v1.9），按真实地图结构手工标定：
 * openness 开阔度（长枪友好）/ vertical 垂直高差 / corridor 走廊密度（近战绕点）。
 */
import type { MapDef } from "../types.ts";

export const MAPS: readonly MapDef[] = [
  { id: "ascent", name: "Ascent", sites: 2, openness: 0.65, vertical: 0.35, corridor: 0.55 },
  { id: "bind", name: "Bind", sites: 2, openness: 0.4, vertical: 0.35, corridor: 0.4 },
  { id: "breeze", name: "Breeze", sites: 2, openness: 0.85, vertical: 0.3, corridor: 0.7 },
  { id: "haven", name: "Haven", sites: 3, openness: 0.55, vertical: 0.3, corridor: 0.5 },
  { id: "icebox", name: "Icebox", sites: 2, openness: 0.45, vertical: 0.8, corridor: 0.45 },
  { id: "lotus", name: "Lotus", sites: 3, openness: 0.5, vertical: 0.55, corridor: 0.5 },
  { id: "split", name: "Split", sites: 2, openness: 0.4, vertical: 0.7, corridor: 0.45 },
  { id: "sunset", name: "Sunset", sites: 2, openness: 0.5, vertical: 0.35, corridor: 0.6 },
  { id: "abyss", name: "Abyss", sites: 2, openness: 0.75, vertical: 0.5, corridor: 0.55 },
  { id: "corrode", name: "Corrode", sites: 2, openness: 0.5, vertical: 0.5, corridor: 0.5 },
];

export const MAP_BY_ID: ReadonlyMap<string, MapDef> = new Map(MAPS.map((m) => [m.id, m]));
