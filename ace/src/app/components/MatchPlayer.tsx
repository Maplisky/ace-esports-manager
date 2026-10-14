/**
 * 比赛播放器 v1（GDD §5.4 转播级体验的文字流版本）：
 * 记分牌 / 逐回合击杀流 / 经济条 / 自动导播（关键回合自动降速）/ 倍速。
 * 只吃 MatchRecord——渲染与模拟完全分离（§5.1）。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { AGENT_BY_ID } from "../../core/data/agents.ts";
import { AgentIcon, PlayerFace, TeamLogo } from "./Avatar.tsx";
import { MAP_BY_ID } from "../../core/data/maps.ts";
import { Tactical2D } from "./Tactical2D.tsx";
import { liveLines, liveAcs, summarizeMatch, pickMvps, type StatRow } from "../../core/sim/matchstats.ts";
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
  const [view, setView] = useState<"text" | "2d">("2d");
  const [sumTab, setSumTab] = useState(0); // 结算页：0=系列赛汇总，1..n=单图
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
      <div className="viewer" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "92vh", overflowY: "auto" }}>
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

        {finished ? (() => {
          const winnerTeam: "A" | "B" = record.score[0] > record.score[1] ? "A" : "B";
          const teamAPids = new Set([...(teamA?.roster ?? []), ...(teamA?.starters ?? [])]);
          const seriesRows = summarizeMatch(record.maps, teamAPids);
          const mvps = pickMvps(seriesRows, winnerTeam);
          const hasSeries = record.maps.length > 1;
          const isSeriesView = hasSeries && sumTab === 0;
          const mapIdx = isSeriesView ? -1 : hasSeries ? sumTab - 1 : 0;
          const viewMap = mapIdx >= 0 ? record.maps[mapIdx] : null;
          const rows = isSeriesView ? seriesRows : summarizeMatch(viewMap ? [viewMap] : record.maps, teamAPids);
          return (
            <div style={{ textAlign: "center" }}>
              <div className="card" style={{ textAlign: "center", padding: "16px 26px" }}>
                <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 6 }}>
                  🏁 {(winnerTeam === "A" ? teamA?.name : teamB?.name)} 获胜！
                </div>
                <div className="muted">
                  比分 {record.score[0]}-{record.score[1]}
                  {mvps.mvp && <> · <b style={{ color: "#fbbf24" }}>MVP</b>：<b>{ign(mvps.mvp)}</b></>}
                  {mvps.smvp && <> · <b>SMVP</b>（败方）：<b>{ign(mvps.smvp)}</b></>}
                </div>
                <button className="primary" style={{ marginTop: 12 }} onClick={onClose}>
                  关闭回放
                </button>
              </div>

              {/* 页签：系列赛汇总 / 单图数据（单图页含特工头像） */}
              {hasSeries && (
                <div className="row" style={{ justifyContent: "center", gap: 6, margin: "10px 0" }}>
                  <button className={sumTab === 0 ? "primary small" : "small"} onClick={() => setSumTab(0)}>📊 系列赛汇总</button>
                  {record.maps.map((m, i) => (
                    <button key={m.map + i} className={sumTab === i + 1 ? "primary small" : "small"} onClick={() => setSumTab(i + 1)}>
                      第 {i + 1} 图 · {MAP_BY_ID.get(m.map)?.name ?? m.map}
                    </button>
                  ))}
                </div>
              )}

              <StatsTable
                state={state}
                record={record}
                rows={rows}
                winnerTeam={winnerTeam}
                mvpPid={mvps.mvp}
                smvpPid={mvps.smvp}
                agents={viewMap?.agents}
                title={isSeriesView
                  ? `比赛总结 · 双方选手数据（全部 ${record.maps.length} 图汇总）`
                  : `第 ${mapIdx + 1} 图数据 · ${MAP_BY_ID.get(viewMap?.map ?? "")?.name ?? ""}`}
              />
              {isSeriesView && <AttributionTable record={record} state={state} />}
            </div>
          );
        })() : (
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

            {/* 双方选手实时战绩（已揭示事件聚合，GDD §5.4） */}
            {map && (
              <LiveScoreboard record={record} state={state} pos={pos} />
            )}

            {/* 击杀流（逐步揭示）+ 2D 战术视图并排 */}
            <div className="row" style={{ gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
              {view === "2d" && round && map && (
                <Tactical2D
                  state={state}
                  mapRec={map}
                  roundEvents={round.events}
                  revealedCount={pos.ei + 1}
                  teamAId={record.teamA}
                  teamBId={record.teamB}
                  atkSide={round.atk}
                />
              )}
              <div className="killfeed" style={{ flex: 1, minWidth: 260 }}>
                {revealed.map((e, i) => (
                  <FeedRow key={i} e={e} state={state} ign={ign} agentName={agentName} />
                ))}
                {showResult && round && (
                  <div className="fevent big">
                    🏁 {(round.end.win === "A" ? teamA?.tag : teamB?.tag)} 拿下回合（{howText(round.end.how)}）
                    · 存活 {round.end.alive.A}-{round.end.alive.B}
                    {(round.end.assists?.length ?? 0) > 0 && <> · 助攻：{round.end.assists!.map(ign).join("、")}</>}
                  </div>
                )}
              </div>
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
              <button onClick={() => setView((v) => (v === "2d" ? "text" : "2d"))}>
                {view === "2d" ? "📄 文字" : "🗺 2D 战术"}
              </button>
              <div className="grow" />
              <button className="ghost" onClick={onClose}>关闭 ✕</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** 对局中双方选手实时战绩板（GDD §5.4）：K/D/★FK/助攻/实时 ACS（已完成回合口径），阵亡灰显 */
function LiveScoreboard({ record, state, pos }: { record: MatchRecord; state: GameState; pos: Pos }) {
  const live = useMemo(() => liveLines(record.maps, pos), [record.maps, pos]);
  const map = record.maps[pos.mi];
  const deadNow = new Set<string>();
  for (const e of (map?.rounds[pos.ri]?.events ?? []).slice(0, Math.max(0, pos.ei + 1))) {
    if (e.t === "kill" && e.v) deadNow.add(e.v);
  }
  const ign = (pid: string) => state.players[pid]?.ign ?? pid;
  const teamA = state.teams[record.teamA];
  const teamB = state.teams[record.teamB];
  const col = (team: typeof teamA) =>
    (team?.starters ?? []).map((pid) => ({ pid, line: live.lines[pid] ?? { k: 0, d: 0, a: 0, fk: 0, dmg: 0 }, dead: deadNow.has(pid) }));
  const rowsA = col(teamA);
  const rowsB = col(teamB);
  const acsColor = (v: number) => (v >= 230 ? "var(--green)" : v < 110 ? "var(--muted)" : "inherit");
  const row = (r: { pid: string; line: { k: number; d: number; a: number; fk: number; dmg: number }; dead: boolean }) => (
    <div
      key={r.pid}
      className="small"
      style={{
        display: "flex", alignItems: "center", gap: 8, padding: "1px 6px", borderRadius: 4,
        background: r.dead ? "rgba(238,80,80,0.10)" : "rgba(255,255,255,0.03)",
        opacity: r.dead ? 0.5 : 1,
      }}
    >
      <span style={{ minWidth: 76, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ign(r.pid)}</span>
      <span className="muted" style={{ fontVariantNumeric: "tabular-nums", width: 52, textAlign: "right" }}>
        <b style={{ color: "inherit" }}>{r.line.k}</b>/{r.line.d}
        {r.line.fk > 0 && <span style={{ color: "#fb923c" }}>★{r.line.fk}</span>}
      </span>
      <span className="muted" style={{ fontVariantNumeric: "tabular-nums", width: 24, textAlign: "right" }}>{r.line.a}</span>
      <span style={{ fontVariantNumeric: "tabular-nums", width: 34, textAlign: "right", fontWeight: 700, color: acsColor(liveAcs(r.line.dmg, live.rounds)) }}>
        {liveAcs(r.line.dmg, live.rounds)}
      </span>
    </div>
  );
  const head = (tag: string | undefined, color: string) => (
    <div className="muted small" style={{ padding: "0 6px", color, display: "flex", gap: 8 }}>
      <span style={{ minWidth: 76 }}>{tag} 战绩</span>
      <span style={{ width: 52, textAlign: "right" }}>K/D</span>
      <span style={{ width: 24, textAlign: "right" }}>A</span>
      <span style={{ width: 34, textAlign: "right" }}>ACS</span>
    </div>
  );
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <div style={{ flex: 1, minWidth: 240, border: "1px solid var(--line)", borderRadius: 8, padding: "4px 6px", display: "flex", flexDirection: "column", gap: 2 }}>
        {head(teamA?.tag, "var(--green)")}
        {rowsA.map(row)}
      </div>
      <div style={{ flex: 1, minWidth: 240, border: "1px solid var(--line)", borderRadius: 8, padding: "4px 6px", display: "flex", flexDirection: "column", gap: 2 }}>
        {head(teamB?.tag, "#60a5fa")}
        {rowsB.map(row)}
      </div>
    </div>
  );
}

/** 结算数据表（GDD §5.4 v2.3）：选手头像 + 按队伍分组（胜方在前）；单图页含特工头像；MVP/SMVP 行标 */
function StatsTable(props: {
  state: GameState;
  record: MatchRecord;
  rows: StatRow[];
  winnerTeam: "A" | "B";
  mvpPid: string | null;
  smvpPid: string | null;
  agents?: Record<string, string>;
  title: string;
}) {
  const { state, record, rows, winnerTeam, mvpPid, smvpPid, agents, title } = props;
  const ign = (pid: string) => state.players[pid]?.ign ?? pid;
  if (rows.length === 0) return null;
  const kda = (r: { k: number; d: number; a: number }) => (r.d === 0 ? r.k + r.a : (r.k + r.a) / r.d);
  const teamIds = [...new Set(rows.map((r) => r.team))].sort(
    (a, b) => (a === winnerTeam ? -1 : 1) - (b === winnerTeam ? -1 : 1),
  );
  return (
    <div style={{ textAlign: "left", marginTop: 10 }}>
      <div className="muted small" style={{ textAlign: "center", marginBottom: 6 }}>{title}</div>
      {teamIds.map((t) => {
        const team = state.teams[t === "A" ? record.teamA : record.teamB];
        const tRows = rows.filter((r) => r.team === t);
        return (
          <div key={t} style={{ marginBottom: 8 }}>
            <div className="row" style={{ gap: 8, alignItems: "center", margin: "4px 2px" }}>
              {team && <TeamLogo team={team} size={18} />}
              <b style={{ color: t === "A" ? "var(--green)" : "#60a5fa" }}>{team?.name ?? t}</b>
              {t === winnerTeam ? <span className="tag green">胜方</span> : <span className="tag">败方</span>}
              <span className="muted small">队均 ACS {Math.round(tRows.reduce((s, r) => s + r.acs, 0) / Math.max(1, tRows.length))}</span>
            </div>
            <table>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>选手</th>
                  {agents && <th style={{ textAlign: "left" }}>特工</th>}
                  <th>K / D / A</th>
                  <th>KDA</th>
                  <th>ACS</th>
                  <th>FK / FD</th>
                  <th>残局</th>
                </tr>
              </thead>
              <tbody>
                {tRows.map((r) => {
                  const pl = state.players[r.pid];
                  const aid = agents?.[r.pid];
                  const aDef = aid ? AGENT_BY_ID.get(aid) : undefined;
                  return (
                    <tr
                      key={r.pid}
                      style={{ background: r.pid === mvpPid ? "rgba(251,191,36,0.09)" : r.pid === smvpPid ? "rgba(148,163,184,0.08)" : undefined }}
                    >
                      <td style={{ textAlign: "left", whiteSpace: "nowrap" }}>
                        <span className="row" style={{ gap: 6, alignItems: "center" }}>
                          {pl && <PlayerFace p={pl} size={22} showTag={false} />}
                          <b>{ign(r.pid)}</b>
                          {r.pid === mvpPid && <span className="tag" style={{ background: "#fbbf24", color: "#1a1a24" }}>MVP</span>}
                          {r.pid === smvpPid && <span className="tag">SMVP</span>}
                        </span>
                      </td>
                      {agents && (
                        <td style={{ whiteSpace: "nowrap" }}>
                          {aid ? (
                            <span className="row" style={{ gap: 5, alignItems: "center" }}>
                              <AgentIcon agentId={aid} size={22} name={aDef?.name} />
                              <span className="muted small">{aDef?.name ?? aid}</span>
                            </span>
                          ) : null}
                        </td>
                      )}
                      <td style={{ fontVariantNumeric: "tabular-nums" }}>{r.k} / {r.d} / {r.a}</td>
                      <td style={{ fontVariantNumeric: "tabular-nums" }}>{kda(r).toFixed(2)}</td>
                      <td style={{ fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{r.acs}</td>
                      <td style={{ fontVariantNumeric: "tabular-nums" }}>
                        <span style={{ color: "#fb923c" }}>{r.fk}</span> / <span style={{ color: "#f87171" }}>{r.fd}</span>
                      </td>
                      <td style={{ fontVariantNumeric: "tabular-nums" }}>{r.clutches > 0 ? <span className="tag green">{r.clutches}</span> : <span className="muted">0</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
      <div className="muted small" style={{ textAlign: "center", marginTop: 2 }}>
        ACS＝战斗评分/回合（伤害加权{agents ? "" : "，跨图按回合数加权"}） · FK/FD＝首杀/首死 · 残局＝1vX 得手 · MVP＝胜方最佳，SMVP＝败方最佳
      </div>
    </div>
  );
}

function EconBar({ tag, buy, atk }: { tag: string; buy: "full" | "force" | "eco"; atk: boolean }) {  const width = buy === "full" ? 100 : buy === "force" ? 55 : 22;
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
