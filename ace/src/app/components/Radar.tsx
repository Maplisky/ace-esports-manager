/**
 * 八维雷达图（v1.3 可视化核心，GDD 转会决策工具）：
 * 纯 SVG 自绘零依赖；配色与 PlayerDossier 八维色阶条同源（attrColor 六档）。
 * 支持单人展示与两人叠层对比（B 为虚线描边 + 半透明填充）。
 */
import type { PlayerAttrs } from "../../core/types.ts";

/** 与 PlayerDossier.attrColor 同源（六档色阶）——雷达顶点与描边用同一套色 */
export function attrColor(v: number): string {
  if (v >= 90) return "#16a34a";
  if (v >= 80) return "#4ade80";
  if (v >= 70) return "#60a5fa";
  if (v >= 60) return "#fbbf24";
  if (v >= 50) return "#fb923c";
  return "#f87171";
}

const AXES: { key: keyof PlayerAttrs; label: string }[] = [
  { key: "aim", label: "枪法" },
  { key: "reaction", label: "反应" },
  { key: "awareness", label: "意识" },
  { key: "utility", label: "道具" },
  { key: "clutch", label: "残局" },
  { key: "teamwork", label: "协同" },
  { key: "communication", label: "沟通" },
  { key: "igl", label: "指挥" },
];

export function radarAxes() {
  return AXES;
}

/** 极坐标顶点（0° 在正上，顺时针） */
function vertex(cx: number, cy: number, r: number, i: number, n: number): [number, number] {
  const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n;
  return [cx + r * Math.cos(ang), cy + r * Math.sin(ang)];
}

export function AttrRadar(props: {
  a: PlayerAttrs;
  b?: PlayerAttrs;
  size?: number;
  nameA?: string;
  nameB?: string;
}) {
  const size = props.size ?? 220;
  const cx = size / 2;
  const cy = size / 2;
  const R = size / 2 - 26;
  const n = AXES.length;
  const val = (p: PlayerAttrs, k: keyof PlayerAttrs) => Math.max(30, Math.min(99, p[k])) / 99;
  const ring = (frac: number) =>
    AXES.map((_, i) => vertex(cx, cy, R * frac, i, n).join(",")).join(" ");
  const polyOf = (p: PlayerAttrs) =>
    AXES.map((ax, i) => vertex(cx, cy, R * val(p, ax.key), i, n).join(",")).join(" ");
  const avgA = AXES.reduce((s, ax) => s + props.a[ax.key], 0) / n;
  const strokeA = attrColor(avgA);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="八维雷达图">
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <polygon key={f} points={ring(f)} fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth={1} />
      ))}
      {AXES.map((_, i) => {
        const [x, y] = vertex(cx, cy, R, i, n);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="rgba(255,255,255,0.10)" strokeWidth={1} />;
      })}
      {props.b && (
        <polygon points={polyOf(props.b)} fill="rgba(96,165,250,0.18)" stroke="#60a5fa" strokeWidth={1.6} strokeDasharray="5 3" />
      )}
      <polygon points={polyOf(props.a)} fill={props.b ? "rgba(232,193,90,0.20)" : `${strokeA}33`} stroke={props.b ? "#e8c15a" : strokeA} strokeWidth={2} />
      {AXES.map((ax, i) => {
        const [x, y] = vertex(cx, cy, R + 14, i, n);
        const anchor = Math.abs(x - cx) < 6 ? "middle" : x > cx ? "start" : "end";
        return (
          <text key={ax.key} x={x} y={y + 3} fontSize={10.5} textAnchor={anchor} fill="rgba(255,255,255,0.75)">
            {ax.label}
          </text>
        );
      })}
      {(props.nameA || props.nameB) && (
        <>
          <circle cx={cx - R * 0.55} cy={cy + R * 0.78} r={4} fill={props.b ? "#e8c15a" : strokeA} />
          {props.nameA && <text x={cx - R * 0.55 + 8} y={cy + R * 0.78 + 3.5} fontSize={10} fill="rgba(255,255,255,0.8)">{props.nameA}</text>}
          {props.b && props.nameB && (
            <>
              <circle cx={cx + R * 0.18} cy={cy + R * 0.78} r={4} fill="#60a5fa" />
              <text x={cx + R * 0.18 + 8} y={cy + R * 0.78 + 3.5} fontSize={10} fill="rgba(255,255,255,0.8)">{props.nameB}</text>
            </>
          )}
        </>
      )}
    </svg>
  );
}
