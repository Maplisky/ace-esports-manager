/** Zustand store + Worker 桥：主线程渲染快照，模拟全在 Worker（GDD §11.1）。 */
import { create } from "zustand";
import type { GameState, MatchRecord, Preset, ScrimGoal, TransferOffer } from "../core/types.ts";
import {
  loadGame, saveGame, saveSlot, saveBackup, loadKey, deleteSave as deleteSaveKey,
  listSaves, migrateLegacyAutosave, exportJson, importJson,
  type SavedGame, type SaveEntry,
} from "./save.ts";
import type { PreMatchResult } from "./components/PreMatch.tsx";

type Screen = "start" | "main";
type Page = "overview" | "schedule" | "squad" | "tactics" | "training" | "finance" | "business" | "transfer" | "manager" | "achievements" | "career" | "library" | "replays" | "challenge" | "system";

export interface NegotiationState {
  offer: TransferOffer;
  demand: string;
  attitude: number;
  insulting: boolean;
  /** 谈判终局文本（成/败），非空时展示结果按钮 */
  result: string | null;
  accepted: boolean;
}

/** 待赛前准备的我的比赛（Worker 停车返回） */
export interface HeldMatch {
  fixtureId: string;
  teamA: string;
  teamB: string;
  bo: 1 | 3 | 5;
  label: string;
}

interface AppStore {
  ready: boolean;
  hasSave: boolean;
  screen: Screen;
  page: Page;
  state: GameState | null;
  records: Record<string, MatchRecord>;
  notes: string[];
  busy: boolean;
  viewerFixtureId: string | null;
  /** 打开回放时是否直接呈现终局面板（快进语义） */
  viewerStartFinished: boolean;
  toast: string | null;
  held: HeldMatch | null;
  /** 进行中的转会谈判（含实时态度） */
  negotiation: NegotiationState | null;
  /** 存档清单（v1.0-9 §11.4：自动/手动槽/每日备份） */
  saves: SaveEntry[];

  boot: () => Promise<void>;
  newGame: (seed: number, teamId: string, origin?: "legend" | "grassroots" | "analyst", difficulty?: "normal" | "hard" | "pro", talents?: Record<string, number>) => Promise<void>;
  continueGame: () => Promise<void>;
  advance: () => Promise<void>;
  advanceToNextMatch: () => Promise<void>;
  playHeld: (r: PreMatchResult) => Promise<void>;
  setScreen: (s: Screen) => void;
  setPage: (p: Page) => void;
  setStarters: (starters: string[]) => Promise<void>;
  setMentor: (playerId: string, mentorId: string) => Promise<void>;
  setPreset: (mapId: string, preset: Preset) => Promise<void>;
  applyPreset: (mapId: string, name: string) => Promise<void>;
  setTeamSchedule: (slots: string[], maps: string[], schedules?: Record<string, string>) => Promise<void>;
  setAgentTraining: (picks: Record<string, string>) => Promise<void>;
  appointCommander: (mainId: string, viceId: string | null) => Promise<void>;
  askInquiry: (playerId: string) => Promise<void>;
  openViewer: (fixtureId: string) => void;
  closeViewer: () => void;
  /** 比赛中喊话（v1.0-8）：玩家暂停菜单/IGL 采纳 → 重模拟 → 返回新 Record 无缝续播 */
  matchIntervene: (fixtureId: string, mapIdx: number, round: number, tactic: string, igl: boolean) => Promise<MatchRecord | null>;
  /** 比赛播放结束/关闭（v1.0-8）：结算交互式比赛（幂等） */
  matchFinish: (fixtureId: string) => Promise<void>;
  showToast: (t: string | null) => void;
  /** 转会：开谈（花 1 行动力）/ 再谈 / 终局检定 / 挂牌 / 解约 / 答复挖角 */
  startNegotiation: (playerId: string, terms: { fee: number; salary: number; years: number; signingBonus: number; promisedRole: "core" | "starter" | "rotation" | "bench" }) => Promise<void>;
  reNegotiate: (terms: { fee: number; salary: number; years: number; signingBonus: number; promisedRole: "core" | "starter" | "rotation" | "bench" }) => Promise<void>;
  finalizeNegotiation: () => Promise<void>;
  listToggle: (pid: string, listed: boolean) => Promise<void>;
  releasePlayer: (pid: string) => Promise<void>;
  respondBid: (offerId: string, accept: boolean) => Promise<void>;
  resolveEvent: (uid: string, optionIndex: number) => Promise<void>;
  scoutTeam: (teamId: string) => Promise<void>;
  scrim: (oppId: string, mapId: string, goal: ScrimGoal, goalStyle?: string) => Promise<void>;
  signSponsor: (offerId: string) => Promise<void>;
  cancelSponsor: (sponsorId: string) => Promise<void>;
  acceptGig: (gigId: string) => Promise<void>;
  declineGig: (gigId: string) => Promise<void>;
  signStream: (playerId: string) => Promise<void>;
  cancelStream: (playerId: string) => Promise<void>;
  requestRotationTalk: (playerId: string) => Promise<void>;
  managerLife: (kind: "meal" | "feast" | "fun") => Promise<void>;
  selfStudy: (skill: string) => Promise<void>;
  setStopDensity: (density: "light" | "normal" | "full") => Promise<void>;
  upgradeFacility: () => Promise<void>;
  signCoach: (coachId: string, slot: "training" | "mapTactics" | "match") => Promise<string | null>;
  /** 跳槽申请（v1.0-6，GDD §9.5）：休赛期教练市场 */
  applyJob: (teamId: string) => Promise<void>;
  /** 选秀权交易（v1.0-8，GDD §13）：转会窗内卖出/买进下届选秀签 */
  draftPickTrade: (action: "sell" | "buy") => Promise<void>;
  /** 存档管理（v1.0-9，GDD §11.4）：手动槽/读取任意档/删除/导出导入 */
  refreshSaves: () => Promise<void>;
  saveToSlot: (slot: string) => Promise<void>;
  loadFromKey: (key: string) => Promise<void>;
  removeSave: (key: string) => Promise<void>;
  exportSave: () => void;
  importSaveText: (text: string) => Promise<void>;
  promoteFromAcademy: (pid: string, outId: string | null) => Promise<void>;
}

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, (v: Record<string, unknown>) => void>();

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./worker/sim.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e: MessageEvent) => {
    const msg = e.data as Record<string, unknown> & { seq?: number };
    // worker 异常兜底：带 seq 回传错误 → 拒绝对应 promise（防 UI 永久 busy）
    if (msg.type === "workerError") {
      const resolve = typeof msg.seq === "number" ? pending.get(msg.seq) : undefined;
      if (resolve) {
        pending.delete(msg.seq as number);
        resolve({ __workerError: msg.message });
      }
      console.error("[worker]", msg.message);
      return;
    }
    if (typeof msg.seq === "number") {
      const resolve = pending.get(msg.seq);
      if (resolve) {
        pending.delete(msg.seq);
        resolve(msg);
      }
    }
  };
  worker.onerror = (e) => {
    // 供测试/诊断：worker 加载失败时在页面上可见
    (window as unknown as { __workerLoadError?: string }).__workerLoadError = e.message;
    console.error("[worker load]", e.message);
  };
  return worker;
}

function call<T = Record<string, unknown>>(msg: Record<string, unknown>): Promise<T> {
  const w = ensureWorker();
  const id = ++seq;
  return new Promise<T>((resolve) => {
    pending.set(id, (v) => resolve(v as T));
    w.postMessage({ ...msg, seq: id });
  });
}

let records: Record<string, MatchRecord> = {};

async function persist(state: GameState | null): Promise<void> {
  if (!state) return;
  try {
    await saveGame(state, records);
    await saveBackup(state, records); // 每日轮换备份（当天首份持久化时复制，留 3 份）——v1.0-9 §11.4
  } catch {
    /* 配额不足等场景：静默，v0.1 可接受 */
  }
}

export const useStore = create<AppStore>((set, get) => ({
  ready: false,
  hasSave: false,
  screen: "start",
  page: "overview",
  state: null,
  records: {},
  notes: [],
  busy: false,
  viewerFixtureId: null,
  viewerStartFinished: false,
  toast: null,
  held: null,
  negotiation: null,
  saves: [],

  boot: async () => {
    await migrateLegacyAutosave(); // v1.0-9：旧单键 'autosave' → 'auto'（写成功才删旧键）
    const entries = await listSaves();
    set({ hasSave: entries.length > 0, ready: true, saves: entries });
  },

  newGame: async (seed, teamId, origin, difficulty, talents) => {
    set({ busy: true });
    records = {};
    await call({ type: "new", seed, teamId, origin, difficulty, talents });
    const snap = await call<{ state: GameState; records: Record<string, MatchRecord> }>({ type: "getSnapshot" });
    records = snap.records;
    await persist(snap.state);
    set({ state: snap.state, records, screen: "main", page: "overview", busy: false, notes: ["职业生涯开始。"], held: null });
  },

  continueGame: async () => {
    // 自动档优先；自动档被清时回退到最近修改的手动槽/备份（v1.0-9：不丢可玩档）
    let saved: SavedGame | null = await loadGame();
    if (!saved) {
      const entries = await listSaves();
      const newest = entries.filter((e) => e.key !== "auto").sort((a, b) => b.savedAt.localeCompare(a.savedAt))[0];
      if (newest) saved = await loadKey(newest.key);
    }
    if (!saved) return;
    records = saved.records;
    const res = await call<{ held?: HeldMatch | null }>({ type: "load", save: { state: saved.state, records: saved.records } });
    const snap = await call<{ state: GameState; records: Record<string, MatchRecord> }>({ type: "getSnapshot" });
    set({ state: snap.state, records, screen: "main", page: "overview", held: res.held ?? null });
  },

  advance: async () => {
    if (get().busy) return;
    set({ busy: true });
    const res = await call<{ state: GameState; records: Record<string, MatchRecord>; notes: string[]; playedMine: string[]; held: HeldMatch | null }>({ type: "advance" });
    records = res.records;
    await persist(res.state);
    set({
      state: res.state, records, notes: res.notes, busy: false,
      held: res.held ?? null,
      viewerFixtureId: res.playedMine.length > 0 ? (res.playedMine[res.playedMine.length - 1] as string) : get().viewerFixtureId,
    });
  },

  advanceToNextMatch: async () => {
    if (get().busy) return;
    set({ busy: true });
    const res = await call<{ state: GameState; records: Record<string, MatchRecord>; notes: string[]; playedMine: string[]; held: HeldMatch | null }>({ type: "advanceToNextMatch" });
    records = res.records;
    await persist(res.state);
    set({
      state: res.state, records, notes: res.notes, busy: false,
      held: res.held ?? null,
      viewerFixtureId: res.playedMine.length > 0 ? (res.playedMine[res.playedMine.length - 1] as string) : get().viewerFixtureId,
    });
  },

  playHeld: async (r) => {
    const held = get().held;
    if (!held) return;
    set({ busy: true });
    const res = await call<{ state: GameState; records: Record<string, MatchRecord>; record: MatchRecord | null }>({
      type: "playHeldMatch",
      fixtureId: held.fixtureId,
      starters: r.starters,
      maps: r.manualMaps,
      agentPicks: r.agentPicks,
    });
    records = res.records;
    await persist(res.state);
    set({
      state: res.state, records, busy: false, held: null,
      notes: [...get().notes, "赛前准备完成"],
      viewerFixtureId: held.fixtureId,
      viewerStartFinished: r.fastForward, // 快进：直接呈现终局面板（比分/MVP/归因）
    });
  },

  setScreen: (screen) => set({ screen }),
  setPage: (page) => set({ page }),

  setStarters: async (starters) => {
    const res = await call<{ state: GameState; records: Record<string, MatchRecord> }>({ type: "setStarters", starters });
    records = res.records;
    set({ state: res.state, records });
  },

  setMentor: async (playerId, mentorId) => {
    const res = await call<{ state: GameState }>({ type: "setMentor", playerId, mentorId });
    set({ state: res.state });
  },

  setPreset: async (mapId, preset) => {
    const res = await call<{ state: GameState; records: Record<string, MatchRecord> }>({ type: "setPreset", mapId, preset });
    records = res.records;
    set({ state: res.state, records });
    get().showToast(`预案「${preset.name}」已保存`);
  },

  applyPreset: async (mapId, name) => {
    const res = await call<{ state: GameState; records: Record<string, MatchRecord> }>({ type: "applyPreset", mapId, name });
    records = res.records;
    set({ state: res.state, records });
    get().showToast(`已套用预案「${name}」`);
  },

  setTeamSchedule: async (slots, maps, schedules) => {
    const res = await call<{ state: GameState; records: Record<string, MatchRecord> }>({ type: "setTeamSchedule", slots, maps, schedules });
    records = res.records;
    set({ state: res.state, records });
    get().showToast("训练计划已安排（团队 + 个人并行，七天一轮）");
  },

  askInquiry: async (playerId) => {
    const res = await call<{ state: GameState; message?: string }>({ type: "askInquiry", playerId });
    set({ state: res.state });
    if (res.message) get().showToast(res.message);
  },

  appointCommander: async (mainId, viceId) => {
    const res = await call<{ state: GameState }>({ type: "setCommander", mainId, viceId });
    set({ state: res.state });
  },

  setAgentTraining: async (picks) => {
    const res = await call<{ state: GameState }>({ type: "setAgentTraining", picks });
    set({ state: res.state });
  },

  openViewer: (viewerFixtureId) => set({ viewerFixtureId, viewerStartFinished: false }),
  closeViewer: () => {
    // v1.0-8：关闭 ≠ 结算——中途关掉的交互式比赛保持「已模拟未结算」，
    // 可从赛程页 ▶ 回放 重开直播继续喊话；自然播完/快进才结算，推进与读档另有兜底
    set({ viewerFixtureId: null });
  },
  matchIntervene: async (fixtureId, mapIdx, round, tactic, igl) => {
    const res = await call<{ state: GameState; records: Record<string, MatchRecord>; record: MatchRecord | null }>({
      type: "matchIntervene",
      fixtureId,
      iv: { map: mapIdx, round, tactic, igl },
    });
    records = res.records;
    await persist(res.state);
    set({ state: res.state, records });
    return res.record;
  },
  matchFinish: async (fixtureId) => {
    const res = await call<{ state: GameState; records: Record<string, MatchRecord>; notes: string[] }>({ type: "matchFinish", fixtureId });
    records = res.records;
    await persist(res.state);
    set({ state: res.state, records, notes: res.notes.length > 0 ? [...get().notes, ...res.notes] : get().notes });
  },
  showToast: (t) => {
    set({ toast: t });
    if (t) window.setTimeout(() => set({ toast: null }), 2200);
  },

  startNegotiation: async (playerId, terms) => {
    const res = await call<{ state?: GameState; records?: Record<string, MatchRecord>; offer?: TransferOffer; demand?: string; attitude?: number; insulting?: boolean; error?: string }>({ type: "startNegotiation", playerId, ...terms });
    if (res.error || !res.offer || !res.state) {
      get().showToast(res.error ?? "无法开启谈判");
      return;
    }
    records = res.records ?? get().records;
    set({ state: res.state, records, negotiation: { offer: res.offer, demand: res.demand ?? "", attitude: res.attitude ?? 0, insulting: res.insulting ?? false, result: null, accepted: false } });
  },

  reNegotiate: async (terms) => {
    const res = await call<{ state?: GameState; offer?: TransferOffer; demand?: string; attitude?: number }>({ type: "reNegotiate", ...terms });
    if (res.offer && res.state) {
      set({ state: res.state, negotiation: { offer: res.offer, demand: res.demand ?? "", attitude: res.attitude ?? 0, insulting: false, result: null, accepted: false } });
    }
  },

  finalizeNegotiation: async () => {
    const res = await call<{ state: GameState; records: Record<string, MatchRecord>; accepted: boolean; reason: string }>({ type: "finalizeNegotiation" });
    records = res.records;
    await persist(res.state);
    set({ state: res.state, records, negotiation: { offer: null as unknown as TransferOffer, demand: "", attitude: 0, insulting: false, result: res.reason, accepted: res.accepted } });
  },

  listToggle: async (pid, listed) => {
    const res = await call<{ state: GameState; records: Record<string, MatchRecord> }>({ type: "listPlayer", pid, listed });
    records = res.records;
    set({ state: res.state, records });
  },

  releasePlayer: async (pid) => {
    const res = await call<{ state: GameState; records: Record<string, MatchRecord>; message?: string }>({ type: "releasePlayer", pid });
    records = res.records;
    set({ state: res.state, records });
    if (res.message) get().showToast(res.message);
  },

  respondBid: async (offerId, accept) => {
    const res = await call<{ state: GameState; records: Record<string, MatchRecord> }>({ type: "respondBid", offerId, accept });
    records = res.records;
    set({ state: res.state, records });
    get().showToast(accept ? "转会完成" : "已拒绝报价");
  },

  resolveEvent: async (uid, optionIndex) => {
    const res = await call<{ state: GameState; records: Record<string, MatchRecord>; result: string | null }>({ type: "resolveEvent", uid, optionIndex });
    records = res.records;
    set({ state: res.state, records });
    if (res.result) get().showToast(res.result.slice(0, 60));
  },

  scoutTeam: async (teamId) => {
    const res = await call<{ state?: GameState; records?: Record<string, MatchRecord>; intel?: number; error?: string }>({ type: "scoutTeam", teamId });
    if (res.error || !res.state) {
      get().showToast(res.error ?? "无法侦察");
      return;
    }
    records = res.records ?? get().records;
    set({ state: res.state, records });
    get().showToast(`侦察完成：情报等级 ${res.intel ?? 0}/10`);
  },

  scrim: async (oppId, mapId, goal, goalStyle) => {
    const res = await call<{ state?: GameState; records?: Record<string, MatchRecord>; scrim?: { accepted: boolean; reason: string; won: boolean; score: [number, number] }; error?: string }>({ type: "scrim", oppId, mapId, goal, goalStyle });
    if (res.error || !res.state) {
      get().showToast(res.error ?? "约战失败");
      return;
    }
    records = res.records ?? get().records;
    set({ state: res.state, records });
    const s = res.scrim;
    if (!s) return;
    if (!s.accepted) get().showToast(s.reason);
    else get().showToast(`训练赛${s.won ? "胜" : "负"} ${Math.max(s.score[0], s.score[1])}-${Math.min(s.score[0], s.score[1])}`);
  },

  requestRotationTalk: async (playerId) => {
    const res = await call<{ state?: GameState; records?: Record<string, MatchRecord>; message?: string }>({ type: "requestRotationTalk", playerId });
    if (res.state) {
      records = res.records ?? get().records;
      set({ state: res.state, records });
      if (res.message) get().showToast(res.message);
    }
  },

  signSponsor: async (offerId) => {
    const res = await call<{ state?: GameState; records?: Record<string, MatchRecord>; message?: string }>({ type: "signSponsor", offerId });
    if (res.state) {
      records = res.records ?? get().records;
      set({ state: res.state, records });
      get().showToast(res.message ?? "已签约");
    }
  },
  cancelSponsor: async (sponsorId) => {
    const res = await call<{ state?: GameState; records?: Record<string, MatchRecord> }>({ type: "cancelSponsor", sponsorId });
    if (res.state) set({ state: res.state, records: res.records ?? get().records });
  },
  acceptGig: async (gigId) => {
    const res = await call<{ state?: GameState; records?: Record<string, MatchRecord>; message?: string }>({ type: "acceptGig", gigId });
    if (res.state) {
      records = res.records ?? get().records;
      set({ state: res.state, records });
      if (res.message) get().showToast(res.message);
    }
  },
  declineGig: async (gigId) => {
    const res = await call<{ state?: GameState; records?: Record<string, MatchRecord> }>({ type: "declineGig", gigId });
    if (res.state) set({ state: res.state, records: res.records ?? get().records });
  },
  signStream: async (playerId) => {
    const res = await call<{ state?: GameState; records?: Record<string, MatchRecord>; message?: string }>({ type: "signStream", playerId });
    if (res.state) {
      records = res.records ?? get().records;
      set({ state: res.state, records });
      if (res.message) get().showToast(res.message);
    }
  },
  cancelStream: async (playerId) => {
    const res = await call<{ state?: GameState; records?: Record<string, MatchRecord> }>({ type: "cancelStream", playerId });
    if (res.state) set({ state: res.state, records: res.records ?? get().records });
  },

  promoteFromAcademy: async (pid, outId) => {
    const res = await call<{ state: GameState; message?: string }>({ type: "promoteFromAcademy", pid, outId });
    set({ state: res.state });
    if (res.message) get().showToast(res.message);
  },

  signCoach: async (coachId, slot) => {
    const res = await call<{ state: GameState; error?: string }>({ type: "signCoach", coachId, slot });
    set({ state: res.state });
    return res.error ?? null;
  },

  applyJob: async (teamId) => {
    set({ busy: true });
    const res = await call<{ state: GameState; records: Record<string, MatchRecord>; notes: string[] }>({ type: "applyJob", teamId });
    records = res.records;
    await persist(res.state);
    set({ state: res.state, records, notes: res.notes, busy: false });
  },

  draftPickTrade: async (action) => {
    const res = await call<{ state: GameState; records: Record<string, MatchRecord>; notes: string[]; message: string }>({ type: "draftPickTrade", action });
    records = res.records;
    await persist(res.state);
    set({ state: res.state, records, notes: res.notes.length > 0 ? [...get().notes, ...res.notes] : get().notes });
    get().showToast(res.message);
  },

  refreshSaves: async () => {
    set({ saves: await listSaves() });
  },

  saveToSlot: async (slot) => {
    const st = get().state;
    if (!st) return;
    await saveSlot(st, records, slot);
    await get().refreshSaves();
    get().showToast(`已保存到手动档（${slot.replace("slot", "槽 ")}）`);
  },

  loadFromKey: async (key) => {
    const saved = await loadKey(key);
    if (!saved) {
      get().showToast("该存档已不存在。");
      return;
    }
    records = saved.records;
    const res = await call<{ held?: HeldMatch | null }>({ type: "load", save: { state: saved.state, records: saved.records } });
    const snap = await call<{ state: GameState; records: Record<string, MatchRecord> }>({ type: "getSnapshot" });
    set({ state: snap.state, records, screen: "main", page: "overview", held: res.held ?? null, viewerFixtureId: null, viewerStartFinished: false, toast: null, negotiation: null });
    get().showToast(`已读取存档（${saved.meta?.label ?? key}）`);
  },

  removeSave: async (key) => {
    await deleteSaveKey(key);
    await get().refreshSaves();
  },

  exportSave: () => {
    const st = get().state;
    if (!st) return;
    const text = exportJson(st, records);
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const m = st.teams[st.myTeamId ?? ""];
    a.download = `ACE-save-${m?.tag ?? "coach"}-Y${st.year}D${st.day}.json`;
    a.click();
    URL.revokeObjectURL(url);
    get().showToast("存档已导出为 JSON 文件");
  },

  importSaveText: async (text) => {
    const payload = importJson(text);
    if (!payload) {
      get().showToast("导入失败：不是有效的 ACE 存档文件。");
      return;
    }
    records = payload.records ?? {};
    await saveGame(payload.state, records); // 导入即落自动档（原自动档被覆盖——导出文件在手，可随时找回）
    const res = await call<{ held?: HeldMatch | null }>({ type: "load", save: { state: payload.state, records } });
    const snap = await call<{ state: GameState; records: Record<string, MatchRecord> }>({ type: "getSnapshot" });
    set({ state: snap.state, records, screen: "main", page: "overview", held: res.held ?? null, viewerFixtureId: null, viewerStartFinished: false, negotiation: null });
    await get().refreshSaves();
    get().showToast("存档已导入并写入自动档");
  },

  upgradeFacility: async () => {
    const res = await call<{ state: GameState; message?: string }>({ type: "upgradeFacility" });
    set({ state: res.state });
    if (res.message) get().showToast(res.message);
  },

  managerLife: async (kind) => {
    const res = await call<{ state?: GameState; records?: Record<string, MatchRecord>; message?: string }>({ type: "managerLife", kind });
    if (res.state) {
      records = res.records ?? get().records;
      set({ state: res.state, records });
      if (res.message) get().showToast(res.message);
    }
  },

  selfStudy: async (skill) => {
    const res = await call<{ state?: GameState; records?: Record<string, MatchRecord>; message?: string }>({ type: "selfStudy", skill });
    if (res.state) {
      records = res.records ?? get().records;
      set({ state: res.state, records });
      if (res.message) get().showToast(res.message);
    }
  },

  setStopDensity: async (density) => {
    const res = await call<{ state?: GameState; records?: Record<string, MatchRecord> }>({ type: "setStopDensity", density });
    if (res.state) {
      records = res.records ?? get().records;
      set({ state: res.state, records });
    }
  },
}));
