/** 模拟 Worker（GDD §11.1）：权威 state 常驻此处，主线程只拿快照渲染。 */
import { generateWorld, resetPlayerSeq, salaryFor, spawnFreeAgents, migrateMapsToRealPool } from "../../core/worldgen.ts";
import { initSeasonFixtures, advanceDay, playHeldMatch, migrateLegacyComps } from "../../core/sim/day.ts";
import { resolveEvent } from "../../core/sim/events.ts";
import { startNegotiation, reNegotiate, finalizeOffer, completeTransfer, releasePlayer, inTransferWindow, graceRemain, askInquiry } from "../../core/sim/transfer.ts";
import { signSponsorOffer, cancelSponsorById, acceptGig, declineGig, signStream, cancelStream } from "../../core/sim/business.ts";
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
        replyHeld = { fixtureId, teamA, teamB, bo, label };
        return true;
      },
    );
    notes.push(...r.notes);
    seasonEnded = r.seasonEnded;
    if (replyHeld) break; // 停车等待赛前准备
  }
  if (seasonEnded) records = {}; // 翻年清回放：旧赛季 fixture 已重建，链接不再可达；防无限增长拖慢每帧快照克隆
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
    life: { wallet: 2000, hunger: 80, mood: 70 },
  };
  state.manager.life ??= { wallet: 2000, hunger: 80, mood: 70 };
  state.trainingMaps ??= ["ascent"];
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
    p.birthdayDay ??= (hashString(p.id) % 365) + 1;
    p.lastEventDay ??= 0;
    // 商务字段（v0.5-4）：旧档缺失即崩（Business 页/周结算直接读）
    p.commercialDays ??= 0;
    p.stream ??= null;
  }
  for (const t of Object.values(state.teams)) {
    t.sponsors ??= [];
    t.presets ??= {};
    // v0.6-1 双赛区：旧档单赛区队伍归入霞赛区
    t.regionId ??= "xia";
  }
  state.finances ??= { log: [] };
  state.sponsorOffers ??= [];
  state.gigOffers ??= [];
  // 旧档无自由人池 → 注入 14 名自由人（自由市场/紧急补位的来源）
  if (!Object.values(state.players).some((p) => !p.teamId)) {
    spawnFreeAgents(state, new Rng((state.seed ^ 0xfaee) >>> 0), 14);
  }
  state.pendingEvents ??= [];
  state.lastEventDay ??= 0;
  state.scouting ??= {};
  state.agentTraining ??= {};
  state.inquiries ??= [];
  // v0.6-1：旧单赛区 comp key → 霞赛区新命名（过渡年结算/Masters 依赖）
  migrateLegacyComps(state);
  // v0.7 真实数据包：旧档虚构地图 id 全量映射到真实图池（逻辑在 core，可测）
  migrateMapsToRealPool(state);
  // 旧档我的队若已不在（异常存档）：置空回到选队界面而不是崩溃
  if (state.myTeamId && !state.teams[state.myTeamId]) state.myTeamId = null;
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
  } else if (type === "askInquiry") {
    if (state) {
      const msg2 = state.actionPoints >= 1 ? askInquiry(state, msg.playerId as string, new Rng(hashString(state.seed + ":inq:" + state.day + ":" + (msg.playerId as string)))) : "行动力不足。";
      if (msg2 && !msg2.includes("等待答复") && !msg2.includes("问价中")) { /* 失败不扣点 */ } else if (msg2) state.actionPoints--;
      reply({ type: "snapshot", ...snapshot(), message: msg2 });
    }
  } else if (type === "setCommander") {
    if (state && state.myTeamId) {
      const team = state.teams[state.myTeamId];
      if (team) {
        const mainId = msg.mainId as string;
        const viceId = msg.viceId as string | null;
        for (const pid of team.roster) {
          const p = state.players[pid];
          if (!p) continue;
          p.isIgl = pid === mainId;
          p.viceIgl = !!viceId && pid === viceId && pid !== mainId;
        }
      }
    }
    reply({ type: "snapshot", ...snapshot() });
  } else if (type === "setAgentTraining") {
    if (state) {
      const picks = msg.picks as Record<string, string>;
      const cur = state;
      const entries = Object.entries(picks).filter(([pid, aid]) => cur.players[pid] && aid);
      cur.agentTraining = Object.fromEntries(entries.slice(0, 5)); // ≤5 人守卫（GDD §6.3）
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
  } else if (type === "scoutTeam") {
    if (state) {
      if (state.actionPoints < 1) {
        reply({ type: "snapshot", ...snapshot(), error: "行动力不足：侦察花 1 点。" });
      } else {
        state.actionPoints--;
        const oppId = msg.teamId as string;
        const cur = state.scouting[oppId] ?? { points: 0, last: 0 };
        state.scouting[oppId] = { points: Math.min(10, cur.points + 2), last: state.day };
        reply({ type: "snapshot", ...snapshot(), intel: state.scouting[oppId]!.points });
      }
    } else {
      reply({ type: "snapshot", state: null, records: {} });
    }
  } else if (type === "signSponsor") {
    if (state) {
      const offer = (state.sponsorOffers ?? []).find((o) => o.id === msg.offerId);
      if (offer) {
        const r = signSponsorOffer(state, offer, new Rng(hashString(`${state.seed}:sp:${offer.id}`)));
        reply({ type: "snapshot", ...snapshot(), message: r.text });
        return;
      }
    }
    reply({ type: "snapshot", ...snapshot(), message: "赞助意向已过期。" });
  } else if (type === "cancelSponsor") {
    if (state) cancelSponsorById(state, msg.sponsorId as string);
    reply({ type: "snapshot", ...snapshot() });
  } else if (type === "acceptGig") {
    let message = "";
    if (state) {
      const r = acceptGig(state, msg.gigId as string);
      message = r.text;
    }
    reply({ type: "snapshot", ...snapshot(), message });
  } else if (type === "declineGig") {
    if (state) state.gigOffers = state.gigOffers.filter((g) => g.id !== msg.gigId);
    reply({ type: "snapshot", ...snapshot() });
  } else if (type === "signStream") {
    if (state) {
      const r = signStream(state, msg.playerId as string, 3, new Rng(hashString(`${state.seed}:stream:${msg.playerId}`)));
      reply({ type: "snapshot", ...snapshot(), message: r.text });
      return;
    }
    reply({ type: "snapshot", state: null, records: {} });
  } else if (type === "cancelStream") {
    if (state) cancelStream(state, msg.playerId as string);
    reply({ type: "snapshot", ...snapshot() });
  } else if (type === "managerLife") {
    let message = "";
    if (state?.manager?.life) {
      const life = state.manager.life;
      const kind = msg.kind as string;
      if (kind === "meal" && life.wallet >= 30) {
        life.wallet -= 30;
        life.hunger = Math.min(100, life.hunger + 35);
        message = "简单吃了一顿，饱腹 +35。";
      } else if (kind === "feast" && life.wallet >= 120) {
        life.wallet -= 120;
        life.hunger = Math.min(100, life.hunger + 60);
        life.mood = Math.min(100, life.mood + 10);
        message = "好好吃了一顿，饱腹 +60、心情 +10。";
      } else if (kind === "fun" && life.wallet >= 300) {
        life.wallet -= 300;
        life.mood = Math.min(100, life.mood + 20);
        message = "娱乐放松了一下，心情 +20。";
      } else {
        message = "个人钱包不够。";
      }
    }
    reply({ type: "snapshot", ...snapshot(), message });
  } else if (type === "requestRotationTalk") {
    if (state && state.myTeamId) {
      const weekIdx = Math.floor(state.day / 7);
      if (state.rotationTalks.week !== weekIdx) {
        state.rotationTalks = { week: weekIdx, used: 0 };
        state.rotationWaive = [];
      }
      let message: string;
      if (state.rotationTalks.used >= 2) {
        message = "本周沟通次数已用完（每周 2 次）。";
      } else {
        state.rotationTalks.used++;
        state.rotationWaive.push(msg.playerId as string);
        const p = state.players[msg.playerId as string];
        message = `已与 ${p?.ign ?? "选手"} 沟通轮换（本周 ${state.rotationTalks.used}/2 次），他不因轮换扣士气。`;
      }
      reply({ type: "snapshot", ...snapshot(), message });
      return;
    }
    reply({ type: "snapshot", state: null, records: {} });
  } else if (type === "getSnapshot") {
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
    if (!state) return reply({ type: "snapshot", state: null, records: {} });
    const st = state;
    {
      const id = msg.offerId as string;
      const idx = st.incomingBids.findIndex((b) => b.id === id);
      if (idx >= 0) {
        const bid = st.incomingBids[idx] as TransferOffer;
        const buyer = bid.fromTeam as string;
        // 过期守卫：选手已不在我方阵容（转会/解约）→ 报价作废
        const target = st.players[bid.playerId];
        if (!target || target.teamId !== st.myTeamId) {
          st.incomingBids.splice(idx, 1);
          st.news.push({ day: st.day, kind: "transfer", text: `⌛ ${target?.ign ?? "选手"} 已不在阵中，报价自动失效。` });
          return reply({ type: "snapshot", ...snapshot(), result: "报价已失效（选手不在阵中）。" });
        }
        if (msg.accept) {
          // 买方满员 → 先把其最低分的选手转为自由人腾位（无替补可腾时让首发让位）
          const buyerTeam = st.teams[buyer];
          if (buyerTeam && buyerTeam.roster.length >= 7) {
            const candidates = buyerTeam.roster
              .map((pid) => st.players[pid])
              .filter((p): p is NonNullable<typeof p> => !!p)
              .sort((a, b) => a.overall - b.overall);
            const victim = candidates[0];
            if (victim) {
              buyerTeam.roster = buyerTeam.roster.filter((pid) => pid !== victim.id);
              buyerTeam.starters = buyerTeam.starters.filter((pid) => pid !== victim.id);
              victim.teamId = null;
              victim.contractYears = 0;
              victim.benchedWeeks = 0;
            }
          }
          completeTransfer(st, { ...bid, toTeam: buyer }, new Rng(hashString(`${st.seed}:bid:${id}`)));
        } else {
          const p = st.players[bid.playerId];
          if (p) p.morale = Math.max(10, p.morale - 4);
          st.news.push({ day: st.day, kind: "transfer", text: `已拒绝 ${st.teams[buyer]?.name ?? "对方"} 对 ${p?.ign ?? "?"} 的报价（士气 -4）。` });
        }
        st.incomingBids.splice(idx, 1);
      }
    }
    reply({ type: "snapshot", ...snapshot() });
  } else if (type === "startNegotiation") {
    if (!state) return reply({ type: "negotiation", state: null });
    if (state.actionPoints < 1) {
      return reply({ type: "negotiation", error: "行动力不足：对外事务每天各花 1 点。", ...snapshot() });
    }
    // 转会窗强制（GDD §8.2）：窗内可谈；关窗宽限 3 天内只可完成在谈交易，不能再开新谈判
    if (!inTransferWindow(state.day)) {
      const grace = graceRemain(state);
      return reply({ type: "negotiation", error: grace ? "转会窗已关闭（宽限期内只能完成在谈交易）。" : "转会窗未开启。", ...snapshot() });
    }
    // 转会窗强制（GDD §8.2）：窗内可谈；关窗宽限 3 天内只可完成在谈交易，不能再开新谈判
    if (!inTransferWindow(state.day)) {
      const grace = graceRemain(state);
      return reply({ type: "negotiation", error: grace ? "转会窗已关闭（宽限期内只能完成在谈交易）。" : "转会窗未开启。", ...snapshot() });
    }
    if ((state.teams[state.myTeamId as string]?.roster.length ?? 7) >= 7) {
      return reply({ type: "negotiation", error: "名单已满（7/7），先放走一人再签。", ...snapshot() });
    }
    // 预算强制（GDD §8.4）：转会费 + 签字费 ≤ 预算
    const myTeam = state.teams[state.myTeamId as string]!;
    if (myTeam.budget < (msg.fee as number) + (msg.signingBonus as number)) {
      return reply({ type: "negotiation", error: "预算不足：转会费与签字费合计超出俱乐部资金。", ...snapshot() });
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
      // 名单上限与预算复检（谈判期间资金/名单可能已变化）
      const myTeam = state.myTeamId ? state.teams[state.myTeamId] : null;
      if (myTeam && myTeam.roster.length >= 7) {
        negSession = null;
        return reply({ type: "negotiationFinal", ...snapshot(), accepted: false, reason: "名单已满（7/7），签约取消。" });
      }
      if (myTeam && myTeam.budget < negSession.fee + negSession.signingBonus) {
        negSession = null;
        return reply({ type: "negotiationFinal", ...snapshot(), accepted: false, reason: "预算不足，签约取消。" });
      }
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
