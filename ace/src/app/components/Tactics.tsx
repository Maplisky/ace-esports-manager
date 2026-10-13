import { useState } from "react";
import type { GameState, Preset } from "../../core/types.ts";
import { AGENT_BY_ID, AGENTS } from "../../core/data/agents.ts";
import { MAPS } from "../../core/data/maps.ts";
import { useStore } from "../store.ts";

/** 战术页（GDD §7.1 v1.3）：每图多预案（快照）+ 首选 + 替补智能适配提示 */
export function TacticsPage(props: { state: GameState }) {
  const { state } = props;
  const { setPreset, applyPreset } = useStore();
  const myId = state.myTeamId ?? "";
  const team = state.teams[myId];
  const [mapId, setMapId] = useState(MAPS[0]!.id);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [presetName, setPresetName] = useState("");
  const [adaptMsg, setAdaptMsg] = useState<string | null>(null);
  if (!team) return null;

  const map = MAPS.find((m) => m.id === mapId)!;
  const presets = team.presets[mapId] ?? [];
  const preferred = presets.find((p) => p.preferred) ?? presets[0];
  const starters = team.starters.map((pid) => state.players[pid]!);

  // 当前生效的英雄分配：首选预案优先，否则草稿（缺省自动）
  const currentAgents: Record<string, string> = {};
  if (preferred) Object.assign(currentAgents, preferred.agents);
  for (const p of starters) if (!currentAgents[p.id]) currentAgents[p.id] = draft[p.id] ?? bestAgentOf(p);

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
      setAdaptMsg(`替补 ${bench.ign} 上位：建议改用「${AGENT_BY_ID.get(best.a)?.name}」（熟练 ${best.pro}%），其余预案槽位不受影响。`);
    }
    void outId;
  };

  return (
    <div>
      <div className="card">
        <h3>🗺 每图预案 · {map.name}
          <span className="muted small" style={{ marginLeft: 10 }}>
            图池熟练 {team.mapPref[mapId] ?? 50} / 95 · 每图最多 8 套预案（GDD §7.1）
          </span>
        </h3>
        <div className="row" style={{ marginBottom: 12, flexWrap: "wrap" }}>
          {MAPS.map((m) => (
            <button key={m.id} className={m.id === mapId ? "primary" : ""} onClick={() => { setMapId(m.id); setAdaptMsg(null); }}>
              {m.name} <span className="muted small">{team.mapPref[m.id] ?? 50}</span>
            </button>
          ))}
        </div>

        <table>
          <thead>
            <tr><th>选手</th><th>位置倾向</th><th>本图英雄</th><th>熟练度</th></tr>
          </thead>
          <tbody>
            {starters.map((p) => {
              const current = currentAgents[p.id] ?? p.agentPool[0] ?? "omen";
              const pro = p.agentPro[current] ?? 0;
              const offDuty = isOffDuty(p, current);
              return (
                <tr key={p.id}>
                  <td>{p.ign}{p.isIgl && <span className="tag" style={{ marginLeft: 6 }}>指挥</span>}</td>
                  <td className="muted small">{p.agentPool.map((a) => AGENT_BY_ID.get(a)?.name).join(" / ")}</td>
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
                    <span className={pro >= 60 ? "tag green" : pro >= 34 ? "tag orange" : "tag red"}>{pro}%</span>
                    {offDuty && <span className="tag red" style={{ marginLeft: 6 }}>错位</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

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
    </div>
  );
}

/** 替补智能适配入口（选中替补 → 给出英雄建议）——供 Squad 页未来联动 */
export function smartAdaptHint(state: GameState, benchId: string): string {
  const bench = state.players[benchId]!;
  const best = bench.agentPool.map((a) => ({ a, pro: bench.agentPro[a] ?? 0 })).sort((x, y) => y.pro - x.pro)[0];
  return best ? `${bench.ign} 最熟练英雄：${AGENT_BY_ID.get(best.a)?.name}（${best.pro}%）` : "";
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
