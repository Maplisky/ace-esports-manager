// 把 map-overrides.json 合并进 mapplans.zones.ts（逐图手工标定工作流）
import { readFileSync, writeFileSync } from "node:fs";
const src = readFileSync("src/core/data/mapplans.zones.ts", "utf8");
const jsonStart = src.indexOf("= ") + 2;
const jsonEnd = src.lastIndexOf(";");
const zones = JSON.parse(src.slice(jsonStart, jsonEnd).trim());
const overrides = JSON.parse(readFileSync("map-overrides.json", "utf8"));
for (const [mapId, patches] of Object.entries(overrides)) {
  if (!zones[mapId]) continue;
  for (const [zid, zone] of Object.entries(patches)) {
    const i = zones[mapId].findIndex((z) => z.id === zid);
    if (i >= 0) zones[mapId][i] = { ...zones[mapId][i], ...zone };
    else zones[mapId].push({ ...zone });
  }
}
const ts = `/**
 * 地图区域手工标定（逐图目视校准，map-overrides.json 经 apply-overrides.mjs 合并）
 * 预览：node gen-map-preview.mjs [mapId] → /maps-preview.html
 */
export interface GenZone { id: string; kind: string; label?: string; x: number; y: number; w: number; h: number; }
export const GEN_ZONES: Record<string, GenZone[]> = ` + JSON.stringify(zones) + `;\n`;
writeFileSync("src/core/data/mapplans.zones.ts", ts);
console.log("merged:", Object.keys(overrides).join(", "));
