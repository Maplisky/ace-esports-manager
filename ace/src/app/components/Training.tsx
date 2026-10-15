import { useState } from "react";
import type { GameState, ScrimGoal } from "../../core/types.ts";
import { MAPS, MAP_BY_ID } from "../../core/data/maps.ts";
import { AGENT_BY_ID } from "../../core/data/agents.ts";
import { INDIVIDUAL_OPTIONS, OPTION_BY_KEY, recommendFocus, XP_PER_DAY, XP_PER_ATTR_POINT } from "../../core/data/training.ts";
import { teamAvgOverall, scrimSparringCoef, scrimAcceptChance } from "../../core/sim/scrim.ts";
import { intelOf, intelLevel, estimateMapStrength, starsOf, mapStrengthBand } from "../../core/sim/intel.ts";
import { STYLE_LABEL, type StyleKey } from "../../core/sim/strength.ts";
import { useStore } from "../store.ts";
import { AgentIcon, PlayerFace } from "./Avatar.tsx";
import { AgentSelect } from "./AgentSelect.tsx";

const TEAM_SLOTS: { key: string; name: string; desc: string }[] = [
  { key: "map", name: "跑图", desc: "所选地图熟练 +0.4/天（上限 95）" },
  { key: "review", name: "复盘", desc: "全队意识/沟通经验（团队通道）" },
  { key: "scrim", name: "对抗", desc: "队内赛：疲劳 +5/天，士气 +1/周" },
  { key: "rest", name: "休息", desc: "全队调整，个人训练也停" },
];

const ATTR_CN: Record<string, string> = {
  aim: "枪法", reaction: "反应", awareness: "意识", utility: "道具",
  clutch: "残局", teamwork: "协同", communication: "沟通", igl: "指挥",
};

function primaryDuty(state: GameState, pid: string): "duelist" | "initiator" | "controller" | "sentinel" {
  const p = state.players[pid]!;
  const sum = { duelist: 0, initiator: 0, controller: 0, sentinel: 0 };
  let w = 0;
  for (const agentId of p.agentPool) {
    const a = AGENT_BY_ID.get(agentId);
    if (!a) continue;
    const pro = p.agentPro[agentId] ?? 0;
    for (const k of ["duelist", "initiator", "controller", "sentinel"] as const) sum[k] += a.duty[k] * pro;
    w += pro;
  }
  let best: "duelist" | "initiator" | "controller" | "sentinel" = "duelist";
  let bestV = -1;
  for (const k of ["initiator", "controller", "sentinel", "duelist"] as const) {
    if (w > 0 && sum[k] / w > bestV) {
      bestV = sum[k] / w;
      best = k;
    }
  }
  return best;
}

/** 训练页（GDD §6.3 v1.1）：团队课表与个人训练并行 */
export function TrainingPage(props: { state: GameState }) {
  const { state } = props;
  const setTeamSchedule = useStore((s) => s.setTeamSchedule);
  const setAgentTraining = useStore((s) => s.setAgentTraining);
  const [agentPicks, setAgentPicks] = useState<Record<string, string>>(() => ({ ...(state.agentTraining ?? {}) }));
  const myId = state.myTeamId ?? "";
  const team = state.teams[myId];
  const [slots, setSlots] = useState<string[]>(() =>
    state.teamSchedule.some((s) => s === "individual")
      ? state.teamSchedule.map((s) => (s === "individual" ? "review" : s))
      : state.teamSchedule.slice(),
  );
  const [maps, setMaps] = useState<string[]>(() => (state.trainingMaps.length ? state.trainingMaps.slice() : [MAPS[0]!.id]));
  const [schedules, setSchedules] = useState<Record<string, string>>(() => ({ ...state.schedules }));
  if (!team) return null;

  const setSlot = (idx: number, key: string) => {
    const next = slots.slice();
    next[idx] = key;
    setSlots(next);
  };
  const toggleMap = (id: string) => {
    setMaps((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id].slice(-2)));
  };
  const trainDays = slots.filter((s) => s !== "rest").length;
  const roster = team.roster.map((pid) => state.players[pid]!);

  return (
    <div>
      <div className="card">
        <h3>🏋 团队课表（练 7 天 · 与个人训练并行）</h3>
        <table>
          <thead>
            <tr><th style={{ width: 90 }}>日</th><th style={{ width: 110 }}>项目</th><th>效果</th></tr>
          </thead>
          <tbody>
            {slots.map((slot, i) => (
              <tr key={i}>
                <td className="muted">第 {i + 1} 天</td>
                <td>
                  <select value={slot} onChange={(e) => setSlot(i, e.target.value)}>
                    {TEAM_SLOTS.map((s) => (
                      <option key={s.key} value={s.key}>{s.name}</option>
                    ))}
                  </select>
                </td>
                <td className="muted small">{TEAM_SLOTS.find((s) => s.key === slot)?.desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row" style={{ marginTop: 10, flexWrap: "wrap" }}>
          <span className="small">跑图目标（≤2 张）：</span>
          {MAPS.map((m) => (
            <button key={m.id} className={maps.includes(m.id) ? "primary" : "ghost small"} onClick={() => toggleMap(m.id)}>
              {m.name} <span className="muted">{Math.round(team.mapPref[m.id] ?? 50)}</span>
            </button>
          ))}
        </div>
        <div className="muted small" style={{ marginTop: 6 }}>
          本周训练日 {trainDays} 天 · 比赛日自动占槽 · 训练日数量影响个人训练经验积累
        </div>
      </div>

      <div className="card">
        <h3>🎯 个人训练（每名选手独立项目 · {XP_PER_ATTR_POINT} 经验 = +1 属性）</h3>
        <table>
          <thead>
            <tr><th>选手</th><th style={{ width: 150 }}>训练项目</th><th>具体指标</th><th style={{ width: 160 }}>进度 → 下一点</th><th>本周预期</th></tr>
          </thead>
          <tbody>
            {roster.map((p) => {
              const focus = schedules[p.id] ?? "rest";
              const opt = OPTION_BY_KEY.get(focus);
              const rec = recommendFocus(primaryDuty(state, p.id), p.isIgl);
              const attrKey = opt?.attr;
              const xpNow = attrKey ? Math.round((p.xp?.[attrKey] ?? 0) * 10) / 10 : null;
              const weekly = attrKey && trainDays > 0
                ? Math.round(((XP_PER_DAY[0] + XP_PER_DAY[1]) / 2) * trainDays * (0.75 + p.morale / 200) * (p.fatigue > 70 ? 0.5 : p.fatigue > 45 ? 0.8 : 1) * 10) / 10
                : null;
              return (
                <tr key={p.id}>
                  <td>
                    {p.ign}
                    {p.isIgl && <span className="tag" style={{ marginLeft: 6 }}>指挥</span>}
                    {focus === rec && <span className="tag green" style={{ marginLeft: 6 }}>推荐</span>}
                  </td>
                  <td>
                    <select
                      value={focus}
                      onChange={(e) => setSchedules((s) => ({ ...s, [p.id]: e.target.value }))}
                    >
                      {INDIVIDUAL_OPTIONS.map((o) => (
                        <option key={o.key} value={o.key}>
                          {o.name}
                          {o.key === rec ? " ★" : ""}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="muted small">
                    {opt?.attr ? `训练 ${ATTR_CN[opt.attr]}（${opt.attr}）· ${opt.desc}` : "不安排加练"}
                    {state.schedules[p.id] !== undefined && schedules[p.id] !== state.schedules[p.id] && (
                      <span className="tag orange" style={{ marginLeft: 6 }}>待保存</span>
                    )}
                  </td>
                  <td>
                    {attrKey ? (
                      <span className="row" style={{ gap: 6 }}>
                        <span className="bar-track" style={{ width: 90 }}>
                          <span
                            className="bar-fill"
                            style={{ width: `${Math.min(100, ((xpNow ?? 0) / XP_PER_ATTR_POINT) * 100)}%`, background: "var(--blue)" }}
                          />
                        </span>
                        <span className="muted small">{xpNow}/{XP_PER_ATTR_POINT}</span>
                      </span>
                    ) : (
                      <span className="muted small">—</span>
                    )}
                  </td>
                  <td className="muted small">
                    {weekly !== null ? `+${weekly} 经验` : focus === "rest" ? "休息" : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="muted small" style={{ marginTop: 8 }}>
          ★ = 按职责/指挥推荐的推荐项 · 经验受士气、疲劳、教练培养与训练日数量影响 · 属性成长不超过潜力+5
        </div>
      </div>

      <AcademyCard />

      <ScrimPanel state={state} />

            <div className="card" style={{ padding: "12px 16px", marginTop: 14 }}>
        <h3>🎭 练英雄（GDD §6.3：最多 5 人/周，熟练 +4.2×效率/周；效率 = 0.7 +（意识+道具）/400）</h3>
        <div className="muted small" style={{ margin: "6px 0" }}>
          已选 {Object.values(agentPicks).filter(Boolean).length}/5 人 · 练非池内英雄从 34 熟练起步，达标后自动入池 · 上限 100（本命）
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 8 }}>
          {(team?.roster ?? []).map((pid) => {
            const p = state.players[pid]!;
            const aid = agentPicks[pid] ?? "";
            const inPool = !!aid && p.agentPool.includes(aid);
            const curPro = aid ? (p.agentPro[aid] ?? (inPool ? 0 : 34)) : 0;
            const eff = 0.7 + (p.attrs.awareness + p.attrs.utility) / 400;
            const full = Object.values(agentPicks).filter(Boolean).length >= 5;
            return (
              <span key={pid} className="row" style={{ gap: 8, alignItems: "center" }}>
                <PlayerFace p={p} size={26} showTag={false} />
                <span className="small" style={{ minWidth: 60 }}>{p.ign}</span>
                {aid && <AgentIcon agentId={aid} size={24} name={AGENT_BY_ID.get(aid)?.name} />}
                <AgentSelect
                  player={p}
                  value={aid}
                  mode="training"
                  onChange={(v) => {
                    setAgentPicks((prev) => {
                      const n = { ...prev };
                      if (!v) delete n[pid];
                      else if (!full || n[pid]) n[pid] = v;
                      return n;
                    });
                  }}
                />
                {aid && <span className="muted small">{Math.round(curPro)} → {Math.min(100, Math.round((curPro + 4.2 * eff) * 10) / 10)}/周</span>}
              </span>
            );
          })}
        </div>
        <div className="row" style={{ justifyContent: "flex-end", marginTop: 8 }}>
          <button className="primary small" onClick={() => { void setAgentTraining(Object.fromEntries(Object.entries(agentPicks).filter(([, v]) => v))); }}>
            📌 保存练英雄安排
          </button>
        </div>
      </div>

<button
        className="primary"
        onClick={() => {
          const finalMaps = maps.length ? maps : ["ascent"];
          void setTeamSchedule(slots, finalMaps, schedules);
        }}
      >
        📌 保存训练计划（团队 + 个人）
      </button>
    </div>
  );
}

/** 青训营（v0.9）：查看学员 + 晋升一线（名单满时选择换下一人） */
function AcademyCard() {
  const state = useStore((s) => s.state)!;
  const promoteFromAcademy = useStore((s) => s.promoteFromAcademy);
  const myId = state.myTeamId ?? "";
  const team = state.teams[myId];
  const [promotePid, setPromotePid] = useState<string | null>(null);
  if (!team) return null;
  const academy = (team.academy ?? []).map((pid) => state.players[pid]!).filter(Boolean);

  return (
    <div className="card" style={{ padding: "12px 16px", marginTop: 14 }}>
      <h3>🎓 青训营（≤18 岁学员 · 个人训练经验 ×1.5 · 不占一线名单）</h3>
      {academy.length === 0 && <div className="muted small">青训营暂无学员（每年休赛期青训营补充）。</div>}
      {academy.length > 0 && (
        <table>
          <thead>
            <tr><th>学员</th><th>位置倾向</th><th>能力/潜力</th><th>年龄</th><th>操作</th></tr>
          </thead>
          <tbody>
            {academy.map((p) => (
              <tr key={p.id}>
                <td style={{ whiteSpace: "nowrap" }}>
                  <span className="row" style={{ alignItems: "center", gap: 6 }}>
                    <PlayerFace p={p} size={22} showTag={false} />
                    <span>{p.ign}</span>
                    <span className="tag green">青训</span>
                  </span>
                </td>
                <td className="muted small">{p.agentPool.map((a) => AGENT_BY_ID.get(a)?.name ?? a).join(" / ")}</td>
                <td><b>{p.overall}</b> <span className="muted small">/ {p.potential}</span></td>
                <td className="muted">{p.age}</td>
                <td>
                  {promotePid === p.id ? (
                    <select
                      className="small"
                      defaultValue=""
                      autoFocus
                      onChange={(e) => { if (e.target.value) { void promoteFromAcademy(p.id, e.target.value); setPromotePid(null); } }}
                    >
                      <option value="">换下谁…</option>
                      {team.starters.map((sid) => (
                        <option key={sid} value={sid}>{state.players[sid]?.ign}（{state.players[sid]?.overall}）</option>
                      ))}
                    </select>
                  ) : (
                    <button className="small" onClick={() => setPromotePid(p.id)}>
                      晋升一线
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="muted small" style={{ marginTop: 6 }}>
        晋升后学员进入一线名单（名单满 7/7 时需指名换下一人）；一线轮换出场同样吃经验，青训经验倍率只对 ≤18 岁学员生效。
      </div>
    </div>
  );
}

/** 训练赛约战面板（GDD §5.6 v1.1）：对手/地图/目标三选一 + 双方每图预估 + 陪练系数预览 */
function ScrimPanel(props: { state: GameState }) {
  const { state } = props;
  const scrim = useStore((s) => s.scrim);
  const myId = state.myTeamId ?? "";
  const team = state.teams[myId];
  const [oppId, setOppId] = useState("");
  const [mapId, setMapId] = useState(state.trainingMaps[0] ?? MAPS[0]!.id);
  const [goal, setGoal] = useState<ScrimGoal>("blend");
  const [goalStyle, setGoalStyle] = useState<StyleKey>("rush");
  if (!team) return null;

  const myStr = teamAvgOverall(state, myId);
  const opponents = Object.values(state.teams)
    .filter((t) => t.id !== myId)
    .sort((a, b) => teamAvgOverall(state, b.id) - teamAvgOverall(state, a.id));
  const opp = state.teams[oppId] ?? opponents[0];
  const mapDef = MAP_BY_ID.get(mapId) ?? MAPS[0]!;
  const intel = intelOf(state, opp.id);
  const lvl = intelLevel(intel);
  const oppMapStr = estimateMapStrength(state, opp, mapDef);
  const myMapStr = estimateMapStrength(state, team, mapDef);
  const band = mapStrengthBand(state, opp, mapDef, state.manager.skills.scouting ?? 50);
  const coef = scrimSparringCoef(myStr, teamAvgOverall(state, opp.id)) + (goal === "mappool" && starsOf(oppMapStr) === 3 ? 0.15 : 0);
  const accept = Math.round(scrimAcceptChance(state, myId, opp.id) * 100);
  const goals: { key: ScrimGoal; name: string; desc: string }[] = [
    { key: "blend", name: "磨合训练", desc: "羁绊 +2×系数、图池熟练 +0.5×系数、协同/沟通经验" },
    { key: "style", name: "风格特训", desc: "对手实际风格匹配时：应对熟练度 +0.5（上限 10，正式赛克制最多偏移 +0.9）" },
    { key: "mappool", name: "图池特训", desc: "目标图熟练 +0.6×系数；对手该图 ★3 强图 → 陪练系数额外 +0.15" },
  ];

  return (
    <div className="card" style={{ padding: "12px 16px", marginTop: 14 }}>
      <h3>🤝 训练赛约战（1 行动力 · 单图先到 13 · 不计个人数据）</h3>
      <div className="row" style={{ flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
        <label className="small">
          对手<br />
          <select value={opp?.id ?? ""} onChange={(e) => setOppId(e.target.value)}>
            {opponents.map((t) => (
              <option key={t.id} value={t.id}>{t.name}（强度 {Math.round(teamAvgOverall(state, t.id))} · 情报 {Math.round(intelOf(state, t.id))}/10）</option>
            ))}
          </select>
        </label>
        <label className="small">
          地图<br />
          <select value={mapId} onChange={(e) => setMapId(e.target.value)}>
            {MAPS.map((m) => (
              <option key={m.id} value={m.id}>{m.name}（我方熟练 {Math.round(team.mapPref[m.id] ?? 50)}）</option>
            ))}
          </select>
        </label>
        <div className="small">
          对方 {mapDef.name} 评估<br />
          {lvl >= 1 ? <b>{"★".repeat(starsOf(oppMapStr))}（{Math.round(oppMapStr)}）</b> : <span className="muted">预估 {band.lo}~{band.hi}（未侦察）</span>}
          <span className="muted"> · 我方 {"★".repeat(starsOf(myMapStr))}</span>
        </div>
      </div>
      <div className="row" style={{ gap: 10, margin: "10px 0", flexWrap: "wrap" }}>
        {goals.map((g) => (
          <button key={g.key} className={goal === g.key ? "small primary" : "small"} onClick={() => setGoal(g.key)} title={g.desc}>{g.name}</button>
        ))}
        {goal === "style" && (
          <select className="small" value={goalStyle} onChange={(e) => setGoalStyle(e.target.value as StyleKey)}>
            {(Object.keys(STYLE_LABEL) as StyleKey[]).map((k) => (
              <option key={k} value={k}>{STYLE_LABEL[k]}</option>
            ))}
          </select>
        )}
      </div>
      <div className="muted small" style={{ marginBottom: 8 }}>{goals.find((g) => g.key === goal)?.desc}</div>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <span className="small">
          陪练系数 <b>×{coef.toFixed(2)}</b>（约{coef >= 1 ? "强" : "弱"}队收益{coef >= 1 ? "加成" : "折减"}；胜 = 基础×系数，负 = 基础×0.45×系数 + 情报全量）
          <span className="muted"> · 对方接受率约 {accept}%（强队婉拒弱队 / 临近正赛拒约 / 宿敌更愿约）</span>
        </span>
        <button className="primary small" disabled={state.actionPoints < 1} onClick={() => void scrim(opp.id, mapId, goal, goal === "style" ? goalStyle : undefined)}>
          发起约战（行动力 {state.actionPoints}/3）
        </button>
      </div>
      {(state.scrimLog?.length ?? 0) > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="muted small">近期训练赛：</div>
          {state.scrimLog!.slice(-5).reverse().map((s, i) => (
            <div key={i} className="small" style={{ padding: "2px 0" }}>
              D{s.day} vs {state.teams[s.oppId]?.name ?? "?"}（{MAP_BY_ID.get(s.mapId)?.name ?? s.mapId} · {s.goal === "blend" ? "磨合" : s.goal === "style" ? "风格" : "图池"}）：
              <b style={{ color: s.won ? "var(--accent)" : undefined }}>{s.won ? "胜" : "负"}</b> {Math.max(s.score[0], s.score[1])}-{Math.min(s.score[0], s.score[1])}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
