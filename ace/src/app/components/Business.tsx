/** 商务页（GDD §8.4 v0.5-4）：赞助栏位/意向 · 选手商务邀约 · 直播合同 */
import type { GameState } from "../../core/types.ts";
import { sponsorSignChance } from "../../core/sim/business.ts";
import { useStore } from "../store.ts";

const TIER_NAME: Record<number, string> = { 1: "地方品牌", 2: "国民品牌", 3: "国际品牌" };
const ROLE_CN: Record<string, string> = { core: "核心", starter: "首发", rotation: "轮换", bench: "替补" };
const fmt = (v: number) => (Math.abs(v) >= 1_000_000 ? `$${(v / 1_000_000).toFixed(2)}M` : `$${Math.round(v / 1000)}K`);

export function BusinessPage(props: { state: GameState }) {
  const { state } = props;
  const { signSponsor, cancelSponsor, acceptGig, declineGig, signStream, cancelStream } = useStore();
  const myId = state.myTeamId ?? "";
  const team = state.teams[myId];
  if (!team) return null;
  const rep = team.reputation;
  const slots = rep >= 60 ? 4 : rep >= 35 ? 3 : 2;
  const weeklyBiz = state.finances.log.filter((l) => l.label.includes("商务周收入")).slice(-1)[0]?.amount ?? 0;

  return (
    <div>
      {/* 赞助 */}
      <div className="card">
        <h3>💼 赞助（{team.sponsors.length}/{slots} 栏位 · 声望 {rep}）</h3>
        {team.sponsors.length === 0 && <div className="muted small">还没有赞助商。</div>}
        {team.sponsors.map((s) => (
          <div key={s.id} className="row" style={{ padding: "8px 0", borderBottom: "1px dashed var(--line)", flexWrap: "wrap" }}>
            <b style={{ width: 140 }}>{s.name}</b>
            <span className="tag red">{TIER_NAME[s.tier]}</span>
            <span className="muted small" style={{ width: 160 }}>{fmt(s.perSeason)}/赛季</span>
            <span className="muted small" style={{ width: 90 }}>{s.years} 年</span>
            <span className="muted small" style={{ width: 110 }}>{2026 + s.signedYear - state.year} 年后续约</span>
            <span className="grow" />
            <button className="small" onClick={() => void cancelSponsor(s.id)}>解约（声望 -2）</button>
          </div>
        ))}
        <div className="muted small" style={{ marginTop: 8 }}>
          周收入入账自动进行 · 档位门槛：国民品牌 声望45 · 国际品牌 声望60
        </div>
      </div>

      {/* 赞助意向 */}
      {state.sponsorOffers.length > 0 && (
        <div className="card">
          <h3>🤝 赞助意向（谈判花 1 行动力）</h3>
          {state.sponsorOffers.map((o) => {
            const chance = sponsorSignChance(state, o.tier);
            const pct = Math.round(chance * 100);
            return (
              <div key={o.id} className="row" style={{ padding: "8px 0", borderBottom: "1px dashed var(--line)", flexWrap: "wrap" }}>
                <b style={{ width: 140 }}>{o.name}</b>
                <span className="tag red">{TIER_NAME[o.tier]}</span>
                <span className="muted small" style={{ width: 150 }}>{fmt(o.perSeason)}/赛季 · {o.years} 年</span>
                <span className={`small ${pct >= 60 ? "" : "muted"}`} style={{ width: 90, color: pct >= 60 ? "var(--green)" : undefined }}>成功率 {pct}%</span>
                <span className="grow" />
                <button className="small primary" disabled={state.actionPoints < 1} onClick={() => void signSponsor(o.id)}>
                  谈判签约
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* 商务邀约 */}
      <div className="card">
        <h3>📸 选手商务邀约（本周 {state.gigOffers.length} 条）</h3>
        {state.gigOffers.length === 0 && <div className="muted small">本周没有邀约。接受邀约会占用该选手 1 个训练日；同一选手 ≥2 天训练收益 −25%/天。</div>}
        {state.gigOffers.map((g) => {
          const p = state.players[g.playerId];
          if (!p) return null;
          return (
            <div key={g.id} className="row" style={{ padding: "8px 0", borderBottom: "1px dashed var(--line)", flexWrap: "wrap" }}>
              <b style={{ width: 90 }}>{p.ign}</b>
              <span className="muted small" style={{ width: 120 }}>{g.brand}</span>
              <span className="small" style={{ width: 110 }}>{fmt(g.pay)}</span>
              <span className="muted small grow">占用 1 训练日{p.commercialDays >= 1 ? " · 已有占用" : ""}</span>
              <button className="small primary" onClick={() => void acceptGig(g.id)}>接受</button>
              <button className="ghost small" onClick={() => void declineGig(g.id)}>拒绝</button>
            </div>
          );
        })}
      </div>

      {/* 直播合同 */}
      <div className="card">
        <h3>📺 直播合同（选手 60% / 俱乐部 40%）</h3>
        {team.roster.map((pid) => {
          const p = state.players[pid]!;
          const streaming = p.stream && p.stream.untilDay > state.day;
          return (
            <div key={pid} className="row" style={{ padding: "6px 0", borderBottom: "1px dashed var(--line)" }}>
              <b style={{ width: 100 }}>{p.ign}</b>
              <span className="muted small grow">
                {streaming ? `直播中 · 至第 ${p.stream!.untilDay} 天 · 俱乐部周入 ${fmt(Math.round(p.stream!.weekly * 0.4))}（疲劳 +2/周）` : "无直播合同"}
              </span>
              {streaming ? (
                <button className="ghost small" onClick={() => void cancelStream(pid)}>终止</button>
              ) : (
                <button className="small" onClick={() => void signStream(pid)}>签 3 个月</button>
              )}
            </div>
          );
        })}
        <div className="muted small" style={{ marginTop: 8 }}>直播占用该选手每周 1 个训练日并 +2 疲劳；人气选手收益更高。</div>
      </div>

      <div className="card">
        <h3>📰 资金流水（最近 10 条）</h3>
        {state.finances.log.slice(-10).reverse().map((l, i) => (
          <div key={i} className="news-item">
            <span className="muted small">[{l.day}天] </span>{l.label}
            <span className={l.amount >= 0 ? "tag green" : "tag red"} style={{ marginLeft: 8 }}>{l.amount >= 0 ? "+" : ""}{fmt(l.amount)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
