/** 把爬虫 JSON 产出转成 TS 数据模块（Node/Vite 双端 import 稳定，无 JSON import attribute 差异） */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const teams = JSON.parse(await readFile(path.join(ROOT, "src/core/data/real/vlr-teams.json"), "utf8"));
const players = JSON.parse(await readFile(path.join(ROOT, "src/core/data/real/vlr-players.json"), "utf8"));

// 类型内联（与 types.ts 的 Team/Player 派生字段解耦：worldgen 负责映射）
const ts = `// 自动生成（tools/crawl-vlr.mjs + tools/gen-real-ts.mjs）——数据源 vlr.gg，勿手改
// VlrTeam/VlrPlayer 为爬虫快照；worldgen 负责映射为引擎内 Team/Player。
export interface VlrTeamStat {
  vlrId: number; slug: string; name: string; tag: string; region: "americas" | "emea" | "pacific" | "china";
  country: string; rank: number; rating: number; logo: string | null; partnered: boolean;
  coach: { alias: string; real: string; country: string; avatar: string } | null;
  staff: { alias: string; role: string; avatar: string }[];
  roster: number[];
}
export interface VlrAgentStat {
  agent: string; maps: number; rounds: number; rating: number; acs: number; kd: number;
  kast: number; adr: number; kpr: number; apr: number; fk: number; fd: number;
}
export interface VlrPlayerStat {
  vlrId: number; teamVlrId: number; alias: string; real: string; country: string;
  avatar: string | null; captain: boolean; stats: VlrAgentStat[];
}
export const REAL_TEAMS: readonly VlrTeamStat[] = ${JSON.stringify(teams)};
const REAL_PLAYERS: readonly VlrPlayerStat[] = ${JSON.stringify(players)};
export const REAL_PLAYERS_BY_VLR: ReadonlyMap<number, VlrPlayerStat> = new Map(REAL_PLAYERS.map((p) => [p.vlrId, p]));
`;
await writeFile(path.join(ROOT, "src/core/data/real/real-data.ts"), ts);
console.log(`real-data.ts: ${teams.length} 队 / ${players.length} 选手，${(ts.length / 1024 / 1024).toFixed(2)} MB`);
