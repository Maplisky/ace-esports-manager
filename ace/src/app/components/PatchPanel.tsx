/** 版本公告面板（GDD §4.3 v0.9）：全局定位 + 地图级影响清单，转会页/总览复用 */
import type { GameState } from "../../core/types.ts";
import { AGENT_BY_ID } from "../../core/data/agents.ts";
import { MAPS } from "../../core/data/maps.ts";

export function PatchPanel(props: { state: GameState }) {
  const patch = props.state.patchNotes?.slice(-1)[0];
  if (!patch) return null;
  return (
    <div className="card" style={{ padding: "10px 14px" }}>
      <h3>📢 版本 {patch.version} 公告</h3>
      <div className="row" style={{ flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
        {patch.changes.map((c) => {
          const name = AGENT_BY_ID.get(c.agentId)?.name ?? c.agentId;
          const up = c.dir === "buff";
          return (
            <span
              key={c.agentId}
              className="tag"
              style={{
                background: up ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
                color: up ? "#4ade80" : "#f87171",
                fontWeight: 700,
              }}
              title={`版本系数 ${c.meta.toFixed(2)}`}
            >
              {name} {up ? "↑" : "↓"}
              {c.pct}%
            </span>
          );
        })}
      </div>
      {patch.mapNotes.map((n) => {
        const mapName = MAPS.find((m) => m.id === n.mapId)?.name ?? n.mapId;
        return (
          <div key={n.mapId} className="muted small" style={{ marginBottom: 4 }}>
            🗺 {mapName}：{n.text}
          </div>
        );
      })}
    </div>
  );
}
