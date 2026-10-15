/**
 * 回放库页（v1.4-2 外围包）：跨赛季回放统一入口——翻年不再清空（worker 滚动保留最近 30 场）。
 */
import type { GameState, MatchRecord } from "../../core/types.ts";
import { useStore } from "../store.ts";
import { TeamLogo } from "./Avatar.tsx";

export function ReplaysPage(props: { state: GameState; records: Record<string, MatchRecord> }) {
  const { state, records } = props;
  const openViewer = useStore((s) => s.openViewer);
  const myId = state.myTeamId ?? "";
  const rows = Object.entries(records)
    .map(([fid, rec]) => {
      const f = state.fixtures.find((x) => x.id === fid);
      return { fid, rec, day: f?.day ?? 0, label: f?.label ?? "" };
    })
    .sort((a, b) => b.day - a.day)
    .slice(0, 40);

  return (
    <div className="card">
      <h3>🎬 回放库（{rows.length} 场 · 跨赛季留存最近 30 场）</h3>
      {rows.length === 0 && <div className="muted small">还没有比赛记录——打一场就有了。</div>}
      {rows.length > 0 && (
        <table>
          <thead><tr><th>日期</th><th>赛事</th><th>对阵</th><th>比分</th><th></th></tr></thead>
          <tbody>
            {rows.map(({ fid, rec, day, label }) => {
              const ta = state.teams[rec.teamA];
              const tb = state.teams[rec.teamB];
              const mine = rec.teamA === myId || rec.teamB === myId;
              return (
                <tr key={fid}>
                  <td className="muted">D{day || "?"}</td>
                  <td className="muted small">{label || "—"}</td>
                  <td>
                    <span className="row" style={{ gap: 6, alignItems: "center" }}>
                      {ta && <TeamLogo team={ta} size={18} />}{ta?.tag ?? "?"}
                      <span className="muted">vs</span>
                      {tb && <TeamLogo team={tb} size={18} />}{tb?.tag ?? "?"}
                      {mine && <span className="tag green small">我</span>}
                    </span>
                  </td>
                  <td><b>{rec.score[0]} - {rec.score[1]}</b></td>
                  <td><button className="small" onClick={() => openViewer(fid)}>观看</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
