/**
 * 回放分享（v1.0-12，GDD §9.4）：MatchRecord + 最小队伍/选手投影 → 压缩编码 → URL hash。
 * 匿名化开关（§14）：真实选手名/队名 → 确定性生成名，公开分享可控暴露面。
 * 链接只读既有 Record——不重模拟、不触碰 RNG（回放红线）。
 */
import { hashString } from "../rng.ts";
import type { GameState, MatchRecord } from "../types.ts";

export interface ReplayTeams {
  A: { tag: string; name: string; roster: string[] };
  B: { tag: string; name: string; roster: string[] };
}
export interface ReplayPayload {
  v: 1;
  rec: MatchRecord;
  teams: ReplayTeams;
  players: Record<string, { ign: string }>;
}

/** 从存档世界提取回放最小投影（播放器渲染所需：队徽信息 + 选手名） */
export function buildReplayPayload(state: GameState, rec: MatchRecord): ReplayPayload {
  const teams: ReplayTeams = { A: { tag: "?", name: "?", roster: [] }, B: { tag: "?", name: "?", roster: [] } };
  const players: Record<string, { ign: string }> = {};
  for (const side of ["A", "B"] as const) {
    const t = state.teams[side === "A" ? rec.teamA : rec.teamB];
    if (t) teams[side] = { tag: t.tag, name: t.name, roster: t.roster.slice() };
  }
  for (const m of rec.maps) {
    for (const pid of Object.keys(m.lines)) {
      if (!players[pid]) players[pid] = { ign: state.players[pid]?.ign ?? pid };
    }
  }
  return { v: 1, rec, teams, players };
}

const ANON_SUR = ["岚", "霜", "星", "烬", "潮", "曜", "弦", "岩", "雾", "澈", "凛", "翎"];
const ANON_GIVEN = ["Zero", "Vex", "Kite", "Onyx", "Rune", "Fable", "Echo", "Nova", "Pike", "Wren", "Jolt", "Saga"];
const ANON_TEAM = ["北辰", "白鲸", "赤霄", "苍梧", "晚枫", "断云", "孤峰", "远雷", "寒鸦", "平湖", "青崖", "细雨"];

/** 确定性匿名名：同 id 永远同名（多次导出可对照） */
function anonIgn(pid: string, i: number): string {
  const h = hashString(pid);
  return `${ANON_SUR[h % ANON_SUR.length]}${ANON_GIVEN[(h >>> 7) % ANON_GIVEN.length]}${i > 0 ? i : ""}`;
}

/** 匿名化载荷：选手名→生成名、队名→虚构、保留 id/结构（回放渲染不变） */
export function anonymizeReplay(p: ReplayPayload): ReplayPayload {
  const alias: Record<string, string> = {};
  const pids = Object.keys(p.players).sort();
  pids.forEach((pid, i) => {
    alias[pid] = anonIgn(pid, Math.floor(i / (ANON_SUR.length * ANON_GIVEN.length)));
  });
  const players: Record<string, { ign: string }> = {};
  for (const pid of pids) players[pid] = { ign: alias[pid]! };
  const teams: ReplayTeams = {
    A: { tag: ANON_TEAM[hashString(p.teams.A.name) % ANON_TEAM.length]!, name: "匿名战队 A", roster: p.teams.A.roster },
    B: { tag: ANON_TEAM[hashString(p.teams.B.name) % ANON_TEAM.length]!, name: "匿名战队 B", roster: p.teams.B.roster },
  };
  return { v: 1, rec: p.rec, teams, players };
}

function b64encode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64decode(text: string): Uint8Array {
  const norm = text.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(norm + "=".repeat((4 - (norm.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deflate(text: string): Promise<Uint8Array | null> {
  const CS = (globalThis as { CompressionStream?: typeof CompressionStream }).CompressionStream;
  if (!CS) return null;
  const stream = new Blob([text]).stream().pipeThrough(new CS("deflate") as never);
  const buf = await new Response(stream as unknown as BodyInit).arrayBuffer();
  return new Uint8Array(buf);
}
async function inflate(bytes: Uint8Array): Promise<string | null> {
  const DS = (globalThis as { DecompressionStream?: typeof DecompressionStream }).DecompressionStream;
  if (!DS) return null;
  const stream = new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(new DS("deflate") as never);
  return await new Response(stream as unknown as BodyInit).text();
}

/** 编码：优先 deflate+base64（前缀 1），环境不支持回退明文 base64（前缀 0） */
export async function encodeReplay(p: ReplayPayload): Promise<string> {
  const json = JSON.stringify(p);
  const deflated = await deflate(json);
  if (deflated) return "1" + b64encode(deflated);
  return "0" + b64encode(new TextEncoder().encode(json));
}

export async function decodeReplay(code: string): Promise<ReplayPayload | null> {
  try {
    if (!code || (code[0] !== "0" && code[0] !== "1")) return null;
    const bytes = b64decode(code.slice(1));
    const json = code[0] === "1" ? await inflate(bytes) : new TextDecoder().decode(bytes);
    if (!json) return null;
    const p = JSON.parse(json) as ReplayPayload;
    if (p?.v !== 1 || !p.rec || !Array.isArray(p.rec.maps) || !p.teams?.A || !p.teams?.B) return null;
    if (!p.players || typeof p.players !== "object" || Array.isArray(p.players)) return null;
    return p;
  } catch {
    return null;
  }
}

/** 完整分享 URL（hash 承载——浏览器对其长度宽容，避免 query 限制） */
export function replayUrl(code: string): string {
  return `${location.origin}${location.pathname}#replay=${code}`;
}

/** 载荷解码失败与普通坏输入的守门已含在 decodeReplay；此函数供 UI 拼接 */
export function shareLinkOf(p: ReplayPayload): Promise<string> {
  return encodeReplay(p).then((code) => replayUrl(code));
}
