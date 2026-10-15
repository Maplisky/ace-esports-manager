/** 名人堂 / 生涯页（v1.0-6，GDD §9.5）：经理生涯账本 + 选手退役留档 + 教练池 + 选秀留档 */
import type { GameState } from "../../core/types.ts";
import { ORIGINS, jobOffers } from "../../core/sim/career.ts";
import { TeamLogo } from "./Avatar.tsx";
import { useStore } from "../store.ts";

const ORIGIN_LABEL: Record<string, string> = Object.fromEntries(ORIGINS.map((o) => [o.key, o.label]));

export function CareerPage(props: { state: GameState }) {
  const { state } = props;
  const { applyJob, busy } = useStore();
  const c = state.manager.career;
  const total = (c?.wins ?? 0) + (c?.losses ?? 0);
  const wr = total > 0 ? ((c!.wins / total) * 100).toFixed(1) : "—";
  const retirees = (state.retireLog ?? [])
    .slice()
    .sort((a, b) => (b.titles ?? 0) - (a.titles ?? 0) || (b.overall ?? 0) - (a.overall ?? 0))
    .slice(0, 24);
  const coaches = state.coachPool ?? [];
  const draftPicks = state.lastDraft?.picks.filter((x) => x.playerId) ?? [];
  const inJobWindow = state.stage === "offseason" || state.stage === "champions";
  const offers = inJobWindow ? jobOffers(state) : [];

  return (
    <>
      <div className="card">
        <h3>🎖 {state.manager.name} · 生涯账本</h3>
        <div className="row small" style={{ flexWrap: "wrap", gap: 14 }}>
          <span>出身：<b>{ORIGIN_LABEL[c?.origin ?? ""] ?? "—"}</b></span>
          <span>赛季：<b>{c?.seasons ?? 1}</b></span>
          <span>冠军：<b>{c?.titles ?? 0}</b> 座</span>
          <span>战绩：<b>{c?.wins ?? 0}胜 {c?.losses ?? 0}负</b>（胜率 {wr}%）</span>
          <span>声望：<b>{Math.round(state.manager.reputation)}</b></span>
          {c?.ending && <span className="tag red">{c.ending.kind === "fired" ? "已下课" : c.ending.kind === "retired" ? "已退休" : "名人堂收官"}</span>}
        </div>
        {c && c.seasons < 10 && !c.ending && (
          <div className="muted small" style={{ marginTop: 6 }}>
            五年之约（第 5 赛季）与第 10 年强制退休在翻年时结算——名人堂席位按冠军数与胜率评定。
          </div>
        )}
      </div>

      {inJobWindow && !c?.ending && offers.length > 0 && (
        <div className="card">
          <h3>🤝 教练市场（休赛期跳槽）</h3>
          <div className="muted small" style={{ margin: "4px 0 8px" }}>
            成功率 = 声望差 + 荣誉 + 门下弟子背书 + 谈判技能；被拒声望 -1，成功即切换俱乐部（董事会信任重置 60）。
          </div>
          <table>
            <thead>
              <tr><th style={{ textAlign: "left" }}>俱乐部</th><th>赛区声望</th><th>阵容均分</th><th></th></tr>
            </thead>
            <tbody>
              {offers.map((t) => {
                const avg = Math.round(t.roster.reduce((s, pid) => s + (state.players[pid]?.overall ?? 0), 0) / Math.max(1, t.roster.length));
                return (
                  <tr key={t.id}>
                    <td><span className="row" style={{ alignItems: "center", gap: 6 }}><TeamLogo team={t} size={20} /><b>{t.name}</b></span></td>
                    <td>{Math.round(t.reputation)}</td>
                    <td>{avg}</td>
                    <td>
                      <button className="ghost small" disabled={busy || state.actionPoints < 1} onClick={() => void applyJob(t.id)}>
                        申请执教（1 行动力）
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <h3>🏛 选手名人堂（退役留档）</h3>
        {retirees.length === 0 ? (
          <div className="muted small">尚无选手退役——留档将随赛季退役检定积累。</div>
        ) : (
          <table>
            <thead>
              <tr><th style={{ textAlign: "left" }}>选手</th><th>退役年份</th><th>年龄</th><th>巅峰能力</th><th>冠军</th><th style={{ textAlign: "left" }}>去向</th></tr>
            </thead>
            <tbody>
              {retirees.map((r, i) => (
                <tr key={`${r.ign}-${i}`}>
                  <td><b>{r.ign}</b>{r.teamName ? <span className="muted small">（{r.teamName}）</span> : null}</td>
                  <td>{r.year}</td>
                  <td>{r.age}</td>
                  <td>{r.overall}</td>
                  <td>{r.titles}</td>
                  <td className="muted">{r.path === "coach" ? "转入教练席" : r.path === "media" ? "解说/主播" : r.path === "mentor" ? "留队导师" : "淡出赛场"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {draftPicks.length > 0 && (
        <div className="card">
          <h3>🎯 {state.lastDraft!.year} 选秀留档</h3>
          <div className="row small" style={{ flexWrap: "wrap", gap: 10 }}>
            {draftPicks.slice(0, 16).map((p) => (
              <span key={p.pickNo} className="tag">
                #{p.pickNo} {state.teams[p.teamId]?.tag ?? "?"} → {state.players[p.playerId]?.ign ?? "?"}（{state.players[p.playerId]?.potential ?? "?"} 潜力）
              </span>
            ))}
          </div>
        </div>
      )}

      {coaches.length > 0 && (
        <div className="card">
          <h3>🧠 教练自由池（退役名宿执教会在此流动）</h3>
          <div className="row small" style={{ flexWrap: "wrap", gap: 10 }}>
            {coaches.slice(0, 12).map((k, i) => (
              <span key={`${k.name}-${i}`} className="tag">
                {k.name} · 综合值 {k.value} · {k.titles} 冠
              </span>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
