/**
 * 数据包导出器（方案 §6 数据同源）：TS 仓库是唯一数据源，导出版本化 JSON 包供 C# 只读。
 * 运行：node tools/export-data-package.mjs（在 ace/ 下）
 * 输出：kairo/Core.Data/{agents,maps,real-teams,real-players,manifest}.json
 */
import { AGENTS } from '../src/core/data/agents.ts';
import { MAPS } from '../src/core/data/maps.ts';
import { REAL_TEAMS, REAL_PLAYERS_BY_VLR } from '../src/core/data/real/real-data.ts';
import { writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

const OUT = '../kairo/Core.Data';
mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/agents.json`, JSON.stringify(AGENTS));
writeFileSync(`${OUT}/maps.json`, JSON.stringify(MAPS));
writeFileSync(`${OUT}/real-teams.json`, JSON.stringify(REAL_TEAMS));
const REAL_PLAYERS = [...REAL_PLAYERS_BY_VLR.values()]; // Map 插入序 = 原数组序
writeFileSync(`${OUT}/real-players.json`, JSON.stringify(REAL_PLAYERS));

let sha = 'unknown';
try {
  sha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
} catch { /* 非 git 环境忽略 */ }

const manifest = {
  format: 1,
  source: 'ace/src/core/data（唯一权威数据源，勿手改 JSON）',
  coreCommit: sha,
  counts: { agents: AGENTS.length, maps: MAPS.length, teams: REAL_TEAMS.length, players: REAL_PLAYERS.length },
  note: '数组顺序即语义顺序（agents=职责分组序/teams=赛区插入序/players=vlr id 无序仅查表）',
};
writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 2));
console.log(`data package written: ${JSON.stringify(manifest.counts)} @ ${sha}`);
