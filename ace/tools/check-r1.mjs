import { generateWorld } from "../src/core/worldgen.ts";
import { primaryDuty } from "../src/core/data/agents.ts";
import { AGENT_BY_ID } from "../src/core/data/agents.ts";
import { REAL_PLAYERS } from "../src/core/data/real/real-data.ts";

const s = generateWorld(2026);
// R1-a：首发职责分布
const dutyHist = {};
let noControllerTeams = 0;
for (const t of Object.values(s.teams)) {
  const starters = t.starters.map((id) => s.players[id]);
  const duties = starters.map((p) => { const a = AGENT_BY_ID.get(p.agentPool[0]); return a ? primaryDuty(a.duty) : "?"; });
  for (const d of duties) dutyHist[d] = (dutyHist[d] ?? 0) + 1;
  if (!duties.includes("controller")) noControllerTeams++;
}
console.log("首发职责分布:", JSON.stringify(dutyHist));
console.log("首发无控场队数:", noControllerTeams, "/64");
// R1-b：无统计选手 overall 分布
const statIds = new Set(REAL_PLAYERS.filter((p) => p.stats.length > 0).map((p) => p.vlrId));
const noStatPlayers = Object.values(s.players).filter((p) => p.id.startsWith("R") && !statIds.has(Number(p.id.slice(1))));
console.log("真实无统计选手:", noStatPlayers.length, "overall", noStatPlayers.length ? [Math.min(...noStatPlayers.map((p) => p.overall)), Math.max(...noStatPlayers.map((p) => p.overall))].join("-") : "-");
// R1-c：青训
const acad = Object.values(s.players).filter((p) => p.synthetic === "academy");
console.log("青训", acad.length, "人，年龄", [Math.min(...acad.map((p) => p.age)), Math.max(...acad.map((p) => p.age))].join("-"));
// R1-d：id 唯一
const ids = Object.keys(s.teams);
console.log("队 id 唯一:", new Set(ids).size === ids.length, { T: ids.filter((x) => x.startsWith("T")).length, C: ids.filter((x) => x.startsWith("C")).length });
// R1-e：agentPro 覆盖
let bad = 0;
for (const p of Object.values(s.players)) for (const a of p.agentPool) if (p.agentPro[a] === undefined) bad++;
console.log("agentPro 缺失:", bad);
// R1-f：相同 ign 重复
const igns = Object.values(s.players).map((p) => p.ign);
console.log("重复 ign:", igns.length - new Set(igns).size);
