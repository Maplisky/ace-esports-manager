/** Zustand store + Worker 桥：主线程渲染快照，模拟全在 Worker（GDD §11.1）。 */
import { create } from "zustand";
import type { GameState, MatchRecord, Preset } from "../core/types.ts";
import { loadGame, saveGame, type SavedGame } from "./save.ts";

type Screen = "start" | "main";
type Page = "overview" | "schedule" | "squad" | "tactics" | "training";

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
  toast: string | null;

  boot: () => Promise<void>;
  newGame: (seed: number, teamId: string) => Promise<void>;
  continueGame: () => Promise<void>;
  advance: () => Promise<void>;
  advanceToNextMatch: () => Promise<void>;
  setScreen: (s: Screen) => void;
  setPage: (p: Page) => void;
  setStarters: (starters: string[]) => Promise<void>;
  setPreset: (mapId: string, preset: Preset) => Promise<void>;
  applyPreset: (mapId: string, name: string) => Promise<void>;
  setTeamSchedule: (slots: string[], maps: string[], schedules?: Record<string, string>) => Promise<void>;
  openViewer: (fixtureId: string) => void;
  closeViewer: () => void;
  showToast: (t: string | null) => void;
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
  toast: null,

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
    set({ state: snap.state, records, screen: "main", page: "overview", busy: false, notes: ["职业生涯开始。"] });
  },

  continueGame: async () => {
    const saved = await loadGame();
    if (!saved) return;
    records = saved.records;
    await call({ type: "load", save: { state: saved.state, records: saved.records } });
    const snap = await call<{ state: GameState; records: Record<string, MatchRecord> }>({ type: "getSnapshot" });
    set({ state: snap.state, records, screen: "main", page: "overview" });
  },

  advance: async () => {
    if (get().busy) return;
    set({ busy: true });
    const res = await call<{ state: GameState; records: Record<string, MatchRecord>; notes: string[]; playedMine: string[] }>({ type: "advance" });
    records = res.records;
    await persist(res.state);
    set({ state: res.state, records, notes: res.notes, busy: false });
    if (res.playedMine.length > 0) set({ viewerFixtureId: res.playedMine[res.playedMine.length - 1] as string });
  },

  advanceToNextMatch: async () => {
    if (get().busy) return;
    set({ busy: true });
    const res = await call<{ state: GameState; records: Record<string, MatchRecord>; notes: string[]; playedMine: string[] }>({ type: "advanceToNextMatch" });
    records = res.records;
    await persist(res.state);
    set({ state: res.state, records, notes: res.notes, busy: false });
    if (res.playedMine.length > 0) set({ viewerFixtureId: res.playedMine[res.playedMine.length - 1] as string });
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

  openViewer: (viewerFixtureId) => set({ viewerFixtureId }),
  closeViewer: () => set({ viewerFixtureId: null }),
  showToast: (t) => {
    set({ toast: t });
    if (t) window.setTimeout(() => set({ toast: null }), 2200);
  },
}));
