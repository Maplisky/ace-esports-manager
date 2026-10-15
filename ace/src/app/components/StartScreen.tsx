import { useMemo, useState } from "react";
import { useStore } from "../store.ts";
import { generateWorld } from "../../core/worldgen.ts";
import { REGIONS } from "../../core/sim/day.ts";
import { ORIGINS } from "../../core/sim/career.ts";
import { TeamLogo } from "./Avatar.tsx";

export function StartScreen() {
  const { hasSave, newGame, continueGame, busy } = useStore();
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 900000) + 1000);
  const [selected, setSelected] = useState<string | null>(null);
  const [origin, setOrigin] = useState<"legend" | "grassroots" | "analyst" | null>(null);

  // 预览世界：同步生成一次性只读世界（~550 人，毫秒级），换种子即刷新
  const world = useMemo(() => generateWorld(seed), [seed]);
  const teams = useMemo(
    () =>
      Object.values(world.teams).map((t) => {
        const rating = Math.round(
          t.roster.reduce((s, pid) => s + (world.players[pid]?.overall ?? 0), 0) / Math.max(1, t.roster.length),
        );
        return { id: t.id, name: t.name, tag: t.tag, tier: t.tier, regionId: t.regionId, logo: t.logo, rating, budget: t.budget, coach: t.coach.name };
      }),
    [world],
  );

  const teamCard = (t: (typeof teams)[number]) => (
    <div key={t.id} className={`teamcard${selected === t.id ? " sel" : ""}`} onClick={() => setSelected(t.id)}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 6 }}>
        <span className="row" style={{ gap: 6, alignItems: "center", minWidth: 0 }}>
          <TeamLogo team={t} size={22} />
          <b style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</b>
        </span>
        <span className={`tag${t.tier === 1 ? " red" : ""}`}>{t.tier === 1 ? "VCT" : "挑战者"}</span>
      </div>
      <div className="muted small" style={{ marginTop: 6 }}>
        阵容强度 {t.rating} · 预算 ${(t.budget / 1000).toFixed(0)}K · 教练 {t.coach}
      </div>
    </div>
  );

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: "36px 20px" }}>
      <h1 className="title">
        ACE<em>教练</em>
      </h1>
      <p className="muted">无畏契约风电竞经理 · 你不开枪，但每一次胜利都由你设计。</p>
      <p className="muted small">真实世界包：队伍 / 选手 / 头像来自 vlr.gg（{teams.length} 支 · 四大赛区），英雄池与能力由真实生涯统计推导。</p>

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
        {REGIONS.map((r) => (
          <div key={r.id} style={{ marginBottom: 14 }}>
            <div className="row" style={{ alignItems: "center", gap: 8, margin: "10px 0 6px" }}>
              <img src={r.logo} alt={r.label} width={20} height={20} style={{ borderRadius: 4 }} />
              <b>VCT {r.label}</b>
              <span className="muted small">
                {teams.filter((t) => t.regionId === r.id && t.tier === 1).length} 支合作队 ·{" "}
                {teams.filter((t) => t.regionId === r.id && t.tier === 2).length} 支挑战者
              </span>
            </div>
            <div className="startgrid">{teams.filter((t) => t.regionId === r.id).map(teamCard)}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <h3>3 · 教练出身（随机 3 选 1）</h3>
        <div className="startgrid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
          {ORIGINS.map((o) => (
            <div key={o.key} className={`teamcard${origin === o.key ? " sel" : ""}`} onClick={() => setOrigin(o.key)}>
              <b>{o.label}</b>
              <div className="muted small" style={{ marginTop: 6 }}>{o.desc}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="row" style={{ marginTop: 14 }}>
        <button
          className="primary"
          disabled={!selected || !origin || busy}
          onClick={() => selected && origin && void newGame(seed, selected, origin)}
        >
          {busy ? "生成世界中…" : "开始职业生涯 →"}
        </button>
        <span className="muted small">出身决定起步资源与声望；下课、跳槽与名人堂在生涯中等着你。</span>
      </div>
    </div>
  );
}
