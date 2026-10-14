/**
 * 转会页（GDD §8.2 v1.1）：待答复挖角 · 我的名单（挂牌/解约）· 自由市场报价（即时谈判）· 动态 Feed
 */
import { useState } from "react";
import type { GameState, Player } from "../../core/types.ts";
import { AGENTS } from "../../core/data/agents.ts";
import { marketValue, salaryExpectation, inTransferWindow } from "../../core/sim/transfer.ts";
import { useStore } from "../store.ts";
import { PlayerFace, SyntheticBadge } from "./Avatar.tsx";
import { dutyTendencyOf, DUTY_ORDER } from "./AgentSelect.tsx";
import { PlayerDossier } from "./PlayerDossier.tsx";

const ROLE_CN: Record<string, string> = { core: "核心", starter: "首发", rotation: "轮换", bench: "替补" };
const DUTY_LABEL: Record<string, string> = { duelist: "决斗者", initiator: "先锋", controller: "控场", sentinel: "哨卫" };
const fmt = (v: number) => (v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M` : `$${Math.round(v / 1000)}K`);

export function TransferPage(props: { state: GameState }) {
  const { state } = props;
  const { respondBid, listToggle, releasePlayer, startNegotiation, askInquiry } = useStore();
  const [dossier, setDossier] = useState<string | null>(null);
  const myId = state.myTeamId ?? "";
  const team = state.teams[myId];
  const [negPlayer, setNegPlayer] = useState<Player | null>(null);
  const [releaseTarget, setReleaseTarget] = useState<string | null>(null);
  const [dutySet, setDutySet] = useState<Set<string>>(new Set()); // 位置多选（按主职业）
  const [agentSet, setAgentSet] = useState<Set<string>>(new Set()); // 英雄多选（池含任一）
  const [iglFilter, setIglFilter] = useState(""); // ""不限 / main / vice / none
  const [hideSynthetic, setHideSynthetic] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [inquiryTeamId, setInquiryTeamId] = useState(""); // 有主问价：目标队伍
  const [minOvr, setMinOvr] = useState("");
  const [minPot, setMinPot] = useState("");
  const [ageMax, setAgeMax] = useState("");
  const [minValue, setMinValue] = useState("");
  const [sortBy, setSortBy] = useState("value");
  if (!team) return null;

  const inWindow = inTransferWindow(state.day);
  const grace = !inWindow ? "关窗宽限：只能完成在谈交易" : null;
  const allFreeAgents = Object.values(state.players).filter((p) => !p.teamId && p.injuredUntilDay <= state.day);
  // 身价预计算（排序比较器热路径避免 O(N log N) 次完整估值公式重算；必须先于消费它的派生）
  const valueOf = new Map(allFreeAgents.map((p) => [p.id, marketValue(p, team.tier)]));
  // 筛选 + 排序（用户需求：按位置/英雄/能力/潜力/年龄/身价）
  const freeAgents = allFreeAgents
    .filter((p) => {
      if (dutySet.size > 0 && !dutySet.has(dutyTendencyOf(p).mainKey)) return false;
      if (agentSet.size > 0 && !p.agentPool.some((a) => agentSet.has(a))) return false;
      if (iglFilter === "main" && !p.isIgl) return false;
      if (iglFilter === "vice" && !(p.isIgl || p.viceIgl)) return false;
      if (iglFilter === "none" && (p.isIgl || p.viceIgl)) return false;
      if (hideSynthetic && p.synthetic) return false;
      if (minOvr && p.overall < Number(minOvr)) return false;
      if (minPot && p.potential < Number(minPot)) return false;
      if (ageMax && p.age > Number(ageMax)) return false;
      if (minValue && valueOf.get(p.id)! < Number(minValue) * 1000) return false;
      return true;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case "ovr": return b.overall - a.overall;
        case "pot": return b.potential - a.potential;
        case "ageAsc": return a.age - b.age;
        case "ageDesc": return b.age - a.age;
        case "valueAsc": return valueOf.get(a.id)! - valueOf.get(b.id)!;
        default: return valueOf.get(b.id)! - valueOf.get(a.id)!;
      }
    });
  const activeFilterCount =
    dutySet.size + agentSet.size + (iglFilter ? 1 : 0) + (hideSynthetic ? 1 : 0) +
    (minOvr ? 1 : 0) + (minPot ? 1 : 0) + (ageMax ? 1 : 0) + (minValue ? 1 : 0);
  const pendingInquiryCount = state.inquiries.filter((q) => !q.done).length;
  const feed = state.transferFeed.slice(-12).reverse();

  return (
    <div>
      {/* 问价结果（原作式：置顶显示，从结果报价） */}
      {(state.inquiries.length > 0 || pendingInquiryCount > 0) && (
        <div className="card">
          <h3>📋 问价结果（{state.inquiries.filter((q) => q.done).length} 人可以报价 · {pendingInquiryCount} 人问价中）</h3>
          {state.inquiries.slice().reverse().map((q) => {
            const p = state.players[q.playerId];
            if (!p) return null;
            return (
              <div key={q.id} className="row" style={{ padding: "8px 0", borderBottom: "1px dashed var(--line)", flexWrap: "wrap", alignItems: "center" }}>
                <span className="row" style={{ alignItems: "center", gap: 6, width: 130 }}><PlayerFace p={p} size={24} showTag={false} /><b>{p.ign}</b><SyntheticBadge p={p} /></span>
                {!q.done ? (
                  <span className="muted small">问价中（约第 {q.resolveDay} 天答复）</span>
                ) : (
                  <>
                    <span className="small" style={{ width: 300 }}>
                      {state.teams[p.teamId as string]?.name ?? "自由市场"} 开价约 <b>{fmt(q.askingFee)}</b> · {q.intent}
                    </span>
                    <span className="grow" />
                    <button
                      className="small primary"
                      disabled={!inWindow || state.actionPoints < 1 || team.roster.length >= 7}
                      onClick={() => setNegPlayer(p)}
                    >
                      从结果报价
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 待答复挖角 */}
      {state.incomingBids.length > 0 && (
        <div className="card">
          <h3>💼 待答复报价（7 天内答复，逾期视为拒绝）</h3>
          {state.incomingBids.map((b) => {
            const p = state.players[b.playerId];
            if (!p) return null;
            return (
              <div key={b.id} className="row" style={{ padding: "8px 0", borderBottom: "1px dashed var(--line)", flexWrap: "wrap" }}>
                <span className="row" style={{ alignItems: "center", gap: 6, width: 110 }}><PlayerFace p={p} size={24} /><b>{p.ign}</b><SyntheticBadge p={p} /></span>
                <span className="muted small" style={{ width: 220 }}>
                  {state.teams[b.fromTeam as string]?.name} · {fmt(b.fee)} · 年薪 {fmt(b.salary)}×{b.years}年
                </span>
                <span className="grow" />
                <button className="primary small" onClick={() => void respondBid(b.id, true)}>接受</button>
                <button className="small" onClick={() => void respondBid(b.id, false)}>拒绝（士气 -4）</button>
              </div>
            );
          })}
        </div>
      )}

      {/* 我的名单 */}
      <div className="card">
        <h3>👥 我的名单 · 挂牌与解约
          <span className={`tag${inWindow ? " green" : " red"}`} style={{ marginLeft: 10 }}>{inWindow ? "转会窗开启" : grace ?? "窗口已关"}</span>
        </h3>
        <table>
          <thead>
            <tr><th>选手</th><th>能力</th><th>身价</th><th>年薪</th><th>合同</th><th>状态</th><th>操作</th></tr>
          </thead>
          <tbody>
            {team.roster.map((pid) => {
              const p = state.players[pid]!;
              const value = marketValue(p, team.tier);
              return (
                <tr key={pid}>
                  <td>
                    <span className="row" style={{ alignItems: "center", gap: 6 }}><PlayerFace p={p} size={20} /><span style={{ cursor: "pointer", textDecoration: "underline dotted" }} onClick={() => setDossier(p.id)}>{p.ign}</span></span>
                    {p.listed && <span className="tag orange" style={{ marginLeft: 6 }}>挂牌</span>}
                    {p.noPoach && <span className="tag" style={{ marginLeft: 6 }}>保护</span>}
                  </td>
                  <td><b>{p.overall}</b></td>
                  <td className="muted">{fmt(value)}</td>
                  <td className="muted">{fmt(p.salary)}</td>
                  <td className="muted">{p.contractYears} 年</td>
                  <td>{p.benchedWeeks > 0 ? <span className="tag orange">板凳 {p.benchedWeeks} 周</span> : <span className="tag green">在阵</span>}</td>
                  <td>
                    <button className="small" onClick={() => void listToggle(pid, !p.listed)}>
                      {p.listed ? "取消挂牌" : "挂牌"}
                    </button>
                    {releaseTarget === pid ? (
                      <span className="row" style={{ marginLeft: 6 }}>
                        <button className="small" style={{ color: "var(--accent)" }} onClick={() => { void releasePlayer(pid); setReleaseTarget(null); }}>
                          确认赔付
                        </button>
                        <button className="ghost small" onClick={() => setReleaseTarget(null)}>取消</button>
                      </span>
                    ) : (
                      <button className="ghost small" style={{ marginLeft: 6 }} onClick={() => setReleaseTarget(pid)}>
                        解约
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="muted small" style={{ marginTop: 8 }}>
          解约赔付剩余合同 40% · 挂牌身价 ×0.75 但更容易收到报价 · 长期坐板凳的选手会被人盯上
        </div>
      </div>

      {/* 自由市场 */}
      <div className="card">
        <h3>
          🛒 自由市场（{freeAgents.length}/{allFreeAgents.length} 人 · 报价花 1 行动力 · 问价免费）
          <button className="small" style={{ marginLeft: 12 }} onClick={() => setShowFilters(!showFilters)}>
            ⚙ 筛选器{activeFilterCount > 0 && <span className="tag" style={{ marginLeft: 6 }}>{activeFilterCount} 项生效</span>}
          </button>
        </h3>
        {showFilters && (
          <div className="card" style={{ padding: "10px 14px", marginBottom: 10, background: "rgba(255,255,255,0.03)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 }}>
              <div>
                <div className="muted small" style={{ marginBottom: 4, fontWeight: 700 }}>位置（可多选，按主职业）</div>
                {DUTY_ORDER.map((d) => (
                  <label key={d.key} className="small" style={{ display: "block", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={dutySet.has(d.key)}
                      onChange={(e) => {
                        const n = new Set(dutySet);
                        if (e.target.checked) n.add(d.key);
                        else n.delete(d.key);
                        setDutySet(n);
                      }}
                    />{" "}
                    {d.label}
                  </label>
                ))}
              </div>
              <div>
                <div className="muted small" style={{ marginBottom: 4, fontWeight: 700 }}>指挥身份</div>
                {[["", "不限"], ["main", "仅主指挥"], ["vice", "主/副指挥"], ["none", "无指挥身份"]].map(([v, l]) => (
                  <label key={v} className="small" style={{ display: "block", cursor: "pointer" }}>
                    <input type="radio" name="iglFilter" checked={iglFilter === v} onChange={() => setIglFilter(v)} /> {l}
                  </label>
                ))}
              </div>
              <div>
                <div className="muted small" style={{ marginBottom: 4, fontWeight: 700 }}>范围</div>
                <div className="small" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  <span>能力≥ <input type="number" value={minOvr} onChange={(e) => setMinOvr(e.target.value)} style={{ width: 52 }} /></span>
                  <span>潜力≥ <input type="number" value={minPot} onChange={(e) => setMinPot(e.target.value)} style={{ width: 52 }} /></span>
                  <span>年龄≤ <input type="number" value={ageMax} onChange={(e) => setAgeMax(e.target.value)} style={{ width: 48 }} /></span>
                  <span>身价≥ <input type="number" value={minValue} onChange={(e) => setMinValue(e.target.value)} style={{ width: 64 }} />K$</span>
                </div>
                <label className="small" style={{ display: "block", marginTop: 6, cursor: "pointer" }}>
                  <input type="checkbox" checked={hideSynthetic} onChange={(e) => setHideSynthetic(e.target.checked)} /> 隐藏虚构选手（只看 vlr 真实数据）
                </label>
              </div>
              <div>
                <div className="muted small" style={{ marginBottom: 4, fontWeight: 700 }}>英雄池含（可多选）</div>
                <div style={{ maxHeight: 132, overflowY: "auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
                  {AGENTS.map((a) => (
                    <label key={a.id} className="small" style={{ cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={agentSet.has(a.id)}
                        onChange={(e) => {
                          const n = new Set(agentSet);
                          if (e.target.checked) n.add(a.id);
                          else n.delete(a.id);
                          setAgentSet(n);
                        }}
                      />{" "}
                      {a.name}
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="row" style={{ justifyContent: "flex-end", marginTop: 8 }}>
              <button
                className="small"
                onClick={() => { setDutySet(new Set()); setAgentSet(new Set()); setIglFilter(""); setMinOvr(""); setMinPot(""); setAgeMax(""); setMinValue(""); setHideSynthetic(false); }}
              >
                清空筛选
              </button>
            </div>
          </div>
        )}
        {/* 快捷排序（常驻） */}
        <div className="row" style={{ gap: 10, marginBottom: 10, alignItems: "center" }}>
          <span className="row" style={{ gap: 4, alignItems: "center" }}>
            <span className="muted small">排序</span>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="value">身价 高→低</option>
              <option value="valueAsc">身价 低→高</option>
              <option value="ovr">能力 高→低</option>
              <option value="pot">潜力 高→低</option>
              <option value="ageAsc">年龄 低→高</option>
              <option value="ageDesc">年龄 高→低</option>
            </select>
          </span>
        </div>
        <table>
          <thead>
            <tr><th>选手</th><th>位置倾向</th><th>能力</th><th>潜力</th><th>年龄</th><th>身价参考</th><th></th></tr>
          </thead>
          <tbody>
            {freeAgents.map((p) => {
              const tendency = dutyTendencyOf(p);
              const exp = salaryExpectation(p, team.tier);
              // 问价反馈（免费、确定性）：按市场公允条款评估意愿
              return (
              <>
              <tr key={p.id}>
                <td><span className="row" style={{ alignItems: "center", gap: 6 }}><PlayerFace p={p} size={22} showTag={false} /><span style={{ cursor: "pointer", textDecoration: "underline dotted" }} onClick={() => setDossier(p.id)}>{p.ign}</span><SyntheticBadge p={p} /></span></td>
                <td className="small" style={{ whiteSpace: "nowrap" }}>
                  <span className="tag">{tendency.main}</span>
                  {tendency.second && <span className="muted small" style={{ marginLeft: 4 }}>{tendency.second}</span>}
                  {p.isIgl && <span className="tag" style={{ marginLeft: 4 }}>指挥</span>}
                  {p.viceIgl && <span className="muted small" style={{ marginLeft: 4 }}>副指挥</span>}
                </td>
                <td><b>{p.overall}</b></td>
                <td className="muted">{p.potential}</td>
                <td className="muted">{p.age}</td>
                <td className="muted">{fmt(valueOf.get(p.id) ?? 0)}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <button
                    className="small"
                    disabled={!inWindow || state.actionPoints < 1 || !!state.inquiries.some((q) => q.playerId === p.id && !q.done)}
                    onClick={() => void askInquiry(p.id)}
                    title="花 1 行动力不花钱，2-5 天后给出要价与本人意向"
                  >
                    {state.inquiries.some((q) => q.playerId === p.id && !q.done) ? "问价中" : "问价"}
                  </button>
                  <button
                    className="small primary"
                    style={{ marginLeft: 6 }}
                    disabled={!inWindow || state.actionPoints < 1 || team.roster.length >= 7}
                    onClick={() => setNegPlayer(p)}
                  >
                    报价
                  </button>
                </td>
              </tr>
              </>
              );
            })}
          </tbody>
        </table>
        {!inWindow && <div className="muted small" style={{ marginTop: 6 }}>转会窗已关闭，等下一个窗口（季前 / 夏季窗口 / 休赛期）。</div>}
      </div>

      {/* 问价 · 找有主球员（原作式：选队伍 → 对其 roster 问价，2-5 天反馈要价+意向；解约金/noPoach 信息见反馈） */}
      <div className="card">
        <h3>🎯 问价 · 找有主球员</h3>
        <div className="row" style={{ gap: 10, alignItems: "center", marginBottom: 10 }}>
          <span className="muted small">选择俱乐部</span>
          <select value={inquiryTeamId} onChange={(e) => setInquiryTeamId(e.target.value)}>
            <option value="">（选择队伍）</option>
            {Object.values(state.teams)
              .filter((t) => t.id !== myId)
              .sort((a, b) => b.reputation - a.reputation)
              .map((t) => (
                <option key={t.id} value={t.id}>{t.name}（{t.regionId} · {t.tier === 1 ? "VCT" : "挑战者"}）</option>
              ))}
          </select>
          <span className="muted small">问价花 1 行动力不花钱，2-5 天后给出要价与本人意向。</span>
        </div>
        {inquiryTeamId && state.teams[inquiryTeamId] && (
          <table>
            <thead>
              <tr><th>选手</th><th>位置倾向</th><th>能力</th><th>身价参考</th><th>解约金</th><th></th></tr>
            </thead>
            <tbody>
              {state.teams[inquiryTeamId]!.roster.map((pid) => {
                const p = state.players[pid]!;
                const tendency = dutyTendencyOf(p);
                const inquiryQ = state.inquiries.find((q) => q.playerId === pid && !q.done);
                const inquiryDone = state.inquiries.filter((q) => q.playerId === pid && q.done).slice(-1)[0];
                return (
                  <tr key={pid}>
                    <td>
                      <span className="row" style={{ alignItems: "center", gap: 6 }}>
                        <PlayerFace p={p} size={22} showTag={false} />
                        <span style={{ cursor: "pointer", textDecoration: "underline dotted" }} onClick={() => setDossier(p.id)}>{p.ign}</span>
                        {p.isIgl && <span className="tag" style={{ marginLeft: 4 }}>主指挥</span>}
                        {p.viceIgl && <span className="muted small" style={{ marginLeft: 4 }}>副指挥</span>}
                        {p.listed && <span className="tag orange" style={{ marginLeft: 4 }}>挂牌中</span>}
                        {p.noPoach && <span className="tag red" style={{ marginLeft: 4 }}>noPoach</span>}
                      </span>
                    </td>
                    <td className="small" style={{ whiteSpace: "nowrap" }}>
                      <span className="tag">{tendency.main}</span>
                      {tendency.second && <span className="muted small" style={{ marginLeft: 4 }}>{tendency.second}</span>}
                    </td>
                    <td><b>{p.overall}</b></td>
                    <td className="muted">{fmt(valueOf.get(pid) ?? marketValue(p, team.tier))}</td>
                    <td className="muted small">{p.releaseClause > 0 ? fmt(p.releaseClause) : "—"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button
                        className="small"
                        disabled={!inWindow || state.actionPoints < 1 || !!inquiryQ}
                        onClick={() => void askInquiry(pid)}
                      >
                        {inquiryQ ? "问价中" : "问价"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3>📰 转会动态</h3>
        {feed.length === 0 && <div className="muted small">还没有动态。</div>}
        {feed.map((n, i) => (
          <div key={i} className="news-item">
            <span className="muted small">[{n.kind === "done" ? "成交" : n.kind === "bid" ? "报价" : n.kind === "list" ? "挂牌" : "解约"}] </span>
            {n.text}
          </div>
        ))}
      </div>

      {negPlayer && (
        <NegotiationModal
          state={state}
          player={negPlayer}
          onClose={() => setNegPlayer(null)}
          onDone={() => setNegPlayer(null)}
        />
      )}
      {dossier && state.players[dossier] && (
        <PlayerDossier state={state} player={state.players[dossier]!} onClose={() => setDossier(null)} />
      )}
    </div>
  );
}

/** 即时谈判弹窗（GDD §8.2 v1.1：1-3 轮 + 态度条 + 最短板反馈） */
function NegotiationModal(props: { state: GameState; player: Player; onClose: () => void; onDone: () => void }) {
  const { state, player, onClose, onDone } = props;
  const { startNegotiation, reNegotiate, finalizeNegotiation } = useStore();
  const myTeam = state.teams[state.myTeamId ?? ""]!;
  const exp = salaryExpectation(player, myTeam.tier);
  const [fee, setFee] = useState(() => Math.round(marketValue(player, myTeam.tier) / 1000) * 1000);
  const [salary, setSalary] = useState(() => Math.round(exp / 1000) * 1000);
  const [years, setYears] = useState(2);
  const [bonus, setBonus] = useState(0);
  const [role, setRole] = useState<Player["promisedRole"]>("starter");
  const neg = useStore((s) => s.negotiation);

  const terms = () => ({ fee, salary, years, signingBonus: bonus, promisedRole: role });
  const budgetLeft = myTeam.budget - fee - bonus;

  if (neg?.result) {
    return (
      <div className="viewer-backdrop">
        <div className="viewer" style={{ textAlign: "center", padding: 30 }}>
          <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 10 }}>
            {neg.accepted ? "✅ 签约成功" : "❌ 谈判破裂"}
          </div>
          <div className="muted">{neg.result}</div>
          <button className="primary" style={{ marginTop: 16 }} onClick={() => { onClose(); onDone(); }}>
            知道了
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="viewer-backdrop">
      <div className="viewer" style={{ width: "min(680px, 94vw)" }}>
        <div className="scorebug">
          <div className="team" style={{ color: "var(--accent)" }}>报价 {player.ign}</div>
          <div className="mid">
            <div className="muted small">身价参考 {fmt(marketValue(player, myTeam.tier))} · 薪资期望 ~{fmt(exp)}</div>
          </div>
          <div className="team right">{myTeam.tag}</div>
        </div>

        {neg && (
          <div className="card" style={{ padding: "10px 14px" }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span>谈判第 {neg.offer.round} 轮</span>
              <span className="row" style={{ gap: 8 }}>
                <span className="muted small">态度</span>
                <span className="bar-track" style={{ width: 120 }}>
                  <span
                    className="bar-fill"
                    style={{ width: `${neg.attitude}%`, background: neg.attitude >= 60 ? "var(--green)" : neg.attitude >= 35 ? "var(--orange)" : "var(--accent)" }}
                  />
                </span>
                <b>{neg.attitude}%</b>
              </span>
            </div>
            <div className="small" style={{ marginTop: 6 }}>
              {neg.insulting ? `💢 ${neg.demand}` : `🗣 ${neg.demand}`}
            </div>
          </div>
        )}

        <table>
          <tbody>
            <tr><td>转会费</td><td><input type="number" value={fee} step={10000} onChange={(e) => setFee(Number(e.target.value) || 0)} style={{ width: 130 }} /></td><td className="muted small">预算余额 {fmt(budgetLeft)}</td></tr>
            <tr><td>年薪</td><td><input type="number" value={salary} step={5000} onChange={(e) => setSalary(Number(e.target.value) || 0)} style={{ width: 130 }} /></td><td className="muted small">期望 ~{fmt(exp)}/年（低于 70% 视为侮辱）</td></tr>
            <tr><td>合同年限</td><td>
              <select value={years} onChange={(e) => setYears(Number(e.target.value))}>
                {[1, 2, 3, 4].map((y) => <option key={y} value={y}>{y} 年</option>)}
              </select>
            </td><td className="muted small">≥3 年对老将有吸引力</td></tr>
            <tr><td>签字费</td><td><input type="number" value={bonus} step={10000} onChange={(e) => setBonus(Number(e.target.value) || 0)} style={{ width: 130 }} /></td><td className="muted small">即时支付，大幅提升态度</td></tr>
            <tr><td>角色承诺</td><td>
              <select value={role} onChange={(e) => setRole(e.target.value as Player["promisedRole"])}>
                {Object.entries(ROLE_CN).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </td><td className="muted small">承诺未兑现会积累不满（GDD §6.4）</td></tr>
          </tbody>
        </table>

        <div className="row" style={{ justifyContent: "space-between", marginTop: 10 }}>
          <button className="ghost" onClick={onClose}>放弃</button>
          <span className="row">
            {neg && neg.offer.round > 0 && !neg.insulting && (
              <button onClick={() => void reNegotiate(terms())}>调整后重新报价（第 {Math.min(3, neg.offer.round + 1)} 轮）</button>
            )}
            {neg && neg.offer.round > 0 ? (
              <button className="primary" onClick={() => void finalizeNegotiation()}>最终检定</button>
            ) : (
              <button className="primary" onClick={() => void startNegotiation(player.id, terms())}>提出报价</button>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
