import { useState } from "react";
import type { GameState, Player, Preset } from "../../core/types.ts";
import { AGENT_BY_ID, AGENTS } from "../../core/data/agents.ts";
import { MAPS } from "../../core/data/maps.ts";
import { useStore } from "../store.ts";
import { PlayerDossier } from "./PlayerDossier.tsx";

const DUTY_CN: Record<string, string> = { duelist: "决斗者", initiator: "先锋", controller: "控场", sentinel: "哨卫" };

/** 战术页（GDD §7.1 v1.3）：每图多预案（快照）+ 首选 + 替补智能适配提示 + 轮换 */
export function TacticsPage(props: { state: GameState }) {
  const { state } = props;
  const { setPreset, applyPreset, setStarters } = useStore();
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
    void setStarters(team.starters.filter((id) => id !== outId).concat(inId));
    setPendingOut(null);
  };

  // 当前生效的英雄分配：首选预案优先，否则草稿（缺省自动）
  const currentAgents: Record<string, string> = {};
  if (preferred) Object.assign(currentAgents, preferred.agents);
  for (const p of starters) if (!currentAgents[p.id]) currentAgents[p.id] = draft[p.id] ?? bestAgentOf(p);

  /** 位置倾向（主职业+副职业，参照原作）：英雄池按熟练度加权的职责向量取前二 */
  const dutyTendency = (p: Player): { main: string; second: string | null } => {
    const sum = { duelist: 0, initiator: 0, controller: 0, sentinel: 0 };
    let w = 0;
    for (const agentId of p.agentPool) {
      const a = AGENT_BY_ID.get(agentId);
      if (!a) continue;
      const pro = p.agentPro[agentId] ?? 0;
      for (const k of ["duelist", "initiator", "controller", "sentinel"] as const) sum[k] += a.duty[k] * pro;
      w += pro;
    }
    if (w <= 0) return { main: "—", second: null };
    const ranked = (Object.keys(sum) as (keyof typeof sum)[]).sort((x, y) => sum[y] / w - sum[x] / w);
    const main = ranked[0]!;
    const second = ranked[1]!;
    // 副职业：份额 ≥ 主职业 40% 才显示（防止凑数第二）
    return { main: DUTY_CN[main] ?? main, second: sum[second] / w >= (sum[main] / w) * 0.4 ? DUTY_CN[second] ?? second : null };
  };
  const appoint = useStore((s) => s.appointCommander);
  const mainIgl = team.starters.find((pid) => state.players[pid]?.isIgl) ?? null;
  const viceIgl = team.starters.find((pid) => state.players[pid]?.viceIgl) ?? null;

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
      <div className="card">
        <h3>🗺 每图预案 · {map.name}
          <span className="muted small" style={{ marginLeft: 10 }}>
            图池熟练 {Math.round(team.mapPref[mapId] ?? 50)} / 95 · 每图最多 8 套预案（GDD §7.1）
          </span>
        </h3>
        <div className="row" style={{ marginBottom: 12, flexWrap: "wrap" }}>
          {MAPS.map((m) => (
            <button key={m.id} className={m.id === mapId ? "primary" : ""} onClick={() => { setMapId(m.id); setAdaptMsg(null); }}>
              {m.name} <span className="muted small">{Math.round(team.mapPref[m.id] ?? 50)}</span>
            </button>
          ))}
        </div>

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
                  <td>
                    <span
                      style={{ cursor: "pointer", textDecoration: pendingOut === p.id ? "line-through" : "underline dotted" }}
                      onClick={() => setDossier(p.id)}
                    >
                      {p.ign}
                    </span>
                    {p.isIgl && <span className="tag" style={{ marginLeft: 6 }}>主指挥</span>}
                    {p.viceIgl && <span className="tag" style={{ marginLeft: 6 }}>副指挥</span>}
                    {pendingOut === p.id && <span className="tag orange" style={{ marginLeft: 6 }}>待换下</span>}
                  </td>
                  <td className="small">
                    <span className="tag">{dutyTendency(p).main}</span>
                    {dutyTendency(p).second && <span className="muted small" style={{ marginLeft: 6 }}>{dutyTendency(p).second}</span>}
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

        <div className="card" style={{ padding: "10px 14px", marginTop: 12 }}>
          <h3 style={{ marginBottom: 8 }}>🎖 场上指挥（主指挥恰 1 名 · 副指挥至多 1 名，可空）</h3>
          <div className="row" style={{ gap: 18, flexWrap: "wrap" }}>
            <span className="row" style={{ gap: 8, alignItems: "center" }}>
              <span className="muted small">主指挥</span>
              <select
                value={mainIgl ?? ""}
                onChange={(e) => void appoint(e.target.value, viceIgl !== e.target.value ? viceIgl : null)}
              >
                {team.starters.map((pid) => (
                  <option key={pid} value={pid}>{state.players[pid]?.ign}（指挥属性 {state.players[pid]?.attrs.igl}）</option>
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
                  <option key={pid} value={pid}>{state.players[pid]?.ign}（指挥属性 {state.players[pid]?.attrs.igl}）</option>
                ))}
              </select>
            </span>
            <span className="muted small">副指挥提供小幅逆境追分加成（其指挥属性的低权重计入）。</span>
          </div>
        </div>

        <div className="row" style={{ marginTop: 10, flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <span className="muted small">轮换：</span>
          {bench.map((p) =>
            pendingOut ? (
              <button key={p.id} className="small" onClick={() => swap(pendingOut, p.id)}>
                {p.ign} ⇄ 换下 {state.players[pendingOut]?.ign}
              </button>
            ) : (
              <select
                key={p.id}
                className="small"
                defaultValue=""
                onChange={(e) => e.target.value && swap(e.target.value, p.id)}
                title={"提上 " + p.ign + "（选择换下谁）"}
              >
                <option value="">{"提上 " + p.ign + "：换下谁…"}</option>
                {team.starters.map((sid) => (
                  <option key={sid} value={sid}>
                    {state.players[sid]?.ign}（{state.players[sid]?.overall}）
                  </option>
                ))}
              </select>
            ),
          )}
          {!bench.length && <span className="muted small">替补席无人。</span>}
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
