/**
 * 2D 战术视图 v3（v0.9-5 对局美术打磨，GDD §5.4）：
 * 每张真实地图渲染专属平面示意图（区域拓扑 mapplans.ts），
 * 棋子按 英雄职责×攻防×回合事件 站位（下包后双方涌向包点），随揭示灰化阵亡者。
 */
import { MAP_BY_ID } from "../../core/data/maps.ts";
import { AGENT_BY_ID, primaryDuty } from "../../core/data/agents.ts";
import {
  PLAN_W, PLAN_H, PLAN_W as W, PLAN_H as H, planOf, positionFor, plantZoneOf,
} from "../../core/data/mapplans.ts";
import type { AnchorDuty } from "../../core/data/mapplans.ts";
import type { GameState, MapRecord, RoundEvent } from "../../core/types.ts";

void W; void H;

export function Tactical2D(props: {
  state: GameState;
  mapRec: MapRecord;
  roundEvents: RoundEvent[];
  revealedCount: number;
  teamAId: string;
  teamBId: string;
  atkSide: "A" | "B";
}) {
  const { state, mapRec, roundEvents, revealedCount, teamAId, teamBId, atkSide } = props;
  const plan = planOf(mapRec.map);
  const mapDef = MAP_BY_ID.get(mapRec.map);
  const roundN = mapRec.rounds[0]?.n ?? 1;

  const revealed = roundEvents.slice(0, Math.max(0, revealedCount));
  const dead = new Set<string>();
  const killLinks: { k: string; v: string; first: boolean }[] = [];
  let plantRevealed = false;
  for (const e of revealed) {
    if (e.t === "kill" && e.s && e.v) {
      dead.add(e.v);
      killLinks.push({ k: e.s, v: e.v, first: !!e.first });
    }
    if (e.t === "plant") plantRevealed = true;
  }
  const plantZone = plantZoneOf(mapRec.map, roundN);
  const plantPos = plan?.zones.find((z) => z.id === plantZone);

  // teamB=画布上方 / teamA=下方；攻防身份由 atkSide 决定
  const sides: { side: "A" | "B"; teamId: string; canvas: "top" | "bottom" }[] = [
    { side: "B", teamId: teamBId, canvas: "top" },
    { side: "A", teamId: teamAId, canvas: "bottom" },
  ];
  const colorOf = (side: "A" | "B") => (side === "A" ? "#4ade80" : "#60a5fa");
  const atkTag = atkSide === "A" ? (state.teams[teamAId]?.tag ?? "A") : (state.teams[teamBId]?.tag ?? "B");

  // 统一位姿：先按 zoneId 分组，再给同区棋子发槽位错开（确定性）
  const dutyOf = (pid: string): AnchorDuty => {
    const a = AGENT_BY_ID.get(mapRec.agents?.[pid] ?? "");
    return (a ? primaryDuty(a.duty) : "flex") as AnchorDuty;
  };
  const pieceList = sides.flatMap(({ side, teamId, canvas }) =>
    (state.teams[teamId]?.starters ?? [])
      .map((pid) => ({ pid, side, canvas }))
      .filter((x) => state.players[x.pid]),
  );
  const zoneOf = new Map<string, string>();
  for (const pc of pieceList) {
    zoneOf.set(pc.pid, positionFor(mapRec.map, {
      duty: dutyOf(pc.pid), isAttacking: atkSide === pc.side, roundN, pid: pc.pid, plantRevealed, side: pc.canvas,
    }).zoneId);
  }
  const slotCount = new Map<string, number>();
  const posOf = new Map<string, { x: number; y: number }>();
  for (const pc of pieceList) {
    const zid = zoneOf.get(pc.pid)!;
    const slot = slotCount.get(zid) ?? 0;
    slotCount.set(zid, slot + 1);
    posOf.set(pc.pid, positionFor(mapRec.map, {
      duty: dutyOf(pc.pid), isAttacking: atkSide === pc.side, roundN, pid: pc.pid, plantRevealed, side: pc.canvas, slot,
    }));
  }

  return (
    <svg
      viewBox={`0 0 ${PLAN_W} ${PLAN_H}`}
      style={{ width: "100%", maxWidth: 420, background: "#10141d", borderRadius: 10, border: "1px solid var(--line)" }}
    >
      {/* ── 地图平面：区域 ── */}
      {plan?.zones.map((z) => {
        if (z.kind === "site") {
          const isPlant = plantRevealed && z.id === plantZone;
          return (
            <g key={z.id}>
              <rect
                x={z.x} y={z.y} width={z.w} height={z.h} rx={7}
                fill={isPlant ? "rgba(251,146,60,0.16)" : "rgba(148,163,184,0.07)"}
                stroke={isPlant ? "rgba(251,146,60,0.75)" : "rgba(148,163,184,0.4)"}
                strokeWidth={isPlant ? 1.6 : 1}
              />
              <text x={z.x + 6} y={z.y + 15} fill={isPlant ? "rgba(251,146,60,0.9)" : "rgba(148,163,184,0.6)"} fontSize={12} fontWeight={700}>{z.label}</text>
            </g>
          );
        }
        if (z.kind === "mid") {
          return (
            <g key={z.id}>
              <rect x={z.x} y={z.y} width={z.w} height={z.h} rx={7} fill="rgba(96,165,250,0.05)" stroke="rgba(96,165,250,0.25)" strokeDasharray="5 4" />
              <text x={z.x + z.w / 2} y={z.y + 13} fill="rgba(96,165,250,0.5)" fontSize={9} textAnchor="middle">{z.label}</text>
            </g>
          );
        }
        if (z.kind === "lane") {
          return <rect key={z.id} x={z.x} y={z.y} width={z.w} height={z.h} rx={5} fill="rgba(255,255,255,0.025)" stroke="rgba(255,255,255,0.14)" />;
        }
        if (z.kind === "spawnA" || z.kind === "spawnB") {
          return (
            <rect
              key={z.id} x={z.x} y={z.y} width={z.w} height={z.h} rx={6}
              fill={z.kind === "spawnA" ? "rgba(74,222,128,0.06)" : "rgba(96,165,250,0.06)"}
              stroke={z.kind === "spawnA" ? "rgba(74,222,128,0.25)" : "rgba(96,165,250,0.25)"}
              strokeDasharray="4 4"
            />
          );
        }
        // feature（如 Bind 无中路标注）
        return (
          <text key={z.id} x={z.x + z.w / 2} y={z.y + z.h / 2} fill="rgba(255,255,255,0.22)" fontSize={9} textAnchor="middle">{z.label}</text>
        );
      })}

      {/* 结构墙体 */}
      {plan?.walls?.map(([x, y, w, h], i) => (
        <rect key={"w" + i} x={x} y={y} width={w} height={h} rx={2} fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.12)" />
      ))}

      {/* 特殊连接（Bind 传送器等） */}
      {plan?.links?.map(([a, b, label], i) => {
        const za = plan.zones.find((z) => z.id === a);
        const zb = plan.zones.find((z) => z.id === b);
        if (!za || !zb) return null;
        const ax = za.x + za.w / 2;
        const ay = za.y + za.h;
        const bx = zb.x + zb.w / 2;
        const by = zb.y + zb.h;
        return (
          <g key={"l" + i}>
            <path d={`M ${ax} ${ay} C ${(ax + bx) / 2} ${ay + 46}, ${(ax + bx) / 2} ${by + 46}, ${bx} ${by}`} fill="none" stroke="rgba(192,132,252,0.45)" strokeWidth={1.4} strokeDasharray="6 4" />
            <text x={(ax + bx) / 2} y={(ay + by) / 2 + 60} fill="rgba(192,132,252,0.7)" fontSize={9} textAnchor="middle">{label}</text>
          </g>
        );
      })}

      {/* 下包点脉冲标记 */}
      {plantRevealed && plantPos && (
        <g>
          <circle cx={plantPos.x + plantPos.w / 2} cy={plantPos.y + plantPos.h / 2} r={14} fill="none" stroke="rgba(251,146,60,0.6)" strokeWidth={1.4}>
            <animate attributeName="r" values="10;18;10" dur="1.6s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.8;0.2;0.8" dur="1.6s" repeatCount="indefinite" />
          </circle>
          <text x={plantPos.x + plantPos.w / 2} y={plantPos.y + plantPos.h / 2 + 4} fill="rgba(251,146,60,0.95)" fontSize={12} textAnchor="middle">💣</text>
        </g>
      )}

      {/* 图名 + 进攻方向 */}
      {mapDef && <text x={PLAN_W - 12} y={PLAN_H - 8} fill="rgba(255,255,255,0.4)" fontSize={10} textAnchor="end">{mapDef.name}</text>}
      <text x={12} y={PLAN_H - 8} fill="rgba(255,255,255,0.5)" fontSize={10}>
        进攻方：{atkTag}{atkSide === "A" ? " ↑" : " ↓"}
      </text>

      {/* ── 棋子（平面锚点站位，同区槽位错开） ── */}
      {pieceList.map((pc) => {
        const p = state.players[pc.pid]!;
        const pos = posOf.get(pc.pid)!;
        const isDead = dead.has(pc.pid);
        const recentKill = killLinks.length > 0 && killLinks[killLinks.length - 1]!.k === pc.pid;
        const agent = mapRec.agents?.[pc.pid];
        const agentName = agent ? (AGENT_BY_ID.get(agent)?.name ?? "") : "";
        return (
          <g key={pc.pid} opacity={isDead ? 0.26 : 1}>
            {isDead ? (
              <>
                <circle cx={pos.x} cy={pos.y} r={11} fill="#333" stroke="#666" />
                <text x={pos.x} y={pos.y + 4} fill="#888" fontSize={11} textAnchor="middle">✕</text>
              </>
            ) : (
              <>
                <circle cx={pos.x} cy={pos.y} r={11} fill={colorOf(pc.side)} stroke={recentKill ? "#fff" : "rgba(0,0,0,0.45)"} strokeWidth={recentKill ? 2 : 1} />
                <text x={pos.x} y={pos.y + 3.5} fill="#10141d" fontSize={8.5} fontWeight={700} textAnchor="middle">
                  {(p.ign || "?").slice(0, 3)}
                </text>
              </>
            )}
            <text x={pos.x} y={pos.y + 21} fill={isDead ? "#555" : "rgba(255,255,255,0.72)"} fontSize={8} textAnchor="middle">
              {agentName || p.ign.slice(0, 6)}
            </text>
          </g>
        );
      })}

      {/* 最新击杀连线 */}
      {killLinks.length > 0 && (() => {
        const last = killLinks[killLinks.length - 1]!;
        const kp = posOf.get(last.k);
        const vp = posOf.get(last.v);
        if (!kp || !vp) return null;
        return <line x1={kp.x} y1={kp.y} x2={vp.x} y2={vp.y} stroke={last.first ? "#fb923c" : "rgba(255,255,255,0.55)"} strokeWidth={last.first ? 2 : 1} strokeDasharray="4 3" />;
      })()}
    </svg>
  );
}
