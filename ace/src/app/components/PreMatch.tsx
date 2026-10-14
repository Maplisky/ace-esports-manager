/**
 * 赛前准备（GDD §5.5 BP + 原作赛前界面结构）：
 * 阵容确认（可换替补）→ 正规 BP（双方交替 ban/pick，AI 对手按图池决策）→ 每图英雄确认 → 开赛。
 * 我的比赛日前弹出；确定后由引擎消费选择（BP 结果作为 mapLock 锁定图序）。
 */
import { useState } from "react";
import type { GameState, Player } from "../../core/types.ts";
import { AGENT_BY_ID } from "../../core/data/agents.ts";
import { computeFit } from "../../core/sim/fit.ts";
import { PlayerFace, AgentIcon } from "./Avatar.tsx";
import { AgentSelect } from "./AgentSelect.tsx";
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
  const [presetChoice, setPresetChoice] = useState<Record<string, string>>({});
  const [bpLog, setBpLog] = useState<string[]>([]);
  const [heroPage, setHeroPage] = useState(0); // 英雄步分页（每图一页）

  // BP 状态机（进入 BP 步才初始化）
  const [bp, setBp] = useState<BpState | null>(null);

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
    setBpLog([]);
    const initial: BpState = {
      pool: MAPS.map((m) => m.id),
      picks: [],
      banned: [],
      stepIdx: 0,
      meFirst: (seed % 2) === 0,
      // >>> 无符号移位：hashString 已 >>>0，带符号 >> 会让高段位变负、负 roll 令 pool[负] 取出 undefined
      deciderRolls: [(seed >>> 3) % 97, (seed >>> 7) % 89, (seed >>> 11) % 83],
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

  // 单图五人英雄分配（显示与 confirm 共用）：手动选择优先；预案值/自动池回退时
  // 跳过本图已被他人占用的英雄——默认阵容永远合法，重复警告只针对手动冲突
  const resolveMapAgents = (mapId: string): Record<string, string> => {
    const presets = myTeam.presets[mapId] ?? [];
    const chosen = presetChoice[mapId] ?? presets.find((p) => p.preferred)?.name ?? presets[0]?.name ?? "";
    const preset = presets.find((p) => p.name === chosen);
    const taken = new Set<string>();
    const out: Record<string, string> = {};
    for (const p of starterPlayers) {
      const manual = picks[mapId]?.[p.id];
      let aid: string;
      if (manual && p.agentPool.includes(manual)) {
        aid = manual;
      } else {
        const pool = p.agentPool;
        aid =
          [preset?.agents[p.id], ...pool].find((a) => a && !taken.has(a)) ??
          pool.find((a) => !taken.has(a)) ??
          pool[0] ??
          "omen";
      }
      taken.add(aid);
      out[p.id] = aid;
    }
    return out;
  };

  const confirm = (fastForward: boolean) => {
    // 所见即所得：把每图每名首发的最终英雄完整固化（预案默认/自动池首都算数），
    // 否则引擎只收到玩家手动改过的条目，「套用预案」显示而不生效
    const fullPicks: Record<string, Record<string, string>> = {};
    for (const mapId of activeMaps.slice(0, need)) {
      fullPicks[mapId] = resolveMapAgents(mapId);
    }
    onConfirm({ starters, manualMaps: activeMaps.length >= need ? activeMaps.slice() : null, agentPicks: fullPicks, fastForward });
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
                <button className="primary" onClick={() => { setHeroPage(0); setStep(2); }} disabled={!bp.done || activeMaps.length < need}>
                  下一步：英雄 →
                </button>
              </span>
            </div>
          </div>
        )}

        {step === 2 && heroPage < activeMaps.length && (() => {
  const mapId = activeMaps[heroPage]!;
  const m = MAPS.find((x) => x.id === mapId) ?? MAPS[0]!;
  const presets = myTeam.presets[mapId] ?? [];
  const chosen = presetChoice[mapId] ?? presets.find((p) => p.preferred)?.name ?? presets[0]?.name ?? "";
  const resolved = resolveMapAgents(mapId);
  const currentOf = (p: Player) => picks[mapId]?.[p.id] ?? resolved[p.id];
  const dupAgents = (() => {
    const seen = new Set<string>();
    for (const p of starterPlayers) {
      const a = currentOf(p);
      if (seen.has(a)) return a;
      seen.add(a);
    }
    return null;
  })();
  const dupAgentName = dupAgents ? AGENT_BY_ID.get(dupAgents)?.name ?? dupAgents : null;
  const isLast = heroPage >= activeMaps.length - 1;
  const blocked = !!dupAgents;
  const goNext = (ff: boolean) => {
    if (blocked) return;
    if (!isLast) setHeroPage(heroPage + 1);
    else confirm(ff);
  };
  // 对方常用阵容（该图情报 >0 时展示：对手首发的常用英雄）
  const oppIntel = intelOf(state, opp.id);
  const oppStarters = opp.starters.map((id) => state.players[id]).filter((x): x is Player => !!x);
  return (
    <div>
      {/* 顶端：地图信息条 */}
      <div className="card" style={{ padding: "10px 16px", marginBottom: 10 }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <span className="row" style={{ gap: 10, alignItems: "center" }}>
            <b style={{ fontSize: 17 }}>🗺 {m.name}</b>
            <span className="tag">我方熟练 {Math.round(myTeam.mapPref[mapId] ?? 50)}</span>
            <span className="muted small">{m.sites} 点位 · 开阔 {Math.round(m.openness * 100)} / 垂直 {Math.round(m.vertical * 100)} / 走廊 {Math.round(m.corridor * 100)}</span>
          </span>
          <span className="row" style={{ gap: 10, alignItems: "center" }}>
            <span className="muted small">对方图池评估 {starsOf(estimateMapStrength(state, opp, m))}★</span>
            <span className="row" style={{ gap: 6, alignItems: "center" }}>
              <span className="muted small">阵容预案</span>
              <select
                value={chosen}
                onChange={(e) => {
                  const name = e.target.value;
                  setPresetChoice((prev) => ({ ...prev, [mapId]: name }));
                  const pr = presets.find((p) => p.name === name);
                  if (!pr) {
                    setPicks((prev) => { const n = { ...prev }; delete n[mapId]; return n; });
                    return;
                  }
                  setPicks((prev) => ({
                    ...prev,
                    [mapId]: Object.fromEntries(
                      starterPlayers.map((p) => {
                        const want = pr.agents[p.id];
                        const inPool = want && p.agentPool.includes(want);
                        return [p.id, inPool ? want : (prev[mapId]?.[p.id] ?? p.agentPool[0] ?? "omen")];
                      }),
                    ),
                  }));
                }}
              >
                {!presets.length && <option value="">（本图暂无预案）</option>}
                {presets.length > 0 && <option value="">不使用预案</option>}
                {presets.map((p, pi) => (
                  <option key={p.name + "#" + pi} value={p.name}>
                    {p.name}{p.preferred ? " ★" : ""}
                  </option>
                ))}
              </select>
            </span>
          </span>
        </div>
      </div>

      {/* 图进度指示 */}
      <div className="row" style={{ gap: 8, marginBottom: 8, alignItems: "center" }}>
        {activeMaps.map((mid, i) => {
          const pageMap = MAPS.find((x) => x.id === mid);
          const done = i < heroPage;
          return (
            <button
              key={mid}
              className={i === heroPage ? "primary small" : "small"}
              style={{ opacity: i > heroPage ? 0.55 : 1 }}
              disabled={i > heroPage} // 前进必须过校验，只能回看
              onClick={() => setHeroPage(i)}
            >
              {done ? "✓ " : ""}第 {i + 1} 图 · {pageMap?.name ?? mid}
            </button>
          );
        })}
      </div>

      {/* 重复英雄警告 */}
      {blocked && (
        <div className="card" style={{ padding: "8px 14px", marginBottom: 8, borderColor: "var(--accent)" }}>
          <b style={{ color: "var(--accent)" }}>⚠ 重复英雄：{dupAgentName} 已被其他选手选用。同一场每名选手必须使用不同英雄，请调整后才能进入下一图。</b>
        </div>
      )}

      {/* 我方五人（竖排） */}
      <div className="card" style={{ padding: "10px 14px", marginBottom: 10 }}>
        <h3 style={{ marginBottom: 8 }}>👥 我方五人（{myTeam.name}）</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {starterPlayers.map((p) => {
            const current = currentOf(p);
            const curAgent = AGENT_BY_ID.get(current);
            const isDup = dupAgents === current;
            const fit = computeFit(current, m);
            const pro = Math.round((p.agentPro[current] ?? 0) * 10) / 10;
            return (
              <div key={p.id} className="row" style={{ gap: 10, alignItems: "center", background: isDup ? "rgba(238,80,80,0.10)" : "rgba(255,255,255,0.03)", borderRadius: 8, padding: "6px 10px", border: isDup ? "1px solid var(--accent)" : "none" }}>
                <PlayerFace p={p} size={38} showTag={false} />
                <span style={{ minWidth: 110 }}>
                  <b className="small">{p.ign}</b>
                  <span className="muted small" style={{ marginLeft: 6 }}>{p.overall} 综合</span>
                  {p.isIgl && <span className="tag" style={{ marginLeft: 6 }}>指挥</span>}
                </span>
                <AgentIcon agentId={current} size={36} name={curAgent?.name} />
                <AgentSelect
                  player={p}
                  value={current}
                  onChange={(aid) => {
                    setPicks((prev) => ({
                      ...prev,
                      [mapId]: { ...(prev[mapId] ?? {}), [p.id]: aid },
                    }));
                  }}
                />
                <span className="small" style={{ display: "inline-flex", flexDirection: "column", lineHeight: 1.3, minWidth: 90 }}>
                  <span>熟练 <b>{pro}</b>%</span>
                  <span className={fit >= 1.06 ? "tag green" : fit <= 0.94 ? "tag orange" : "muted"} style={{ fontSize: 10 }}>图适 {Math.round(fit * 100)}%</span>
                </span>
                {isDup && <span className="tag red">重复</span>}
              </div>
            );
          })}
        </div>
      </div>

      {/* 对方常用阵容（情报门控） */}
      {oppIntel > 0 && (
        <div className="card" style={{ padding: "10px 14px", marginBottom: 10 }}>
          <h3 style={{ marginBottom: 8 }}>🎯 {opp.name} 常用阵容（情报 {Math.round(oppIntel)}/10，估算）</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {oppStarters.map((p) => {
              const aid = p.agentPool[0] ?? "omen";
              const a = AGENT_BY_ID.get(aid);
              return (
                <div key={p.id} className="row" style={{ gap: 10, alignItems: "center", opacity: 0.85 }}>
                  <PlayerFace p={p} size={28} showTag={false} />
                  <span className="small" style={{ minWidth: 90 }}>{p.ign}<span className="muted"> {p.overall}</span></span>
                  <AgentIcon agentId={aid} size={26} name={a?.name} />
                  <span className="small">{a?.name ?? aid}</span>
                </div>
              );
            })}
          </div>
          <div className="muted small" style={{ marginTop: 6 }}>情报越高越接近真实倾向；正式比赛中对方可能针对性调整。</div>
        </div>
      )}

      {/* 底部导航 */}
      <div className="row" style={{ justifyContent: "space-between", marginTop: 8 }}>
        <span className="row" style={{ gap: 8 }}>
          <button onClick={() => setStep(1)}>← 上一步（BP）</button>
          <button disabled={heroPage === 0} onClick={() => setHeroPage(heroPage - 1)}>← 上一图</button>
        </span>
        <span className="row" style={{ gap: 8 }}>
          {!isLast && (
            <button className="primary" disabled={blocked} onClick={() => setHeroPage(heroPage + 1)}>
              下一图：{MAPS.find((x) => x.id === activeMaps[heroPage + 1])?.name} →
            </button>
          )}
          {isLast && (
            <>
              <button disabled={blocked} onClick={() => goNext(true)}>⏭ 快进到结果</button>
              <button className="primary" disabled={blocked} onClick={() => goNext(false)}>▶ 进入观战</button>
            </>
          )}
        </span>
      </div>
    </div>
  );
})()}
      </div>
    </div>
  );
}

function mapNameOf(id: string): string {
  return MAPS.find((m) => m.id === id)?.name ?? id;
}
