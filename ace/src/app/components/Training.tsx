import { useState } from "react";
import type { GameState } from "../../core/types.ts";
import { MAPS } from "../../core/data/maps.ts";
import { AGENTS, AGENT_BY_ID } from "../../core/data/agents.ts";
import { INDIVIDUAL_OPTIONS, OPTION_BY_KEY, recommendFocus, XP_PER_DAY, XP_PER_ATTR_POINT } from "../../core/data/training.ts";
import { useStore } from "../store.ts";
import { AgentIcon, PlayerFace } from "./Avatar.tsx";

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
                <select
                  value={aid}
                  onChange={(e) => {
                    const v = e.target.value;
                    setAgentPicks((prev) => {
                      const n = { ...prev };
                      if (!v) delete n[pid];
                      else if (!full || n[pid]) n[pid] = v;
                      return n;
                    });
                  }}
                >
                  <option value="">（不练）</option>
                  <optgroup label="英雄池">
                    {p.agentPool.map((a) => <option key={a} value={a}>{AGENT_BY_ID.get(a)?.name ?? a}（{Math.round(p.agentPro[a] ?? 0)}）</option>)}
                  </optgroup>
                  <optgroup label="新英雄（34 起步）">
                    {AGENTS.filter((a) => !p.agentPool.includes(a.id)).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </optgroup>
                </select>
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
