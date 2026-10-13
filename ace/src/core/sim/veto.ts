/**
 * BP（禁选）— GDD §5.5：
 * BO1 交替 6 ban；BO3 ban-ban-pick-pick-ban-ban；BO5 两 ban 四 pick；决胜图随机。
 * AI 决策：ban（对方熟练 − 我方熟练）最大差图（±6 噪声），pick 我方熟练最高（±6）。
 */
import { Rng } from "../rng.ts";
import { MAPS } from "../data/maps.ts";
import type { Team } from "../types.ts";

export interface VetoResult {
  /** 选定的比赛地图（BO3/BO5 为多张，按顺序） */
  maps: string[];
  log: string[];
}

const ACTIONS_BY_BO: Record<number, ("ban" | "pick")[]> = {
  1: ["ban", "ban", "ban", "ban", "ban", "ban"],
  3: ["ban", "ban", "pick", "pick", "ban", "ban"],
  5: ["ban", "ban", "pick", "pick", "pick", "pick"],
};

export function runVeto(teamA: Team, teamB: Team, bo: 1 | 3 | 5, rng: Rng): VetoResult {
  const pool = MAPS.map((m) => m.id);
  const log: string[] = [];
  const actions = ACTIONS_BY_BO[bo] ?? ACTIONS_BY_BO[3]!;
  const need = bo === 1 ? 1 : bo === 3 ? 3 : 5;
  const picked: string[] = [];

  const pref = (team: Team, mapId: string) => (team.mapPref[mapId] ?? 50) + rng.range(-6, 6);

  for (let i = 0; i < actions.length && pool.length > 1; i++) {
    const actor = i % 2 === 0 ? teamA : teamB;
    const opp = i % 2 === 0 ? teamB : teamA;
    const action = actions[i] as "ban" | "pick";
    if (action === "ban") {
      let worst = pool[0] as string;
      let worstScore = -Infinity;
      for (const m of pool) {
        const score = pref(opp, m) - pref(actor, m);
        if (score > worstScore) {
          worstScore = score;
          worst = m;
        }
      }
      log.push(`${actor.tag} ban ${mapName(worst)}`);
      remove(pool, worst);
    } else {
      let best = pool[0] as string;
      let bestScore = -Infinity;
      for (const m of pool) {
        const score = pref(actor, m);
        if (score > bestScore) {
          bestScore = score;
          best = m;
        }
      }
      picked.push(best);
      log.push(`${actor.tag} pick ${mapName(best)}`);
      remove(pool, best);
    }
  }

  // 决胜图：从剩余池随机
  while (picked.length < need && pool.length > 0) {
    const idx = rng.int(0, pool.length - 1);
    const m = pool.splice(idx, 1)[0] as string;
    picked.push(m);
    log.push(`决胜图 ${mapName(m)}`);
  }
  return { maps: picked.slice(0, need), log };
}

function remove(arr: string[], v: string): void {
  const i = arr.indexOf(v);
  if (i >= 0) arr.splice(i, 1);
}

function mapName(id: string): string {
  return MAPS.find((m) => m.id === id)?.name ?? id;
}
