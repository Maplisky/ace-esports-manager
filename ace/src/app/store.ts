/** Zustand store + Worker 桥：主线程渲染快照，模拟全在 Worker（GDD §11.1）。 */
import { create } from "zustand";
import type { GameState, MatchRecord, Preset, TransferOffer } from "../core/types.ts";
import { loadGame, saveGame, type SavedGame } from "./save.ts";
import type { PreMatchResult } from "./components/PreMatch.tsx";

type Screen = "start" | "main";
type Page = "overview" | "schedule" | "squad" | "tactics" | "training" | "transfer";

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

  boot: () => Promise<void>;
  newGame: (seed: number, teamId: string) => Promise<void>;
  continueGame: () => Promise<void>;
  advance: () => Promise<void>;
  advanceToNextMatch: () => Promise<void>;
  playHeld: (r: PreMatchResult) => Promise<void>;
  setScreen: (s: Screen) => void;
  setPage: (p: Page) => void;
  setStarters: (starters: string[]) => Promise<void>;
  setPreset: (mapId: string, preset: Preset) => Promise<void>;
  applyPreset: (mapId: string, name: string) => Promise<void>;
  setTeamSchedule: (slots: string[], maps: string[], schedules?: Record<string, string>) => Promise<void>;
  openViewer: (fixtureId: string) => void;
  closeViewer: () => void;
  showToast: (t: string | null) => void;
  /** 转会：开谈（花 1 行动力）/ 再谈 / 终局检定 / 挂牌 / 解约 / 答复挖角 */
  startNegotiation: (playerId: string, terms: { fee: number; salary: number; years: number; signingBonus: number; promisedRole: "core" | "starter" | "rotation" | "bench" }) => Promise<void>;
  reNegotiate: (terms: { fee: number; salary: number; years: number; signingBonus: number; promisedRole: "core" | "starter" | "rotation" | "bench" }) => Promise<void>;
  finalizeNegotiation: () => Promise<void>;
  listToggle: (pid: string, listed: boolean) => Promise<void>;
  releasePlayer: (pid: string) => Promise<void>;
  respondBid: (offerId: string, accept: boolean) => Promise<void>;
}

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, (v: Record<string, unknown>) => void>();

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./worker/sim.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e: MessageEvent) => {
    const msg = e.data as Record<string, unknown> & { seq?: number };
    if (typeof msg.seq === "number") {
      const resolve = pending.get(msg.seq);
      if (resolve) {
        pending.delete(msg.seq);
        resolve(msg);
      }
    }
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

  boot: async () => {
    const saved: SavedGame | null = await loadGame();
    set({ hasSave: saved !== null, ready: true });
  },

  newGame: async (seed, teamId) => {
    set({ busy: true });
    records = {};
    await call({ type: "new", seed, teamId });
    const snap = await call<{ state: GameState; records: Record<string, MatchRecord> }>({ type: "getSnapshot" });
    records = snap.records;
    await persist(snap.state);
    set({ state: snap.state, records, screen: "main", page: "overview", busy: false, notes: ["职业生涯开始。"], held: null });
  },

  continueGame: async () => {
    const saved = await loadGame();
    if (!saved) return;
    records = saved.records;
    await call({ type: "load", save: { state: saved.state, records: saved.records } });
    const snap = await call<{ state: GameState; records: Record<string, MatchRecord> }>({ type: "getSnapshot" });
    set({ state: snap.state, records, screen: "main", page: "overview", held: null });
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

  openViewer: (viewerFixtureId) => set({ viewerFixtureId, viewerStartFinished: false }),
  closeViewer: () => set({ viewerFixtureId: null }),
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
}));
