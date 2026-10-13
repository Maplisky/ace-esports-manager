/** 模拟 Worker（GDD §11.1）：权威 state 常驻此处，主线程只拿快照渲染。 */
import { generateWorld, resetPlayerSeq } from "../../core/worldgen.ts";
import { initSeasonFixtures, advanceDay } from "../../core/sim/day.ts";
import type { GameState, MatchRecord, Preset } from "../../core/types.ts";

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
    const r = advanceDay(state, [], (rec, fixtureId, mine) => {
      if (mine) {
        records[fixtureId] = rec;
        playedMine.push(fixtureId);
      }
    });
    notes.push(...r.notes);
    seasonEnded = r.seasonEnded;
    if (playedMine.length > 0 && maxDays > 1) break; // 推进到下一场：打完我的比赛即停
  }
  reply({ type: "advanced", ...snapshot(), notes, playedMine, seasonEnded });
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
    state = saved.state;
    records = saved.records;
    reply({ type: "ready", ...snapshot() });
  } else if (type === "advance") {
    doAdvance(1);
  } else if (type === "advanceToNextMatch") {
    doAdvance(140);
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
  } else if (type === "getSnapshot") {
    reply({ type: "snapshot", ...snapshot() });
  }
};
