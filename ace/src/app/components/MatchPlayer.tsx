/**
 * 比赛播放器 v1（GDD §5.4 转播级体验的文字流版本）：
 * 记分牌 / 逐回合击杀流 / 经济条 / 自动导播（关键回合自动降速）/ 倍速。
 * 只吃 MatchRecord——渲染与模拟完全分离（§5.1）。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { AGENT_BY_ID } from "../../core/data/agents.ts";
import { TeamLogo } from "./Avatar.tsx";
import { MAP_BY_ID } from "../../core/data/maps.ts";
import type { GameState, MatchRecord, RoundEvent } from "../../core/types.ts";

const SLOW_MS = 850;
const FAST_MS = 280;
const HEADER_MS = 480;
const RESULT_MS = 750;

interface Pos { mi: number; ri: number; ei: number } // ei: -1=回合头, 0..n-1=事件, n=回合结果

export function MatchPlayer(props: { record: MatchRecord; state: GameState; onClose: () => void; startFinished?: boolean }) {
  const { record, state, onClose } = props;
  const startAtEnd = props.startFinished === true;
  const [pos, setPos] = useState<Pos>(() =>
    startAtEnd
      ? { mi: record.maps.length - 1, ri: Math.max(0, (record.maps[record.maps.length - 1]?.rounds.length ?? 1) - 1), ei: 99 }
      : { mi: 0, ri: 0, ei: -1 },
  );
  const [playing, setPlaying] = useState(!startAtEnd);
  const [speed, setSpeed] = useState(2);
  const [finished, setFinished] = useState(startAtEnd);
  const timer = useRef<number | null>(null);

  const map = record.maps[pos.mi];
  const round = map?.rounds[pos.ri];
  const teamA = state.teams[record.teamA];
  const teamB = state.teams[record.teamB];
  const ign = (pid: string) => state.players[pid]?.ign ?? pid;
  const agentName = (pid: string) => {
    const agentId = map?.agents?.[pid];
    return agentId ? (AGENT_BY_ID.get(agentId)?.name ?? "") : "";
  };

  const isKeyRound = useMemo(() => {
    if (!round) return false;
    if (round.n > 24) return true;
    const [a, b] = round.end.score;
    const matchPoint = (a === 12 || b === 12) && Math.abs(a - b) <= 1;
    const big = round.events.some((e) => e.t === "ace" || e.t === "clutch" || e.t === "flawless");
    return matchPoint || big;
  }, [round]);

  const revealed = round ? round.events.slice(0, Math.max(0, pos.ei + 1)) : [];
  const showResult = round !== undefined && pos.ei >= round.events.length;

  // 系列赛比分（当前图之前的图）
  const series = useMemo(() => {
    let a = 0;
    let b = 0;
    for (let i = 0; i < pos.mi; i++) {
      const m = record.maps[i];
      if (!m) continue;
      if (m.score[0] > m.score[1]) a++;
      else b++;
    }
    return [a, b] as [number, number];
  }, [pos.mi, record.maps]);

  useEffect(() => {
    if (!playing || finished) return;
    let delay: number;
    if (!round) delay = RESULT_MS;
    else if (pos.ei === -1) delay = HEADER_MS;
    else if (pos.ei < round.events.length) delay = (isKeyRound ? SLOW_MS : FAST_MS);
    else delay = RESULT_MS;
    const t = window.setTimeout(() => {
      setPos((cur) => {
        const m = record.maps[cur.mi];
        if (!m) return cur;
        const r = m.rounds[cur.ri];
        if (!r) return cur;
        if (cur.ei < r.events.length) return { ...cur, ei: cur.ei + 1 };
        if (cur.ri < m.rounds.length - 1) return { ...cur, ri: cur.ri + 1, ei: -1 };
        if (cur.mi < record.maps.length - 1) return { mi: cur.mi + 1, ri: 0, ei: -1 };
        setFinished(true);
        return cur;
      });
    }, Math.max(60, delay / speed));
    timer.current = t;
    return () => window.clearTimeout(t);
  }, [playing, speed, pos, finished, record.maps, round, isKeyRound]);

  const jumpToEnd = () => {
    setPlaying(false);
    setFinished(true);
    setPos({ mi: record.maps.length - 1, ri: Math.max(0, (record.maps[record.maps.length - 1]?.rounds.length ?? 1) - 1), ei: 99 });
  };

  // 实时比分：已完成的回合
  const liveScore: [number, number] =
    showResult || !round
      ? (round?.end.score ?? [0, 0])
      : pos.ri > 0
        ? ([...(map!.rounds[pos.ri - 1]!.end.score)] as [number, number])
        : [0, 0];

  const mapName = MAP_BY_ID.get(map?.map ?? "")?.name ?? map?.map ?? "";
  const buys = round?.buys;
  const atkSide = round?.atk ?? "A";

  return (
    <div className="viewer-backdrop" onClick={() => { /* 点背景不关闭，防误触 */ }}>
      <div className="viewer" onClick={(e) => e.stopPropagation()}>
        {/* 记分牌 */}
        <div className="scorebug">
          <div className="team" style={{ color: "var(--accent)", display: "flex", alignItems: "center", gap: 6 }}>{teamA && <TeamLogo team={teamA} size={22} />}{teamA?.tag}</div>
          <div className="mid">
            <div className="series">{series[0]} : {series[1]}</div>
            <div className="muted small">
              {record.format === 1 ? "BO1" : record.format === 3 ? "BO3" : "BO5"} · {mapName}
              {isKeyRound && !finished && <span className="tag orange" style={{ marginLeft: 8 }}>⚡ 关键回合 · 自动导播</span>}
            </div>
            <div style={{ fontSize: 26, fontWeight: 800 }}>{liveScore[0]} — {liveScore[1]}</div>
          </div>
          <div className="team right" style={{ display: "flex", alignItems: "center", gap: 6 }}>{teamB?.tag}{teamB && <TeamLogo team={teamB} size={22} />}</div>
        </div>

        {finished ? (
          <div className="card" style={{ textAlign: "center", padding: 26 }}>
            <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 8 }}>
              🏁 {(record.score[0] > record.score[1] ? teamA?.name : teamB?.name)} 获胜！
            </div>
            <div className="muted">
              比分 {record.score[0]}-{record.score[1]}
              {record.mvp && <> · MVP：<b>{ign(record.mvp)}</b>（{agentName(record.mvp)}）</>}
            </div>
            <AttributionTable record={record} state={state} />
            <button className="primary" style={{ marginTop: 14 }} onClick={onClose}>
              关闭回放
            </button>
          </div>
        ) : (
          <>
            {/* 回合信息条 */}
            {round && (
              <div className="roundline">
                <span>
                  第 {round.n} 回合 · {round.atk === "A" ? teamA?.tag : teamB?.tag} 进攻
                  {round.n === 1 || round.n === 13 || round.n === 25 ? " · 手枪局" : ""}
                </span>
                <span className="muted">
                  {pos.ei === -1 ? "准备中…" : showResult ? "回合结束" : "交火中"}
                </span>
              </div>
            )}

            {/* 经济条 */}
            {buys && (
              <div className="econbars">
                <EconBar tag={teamA?.tag ?? "A"} buy={buys.A} atk={atkSide === "A"} />
                <EconBar tag={teamB?.tag ?? "B"} buy={buys.B} atk={atkSide === "B"} />
              </div>
            )}

            {/* 击杀流（逐步揭示） */}
            <div className="killfeed">
              {revealed.map((e, i) => (
                <FeedRow key={i} e={e} state={state} ign={ign} agentName={agentName} />
              ))}
              {showResult && round && (
                <div className="fevent big">
                  🏁 {(round.end.win === "A" ? teamA?.tag : teamB?.tag)} 拿下回合（{howText(round.end.how)}）
                  · 存活 {round.end.alive.A}-{round.end.alive.B}
                </div>
              )}
            </div>

            <div className="progress">
              <div
                className="fill"
                style={{
                  width: `${totalProgress(record, pos)}%`,
                }}
              />
            </div>

            <div className="controls">
              <button className="primary" onClick={() => setPlaying((p) => !p)}>
                {playing ? "⏸ 暂停" : "▶ 播放"}
              </button>
              <button onClick={() => setSpeed((s) => (s === 1 ? 2 : s === 2 ? 4 : 1))}>
                {speed}x
              </button>
              <button onClick={jumpToEnd}>⏭ 跳到结果</button>
              <div className="grow" />
              <button className="ghost" onClick={onClose}>关闭 ✕</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function EconBar({ tag, buy, atk }: { tag: string; buy: "full" | "force" | "eco"; atk: boolean }) {
  const width = buy === "full" ? 100 : buy === "force" ? 55 : 22;
  const color = buy === "full" ? "var(--green)" : buy === "force" ? "var(--orange)" : "var(--muted)";
  return (
    <div className="econbar">
      <span style={{ width: 34 }}>{tag}</span>
      <span className="bar" style={{ width: `${width}%`, background: color }} />
      <span className="muted">{buyName(buy)}{atk ? " · 进攻" : " · 防守"}</span>
    </div>
  );
}

function buyName(buy: "full" | "force" | "eco"): string {
  return buy === "full" ? "长枪" : buy === "force" ? "强起" : "eco";
}

function howText(how: string): string {
  return how === "spike" ? "爆能器引爆" : how === "defuse" ? "拆除成功" : how === "time" ? "时间耗尽" : "歼灭";
}

function FeedRow(props: {
  e: RoundEvent;
  state: GameState;
  ign: (pid: string) => string;
  agentName: (pid: string) => string;
}) {
  const { e, ign, agentName } = props;
  if (e.t === "kill") {
    const k = `${ign(e.s ?? "")}${agentName(e.s ?? "") ? `（${agentName(e.s ?? "")}）` : ""}`;
    const v = `${ign(e.v ?? "")}${agentName(e.v ?? "") ? `（${agentName(e.v ?? "")}）` : ""}`;
    return (
      <div className="fevent kill">
        {e.first && <span className="tag orange" style={{ marginRight: 8 }}>首杀</span>}
        💥 {k} <span className="muted">击倒</span> {v}
      </div>
    );
  }
  if (e.t === "plant") return <div className="fevent plant">💣 {ign(e.s ?? "")} 下包</div>;
  if (e.t === "defuse") return <div className="fevent defuse">✂️ {ign(e.s ?? "")} 拆包成功</div>;
  if (e.t === "ultReady") {
    const tier = e.tier ?? "utility";
    const label = tier === "info" || tier === "utility" ? "" : "（核心大）";
    return <div className="fevent big">⚡ {ign(e.s ?? "")} 大招就绪{label}</div>;
  }
  if (e.t === "ace") return <div className="fevent big">🏆 ACE！{ign(e.s ?? "")} 团灭对手！</div>;
  if (e.t === "clutch") return <div className="fevent big">🎯 {ign(e.s ?? "")} 1v{e.vs ?? 1} 残局得手！</div>;
  if (e.t === "flawless") return <div className="fevent big">✨ 零封！满编无伤拿下</div>;
  if (e.t === "timeout") return <div className="fevent">⏸ 战术暂停（效果 3 回合）</div>;
  return null;
}

function totalProgress(record: MatchRecord, pos: Pos): number {
  let total = 0;
  let done = 0;
  record.maps.forEach((m, mi) => {
    total += m.rounds.length;
    if (mi < pos.mi) done += m.rounds.length;
    else if (mi === pos.mi) done += pos.ri + 1;
  });
  return total > 0 ? Math.min(100, (done / total) * 100) : 0;
}

/** 赛后强度归因条（GDD §10.2）：发散式对比——中间零线，A 优势向左、B 优势向右，条长按各行差值归一化 */
const EDGE_LABELS: [keyof import("../../core/types.ts").EdgeBreakdown, string][] = [
  ["base", "基础阵容"], ["igl", "指挥"], ["chem", "化学反应"], ["coach", "教练"],
  ["meta", "版本适配"], ["map", "图池熟练"], ["prep", "针对准备"], ["familiarity", "英雄熟练"],
  ["aim", "枪法"], ["awareness", "意识"], ["shortHanded", "缺人"],
];

function AttributionTable({ record, state }: { record: MatchRecord; state: GameState }) {
  if (record.maps.length === 0 || !record.maps[0]!.edges) return null;
  const tagA = state.teams[record.teamA]?.tag ?? "A";
  const tagB = state.teams[record.teamB]?.tag ?? "B";
  const rows = EDGE_LABELS.map(([k, label]) => {
    const va = avgOf(record, "A", k);
    const vb = avgOf(record, "B", k);
    return { k, label, va, vb, diff: va - vb }; // diff > 0 = A 占优
  });
  const maxDiff = Math.max(0.5, ...rows.map((r) => Math.abs(r.diff)));
  return (
    <div style={{ textAlign: "left", marginTop: 14 }}>
      <div className="muted small" style={{ textAlign: "center", marginBottom: 6 }}>
        强度归因 · 全部 {record.maps.length} 图均值（谁占优：条向谁的方向延伸）
      </div>
      <table>
        <thead>
          <tr><th style={{ width: "16%", textAlign: "right" }}>{tagA}</th><th style={{ textAlign: "center", width: "12%" }}>维度</th><th style={{ textAlign: "left", width: "16%" }}>{tagB}</th><th>归因（A ← | → B）</th></tr>
        </thead>
        <tbody>
          {rows.map(({ k, label, va, vb, diff }) => {
            const pct = (Math.abs(diff) / maxDiff) * 50; // 半宽归一化（0-50%）
            const aWins = diff > 0;
            return (
              <tr key={k}>
                <td style={{ textAlign: "right" }} className="small">{va >= 0 ? "+" : ""}{va.toFixed(1)}</td>
                <td style={{ textAlign: "center" }} className="muted small">{label}</td>
                <td className="small">{vb >= 0 ? "+" : ""}{vb.toFixed(1)}</td>
                <td>
                    <div style={{ position: "relative", height: 12, background: "var(--panel2)", borderRadius: 6, overflow: "hidden", width: "100%", maxWidth: 260 }}>
                    <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "var(--line)" }} />
                    <div
                      style={{
                        position: "absolute", top: 0, bottom: 0,
                        // A 在左列：A 占优 → 条向左延伸（绿）；B 占优 → 向右延伸（红）
                        ...(aWins ? { right: "50%", width: `${pct}%`, background: "var(--green)" } : { left: "50%", width: `${pct}%`, background: "var(--accent)" }),
                      }}
                    />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="muted small" style={{ textAlign: "center", marginTop: 4 }}>
        <span className="tag green">← A 优势</span> 中线为均势 <span className="tag red">B 优势 →</span> · 条长按各行差值归一化
      </div>
    </div>
  );
}

/** 某方某维度在全部已打地图上的均值 */
function avgOf(record: MatchRecord, side: "A" | "B", key: keyof import("../../core/types.ts").EdgeBreakdown): number {
  const vals = record.maps
    .map((m) => m.edges?.[side]?.[key])
    .filter((v): v is number => typeof v === "number");
  if (vals.length === 0) return 0;
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}
