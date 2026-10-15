/** 模拟 Worker（GDD §11.1）：权威 state 常驻此处，主线程只拿快照渲染。 */
import { generateWorld, resetPlayerSeq, salaryFor, spawnFreeAgents, migrateMapsToRealPool } from "../../core/worldgen.ts";
import { initSeasonFixtures, advanceDay, playHeldMatch, interveneHeldMatch, settleMatch, migrateLegacyComps } from "../../core/sim/day.ts";
import { simMatch } from "../../core/sim/match.ts";
import { resolveEvent } from "../../core/sim/events.ts";
import { signCoach } from "../../core/sim/retirement.ts";
import { initCareer, applyJob, applyTalents, selfStudy, SELF_STUDY_COST, SELF_STUDY_CAP, type ManagerSkillKey } from "../../core/sim/career.ts";
import { draftPickTrade } from "../../core/sim/draft.ts";
import { evaluateAchievements } from "../../core/sim/achievements.ts";
import { UNLOCK_NOTES } from "../guide.ts";
import { startNegotiation, reNegotiate, finalizeOffer, completeTransfer, releasePlayer, inTransferWindow, graceRemain, askInquiry } from "../../core/sim/transfer.ts";
import { requestScrim } from "../../core/sim/scrim.ts";
import type { ScrimGoal } from "../../core/types.ts";
import type { StyleKey } from "../../core/sim/strength.ts";
import { signSponsorOffer, cancelSponsorById, acceptGig, declineGig, signStream, cancelStream } from "../../core/sim/business.ts";
import { Rng, hashString } from "../../core/rng.ts";
import { MAP_BY_ID } from "../../core/data/maps.ts";
import type { GameState, MatchIntervention, MatchRecord, Preset, TransferOffer } from "../../core/types.ts";

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

/** 训练周报（v1.4-2 密集档周一停车）：课表摘要 + 疲劳/士气均值 + 图池变化——纯派生零 RNG */
function trainingWeeklyReport(state: GameState): string[] {
  const t = state.myTeamId ? state.teams[state.myTeamId] : null;
  if (!t) return [];
  const roster = t.roster.map((id) => state.players[id]).filter((p): p is NonNullable<typeof p> => !!p);
  if (roster.length === 0) return [];
  const avg = (f: (p: typeof roster[number]) => number) => Math.round(roster.reduce((s, p) => s + f(p), 0) / roster.length);
  const slots = state.teamSchedule;
  const counts: Record<string, number> = {};
  for (const s of slots) counts[s] = (counts[s] ?? 0) + 1;
  const parts = Object.entries(counts).map(([k, v]) => `${{ map: "跑图", review: "复盘", scrim: "对抗", individual: "个人", rest: "休息" }[k] ?? k}×${v}`).join(" · ");
  const maps = state.trainingMaps.map((m) => MAP_BY_ID.get(m)?.name ?? m).join("/");
  return [
    `📋 训练周报（D${state.day}）：本周 ${parts}，跑图目标 ${maps}；全队疲劳均值 ${avg((p) => p.fatigue)}、士气均值 ${avg((p) => p.morale)}、羁绊 ${Math.round(t.bond)}。`,
  ];
}

function doAdvance(maxDays = 1): void {
  if (!state) return;
  if (state.manager.career?.ending) return; // 生涯终局（v1.0-6）：下课/退休后世界冻结
  settlePendingInteractive(); // v1.0-8 兜底：播放中断直接推进 → 交互式比赛先结算再走日历
  const notes: string[] = [];
  const playedMine: string[] = [];
  let seasonEnded = false;
  let weeklyReport: string[] | null = null;
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
    // 密集档周报停车（v1.4-2）：每周一停靠一次，附带训练周报
    if (state.stopDensity === "full" && state.day % 7 === 1) {
      weeklyReport = trainingWeeklyReport(state);
      break;
    }
  }
  // v1.0-10：日推进后评估成就（新解锁进新闻流；教学局不走 noteMatchResult，天然不计）
  const achNotes: { day: number; kind: string; text: string; important?: boolean }[] = [];
  evaluateAchievements(state, achNotes as never);
  pushNews(achNotes);
  notes.push(...achNotes.map((a) => a.text));
  // v1.0-11 系统解锁表（§9.1）：首赛季 D4/D8/D12/D20 解锁提示（第二赛季起不再打扰）
  if ((state.manager.career?.seasons ?? 1) <= 1) {
    for (const u of UNLOCK_NOTES) {
      if (state.day === u.day) notes.push(u.text);
    }
  }
  if (seasonEnded) {
    // 翻年回放滚动保留（v1.4-2：不再全清——跨赛季回放库可看；上限 30 场防快照克隆变慢）
    const keys = Object.keys(records);
    if (keys.length > 30) for (const k of keys.slice(0, keys.length - 30)) delete records[k];
  }
  // 轻量档（v1.4-2）：非关键提示（解锁/成就）不进推进 toast——仍入新闻流
  if (state.stopDensity === "light") {
    const critical = notes.filter((n) => /🏆|❌|下课|夺冠|加冕|教学局|预警/.test(n));
    notes.length = 0;
    notes.push(...critical);
  }
  if (weeklyReport) notes.push(...weeklyReport);
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

/** 新闻入池（含 400 条裁剪，与各处口径一致） */
function pushNews(notes: { day: number; kind: string; text: string; important?: boolean }[]): void {
  if (!state) return;
  for (const n of notes) {
    state.news.push({ day: n.day, kind: n.kind as never, text: n.text, important: n.important });
    while (state.news.length > 400) {
      const idx = state.news.findIndex((x) => !x.important);
      if (idx < 0) break;
      state.news.splice(idx, 1);
    }
  }
}

/** 交互式比赛兜底结算（v1.0-8）：played 未 settled 的我的比赛——推进/读档时先入账，防积分榜/对阵树卡死 */
function settlePendingInteractive(): void {
  if (!state) return;
  for (const f of state.fixtures) {
    if (!f.played || f.settled) continue;
    if (!records[f.id]) {
      records[f.id] = simMatch(state, f.teamA, f.teamB, f.bo, hashString(`${state.seed}:${f.id}`), f.id, f.mapLock, f.agentLock, f.interventions);
    }
    settleMatch(state, f.id, records[f.id] as MatchRecord, pushNews);
  }
}

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
  // v1.0-6 旧档补生涯账本：从当前赛季起算（不出身加成、不追溯历史战绩）
  state.manager.career ??= { startYear: state.year, seasons: 1, titles: 0, wins: 0, losses: 0, loseStreak: 0, warned: false, origin: "grassroots" };
  state.trainingMaps ??= ["ascent"];
  state.schedules ??= {};
  for (const p of Object.values(state.players)) {
    p.xp ??= {};
    p.focus ??= "rest";
    p.listed ??= false;
    p.releaseClause ??= 0;
    p.noPoach ??= false;
    p.listedWeeks ??= 0;
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
  state.styleCounter ??= {}; // 风格特训应对熟练度（GDD §5.6 v1.1）
  state.scrimLog ??= []; // 训练赛记录（GDD §5.6 v1.1）
  state.onboarding ??= {}; // 开局引导清单（GDD §3 v1.2；旧档不弹卡——只有新档 new 时置空对象并首季展示）
  state.agentTraining ??= {};
  state.inquiries ??= [];
  state.coachPool ??= [];
  state.retireLog ??= [];
  state.circuitPoints ??= {};
  state.draftPickMoves ??= []; // v1.0-8 选秀权交易账本
  state.achievements ??= {}; // v1.0-10 成就解锁账本
  // v1.0-8 交互式结算迁移：旧档 played 场次都是打完即结算（settled 字段缺省）→ 回填 true；
  // 交互式场次由 playHeldMatch 显式写 settled=false，读档兜底结算依赖此语义，不可回填
  for (const f of state.fixtures) {
    if (f.played && f.settled === undefined) f.settled = true;
  }
  // v0.6-1：旧单赛区 comp key → 霞赛区新命名（过渡年结算/Masters 依赖）
  migrateLegacyComps(state);
  // v0.7 真实数据包：旧档虚构地图 id 全量映射到真实图池（逻辑在 core，可测）
  migrateMapsToRealPool(state);
  // 旧档我的队若已不在（异常存档）：置空回到选队界面而不是崩溃
  if (state.myTeamId && !state.teams[state.myTeamId]) state.myTeamId = null;
  return state;
}

self.onmessage = (e: MessageEvent) => {
  try {
    handleWorkerMessage(e);
  } catch (err) {
    console.error("worker error:", err);
    self.postMessage({ type: "workerError", message: String((err as Error)?.stack ?? err), seq: (e.data as Record<string, unknown>)?.seq });
  }
};

function handleWorkerMessage(e: MessageEvent) {
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
    // 出身 3 选 1（v1.0-6，GDD §9.5）：声望/技能/资源差异
    const origin = msg.origin as "legend" | "grassroots" | "analyst" | undefined;
    // 天赋分配（v1.2，GDD §3）：先于出身应用——出身加成叠加在天赋初值上；零 RNG，世界逐位不变
    if (msg.talents) applyTalents(state, msg.talents as Partial<Record<ManagerSkillKey, number>>);
    initCareer(state, origin ?? "grassroots");
    state.onboarding = {}; // 开局引导清单（GDD §3 v1.2）
    // 难度三档（v1.0-7，GDD §9.5）：AI 侦察/BP 读图/预算补贴
    state.difficulty = (msg.difficulty as "normal" | "hard" | "pro" | undefined) ?? "normal";
    reply({ type: "ready", ...snapshot() });
  } else if (type === "applyJob") {
    // 跳槽申请（v1.0-6，GDD §9.5）：声望+荣誉+门下弟子加成，成功即切换俱乐部
    if (!state) return;
    const notes: { day: number; kind: string; text: string; important?: boolean }[] = [];
    const r = applyJob(state, msg.teamId as string, new Rng((state.seed ^ Math.imul(state.day, 0x1f2e3d)) >>> 0), notes as never);
    for (const n of notes) state.news.push({ day: n.day, kind: n.kind as never, text: n.text, important: n.important });
    while (state.news.length > 400) {
      const idx = state.news.findIndex((x) => !x.important);
      if (idx < 0) break;
      state.news.splice(idx, 1);
    }
    reply({ type: "snapshot", ...snapshot(), notes: [r.text] });
  } else if (type === "load") {
    const saved = msg.save as SavedPayload;
    state = migrate(saved.state);
    records = saved.records;
    // v1.0-8 兜底：播放中断刷新存档 → 交互式比赛先结算，再恢复赛前停车判定
    settlePendingInteractive();
    // 存档停在赛前准备（比赛日 = 当天、我的未打比赛）：恢复 held 让 PreMatch 立即重入。
    // 否则下一次推进 day++ 后该场落入"逾期清扫"被自动补打，玩家丢失赛前操作权。
    let held: typeof replyHeld = null;
    if (state.myTeamId) {
      const f = state.fixtures.find(
        (x) => !x.played && x.day === state!.day && x.teamA !== "" && x.teamB !== "" &&
          (x.teamA === state!.myTeamId || x.teamB === state!.myTeamId),
      );
      if (f) held = { fixtureId: f.id, teamA: f.teamA, teamB: f.teamB, bo: f.bo, label: f.label };
    }
    reply({ type: "ready", ...snapshot(), held });
  } else if (type === "advance") {
    doAdvance(1);
  } else if (type === "advanceToNextMatch") {
    doAdvance(320); // 跨越休赛期 + 季前 + 揭幕杯（最长约 160 天）
    // Deadline 强制停靠（GDD §18 #6 v0.9 完整化）：窗口关闭日停下来提醒处理挂牌/问价
    if (state && [24, 152, 366].includes(state.day)) {
      const wName = state.day === 24 ? "季前窗" : state.day === 152 ? "夏季窗口" : "休赛期窗";
      reply({
        type: "snapshot",
        ...snapshot(),
        notes: ["⏰ 转会窗关闭：" + wName + "已截止（宽限 3 天仅限完成在谈交易）。队内挂牌与问价意向请尽快处理。"],
      });
      return;
    }
  } else if (type === "setStarters") {
    if (state?.myTeamId) {
      const team = state.teams[state.myTeamId];
      if (team) team.starters = msg.starters as string[];
      state.onboarding ??= {};
      state.onboarding.lineup = true; // 开局引导（GDD §3 v1.2）
    }
    reply({ type: "snapshot", ...snapshot() });
  } else if (type === "setMentor") {
    // 替补三正路（v1.0）：接班人指派导师（须为本队首发且 ≥27 岁）
    if (state?.myTeamId) {
      const p = state.players[msg.playerId as string];
      const mentor = state.players[msg.mentorId as string];
      const team = state.teams[state.myTeamId];
      if (p && mentor && mentor.age >= 27 && team && team.starters.includes(mentor.id)) {
        p.track = "successor";
        p.mentorId = mentor.id;
      }
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
        state.onboarding ??= {};
        state.onboarding.agents = true; // 开局引导（GDD §3 v1.2）
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
      state.onboarding ??= {};
      state.onboarding.schedule = true; // 开局引导（GDD §3 v1.2）
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
  } else if (type === "matchIntervene") {
    // v1.0-8 情境化暂停/IGL 采纳：追加干预 → 同 seed 重模拟 → 播放器拿新 Record 无缝续播
    if (state) {
      const rec = interveneHeldMatch(state, msg.fixtureId as string, msg.iv as MatchIntervention, (rec2, fid) => {
        records[fid] = rec2;
      });
      reply({ type: "snapshot", ...snapshot(), record: rec ? structuredClone(rec) : null });
    } else {
      reply({ type: "snapshot", state: null, records: {}, record: null });
    }
  } else if (type === "matchFinish") {
    // v1.0-8 播放结束/关闭：结算交互式比赛（幂等；推进/读档另有兜底）。新闻已由 settleMatch 入池。
    if (state) {
      const texts: string[] = [];
      const achNotes: { day: number; kind: string; text: string; important?: boolean }[] = [];
      settleMatch(state, msg.fixtureId as string, records[msg.fixtureId as string] ?? null, (ns) => {
        for (const n of ns) texts.push(n.text);
      });
      evaluateAchievements(state, achNotes as never); // v1.0-10：结算即时评估（首胜/首冠当场点亮）
      pushNews(achNotes);
      for (const n of achNotes) texts.push(n.text);
      reply({ type: "snapshot", ...snapshot(), notes: texts });
    } else {
      reply({ type: "snapshot", state: null, records: {} });
    }
  } else if (type === "draftPickTrade") {
    // 选秀权交易（v1.0-8，GDD §13）：转会窗内卖出/买进下届选秀签
    if (state) {
      const notes: { day: number; kind: string; text: string; important?: boolean }[] = [];
      const message = draftPickTrade(state, msg.action as "sell" | "buy", notes as never);
      pushNews(notes);
      reply({ type: "snapshot", ...snapshot(), notes: notes.map((n) => n.text), message });
    } else {
      reply({ type: "snapshot", state: null, records: {} });
    }
  } else if (type === "signCoach") {
    if (state?.myTeamId) {
      const err = signCoach(state, msg.coachId as string, msg.slot as "training" | "mapTactics" | "match");
      reply({ type: "signed", error: err ?? null, ...snapshot() });
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
  } else if (type === "scrim") {
    // 训练赛约战（GDD §5.6 v1.1）：接受判定显式 Rng（同 seed 双跑一致），对局 seed 在 core 内派生
    if (state) {
      if (state.actionPoints < 1) {
        reply({ type: "snapshot", ...snapshot(), error: "行动力不足：约战花 1 点。" });
      } else {
        const notes: { day: number; kind: string; text: string; important?: boolean }[] = [];
        const oppId = msg.oppId as string;
        const rng = new Rng(hashString(`${state.seed}:scrimreq:${state.day}:${oppId}`));
        const res = requestScrim(state, {
          oppId, mapId: msg.mapId as string, goal: msg.goal as ScrimGoal, goalStyle: msg.goalStyle as StyleKey | undefined,
        }, rng, notes as never);
        pushNews(notes);
        reply({ type: "snapshot", ...snapshot(), scrim: res });
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
  } else if (type === "setStopDensity") {
    // 停靠密度三档（v1.4-2）：light 只停比赛 / normal 现状 / full 每周一训练周报停车
    if (state) state.stopDensity = (msg.density as "light" | "normal" | "full") ?? "normal";
    reply({ type: "snapshot", ...snapshot() });
  } else if (type === "selfStudy") {
    // 自我进修（GDD §9.5 v1.4）：个人钱包 $5K → 一项技能 +1（上限 75）
    const message = state ? selfStudy(state, msg.skill as ManagerSkillKey) : "无存档。";
    reply({ type: "snapshot", ...snapshot(), message });
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
  } else if (type === "promoteFromAcademy") {
    // 青训晋升（v0.9）：学员进入一线名单，名单 ≥7 时需指名换下一人
    if (state && state.myTeamId) {
      const team = state.teams[state.myTeamId];
      const pid = msg.pid as string;
      const outId = (msg.outId as string) ?? null;
      const p = state.players[pid];
      let message = "该学员不在青训营。";
      if (p && team && team.academy.includes(pid)) {
        if (team.roster.length >= 7 && !outId) {
          message = "名单已满（7/7），需选择换下一人。";
        } else if (outId && !team.roster.includes(outId)) {
          message = "换下对象不在一线名单。";
        } else {
          if (outId) {
            team.roster = team.roster.filter((id) => id !== outId);
            const outP = state.players[outId];
            if (outP) { outP.promisedRole = "bench"; outP.listedWeeks = 0; }
          }
          team.roster.push(pid);
          team.academy = team.academy.filter((id) => id !== pid);
          if (team.starters.length < 5) team.starters.push(pid);
          p.promisedRole = "rotation";
          message = `${p.ign} 从青训营晋升一线名单。`;
          state.transferFeed.push({ day: state.day, year: state.year, kind: "done", text: `${team.name} 青训晋升：${p.ign}（${p.overall}）进入一线名单。` });
        }
      }
      reply({ type: "snapshot", ...snapshot(), message });
    } else {
      reply({ type: "snapshot", ...snapshot() });
    }
  } else if (type === "upgradeFacility") {
    // 设施升级（v0.8，原作公式 60000 + f²×90）：俱乐部预算支出，训练收益乘数上限 95
    let message = "无俱乐部。";
    if (state && state.myTeamId) {
      const t = state.teams[state.myTeamId];
      if (t) {
        const f = t.facilities ?? 50;
        if (f >= 95) message = "训练设施已是顶级水平。";
        else {
          const cost = Math.round(60000 + f * f * 90);
          if (t.budget >= cost) {
            t.budget -= cost;
            t.facilities = f + 1;
            message = `训练设施升级完成（${f + 1} 级），花费 $${(cost / 1000).toFixed(0)}K。训练收益 +${(((f + 1) / 250 - (f / 250)) * 100).toFixed(1)}%。`;
            state.transferFeed.push({ day: state.day, year: state.year, kind: "done", text: `${t.name} 升级训练设施至 ${f + 1} 级（$${(cost / 1000).toFixed(0)}K）。` });
          } else message = `预算不足：升级需要 $${(cost / 1000).toFixed(0)}K（现有 $${(t.budget / 1000).toFixed(0)}K）。`;
        }
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
    // 纯快照请求（newGame/continueGame 第二步依赖；v0.8 检错：本分支曾被挂牌逻辑误占名导致消息永久挂起）
    reply({ type: "snapshot", ...snapshot() });
  } else if (type === "listPlayer") {
    if (state) {
      const p = state.players[msg.pid as string];
      const wantList = !!msg.listed;
      // 挂牌花 1 行动力（GDD §9.2）；撤牌免费。重复挂牌拒绝
      if (wantList && state.actionPoints < 1) {
        reply({ type: "snapshot", ...snapshot(), message: "行动力不足：挂牌需要 1 点。" });
        return;
      }
      if (wantList && p?.listed) {
        reply({ type: "snapshot", ...snapshot(), message: "该选手已在挂牌中。" });
        return;
      }
      if (p) {
        p.listed = wantList;
        if (wantList) {
          state.actionPoints--;
          p.listedWeeks = 0;
          // 按承诺角色的士气反应（GDD §8.2）：核心/首发不想被卖，轮换/替补视为机会
          const moraleHit = p.promisedRole === "core" ? -8 : p.promisedRole === "starter" ? -5 : 2;
          p.morale = Math.max(10, Math.min(100, p.morale + moraleHit));
          const team = p.teamId ? state.teams[p.teamId] : null;
          const value = Math.round(0.06 * Math.pow(1.21, p.overall) * (team?.tier === 1 ? 1 : 0.45) * 0.75 / 1000) * 1000;
          state.transferFeed.push({ day: state.day, year: state.year, kind: "list", text: `${team?.name ?? "?"} 挂牌 ${p.ign}（身价约 $${value}K）。` });
          if (state.transferFeed.length > 300) state.transferFeed.splice(0, state.transferFeed.length - 300);
        }
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
