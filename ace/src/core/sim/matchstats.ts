/**
 * 比赛数据面板（v0.9-5 对局美术打磨，GDD §5.4）：
 * 实时战绩（播放进度内已揭示事件聚合）与赛后总结（跨图 lines 汇总：KDA/ACS/FK/FD/残局）。
 * 只吃 MatchRecord——与模拟分离（§5.1）。
 */
import type { MapRecord } from "../types.ts";

/** 实时一行：击杀/死亡/首杀（助攻不进事件流，实时板只列 K/D/FK） */
export interface LiveLine {
  k: number;
  d: number;
  fk: number;
}

/** 播放进度 (mi, ri, ei) 内已揭示事件的实时战绩 */
export function liveLines(
  maps: MapRecord[],
  upTo: { mi: number; ri: number; ei: number },
): Record<string, LiveLine> {
  const out: Record<string, LiveLine> = {};
  const add = (pid: string, patch: Partial<LiveLine>) => {
    const cur = out[pid] ?? { k: 0, d: 0, fk: 0 };
    cur.k += patch.k ?? 0;
    cur.d += patch.d ?? 0;
    cur.fk += patch.fk ?? 0;
    out[pid] = cur;
  };
  for (let mi = 0; mi < maps.length && mi <= upTo.mi; mi++) {
    const m = maps[mi]!;
    const rounds = mi < upTo.mi ? m.rounds : m.rounds.slice(0, upTo.ri + 1);
    for (let ri = 0; ri < rounds.length; ri++) {
      const r = rounds[ri]!;
      const events = mi === upTo.mi && ri === upTo.ri ? r.events.slice(0, Math.max(0, upTo.ei + 1)) : r.events;
      for (const e of events) {
        if (e.t !== "kill" || !e.s || !e.v) continue;
        add(e.s, { k: 1 });
        add(e.v, { d: 1 });
        if (e.first) add(e.s, { fk: 1 });
      }
    }
  }
  return out;
}

export interface StatRow {
  pid: string;
  team: "A" | "B";
  k: number;
  d: number;
  a: number;
  fk: number;
  fd: number;
  clutches: number;
  rounds: number;
  /** 跨图 ACS：按图回合数加权平均 */
  acs: number;
}

/** 赛后总结：全部已打地图的 lines 汇总，按 ACS 降序。teamAPids 用于标注队属（lines 不带队属） */
export function summarizeMatch(maps: MapRecord[], teamAPids: Set<string>): StatRow[] {
  const agg = new Map<string, StatRow>();
  for (const m of maps) {
    for (const [pid, line] of Object.entries(m.lines ?? {})) {
      const cur = agg.get(pid) ?? {
        pid, team: (teamAPids.has(pid) ? "A" : "B") as "A" | "B", k: 0, d: 0, a: 0, fk: 0, fd: 0, clutches: 0, rounds: 0, acs: 0,
      };
      cur.k += line.kills;
      cur.d += line.deaths;
      cur.a += line.assists;
      cur.fk += line.firstKills;
      cur.fd += line.firstDeaths;
      cur.clutches += line.clutches;
      cur.rounds += line.rounds;
      cur.acs += line.acs * line.rounds;
      agg.set(pid, cur);
    }
  }
  const rows = [...agg.values()].map((r) => ({
    ...r,
    acs: r.rounds > 0 ? Math.round(r.acs / r.rounds) : 0,
  }));
  rows.sort((x, y) => y.acs - x.acs);
  return rows;
}

/** 结算 MVP 派生：总 MVP = 胜方最佳（引擎 record.mvp 同规则），SMVP = 败方最佳 */
export function pickMvps(rows: StatRow[], winnerTeam: "A" | "B"): { mvp: string | null; smvp: string | null } {
  const bestOf = (team: "A" | "B") =>
    rows
      .filter((r) => r.team === team)
      .sort((a, b) => b.acs - a.acs || b.k - a.k)[0]?.pid ?? null;
  return { mvp: bestOf(winnerTeam), smvp: bestOf(winnerTeam === "A" ? "B" : "A") };
}
