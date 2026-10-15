/**
 * 资料库页（v1.4-2 外围包，GDD 资料库）：全联盟选手/教练/战队检索 + 与我队的交手记录。
 */
import { useMemo, useState } from "react";
import type { GameState } from "../../core/types.ts";
import { useStore } from "../store.ts";
import { PlayerFace, TeamLogo } from "./Avatar.tsx";
import { PlayerDossier } from "./PlayerDossier.tsx";
import { REGIONS } from "../../core/sim/day.ts";
import { teamAvgOverall } from "../../core/sim/scrim.ts";

export function LibraryPage(props: { state: GameState }) {
  const { state } = props;
  const [tab, setTab] = useState<"players" | "teams" | "coaches">("players");
  const [q, setQ] = useState("");
  const [dossierPid, setDossierPid] = useState<string | null>(null);
  const [teamFocus, setTeamFocus] = useState<string | null>(null);
  const myId = state.myTeamId ?? "";
  const openViewer = useStore((s) => s.openViewer);

  const matched = (s: string) => !q || s.toLowerCase().includes(q.toLowerCase());

  const players = useMemo(
    () => Object.values(state.players).filter((p) => matched(p.ign) || matched(p.realName ?? "")).sort((a, b) => b.overall - a.overall).slice(0, 80),
    [state.players, q],
  );
  const teams = useMemo(
    () => Object.values(state.teams).filter((t) => matched(t.name) || matched(t.tag)).sort((a, b) => b.reputation - a.reputation),
    [state.teams, q],
  );
  const coaches = useMemo(() => {
    const rows: { name: string; teamId: string; tactics: number; development: number; motivation: number }[] = [];
    for (const t of Object.values(state.teams)) {
      if (t.coach?.name && matched(t.coach.name)) {
        rows.push({ name: t.coach.name, teamId: t.id, tactics: t.coach.tactics ?? 50, development: t.coach.development ?? 50, motivation: t.coach.motivation ?? 50 });
      }
    }
    return rows;
  }, [state.teams, q]);

  // 交手记录：目标队 vs 我队的历史 fixture（含比分与回放入口）
  const history = useMemo(() => {
    if (!teamFocus) return [];
    const t = state.teams[teamFocus];
    if (!t) return [];
    return state.fixtures
      .filter((f) => f.played && ((f.teamA === teamFocus && f.teamB === myId) || (f.teamB === teamFocus && f.teamA === myId)))
      .slice()
      .reverse()
      .slice(0, 12);
  }, [teamFocus, state.fixtures, myId]);

  const dossierPlayer = dossierPid ? state.players[dossierPid] : null;

  return (
    <div>
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <h3>📚 资料库</h3>
          <div className="row" style={{ gap: 6 }}>
            {([["players", "选手"], ["teams", "战队"], ["coaches", "教练"]] as const).map(([k, label]) => (
              <button key={k} className={tab === k ? "small primary" : "small"} onClick={() => { setTab(k); setTeamFocus(null); }}>{label}</button>
            ))}
            <input placeholder="搜索名字…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 130 }} />
          </div>
        </div>

        {tab === "players" && (
          <table>
            <thead><tr><th>选手</th><th>所属</th><th>年龄</th><th>能力/潜力</th><th>身价参考</th><th></th></tr></thead>
            <tbody>
              {players.map((p) => (
                <tr key={p.id}>
                  <td><span className="row" style={{ gap: 6, alignItems: "center" }}><PlayerFace p={p} size={20} showTag={false} />{p.ign}</span></td>
                  <td className="muted small">{p.teamId ? (state.teams[p.teamId]?.tag ?? "—") : "自由"}</td>
                  <td>{p.age}</td>
                  <td><b>{p.overall}</b> <span className="muted small">/ {p.potential}</span></td>
                  <td className="muted small">${((p.salary ?? 0) / 1000).toFixed(0)}K 级</td>
                  <td><button className="small" onClick={() => setDossierPid(p.id)}>档案</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {tab === "teams" && (
          <div className="startgrid">
            {teams.map((t) => (
              <div key={t.id} className="teamcard" onClick={() => setTeamFocus(t.id === teamFocus ? null : t.id)}>
                <div className="row" style={{ justifyContent: "space-between", gap: 6, alignItems: "center" }}>
                  <span className="row" style={{ gap: 6, alignItems: "center", minWidth: 0 }}>
                    <TeamLogo team={t} size={20} />
                    <b style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</b>
                  </span>
                  <span className={`tag${t.tier === 1 ? " red" : ""}`}>{t.tier === 1 ? "VCT" : "挑战者"}</span>
                </div>
                <div className="muted small" style={{ marginTop: 4 }}>
                  声望 {t.reputation} · 强度 {Math.round(teamAvgOverall(state, t.id))} · {REGIONS.find((r) => r.id === t.regionId)?.label ?? t.regionId}
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === "coaches" && (
          <table>
            <thead><tr><th>教练</th><th>执教</th><th>战术</th><th>培养</th><th>激励</th></tr></thead>
            <tbody>
              {coaches.map((c, i) => (
                <tr key={c.teamId + i}>
                  <td><b>{c.name}</b></td>
                  <td className="muted small">{state.teams[c.teamId]?.name}</td>
                  <td>{c.tactics}</td>
                  <td>{c.development}</td>
                  <td>{c.motivation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 交手记录（选中战队后展示） */}
      {teamFocus && (
        <div className="card">
          <h3>🤜🤛 vs {state.teams[teamFocus]?.name} 交手记录（近 12 场）</h3>
          {history.length === 0 && <div className="muted small">本赛季暂无交手。</div>}
          {history.length > 0 && (
            <table>
              <thead><tr><th>日期</th><th>赛事</th><th>结果</th><th></th></tr></thead>
              <tbody>
                {history.map((f) => {
                  const won = f.winnerTeamId === myId;
                  const drawn = !f.winnerTeamId;
                  return (
                    <tr key={f.id}>
                      <td className="muted">D{f.day}</td>
                      <td className="muted small">{f.label}</td>
                      <td style={{ color: won ? "#4ade80" : drawn ? undefined : "#f87171" }}>{won ? "胜" : drawn ? "—" : "负"}</td>
                      <td><button className="small" onClick={() => openViewer(f.id)}>回放</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {dossierPlayer && (
        <PlayerDossier state={state} player={dossierPlayer} onClose={() => setDossierPid(null)} />
      )}
    </div>
  );
}
