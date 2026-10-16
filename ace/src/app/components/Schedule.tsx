import type { GameState, MatchRecord } from "../../core/types.ts";
import { useStore } from "../store.ts";
import { formatDate } from "./Overview.tsx";
import { EventProgressCards } from "./EventProgressCards.tsx";
import { BracketView } from "./BracketView.tsx";

export function SchedulePage(props: { state: GameState; records: Record<string, MatchRecord> }) {
  const { state, records } = props;
  const myId = state.myTeamId ?? "";
  const { openViewer } = useStore();
  const mine = state.fixtures.filter((f) => f.teamA === myId || f.teamB === myId);
  const eventComps = Object.values(state.comps).filter((c) => ["cup", "masters", "champions"].includes(c.stage));
  // 晋级图：当前/最近的国际淘汰赛（Masters 优先，其次 Champions）
  const bracketComp =
    (state.comps["masters"] && state.fixtures.some((f) => f.comp === "masters" && f.label.includes("胜者组第1轮")) ? "masters" : null) ??
    (state.comps["champions"] && state.fixtures.some((f) => f.comp === "champions" && f.label.includes("胜者组第1轮")) ? "champions" : null);

  return (
    <div>
      {eventComps.length > 0 && <EventProgressCards state={state} myId={myId} comps={eventComps} />}
      {bracketComp && (
        <div className="card">
          <h3>🗺 晋级图 · {state.comps[bracketComp]?.name} 双败淘汰</h3>
          <BracketView state={state} compKey={bracketComp} myId={myId} />
        </div>
      )}
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
                  {state.teams[oppId]?.name}
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
    </div>
  );
}

function stageName(stage: string): string {
  switch (stage) {
    case "preseason": return "季前准备";
    case "cup": return "揭幕杯";
    case "masters": return "Masters";
    case "stage1": return "Stage 1";
    case "summer": return "夏季窗口";
    case "stage2": return "Stage 2";
    case "champions": return "Champions";
    default: return "休赛期";
  }
}
