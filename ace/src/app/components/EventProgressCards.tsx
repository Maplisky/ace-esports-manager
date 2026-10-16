/**
 * 国际赛进度卡（v1.x 用户反馈，对齐原作赛程页「赛事状态 + 晋级标记」）：
 *  瑞士轮：w-l 进度 + 晋级/出局状态列；
 *  Champions GSL：按小组列积分表（前二 ✓ 晋级 / 出局 ✗）；
 *  数据全部派生自 fixtures/comps，零新状态。
 */
import type { GameState } from "../../core/types.ts";
import { TeamLogo } from "./Avatar.tsx";

interface StandingsRow { teamId: string; w: number; l: number; mapW: number; mapL: number; roundW: number; roundL: number; pts: number }
interface CompLite { key: string; name: string; stage: string; teamIds: string[]; standings: Record<string, StandingsRow> }

export function EventProgressCards(props: { state: GameState; myId: string; comps: CompLite[] }) {
  const { state, myId, comps } = props;
  const tag = (id: string) => state.teams[id]?.tag ?? id;

  return (
    <>
      {comps.map((comp) => {
        const fx = state.fixtures.filter((f) => f.comp === comp.key);
        const standing = Object.values(comp.standings).sort(
          (a, b) => b.w - a.w || (b.mapW - b.mapL) - (a.mapW - a.mapL),
        );

        if (comp.key === "masters" || comp.key === "cup") {
          const myEntry = comp.standings[myId];
          const myW = myEntry?.w ?? 0;
          const myL = myEntry?.l ?? 0;
          const isSwiss = comp.key === "masters" && !fx.some((f) => f.label.includes("胜者组第1轮"));
          const final = fx.find((f) => f.label.includes("总决赛") && f.played);
          let headline = `${comp.name} 进行中`;
          if (final) {
            const champ = final.winnerTeamId ? tag(final.winnerTeamId) : "?";
            headline = `${comp.name} 已收官 · 冠军 ${champ}${final.winnerTeamId === myId ? "（我们！）" : ""}`;
          } else if (isSwiss && myEntry) {
            headline =
              myW >= 2 ? `瑞士轮 ${myW}-${myL}，✓ 已晋级淘汰赛` :
              myL >= 2 ? `瑞士轮 ${myW}-${myL}，✗ 止步瑞士轮` :
              `瑞士轮 ${myW}-${myL}：再赢 ${2 - myW} 场晋级，再输 ${2 - myL} 场出局`;
          }
          const statusOf = (e: StandingsRow) =>
            e.w >= 2 ? <span className="tag green">✓ 晋级</span> :
            e.l >= 2 ? <span className="tag red">✗ 出局</span> :
            <span className="muted small">{2 - e.w} 胜 / {2 - e.l} 负</span>;
          return (
            <div className="card" key={comp.key}>
              <h3>🏆 {comp.name} · 赛事进度</h3>
              <div className="small" style={{ marginBottom: 8, fontWeight: 700 }}>{headline}</div>
              <table>
                <thead><tr><th>#</th><th style={{ textAlign: "left" }}>战队</th><th>胜</th><th>负</th><th>状态</th></tr></thead>
                <tbody>
                  {standing.slice(0, 8).map((e, i) => (
                    <tr key={e.teamId} className={e.teamId === myId ? "me" : ""}>
                      <td>{i + 1}</td>
                      <td>
                        <span className="row" style={{ alignItems: "center", gap: 6 }}>
                          {state.teams[e.teamId] && <TeamLogo team={state.teams[e.teamId]} size={18} />}
                          {state.teams[e.teamId]?.name}
                        </span>
                      </td>
                      <td>{e.w}</td>
                      <td>{e.l}</td>
                      <td>{statusOf(e)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        if (comp.key === "champions") {
          const bracket = fx.filter((f) => f.label.includes("胜者组第1轮"));
          const GROUPS = ["A", "B", "C", "D"] as const;
          const groupMembers = new Map<string, string[]>();
          for (const f of fx.filter((x) => x.label.includes("揭幕战"))) {
            const m = f.label.match(/Champions ([ABCD])组/);
            if (m) groupMembers.set(m[1]!, [f.teamA, f.teamB]);
          }
          const myGroup = [...groupMembers.entries()].find(([, ids]) => ids.includes(myId))?.[0];
          const gslRow = (id: string) => {
            const played = fx.filter((f) => !f.label.includes("胜者组第1轮") && (f.teamA === id || f.teamB === id) && f.played);
            let w = 0, l = 0, eliminated = false;
            for (const f of played) {
              if (f.winnerTeamId === id) w++; else l++;
            }
            const decider = played.find((f) => f.label.includes("出线决定赛"));
            if (decider && decider.winnerTeamId !== id) eliminated = true;
            return { w, l, eliminated };
          };
          return (
            <div className="card" key={comp.key}>
              <h3>🏆 {comp.name} · 小组积分（GSL · 前二出线）</h3>
              {myGroup && (
                <div className="small" style={{ marginBottom: 8 }}>
                  我们所在：<b>{myGroup} 组</b>{bracket.length > 0 ? " · 小组已收官，八强淘汰赛进行中" : ""}
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10 }}>
                {GROUPS.filter((g) => groupMembers.has(g)).map((g) => {
                  const ids = groupMembers.get(g)!;
                  const rows = ids.map((id) => ({ id, ...gslRow(id) })).sort((a, b) => b.w - a.w || a.l - b.l);
                  return (
                    <div key={g} style={{ border: `1px solid ${g === myGroup ? "var(--accent)" : "var(--line-soft)"}`, borderRadius: 8, padding: "8px 12px" }}>
                      <b className="small">{g} 组{g === myGroup ? "（我们）" : ""}</b>
                      <table style={{ width: "100%", marginTop: 4 }}>
                        <tbody>
                          {rows.map((r, i) => (
                            <tr key={r.id} className={r.id === myId ? "me" : ""}>
                              <td className="small">{i + 1}</td>
                              <td className="small">{tag(r.id)}</td>
                              <td className="small muted">{r.w}-{r.l}</td>
                              <td className="small">
                                {r.eliminated ? <span className="tag red">✗</span> : r.w >= 2 ? <span className="tag green">✓</span> : <span className="muted small">…</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })}
              </div>
              {bracket.length > 0 && (
                <div className="muted small" style={{ marginTop: 8 }}>
                  八强双败淘汰：{bracket.filter((f) => f.played).map((f) => {
                    const w = f.winnerTeamId;
                    return w ? `${tag(w)} 胜 ${tag(w === f.teamA ? f.teamB : f.teamA)}` : "";
                  }).filter(Boolean).join("、") || "即将开打"}
                </div>
              )}
            </div>
          );
        }
        return null;
      })}
    </>
  );
}
