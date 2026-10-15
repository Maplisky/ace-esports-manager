import { useMemo, useState } from "react";
import { useStore } from "../store.ts";
import { generateWorld } from "../../core/worldgen.ts";
import { REGIONS } from "../../core/sim/day.ts";
import { ORIGINS, TALENT_POOL, TALENT_BASE, TALENT_CAP, TALENT_PRESETS, SKILL_CN, type ManagerSkillKey } from "../../core/sim/career.ts";
import { TeamLogo } from "./Avatar.tsx";

const PERSONALITY_CN: Record<string, string> = {
  spender: "董事会期望：大牌与成绩",
  youth: "董事会期望：培养新人",
  steady: "董事会期望：稳定运营",
  wheeler: "董事会期望：激进换血",
};

export function StartScreen() {
  const { hasSave, newGame, continueGame, busy } = useStore();
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 900000) + 1000);
  const [selected, setSelected] = useState<string | null>(null);
  const [origin, setOrigin] = useState<"legend" | "grassroots" | "analyst" | null>(null);
  const [difficulty, setDifficulty] = useState<"normal" | "hard" | "pro">("normal");
  const [talents, setTalents] = useState<Record<ManagerSkillKey, number>>(() => ({ ...TALENT_PRESETS[0]!.points }));
  const [sortBy, setSortBy] = useState<"region" | "reputation" | "payroll">("region");

  // 预览世界：同步生成一次性只读世界（~550 人，毫秒级），换种子即刷新
  const world = useMemo(() => generateWorld(seed), [seed]);
  const teams = useMemo(
    () =>
      Object.values(world.teams).map((t) => {
        const rating = Math.round(
          t.roster.reduce((s, pid) => s + (world.players[pid]?.overall ?? 0), 0) / Math.max(1, t.roster.length),
        );
        const payroll = t.roster.reduce((s, pid) => s + (world.players[pid]?.salary ?? 0), 0);
        const payPct = Math.round((payroll / Math.max(1, t.budget)) * 100);
        return {
          id: t.id, name: t.name, tag: t.tag, tier: t.tier, regionId: t.regionId, logo: t.logo, rating, budget: t.budget, coach: t.coach.name,
          reputation: t.reputation, payroll, payPct, personality: t.personality,
        };
      }),
    [world],
  );

  const talentUsed = (Object.keys(SKILL_CN) as ManagerSkillKey[]).reduce((s, k) => s + (talents[k] ?? 0), 0);
  const talentLeft = TALENT_POOL - talentUsed;
  const setTalent = (k: ManagerSkillKey, d: number) => {
    setTalents((cur) => {
      const next = { ...cur };
      const nv = (next[k] ?? 0) + d;
      if (nv < 0 || nv > TALENT_CAP - TALENT_BASE) return cur;
      if (d > 0 && talentLeft <= 0) return cur;
      next[k] = nv;
      return next;
    });
  };

  const teamCard = (t: (typeof teams)[number]) => {
    const health = t.payPct <= 60 ? "green" : t.payPct <= 100 ? "" : "red";
    return (
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
        <div className="muted small" style={{ marginTop: 2, display: "flex", flexWrap: "wrap", gap: 4 }}>
          <span className={`tag ${health}`}>薪资 {t.payPct}%</span>
          <span className="tag">声望 {t.reputation}</span>
          <span className="tag">{PERSONALITY_CN[t.personality] ?? "董事会期望：常规"}</span>
        </div>
      </div>
    );
  };

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
        <div className="row" style={{ marginBottom: 8 }}>
          <span className="muted small">排序</span>
          {([["region", "按赛区"], ["reputation", "按声望"], ["payroll", "按薪资健康"]] as const).map(([k, label]) => (
            <button key={k} className={sortBy === k ? "small primary" : "small"} onClick={() => setSortBy(k)}>{label}</button>
          ))}
          <span className="muted small">薪资 = 名单年薪 ÷ 预算（≤60% 健康 / ≤100% 可控 / 超载红色）</span>
        </div>
        {sortBy === "region" && REGIONS.map((r) => (
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
        {sortBy !== "region" && (
          <div className="startgrid">
            {teams.slice().sort((a, b) => (sortBy === "reputation" ? b.reputation - a.reputation : a.payPct - b.payPct)).map(teamCard)}
          </div>
        )}
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

      <div className="card">
        <h3>4 · 天赋分配（剩余 {talentLeft} 点）</h3>
        <div className="row" style={{ gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
          <span className="muted small">推荐配置：</span>
          {TALENT_PRESETS.map((p) => (
            <button key={p.key} className="small" title={p.desc} onClick={() => setTalents({ ...p.points })}>{p.label}</button>
          ))}
        </div>
        <div className="startgrid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
          {(Object.keys(SKILL_CN) as ManagerSkillKey[]).map((k) => (
            <div key={k} className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 6 }}>
              <span className="small">{SKILL_CN[k]} <b>{TALENT_BASE + (talents[k] ?? 0)}</b></span>
              <span className="row" style={{ gap: 4 }}>
                <button className="small" onClick={() => setTalent(k, -1)}>−</button>
                <span className="muted small" style={{ width: 28, textAlign: "center" }}>+{talents[k] ?? 0}</span>
                <button className="small" onClick={() => setTalent(k, 1)} disabled={talentLeft <= 0}>＋</button>
              </span>
            </div>
          ))}
        </div>
        <div className="muted small" style={{ marginTop: 8 }}>
          八维基础 {TALENT_BASE}，共 {TALENT_POOL} 点（单项上限 {TALENT_CAP}）。出身加成会叠加在天赋之上——天赋只决定你是谁，出身决定你从哪来。
        </div>
      </div>

      <div className="card">
        <h3>5 · 难度（开档后不可下调）</h3>
        <div className="startgrid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
          {([
            { key: "normal", label: "普通", desc: "标准体验：AI 不侦察你，预算对等" },
            { key: "hard", label: "困难", desc: "AI 每场侦察你（针对加成 +0.44）· AI 一级队每周 +$6K 补贴" },
            { key: "pro", label: "职业", desc: "AI 深度侦察（+0.88）· BP 读图噪声减半（±3）· AI 每周 +$12K" },
          ] as const).map((d) => (
            <div key={d.key} className={`teamcard${difficulty === d.key ? " sel" : ""}`} onClick={() => setDifficulty(d.key)}>
              <b>{d.label}</b>
              <div className="muted small" style={{ marginTop: 6 }}>{d.desc}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="row" style={{ marginTop: 14 }}>
        <button
          className="primary"
          disabled={!selected || !origin || busy}
          onClick={() => selected && origin && void newGame(seed, selected, origin, difficulty, talents)}
        >
          {busy ? "生成世界中…" : "开始职业生涯 →"}
        </button>
        <span className="muted small">出身决定起步资源与声望；下课、跳槽与名人堂在生涯中等着你。</span>
      </div>
    </div>
  );
}
