/**
 * 2D 战术视图 v4（v0.9-5 对局美术打磨二期，GDD §5.4）：
 * 真实俯视图底图（valorant-api displayicon）+ 官方 callouts 标定站点，
 * 棋子按 开局战术×职责×攻防 布置，随事件揭示平滑移动（首杀压进→下包收拢），
 * 阵亡灰化、击杀连线、下包脉冲。全部确定性。
 */
import { MAP_BY_ID } from "../../core/data/maps.ts";
import { AGENT_BY_ID, primaryDuty } from "../../core/data/agents.ts";
import { PLAN_W, PLAN_H, MAP_ART, planOf, positionFor, plantZoneOf, tacticLabel } from "../../core/data/mapplans.ts";
import type { AnchorDuty } from "../../core/data/mapplans.ts";
import type { GameState, MapRecord, RoundEvent } from "../../core/types.ts";

export function Tactical2D(props: {
  state: GameState;
  mapRec: MapRecord;
  roundEvents: RoundEvent[];
  revealedCount: number;
  teamAId: string;
  teamBId: string;
  atkSide: "A" | "B";
  roundN: number;
  tacticAtk: string;
  tacticDef: string;
}) {
  const { state, mapRec, roundEvents, revealedCount, teamAId, teamBId, atkSide, roundN, tacticAtk, tacticDef } = props;
  const plan = planOf(mapRec.map);
  const mapDef = MAP_BY_ID.get(mapRec.map);

  const revealed = roundEvents.slice(0, Math.max(0, revealedCount));
  const dead = new Set<string>();
  const killLinks: { k: string; v: string; first: boolean }[] = [];
  let plantRevealed = false;
  let killsRevealed = 0;
  for (const e of revealed) {
    if (e.t === "kill" && e.s && e.v) {
      dead.add(e.v);
      killLinks.push({ k: e.s, v: e.v, first: !!e.first });
      killsRevealed++;
    }
    if (e.t === "plant") plantRevealed = true;
  }
  const plantZone = plantZoneOf(mapRec.map, roundN);
  const plantPos = plan?.zones.find((z) => z.id === plantZone?.id);

  const sides: { side: "A" | "B"; teamId: string; canvas: "top" | "bottom" }[] = [
    { side: "B", teamId: teamBId, canvas: "top" },
    { side: "A", teamId: teamAId, canvas: "bottom" },
  ];
  const colorOf = (side: "A" | "B") => (side === "A" ? "#4ade80" : "#60a5fa");
  const atkTag = atkSide === "A" ? (state.teams[teamAId]?.tag ?? "A") : (state.teams[teamBId]?.tag ?? "B");
  const atkTacticLabel = tacticLabel(atkSide === "A" ? tacticAtk : tacticDef);

  // 统一位姿：先按 zoneId 分组发槽位（错开重叠），再算最终坐标
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
      duty: dutyOf(pc.pid), isAttacking: atkSide === pc.side, roundN, pid: pc.pid, plantRevealed,
      side: pc.canvas, tactic: atkSide === pc.side ? tacticAtk : tacticDef, killsRevealed, slot: 0,
    }).zoneId);
  }
  const slotCount = new Map<string, number>();
  const posOf = new Map<string, { x: number; y: number }>();
  for (const pc of pieceList) {
    const zid = zoneOf.get(pc.pid)!;
    const slot = slotCount.get(zid) ?? 0;
    slotCount.set(zid, slot + 1);
    posOf.set(pc.pid, positionFor(mapRec.map, {
      duty: dutyOf(pc.pid), isAttacking: atkSide === pc.side, roundN, pid: pc.pid, plantRevealed,
      side: pc.canvas, tactic: atkSide === pc.side ? tacticAtk : tacticDef, killsRevealed, slot,
    }));
  }

  return (
    <svg
      viewBox={`0 0 ${PLAN_W} ${PLAN_H}`}
      style={{ width: "100%", maxWidth: 420, background: "#0b0e15", borderRadius: 10, border: "1px solid var(--line)" }}
    >
      {/* 真实俯视图底图 */}
      <image href={MAP_ART[mapRec.map]} x={0} y={0} width={PLAN_W} height={PLAN_H} opacity={0.92} />

      {/* 站点标签（标定区域左上角，轻量不遮地图） */}
      {plan?.zones.filter((z) => z.kind === "site").map((z) => (
        <text key={z.id} x={z.x + 5} y={z.y + 14} fill="rgba(232,193,90,0.85)" fontSize={13} fontWeight={700}
          style={{ paintOrder: "stroke", stroke: "#0b0e15", strokeWidth: 3 }}>
          {z.label}
        </text>
      ))}
      {plan?.zones.filter((z) => z.kind === "spawnA" || z.kind === "spawnB").map((z) => (
        <text key={z.id} x={z.x + z.w / 2} y={z.y + z.h / 2} fill={z.kind === "spawnA" ? "rgba(74,222,128,0.4)" : "rgba(96,165,250,0.4)"}
          fontSize={9} textAnchor="middle" style={{ paintOrder: "stroke", stroke: "#0b0e15", strokeWidth: 2.5 }}>
          {z.label}
        </text>
      ))}

      {/* 下包点脉冲 */}
      {plantRevealed && plantPos && (
        <g>
          <circle cx={plantPos.x + plantPos.w / 2} cy={plantPos.y + plantPos.h / 2} r={16} fill="none" stroke="rgba(251,146,60,0.7)" strokeWidth={1.6}>
            <animate attributeName="r" values="11;20;11" dur="1.6s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.9;0.25;0.9" dur="1.6s" repeatCount="indefinite" />
          </circle>
          <text x={plantPos.x + plantPos.w / 2} y={plantPos.y + plantPos.h / 2 + 4} fill="rgba(251,146,60,0.95)" fontSize={12} textAnchor="middle">💣</text>
        </g>
      )}

      {/* 图名 + 攻防/战术信息 */}
      {mapDef && <text x={PLAN_W - 10} y={PLAN_H - 8} fill="rgba(255,255,255,0.45)" fontSize={10} textAnchor="end" style={{ paintOrder: "stroke", stroke: "#0b0e15", strokeWidth: 2.5 }}>{mapDef.name}</text>}
      <text x={10} y={PLAN_H - 8} fill="rgba(255,255,255,0.6)" fontSize={10} style={{ paintOrder: "stroke", stroke: "#0b0e15", strokeWidth: 2.5 }}>
        {atkTag} 进攻 · 战术：{atkTacticLabel}
      </text>

      {/* 棋子（transform 过渡 → 事件揭示时平滑移动） */}
      {pieceList.map((pc) => {
        const p = state.players[pc.pid]!;
        const pos = posOf.get(pc.pid)!;
        const isDead = dead.has(pc.pid);
        const recentKill = killLinks.length > 0 && killLinks[killLinks.length - 1]!.k === pc.pid;
        const agent = mapRec.agents?.[pc.pid];
        const agentName = agent ? (AGENT_BY_ID.get(agent)?.name ?? "") : "";
        return (
          <g
            key={pc.pid}
            opacity={isDead ? 0.26 : 1}
            style={{
              transform: `translate(${pos.x}px, ${pos.y}px)`,
              transition: "transform 900ms cubic-bezier(0.33, 0, 0.2, 1)",
            }}
          >
            {isDead ? (
              <>
                <circle cx={0} cy={0} r={11} fill="#333" stroke="#666" />
                <text x={0} y={4} fill="#888" fontSize={11} textAnchor="middle">✕</text>
              </>
            ) : (
              <>
                <circle cx={0} cy={0} r={11} fill={colorOf(pc.side)} stroke={recentKill ? "#fff" : "rgba(0,0,0,0.5)"} strokeWidth={recentKill ? 2 : 1} />
                <text x={0} y={3.5} fill="#10141d" fontSize={8.5} fontWeight={700} textAnchor="middle">
                  {(p.ign || "?").slice(0, 3)}
                </text>
              </>
            )}
            <text x={0} y={21} fill={isDead ? "#555" : "rgba(255,255,255,0.75)"} fontSize={8} textAnchor="middle" style={{ paintOrder: "stroke", stroke: "#0b0e15", strokeWidth: 2 }}>
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
        return (
          <line x1={kp.x} y1={kp.y} x2={vp.x} y2={vp.y}
            stroke={last.first ? "#fb923c" : "rgba(255,255,255,0.55)"} strokeWidth={last.first ? 2 : 1} strokeDasharray="4 3" />
        );
      })()}
    </svg>
  );
}
