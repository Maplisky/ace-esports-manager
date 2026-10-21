using System;
using System.Linq;

namespace Kairo.Core;

/// <summary>
/// 情报系统（GDD §7.2 v0.5-3）— C# 移植自 ace/src/core/sim/intel.ts（权威实现）。
/// </summary>
public static class Intel
{
    private const int IntelPerScout = 2;
    public const int IntelCap = 10;
    private const double IntelWeeklyDecay = 0.5;

    public static double IntelOf(GameState state, string oppTeamId) =>
        state.Scouting.TryGetValue(oppTeamId, out var e)
            ? Math.Min(IntelCap, Math.Max(0, e.Points))
            : 0;

    /// <summary>侦察：+2 情报点（上限 10）。返回新情报等级。</summary>
    public static double AddIntel(GameState state, string oppTeamId, double amount = IntelPerScout)
    {
        var cur = state.Scouting.TryGetValue(oppTeamId, out var e) ? e : new ScoutEntry();
        double next = Math.Min(IntelCap, Math.Max(0, cur.Points + amount));
        state.Scouting[oppTeamId] = new ScoutEntry { Points = next, Last = state.Day };
        return next;
    }

    /// <summary>周衰减：长期不侦察，情报慢慢过时（weeklyTick 调用）。</summary>
    public static void DecayIntel(GameState state)
    {
        foreach (var kv in state.Scouting)
            kv.Value.Points = Math.Max(0, kv.Value.Points - IntelWeeklyDecay);
    }

    public static int IntelLevel(double points)
    {
        if (points >= 6) return 3;
        if (points >= 3) return 2;
        if (points >= 1) return 1;
        return 0;
    }

    /// <summary>对手单图预估强度 1-100（图池熟练 × 阵容 meta 适配）。</summary>
    public static int EstimateMapStrength(GameState state, Team team, MapDef map)
    {
        double pref = team.MapPref.TryGetValue(map.Id, out var p) ? p : 50;
        var lineup = team.Starters
            .Select(id => state.Players.TryGetValue(id, out var pl) ? pl : null)
            .Where(pl => pl != null)
            .Cast<Player>()
            .ToList();
        double fitSum = 0;
        int n = 0;
        foreach (var pl in lineup)
        {
            double bestFit = 1;
            foreach (var agentId in pl.AgentPool)
            {
                var a = CoreData.Agent(agentId);
                if (a == null) continue;
                double f = 1;
                bool Has(string t) => Array.IndexOf(a.MechTags, t) >= 0;
                if (Has("recon")) f += (map.Openness - 0.5) * 0.5;
                if (Has("smoke")) f += map.Sites == 3 ? 0.08 : 0.04;
                if (Has("anchor")) f += (0.5 - map.Corridor) * 0.4;
                if (Has("mobility")) f += (map.Openness - 0.5) * 0.3;
                bestFit = Math.Max(bestFit, Math.Min(1.3, Math.Max(0.7, f)));
            }
            fitSum += bestFit;
            n++;
        }
        double fitAvg = n > 0 ? fitSum / n : 1;
        return (int)DetMath.JsRound(Math.Min(100, Math.Max(1, pref * fitAvg)));
    }

    /// <summary>★ 级映射（★3 强图 / ★2 均势 / ★1 弱图）。</summary>
    public static int StarsOf(int score) => score >= 62 ? 3 : score >= 42 ? 2 : 1;

    /// <summary>未侦察散布区间：情报等级 0 时对手单图强度只能看区间估计——「眼光」技能缩误差。</summary>
    public static (int Lo, int Hi) MapStrengthBand(GameState state, Team team, MapDef map, double scoutingSkill)
    {
        int center = EstimateMapStrength(state, team, map);
        double width = Math.Min(40, Math.Max(16, 40 - (scoutingSkill - 50) * 0.4));
        double lo = Math.Min(100, Math.Max(1, center - width / 2));
        double hi = Math.Min(100, Math.Max(1, center + width / 2));
        return ((int)DetMath.JsRound(lo), (int)DetMath.JsRound(hi));
    }
}
