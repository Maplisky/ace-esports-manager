/**
 * 选手详情页（Dossier，参照原作）：头像/真名/国籍/合同 | 八维条 | 英雄池+熟练度+英雄头像
 * +（真实选手）逐英雄生涯评分 | 生涯累计 | 交易参考。全 UI 只读，数据均在 state。
 */
import type { GameState, Player } from "../../core/types.ts";
import { AGENT_BY_ID } from "../../core/data/agents.ts";
import { marketValue, salaryExpectation } from "../../core/sim/transfer.ts";
import { PlayerFace, AgentIcon, SyntheticBadge } from "./Avatar.tsx";
import { REAL_PLAYERS_BY_VLR } from "../../core/data/real/real-data.ts";

const ATTR_CN: Record<string, string> = {
  aim: "枪法", reaction: "反应", awareness: "意识", utility: "道具",
  clutch: "残局", teamwork: "协同", communication: "沟通", igl: "指挥",
};

const fmtK = (v: number) => (Math.abs(v) >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M` : Math.abs(v) >= 1000 ? `$${Math.round(v / 1000)}K` : `$${v}`);

export function PlayerDossier(props: { state: GameState; player: Player; onClose: () => void }) {
  const { state, player: p, onClose } = props;
  const team = p.teamId ? state.teams[p.teamId] : null;
  // 真实选手：拉 vlr 逐英雄生涯统计（英雄池行内展示 rating/ACS）
  const vlrP = p.id.startsWith("R") ? REAL_PLAYERS_BY_VLR.get(Number(p.id.slice(1))) : undefined;
  const statOf = (agentId: string) => vlrP?.stats.find((s) => s.agent === agentId);
  const career = p.career;
  const kd = career.deaths > 0 ? (career.kills / career.deaths).toFixed(2) : "—";

  const attrRows = (Object.keys(ATTR_CN) as (keyof typeof ATTR_CN)[]).map((k) => ({
    label: ATTR_CN[k]!,
    v: p.attrs[k as keyof typeof p.attrs],
  }));

  return (
    <div className="viewer-backdrop" onClick={onClose}>
      <div className="viewer" style={{ width: "min(760px, 94vw)", maxHeight: "88vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div className="scorebug">
          <div className="team row" style={{ color: "var(--accent)", gap: 10, alignItems: "center" }}>
            <PlayerFace p={p} size={44} />
            <span>
              <b style={{ fontSize: 18 }}>{p.ign}</b>
              <SyntheticBadge p={p} />
              {p.isIgl && <span className="tag" style={{ marginLeft: 6 }}>指挥</span>}
              <div className="muted small">{p.realName ?? "—"}{p.country ? ` · ${p.country.toUpperCase()}` : ""}</div>
            </span>
          </div>
          <div className="mid">
            <div className="muted small">{team?.name ?? "自由市场"}</div>
            <div style={{ fontSize: 22, fontWeight: 800 }}>{p.overall} <span className="muted small" style={{ fontWeight: 400 }}>整体 / 潜力 {p.potential}</span></div>
          </div>
          <div className="team right small" style={{ textAlign: "right", lineHeight: 1.7 }}>
            <div>{p.age} 岁 · 合同 {p.contractYears} 年</div>
            <div>年薪 {fmtK(p.salary)}</div>
            <div className="muted">身价 {fmtK(marketValue(p, team?.tier ?? 1))}</div>
          </div>
        </div>

        <div className="card" style={{ padding: "12px 16px", marginBottom: 10 }}>
          <h3>📊 八维能力</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 24px" }}>
            {attrRows.map((a) => (
              <span key={a.label} className="row" style={{ gap: 8, alignItems: "center" }}>
                <span className="muted small" style={{ width: 34 }}>{a.label}</span>
                <span className="bar-track" style={{ flex: 1 }}>
                  <span
                    className="bar-fill"
                    style={{
                      width: `${a.v}%`,
                      background: a.v >= 85 ? "var(--green)" : a.v >= 65 ? "var(--accent)" : a.v >= 45 ? "var(--orange)" : "#a33",
                    }}
                  />
                </span>
                <b className="small" style={{ width: 26, textAlign: "right" }}>{Math.round(a.v)}</b>
              </span>
            ))}
          </div>
          <div className="muted small" style={{ marginTop: 8 }}>
            状态：竞技 {Math.round(p.form)} · 士气 {Math.round(p.morale)} · 体能 {Math.round(p.fatigue)}{p.injuredUntilDay > state.day ? ` · 🤕 伤停至第 ${p.injuredUntilDay} 天` : ""}
          </div>
        </div>

        <div className="card" style={{ padding: "12px 16px", marginBottom: 10 }}>
          <h3>🎭 英雄池（熟练度 · {vlrP ? "含 vlr.gg 生涯评分" : "虚拟选手"}）</h3>
          <div className="row" style={{ flexWrap: "wrap", gap: 10 }}>
            {p.agentPool.map((aid) => {
              const a = AGENT_BY_ID.get(aid);
              const st = statOf(aid);
              const pro = p.agentPro[aid] ?? 0;
              return (
                <span key={aid} className="row" style={{ gap: 8, alignItems: "center", background: "rgba(255,255,255,0.03)", borderRadius: 8, padding: "6px 10px" }}>
                  <AgentIcon agentId={aid} size={34} name={a?.name} />
                  <span className="small" style={{ display: "inline-flex", flexDirection: "column", lineHeight: 1.4 }}>
                    <b>{a?.name ?? aid}</b>
                    <span className={pro >= 80 ? "tag green" : pro >= 55 ? "muted" : "tag orange"} style={{ fontSize: 10 }}>熟练 {Math.round(pro * 10) / 10}%</span>
                    {st && <span className="muted" style={{ fontSize: 10 }}>vlr {st.rating.toFixed(2)} · ACS {Math.round(st.acs)} · {st.maps} 图</span>}
                  </span>
                </span>
              );
            })}
          </div>
          {vlrP && <div className="muted small" style={{ marginTop: 6 }}>评分来自 vlr.gg 生涯逐英雄统计（rounds 加权口径见 README）。</div>}
        </div>

        <div className="card" style={{ padding: "12px 16px", marginBottom: 10 }}>
          <h3>🏆 生涯累计（本存档）</h3>
          <div className="small" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
            <span>地图 <b>{career.maps}</b></span>
            <span>回合 <b>{career.rounds}</b></span>
            <span>K/D <b>{career.kills}/{career.deaths}（{kd}）</b></span>
            <span>助攻 <b>{career.assists}</b></span>
            <span>首杀 <b>{career.firstKills}</b></span>
            <span>残局 <b>{career.clutches}</b></span>
            <span>MVP <b>{career.mvps}</b></span>
            <span>冠军 <b>{career.titles}</b></span>
          </div>
          {career.clubs.length > 0 && (
            <div className="muted small" style={{ marginTop: 6 }}>
              曾效力：{career.clubs.map((c) => state.teams[c]?.name ?? c).join(" → ") || "—"}
            </div>
          )}
        </div>

        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="muted small">承诺角色：{p.promisedRole === "core" ? "核心" : p.promisedRole === "starter" ? "首发" : p.promisedRole === "rotation" ? "轮换" : "替补"} · 周薪期望参考 {fmtK(salaryExpectation(p, team?.tier ?? 1) / 48)}</span>
          <button className="primary" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}
