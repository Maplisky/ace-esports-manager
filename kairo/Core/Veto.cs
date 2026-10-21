using System;
using System.Collections.Generic;
using System.Linq;

namespace Kairo.Core;

/// <summary>
/// BP（禁选）— C# 移植自 ace/src/core/sim/veto.ts（权威实现）。
/// BO1 交替 6 ban；BO3 ban-ban-pick-pick-ban-ban；BO5 两 ban 四 pick；决胜图随机。
/// </summary>
public static class Veto
{
    public sealed class VetoResult
    {
        /// <summary>选定的比赛地图（BO3/BO5 为多张，按顺序）</summary>
        public List<string> Maps { get; set; } = new();
        public List<string> Log { get; set; } = new();
    }

    private static readonly Dictionary<int, string[]> ActionsByBo = new()
    {
        [1] = new[] { "ban", "ban", "ban", "ban", "ban", "ban" },
        [3] = new[] { "ban", "ban", "pick", "pick", "ban", "ban" },
        [5] = new[] { "ban", "ban", "pick", "pick", "pick", "pick" },
    };

    public static VetoResult RunVeto(Team teamA, Team teamB, int bo, Rng rng, double noise = 6)
    {
        var pool = CoreData.Maps.Select(m => m.Id).ToList();
        var log = new List<string>();
        var actions = ActionsByBo.TryGetValue(bo, out var a) ? a : ActionsByBo[3];
        int need = bo == 1 ? 1 : bo == 3 ? 3 : 5;
        var picked = new List<string>();

        // 噪声幅度：职业难度 AI 读图更准（±3）；调用次数不变 → 普通难度模拟逐位一致
        double Pref(Team team, string mapId) => (team.MapPref.TryGetValue(mapId, out var p) ? p : 50) + rng.Range(-noise, noise);

        // BP 先手掷硬币（v0.7：消除固定先手的顺序统计量胜率偏置）
        bool aFirst = rng.Chance(0.5);

        for (int i = 0; i < actions.Length && pool.Count > 1; i++)
        {
            bool actorIsA = (i % 2 == 0) == aFirst;
            var actor = actorIsA ? teamA : teamB;
            var opp = actorIsA ? teamB : teamA;
            string action = actions[i];
            if (action == "ban")
            {
                string worst = pool[0];
                double worstScore = double.NegativeInfinity;
                foreach (var m in pool)
                {
                    double score = Pref(opp, m) - Pref(actor, m);
                    if (score > worstScore)
                    {
                        worstScore = score;
                        worst = m;
                    }
                }
                log.Add($"{actor.Tag} ban {MapName(worst)}");
                Remove(pool, worst);
            }
            else
            {
                string best = pool[0];
                double bestScore = double.NegativeInfinity;
                foreach (var m in pool)
                {
                    double score = Pref(actor, m);
                    if (score > bestScore)
                    {
                        bestScore = score;
                        best = m;
                    }
                }
                picked.Add(best);
                log.Add($"{actor.Tag} pick {MapName(best)}");
                Remove(pool, best);
            }
        }

        // 决胜图：从剩余池随机
        while (picked.Count < need && pool.Count > 0)
        {
            int idx = rng.Int(0, pool.Count - 1);
            string m = pool[idx];
            pool.RemoveAt(idx);
            picked.Add(m);
            log.Add($"决胜图 {MapName(m)}");
        }
        return new VetoResult { Maps = picked.Take(need).ToList(), Log = log };
    }

    private static void Remove(List<string> arr, string v)
    {
        arr.Remove(v);
    }

    private static string MapName(string id) => CoreData.Maps.FirstOrDefault(m => m.Id == id)?.Name ?? id;
}
