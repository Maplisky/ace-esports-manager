import { useState } from "react";
import type { GameState } from "../../core/types.ts";
import { AGENT_BY_ID } from "../../core/data/agents.ts";
import { useStore } from "../store.ts";

const DUTY_CN: Record<string, string> = { duelist: "决斗者", initiator: "先锋", controller: "控场", sentinel: "哨卫" };

function dutyOf(state: GameState, playerId: string): string {
  const p = state.players[playerId]!;
  const sum = { duelist: 0, initiator: 0, controller: 0, sentinel: 0 };
  let w = 0;
  for (const agentId of p.agentPool) {
    const a = AGENT_BY_ID.get(agentId);
    if (!a) continue;
    const pro = p.agentPro[agentId] ?? 0;
    for (const k of ["duelist", "initiator", "controller", "sentinel"] as const) sum[k] += a.duty[k] * pro;
    w += pro;
  }
  if (w <= 0) return "—";
  let best = "duelist";
  let bestV = -1;
  for (const k of ["initiator", "controller", "sentinel", "duelist"] as const) {
    if (sum[k] / w > bestV) {
      bestV = sum[k] / w;
      best = k;
    }
  }
  return DUTY_CN[best] ?? "—";
}

function VitalBar({ v, color }: { v: number; color: string }) {
  return (
    <span className="bar-track" title={String(Math.round(v))}>
      <span className="bar-fill" style={{ width: `${Math.max(0, Math.min(100, v))}%`, background: color }} />
    </span>
  );
}

export function SquadPage(props: { state: GameState }) {
  const { state } = props;
  const setStarters = useStore((s) => s.setStarters);
  const myId = state.myTeamId ?? "";
  const team = state.teams[myId];
  const [swapTarget, setSwapTarget] = useState<string | null>(null);
  if (!team) return null;

  const roster = team.roster.map((pid) => state.players[pid]!);
  const starters = team.starters;
  const bench = roster.filter((p) => !starters.includes(p.id));

  const swap = (outId: string, inId: string) => {
    const next = starters.filter((id) => id !== outId).concat(inId);
    void setStarters(next);
    setSwapTarget(null);
  };

  return (
    <div>
      <div className="card">
        <h3>👥 首发五人（{team.name}）</h3>
        <table>
          <thead>
            <tr><th>选手</th><th>位置</th><th>英雄池</th><th>能力</th><th>潜力</th><th>状态</th><th>士气</th><th>体能</th><th>年薪</th><th>合同</th></tr>
          </thead>
          <tbody>
            {starters.map((pid) => {
              const p = state.players[pid]!;
              return (
                <tr key={pid} className="me">
                  <td>
                    {p.ign}
                    {p.isIgl && <span className="tag" style={{ marginLeft: 6 }}>指挥</span>}
                  </td>
                  <td className="muted">{dutyOf(state, pid)}</td>
                  <td className="muted small">{p.agentPool.map((a) => AGENT_BY_ID.get(a)?.name ?? a).join(" / ")}</td>
                  <td><b>{p.overall}</b></td>
                  <td className="muted">{p.potential}</td>
                  <td><VitalBar v={p.form} color="var(--green)" /></td>
                  <td><VitalBar v={p.morale} color="var(--blue)" /></td>
                  <td><VitalBar v={100 - p.fatigue} color={p.fatigue > 70 ? "var(--accent)" : "var(--orange)"} /></td>
                  <td className="muted">${(p.salary / 1000).toFixed(0)}K</td>
                  <td className="muted">{p.contractYears} 年</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>🪑 替补席（轮换时用「轮换沟通」尽量提前打招呼——GDD §6.4）</h3>
        <table>
          <thead>
            <tr><th>选手</th><th>位置</th><th>能力</th><th>潜力</th><th>状态</th><th>连续板凳</th><th>操作</th></tr>
          </thead>
          <tbody>
            {bench.map((p) => (
              <tr key={p.id}>
                <td>{p.ign}</td>
                <td className="muted">{dutyOf(state, p.id)}</td>
                <td><b>{p.overall}</b></td>
                <td className="muted">{p.potential}</td>
                <td>{Math.round(p.form)}</td>
                <td className="muted">{p.benchedWeeks} 周</td>
                <td>
                  {swapTarget === p.id ? (
                    <select
                      defaultValue=""
                      onChange={(e) => e.target.value && swap(e.target.value, p.id)}
                      autoFocus
                    >
                      <option value="">换下谁…</option>
                      {starters.map((sid) => (
                        <option key={sid} value={sid}>
                          {state.players[sid]?.ign}（{state.players[sid]?.overall}）
                        </option>
                      ))}
                    </select>
                  ) : (
                    <button className="small" onClick={() => setSwapTarget(p.id)}>
                      提上首发
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="muted small" style={{ marginTop: 8 }}>
          名单上限 7 人 · 替补长期坐板凳会被其他俱乐部盯上
        </div>
      </div>
    </div>
  );
}
