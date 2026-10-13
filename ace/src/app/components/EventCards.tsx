/** 事件卡弹窗（GDD §9.3）：待决策队列逐张呈现，选项即结算 */
import { useStore } from "../store.ts";

export function EventCardModal() {
  const state = useStore((s) => s.state);
  const resolveEvent = useStore((s) => s.resolveEvent);
  if (!state || state.pendingEvents.length === 0) return null;
  const card = state.pendingEvents[0]!;
  const target = card.targetPlayerId ? state.players[card.targetPlayerId] : null;

  return (
    <div className="viewer-backdrop">
      <div className="viewer" style={{ width: "min(560px, 92vw)" }}>
        <div className="muted small" style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <span>📋 事件 · 待处理 {state.pendingEvents.length}</span>
          <span>{target ? `${target.ign}` : "俱乐部"}</span>
        </div>
        <h3 style={{ margin: "0 0 8px", fontSize: 18 }}>{card.title}</h3>
        <p style={{ lineHeight: 1.8, margin: "0 0 14px" }}>{card.text}</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {card.options.map((o, i) => (
            <button
              key={i}
              style={{ textAlign: "left", padding: "10px 14px" }}
              onClick={() => void resolveEvent(card.uid, i)}
            >
              <b>{o.label}</b>
              {o.morale !== undefined && o.morale !== 0 && <span className={`tag${o.morale >= 0 ? " green" : " red"}`} style={{ marginLeft: 8 }}>士气{o.morale >= 0 ? "+" : ""}{o.morale}</span>}
              {o.budget !== undefined && o.budget !== 0 && <span className={`tag${o.budget >= 0 ? " green" : " red"}`} style={{ marginLeft: 6 }}>{o.budget >= 0 ? "+" : "-"}{fmtMoney(Math.abs(o.budget))}</span>}
              {o.fatigue !== undefined && o.fatigue !== 0 && <span className="tag" style={{ marginLeft: 6 }}>体能{o.fatigue > 0 ? "+" : ""}{o.fatigue}</span>}
              {o.teamMorale !== undefined && <span className="tag green" style={{ marginLeft: 6 }}>全队士气 +{o.teamMorale}</span>}
              {o.bond !== undefined && o.bond !== 0 && <span className="tag" style={{ marginLeft: 6 }}>羁绊 +{o.bond}</span>}
              {o.reputation !== undefined && o.reputation !== 0 && <span className="tag" style={{ marginLeft: 6 }}>声望{o.reputation > 0 ? "+" : ""}{o.reputation}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function fmtMoney(v: number): string {
  return v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(2)}M` : `$${Math.abs(v) >= 1000 ? Math.round(v / 1000) + "K" : v}`;
}
