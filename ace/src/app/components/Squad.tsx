import { useState } from "react";
import type { GameState } from "../../core/types.ts";
import { AGENT_BY_ID } from "../../core/data/agents.ts";
import { useStore } from "../store.ts";
import { PlayerFace, SyntheticBadge } from "./Avatar.tsx";
import { PlayerDossier } from "./PlayerDossier.tsx";

const DUTY_CN: Record<string, string> = { duelist: "决斗者", initiator: "先锋", controller: "控场", sentinel: "哨卫" };
const ROLE_CN: Record<string, string> = { core: "核心", starter: "首发", rotation: "轮换", bench: "替补" };

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
  const requestRotationTalk = useStore((s) => s.requestRotationTalk);
  const myId = state.myTeamId ?? "";
  const team = state.teams[myId];
  const [swapTarget, setSwapTarget] = useState<string | null>(null);
  const [dossier, setDossier] = useState<string | null>(null);
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
                  <td style={{ whiteSpace: "nowrap" }}>
                    <span className="row" style={{ alignItems: "center", gap: 6 }}>
                      <PlayerFace p={p} size={26} />
                      <span style={{ cursor: "pointer", textDecoration: "underline dotted" }} onClick={() => setDossier(p.id)}>{p.ign}<SyntheticBadge p={p} />{p.isIgl && <span className="tag" style={{ marginLeft: 6 }}>指挥</span>}</span>
                    </span>
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
        <h3>🪑 替补席（轮换时用「轮换沟通」尽量提前打招呼）</h3>
        <table>
          <thead>
            <tr><th>选手</th><th>位置</th><th>能力</th><th>潜力</th><th>状态</th><th>连续板凳</th><th>操作</th></tr>
          </thead>
          <tbody>
            {bench.map((p) => (
              <tr key={p.id}>
                <td style={{ whiteSpace: "nowrap" }}><span className="row" style={{ alignItems: "center", gap: 6 }}><PlayerFace p={p} size={22} /><span style={{ cursor: "pointer", textDecoration: "underline dotted" }} onClick={() => setDossier(p.id)}>{p.ign}</span><SyntheticBadge p={p} /></span></td>
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
          {state.rotationTalks.used > 0 && <> · 本周已沟通 {state.rotationTalks.used}/2 次</>}
        </div>
      </div>

      <div className="card">
        <h3>🔄 轮换沟通（本周 {state.rotationTalks.used}/2 次）</h3>
        <div className="muted small" style={{ marginBottom: 8 }}>
          赛前与将被轮换的选手沟通（每周 2 次）：沟通后他本周不因轮换扣士气。核心/首发承诺的选手坐板凳，每周士气 −3。
        </div>
        {team.roster
          .filter((pid) => !team.starters.includes(pid))
          .map((pid) => {
            const p = state.players[pid]!;
            const waived = state.rotationWaive.includes(pid);
            return (
              <div key={pid} className="row" style={{ padding: "5px 0", borderBottom: "1px dashed var(--line)" }}>
                <span className="row" style={{ alignItems: "center", gap: 6, width: 118 }}><PlayerFace p={p} size={24} /><b>{p.ign}</b><SyntheticBadge p={p} /></span>
                <span className="muted small grow">
                  {waived ? "✅ 本周已沟通轮换" : `承诺：${ROLE_CN[p.promisedRole] ?? p.promisedRole} · 疲劳 ${Math.round(p.fatigue)}`}
                </span>
                <button
                  className="small"
                  disabled={waived || state.rotationTalks.used >= 2}
                  onClick={() => void requestRotationTalk(pid)}
                >
                  轮换沟通
                </button>
              </div>
            );
          })}
      </div>
      {dossier && state.players[dossier] && (
        <PlayerDossier state={state} player={state.players[dossier]!} onClose={() => setDossier(null)} />
      )}
    </div>
  );
}