import { useMemo, useState } from "react";
import { useStore } from "../store.ts";
import { generateWorld } from "../../core/worldgen.ts";

export function StartScreen() {
  const { hasSave, newGame, continueGame, busy } = useStore();
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 900000) + 1000);
  const [selected, setSelected] = useState<string | null>(null);

  // 预览世界：同步生成一次性只读世界（~160 人，毫秒级），换种子即刷新
  const teams = useMemo(() => {
    const w = generateWorld(seed);
    return Object.values(w.teams).map((t) => {
      const rating = Math.round(
        t.roster.reduce((s, pid) => s + (w.players[pid]?.overall ?? 0), 0) / Math.max(1, t.roster.length),
      );
      return { id: t.id, name: t.name, tag: t.tag, tier: t.tier, rating, budget: t.budget, coach: t.coach.name };
    });
  }, [seed]);

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: "36px 20px" }}>
      <h1 className="title">
        ACE<em>教练</em>
      </h1>
      <p className="muted">无畏契约风电竞经理 · 你不开枪，但每一次胜利都由你设计。</p>

      {hasSave && (
        <div className="card">
          <div className="row">
            <button className="primary" disabled={busy} onClick={() => void continueGame()}>
              继续上次存档
            </button>
            <span className="muted small">自动存档保存在本浏览器（IndexedDB）</span>
          </div>
        </div>
      )}

      <div className="card">
        <h3>1 · 世界种子</h3>
        <div className="row">
          <span>种子</span>
          <input
            type="number"
            value={seed}
            onChange={(e) => setSeed(Number(e.target.value) || 1000)}
            style={{ width: 120 }}
          />
          <button onClick={() => setSeed(Math.floor(Math.random() * 900000) + 1000)}>随机</button>
          <span className="muted small">同一种子 = 同一个联盟（选手与属性完全一致）</span>
        </div>
      </div>

      <div className="card">
        <h3>2 · 选择俱乐部（{teams.length} 支）</h3>
        <div className="startgrid">
          {teams.map((t) => (
            <div
              key={t.id}
              className={`teamcard${selected === t.id ? " sel" : ""}`}
              onClick={() => setSelected(t.id)}
            >
              <div className="row" style={{ justifyContent: "space-between" }}>
                <b>{t.name}</b>
                <span className={`tag${t.tier === 1 ? " red" : ""}`}>{t.tier === 1 ? "一级" : "次级"}</span>
              </div>
              <div className="muted small" style={{ marginTop: 6 }}>
                阵容强度 {t.rating} · 预算 ${(t.budget / 1000).toFixed(0)}K · 教练 {t.coach}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="row" style={{ marginTop: 14 }}>
        <button
          className="primary"
          disabled={!selected || busy}
          onClick={() => selected && void newGame(seed, selected)}
        >
          {busy ? "生成世界中…" : "开始职业生涯 →"}
        </button>
        <span className="muted small">v0.1：全部俱乐部开放选择（声望门槛与出身系统在 v0.5 加入）</span>
      </div>
    </div>
  );
}
