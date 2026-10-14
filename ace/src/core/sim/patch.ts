/**
 * 版本系统（meta 二维化，GDD §4.3 v0.9 落地）：
 * - meta[agent]：版本系数（0.85-1.15），每赛段随机重掷（世界种子派生，同 seed 确定性）
 * - Patch 公告两层：全局定位（"黑梦削弱 −5%"）+ 地图级影响清单（该图 fit 高低决定平替是否成立）
 * - 平替推荐：fit[候选][图] × meta[候选] × 职责覆盖，按图给出
 * - strength.ts metaMod 消费：compFit = fit × meta 联合
 */
import type { AgentDef, GameState, PatchChange, PatchNote } from "../types.ts";
import { AGENT_BY_ID } from "../data/agents.ts";
import { AGENTS } from "../data/agents.ts";
import { MAPS } from "../data/maps.ts";
import { computeFit } from "./fit.ts";
import { Rng } from "../rng.ts";

/** 当前生效的 Patch（GameState.patchNotes 末条） */
export function currentPatch(state: GameState): PatchNote | null {
  return state.patchNotes?.[state.patchNotes.length - 1] ?? null;
}

/** 单英雄在本图的联合强度 = fit × meta（§4.3 二维相乘） */
export function agentPatchStrength(agentId: string, mapId: string, meta: number, computeFitFn: (agentId: string, mapId: string) => number): number {
  return meta * computeFitFn(agentId, mapId);
}

/** 发布新版本：每赛段调用一次（day = 赛段首日）。重掷 4-6 名英雄 meta，产出 Patch 公告。 */
export function rollPatch(state: GameState, segKey: string, rng: Rng): PatchNote {
  const prev = currentPatch(state);
  const prevMeta = new Map<string, number>((prev?.changes ?? []).map((c) => [c.agentId, c.meta]));
  const n = rng.int(4, 6);
  const pool = rng.shuffle(AGENTS.map((a) => a.id)).slice(0, n);
  const changes: PatchChange[] = [];
  const mapNotes: { mapId: string; text: string }[] = [];

  for (const id of pool) {
    // 变化幅度 ±5%~±12%；沿上次方向延续的概率更高（版本惯性）
    const pct = rng.range(5, 12) / 100;
    const was = prevMeta.get(id);
    const prevDir = was == null ? null : was > 1 ? "buff" : was < 1 ? "nerf" : null;
    const dir: "buff" | "nerf" = prevDir ?? (rng.chance(0.5) ? "buff" : "nerf");
    const meta = dir === "buff" ? 1 + pct : 1 - pct;
    changes.push({ agentId: id, meta, dir, pct: Math.round(pct * 100) });
  }

  // 地图级影响：挑 2 张图，找被改英雄中该图 fit 最高/最低者写地图结论
  for (const m of rng.shuffle(MAPS.map((x) => x.id)).slice(0, 2)) {
    const mapDef = MAPS.find((x) => x.id === m);
    if (!mapDef) continue;
    const best = changes
      .map((c) => ({ c, fit: fitOf2(c.agentId, m) }))
      .sort((a, b) => b.fit * b.c.meta - a.fit * a.c.meta)[0];
    if (best) {
      const name = AGENT_BY_ID.get(best.c.agentId)?.name ?? best.c.agentId;
      const mapName = mapDef.name;
      mapNotes.push({
        mapId: m,
        text: `在「${mapName}」其适配 ${best.fit.toFixed(2)}，${best.c.dir === "nerf" ? "控图价值仍高于平替——平替不成立" : "加强后优先级进一步上升"}`,
      });
    }
  }

  const note: PatchNote = {
    version: `${state.year}.${segKey}`,
    changes,
    mapNotes,
  };
  state.patchNotes = [...(state.patchNotes ?? []).slice(-7), note];
  return note;
}

/** 平替推荐（GDD §4.3）：A 被削弱时，按 fit×meta×职责覆盖在池内找顶替者（按图给出） */
export function recommendReplacement(state: GameState, cutAgentId: string, mapId: string, pool: string[]): { agentId: string; score: number } | null {
  const patch = currentPatch(state);
  const metaOf = (id: string) => patch?.changes.find((c) => c.agentId === id)?.meta ?? 1;
  const cutDef = AGENT_BY_ID.get(cutAgentId);
  if (!cutDef) return null;
  const mapDef = MAPS.find((m) => m.id === mapId);
  if (!mapDef) return null;
  let best: { agentId: string; score: number } | null = null;
  for (const id of pool) {
    if (id === cutAgentId) continue;
    const def = AGENT_BY_ID.get(id);
    if (!def) continue;
    // 职责覆盖：主职责相同 = 1，否则按职责向量夹角衰减；<0.3 的跨职责平替不成立（GDD §4.3）
    const overlap = dutyOverlap(cutDef, def);
    if (overlap < 0.3) continue;
    const fit = fitOf2(id, mapId);
    const score = fit * metaOf(id) * overlap;
    if (!best || score > best.score) best = { agentId: id, score };
  }
  return best;
}

/** 简易职责覆盖度：duty 向量点积归一 */
function dutyOverlap(a: AgentDef, b: AgentDef): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const k of ["duelist", "initiator", "controller", "sentinel"] as const) {
    dot += a.duty[k] * b.duty[k];
    na += a.duty[k] ** 2;
    nb += b.duty[k] ** 2;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}

/** fit 查询（委托 fit.ts 单一实现） */
function fitOf2(agentId: string, mapId: string): number {
  const m = MAPS.find((x) => x.id === mapId);
  return m ? computeFit(agentId, m) : 1;
}
