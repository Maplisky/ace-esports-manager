/**
 * narrative 黄金轨迹记录器：七类叙事全路径（旧部重逢/弟子反戈/王朝里程碑/名宿告别/MVP 高光/小将首战/更衣室舆论）。
 * 零 RNG（hash 模板）；夹具手工捏造账本。运行：node tools/golden-narrative.mjs（ace/ 下）
 */
import { generateWorld } from '../src/core/worldgen.ts';
import {
  narrativeAfterMyLoss, narrativeOnMyLoss, narrativeOnTitle, narrativeOnRetire,
  narrativeOnMyMatch, captureDebuts,
} from '../src/core/sim/narrative.ts';
import { writeFileSync, mkdirSync } from 'node:fs';

const state = generateWorld(42);
const teams = Object.values(state.teams);
state.myTeamId = teams[0].id;
const myName = teams[0].name;

// 夹具①：胜方阵容塞旧部（career.clubs 含我队）+ 教练 = 我队退役名宿
const oldBoy = Object.values(state.players).find((p) => p.teamId !== teams[1].id);
oldBoy.career.clubs.push(teams[0].id);
oldBoy.career.titles = 2;
if (!teams[1].roster.includes(oldBoy.id)) teams[1].roster.push(oldBoy.id);
teams[1].coach.name = '捏造名宿教练';
state.retireLog ??= [];
state.retireLog.push({ year: 2024, ign: '捏造名宿', name: '捏造名宿教练', age: 45, titles: 1, mvps: 0, overall: 80, path: 'coach', teamName: myName });

const notes1 = [];
narrativeAfterMyLoss(state, { label: '联赛 第5轮', teamA: teams[0].id, teamB: teams[1].id }, { winner: 'B' }, notes1);
narrativeAfterMyLoss(state, { label: 'Masters 败者组决赛', teamA: teams[0].id, teamB: teams[1].id }, { winner: 'B' }, notes1);

// 夹具②：王朝里程碑（titles 2/3/5 三档 + 未触发档）
state.manager.career = { startYear: 2026, seasons: 2, titles: 2, wins: 40, losses: 20, loseStreak: 0, warned: false };
const notes2 = [];
narrativeOnTitle(state, notes2);
state.manager.career.titles = 4;
narrativeOnTitle(state, notes2);
state.manager.career.titles = 5;
narrativeOnTitle(state, notes2);

// 夹具③：名宿告别（32+ 岁 2+ 冠从我这退役 / 不满足条件的对照）
const notes3 = [];
narrativeOnRetire(state, { year: 2026, ign: '老将A', name: myName, age: 33, titles: 3, mvps: 2, overall: 82, path: 'fade', teamName: myName }, notes3);
narrativeOnRetire(state, { year: 2026, ign: '太年轻', name: myName, age: 25, titles: 0, mvps: 0, overall: 70, path: 'fade', teamName: myName }, notes3);

// 夹具④：MVP 高光 + 更衣室（构造一场我队 MatchRecord：MVP=我队、含败方情形）
const buildRec = (winner, mvpId, mapAcs) => ({
  id: 'M', seed: 1, format: 3, teamA: teams[0].id, teamB: teams[1].id, stage: 'stage1', day: state.day,
  maps: mapAcs.map((acs, i) => ({ map: `m${i}`, score: [13, 5], rounds: [], lines: { [mvpId]: { kills: 0, deaths: 0, assists: 0, firstKills: 0, firstDeaths: 0, clutches: 0, damage: 0, rounds: 13, acs } }, mvp: null, agents: {}, edges: { A: {}, B: {} } })),
  score: [winner === 'A' ? 2 : 1, winner === 'A' ? 1 : 2], winner, mvp: mvpId,
});
const myStarter = teams[0].starters[0];
const notes4 = [];
narrativeOnMyMatch(state, 'FX_win', buildRec('A', myStarter, [250, 310, 280]), notes4);

// 夹具⑤：小将首战（captureDebuts 捕获 + ≤19 岁过滤 + 最年轻选取）
const kids = teams[0].roster.slice(1, 3).map((pid) => state.players[pid]);
kids.forEach((k, i) => {
  k.career.maps = 0;
  k.age = i === 0 ? 18 : 19;
});
const debutPids = new Set(captureDebuts(state));
const notes5 = [];
narrativeOnMyMatch(state, 'FX_debut', buildRec('B', teams[0].starters[0], [200]), notes5, debutPids);

// 夹具⑥：更衣室尖锐版（败局 + 发言人士气 <40）
const voiceIdx = 2 % teams[0].starters.length;
state.players[teams[0].starters[voiceIdx]].morale = 30;
const notes6 = [];
narrativeOnMyMatch(state, 'FX_grim', buildRec('B', teams[1].starters[0], [180]), notes6);

const dump = (notes) => notes.map((n) => ({ day: n.day, kind: n.kind, important: n.important ?? null, text: n.text }));
const debutsDump = { debutPids: [...debutPids] };

const out = {
  meta: { generator: 'ace/tools/golden-narrative.mjs', authority: 'ace/src/core/sim/narrative.ts' },
  notes1: dump(notes1), notes2: dump(notes2), notes3: dump(notes3),
  notes4: dump(notes4), notes5: dump(notes5), notes6: dump(notes6),
  debutsDump,
};

mkdirSync('../kairo/Core.Tests/Golden', { recursive: true });
writeFileSync('../kairo/Core.Tests/Golden/narrative.golden.json', JSON.stringify(out));
console.log(`narrative golden written: ${notes1.length + notes2.length + notes3.length + notes4.length + notes5.length + notes6.length} notes`);
