import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store.ts";
import { generateWorld } from "../../core/worldgen.ts";
import { REGIONS } from "../../core/sim/day.ts";
import { ORIGINS, TALENT_POOL, TALENT_BASE, TALENT_CAP, TALENT_PRESETS, SKILL_CN, type ManagerSkillKey } from "../../core/sim/career.ts";
import { TeamLogo } from "./Avatar.tsx";
import { SaveManagerModal } from "./SaveManagerModal.tsx";
const PERSONALITY_CN: Record<string, string> = {
  spender: "董事会期望：大牌与成绩",
  youth: "董事会期望：培养新人",
  steady: "董事会期望：稳定运营",
  wheeler: "董事会期望：激进换血",
};

export function StartScreen() {
  const { hasSave, newGame, continueGame, busy, importSaveText } = useStore();
  const importRef = useRef<HTMLInputElement>(null);
  const doImport = (file: File) => {
    void file.text().then((t) => importSaveText(t));
  };
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 900000) + 1000);
  const [selected, setSelected] = useState<string | null>(null);
  const [origin, setOrigin] = useState<"legend" | "grassroots" | "analyst" | null>(null);
  const [difficulty, setDifficulty] = useState<"normal" | "hard" | "pro">("normal");
  const [talents, setTalents] = useState<Record<ManagerSkillKey, number>>(() => ({ ...TALENT_PRESETS[0]!.points }));
  const [sortBy, setSortBy] = useState<"region" | "reputation" | "payroll">("region");
  /** 赛区折叠（v1.x 用户反馈）：64 支全展开太冗杂——默认只展开 Americas，其余折叠 */
  const [expandedRegions, setExpandedRegions] = useState<Set<string>>(() => new Set([REGIONS[0]?.id ?? ""]));
  /** 声望/薪资分档折叠（v1.x 用户反馈）：默认全收起 */
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  /** 教练姓名（v1.x 用户反馈）：默认「经理」，空输入回退默认 */
  const [managerName, setManagerName] = useState("");
  /** 存档管理弹窗（v1.x 用户反馈：窗口式存档管理） */
  const [saveMgrOpen, setSaveMgrOpen] = useState(false);
  // 种子挑战赛模式（GDD §11.5 v1.x）：挑战页带参跳转 → 锁 seed/出身/难度，过滤不符档位；开始后清除
  const [challenge] = useState<{ id: string; name: string; seed: number; origin?: string; difficulty?: string; tier?: number; maxAge?: number } | null>(() => {
    try {
      const raw = localStorage.getItem("ace-challenge");
      return raw ? (JSON.parse(raw) as never) : null;
    } catch {
      return null;
    }
  });
  useEffect(() => {
    if (!challenge) return;
    setSeed(challenge.seed);
    if (challenge.origin === "legend" || challenge.origin === "grassroots" || challenge.origin === "analyst") setOrigin(challenge.origin);
    if (challenge.difficulty === "normal" || challenge.difficulty === "hard" || challenge.difficulty === "pro") setDifficulty(challenge.difficulty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        const maxAgeOk = challenge?.maxAge == null || t.roster.every((pid) => (world.players[pid]?.age ?? 99) <= challenge.maxAge!);
        return {
          id: t.id, name: t.name, tag: t.tag, tier: t.tier, regionId: t.regionId, logo: t.logo, rating, budget: t.budget, coach: t.coach.name,
          reputation: t.reputation, payroll, payPct, personality: t.personality, maxAgeOk,
        };
      }),
    [world, challenge?.maxAge],
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
          {challenge?.maxAge != null && (
            <span className={`tag ${t.maxAgeOk ? "green" : ""}`}>{t.maxAgeOk ? `✓ U${challenge.maxAge} 合规` : `✗ 超 U${challenge.maxAge}`}</span>
          )}
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
          <div className="row" style={{ flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <button className="primary" disabled={busy} onClick={() => void continueGame()}>
              继续上次存档
            </button>
            <button className="small" disabled={busy} onClick={() => setSaveMgrOpen(true)}>💾 存档管理（读取/切换/备份）</button>
            <button className="small" disabled={busy} onClick={() => importRef.current?.click()}>📥 导入存档文件（JSON）</button>
            <input
              ref={importRef}
              type="file"
              accept="application/json,.json"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) doImport(f);
                e.target.value = "";
              }}
            />
            <span className="muted small">自动存档保存在本浏览器（IndexedDB）。</span>
          </div>
          <SaveSlotList />
        </div>
      )}
      {!hasSave && (
        <div className="card">
          <div className="row" style={{ flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <span className="muted small">本地没有存档。想把别的浏览器/设备的进度带过来？</span>
            <button className="small" disabled={busy} onClick={() => importRef.current?.click()}>📥 导入存档文件（JSON）</button>
            <input
              ref={importRef}
              type="file"
              accept="application/json,.json"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) doImport(f);
                e.target.value = "";
              }}
            />
          </div>
        </div>
      )}

      {challenge && (
        <div className="card" style={{ borderColor: "var(--accent)" }}>
          <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <span>
              <b>🏁 挑战模式：{challenge.name}</b>
              <div className="muted small" style={{ marginTop: 4 }}>
                种子 {challenge.seed}、出身/难度已按挑战锁定{challenge.tier ? `、只能选择${challenge.tier === 2 ? "挑战者" : "VCT 合作队"}俱乐部` : ""}{challenge.maxAge ? `、名单需全员 ≤${challenge.maxAge} 岁（队卡带 ✓/✗ 标记）` : ""}。成绩在「挑战」页查看并提交。
              </div>
            </span>
            <button className="small" onClick={() => { try { localStorage.removeItem("ace-challenge"); } catch { /* 忽略 */ } location.reload(); }}>
              退出挑战模式
            </button>
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
            disabled={!!challenge}
            onChange={(e) => setSeed(Number(e.target.value) || 1000)}
            style={{ width: 120 }}
          />
          <button disabled={!!challenge} onClick={() => setSeed(Math.floor(Math.random() * 900000) + 1000)}>随机</button>
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
        {sortBy === "region" && REGIONS.map((r) => {
          const expanded = expandedRegions.has(r.id);
          return (
            <div key={r.id} style={{ marginBottom: 10 }}>
              <div
                className="row"
                style={{ alignItems: "center", gap: 8, margin: "8px 0 6px", cursor: "pointer", userSelect: "none", padding: "6px 10px", borderRadius: 8, background: "rgba(255,255,255,0.03)" }}
                onClick={() => setExpandedRegions((cur) => {
                  const next = new Set(cur);
                  if (next.has(r.id)) next.delete(r.id);
                  else next.add(r.id);
                  return next;
                })}
                title={expanded ? "点击折叠" : "点击展开"}
              >
                <span style={{ width: 12 }}>{expanded ? "▾" : "▸"}</span>
                <img src={r.logo} alt={r.label} width={20} height={20} style={{ borderRadius: 4 }} />
                <b>VCT {r.label}</b>
                <span className="muted small">
                  {teams.filter((t) => t.regionId === r.id && t.tier === 1).length} 支合作队 ·{" "}
                  {teams.filter((t) => t.regionId === r.id && t.tier === 2).length} 支挑战者
                </span>
                <span className="grow" />
                <span className="muted small">{expanded ? "收起 ▴" : "展开 ▾"}</span>
              </div>
              {expanded && <div className="startgrid">{teams.filter((t) => t.regionId === r.id).map(teamCard)}</div>}
            </div>
          );
        })}
        {sortBy !== "region" && (() => {
          // 分档折叠（v1.x 用户反馈）：按声望/薪资健康排序时按数据区间分组，默认全收起、点组头展开
          const sorted = teams.slice().sort((a, b) => (sortBy === "reputation" ? b.reputation - a.reputation : a.payPct - b.payPct));
          const groupOf = (t: (typeof sorted)[number]): string =>
            sortBy === "reputation"
              ? t.reputation >= 80 ? "豪门（声望 80+）" : t.reputation >= 65 ? "劲旅（声望 65-79）" : t.reputation >= 50 ? "中游（声望 50-64）" : "新贵（声望 <50）"
              : t.payPct <= 30 ? "薪资极健康（≤30%）" : t.payPct <= 60 ? "健康（30-60%）" : t.payPct <= 100 ? "可控（60-100%）" : "超载（>100%，慎选）";
          const groups = new Map<string, typeof sorted>();
          for (const t of sorted) {
            const g = groupOf(t);
            if (!groups.has(g)) groups.set(g, []);
            groups.get(g)!.push(t);
          }
          return [...groups.entries()].map(([g, list]) => {
            const expanded = expandedGroups.has(g);
            return (
              <div key={g} style={{ marginBottom: 10 }}>
                <div
                  className="row"
                  style={{ alignItems: "center", gap: 8, margin: "8px 0 6px", cursor: "pointer", userSelect: "none", padding: "6px 10px", borderRadius: 8, background: "rgba(255,255,255,0.03)" }}
                  onClick={() => setExpandedGroups((cur) => {
                    const next = new Set(cur);
                    if (next.has(g)) next.delete(g);
                    else next.add(g);
                    return next;
                  })}
                  title={expanded ? "点击折叠" : "点击展开"}
                >
                  <span style={{ width: 12 }}>{expanded ? "▾" : "▸"}</span>
                  <b>{g}</b>
                  <span className="muted small">{list.length} 支</span>
                  <span className="grow" />
                  <span className="muted small">{expanded ? "收起 ▴" : "展开 ▾"}</span>
                </div>
                {expanded && <div className="startgrid">{list.map(teamCard)}</div>}
              </div>
            );
          });
        })()}
      </div>

      <div className="card">
        <h3>3 · 教练出身（随机 3 选 1）</h3>
        <div className="startgrid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
          {ORIGINS.map((o) => (
            <div
              key={o.key}
              className={`teamcard${origin === o.key ? " sel" : ""}${challenge?.origin && challenge.origin !== o.key ? " muted" : ""}`}
              onClick={() => { if (!challenge?.origin) setOrigin(o.key); }}
              style={challenge?.origin && challenge.origin !== o.key ? { opacity: 0.4, pointerEvents: "none" } : undefined}
            >
              <b>{o.label}</b>
              <div className="muted small" style={{ marginTop: 6 }}>{o.desc}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h3>4 · 教练姓名</h3>
        <div className="row" style={{ flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <input
            value={managerName}
            maxLength={16}
            placeholder="经理"
            onChange={(e) => setManagerName(e.target.value)}
            style={{ width: 200 }}
          />
          <span className="muted small">留空则叫「经理」。名字会出现在生涯账本、下课/跳槽新闻与存档列表里。</span>
        </div>
      </div>

      <div className="card">
        <h3>5 · 天赋分配（剩余 {talentLeft} 点）</h3>
        <div className="row" style={{ gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
          <span className="muted small">推荐配置：</span>
          {TALENT_PRESETS.map((p) => (
            <button key={p.key} className="small" title={p.desc} onClick={() => setTalents({ ...p.points })}>{p.label}</button>
          ))}
        </div>
        <div className="startgrid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
          {(Object.keys(SKILL_CN) as ManagerSkillKey[]).map((k) => {
            // 实时显示「天赋+出身」合成值（v1.x 用户反馈：出身选择看不出影响）——加成表与 initCareer 同源
            const bonus = origin ? (ORIGINS.find((o) => o.key === origin)?.skillBonus[k] ?? 0) : 0;
            const final = Math.min(TALENT_CAP, TALENT_BASE + (talents[k] ?? 0) + bonus);
            return (
              <div key={k} className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                <span className="small">
                  {SKILL_CN[k]} <b style={bonus > 0 ? { color: "var(--green)" } : undefined}>{final}</b>
                  {bonus > 0 && <span className="muted small">（含出身 +{bonus}）</span>}
                </span>
                <span className="row" style={{ gap: 4 }}>
                  <button className="small" onClick={() => setTalent(k, -1)}>−</button>
                  <span className="muted small" style={{ width: 28, textAlign: "center" }}>+{talents[k] ?? 0}</span>
                  <button className="small" onClick={() => setTalent(k, 1)} disabled={talentLeft <= 0}>＋</button>
                </span>
              </div>
            );
          })}
        </div>
        <div className="muted small" style={{ marginTop: 8 }}>
          八维基础 {TALENT_BASE}，共 {TALENT_POOL} 点（单项上限 {TALENT_CAP}）。绿色数值 = 天赋 + <b>当前已选出身</b>的加成——第 3 步换出身，这里的数值会实时变。
        </div>
      </div>

      <div className="card">
        <h3>6 · 难度（开档后不可下调）</h3>
        <div className="startgrid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
          {([
            { key: "normal", label: "普通", desc: "标准体验：AI 不侦察你，预算对等" },
            { key: "hard", label: "困难", desc: "AI 每场侦察你（针对加成 +0.44）· AI 一级队每周 +$6K 补贴" },
            { key: "pro", label: "职业", desc: "AI 深度侦察（+0.88）· BP 读图噪声减半（±3）· AI 每周 +$12K" },
          ] as const).map((d) => (
            <div
              key={d.key}
              className={`teamcard${difficulty === d.key ? " sel" : ""}${challenge?.difficulty && challenge.difficulty !== d.key ? " muted" : ""}`}
              onClick={() => { if (!challenge?.difficulty) setDifficulty(d.key); }}
              style={challenge?.difficulty && challenge.difficulty !== d.key ? { opacity: 0.4, pointerEvents: "none" } : undefined}
            >
              <b>{d.label}</b>
              <div className="muted small" style={{ marginTop: 6 }}>{d.desc}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="row" style={{ marginTop: 14 }}>
        <button
          className="primary"
          disabled={!selected || !origin || busy || (!!challenge?.tier && !!selected && teams.find((t) => t.id === selected)?.tier !== challenge.tier)}
          onClick={() => {
            if (!selected || !origin) return;
            if (challenge?.tier && teams.find((t) => t.id === selected)?.tier !== challenge.tier) return;
            try { if (challenge) localStorage.removeItem("ace-challenge"); } catch { /* 忽略 */ }
            void newGame(seed, selected, origin, difficulty, talents, managerName.trim() || undefined);
          }}
        >
          {busy ? "生成世界中…" : challenge ? "开始挑战 →" : "开始职业生涯 →"}
        </button>
        <span className="muted small">
          {challenge ? "挑战参数已锁定；开局后到「挑战」页查看成绩与提交。" : "出身决定起步资源与声望；下课、跳槽与名人堂在生涯中等着你。"}
        </span>
      </div>
      {saveMgrOpen && <SaveManagerModal state={world as never} records={{}} onClose={() => { setSaveMgrOpen(false); }} />}
    </div>
  );
}

/** 存档槽位列表（v1.x 用户反馈：开档界面可切换任一存档，不只 auto）——自动/手动 3 槽/每日备份 */
function SaveSlotList() {
  const { saves, loadFromKey, refreshSaves, continueGame, busy } = useStore();
  useEffect(() => { void refreshSaves(); }, [refreshSaves]);
  const LABELS: Record<string, string> = { slot1: "手动槽 1", slot2: "手动槽 2", slot3: "手动槽 3" };
  const auto = saves.find((e) => e.key === "auto");
  const others = saves.filter((e) => e.key !== "auto");
  if (saves.length === 0) return null;
  return (
    <div style={{ marginTop: 10, borderTop: "1px dashed var(--line)", paddingTop: 8 }}>
      <div className="muted small" style={{ marginBottom: 4 }}>全部存档（读取即切换；备份也可读）：</div>
      <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
        {auto && (
          <button className="small primary" disabled={busy} onClick={() => void continueGame()}>
            ▶ 自动档{auto.meta ? ` · ${auto.meta.teamTag} ${auto.meta.year}年第${auto.meta.day}天` : ""}
          </button>
        )}
        {others.map((e) => (
          <button key={e.key} className="small" disabled={busy} onClick={() => void loadFromKey(e.key)} title={e.meta ? `${e.meta.teamTag} · ${e.meta.manager} · ${e.meta.difficulty}` : undefined}>
            {LABELS[e.key] ?? (e.key.startsWith("bak-") ? `备份 ${e.key.slice(4)}` : e.key)}{e.meta ? ` · ${e.meta.teamTag} D${e.meta.day}` : ""}
          </button>
        ))}
      </div>
    </div>
  );
}
