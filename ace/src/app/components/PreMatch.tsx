/**
 * 赛前准备（GDD §5.5 BP + 原作赛前界面结构）：
 * 阵容确认（可换替补）→ 正规 BP（双方交替 ban/pick，AI 对手按图池决策）→ 每图英雄确认 → 开赛。
 * 我的比赛日前弹出；确定后由引擎消费选择（BP 结果作为 mapLock 锁定图序）。
 */
import { useMemo, useRef, useState } from "react";
import type { GameState, Player } from "../../core/types.ts";
import { AGENTS } from "../../core/data/agents.ts";
import { MAPS } from "../../core/data/maps.ts";
import { intelOf, estimateMapStrength, starsOf } from "../../core/sim/intel.ts";
import { hashString } from "../../core/rng.ts";

export interface PreMatchResult {
  /** 首发名单（玩家确认后的 5 人） */
  starters: string[];
  /** BP 产出的图序列（空 = 出错兜底，引擎自动 BP） */
  manualMaps: string[] | null;
  /** 每图英雄分配（mapId → playerId → agentId；缺省用预案/自动） */
  agentPicks: Record<string, Record<string, string>>;
  /** 直接快进 */
  fastForward: boolean;
}

/** BP 动作序列（与引擎 veto.ts 同规则）：BO1 六 ban；BO3 ban-ban-pick-pick-ban-ban；BO5 ban-ban-pick×4 */
const ACTIONS_BY_BO: Record<number, ("ban" | "pick")[]> = {
  1: ["ban", "ban", "ban", "ban", "ban", "ban"],
  3: ["ban", "ban", "pick", "pick", "ban", "ban"],
  5: ["ban", "ban", "pick", "pick", "pick", "pick"],
};

interface BpState {
  pool: string[];
  picks: string[];
  banned: { map: string; byMe: boolean }[];
  stepIdx: number;
  /** 我方是否先动作（掷硬币，与引擎 BP 先手一致） */
  meFirst: boolean;
  /** 决胜图随机序列（BO3 第 3 图：从剩余池随机）预抽，保证重渲染一致 */
  deciderRolls: number[];
  done: boolean;
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
  const [picks, setPicks] = useState<Record<string, Record<string, string>>>({});
  const [bpLog, setBpLog] = useState<string[]>([]);

  // BP 状态机（进入 BP 步才初始化）
  const [bp, setBp] = useState<BpState | null>(null);
  const bpSeedRef = useRef<number>(0);

  if (!myTeam || !opp) return null;

  const roster = myTeam.roster.map((pid) => state.players[pid]!);
  const injured = (p: Player) => p.injuredUntilDay > state.day;
  const starterPlayers = starters.map((pid) => state.players[pid]!).filter(Boolean);
  const need = bo === 1 ? 1 : bo === 3 ? 3 : 5;

  // BP 单步 AI 决策（与引擎 veto 同思路：ban 对方强图 / pick 我方强图）
  const prefOf = (teamId: string, mapId: string) => state.teams[teamId]?.mapPref[mapId] ?? 50;
  const aiChoose = (b: BpState, action: "ban" | "pick", aiTeamId: string, myTeamId: string, roll: number): string => {
    const noise = (mapId: string, salt: number) => ((hashString(mapId + ":" + salt) % 1200) / 100 - 6); // ±6 确定性噪声
    const scored = b.pool.map((m) => ({
      m,
      v: action === "ban"
        ? prefOf(myTeamId, m) - prefOf(aiTeamId, m) + noise(m, 1)   // ban 掉我方强图（对 AI 而言最亏的图）
        : prefOf(aiTeamId, m) + noise(m, 2),                        // pick 自己最熟的图
    }));
    scored.sort((x, y) => y.v - x.v);
    const idx = action === "ban" ? 0 : Math.min(scored.length - 1, roll % Math.max(1, Math.ceil(scored.length / 3)));
    return (scored[idx] ?? scored[0])!.m;
  };

  const startBp = () => {
    if (!myTeam || !opp) return;
    const seed = hashString(`${state.seed}:${state.day}:bp:${props.fixtureId}`);
    bpSeedRef.current = seed;
    setBpLog([]);
    const initial: BpState = {
      pool: MAPS.map((m) => m.id),
      picks: [],
      banned: [],
      stepIdx: 0,
      meFirst: (seed % 2) === 0,
      deciderRolls: [(seed >> 3) % 97, (seed >> 7) % 89, (seed >> 11) % 83],
      done: false,
    };
    // 对方掷得先手时立即执行其回合（否则界面停在"思考中"等待不存在的玩家输入）
    const advanced = advanceBp(initial, []);
    setBpLog(advanced.logs);
    setBp(advanced.next);
  };

  /** 推进 BP：处理 AI 回合（连续推进到玩家回合或结束）；返回 {next, logs}，日志由调用方提交 */
  const advanceBp = (b: BpState, log: string[]): { next: BpState; logs: string[] } => {
    let cur = { ...b, pool: [...b.pool], picks: [...b.picks], banned: [...b.banned] };
    const actions = ACTIONS_BY_BO[bo] ?? ACTIONS_BY_BO[3]!;
    const logs = [...log];
    while (!cur.done && cur.stepIdx < actions.length) {
      const action = actions[cur.stepIdx]!;
      const meTurn = (cur.stepIdx % 2 === 0) === cur.meFirst;
      if (meTurn) return { next: { ...cur, done: false }, logs }; // 等玩家操作
      // AI 回合
      const aiTeam = opp;
      const roll = cur.deciderRolls[cur.stepIdx % cur.deciderRolls.length]!;
      const choice = aiChoose(cur, action, aiTeam.id, myId, roll);
      cur.pool = cur.pool.filter((m) => m !== choice);
      if (action === "ban") {
        cur.banned = [...cur.banned, { map: choice, byMe: false }];
        logs.push(`${opp.tag} ban ${mapNameOf(choice)}`);
      } else {
        cur.picks = [...cur.picks, choice];
        logs.push(`${opp.tag} pick ${mapNameOf(choice)}`);
      }
      cur.stepIdx++;
    }
    // 决胜图：BO3 pick 不足 3 张 → 从剩余池按预抽随机补
    let rolls = cur.deciderRolls;
    while (cur.picks.length < need && cur.pool.length > 0 && cur.stepIdx >= actions.length) {
      const r = rolls[0]!;
      rolls = rolls.slice(1).concat(r);
      const m = cur.pool[r % cur.pool.length]!;
      cur.pool = cur.pool.filter((x) => x !== m);
      cur.picks = [...cur.picks, m];
      logs.push(`决胜图 ${mapNameOf(m)}`);
    }
    cur.done = cur.picks.length >= need || (cur.stepIdx >= actions.length && cur.pool.length === 0);
    return { next: cur, logs };
  };

  /** 玩家点击一张图（当前为玩家回合） */
  const playerAct = (mapId: string) => {
    if (!bp || bp.done) return;
    const actions = ACTIONS_BY_BO[bo] ?? ACTIONS_BY_BO[3]!;
    const action = actions[bp.stepIdx];
    if (!action) return;
    const meTurn = (bp.stepIdx % 2 === 0) === bp.meFirst;
    if (!meTurn || !bp.pool.includes(mapId)) return;
    let next: BpState = {
      ...bp,
      pool: bp.pool.filter((m) => m !== mapId),
      picks: action === "pick" ? [...bp.picks, mapId] : bp.picks,
      banned: action === "ban" ? [...bp.banned, { map: mapId, byMe: true }] : bp.banned,
      stepIdx: bp.stepIdx + 1,
    };
    const line = `${myTeam!.tag} ${action === "ban" ? "ban" : "pick"} ${mapNameOf(mapId)}`;
    const advanced = advanceBp(next, [...bpLog, line]);
    setBpLog(advanced.logs);
    setBp(advanced.next);
  };

  /** 一键交给 AI 替我方完成剩余 BP（挂机推荐） */
  const autoBp = () => {
    if (!bp) return;
    const actions = ACTIONS_BY_BO[bo] ?? ACTIONS_BY_BO[3]!;
    let cur = { ...bp, pool: [...bp.pool], picks: [...bp.picks], banned: [...bp.banned] };
    const logs = [...bpLog];
    while (cur.stepIdx < actions.length) {
      const action = actions[cur.stepIdx]!;
      const meTurn = (cur.stepIdx % 2 === 0) === cur.meFirst;
      const actorTeam = meTurn ? myTeam! : opp;
      const roll = cur.deciderRolls[cur.stepIdx % cur.deciderRolls.length]!;
      const choice = meTurn
        ? aiChoose(cur, action, myTeam!.id, opp.id, roll) // 我方视角：AI 建议器
        : aiChoose(cur, action, opp.id, myId, roll);
      cur.pool = cur.pool.filter((m) => m !== choice);
      if (action === "ban") {
        cur.banned = [...cur.banned, { map: choice, byMe: meTurn }];
        logs.push(`${actorTeam.tag} ban ${mapNameOf(choice)}`);
      } else {
        cur.picks = [...cur.picks, choice];
        logs.push(`${actorTeam.tag} pick ${mapNameOf(choice)}`);
      }
      cur.stepIdx++;
    }
    let rolls = cur.deciderRolls;
    while (cur.picks.length < need && cur.pool.length > 0) {
      const r = rolls[0]!;
      rolls = rolls.slice(1).concat(r);
      const m = cur.pool[r % cur.pool.length]!;
      cur.pool = cur.pool.filter((x) => x !== m);
      cur.picks = [...cur.picks, m];
      logs.push(`决胜图 ${mapNameOf(m)}`);
    }
    cur.done = true;
    setBpLog(logs);
    setBp(cur);
  };

  const activeMaps = bp?.picks ?? [];

  const confirm = (fastForward: boolean) => {
    onConfirm({ starters, manualMaps: activeMaps.length >= need ? activeMaps.slice() : null, agentPicks: picks, fastForward });
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
              <button className="primary" disabled={starters.length !== 5} onClick={() => { startBp(); setStep(1); }}>下一步：BP →</button>
            </div>
          </div>
        )}

        {step === 1 && bp && (
          <div>
            <div className="muted small" style={{ marginBottom: 6 }}>
              正规 BP（先手掷硬币）：BO{bo === 1 ? "1 双方交替 ban 至剩 1 图" : bo === 3 ? "3 ban-ban-pick-pick-ban-ban + 随机决胜图" : "5 ban-ban 后各 pick 两张"}。
              {!bp.done && (
                <b style={{ marginLeft: 8 }}>
                  {(bp.stepIdx % 2 === 0) === bp.meFirst ? `轮到${myTeam.tag}` : `${opp.tag} 思考中…`}
                  {bp.stepIdx < (ACTIONS_BY_BO[bo] ?? []).length && ` · 第 ${bp.stepIdx + 1} 步：${(ACTIONS_BY_BO[bo] ?? [])[bp.stepIdx] === "ban" ? "禁用" : "选用"}`}
                </b>
              )}
              {(() => {
                const intel = intelOf(state, opp.id);
                const base = intel === 0 ? " 尚未侦察对手——看不到他们的图池评估。" : "";
                const usage = myTeam.patternUsage[activeMaps[0] ?? ""] ?? 0;
                const leak = usage >= 3 ? ` ⚠ 我方「${mapNameOf(activeMaps[0] ?? "")}」招牌已连续使用 ${usage} 场，对手针对性 +${(Math.min(1.2, usage * 0.12)).toFixed(1)}。` : "";
                return base + leak;
              })()}
            </div>
            {/* 对手图池评估：情报门控（GDD §7.2） */}
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
                const inPool = bp.pool.includes(m.id);
                const pickIdx = bp.picks.indexOf(m.id);
                const banEntry = bp.banned.find((x) => x.map === m.id);
                const myTurn = !bp.done && bp.stepIdx < (ACTIONS_BY_BO[bo] ?? []).length && (bp.stepIdx % 2 === 0) === bp.meFirst;
                const action = (ACTIONS_BY_BO[bo] ?? [])[bp.stepIdx];
                return (
                  <button
                    key={m.id}
                    className={pickIdx >= 0 ? "primary" : "ghost"}
                    style={{
                      opacity: banEntry ? 0.35 : inPool ? 1 : 0.6,
                      textDecoration: banEntry ? "line-through" : "none",
                      cursor: myTurn && inPool ? "pointer" : "default",
                    }}
                    disabled={!myTurn || !inPool}
                    onClick={() => playerAct(m.id)}
                  >
                    {m.name} <span className="muted small">{Math.round(myTeam.mapPref[m.id] ?? 50)}</span>
                    {pickIdx >= 0 && <span className="tag green" style={{ marginLeft: 6 }}>第{pickIdx + 1}图</span>}
                    {banEntry && <span className="tag" style={{ marginLeft: 6 }}>{banEntry.byMe ? "我方 ban" : "对方 ban"}</span>}
                    {myTurn && inPool && action && <span className="tag orange" style={{ marginLeft: 6 }}>{action === "ban" ? "点击禁用" : "点击选用"}</span>}
                  </button>
                );
              })}
            </div>
            {/* BP 记录 */}
            <div className="muted small" style={{ maxHeight: 84, overflowY: "auto", borderTop: "1px dashed var(--line)", paddingTop: 6 }}>
              {bpLog.length ? bpLog.map((l, i) => <div key={i}>{l}</div>) : "（BP 尚未开始）"}
            </div>
            <div className="row" style={{ justifyContent: "space-between", marginTop: 10 }}>
              <button onClick={() => setStep(0)}>← 上一步</button>
              <span className="row">
                {!bp.done && <button onClick={autoBp}>⚡ 一键自动 BP</button>}
                <button className="primary" onClick={() => setStep(2)} disabled={!bp.done || activeMaps.length < need}>
                  下一步：英雄 →
                </button>
              </span>
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
                                {a.name}（{Math.round((p.agentPro[a.id] ?? 0) * 10) / 10}%）
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

function mapNameOf(id: string): string {
  return MAPS.find((m) => m.id === id)?.name ?? id;
}
