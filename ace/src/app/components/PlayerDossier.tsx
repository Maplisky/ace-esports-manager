/**
 * 选手详情页（Dossier，参照原作）：
 * 渐变头卡（头像/真名/国籍/合同/身价）| 八维条（六档色阶）| 英雄池（位置分组·纯熟练度）
 * | 生涯累计 | 交易参考。ACS/生涯图数等 vlr 原始数据不展示——vlr 数据只用于初始熟练度计算与排序。
 */
import type { GameState, Player } from "../../core/types.ts";
import { AGENT_BY_ID } from "../../core/data/agents.ts";
import { marketValue, salaryExpectation } from "../../core/sim/transfer.ts";
import { PlayerFace, SyntheticBadge } from "./Avatar.tsx";
import { buildAgentGroups, DUTY_ORDER } from "./AgentSelect.tsx";

const ATTR_CN: Record<string, string> = {
  aim: "枪法", reaction: "反应", awareness: "意识", utility: "道具",
  clutch: "残局", teamwork: "协同", communication: "沟通", igl: "指挥",
};

/** 八维六档色阶（90+ 顶级绿 → <50 暗红） */
function attrColor(v: number): string {
  if (v >= 90) return "#16a34a";
  if (v >= 80) return "#4ade80";
  if (v >= 70) return "#60a5fa";
  if (v >= 60) return "#fbbf24";
  if (v >= 50) return "#fb923c";
  return "#f87171";
}

const fmtK = (v: number) => (Math.abs(v) >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M` : Math.abs(v) >= 1000 ? `$${Math.round(v / 1000)}K` : `$${v}`);

export function PlayerDossier(props: { state: GameState; player: Player; onClose: () => void }) {
  const { state, player: p, onClose } = props;
  const team = p.teamId ? state.teams[p.teamId] : null;
  const career = p.career;
  const kd = career.deaths > 0 ? (career.kills / career.deaths).toFixed(2) : "—";

  const attrRows = (Object.keys(ATTR_CN) as (keyof typeof ATTR_CN)[]).map((k) => ({
    label: ATTR_CN[k]!,
    v: p.attrs[k as keyof typeof p.attrs],
  }));
  const groups = buildAgentGroups(p, "select");
  const groupLabel = (key: string) => DUTY_ORDER.find((d) => d.key === key)?.label ?? key;

  return (
    <div className="viewer-backdrop" onClick={onClose}>
      <div className="viewer" style={{ width: "min(760px, 94vw)", maxHeight: "88vh", overflowY: "auto", padding: 0 }}>
        {/* 头卡：渐变底 */}
        <div
          style={{
            background: "linear-gradient(135deg, rgba(238,80,80,0.22) 0%, rgba(120,60,200,0.18) 60%, rgba(255,255,255,0.04) 100%)",
            borderRadius: "12px 12px 0 0",
            padding: "18px 20px 14px",
            borderBottom: "1px solid var(--line)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="row" style={{ gap: 14, alignItems: "center" }}>
            <span style={{ borderRadius: "50%", padding: 3, background: "linear-gradient(135deg, var(--accent), #a855f7)" }}>
              <PlayerFace p={p} size={64} showTag={false} />
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span className="row" style={{ gap: 8, alignItems: "center" }}>
                <b style={{ fontSize: 21 }}>{p.ign}</b>
                <SyntheticBadge p={p} />
                {p.isIgl && <span className="tag">指挥</span>}
              </span>
              <div className="muted small" style={{ marginTop: 2 }}>
                {p.realName ?? "—"}{p.country ? ` · ${p.country.toUpperCase()}` : ""} · {p.age} 岁 · {team?.name ?? "自由市场"}
              </div>
              <div className="row" style={{ gap: 6, marginTop: 6 }}>
                <span className="tag">合同 {p.contractYears} 年</span>
                <span className="tag">年薪 {fmtK(p.salary)}</span>
                <span className="tag">身价 {fmtK(marketValue(p, team?.tier ?? 1))}</span>
                <span className="tag green">潜力 {p.potential}</span>
              </div>
            </span>
            <span style={{ textAlign: "center" }}>
              <div style={{ fontSize: 34, fontWeight: 900, lineHeight: 1 }}>{p.overall}</div>
              <div className="muted small">整体</div>
            </span>
          </div>
        </div>

        <div style={{ padding: "12px 20px 16px" }} onClick={(e) => e.stopPropagation()}>
          {/* 八维：六档色阶 + 刻度背景 */}
          <h3 style={{ margin: "4px 0 8px" }}>📊 八维能力</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 26px" }}>
            {attrRows.map((a) => (
              <span key={a.label} className="row" style={{ gap: 8, alignItems: "center" }}>
                <span className="muted small" style={{ width: 34 }}>{a.label}</span>
                <span
                  className="bar-track"
                  style={{
                    flex: 1,
                    background:
                      "linear-gradient(90deg, rgba(248,113,113,0.12) 0 50%, rgba(251,191,36,0.10) 50% 70%, rgba(74,222,128,0.10) 70% 100%)",
                  }}
                >
                  <span className="bar-fill" style={{ width: `${a.v}%`, background: attrColor(a.v), borderRadius: 4 }} />
                </span>
                <b style={{ width: 26, textAlign: "right", color: attrColor(a.v) }}>{Math.round(a.v)}</b>
              </span>
            ))}
          </div>
          <div className="muted small" style={{ marginTop: 8 }}>
            状态：竞技 {Math.round(p.form)} · 士气 {Math.round(p.morale)} · 体能 {Math.round(p.fatigue)}
            {p.injuredUntilDay > state.day ? ` · 🤕 伤停至第 ${p.injuredUntilDay} 天` : ""}
            <span style={{ marginLeft: 10 }}>角色倾向：{p.promisedRole === "core" ? "核心" : p.promisedRole === "starter" ? "首发" : p.promisedRole === "rotation" ? "轮换" : "替补"}</span>
          </div>

          {/* 英雄池：按位置分组、纯熟练度（vlr 数据只体现在熟练度数值里） */}
          <h3 style={{ margin: "14px 0 8px" }}>🎭 英雄池（按场上位置 · 熟练度）</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10 }}>
            {groups.map((g) => (
              <div key={g.key}>
                <div className="muted small" style={{ marginBottom: 4, fontWeight: 700 }}>{groupLabel(g.key)}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {g.agents.map((a) => (
                    <span key={a.id} className="row" style={{ gap: 8, alignItems: "center", background: "rgba(255,255,255,0.03)", borderRadius: 8, padding: "5px 9px" }}>
                      <img
                        src={`assets/agents/${a.id}.png`}
                        alt={a.id}
                        width={28}
                        height={28}
                        style={{ borderRadius: "50%", objectFit: "cover", background: "#2a2a33" }}
                        onError={(e) => {
                          // 图标缺失回退：显示英文名首二字符（数据链上 id 与名称同源，不可能是他英雄的图）
                          (e.target as HTMLImageElement).style.display = "none";
                          (e.currentTarget.parentElement as HTMLElement).innerText = (AGENT_BY_ID.get(a.id)?.name ?? a.id).slice(0, 3);
                        }}
                      />
                      <span className="small" style={{ flex: 1 }}>{AGENT_BY_ID.get(a.id)?.name ?? a.id}</span>
                      <span className="bar-track" style={{ width: 56 }}>
                        <span className="bar-fill" style={{ width: `${a.pro}%`, background: a.pro >= 80 ? "var(--green)" : a.pro >= 55 ? "var(--accent)" : "var(--orange)" }} />
                      </span>
                      <b className="small" style={{ width: 34, textAlign: "right" }}>{Math.round(a.pro * 10) / 10}%</b>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* 生涯累计 */}
          <h3 style={{ margin: "14px 0 8px" }}>🏆 生涯累计（本存档）</h3>
          <div className="small" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
            <span>地图 <b>{career.maps}</b></span>
            <span>回合 <b>{career.rounds}</b></span>
            <span>K/D <b>{kd}</b></span>
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

          <div className="row" style={{ justifyContent: "space-between", marginTop: 12 }}>
            <span className="muted small">周薪期望参考 {fmtK(salaryExpectation(p, team?.tier ?? 1) / 48)}</span>
            <button className="primary" onClick={onClose}>关闭</button>
          </div>
        </div>
      </div>
    </div>
  );
}
