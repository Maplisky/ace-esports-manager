/** 经理页（GDD v0.5-5 教练个人经济）：个人钱包/饱腹/心情 + 生活动作 */
import type { GameState } from "../../core/types.ts";
import { useStore } from "../store.ts";

const fmt = (v: number) => `$${Math.round(v)}`;

export function ManagerPage(props: { state: GameState }) {
  const { state } = props;
  const managerLife = useStore((s) => s.managerLife);
  const mgr = state.manager;
  if (!mgr) return null;
  const life = mgr.life;
  const moodColor = life.mood >= 60 ? "var(--green)" : life.mood >= 30 ? "var(--orange)" : "var(--accent)";
  const hungerColor = life.hunger >= 60 ? "var(--green)" : life.hunger >= 30 ? "var(--orange)" : "var(--accent)";

  return (
    <div>
      <div className="card">
        <h3>👔 经理档案</h3>
        <div className="row" style={{ flexWrap: "wrap", gap: 18 }}>
          <span>声望 <b>{Math.round(mgr.reputation)}</b></span>
          <span className="muted small">
            谈判 {mgr.skills.negotiation ?? 50} · 训练 {mgr.skills.training ?? 50} · 商务 {mgr.skills.business ?? 50}
          </span>
        </div>
      </div>

      <div className="card">
        <h3>🍞 个人生活</h3>
        <div className="row" style={{ flexWrap: "wrap", gap: 18, marginBottom: 12 }}>
          <span>个人钱包 <b>{fmt(life.wallet)}</b></span>
          <span className="row" style={{ gap: 6 }}>
            饱腹
            <span className="bar-track"><span className="bar-fill" style={{ width: `${life.hunger}%`, background: hungerColor }} /></span>
            {Math.round(life.hunger)}
          </span>
          <span className="row" style={{ gap: 6 }}>
            心情
            <span className="bar-track"><span className="bar-fill" style={{ width: `${life.mood}%`, background: moodColor }} /></span>
            {Math.round(life.mood)}
          </span>
        </div>
        <div className="muted small" style={{ marginBottom: 10 }}>
          饱腹每天 −3、心情每天 −1；心情 &lt;30 时全队训练收益 −10%。月薪 5,833 每月自动入个人钱包。
        </div>
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          <button className="small" disabled={life.wallet < 30} onClick={() => void managerLife("meal")}>
            便饭 $30（饱腹 +35）
          </button>
          <button className="small" disabled={life.wallet < 120} onClick={() => void managerLife("feast")}>
            好好吃一顿 $120（饱腹 +60 心情 +10）
          </button>
          <button className="small" disabled={life.wallet < 300} onClick={() => void managerLife("fun")}>
            娱乐活动 $300（心情 +20）
          </button>
        </div>
      </div>
    </div>
  );
}
