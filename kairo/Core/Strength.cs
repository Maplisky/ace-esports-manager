using System;
using System.Collections.Generic;
using System.Linq;

namespace Kairo.Core;

/// <summary>
/// 团队强度计算（GDD §5.2）— C# 移植自 ace/src/core/sim/strength.ts（权威实现）。
/// base = Σ(首发有效能力 × [1.22,1.10,1.00,0.90,0.78]) / Σ权重；
/// ROUND_BASE_SCALE（K）为调参常数；验收基准：87 分队对 72 分队 BO3 胜率 68-78%（§12 T1）。
/// </summary>
public static class Strength
{
    private static readonly double[] LineupWeights = { 1.22, 1.10, 1.00, 0.90, 0.78 };
    public const double RoundBaseScale = 0.28;
    private const double DefBonus = 1.5;
    public const double LogisticK = 30;
    public const double SwingSd = 6;

    /// <summary>角色系数表（GDD §5.2），按职责向量插值。</summary>
    private static readonly DutyVector KillW = new() { Duelist = 1.08, Initiator = 0.98, Controller = 0.93, Sentinel = 0.96 };
    private static readonly DutyVector EntryW = new() { Duelist = 2.0, Initiator = 1.3, Controller = 0.5, Sentinel = 0.6 };
    private static readonly (string Key, string Flex)[] FlexMerge =
    {
        ("duelist", "sentinel"), ("initiator", "controller"), ("controller", "initiator"), ("sentinel", "duelist"),
    };

    private static double DutyGet(DutyVector d, string k) => k switch
    {
        "duelist" => d.Duelist, "initiator" => d.Initiator, "controller" => d.Controller, "sentinel" => d.Sentinel,
        _ => throw new ArgumentException(k),
    };

    private static double Interpolate(DutyVector weights, DutyVector duty)
    {
        double v = 0;
        foreach (var (k, flex) in FlexMerge)
        {
            double main = DutyGet(duty, k);
            v += main * DutyGet(weights, k) + DutyGet(duty, flex) * 0.3 * DutyGet(weights, flex);
        }
        return v;
    }

    public static double DutyKillWeight(DutyVector duty) => Interpolate(KillW, duty);
    public static double DutyEntryWeight(DutyVector duty) => Interpolate(EntryW, duty);

    /// <summary>有效能力（GDD §5.2）：状态三角 + 带伤。</summary>
    public static double EffectiveOverall(Player p, int day)
    {
        double formMod = (p.Form - 70) * 0.003;
        double moraleMod = (p.Morale - 70) * 0.002;
        double fatigueMod = -p.Fatigue * 0.0015;
        double injuryMod = p.InjuredUntilDay > day ? -0.2 : 0;
        return p.Overall * (1 + formMod + moraleMod + fatigueMod + injuryMod);
    }

    /// <summary>五风格：rush/aggro/balanced/methodical/lockdown（环形克制）。</summary>
    public static string StyleBeats(string style) => style switch
    {
        "rush" => "balanced", "balanced" => "aggro", "aggro" => "methodical",
        "methodical" => "lockdown", "lockdown" => "rush", _ => throw new ArgumentException(style),
    };

    /// <summary>首发阵容进攻性 0-1（决斗+先锋职责占比均值；缺人按现有均值）。</summary>
    public static double AggrOfLineup(IReadOnlyList<Player> lineup)
    {
        if (lineup.Count == 0) return 0.5;
        double aggr = 0;
        foreach (var p in lineup)
        {
            var dv = DutyVectorOf(p);
            aggr += dv.Duelist + dv.Initiator;
        }
        return aggr / lineup.Count;
    }

    public static string StyleOf(double aggr) =>
        aggr >= 0.6 ? "rush" : aggr >= 0.55 ? "aggro" : aggr > 0.45 ? "balanced" : aggr > 0.4 ? "methodical" : "lockdown";

    /// <summary>风格相性值：克制 +1.8 / 被克 -1.0 / 中性 0（不对称）。</summary>
    public static double StyleCounterOf(string mine, string theirs)
    {
        if (StyleBeats(mine) == theirs) return 1.8;
        if (StyleBeats(theirs) == mine) return -1.0;
        return 0;
    }

    /// <summary>选手职责 = 英雄池职责向量加权（熟练度权重）。</summary>
    public static DutyVector DutyVectorOf(Player p)
    {
        var sum = new DutyVector();
        double w = 0;
        foreach (var agentId in p.AgentPool)
        {
            var a = CoreData.Agent(agentId);
            if (a == null) continue;
            double pro = p.AgentPro.TryGetValue(agentId, out var v) ? v : 0;
            sum.Duelist += a.Duty.Duelist * pro;
            sum.Initiator += a.Duty.Initiator * pro;
            sum.Controller += a.Duty.Controller * pro;
            sum.Sentinel += a.Duty.Sentinel * pro;
            w += pro;
        }
        if (w <= 0) return new DutyVector { Duelist = 0.25, Initiator = 0.25, Controller = 0.25, Sentinel = 0.25 };
        sum.Duelist /= w;
        sum.Initiator /= w;
        sum.Controller /= w;
        sum.Sentinel /= w;
        return sum;
    }

    /// <summary>自动分配英雄：标准位覆盖 + 熟练度贪心，地图成分折入评分（玩家预案/手动锁最高优先）。</summary>
    private static OrderedDict<string, string> AssignAgents(IReadOnlyList<Player> lineup, MapDef map, IReadOnlyDictionary<string, double>? patchMeta)
    {
        var need = new[] { "duelist", "initiator", "controller", "sentinel" };
        var used = new HashSet<string>();
        var outMap = new OrderedDict<string, string>();
        double JointFit(string agentId) => Fit.ComputeFit(agentId, map) * (patchMeta != null && patchMeta.TryGetValue(agentId, out var m) ? m : 1);
        // 先满足四个标准位
        foreach (var duty in need)
        {
            string? bestPid = null;
            string? bestAgent = null;
            double bestScore = -1;
            foreach (var p in lineup)
            {
                if (used.Contains(p.Id)) continue;
                var dv = DutyVectorOf(p);
                foreach (var agentId in p.AgentPool)
                {
                    if (used.Contains("agent:" + agentId)) continue;
                    var a = CoreData.Agent(agentId);
                    if (a == null) continue;
                    double score = DutyGet(dv, duty) * (p.AgentPro.TryGetValue(agentId, out var pro) ? pro : 0) * 0.01
                                   + DutyGet(a.Duty, duty) * 0.5 + (JointFit(agentId) - 1) * 0.8;
                    if (score > bestScore)
                    {
                        bestScore = score;
                        bestPid = p.Id;
                        bestAgent = agentId;
                    }
                }
            }
            if (bestPid != null && bestAgent != null)
            {
                outMap[bestPid] = bestAgent;
                used.Add(bestPid);
                used.Add("agent:" + bestAgent);
            }
        }
        // 自由位：剩余选手最强英雄；同场不重复（池内全撞车才允许回落）
        foreach (var p in lineup)
        {
            if (outMap.ContainsKey(p.Id)) continue;
            var free = p.AgentPool.Where(a => !used.Contains("agent:" + a)).ToList();
            var pool = free.Count > 0 ? free : p.AgentPool;
            string best = pool.Count > 0 ? pool[0] : (p.AgentPool.Count > 0 ? p.AgentPool[0] : "omen");
            double bestPro = -1;
            foreach (var a in pool)
            {
                double pro = (p.AgentPro.TryGetValue(a, out var v) ? v : 0) + (JointFit(a) - 1) * 40;
                if (pro > bestPro)
                {
                    bestPro = pro;
                    best = a;
                }
            }
            outMap[p.Id] = best;
            used.Add("agent:" + best);
        }
        return outMap;
    }

    public sealed class SideInput
    {
        public Team Team = null!;
        public IReadOnlyDictionary<string, Player> Players = null!;
        public MapDef Map = null!;
        public int Day;
        public double? Intel;
        public IReadOnlyDictionary<string, string>? AgentAssign;
        public IReadOnlyDictionary<string, double>? PatchMeta;
        public double? StyleCounter;
        public double? ChokeMod;
    }

    public sealed class SideEdge
    {
        public double Base, Igl, Chem, Coach, Meta, Map, Prep, Familiarity, ShortHanded, Aim, Awareness, MapTactics;
    }

    public sealed class SideStrength
    {
        public string TeamId = "";
        public double Base, Atk, Def, Mid;
        public SideEdge Edge = new();
        public List<Player> Lineup = new();
        public OrderedDict<string, string> Agents = new();
        public double IglAttr;
        public double ClutchAvg;
    }

    private static double AttrAvg(IReadOnlyList<Player> lineup, Func<PlayerAttrs, double> get, double fallback) =>
        lineup.Count > 0 ? lineup.Sum(p => get(p.Attrs)) / lineup.Count : fallback;

    public static SideStrength ComputeSide(SideInput input)
    {
        var team = input.Team;
        var map = input.Map;
        var day = input.Day;
        var patchMeta = input.PatchMeta;
        var all = team.Starters.Select(id => input.Players.TryGetValue(id, out var p) ? p : null).Where(p => p != null).Cast<Player>().ToList();
        var healthy = all.Where(p => p.InjuredUntilDay <= day).ToList();
        // 伤病缺阵 → 从 roster 补（按有效能力排序，稳定序）
        if (healthy.Count < 5)
        {
            var bench = team.Roster
                .Select(id => input.Players.TryGetValue(id, out var p) ? p : null)
                .Where(p => p != null && !all.Contains(p!))
                .Cast<Player>()
                .OrderByDescending(p => EffectiveOverall(p, day))
                .ToList();
            while (healthy.Count < 5 && bench.Count > 0)
            {
                var p = bench[0];
                bench.RemoveAt(0);
                if (p.InjuredUntilDay <= day) healthy.Add(p);
            }
        }
        var lineup = healthy.Take(5).ToList();
        int missing = 5 - lineup.Count;

        var effs = lineup.Select(p => EffectiveOverall(p, day)).ToList();
        var sorted = effs.OrderByDescending(x => x).ToList();
        double baseVal = 0;
        double wSum = 0;
        for (int i = 0; i < sorted.Count; i++)
        {
            double w = i < LineupWeights.Length ? LineupWeights[i] : 0.8;
            baseVal += (i < sorted.Count ? sorted[i] : 60) * w;
            wSum += w;
        }
        baseVal = wSum > 0 ? baseVal / wSum : 50;

        double iglAttr;
        var iglPlayer = lineup.FirstOrDefault(p => p.IsIgl)
                        ?? lineup.OrderByDescending(p => p.Attrs.Igl).FirstOrDefault();
        var vicePlayer = lineup.FirstOrDefault(p => p.ViceIgl);
        iglAttr = iglPlayer?.Attrs.Igl ?? 0;

        double iglMod = iglPlayer != null ? (iglAttr - 60) * 0.09 : -4;
        double chemMod = ((AttrAvg(lineup, a => a.Teamwork, 55) + AttrAvg(lineup, a => a.Communication, 55)) / 2 - 65) * 0.07 + (team.Bond - 50) * 0.04;
        double coachMod = (team.Coach.Tactics - 60) * 0.05 - 1;
        double mapMod = ((team.MapPref.TryGetValue(map.Id, out var mp) ? mp : 50) - 50) * 0.07;
        double prepMod = Math.Min(2.2, Math.Max(0, (input.Intel ?? 0) * 0.22));
        double shortHandedMod = -(double)Math.Max(0, missing) * 18; // double 语义（TS number：-0*18=-0，符号位进位型 hex）

        // 英雄分配：自动分配打底，玩家首选预案覆盖
        var autoAgents = AssignAgents(lineup, map, patchMeta);
        var agents = new OrderedDict<string, string>();
        foreach (var kv in autoAgents) agents[kv.Key] = kv.Value;
        if (input.AgentAssign != null)
        {
            foreach (var p in lineup)
            {
                if (input.AgentAssign.TryGetValue(p.Id, out var want) && p.AgentPool.Contains(want))
                    agents[p.Id] = want;
            }
        }
        double fitSum = 0;
        double fitN = 0;
        double proSum = 0;
        foreach (var p in lineup)
        {
            if (!agents.TryGetValue(p.Id, out var agentId)) continue;
            var a = CoreData.Agent(agentId);
            double patchMetaV = patchMeta != null && patchMeta.TryGetValue(agentId, out var m) ? m : 1;
            fitSum += a != null ? Fit.ComputeFit(agentId, map) * patchMetaV : 1;
            fitN++;
            proSum += p.AgentPro.TryGetValue(agentId, out var pro) ? pro : 50;
        }
        double compFit = fitN > 0 ? fitSum / fitN : 1;
        double metaMod = Math.Min(2.5, Math.Max(-2.5, (compFit - 1) * 10));
        double avgPro = fitN > 0 ? proSum / fitN : 50;
        double familiarityMod = Math.Min(1, Math.Max(0, (avgPro - 40) / 60)) * 2;

        // 风格：进攻性 = 决斗+先锋职责占比
        double aggr = 0;
        foreach (var p in lineup)
        {
            var dv = DutyVectorOf(p);
            aggr += dv.Duelist + dv.Initiator;
        }
        aggr /= Math.Max(1, lineup.Count);
        double styleAtk = (aggr - 0.5) * 3;
        double styleDef = -(aggr - 0.5) * 2;
        double counter = input.StyleCounter ?? 0;

        double aimMod = (AttrAvg(lineup, a => a.Aim, 55) - 65) * 0.05;
        double awareMod = (AttrAvg(lineup, a => a.Awareness, 55) - 65) * 0.05;
        double scaledBase = baseVal * RoundBaseScale;
        // 地图战术助教：预案质量折算攻防修正（最高 +1.2）
        double mapTacticsMod = team.Staff.MapTactics != null
            ? Math.Min(1.2, Math.Max(0, (team.Staff.MapTactics.Value - 60) * 0.02))
            : 0;

        double atk = scaledBase + iglMod + chemMod + coachMod + mapMod + prepMod + metaMod + familiarityMod + shortHandedMod + styleAtk + aimMod + mapTacticsMod + counter;
        double def = scaledBase + iglMod + chemMod + coachMod + mapMod + prepMod + metaMod + familiarityMod + shortHandedMod + styleDef + awareMod + DefBonus + mapTacticsMod + counter * 0.5;
        // 副指挥微加成 + 大赛怯场 debuff
        double mid = (AttrAvg(lineup, a => a.Clutch, 55) - 65) * 0.05 + iglAttr * 0.06
                     + (vicePlayer != null ? vicePlayer.Attrs.Igl * 0.015 : 0)
                     + (input.ChokeMod ?? 0);

        return new SideStrength
        {
            TeamId = team.Id,
            Base = baseVal,
            Atk = atk,
            Def = def,
            Mid = mid,
            Edge = new SideEdge
            {
                Base = scaledBase, Igl = iglMod, Chem = chemMod, Coach = coachMod, Meta = metaMod,
                Map = mapMod, Prep = prepMod, Familiarity = familiarityMod, ShortHanded = shortHandedMod,
                Aim = aimMod, Awareness = awareMod, MapTactics = mapTacticsMod,
            },
            Lineup = lineup,
            Agents = agents,
            IglAttr = iglAttr,
            ClutchAvg = AttrAvg(lineup, a => a.Clutch, 55),
        };
    }
}
