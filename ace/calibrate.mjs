// 地图标定脚本（一次性工具）：官方 callouts 世界坐标 → 400×400 战术空间 zones
// 方法：底图 = 雷达投影的等比旋转。两点（A/B 包点）相似变换存在「正/反手性」两解，
//       三点图用 C 点残差、两点图用中路落点合理性择优；区域位置全部经官方 callouts 换算。
// 运行：node calibrate.mjs → 生成 src/core/data/mapplans.gen.ts
import { readFileSync, writeFileSync } from "node:fs";

const callouts = JSON.parse(readFileSync("map-callouts.json", "utf8"));
const PLAN = 400, K = PLAN / 1024;

// 包点橄榄块中心（1024 像素空间，目视读取）
const SITE_PX = {
  ascent: { A: [324, 150], B: [278, 808] },
  bind: { A: [300, 300], B: [742, 335] },
  breeze: { A: [142, 297], B: [910, 472] },
  haven: { A: [390, 142], B: [402, 507], C: [375, 862] },
  icebox: { A: [630, 225], B: [747, 830] },
  lotus: { A: [902, 327], B: [112, 472], C: [472, 427] },
  split: { A: [345, 105], B: [335, 845] },
  sunset: { A: [127, 437], B: [842, 385] },
  abyss: { A: [435, 102], B: [405, 930] },
  corrode: { A: [405, 197], B: [410, 780] },
};

function siteCentroid(cos, L) {
  const cs = cos.filter((c) => c[0] === "Site" && c[1] === L);
  return [cs.reduce((s, c) => s + c[2], 0) / cs.length, cs.reduce((s, c) => s + c[3], 0) / cs.length];
}

function avg(cs) {
  return [cs.reduce((s, c) => s + c[2], 0) / cs.length, cs.reduce((s, c) => s + c[3], 0) / cs.length];
}

const out = {};
for (const [mapId, spx] of Object.entries(SITE_PX)) {
  const cos = callouts[mapId];
  const wA = siteCentroid(cos, "A"), wB = siteCentroid(cos, "B");
  const pA = spx.A, pB = spx.B;

  // 手性候选 1（直接相似）：p = α(w − wB) + pB；候选 2（反相似）：p = ᾱ(conj(w − wB)) + pB
  const cdiv = (a, b) => [
    (a[0] * b[0] + a[1] * b[1]) / (b[0] * b[0] + b[1] * b[1]),
    (a[1] * b[0] - a[0] * b[1]) / (b[0] * b[0] + b[1] * b[1]),
  ];
  const dP = [pA[0] - pB[0], pA[1] - pB[1]];
  const dW = [wA[0] - wB[0], wA[1] - wB[1]];
  const a1 = cdiv(dP, dW);
  const a2 = cdiv(dP, [dW[0], -dW[1]]);
  const mkToPx = (a, reflect) => (wx, wz) => reflect
    ? [a[0] * wx + a[1] * wz + pB[0], a[1] * wx - a[0] * wz + pB[1]]
    : [a[0] * (wx - wB[0]) - a[1] * (wz - wB[1]) + pB[0], a[0] * (wz - wB[1]) + a[1] * (wx - wB[0]) + pB[1]];
  const score = (toP) => {
    if (spx.C) {
      const wC = siteCentroid(cos, "C");
      const [fx, fy] = toP(wC[0], wC[1]);
      return Math.hypot(fx - spx.C[0], fy - spx.C[1]);
    }
    const mid = cos.filter((c) => c[1] === "Mid");
    if (!mid.length) return 0;
    const cx = mid.reduce((s, c) => s + toP(c[2], c[3])[0], 0) / mid.length;
    const cy = mid.reduce((s, c) => s + toP(c[2], c[3])[1], 0) / mid.length;
    return Math.hypot(cx - (pA[0] + pB[0]) / 2, cy - (pA[1] + pB[1]) / 2);
  };
  const t1 = mkToPx(a1, false);
  const t2 = mkToPx(a2, true);
  let toPx = score(t1) <= score(t2) ? t1 : t2;
  let cResid = spx.C ? Math.round(score(toPx)) : null;
  // 三点图且 C 残差过大 → 该图投影非严格相似，用全部站点做逐轴仿射重拟合
  if (spx.C && cResid !== null && cResid > 120) {
    const fitAxis = (pairs) => {
      const n = pairs.length;
      const sx = pairs.reduce((s, p) => s + p[0], 0), sy = pairs.reduce((s, p) => s + p[1], 0);
      const sxx = pairs.reduce((s, p) => s + p[0] * p[0], 0), sxy = pairs.reduce((s, p) => s + p[0] * p[1], 0);
      const a = (n * sxy - sx * sy) / (n * sxx - sx * sx);
      return [a, (sy - a * sx) / n];
    };
    const sitePairs = Object.entries(spx).map(([L, p]) => {
      const w = siteCentroid(cos, L);
      return [[w[0], p[0]], [w[1], p[1]]];
    });
    const [ax, bx] = fitAxis(sitePairs.map((p) => p[0]));
    const [az, bz] = fitAxis(sitePairs.map((p) => p[1]));
    toPx = (wx, wz) => [ax * wx + bx, az * wz + bz];
    cResid = Math.round(score(toPx));
  }

  const zoneOf = (wx, wz, zw, zh) => {
    const [px, py] = toPx(wx, wz);
    return { x: Math.round(px * K - zw / 2), y: Math.round(py * K - zh / 2), w: zw, h: zh };
  };
  // 旋转图上轴对齐 bbox 会巨大化 → 区域用「质心+半径」方块
  const spreadZone = (cs) => {
    const pts = cs.map((c) => toPx(c[2], c[3]));
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    const rad = Math.max(...pts.map((p) => Math.hypot(p[0] - cx, p[1] - cy)));
    const side = Math.min(150, Math.max(40, rad * 2.3));
    return { x: Math.round(cx * K - side / 2), y: Math.round(cy * K - side / 2), w: Math.round(side), h: Math.round(side) };
  };

  const zones = [];
  const S = 60, SW = 84, SH = 72;
  zones.push({ id: "siteA", kind: "site", label: "A", ...zoneOf(...avg(cos.filter((c) => c[0] === "Site" && c[1] === "A")), S, S) });
  zones.push({ id: "siteB", kind: "site", label: "B", ...zoneOf(...avg(cos.filter((c) => c[0] === "Site" && c[1] === "B")), S, S) });
  const cSites = cos.filter((c) => c[0] === "Site" && c[1] === "C");
  if (cSites.length) zones.push({ id: "siteC", kind: "site", label: "C", ...zoneOf(...avg(cSites), S, S) });
  const atk = cos.find((c) => c[1] === "Attacker Side");
  const def = cos.find((c) => c[1] === "Defender Side");
  zones.push({ id: "spawnA", kind: "spawnA", label: "进攻", ...zoneOf(atk[2], atk[3], SW, SH) });
  zones.push({ id: "spawnB", kind: "spawnB", label: "防守", ...zoneOf(def[2], def[3], SW, SH) });
  const mid = cos.filter((c) => c[1] === "Mid");
  if (mid.length) zones.push({ id: "mid", kind: "mid", label: "中路", ...spreadZone(mid) });
  for (const L of ["A", "B", "C"]) {
    const lane = cos.filter((c) => c[1] === L && /Main|Lobby|Short|Long|Exit/.test(c[0]));
    if (lane.length >= 1) zones.push({ id: "lane" + L, kind: "lane", ...spreadZone(lane) });
  }
  for (const z of zones) {
    z.x = Math.max(2, Math.min(PLAN - z.w - 2, z.x));
    z.y = Math.max(2, Math.min(PLAN - z.h - 2, z.y));
  }
  out[mapId] = { zones, cResid };
}

let ts = `/**
 * 地图标定数据（自动生成，勿手改）——node calibrate.mjs
 * 来源：valorant-api 官方 callouts 世界坐标，经包点锚点相似变换（含手性判别）换算到 400×400 战术空间。
 */
export interface GenZone { id: string; kind: string; label?: string; x: number; y: number; w: number; h: number; }
export const GEN_ZONES: Record<string, GenZone[]> = ` + JSON.stringify(
  Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.zones])),
) + `;\n`;
writeFileSync("src/core/data/mapplans.gen.ts", ts);

const previewColors = { site: "#e8c15a", spawnA: "#4ade80", spawnB: "#60a5fa", mid: "#8b7cf6", lane: "#6b7280" };
let html = '<html><body style="background:#111;color:#eee;font-family:monospace"><div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;padding:8px">';
for (const [id, v] of Object.entries(out)) {
  html += '<div><div style="text-align:center">' + id + (v.cResid !== null ? " (C残差" + v.cResid + ")" : "") + '</div><svg viewBox="0 0 400 400" style="width:100%;background:#000">';
  html += '<image href="assets/maps/' + id + '.png" x="0" y="0" width="400" height="400" opacity="0.9"/>';
  for (const z of v.zones) {
    const c = previewColors[z.kind] ?? "#888";
    html += '<rect x="' + z.x + '" y="' + z.y + '" width="' + z.w + '" height="' + z.h + '" fill="none" stroke="' + c + '" stroke-width="1.5" opacity="0.9" rx="4"/>';
    if (z.label) html += '<text x="' + (z.x + 4) + '" y="' + (z.y + 12) + '" fill="' + c + '" font-size="11">' + z.label + '</text>';
  }
  html += "</svg></div>";
}
html += "</div></body></html>";
writeFileSync("public/maps-preview.html", html);
writeFileSync("dist/maps-preview.html", html);
console.log("生成完成。C 点校验残差(px，- = 两点图)：");
for (const [k, v] of Object.entries(out)) console.log(" ", k.padEnd(8), v.cResid ?? "-");
