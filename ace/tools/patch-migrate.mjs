/** worker migrate 插入 v0.7 地图迁移（按锚点行插入，避免行尾差异） */
import { readFileSync, writeFileSync } from "node:fs";

const path = "src/app/worker/sim.worker.ts";
let s = readFileSync(path, "utf8");
if (s.includes("legacyMap")) {
  console.log("already patched");
  process.exit(0);
}
const anchor = "  migrateLegacyComps(state);";
if (!s.includes(anchor)) throw new Error("anchor not found");
const nl = s.includes(anchor + "\r\n") ? "\r\n" : "\n";
const ins = [
  "  // v0.7 真实数据包：旧档的虚构地图 id 全部映射到真实图池（训练图/图池熟练/招牌计数/预案/mapLock/agentLock）",
  "  const validMap = new Set(MAPS.map((m) => m.id));",
  '  const legacyMap: Record<string, string> = { jingjie: "ascent", xiajing: "haven", panyan: "icebox", yugang: "bind", xueyuan: "split", kongting: "lotus", fenlu: "sunset" };',
  '  const remap = (id: string) => (validMap.has(id) ? id : legacyMap[id] ?? "ascent");',
  "  if (state.trainingMaps.some((m) => !validMap.has(m))) {",
  "    state.trainingMaps = [...new Set(state.trainingMaps.map(remap))].slice(0, 3);",
  "  }",
  "  for (const t of Object.values(state.teams)) {",
  "    for (const oldId of Object.keys(t.mapPref)) {",
  "      if (!validMap.has(oldId)) {",
  "        const n = remap(oldId);",
  "        t.mapPref[n] = Math.max(t.mapPref[n] ?? 50, t.mapPref[oldId] ?? 50);",
  "        delete t.mapPref[oldId];",
  "      }",
  "    }",
  "    for (const oldId of Object.keys(t.patternUsage)) {",
  "      if (!validMap.has(oldId)) {",
  "        t.patternUsage[remap(oldId)] = (t.patternUsage[remap(oldId)] ?? 0) + (t.patternUsage[oldId] ?? 0);",
  "        delete t.patternUsage[oldId];",
  "      }",
  "    }",
  "    for (const oldId of Object.keys(t.presets)) {",
  "      if (!validMap.has(oldId)) {",
  "        if (!t.presets[remap(oldId)]) t.presets[remap(oldId)] = t.presets[oldId]!;",
  "        delete t.presets[oldId];",
  "      }",
  "    }",
  "  }",
  "  for (const f of state.fixtures) {",
  "    if (f.mapLock?.some((m) => !validMap.has(m))) f.mapLock = f.mapLock.map(remap);",
  "    if (f.agentLock) {",
  "      for (const oldId of Object.keys(f.agentLock)) {",
  "        if (!validMap.has(oldId)) {",
  "          if (!f.agentLock[remap(oldId)]) f.agentLock[remap(oldId)] = f.agentLock[oldId]!;",
  "          delete f.agentLock[oldId];",
  "        }",
  "      }",
  "    }",
  "  }",
  "  // 旧档我的队若已不在（异常存档）：置空回到选队界面而不是崩溃",
  "  if (state.myTeamId && !state.teams[state.myTeamId]) state.myTeamId = null;",
].join(nl);
s = s.replace(anchor, anchor + nl + ins);
writeFileSync(path, s);
console.log("migrate patched");
