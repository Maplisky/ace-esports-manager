import type { GameState, MatchRecord } from "../../core/types.ts";
import { useStore } from "../store.ts";
import { formatDate } from "./Overview.tsx";

export function SchedulePage(props: { state: GameState; records: Record<string, MatchRecord> }) {
  const { state, records } = props;
  const myId = state.myTeamId ?? "";
  const { openViewer } = useStore();
  const mine = state.fixtures.filter((f) => f.teamA === myId || f.teamB === myId);

  return (
    <div className="card">
      <h3>📅 赛程（我的比赛）</h3>
      <table>
        <thead>
          <tr><th>日期</th><th>阶段</th><th>赛事</th><th>对阵</th><th>比分</th><th></th></tr>
        </thead>
        <tbody>
          {mine.map((f) => {
            const myHome = f.teamA === myId;
            const oppId = myHome ? f.teamB : f.teamA;
            const rec = records[f.id];
            // 我的视角比分
            const myScore = rec ? (myHome ? rec.score[0] : rec.score[1]) : null;
            const oppScore = rec ? (myHome ? rec.score[1] : rec.score[0]) : null;
            const win = rec ? (myScore ?? 0) > (oppScore ?? 0) : null;
            return (
              <tr key={f.id} className={rec ? "me" : ""}>
                <td className="muted">{formatDate(state.year, f.day)}</td>
                <td>{stageName(f.stage)}</td>
                <td className="muted">{f.label}</td>
                <td>
                  vs {state.teams[oppId]?.name}
                  <span className="tag" style={{ marginLeft: 6 }}>BO{f.bo}</span>
                </td>
                <td>
                  {rec ? (
                    <span className={win ? "tag green" : "tag red"}>{win ? "胜" : "负"} {myScore}-{oppScore}</span>
                  ) : (
                    <span className="muted">待赛</span>
                  )}
                </td>
                <td>
                  {rec && (
                    <button className="ghost small" onClick={() => openViewer(f.id)}>
                      ▶ 回放
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function stageName(stage: string): string {
  return stage === "cup" ? "揭幕杯" : stage === "stage1" ? "Stage 1" : stage;
}
