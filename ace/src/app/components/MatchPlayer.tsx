/**
 * 比赛播放器 v1（GDD §5.4 转播级体验的文字流版本）：
 * 记分牌 / 逐回合击杀流 / 经济条 / 自动导播（关键回合自动降速）/ 倍速。
 * 只吃 MatchRecord——渲染与模拟完全分离（§5.1）。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { AGENT_BY_ID, ultCostOf } from "../../core/data/agents.ts";
import { AgentIcon, PlayerFace, TeamLogo } from "./Avatar.tsx";
import { MAP_BY_ID } from "../../core/data/maps.ts";
import { tacticLabel } from "../../core/data/mapplans.ts";
import { Tactical2D } from "./Tactical2D.tsx";
import { liveLines, liveMeta, summarizeMatch, pickMvps, type StatRow } from "../../core/sim/matchstats.ts";
import { PLAYER_CALLS, callLabel, type TacticCallDef } from "../../core/sim/tactics.ts";
import { buildReplayPayload, anonymizeReplay, shareLinkOf } from "../../core/sim/share.ts";
import { sfx } from "../audio.ts";
import type { GameState, IglReading, MapRecord, MatchRecord, RoundEvent } from "../../core/types.ts";

const SLOW_MS = 850;
const FAST_MS = 280;
const HEADER_MS = 480;
const RESULT_MS = 750;

interface Pos { mi: number; ri: number; ei: number } // ei: -1=回合头, 0..n-1=事件, n=回合结果

/** 与引擎 attackSideOf 同式（12 回合换边/加时交替），用于判断「下回合我方攻/守」 */
function atkSideOfRound(round: number, aAttacksFirst: boolean): "A" | "B" {
  const first = aAttacksFirst ? "A" : "B";
  const second = aAttacksFirst ? "B" : "A";
  if (round <= 12) return first;
  if (round <= 24) return second;
  return (round - 25) % 2 === 0 ? first : second;
}

export function MatchPlayer(props: {
  record: MatchRecord;
  state: GameState;
  onClose: () => void;
  startFinished?: boolean;
  /** v1.0-8：我的队伍 id——无则纯回放（旧档/他人比赛），无喊话与 IGL 交互 */
  myTeamId?: string | null;
  onIntervene?: (mapIdx: number, round: number, tactic: string, igl: boolean) => void;
  onFinished?: () => void;
  /** 教学局（v1.0-11，§3）：前三回合强制观战，第 3 回合结束自动开喊话菜单 */
  tutorial?: boolean;
}) {
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
  const [stinger, setStinger] = useState<{ main: string; sub: string } | null>(null); // 高光横幅（ACE/残局/零封）
  const [menuOpen, setMenuOpen] = useState(false); // v1.0-8 情境化暂停菜单
  const [iglCard, setIglCard] = useState<{ mi: number; reading: IglReading } | null>(null); // v1.0-8 IGL 场上阅读
  const [shareOpen, setShareOpen] = useState(false); // v1.0-12 分享面板
  const [shareAnon, setShareAnon] = useState(true); // 匿名化默认开（版权暴露面可控，§14）
  const [shareUrl, setShareUrl] = useState("");
  // 分享面板（v1.0-12，GDD §9.4）：回放中与终局结算页共用——赛后从赛程重开回放也要能分享
  const shareSection = shareOpen && (
    <div className="card" style={{ margin: "10px 0", padding: "10px 14px", textAlign: "left" }}>
      <b>🔗 分享这场回放</b>
      <div className="muted small" style={{ margin: "6px 0" }}>
        链接包含完整比赛记录（压缩编码，无需存档即可观看）。匿名化导出会把真实选手与队名替换为虚构名，建议公开分享时保持开启。
      </div>
      <label className="row small" style={{ gap: 6, margin: "6px 0" }}>
        <input type="checkbox" checked={shareAnon} onChange={(e) => { setShareAnon(e.target.checked); setShareUrl(""); }} />
        匿名化（隐藏真实选手/战队名）
      </label>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <button
          className="primary small"
          onClick={() => {
            void (async () => {
              const payload = buildReplayPayload(state, record);
              const final = shareAnon ? anonymizeReplay(payload) : payload;
              const url = await shareLinkOf(final);
              setShareUrl(url);
              try {
                await navigator.clipboard.writeText(url);
              } catch { /* 无剪贴板权限时仅展示 */ }
            })();
          }}
        >
          生成链接（自动复制）
        </button>
        {shareUrl && <span className="muted small">✅ 链接已复制（{(shareUrl.length / 1024).toFixed(1)}KB）</span>}
      </div>
      {shareUrl && <div className="muted small" style={{ marginTop: 6, wordBreak: "break-all", maxHeight: 60, overflowY: "auto" }}>{shareUrl}</div>}
    </div>
  );
  const iglHandled = useRef<Set<string>>(new Set());
  const finishedNotified = useRef(false);
  const awaitingRecord = useRef(false); // 干预后暂停，新 Record 到位再续播
  const timer = useRef<number | null>(null);
  const stingerTimer = useRef<number | null>(null);

  const map = record.maps[pos.mi];
  const round = map?.rounds[pos.ri];
  const teamA = state.teams[record.teamA];
  const teamB = state.teams[record.teamB];
  const ign = (pid: string) => state.players[pid]?.ign ?? pid;
  const agentName = (pid: string) => {
    const agentId = map?.agents?.[pid];
    return agentId ? (AGENT_BY_ID.get(agentId)?.name ?? "") : "";
  };

  // ---- v1.0-8 交互上下文：我的队伍/暂停余量/下回合攻守/经济与大招门控 ----
  const myTeamId = props.myTeamId ?? null;
  const mySide: "A" | "B" | null = myTeamId
    ? myTeamId === record.teamA
      ? "A"
      : myTeamId === record.teamB
        ? "B"
        : null
    : null;
  const interactive = !!mySide && !!props.onIntervene;
  const timeoutsLeft = useMemo(() => {
    if (!mySide) return 0;
    // 只看「已完整揭示」的回合（当前回合进行中的 end 属于未来信息）
    const idx = pos.ei === -1 ? pos.ri - 1 : pos.ri;
    const cur = idx >= 0 ? map?.rounds[idx]?.end.timeouts : undefined;
    if (cur) return cur[mySide];
    const base = 2 + ((state.teams[myTeamId ?? ""]?.staff?.match?.value ?? 0) >= 85 ? 1 : 0);
    return Math.max(0, base - (record.interventions?.filter((iv) => !iv.igl).length ?? 0));
  }, [map, pos.ri, pos.ei, mySide, myTeamId, state.teams, record.interventions]);
  const nextRound = round ? (pos.ei === -1 ? round.n : round.n + 1) : 1;
  const callLocked = useMemo(() => {
    if (!map || !mySide) return true;
    // 只扫已揭示回合（未来的 timeout 事件是未揭示信息，不得用于 UI 判定）
    const upto = pos.ei === -1 ? pos.ri - 1 : pos.ri;
    for (let i = upto; i >= 0; i--) {
      const r = map.rounds[i];
      if (!r) break;
      const ev = r.events.find((e) => e.t === "timeout" && e.side === mySide);
      if (ev) return nextRound <= r.n + (ev.igl ? 2 : 3) - 1;
    }
    return false;
  }, [map, mySide, nextRound, pos.ri, pos.ei]);
  const aAttacksFirst = map?.rounds[0]?.atk === "A";
  const atkSideNext = atkSideOfRound(nextRound, aAttacksFirst);
  const myAtkNext = mySide === atkSideNext;
  // 最近已揭示回合末快照（当前回合进行中则取上一回合；第 1 回合开局无快照）
  const lastEnd = (() => {
    const idx = pos.ei === -1 ? pos.ri - 1 : pos.ri;
    return idx >= 0 ? map?.rounds[idx]?.end : undefined;
  })();
  const myMoney = lastEnd?.money && mySide ? lastEnd.money[mySide] : undefined;
  const estBuy: "full" | "force" | "eco" | null =
    myMoney === undefined ? null : nextRound === 1 || nextRound === 13 || nextRound === 25
      ? "eco"
      : myMoney >= 3900 ? "full" : myMoney >= 2200 ? "force" : "eco";
  const coreReady = useMemo(() => {
    if (!map || !mySide || !lastEnd?.ults) return 0;
    let n = 0;
    for (const [pid, pts] of Object.entries(lastEnd.ults)) {
      const aid = map.agents?.[pid];
      if (!aid || pts < ultCostOf(aid)) continue;
      if (AGENT_BY_ID.get(aid)?.ultTiers?.[0] === "core") n++;
    }
    return n;
  }, [map, mySide, lastEnd]);
  const oppTeamId = mySide === "A" ? record.teamB : record.teamA;
  const intelPts = state.scouting?.[oppTeamId]?.points ?? 0;
  const matchCoach = myTeamId ? state.teams[myTeamId]?.staff?.match?.value ?? 0 : 0;
  const hintPrecise = intelPts >= 5 && matchCoach >= 50; // 预期提示精确 = 情报 ≥5（梯度侦察）× 比赛型教练（GDD §5.4）

  const doIntervene = (mapIdx: number, roundNo: number, tactic: string, igl: boolean) => {
    awaitingRecord.current = true;
    setPlaying(false);
    setMenuOpen(false);
    setIglCard(null);
    setShareUrl(""); // 重模拟后旧分享链接作废（v1.0-12）
    props.onIntervene?.(mapIdx, roundNo, tactic, igl);
  };
  useEffect(() => {
    if (awaitingRecord.current) {
      awaitingRecord.current = false;
      setPlaying(true);
    }
  }, [record]);

  // 播放自然结束 / 快进 → 通知结算（v1.0-8 交互式比赛此时才入账）
  useEffect(() => {
    if (finished && !finishedNotified.current) {
      finishedNotified.current = true;
      props.onFinished?.();
    }
  }, [finished, props]);

  // 教学局（v1.0-11，§3）：第 3 回合结果揭示时自动停靠并打开喊话菜单——「暂停喊一次战术」
  const menuShownRef = useRef(false);
  useEffect(() => {
    if (!props.tutorial || finished || menuShownRef.current) return;
    const r = map?.rounds[pos.ri];
    if (!r || pos.mi !== 0 || r.n !== 3 || pos.ei < r.events.length) return;
    menuShownRef.current = true;
    setPlaying(false);
    setMenuOpen(true);
  }, [pos, map, finished, props.tutorial]);
  const tutorialWatchLock = () =>
    props.tutorial === true && pos.mi === 0 && (pos.ri < 3 || (pos.ri === 3 && !showResult));

  // IGL 场上阅读（v1.0-8）：第 7/14 回合结果揭示时自动停靠，给建议卡（GDD §5.4）
  useEffect(() => {
    if (finished || !map || !mySide || !interactive) return;
    const r = map.rounds[pos.ri];
    if (!r || pos.ei < r.events.length) return; // 等回合结果揭示
    if (r.n !== 7 && r.n !== 14) return;
    const rd = map.readings?.find((x) => x.round === r.n);
    if (!rd || iglHandled.current.has(`${pos.mi}:${r.n}`)) return;
    iglHandled.current.add(`${pos.mi}:${r.n}`);
    setPlaying(false);
    setIglCard({ mi: pos.mi, reading: rd });
  }, [pos, map, finished, mySide, interactive]);

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

  // 高光 stinger：最新揭示的事件为 ACE/残局/零封时，弹全屏大字横幅（自动导播仪式感）
  useEffect(() => {
    if (!round || pos.ei < 0 || pos.ei >= round.events.length) return;
    const e = round.events[pos.ei]!;
    if (e.t !== "ace" && e.t !== "clutch" && e.t !== "flawless") return;
    const main = e.t === "ace" ? "ACE！" : e.t === "clutch" ? `1v${e.vs ?? 1} 残局！` : "零封！";
    const sub = e.t === "flawless" ? "满编无伤拿下回合" : `${ign(e.s ?? "")} 力挽狂澜`;
    setStinger({ main, sub });
    if (stingerTimer.current) window.clearTimeout(stingerTimer.current);
    stingerTimer.current = window.setTimeout(() => setStinger(null), 1700);
    return () => { if (stingerTimer.current) window.clearTimeout(stingerTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos.mi, pos.ri, pos.ei]);

  // 音效（v1.4-2，§10.4：WebAudio 自产合成，默认关）：回合起/击杀/下包/赛点
  useEffect(() => {
    if (!round || !playing) return;
    if (pos.ei === 0) sfx("round");
    if (pos.ei >= 0 && pos.ei < round.events.length) {
      const e = round.events[pos.ei]!;
      if (e.t === "kill") sfx("kill");
      else if (e.t === "plant") sfx("plant");
    }
    if (pos.ei >= round.events.length && isKeyRound) sfx("matchpoint");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos.mi, pos.ri, pos.ei, playing]);

  // 回合内双方存活数（从已揭示击杀反推）
  const aliveCounts = useMemo(() => {
    let da = 0;
    let db = 0;
    for (const e of revealed) {
      if (e.t !== "kill" || !e.v) continue;
      if (teamA && (teamA.starters.includes(e.v) || teamA.roster.includes(e.v))) da++;
      else db++;
    }
    return [5 - da, 5 - db];
  }, [revealed, teamA]);

  // 特工头像与队伍色（击杀流转播化）
  const iconOf = (pid: string) => map?.agents?.[pid] ?? "";
  const sideColor = (pid: string) =>
    teamA && (teamA.starters.includes(pid) || teamA.roster.includes(pid)) ? "#4ade80" : "#60a5fa";

  // 系列赛比分：播放中 = 当前图之前的胜场；结算 = 全部图（否则 2-0 横扫在结算页只显示 1:0）
  const series = useMemo(() => {
    let a = 0;
    let b = 0;
    const upto = finished ? record.maps.length : pos.mi;
    for (let i = 0; i < upto; i++) {
      const m = record.maps[i];
      if (!m) continue;
      if (m.score[0] > m.score[1]) a++;
      else b++;
    }
    return [a, b] as [number, number];
  }, [pos.mi, record.maps, finished]);

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
            {round && (
              <div className="muted" style={{ fontSize: 11.5, display: "flex", gap: 10, justifyContent: "center", alignItems: "center" }}>
                <span style={{ color: "#4ade80" }}>存活 {aliveCounts[0]}</span>
                <span style={{ opacity: 0.4 }}>·</span>
                <span style={{ color: "#60a5fa" }}>{aliveCounts[1]} 存活</span>
              </div>
            )}
          </div>
          <div className="team right" style={{ display: "flex", alignItems: "center", gap: 6 }}>{teamB?.tag}{teamB && <TeamLogo team={teamB} size={22} />}</div>
        </div>

        {/* 回合历史条（转播式）：每回合一个小方块，绿/蓝=胜方，当前回合脉冲 */}
        {map && !finished && (
          <div className="roundstrip">
            {map.rounds.slice(0, pos.ri + 1).map((r, i) => {
              const isCur = i === pos.ri;
              const winA = r.end.win === "A";
              const done = i < pos.ri || showResult;
              return (
                <span
                  key={r.n}
                  className={"rsq" + (isCur && !showResult ? " cur" : "")}
                  title={`第 ${r.n} 回合 · ${(winA ? teamA : teamB)?.tag} 拿下`}
                  style={done
                    ? { background: winA ? "#4ade80" : "#60a5fa" }
                    : { background: "rgba(255,255,255,0.14)" }}
                />
              );
            })}
          </div>
        )}

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
          // 单图页签的 MVP/SMVP 按本图胜负计算（该图胜方最佳=MVP、败方最佳=SMVP），不沿用系列赛结果
          const viewWinner: "A" | "B" = viewMap
            ? (viewMap.score[0] > viewMap.score[1] ? "A" : "B")
            : winnerTeam;
          const viewMvps = isSeriesView || !viewMap ? mvps : pickMvps(rows, viewWinner);
          const viewWinnerTeam = isSeriesView || !viewMap ? winnerTeam : viewWinner;
          // 系列赛特工序列：每名选手按图序的全部特工
          const seriesAgents: Record<string, string[]> = {};
          for (const m of record.maps) {
            for (const [pid, aid] of Object.entries(m.agents ?? {})) {
              (seriesAgents[pid] ??= []).push(aid);
            }
          }
          const tagA2 = teamA?.tag ?? "A", tagB2 = teamB?.tag ?? "B";
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
                <div style={{ marginTop: 8 }}>
                  <button className="small" onClick={() => { setShareOpen((o) => !o); setShareUrl(""); }}>🔗 分享回放</button>
                </div>
              </div>

              {shareSection}

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

              {/* 每图经济曲线 + 击杀时间轴（v1.4-2 外围包；end.money 旧档缺省时隐藏） */}
              {viewMap && <MapTrendCard map={viewMap} tagA={teamA?.tag ?? "A"} tagB={teamB?.tag ?? "B"} />}

              <StatsTable
                state={state}
                record={record}
                rows={rows}
                winnerTeam={viewWinnerTeam}
                mvpPid={viewMvps.mvp}
                smvpPid={viewMvps.smvp}
                agents={viewMap?.agents}
                agentSeq={isSeriesView ? seriesAgents : undefined}
                title={isSeriesView
                  ? `比赛总结 · 双方选手数据（全部 ${record.maps.length} 图汇总 · 比分 ${tagA2} ${record.score[0]} - ${record.score[1]} ${tagB2}）`
                  : `第 ${mapIdx + 1} 图数据 · ${MAP_BY_ID.get(viewMap?.map ?? "")?.name ?? ""} · ${tagA2} ${viewMap?.score[0] ?? 0} - ${viewMap?.score[1] ?? 0} ${tagB2}（本图胜负口径）`}
              />
              {isSeriesView && <AttributionTable record={record} state={state} />}
              {isSeriesView && <IglReviewTable record={record} state={state} />}
            </div>
          );
        })() : (
          <>
            {/* 回合信息条 */}
            {round && (
              <div className="roundline">
                <span>
                  第 {round.n} 回合 · {round.atk === "A" ? teamA?.tag : teamB?.tag} 进攻
                  <span className="muted"> · 战术：{tacticLabel(round.atk === "A" ? (round.tacticAtk ?? "atk:default") : (round.tacticDef ?? "def:standard"))}</span>
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

            {/* 高光 stinger（ACE/残局/零封） */}
      {stinger && !finished && (
        <div className="stinger">
          <div className="stinger-main">{stinger.main}</div>
          <div className="stinger-sub">{stinger.sub}</div>
        </div>
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
                  roundN={round.n}
                  tacticAtk={round.tacticAtk ?? "atk:default"}
                  tacticDef={round.tacticDef ?? "def:standard"}
                />
              )}
              <div className="killfeed" style={{ flex: 1, minWidth: 260 }}>
                {revealed.map((e, i) => (
                  <FeedRow key={i} e={e} state={state} ign={ign} agentName={agentName} iconOf={iconOf} sideColor={sideColor} />
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
              <button onClick={jumpToEnd} disabled={tutorialWatchLock()} title={tutorialWatchLock() ? "教学局：前三回合请完整观战" : undefined}>⏭ 跳到结果</button>
              {interactive && map && (
                <button
                  disabled={timeoutsLeft <= 0 || callLocked}
                  title={callLocked ? "上一条喊话仍在生效期" : timeoutsLeft <= 0 ? "暂停次数已用完" : "回合间喊话，效果持续 3 回合"}
                  onClick={() => { setPlaying(false); setMenuOpen(true); }}
                >
                  ⏱ 喊战术（剩 {timeoutsLeft}）
                </button>
              )}
              <button onClick={() => setView((v) => (v === "2d" ? "text" : "2d"))}>
                {view === "2d" ? "📄 文字" : "🗺 2D 战术"}
              </button>
              <button onClick={() => { setShareOpen((o) => !o); setShareUrl(""); }}>🔗 分享回放</button>
              <div className="grow" />
              <button className="ghost" onClick={onClose}>关闭 ✕</button>
            </div>

            {/* 分享面板（v1.0-12，GDD §9.4）：见 shareSection 定义处 */}
            {shareSection}

            {/* 情境化暂停战术菜单（v1.0-8，GDD §5.4）：按攻防方×经济×大招状态过滤 */}
            {menuOpen && (
              <PauseMenu
                myAtkNext={myAtkNext}
                estBuy={estBuy}
                coreReady={coreReady}
                hintPrecise={hintPrecise}
                intelPts={intelPts}
                matchCoach={matchCoach}
                onPick={(t) => doIntervene(pos.mi, nextRound, t, false)}
                onClose={() => { setMenuOpen(false); setPlaying(true); }}
              />
            )}

            {/* IGL 场上阅读（v1.0-8）：同样自信的呈现——低配误判不弱化样式，赛后复盘才揭示 */}
            {iglCard && !finished && (() => {
              const rd = iglCard.reading;
              return (
                <div className="card" style={{ margin: "12px auto", maxWidth: 460, border: "1px solid var(--accent)", boxShadow: "0 0 24px rgba(120,140,255,0.15)" }}>
                  <div className="muted small">🧠 场上阅读 · 第 {rd.round} 回合结束</div>
                  <div style={{ margin: "8px 0", fontSize: 14 }}>
                    <b>{ign(rd.iglId)}</b> 盯着回合回放，抬起头：
                  </div>
                  <div style={{ fontSize: 17, fontWeight: 800, margin: "6px 0 10px" }}>
                    “{callLabel(rd.suggested)}，下回合就打这个。”
                  </div>
                  <div className="muted small" style={{ marginBottom: 10 }}>
                    IGL 建议不消耗暂停次数，效果 2 回合 · 建议质量取决于 IGL 意识、情报等级与比赛型教练
                  </div>
                  <div className="row" style={{ justifyContent: "center", gap: 8, alignItems: "center" }}>
                    <button className="primary" disabled={callLocked} title={callLocked ? "上一条喊话仍在生效期" : ""} onClick={() => doIntervene(iglCard.mi, rd.round + 1, rd.suggested, true)}>
                      采纳
                    </button>
                    <button onClick={() => { setIglCard(null); setPlaying(true); }}>无视</button>
                  </div>
                  {callLocked && (
                    <div className="tag orange" style={{ marginTop: 8, display: "inline-block" }}>
                      上一条喊话仍在生效期，本建议无法立即采纳——生效结束后 IGL 会在下次暂停重新建议
                    </div>
                  )}
                </div>
              );
            })()}
          </>
        )}
      </div>
    </div>
  );
}

/** 对局中双方选手实时战绩板（GDD §5.4，转播样式）：特工头像 + K/D/A + 大招进度 + 经济池 */
function LiveScoreboard({ record, state, pos }: { record: MatchRecord; state: GameState; pos: Pos }) {
  const live = useMemo(() => liveLines(record.maps, pos), [record.maps, pos]);
  const meta = useMemo(() => liveMeta(record.maps, pos), [record.maps, pos]);
  const map = record.maps[pos.mi];
  const deadNow = new Set<string>();
  for (const e of (map?.rounds[pos.ri]?.events ?? []).slice(0, Math.max(0, pos.ei + 1))) {
    if (e.t === "kill" && e.v) deadNow.add(e.v);
  }
  const ign = (pid: string) => state.players[pid]?.ign ?? pid;
  const teamA = state.teams[record.teamA];
  const teamB = state.teams[record.teamB];
  const fmtMoney = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

  const col = (team: typeof teamA) =>
    (team?.starters ?? []).map((pid) => {
      const l = live.lines[pid] ?? { k: 0, d: 0, a: 0, fk: 0, dmg: 0 };
      const ult = meta.ults[pid];
      const agent = map?.agents?.[pid];
      return { pid, k: l.k, d: l.d, a: l.a, ult, agent, dead: deadNow.has(pid) };
    });
  const rowsA = col(teamA);
  const rowsB = col(teamB);

  const head = (team: typeof teamA, color: string) => {
    const money = team === teamA ? meta.money?.A : meta.money?.B;
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 8px", borderBottom: "1px solid var(--line)", marginBottom: 3 }}>
        {team && <TeamLogo team={team} size={16} />}
        <b style={{ color, fontSize: 12 }}>{team?.tag}</b>
        {money !== undefined && money !== null && (
          <span style={{ marginLeft: "auto", fontVariantNumeric: "tabular-nums", fontSize: 11, color: "var(--green)" }}>{fmtMoney(money)}</span>
        )}
      </div>
    );
  };
  const rowHead = (
    <div className="muted" style={{ display: "flex", gap: 6, padding: "0 8px 2px", fontSize: 10 }}>
      <span style={{ width: 118 }}>选手</span>
      <span style={{ width: 26, textAlign: "center" }}>K</span>
      <span style={{ width: 26, textAlign: "center" }}>D</span>
      <span style={{ width: 26, textAlign: "center" }}>A</span>
      <span style={{ width: 58, textAlign: "center" }}>大招</span>
      <span style={{ width: 62, textAlign: "right" }}>经济</span>
    </div>
  );
  const row = (r: { pid: string; k: number; d: number; a: number; ult?: number; agent?: string; dead: boolean }, accent: string, teamMoney: number | null | undefined) => {
    const ultCost = r.agent ? ultCostOf(r.agent) : 7;
    const ultReady = r.ult !== undefined && r.ult >= ultCost;
    const agentDef = r.agent ? AGENT_BY_ID.get(r.agent) : undefined;
    return (
      <div
        key={r.pid}
        style={{
          display: "flex", alignItems: "center", gap: 6, padding: "2.5px 8px", borderRadius: 5,
          background: r.dead ? "rgba(238,80,80,0.10)" : "rgba(255,255,255,0.028)",
          opacity: r.dead ? 0.5 : 1,
          borderLeft: `2px solid ${accent}`,
          fontSize: 11.5,
        }}
      >
        <span style={{ width: 118, display: "flex", alignItems: "center", gap: 5, overflow: "hidden", whiteSpace: "nowrap" }}>
          {r.agent && <AgentIcon agentId={r.agent} size={17} name={agentDef?.name} />}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{ign(r.pid)}</span>
        </span>
        <span style={{ width: 26, textAlign: "center", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{r.k}</span>
        <span className="muted" style={{ width: 26, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{r.d}</span>
        <span className="muted" style={{ width: 26, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{r.a}</span>
        <span style={{ width: 58, display: "flex", alignItems: "center", gap: 4 }} title={`大招点数 ${r.ult ?? 0}/${ultCost}`}>
          {r.ult === undefined ? (
            <span className="muted" style={{ fontSize: 10 }}>—</span>
          ) : ultReady ? (
            <span title="大招就绪" style={{ color: "#fbbf24", fontSize: 12, textShadow: "0 0 6px rgba(251,191,36,0.6)" }}>◆ 就绪</span>
          ) : (
            <>
              <span className="muted" style={{ fontVariantNumeric: "tabular-nums", fontSize: 10.5, width: 24 }}>{r.ult}/{ultCost}</span>
              <span style={{ flex: 1, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.10)", overflow: "hidden" }}>
                <span style={{ display: "block", height: "100%", width: `${((r.ult ?? 0) / ultCost) * 100}%`, background: "#8b7cf6", borderRadius: 2 }} />
              </span>
            </>
          )}
        </span>
        <span className="muted" style={{ width: 62, textAlign: "right", fontVariantNumeric: "tabular-nums", fontSize: 10.5 }}>
          {teamMoney != null ? fmtMoney(teamMoney) : "—"}
        </span>
      </div>
    );
  };
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <div style={{ flex: 1, minWidth: 265, border: "1px solid var(--line)", borderRadius: 8, padding: "5px 6px", display: "flex", flexDirection: "column", gap: 1.5, background: "rgba(74,222,128,0.03)" }}>
        {head(teamA, "var(--green)")}
        {rowHead}
        {rowsA.map((r) => row(r, "var(--green)", meta.money?.A))}
      </div>
      <div style={{ flex: 1, minWidth: 265, border: "1px solid var(--line)", borderRadius: 8, padding: "5px 6px", display: "flex", flexDirection: "column", gap: 1.5, background: "rgba(96,165,250,0.03)" }}>
        {head(teamB, "#60a5fa")}
        {rowHead}
        {rowsB.map((r) => row(r, "#60a5fa", meta.money?.B))}
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
  /** 系列赛模式：pid → 按图序的全部特工 */
  agentSeq?: Record<string, string[]>;
  title: string;
}) {
  const { state, record, rows, winnerTeam, mvpPid, smvpPid, agents, agentSeq, title } = props;
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
                  {(agents || agentSeq) && <th style={{ textAlign: "left" }}>特工</th>}
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
                      {(agents || agentSeq) && (
                        <td style={{ whiteSpace: "nowrap" }}>
                          {aid ? (
                            <span className="row" style={{ gap: 5, alignItems: "center" }}>
                              <AgentIcon agentId={aid} size={22} name={aDef?.name} />
                              <span className="muted small">{aDef?.name ?? aid}</span>
                            </span>
                          ) : agentSeq?.[r.pid]?.length ? (
                            <span className="row" style={{ gap: 3, alignItems: "center" }}>
                              {agentSeq[r.pid].map((aid2, ai) => (
                                <span key={ai} title={AGENT_BY_ID.get(aid2)?.name ?? aid2} style={{ position: 'relative' }}>
                                  <AgentIcon agentId={aid2} size={20} name={AGENT_BY_ID.get(aid2)?.name} />
                                  {ai > 0 && <span style={{ position: 'absolute', left: -2, top: -4, fontSize: 8, color: 'var(--muted)' }}>{ai + 1}</span>}
                                </span>
                              ))}
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
  iconOf: (pid: string) => string;
  sideColor: (pid: string) => string;
}) {
  const { e, ign, agentName, iconOf, sideColor } = props;
  if (e.t === "kill") {
    const kName = ign(e.s ?? "");
    const vName = ign(e.v ?? "");
    const kAid = iconOf(e.s ?? "");
    const vAid = iconOf(e.v ?? "");
    const kColor = sideColor(e.s ?? "");
    const vColor = sideColor(e.v ?? "");
    return (
      <div className="fevent kill" style={{ display: "flex", alignItems: "center", gap: 7 }}>
        {e.first && <span className="tag orange" style={{ marginRight: 4 }}>首杀</span>}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, minWidth: 0 }}>
          {kAid && <AgentIcon agentId={kAid} size={19} name={agentName(e.s ?? "")} />}
          <b style={{ color: kColor, whiteSpace: "nowrap" }}>{kName}</b>
        </span>
        <span className="muted" style={{ fontSize: 11 }}>击倒</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, minWidth: 0, opacity: 0.85 }}>
          {vAid && <AgentIcon agentId={vAid} size={19} name={agentName(e.v ?? "")} />}
          <span style={{ color: vColor, whiteSpace: "nowrap" }}>{vName}</span>
        </span>
        <span style={{ marginLeft: "auto", fontSize: 11, opacity: 0.55 }}>💀</span>
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
  if (e.t === "timeout") {
    if (e.player) {
      return e.igl
        ? <div className="fevent big">🧠 IGL 建议被采纳：{callLabel(e.tactic ?? "")}（效果 2 回合）</div>
        : <div className="fevent big">📋 战术喊话：{callLabel(e.tactic ?? "")}（效果 3 回合）</div>;
    }
    return <div className="fevent">⏸ 战术暂停（效果 3 回合）</div>;
  }
  return null;
}

/** 情境化暂停战术菜单（v1.0-8，GDD §5.4）：选项按攻防方/经济/大招状态过滤；预期提示精度 = 情报 × 比赛型教练 */
function PauseMenu(props: {
  myAtkNext: boolean;
  estBuy: "full" | "force" | "eco" | null;
  coreReady: number;
  hintPrecise: boolean;
  intelPts: number;
  matchCoach: number;
  onPick: (tactic: string) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<TacticCallDef | null>(null);
  const [site, setSite] = useState<"A" | "B">("A");
  const side = props.myAtkNext ? "atk" : "def";
  const options = PLAYER_CALLS.filter(
    (c) => c.side === side && (!c.needsFullBuy || props.estBuy === "full") && (!c.needsCoreUlts || props.coreReady >= 2),
  );
  const fmt = (n: number) => (n > 0 ? `+${n.toFixed(1)}` : n.toFixed(1));
  return (
    <div className="card" style={{ margin: "12px auto", maxWidth: 520, textAlign: "left", border: "1px solid var(--accent)" }}>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 4 }}>
        <b>⏱ 战术喊话</b>
        <button className="ghost small" onClick={props.onClose}>取消</button>
      </div>
      <div className="muted small" style={{ marginBottom: 8 }}>
        下回合我方{props.myAtkNext ? "进攻" : "防守"}
        {props.estBuy && <> · 预估经济 <b>{props.estBuy === "full" ? "长枪" : props.estBuy === "force" ? "强起" : "eco"}</b></>}
        {" · 核心大招就绪 "}<b>{props.coreReady}</b>
        {" · 持续 3 回合"}
      </div>
      {!picked ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {options.map((c) => (
            <button key={c.id} style={{ textAlign: "left", padding: "8px 12px" }} onClick={() => (c.pickSite ? setPicked(c) : props.onPick(c.id))}>
              <b>{c.label}</b>
              <span className="muted small" style={{ display: "block", marginTop: 2 }}>{c.desc}</span>
              <span className="small" style={{ display: "block", marginTop: 2, color: props.hintPrecise ? "var(--green)" : "var(--muted)" }}>
                {props.hintPrecise
                  ? `预期 ${side === "atk" ? `进攻 ${fmt(c.atkMod)}` : `防守 ${fmt(c.defMod)}`} · 后手 ${(side === "atk" ? c.defMod : c.atkMod).toFixed(1)}`
                  : "效果难以预估（情报不足或比赛教练偏弱）"}
              </span>
            </button>
          ))}
          {options.length === 0 && <div className="muted small">当前局势没有可用的喊话选项。</div>}
        </div>
      ) : (
        <div style={{ textAlign: "center" }}>
          <div style={{ marginBottom: 8 }}><b>{picked.label}</b> —— 选择目标点位：</div>
          <div className="row" style={{ justifyContent: "center", gap: 10 }}>
            {(["A", "B"] as const).map((s) => (
              <button key={s} className={site === s ? "primary" : ""} onClick={() => setSite(s)}>{s} 点</button>
            ))}
          </div>
          <button className="primary" style={{ marginTop: 10 }} onClick={() => props.onPick(`${picked.id}:${site}`)}>
            确认喊话 {picked.label} {site} 点
          </button>
        </div>
      )}
      {!props.hintPrecise && (
        <div className="muted small" style={{ marginTop: 8 }}>
          提示精度：情报 {props.intelPts} 点 · 比赛型教练 {props.matchCoach}——达标后显示量化预期
        </div>
      )}
    </div>
  );
}

/** IGL 场上阅读复盘（v1.0-8，GDD §5.4 v2.5）：赛后回看「当时 IGL 读了什么」与对错 */
function IglReviewTable({ record, state }: { record: MatchRecord; state: GameState }) {
  const ign = (pid: string) => state.players[pid]?.ign ?? pid;
  const rows = record.maps.flatMap((m, i) => (m.readings ?? []).map((r) => ({ mi: i, r })));
  if (rows.length === 0) return null;
  return (
    <div className="card" style={{ textAlign: "left", marginTop: 12, padding: "10px 16px" }}>
      <div className="muted small" style={{ marginBottom: 6 }}>🧠 IGL 场上阅读复盘（当时他读了什么）</div>
      {rows.map(({ mi, r }) => {
        const adopted = record.interventions?.some((iv) => iv.igl && iv.map === mi && iv.round === r.round + 1 && iv.tactic === r.suggested);
        return (
          <div key={`${mi}:${r.round}`} style={{ fontSize: 12.5, padding: "3px 0", borderBottom: "1px solid var(--line)" }}>
            第 {mi + 1} 图 · 第 {r.round} 回合 · <b>{ign(r.iglId)}</b>：“{callLabel(r.suggested)}”
            <span style={{ marginLeft: 8 }}>{adopted ? <span className="tag green">已采纳</span> : <span className="tag">未采纳</span>}</span>
            <span style={{ marginLeft: 8 }}>
              {r.correct
                ? <span style={{ color: "var(--green)" }}>复盘：读图正确</span>
                : <span style={{ color: "#f87171" }}>复盘：自信误判（对手根本不在这套路子上）</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
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

/** 每图经济曲线 + 击杀时间轴（v1.4-2 外围包）：纯 SVG；end.money 缺省（旧档）整卡隐藏。
 *  击杀口径：回合末存活差分（上场 5 人 − alive）即本回合阵亡数，按方分列。 */
function MapTrendCard({ map, tagA, tagB }: { map: MapRecord; tagA: string; tagB: string }) {
  const rounds = map.rounds;
  if (!rounds.some((r) => r.end.money != null)) return null; // 旧档无经济快照
  const money = rounds.map((r) => r.end.money);
  const kA: number[] = [], kB: number[] = [];
  let prevA = 5, prevB = 5;
  for (const r of rounds) {
    kA.push(Math.max(0, prevA - r.end.alive.A));
    kB.push(Math.max(0, prevB - r.end.alive.B));
    prevA = r.end.alive.A; prevB = r.end.alive.B;
  }
  const W = 680, H = 150, pad = { l: 46, r: 10, t: 10, b: 18 };
  const n = rounds.length;
  const mvals = money.filter((m): m is { A: number; B: number } => m != null);
  const mHi = Math.max(...mvals.flatMap((m) => [m.A, m.B]), 1);
  const xOf = (i: number) => pad.l + (i / Math.max(1, n - 1)) * (W - pad.l - pad.r);
  const yOf = (v: number) => pad.t + (1 - v / mHi) * (H - pad.t - pad.b);
  const line = (side: "A" | "B") =>
    money.map((m, i) => (m == null ? null : `${xOf(i)},${yOf(m[side])}`)).filter(Boolean).join(" ");
  const kMax = Math.max(...kA, ...kB, 1);
  const barW = Math.max(2, (W - pad.l - pad.r) / n - 1.5);
  const midY = H - pad.b;
  return (
    <div className="card" style={{ margin: "10px 0", textAlign: "left", padding: "10px 14px" }}>
      <b>📈 经济与击杀曲线 · {MAP_BY_ID.get(map.map)?.name ?? map.map}</b>
      <svg viewBox={`0 0 ${W} ${H + 44}`} style={{ width: "100%", maxWidth: W }}>
        <line x1={pad.l} y1={yOf(0)} x2={W - pad.r} y2={yOf(0)} stroke="rgba(255,255,255,0.15)" />
        <text x={pad.l - 5} y={yOf(mHi) + 8} fontSize={9} textAnchor="end" fill="rgba(255,255,255,0.4)">${Math.round(mHi / 1000)}K</text>
        <polyline points={line("A")} fill="none" stroke="#4ade80" strokeWidth={1.6} />
        <polyline points={line("B")} fill="none" stroke="#60a5fa" strokeWidth={1.6} />
        {rounds.map((r, i) => {
          const hA = (kA[i]! / kMax) * 26;
          const hB = (kB[i]! / kMax) * 26;
          return (
            <g key={i}>
              <rect x={xOf(i) - barW / 2} y={midY - hA} width={barW} height={hA} fill="#4ade80" opacity={0.55}>
                <title>{`R${r.n}：${tagA} 拿 ${kA[i]} 杀 / ${tagB} 拿 ${kB[i]} 杀`}</title>
              </rect>
              <rect x={xOf(i) - barW / 2} y={midY} width={barW} height={hB} fill="#60a5fa" opacity={0.55} />
            </g>
          );
        })}
        <line x1={pad.l} y1={midY} x2={W - pad.r} y2={midY} stroke="rgba(255,255,255,0.2)" />
        <text x={W / 2} y={H + 38} fontSize={9.5} textAnchor="middle" fill="rgba(255,255,255,0.45)">
          上条 = {tagA} 每回合击杀 · 下条 = {tagB} · 线 = 回合末经济池
        </text>
      </svg>
    </div>
  );
}
