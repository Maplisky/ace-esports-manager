import { useState } from "react";
import type { GameState, Preset } from "../../core/types.ts";
import { AGENT_BY_ID, AGENTS } from "../../core/data/agents.ts";
import { MAPS } from "../../core/data/maps.ts";
import { useStore } from "../store.ts";
import { PlayerDossier } from "./PlayerDossier.tsx";
import { PlayerFace, SyntheticBadge } from "./Avatar.tsx";
import { DutyTendency } from "./AgentSelect.tsx";

const DUTY_CN: Record<string, string> = { duelist: "决斗者", initiator: "先锋", controller: "控场", sentinel: "哨卫" };

/** 战术页（GDD §7.1 v1.3）：每图多预案（快照）+ 首选 + 替补智能适配提示 + 轮换 */
export function TacticsPage(props: { state: GameState }) {
  const { state } = props;
  const { setPreset, applyPreset, setStarters, setMentor } = useStore();
  const myId = state.myTeamId ?? "";
  const team = state.teams[myId];
  const [mapId, setMapId] = useState(MAPS[0]!.id);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [dossier, setDossier] = useState<string | null>(null);
  const [pendingOut, setPendingOut] = useState<string | null>(null);
  const [presetName, setPresetName] = useState("");
  const [adaptMsg, setAdaptMsg] = useState<string | null>(null);
  if (!team) return null;

  const map = MAPS.find((m) => m.id === mapId)!;
  const presets = team.presets[mapId] ?? [];
  const preferred = presets.find((p) => p.preferred) ?? presets[0];
  const starters = team.starters.map((pid) => state.players[pid]!);
  const bench = team.roster.map((pid) => state.players[pid]!).filter((p) => !team.starters.includes(p.id));
  const swap = (outId: string, inId: string) => {
    // 防幽灵换人：跨页操作（转会/解约）可能已让 outId 离队——此时拒绝并清标记，避免「直接签入」式超员
    if (!team.starters.includes(outId)) {
      setPendingOut(null);
      setAdaptMsg("待换下的选手已不在首发（可能已被交易/解约），轮换取消。");
      return;
    }
    void setStarters(team.starters.filter((id) => id !== outId).concat(inId));
    setPendingOut(null);
  };

  // 状态条（与阵容页同款）
  const VitalBar = ({ v, color }: { v: number; color: string }) => (
    <span className="bar-track" title={String(Math.round(v))}>
      <span className="bar-fill" style={{ width: `${Math.max(0, Math.min(100, v))}%`, background: color }} />
    </span>
  );

  // 当前生效的英雄分配：首选预案优先，否则草稿（缺省自动）
  const currentAgents: Record<string, string> = {};
  if (preferred) Object.assign(currentAgents, preferred.agents);
  for (const p of starters) if (!currentAgents[p.id]) currentAgents[p.id] = draft[p.id] ?? bestAgentOf(p);

  const appoint = useStore((s) => s.appointCommander);
  // 指挥身份随选手走（可能在替补席）——任命卡显示全队现状，选下拉则重新任命到首发
  const mainIglAll = team.roster.find((pid) => state.players[pid]?.isIgl) ?? null;
  const viceIglAll = team.roster.find((pid) => state.players[pid]?.viceIgl) ?? null;
  const mainIgl = team.starters.includes(mainIglAll ?? "") ? mainIglAll : null;
  const viceIgl = team.starters.includes(viceIglAll ?? "") ? viceIglAll : null;
  const benchIglNote = mainIglAll && !mainIgl ? `现任主指挥 ${state.players[mainIglAll]?.ign} 在替补席——替补上场时才生效。` : null;

  const mapFit = (agentId: string) => {
    void agentId;
    return null; // v0.5：fit 数值可视化
  };
  void mapFit;

  const save = () => {
    const name = presetName.trim() || `预案${presets.length + 1}`;
    const preset: Preset = { name, agents: { ...currentAgents }, preferred: presets.length === 0 };
    void setPreset(mapId, preset);
    setPresetName("");
  };

  /** 替补智能适配（GDD §7.1）：按替补职责为草案中缺席的选手换英雄建议 */
  const smartAdapt = (benchId: string, outId: string) => {
    const bench = state.players[benchId]!;
    const best = bench.agentPool
      .map((a) => ({ a, pro: bench.agentPro[a] ?? 0 }))
      .sort((x, y) => y.pro - x.pro)[0];
    if (best) {
      setDraft((d) => ({ ...d, [benchId]: best.a }));
      setAdaptMsg(`替补 ${bench.ign} 上位：建议改用「${AGENT_BY_ID.get(best.a)?.name}」（熟练 ${Math.round(best.pro * 10) / 10}%），其余预案槽位不受影响。`);
    }
    void outId;
  };

  return (
    <div>
      <div className="card" data-tut="tut-tactics-presets">
        <h3>🗺 每图预案 · {map.name}
          <span className="muted small" style={{ marginLeft: 10 }}>
            图池熟练 {Math.round(team.mapPref[mapId] ?? 50)} / 95 · 每图最多 8 套预案
          </span>
        </h3>
        <div className="row" style={{ marginBottom: 12, flexWrap: "wrap" }} data-tut="tut-tactics-leak">
          {MAPS.map((m) => {
            // 被摸透度（对齐原作）：同一预案连用越多，对手针对性越强（引擎 leak = min(1.2, usage×0.12)）
            const usage = team.patternUsage[m.id] ?? 0;
            const readPct = Math.min(100, Math.round((usage / 10) * 100));
            return (
              <button key={m.id} className={m.id === mapId ? "primary" : ""} onClick={() => { setMapId(m.id); setAdaptMsg(null); }}
                title={usage >= 3 ? `这套打法已连用 ${usage} 场，被摸透 ${readPct}%——换一两个英雄，对手准备就白做一部分` : undefined}>
                {m.name} <span className="muted small">{Math.round(team.mapPref[m.id] ?? 50)}</span>
                {readPct >= 30 && <span className="tag" style={{ marginLeft: 4, color: readPct >= 70 ? "#f87171" : readPct >= 50 ? "#fb923c" : "#fbbf24" }}>摸透 {readPct}%</span>}
              </button>
            );
          })}
        </div>
        {(team.patternUsage[mapId] ?? 0) >= 3 && (
          <div className="muted small" style={{ marginBottom: 10 }}>
            ⚠ 这张图的预案被研究透了（连用 {team.patternUsage[mapId]} 场，被摸透 {Math.min(100, Math.round(((team.patternUsage[mapId] ?? 0) / 10) * 100))}%）。换一两个英雄，或赛前去赛前准备换个打法，对手的针对性准备就白做一部分。
          </div>
        )}

        <table>
          <thead>
            <tr><th>选手</th><th>位置倾向</th><th>本图英雄</th><th>熟练度</th><th></th></tr>
          </thead>
          <tbody>
            {starters.map((p) => {
              const current = currentAgents[p.id] ?? p.agentPool[0] ?? "omen";
              const pro = p.agentPro[current] ?? 0;
              const offDuty = isOffDuty(p, current);
              return (
                <tr key={p.id}>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <span className="row" style={{ alignItems: "center", gap: 6 }}>
                      <PlayerFace p={p} size={22} showTag={false} />
                      <span
                        style={{ cursor: "pointer", textDecoration: pendingOut === p.id ? "line-through" : "underline dotted" }}
                        onClick={() => setDossier(p.id)}
                      >
                        {p.ign}
                      </span>
                      <SyntheticBadge p={p} />
                    </span>
                    {p.isIgl && <span className="tag" style={{ marginLeft: 6 }}>主指挥</span>}
                    {p.viceIgl && <span className="tag" style={{ marginLeft: 6 }}>副指挥</span>}
                    {pendingOut === p.id && <span className="tag orange" style={{ marginLeft: 6 }}>待换下</span>}
                  </td>
                  <td className="small">
                    <DutyTendency p={p} />
                    
                  </td>
                  <td>
                    <select
                      value={current}
                      onChange={(e) => setDraft((d) => ({ ...d, [p.id]: e.target.value }))}
                    >
                      {AGENTS.filter((a) => p.agentPool.includes(a.id)).map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}（{dutyCn(a.mechTags)}）
                        </option>
                      ))}
                      {!p.agentPool.includes(current) && <option value={current}>{AGENT_BY_ID.get(current)?.name}（越池）</option>}
                    </select>
                  </td>
                  <td>
                    <span className={pro >= 60 ? "tag green" : pro >= 34 ? "tag orange" : "tag red"}>{Math.round(pro * 10) / 10}%</span>
                    {offDuty && <span className="tag red" style={{ marginLeft: 6 }}>错位</span>}
                    <button
                      className="small"
                      style={{ marginLeft: 8 }}
                      onClick={() => setPendingOut(pendingOut === p.id ? null : p.id)}
                    >
                      {pendingOut === p.id ? "取消" : "换下"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="card" style={{ padding: "10px 14px", marginTop: 12 }} data-tut="tut-tactics-igl">
          <h3 style={{ marginBottom: 8 }}>🎖 场上指挥（主指挥恰 1 名 · 副指挥至多 1 名，可空）</h3>
          <div className="row" style={{ gap: 18, flexWrap: "wrap" }}>
            <span className="row" style={{ gap: 8, alignItems: "center" }}>
              <span className="muted small">主指挥</span>
              <select
                value={mainIgl ?? ""}
                onChange={(e) => void appoint(e.target.value, viceIgl !== e.target.value ? viceIgl : null)}
              >
                {team.starters.map((pid) => (
                  <option key={pid} value={pid}>{state.players[pid]?.ign}（指挥属性 {Math.round(state.players[pid]?.attrs.igl ?? 0)}）</option>
                ))}
              </select>
            </span>
            <span className="row" style={{ gap: 8, alignItems: "center" }}>
              <span className="muted small">副指挥</span>
              <select
                value={viceIgl ?? ""}
                onChange={(e) => void appoint(mainIgl ?? team.starters[0]!, e.target.value || null)}
              >
                <option value="">（无）</option>
                {team.starters.filter((pid) => pid !== mainIgl).map((pid) => (
                  <option key={pid} value={pid}>{state.players[pid]?.ign}（指挥属性 {Math.round(state.players[pid]?.attrs.igl ?? 0)}）</option>
                ))}
              </select>
            </span>
            <span className="muted small">副指挥提供小幅逆境追分加成（其指挥属性的低权重计入）。</span>
          </div>
          {benchIglNote && <div className="small" style={{ marginTop: 6, color: "var(--orange)" }}>⚠ {benchIglNote}</div>}
          </div>

        <div className="card" style={{ padding: "10px 14px", marginTop: 12, background: "rgba(255,255,255,0.02)" }}>
          <h3 style={{ marginBottom: 8 }}>🪑 替补席 · 轮换（点「提上首发」后选择换下谁；与阵容页共用名单状态）</h3>
          <table>
            <thead>
              <tr><th>选手</th><th>位置倾向</th><th>能力</th><th>状态</th><th>年龄</th><th>操作</th></tr>
            </thead>
            <tbody>
              {bench.map((p) => (
                <tr key={p.id}>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <span className="row" style={{ alignItems: "center", gap: 6 }}>
                      <PlayerFace p={p} size={22} showTag={false} />
                      <span style={{ cursor: "pointer", textDecoration: "underline dotted" }} onClick={() => setDossier(p.id)}>{p.ign}</span>
                      <SyntheticBadge p={p} />
                    </span>
                    {p.track && (
                      <span className="muted small" style={{ display: "block", marginTop: 2 }}>
                        {p.track === "successor" && <>🧬 接班人{p.mentorId && state.players[p.mentorId] ? ` · 导师 ${state.players[p.mentorId]!.ign}` : " · 未指派导师"}</>}
                        {p.track === "mentor" && `🎓 导师型替补${p.mentorSince ? `（${p.mentorSince} 起）` : ""}`}
                        {p.track === "learner" && "📚 学习型替补"}
                      </span>
                    )}
                    {p.track === "successor" && !p.mentorId && (
                      <select
                        className="small"
                        defaultValue=""
                        style={{ marginTop: 3, maxWidth: 170 }}
                        onChange={(e) => e.target.value && void setMentor(p.id, e.target.value)}
                      >
                        <option value="">指派导师（首发 ≥27 岁）…</option>
                        {starters.filter((sp) => sp.age >= 27).map((sp) => (
                          <option key={sp.id} value={sp.id}>{sp.ign}（{sp.age} 岁）</option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="small" style={{ whiteSpace: "nowrap" }}>
                    <DutyTendency p={p} />
                    
                  </td>
                  <td><b>{p.overall}</b></td>
                  <td style={{ minWidth: 70 }}><VitalBar v={p.form} color="var(--green)" /></td>
                  <td className="muted">{p.age}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {pendingOut ? (
                      <button className="small primary" onClick={() => swap(pendingOut, p.id)}>
                        {p.ign} ⇄ 换下 {state.players[pendingOut]?.ign}
                      </button>
                    ) : (
                      <select
                        className="small"
                        defaultValue=""
                        onChange={(e) => e.target.value && swap(e.target.value, p.id)}
                        title={"提上 " + p.ign + "（选择换下谁）"}
                      >
                        <option value="">{"提上首发：换下谁…"}</option>
                        {team.starters.map((sid) => (
                          <option key={sid} value={sid}>
                            {state.players[sid]?.ign}（{state.players[sid]?.overall}）
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                </tr>
              ))}
              {!bench.length && (
                <tr><td colSpan={6} className="muted small">替补席无人。</td></tr>
              )}
            </tbody>
          </table>
          <div className="muted small" style={{ marginTop: 6 }}>
            先在上方首发表点「换下」标记待换对象，再点这里「⇄ 换下」一键完成；名单上限 7 人。
          </div>
        </div>

        <div className="row" style={{ marginTop: 12 }}>
          <input
            placeholder="预案名（如：打 DRG 用）"
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            style={{ width: 180 }}
          />
          <button className="primary" onClick={save}>💾 保存为预案</button>
          <button onClick={() => setAdaptMsg(null)}>
            恢复默认分配
          </button>
        </div>
        {adaptMsg && <div className="small" style={{ marginTop: 8, color: "var(--blue)" }}>{adaptMsg}</div>}
      </div>

      <div className="card">
        <h3>📂 已存预案（{presets.length}/8）</h3>
        {presets.length === 0 && <div className="muted small">还没有保存预案。调好上图英雄后点「保存为预案」。</div>}
        {presets.map((p) => (
          <div key={p.name} className="row" style={{ padding: "6px 0", borderBottom: "1px dashed var(--line)" }}>
            <b style={{ width: 140 }}>
              {p.name}
              {p.preferred && <span className="tag green" style={{ marginLeft: 6 }}>首选</span>}
            </b>
            <span className="muted small grow">
              {starters.map((s) => `${s.ign}:${AGENT_BY_ID.get(p.agents[s.id] ?? "")?.name ?? "?"}`).join(" · ")}
            </span>
            <button className="small" onClick={() => void applyPreset(mapId, p.name)}>套用</button>
          </div>
        ))}
      </div>
      {dossier && state.players[dossier] && (
        <PlayerDossier state={state} player={state.players[dossier]!} onClose={() => setDossier(null)} />
      )}
    </div>
  );
}

function bestAgentOf(p: GameState["players"][string]): string {
  let best = p.agentPool[0] ?? "omen";
  let bestPro = -1;
  for (const a of p.agentPool) {
    const pro = p.agentPro[a] ?? 0;
    if (pro > bestPro) {
      bestPro = pro;
      best = a;
    }
  }
  return best;
}

function isOffDuty(p: GameState["players"][string], agentId: string): boolean {
  const a = AGENT_BY_ID.get(agentId);
  if (!a) return false;
  // 主职责英雄池：英雄主职责与选手英雄池主职责向量夹角过大暂不判错位（v0.5 引入职责覆盖计算）
  void a;
  return false;
}

function dutyCn(tags: string[]): string {
  const map: Record<string, string> = {
    recon: "侦察", smoke: "烟幕", flash: "闪光", mobility: "机动",
    anchor: "哨位", heal: "治疗", entry: "强开", suppress: "反制", area: "区域",
  };
  return tags.map((t) => map[t] ?? t).join("/");
}
