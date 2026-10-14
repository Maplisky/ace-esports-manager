/**
 * 2D 战术视图（v0.9 回放器 v2，GDD §14 程序化棋子方案）：
 * 竖向示意图 + 色块棋子（圆点=选手），随事件揭示灰化阵亡者；不依赖手绘地图。
 * 站位由 (mapId+pid+roundN) 哈希确定性散布——同回合回放完全一致。
 */
import { MAP_BY_ID } from "../../core/data/maps.ts";
import { hashString } from "../../core/rng.ts";
import type { GameState, MapRecord, RoundEvent } from "../../core/types.ts";
import { AGENT_BY_ID } from "../../core/data/agents.ts";

const W = 300;
const H = 400;

function hashPos(mapId: string, pid: string, roundN: number, half: "top" | "bottom"): { x: number; y: number } {
  const h = hashString(`${mapId}:${pid}:${roundN}:${half}`);
  const x = 36 + (h % (W - 72));
  // >>> 无符号移位：>> 会让 h≥2^31 时取到负数，棋子被画到画布外
  const y = half === "top" ? 40 + ((h >>> 8) % 120) : H - 160 + ((h >>> 8) % 120);
  return { x, y };
}

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
  const mapDef = MAP_BY_ID.get(mapRec.map);
  const round = mapRec.rounds.find((r) => r.n !== undefined); // 仅用于取 map 名，无副作用
  void round;

  const revealed = roundEvents.slice(0, Math.max(0, revealedCount));
  const dead = new Set<string>();
  const killLinks: { k: string; v: string; first: boolean }[] = [];
  for (const e of revealed) {
    if (e.t === "kill" && e.s && e.v) {
      dead.add(e.v);
      killLinks.push({ k: e.s, v: e.v, first: !!e.first });
    }
  }

  const sides: { side: "A" | "B"; teamId: string; half: "top" | "bottom" }[] = [
    { side: "B", teamId: teamBId, half: "top" },
    { side: "A", teamId: teamAId, half: "bottom" },
  ];
  const colorOf = (side: "A" | "B") => (side === "A" ? "#4ade80" : "#60a5fa");
  const atkColor = atkSide === "A" ? colorOf("A") : colorOf("B");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: 300, background: "#141822", borderRadius: 10, border: "1px solid var(--line)" }}>
      {/* 地图示意：A/B 点框 + 中线 */}
      <rect x={W / 2 - 70} y={36} width={140} height={70} fill="rgba(96,165,250,0.08)" stroke="rgba(96,165,250,0.35)" rx={6} />
      <text x={W / 2} y={76} fill="rgba(96,165,250,0.6)" fontSize={13} textAnchor="middle">A 点</text>
      <rect x={W / 2 - 70} y={H - 106} width={140} height={70} fill="rgba(239,68,68,0.08)" stroke="rgba(239,68,68,0.35)" rx={6} />
      <text x={W / 2} y={H - 66} fill="rgba(239,68,68,0.6)" fontSize={13} textAnchor="middle">B 点</text>
      <line x1={20} y1={H / 2} x2={W - 20} y2={H / 2} stroke="rgba(255,255,255,0.12)" strokeDasharray="6 6" />
      <text x={16} y={H / 2 - 6} fill="rgba(255,255,255,0.35)" fontSize={10}>中线</text>
      {mapDef && <text x={W - 14} y={H - 12} fill="rgba(255,255,255,0.4)" fontSize={11} textAnchor="end">{mapDef.name}</text>}
      {/* 进攻方向指示 */}
      <text x={16} y={22} fill="rgba(255,255,255,0.5)" fontSize={11}>
        ↑ 进攻方：{atkSide === "A" ? (state.teams[teamAId]?.tag ?? "A") : (state.teams[teamBId]?.tag ?? "B")}
      </text>

      {/* 棋子 */}
      {sides.map(({ side, teamId, half }) => {
        const team = state.teams[teamId];
        if (!team) return null;
        return team.starters.map((pid) => {
          const p = state.players[pid];
          if (!p) return null;
          const pos = hashPos(mapRec.map, pid, mapRec.rounds[0]?.n ?? 1, half);
          const isDead = dead.has(pid);
          const agent = mapRec.agents?.[pid];
          const agentName = agent ? (AGENT_BY_ID.get(agent)?.name ?? "") : "";
          const recentKill = killLinks.length > 0 && killLinks[killLinks.length - 1]!.k === pid;
          return (
            <g key={pid} opacity={isDead ? 0.28 : 1}>
              {isDead ? (
                <>
                  <circle cx={pos.x} cy={pos.y} r={13} fill="#333" stroke="#666" />
                  <text x={pos.x} y={pos.y + 4} fill="#888" fontSize={12} textAnchor="middle">✕</text>
                </>
              ) : (
                <>
                  <circle cx={pos.x} cy={pos.y} r={13} fill={colorOf(side)} stroke={recentKill ? "#fff" : "rgba(0,0,0,0.4)"} strokeWidth={recentKill ? 2 : 1} />
                  <text x={pos.x} y={pos.y + 4} fill="#111" fontSize={9} fontWeight={700} textAnchor="middle">
                    {(p.ign || "?").slice(0, 3)}
                  </text>
                </>
              )}
              <text x={pos.x} y={pos.y + 26} fill={isDead ? "#666" : "rgba(255,255,255,0.75)"} fontSize={9} textAnchor="middle">
                {agentName || p.ign.slice(0, 6)}
              </text>
            </g>
          );
        });
      })}

      {/* 最新击杀连线 */}
      {killLinks.length > 0 && (() => {
        const last = killLinks[killLinks.length - 1]!;
        const all = [...sides.flatMap((s) => (state.teams[s.teamId]?.starters ?? []).map((pid) => ({ pid, half: s.half })))];
        const kPos = all.find((x) => x.pid === last.k);
        const vPos = all.find((x) => x.pid === last.v);
        if (!kPos || !vPos) return null;
        const kp = hashPos(mapRec.map, kPos.pid, mapRec.rounds[0]?.n ?? 1, kPos.half);
        const vp = hashPos(mapRec.map, vPos.pid, mapRec.rounds[0]?.n ?? 1, vPos.half);
        return <line x1={kp.x} y1={kp.y} x2={vp.x} y2={vp.y} stroke={last.first ? "#fb923c" : "rgba(255,255,255,0.5)"} strokeWidth={last.first ? 2 : 1} strokeDasharray="4 3" />;
      })()}
    </svg>
  );
}
