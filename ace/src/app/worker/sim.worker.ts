/** 模拟 Worker（GDD §11.1）：权威 state 常驻此处，主线程只拿快照渲染。 */
import { generateWorld, resetPlayerSeq, salaryFor, spawnFreeAgents } from "../../core/worldgen.ts";
import { initSeasonFixtures, advanceDay, playHeldMatch } from "../../core/sim/day.ts";
import { spawnDailyEvents, spawnBirthdays, resolveEvent } from "../../core/sim/events.ts";
import { startNegotiation, reNegotiate, finalizeOffer, completeTransfer, releasePlayer } from "../../core/sim/transfer.ts";
import { Rng, hashString } from "../../core/rng.ts";
import type { GameState, MatchRecord, Preset, TransferOffer } from "../../core/types.ts";

export interface SavedPayload {
  state: GameState;
  records: Record<string, MatchRecord>;
}

let state: GameState | null = null;
let records: Record<string, MatchRecord> = {};
/** 请求-响应：每个回包必须回带 seq（主线程 Promise 依赖） */
let currentSeq: number | undefined;

function reply(msg: Record<string, unknown>): void {
  (self as unknown as Worker).postMessage({ ...msg, seq: currentSeq });
}

function snapshot() {
  return { state: structuredClone(state), records: structuredClone(records) };
}

function doAdvance(maxDays = 1): void {
  if (!state) return;
  const notes: string[] = [];
  const playedMine: string[] = [];
  const held: { fixtureId: string; teamA: string; teamB: string; bo: 1 | 3 | 5; label: string } | null = null;
  let seasonEnded = false;
  for (let i = 0; i < maxDays && !seasonEnded; i++) {
    const r = advanceDay(
      state,
      [],
      (rec, fixtureId, mine) => {
        if (mine) {
          records[fixtureId] = rec;
          playedMine.push(fixtureId);
        }
      },
      // 我的比赛开打前：拦截并停车（第一场生效，后续场次正常）
      (fixtureId, teamA, teamB, bo, label) => {
        void held;
        replyHeld = { fixtureId, teamA, teamB, bo, label };
        return true;
      },
    );
    notes.push(...r.notes);
    seasonEnded = r.seasonEnded;
    if (replyHeld) break; // 停车等待赛前准备
  }
  reply({
    type: "advanced",
    ...snapshot(),
    notes,
    playedMine: replyHeld ? [] : playedMine,
    seasonEnded,
    held: replyHeld,
  });
  replyHeld = null;
}

/** 被拦截等待赛前准备的我的比赛 */
let replyHeld: { fixtureId: string; teamA: string; teamB: string; bo: 1 | 3 | 5; label: string } | null = null;

/** 存档迁移（GDD §11.4）：旧档缺失字段补默认值——新版本字段在此统一兜底 */
function migrate(state: GameState): GameState {
  state.transferFeed ??= [];
  state.incomingBids ??= [];
  state.manager ??= {
    name: "经理",
    reputation: 40,
    skills: { training: 50, negotiation: 50, tactics: 50, scouting: 50, medical: 50, business: 50, locker: 50, youth: 50 },
  };
  state.trainingMaps ??= ["jingjie"];
  state.schedules ??= {};
  for (const p of Object.values(state.players)) {
    p.xp ??= {};
    p.focus ??= "rest";
    p.listed ??= false;
    p.releaseClause ??= 0;
    p.noPoach ??= false;
    p.benchedWeeks ??= 0;
    // v0.5 检错修复：旧档薪资被 salaryFor 旧公式放大 1000 倍，按面板整体重算
    const tier = p.teamId ? state.teams[p.teamId]?.tier ?? 1 : 2;
    if (p.salary > 5_000_000) p.salary = salaryFor(p.overall, tier as 1 | 2);
    // 事件卡字段（v0.5-2）
    p.birthdayDay ??= (hashString(p.id) % 340) + 1;
    p.lastEventDay ??= 0;
  }
  // 旧档无自由人池 → 注入 14 名自由人（自由市场/紧急补位的来源）
  if (!Object.values(state.players).some((p) => !p.teamId)) {
    spawnFreeAgents(state, new Rng((state.seed ^ 0xfaee) >>> 0), 14);
  }
  state.pendingEvents ??= [];
  state.lastEventDay ??= 0;
  return state;
}

self.onmessage = (e: MessageEvent) => {
  const msg = e.data as Record<string, unknown>;
  currentSeq = msg.seq as number | undefined;
  const type = msg.type as string;
  if (type === "new") {
    resetPlayerSeq();
    const seed = msg.seed as number;
    state = generateWorld(seed);
    state.myTeamId = msg.teamId as string;
    records = {};
    initSeasonFixtures(state);
    reply({ type: "ready", ...snapshot() });
  } else if (type === "load") {
    const saved = msg.save as SavedPayload;
    state = migrate(saved.state);
    records = saved.records;
    reply({ type: "ready", ...snapshot() });
  } else if (type === "advance") {
    doAdvance(1);
  } else if (type === "advanceToNextMatch") {
    doAdvance(320); // 跨越休赛期 + 季前 + 揭幕杯（最长约 160 天）
  } else if (type === "setStarters") {
    if (state?.myTeamId) {
      const team = state.teams[state.myTeamId];
      if (team) team.starters = msg.starters as string[];
    }
    reply({ type: "snapshot", ...snapshot() });
  } else if (type === "setPreset") {
    if (state?.myTeamId) {
      const team = state.teams[state.myTeamId];
      if (team) {
        const mapId = msg.mapId as string;
        const preset = msg.preset as Preset;
        const list = team.presets[mapId] ?? [];
        const existing = list.findIndex((x) => x.name === preset.name);
        if (existing >= 0) list[existing] = preset;
        else list.push(preset);
        team.presets[mapId] = list.slice(-8);
      }
    }
    reply({ type: "snapshot", ...snapshot() });
  } else if (type === "applyPreset") {
    if (state?.myTeamId) {
      const team = state.teams[state.myTeamId];
      const mapId = msg.mapId as string;
      const name = msg.name as string;
      const preset = team?.presets[mapId]?.find((x) => x.name === name);
      if (team && preset) {
        team.starters = Object.keys(preset.agents).filter((id) => team.roster.includes(id));
        // 该图首选标记（比赛引擎按 preferred 预案的 agents 读取——v0.1 引擎用自动分配，此处先落库）
        team.presets[mapId] = team.presets[mapId] ?? [];
        for (const p of team.presets[mapId]) p.preferred = p.name === name;
      }
    }
    reply({ type: "snapshot", ...snapshot() });
  } else if (type === "setTeamSchedule") {
    if (state) {
      state.teamSchedule = msg.slots as string[];
      state.trainingMaps = msg.maps as string[];
      if (msg.schedules) state.schedules = msg.schedules as Record<string, string>;
    }
    reply({ type: "snapshot", ...snapshot() });
  } else if (type === "getRecord") {
    const rec = records[msg.fixtureId as string] ?? null;
    reply({ type: "record", fixtureId: msg.fixtureId, record: rec ? structuredClone(rec) : null });
  } else if (type === "playHeldMatch") {
    if (state) {
      const rec = playHeldMatch(
        state,
        msg.fixtureId as string,
        {
          starters: msg.starters as string[] | undefined,
          maps: msg.maps as string[] | null | undefined,
          agentPicks: msg.agentPicks as Record<string, Record<string, string>> | undefined,
        },
        (rec2, fid) => {
          records[fid] = rec2;
        },
      );
      reply({ type: "played", ...snapshot(), record: rec ? structuredClone(rec) : null });
    } else {
      reply({ type: "played", state: null, records: {}, record: null });
    }
  } else if (type === "resolveEvent") {
    if (state) {
      const r = resolveEvent(state, msg.uid as string, msg.optionIndex as number, new Rng(hashString(`${state.seed}:ev:${msg.uid}`)));
      reply({ type: "snapshot", ...snapshot(), result: r?.result ?? null });
    } else {
      reply({ type: "snapshot", state: null, records: {}, result: null });
    }
  } else if (type === "getSnapshot") {
    reply({ type: "snapshot", ...snapshot() });
  } else if (type === "listPlayer") {
    if (state) {
      const p = state.players[msg.pid as string];
      if (p) {
        p.listed = !!msg.listed;
        const team = p.teamId ? state.teams[p.teamId] : null;
        state.transferFeed.push({ day: state.day, year: state.year, kind: "list", text: `${team?.name ?? "?"} 挂牌 ${p.ign}。` });
        if (state.transferFeed.length > 300) state.transferFeed.splice(0, state.transferFeed.length - 300);
      }
    }
    reply({ type: "snapshot", ...snapshot() });
  } else if (type === "releasePlayer") {
    let message = "";
    if (state) message = releasePlayer(state, msg.pid as string);
    reply({ type: "snapshot", ...snapshot(), message });
  } else if (type === "respondBid") {
      if (state) {
      const id = msg.offerId as string;
      const idx = state.incomingBids.findIndex((b) => b.id === id);
      if (idx >= 0) {
        const bid = state.incomingBids[idx] as TransferOffer;
        const buyer = bid.fromTeam as string;
        if (msg.accept) {
          completeTransfer(state, { ...bid, toTeam: buyer }, new Rng(hashString(`${state.seed}:bid:${id}`)));
        } else {
          const p = state.players[bid.playerId];
          if (p) p.morale = Math.max(10, p.morale - 4);
          state.news.push({ day: state.day, kind: "transfer", text: `已拒绝 ${state.teams[buyer]?.name ?? "对方"} 对 ${p?.ign ?? "?"} 的报价（士气 -4）。` });
        }
        state.incomingBids.splice(idx, 1);
      }
    }
    reply({ type: "snapshot", ...snapshot() });
  } else if (type === "startNegotiation") {
    if (!state) return reply({ type: "negotiation", state: null });
    if (state.actionPoints < 1) {
      return reply({ type: "negotiation", error: "行动力不足：对外事务每天各花 1 点。", ...snapshot() });
    }
    state.actionPoints--;
    const offer: TransferOffer = {
      id: `NEG${state.day}_${msg.playerId as string}`,
      playerId: msg.playerId as string,
      fromTeam: state.players[msg.playerId as string]?.teamId ?? null,
      toTeam: state.myTeamId as string,
      fee: msg.fee as number,
      salary: msg.salary as number,
      years: msg.years as number,
      signingBonus: msg.signingBonus as number,
      promisedRole: msg.promisedRole as TransferOffer["promisedRole"],
      day: state.day,
      round: 0,
      demand: "",
      attitude: 0,
    };
    negSession = offer;
    const r = startNegotiation(state, offer);
    reply({ type: "negotiation", offer: structuredClone(offer), demand: r.demand, attitude: r.attitude, insulting: r.insulting, ...snapshot() });
  } else if (type === "reNegotiate") {
    if (state && negSession) {
      negSession.fee = msg.fee as number;
      negSession.salary = msg.salary as number;
      negSession.years = msg.years as number;
      negSession.signingBonus = msg.signingBonus as number;
      negSession.promisedRole = msg.promisedRole as TransferOffer["promisedRole"];
      const r = reNegotiate(state, negSession);
      reply({ type: "negotiation", offer: structuredClone(negSession), demand: r.demand, attitude: r.attitude, insulting: false, ...snapshot() });
    }
  } else if (type === "finalizeNegotiation") {
    if (state && negSession) {
      const rng = new Rng(hashString(`${state.seed}:neg:${negSession.playerId}:${state.day}`));
      const r = finalizeOffer(state, negSession, rng);
      if (r.accepted) completeTransfer(state, negSession, rng);
      negSession = null;
      reply({ type: "negotiationFinal", ...snapshot(), accepted: r.accepted, reason: r.reason });
    } else {
      reply({ type: "negotiationFinal", ...snapshot(), accepted: false, reason: "谈判会话已失效。" });
    }
  }
};

/** 进行中的谈判会话（Worker 内存，不进存档——刷新即放弃谈判） */
let negSession: TransferOffer | null = null;
