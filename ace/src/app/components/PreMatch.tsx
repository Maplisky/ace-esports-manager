/**
 * 赛前准备（GDD §5.5 BP + 原作赛前界面结构）：
 * 阵容确认（可换替补）→ 自动 BP 预览/手动 BP → 每图英雄确认 → 开赛（观战/快进）。
 * 我的比赛日前弹出；确定后由引擎消费选择。
 */
import { useMemo, useState } from "react";
import type { GameState, Player } from "../../core/types.ts";
import { AGENTS, AGENT_BY_ID } from "../../core/data/agents.ts";
import { MAPS } from "../../core/data/maps.ts";
import { intelOf, estimateMapStrength, starsOf } from "../../core/sim/intel.ts";

export interface PreMatchResult {
  /** 首发名单（玩家确认后的 5 人） */
  starters: string[];
  /** 手动 BP 的图序列（空 = 自动 BP） */
  manualMaps: string[] | null;
  /** 每图英雄分配（mapId → playerId → agentId；缺省用预案/自动） */
  agentPicks: Record<string, Record<string, string>>;
  /** 直接快进 */
  fastForward: boolean;
}

export function PreMatch(props: {
  state: GameState;
  fixtureId: string;
  teamAId: string;
  teamBId: string;
  bo: 1 | 3 | 5;
  label: string;
  onConfirm: (r: PreMatchResult) => void;
}) {
  const { state, teamAId, teamBId, bo, label, onConfirm } = props;
  const myId = state.myTeamId ?? "";
  const myTeam = state.teams[myId];
  const opp = state.teams[teamAId === myId ? teamBId : teamAId];
  const [step, setStep] = useState<0 | 1 | 2>(0); // 0 阵容 1 BP 2 英雄
  const [starters, setStarters] = useState<string[]>(() => (myTeam ? myTeam.starters.slice() : []));
  const [manual, setManual] = useState<string[] | null>(null);
  const [picks, setPicks] = useState<Record<string, Record<string, string>>>({});

  if (!myTeam || !opp) return null;

  const roster = myTeam.roster.map((pid) => state.players[pid]!);
  const injured = (p: Player) => p.injuredUntilDay > state.day;
  const starterPlayers = starters.map((pid) => state.players[pid]!).filter(Boolean);

  // AI 自动 BP 预览（与引擎 veto 同逻辑的展示版）
  const autoPreview = useMemo(() => {
    return suggestVeto(state, myTeam.id, opp.id, bo);
  }, [state, myTeam.id, opp.id, bo]);

  const need = bo === 1 ? 1 : bo === 3 ? 3 : 5;
  const activeMaps = manual ?? autoPreview;

  const confirm = (fastForward: boolean) => {
    // 所见即所得：BP 步展示的图序即正式图序（未手动改动时锁定自动推荐，引擎不再重掷）
    onConfirm({ starters, manualMaps: activeMaps.slice(), agentPicks: picks, fastForward });
  };

  return (
    <div className="viewer-backdrop">
      <div className="viewer" style={{ width: "min(880px, 94vw)" }}>
        <div className="scorebug">
          <div className="team" style={{ color: "var(--accent)" }}>{myTeam.tag}</div>
          <div className="mid">
            <div className="muted small">{label}</div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>BO{bo} · 赛前准备</div>
          </div>
          <div className="team right">{opp.tag}</div>
        </div>

        {/* 步骤条 */}
        <div className="row" style={{ justifyContent: "center", gap: 18, marginBottom: 12 }}>
          {["① 阵容", "② BP", "③ 英雄"].map((s, i) => (
            <span key={s} className={step === i ? "" : "muted"} style={{ fontWeight: step === i ? 700 : 400 }}>{s}</span>
          ))}
        </div>

        {step === 0 && (
          <div>
            <table>
              <thead>
                <tr><th>选手</th><th>能力</th><th>状态</th><th>体能</th><th>伤病</th><th></th></tr>
              </thead>
              <tbody>
                {roster.map((p) => {
                  const on = starters.includes(p.id);
                  return (
                    <tr key={p.id} className={on ? "me" : ""}>
                      <td>{p.ign}{p.isIgl && <span className="tag" style={{ marginLeft: 6 }}>指挥</span>}</td>
                      <td>{p.overall}</td>
                      <td>{Math.round(p.form)}</td>
                      <td>{Math.round(p.fatigue)}</td>
                      <td>{injured(p) ? <span className="tag red">缺阵</span> : <span className="muted small">健康</span>}</td>
                      <td>
                        <button
                          className="small"
                          disabled={injured(p) && !on}
                          onClick={() => {
                            // 允许 <5 的中间态：先换下再补人；人数 ≠5 时禁止进入 BP（GDD §5.5）
                            if (on) setStarters(starters.filter((x) => x !== p.id));
                            else if (starters.length < 5) setStarters([...starters, p.id]);
                          }}
                        >
                          {on ? "换下" : "首发"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="muted small" style={{ margin: "8px 0" }}>
              首发需恰好 5 人{starters.length !== 5 && <span className="tag orange" style={{ marginLeft: 6 }}>当前 {starters.length} 人，先调整到 5 人</span>} · 带伤上场的选手强度 −20%（GDD §5.2）
            </div>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="primary" disabled={starters.length !== 5} onClick={() => setStep(1)}>下一步：BP →</button>
            </div>
          </div>
        )}

        {step === 1 && (
          <div>
            <div className="muted small" style={{ marginBottom: 8 }}>
              自动 BP 按双方图池熟练推荐（ban 对方强图、pick 我方强图）。手动可改，决胜图仍随机。
              {(() => {
                const intel = intelOf(state, opp.id);
                const base = intel === 0 ? " 尚未侦察对手——看不到他们的图池评估。" : "";
                // 招牌战术反向泄露提示（GDD §6.4）：同一预案重复使用 → 对手针对性提升
                const usage = myTeam.patternUsage[activeMaps[0] ?? ""] ?? 0;
                const leak = usage >= 3 ? ` ⚠ 我方该预案已连续使用 ${usage} 场，对手针对性 +${(Math.min(1.2, usage * 0.12)).toFixed(1)}，建议更换。` : "";
                return base + leak;
              })()}
            </div>
            {/* 对手图池评估：情报门控（GDD §7.2）——零情报不显示 */}
            {intelOf(state, opp.id) > 0 && (
              <div className="muted small" style={{ marginBottom: 10 }}>
                对手 {opp.name} 图池评估（情报 {Math.round(intelOf(state, opp.id))}/10）：
                {MAPS.map((m) => (
                  <span key={m.id} style={{ marginLeft: 10 }}>
                    {m.name} <span className="muted">{starsOf(estimateMapStrength(state, opp, m))}★</span>
                  </span>
                ))}
              </div>
            )}
            <div className="row" style={{ flexWrap: "wrap", marginBottom: 10 }}>
              {MAPS.map((m) => {
                const idx = (manual ?? autoPreview).indexOf(m.id);
                const isA = idx >= 0;
                return (
                  <button
                    key={m.id}
                    className={isA ? "primary" : "ghost"}
                    onClick={() => {
                      const base = manual ?? autoPreview;
                      const next = base.includes(m.id) ? base.filter((x) => x !== m.id) : [...base, m.id].slice(0, need);
                      setManual(next);
                    }}
                  >
                    {m.name} <span className="muted small">{Math.round(myTeam.mapPref[m.id] ?? 50)}</span>
                    {isA && <span className="tag green" style={{ marginLeft: 6 }}>第{idx + 1}图</span>}
                  </button>
                );
              })}
            </div>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <button onClick={() => { setManual(null); setStep(0); }}>← 上一步</button>
              <button className="primary" onClick={() => setStep(2)} disabled={manual !== null && manual.length < need}>
                下一步：英雄 →
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            {activeMaps.slice(0, need).map((mapId) => {
              const m = MAPS.find((x) => x.id === mapId)!;
              const preset = myTeam.presets[mapId]?.find((p) => p.preferred) ?? myTeam.presets[mapId]?.[0];
              return (
                <div key={mapId} className="card" style={{ padding: "10px 14px" }}>
                  <h3 style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>🗺 {m.name} <span className="muted small">熟练 {Math.round(myTeam.mapPref[mapId] ?? 50)}</span></span>
                    {preset && <span className="tag green">套用预案「{preset.name}」</span>}
                  </h3>
                  <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
                    {starterPlayers.map((p) => {
                      const current = picks[mapId]?.[p.id] ?? preset?.agents[p.id] ?? p.agentPool[0] ?? "omen";
                      return (
                        <span key={p.id} className="row" style={{ gap: 4 }}>
                          <span className="small">{p.ign}</span>
                          <select
                            value={current}
                            onChange={(e) => {
                              setPicks((prev) => ({
                                ...prev,
                                [mapId]: { ...(prev[mapId] ?? {}), [p.id]: e.target.value },
                              }));
                            }}
                          >
                            {AGENTS.filter((a) => p.agentPool.includes(a.id)).map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.name}（{p.agentPro[a.id] ?? 0}%）
                              </option>
                            ))}
                          </select>
                        </span>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            <div className="row" style={{ justifyContent: "space-between", marginTop: 6 }}>
              <button onClick={() => setStep(1)}>← 上一步</button>
              <span className="row">
                <button onClick={() => confirm(true)}>⏭ 快进到结果</button>
                <button className="primary" onClick={() => confirm(false)}>▶ 进入观战</button>
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


/** 自动 BP 建议（展示用，与引擎 veto 同思路） */
function suggestVeto(state: GameState, myId: string, oppId: string, bo: 1 | 3 | 5): string[] {
  const me = state.teams[myId];
  const opp = state.teams[oppId];
  if (!me || !opp) return MAPS.slice(0, bo === 1 ? 1 : bo).map((m) => m.id);
  const scored = MAPS.map((m) => ({
    id: m.id,
    diff: (me.mapPref[m.id] ?? 50) - (opp.mapPref[m.id] ?? 50),
    mine: me.mapPref[m.id] ?? 50,
  }));
  // pick 差值最高的图在前，其余按我方熟练补足
  const picks = scored.slice().sort((a, b) => b.diff - a.diff).slice(0, bo === 1 ? 1 : bo === 3 ? 3 : 5);
  void AGENT_BY_ID;
  return picks.map((p) => p.id);
}
