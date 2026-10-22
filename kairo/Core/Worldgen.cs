using System;
using System.Collections.Generic;
using System.Linq;

namespace Kairo.Core;

/// <summary>
/// 种子化世界生成器 — C# 移植自 ace/src/core/worldgen.ts（权威实现），黄金轨迹逐位验证。
/// 确定性红线：
///  - 一切"Record/Map"语义用 OrderedDict（TS 插入序枚举）；
///  - 排序用 LINQ OrderBy/OrderByDescending（稳定序，对应 ES2019+ 的稳定 Array.sort）；
///  - 取整一律 DetMath.JsRound（JS 半数向 +∞ 语义）；
///  - 幂运算用 DetMath.PowInt（平台 Math.Pow 逐位不可靠）。
/// </summary>
public static class Worldgen
{
    private static readonly string[] DutyKeys = { "duelist", "initiator", "controller", "sentinel" };
    private static readonly string[] StarterTemplate = { "duelist", "initiator", "controller", "sentinel" };
    private static readonly string[] DutyDisplayOrder = { "duelist", "initiator", "controller", "sentinel" };
    private static readonly (string Key, double W)[] OverallW =
    {
        ("aim", 0.18), ("reaction", 0.14), ("awareness", 0.13), ("utility", 0.13),
        ("clutch", 0.12), ("teamwork", 0.10), ("communication", 0.10), ("igl", 0.10),
    };
    private static readonly Dictionary<string, double> OverallWMap = OverallW.ToDictionary(e => e.Key, e => e.W);

    private static readonly string[] IgnA =
    {
        "Nova", "Zen", "Kaze", "Rui", "Lin", "WolF", "Mist", "Void", "Tide", "Yu",
        "Ren", "Kite", "Frost", "Blaze", "Echo", "Drift", "Nora", "Skye", "Ash", "Rain",
        "Halo", "Vex", "Polar", "Sora", "Kuro", "Yuki", "Hana", "Rei", "Taro", "Juno",
    };
    private static readonly string[] IgnB = { "", "", "", "1", "2", "X", "Z", "7", "9", "ee", "ie", "ao", "in", "er", "0" };

    private static readonly Dictionary<string, string[]> SynNames = new()
    {
        ["americas"] = new[] { "Tyler", "Mason", "Diego", "Mateo", "Lucas", "Jayden", "Carlo", "Santi", "Eli", "Marco", "Andre", "Nico" },
        ["emea"] = new[] { "Emil", "Jonas", "Maks", "Patrik", "Aleks", "Nikita", "Tomas", "Felix", "Hugo", "Louis", "Piotr", "Sasha" },
        ["pacific"] = new[] { "Minjun", "Sungwoo", "Yuki", "Haruto", "Renji", "Jiho", "Kenta", "Minseo", "Takeru", "Dohyun", "Riku", "Junsu" },
        ["china"] = new[] { "Xiaoyu", "Chenxi", "Zihan", "Yifan", "Haochen", "Junyi", "Weiming", "Zhiyuan", "Ruoxi", "Tianyi", "Zeming", "Boyu" },
    };
    private static readonly string[] SynSuffix = { "", "", "X", "7", "2", "ee", "z", "99", "01" };
    private static readonly string[] CoachNames = { "老K", "阿澈", "白熊", "萧然", "陆离", "顾行", "苏木", "陈野", "洛尘", "祁风", "温叙", "关山" };

    // 数据经 CoreData 持有（LoadData 委托），本类不自带副本

    /// <summary>装载数据包（生成前必须调用一次）。</summary>
    public static void LoadData(string dataDir) => CoreData.Load(dataDir);

    private static double AttrGet(PlayerAttrs a, string k) => k switch
    {
        "aim" => a.Aim, "reaction" => a.Reaction, "awareness" => a.Awareness, "utility" => a.Utility,
        "clutch" => a.Clutch, "teamwork" => a.Teamwork, "communication" => a.Communication, "igl" => a.Igl,
        _ => throw new ArgumentException(k),
    };
    private static void AttrSet(PlayerAttrs a, string k, double v)
    {
        switch (k)
        {
            case "aim": a.Aim = v; break;
            case "reaction": a.Reaction = v; break;
            case "awareness": a.Awareness = v; break;
            case "utility": a.Utility = v; break;
            case "clutch": a.Clutch = v; break;
            case "teamwork": a.Teamwork = v; break;
            case "communication": a.Communication = v; break;
            case "igl": a.Igl = v; break;
            default: throw new ArgumentException(k);
        }
    }

    public static int ComputeOverall(PlayerAttrs attrs)
    {
        double v = 0;
        foreach (var (k, w) in OverallW) v += AttrGet(attrs, k) * w;
        return (int)DetMath.JsRound(v);
    }

    private static (string Key, double Tilt)? TiltOf(string duty, string k) => duty switch
    {
        "duelist" => k switch
        {
            "aim" => ("aim", 8), "reaction" => ("reaction", 6), "clutch" => ("clutch", 3),
            "awareness" => ("awareness", -3), "utility" => ("utility", -4), "teamwork" => ("teamwork", -3), _ => null,
        },
        "initiator" => k switch
        {
            "utility" => ("utility", 6), "awareness" => ("awareness", 5), "communication" => ("communication", 4), "aim" => ("aim", -3), _ => null,
        },
        "controller" => k switch
        {
            "utility" => ("utility", 7), "awareness" => ("awareness", 5), "teamwork" => ("teamwork", 4),
            "reaction" => ("reaction", -4), "clutch" => ("clutch", -3), _ => null,
        },
        "sentinel" => k switch
        {
            "awareness" => ("awareness", 7), "teamwork" => ("teamwork", 4), "utility" => ("utility", 3),
            "reaction" => ("reaction", -3), "aim" => ("aim", -2), _ => null,
        },
        _ => null,
    };

    private static PlayerAttrs GenerateAttrs(Rng rng, double target, string duty, bool isIgl)
    {
        // TS 语义：属性全程 double，只在 computeOverall 出口取整
        var attrs = new PlayerAttrs();
        foreach (var (k, _) in OverallW)
        {
            var tilt = TiltOf(duty, k);
            double t = tilt?.Tilt ?? 0;
            AttrSet(attrs, k, Clamp(rng.ClampNorm(target + t, 5, 30, 99), 30, 99));
        }
        if (isIgl) attrs.Igl = Clamp(attrs.Igl + 12, 30, 99);
        double actual = ComputeOverall(attrs);
        double diff = target - actual;
        foreach (var (k, _) in OverallW)
            AttrSet(attrs, k, Clamp(AttrGet(attrs, k) + diff, 30, 99));
        return attrs;
    }

    /// <summary>薪资曲线：overall 67 ≈ $21K/季，78 ≈ $171K/季。detPowInt 保证双端逐位一致。</summary>
    public static int SalaryFor(int overall, int tier)
    {
        double baseVal = 0.06 * DetMath.PowInt(1.21, overall);
        double scaled = baseVal * (tier == 1 ? 1 : 0.45);
        return (int)(DetMath.JsRound(scaled / 1000) * 1000);
    }

    private static int _playerIdSeq;
    /// <summary>生成闸门：playerIdSeq 为模块级状态（TS 同款），并发生成必须串行。</summary>
    private static readonly object GenGate = new();

    /// <summary>测试辅助：重置全局玩家 ID 序列（保证两次生成完全一致）。</summary>
    public static void ResetPlayerSeq() => _playerIdSeq = 0;

    private sealed class WeightedStats
    {
        public double Rating, Acs, Kd, Kast, Adr, Kpr, Apr, FkRate, FdRate;
        public List<(string Agent, int Rounds, double Share, double Rating)> ByAgent = new();
    }

    /// <summary>vlr 逐英雄统计 → rounds 加权综合（只计内部英雄池内的行）。</summary>
    private static WeightedStats? WeightedStatsOf(VlrPlayerStat vlrP)
    {
        double rounds = 0, rating = 0, acs = 0, kd = 0, kast = 0, adr = 0, kpr = 0, apr = 0, fk = 0, fd = 0;
        var byAgent = new List<(string, int, double, double)>();
        foreach (var s in vlrP.Stats)
        {
            if (!CoreData.AgentById.ContainsKey(s.Agent) || s.Rounds <= 0) continue;
            rounds += s.Rounds;
            rating += s.Rating * s.Rounds;
            acs += s.Acs * s.Rounds;
            kd += s.Kd * s.Rounds;
            kast += s.Kast * s.Rounds;
            adr += s.Adr * s.Rounds;
            kpr += s.Kpr * s.Rounds;
            apr += s.Apr * s.Rounds;
            fk += s.Fk;
            fd += s.Fd;
            byAgent.Add((s.Agent, s.Rounds, 0, s.Rating));
        }
        if (rounds == 0) return null;
        var list = new List<(string Agent, int Rounds, double Share, double Rating)>();
        foreach (var t in byAgent) list.Add((t.Item1, t.Item2, 0, t.Item4));
        for (int i = 0; i < list.Count; i++) list[i] = (list[i].Agent, list[i].Rounds, list[i].Rounds / rounds, list[i].Rating);
        return new WeightedStats
        {
            Rating = rating / rounds, Acs = acs / rounds, Kd = kd / rounds, Kast = kast / rounds,
            Adr = adr / rounds, Kpr = kpr / rounds, Apr = apr / rounds,
            FkRate = rounds > 0 ? fk / rounds : 0, FdRate = rounds > 0 ? fd / rounds : 0,
            ByAgent = list.Select(t => (t.Agent, t.Rounds, t.Share, t.Rating))
                .OrderByDescending(t => t.Rounds) // 稳定序 = ES2019+ Array.sort
                .ToList(),
        };
    }

    private static double Linmap(double v, double inMin, double inMax, double outMin, double outMax) =>
        Math.Min(95, Math.Max(35, outMin + ((v - inMin) / (inMax - inMin)) * (outMax - outMin)));

    private static double Clamp(double v, double min, double max) => Math.Min(max, Math.Max(min, v));

    /// <summary>真实选手属性推导：vlr 指标 → 八维。</summary>
    private static PlayerAttrs AttrsFromVlr(WeightedStats w, string duty, bool isIgl)
    {
        double fkShare = w.FkRate + w.FdRate > 0 ? w.FkRate / (w.FkRate + w.FdRate) : 0.5;
        var attrs = new PlayerAttrs
        {
            Aim = Linmap(w.Acs, 145, 245, 60, 96),
            Reaction = Linmap(w.Kd, 0.80, 1.26, 60, 94),
            Awareness = Linmap(w.Kast, 61, 78, 60, 86) + fkShare * 6,
            Utility = Linmap(w.Apr, 0.05, 0.36, 56, 92),
            Clutch = Clamp(66 + (w.Rating - 1.0) * 60 + (w.Kd - 1.0) * 20, 55, 96),
            Teamwork = Linmap(w.Kast * 0.7 + w.Apr * 60, 55, 85, 62, 90),
            Communication = 65 + fkShare * 5,
            Igl = isIgl ? 76 : 48,
        };
        foreach (var (k, _) in OverallW)
        {
            var tilt = TiltOf(duty, k);
            AttrSet(attrs, k, Clamp(AttrGet(attrs, k) + (tilt?.Tilt ?? 0) * 0.4, 35, 95));
        }
        if (isIgl) attrs.Igl = Clamp(attrs.Igl + 8, 35, 95);
        return attrs;
    }

    /// <summary>特质推导：真实选手按统计特征打标；虚拟选手按职责+随机。0-3 条。</summary>
    private static List<string> DeriveTraits(int? vlrId, string duty, PlayerAttrs attrs, Rng rng)
    {
        var uniq = new List<string>();
        void Push(string t) { if (!uniq.Contains(t)) uniq.Add(t); }

        var out0 = new List<string>();
        if (vlrId != null)
        {
            var p = CoreData.RealPlayersByVlr.GetValueOrDefault(vlrId.Value);
            var w = p != null ? WeightedStatsOf(p) : null;
            if (w != null)
            {
                double fkShare = w.FkRate + w.FdRate > 0 ? w.FkRate / (w.FkRate + w.FdRate) : 0.5;
                if (fkShare >= 0.62) out0.Add("entry");
                if (w.Kd >= 1.15 && w.Rating >= 1.1) out0.Add("carry");
                if (fkShare <= 0.38 && w.Kd >= 1.0) out0.Add("survivor");
                if (fkShare <= 0.35) out0.Add("baiter");
                if (Math.Abs(w.Kpr - 0.72) < 0.04 && w.Kd >= 1.05) out0.Add("headshot");
                if (w.Apr >= 0.3) out0.Add("enabler");
                if (w.Rating >= 1.05 && Math.Abs(w.Rating - 1.05) < 0.08) out0.Add("consistent");
            }
        }
        if (out0.Count == 0)
        {
            var anchor = duty switch { "duelist" => "entry", "initiator" => "enabler", "controller" => "anchor", "sentinel" => "anchor", _ => "anchor" };
            if (rng.Chance(0.7)) out0.Add(anchor);
            if (attrs.Clutch >= 75 && !out0.Contains("clutch") && rng.Chance(0.5)) out0.Add("clutch");
            if (attrs.Aim >= 80 && !out0.Contains("carry") && rng.Chance(0.4)) out0.Add("carry");
            if (rng.Chance(0.12)) out0.Add("glass");
            if (rng.Chance(0.06) && !out0.Contains("entry")) out0.Add("baiter");
        }
        foreach (var t in out0) Push(t);
        return uniq.Take(3).ToList();
    }

    /// <summary>starters 模板中的职责序 + 自由位。</summary>
    private static List<AgentDef> ByDuty(string d) => CoreData.Agents.Where(a => PrimaryDuty(a.Duty) == d).ToList();

    /// <summary>职责向量主职责（TS agents.ts#primaryDuty 语义：bestV 从 -1 起，遍历 initiator→controller→sentinel→duelist，严格 &gt;）。</summary>
    public static string PrimaryDuty(DutyVector d)
    {
        string best = "duelist";
        double bestV = -1;
        var order = new[] { "initiator", "controller", "sentinel", "duelist" };
        foreach (var k in order)
        {
            double v = k switch
            {
                "initiator" => d.Initiator,
                "controller" => d.Controller,
                "sentinel" => d.Sentinel,
                _ => d.Duelist,
            };
            if (v > bestV) { bestV = v; best = k; }
        }
        return best;
    }

    private static Player MakePlayer(
        Rng rng, string? teamId, int tier, double targetOverall, string duty, bool isIgl,
        (int Lo, int Hi) ageRange, HashSet<string> usedIgns, bool homegrown,
        string? ign = null, string? synthetic = null, string? realName = null, string? country = null,
        string? avatar = null, int? age = null)
    {
        string useIgn = ign ?? "";
        if (useIgn.Length > 0)
        {
            while (usedIgns.Contains(useIgn)) useIgn += rng.Pick(SynSuffix);
        }
        else
        {
            do
            {
                useIgn = rng.Pick(IgnA) + rng.Pick(IgnB);
            } while (usedIgns.Contains(useIgn));
        }
        usedIgns.Add(useIgn);

        int useAge = age ?? rng.Int(ageRange.Lo, ageRange.Hi);
        var attrs = GenerateAttrs(rng, targetOverall, duty, isIgl);
        int overall = ComputeOverall(attrs);

        // 英雄池：主职责英雄 2-3 名 + 邻近职责 1 名
        var pool = new List<string>();
        var primaryPool = rng.Shuffle(ByDuty(duty));
        pool.AddRange(primaryPool.Take(rng.Int(2, 3)).Select(a => a.Id));
        var neighbor = rng.Pick(DutyKeys.Where(d => d != duty).ToList());
        pool.Add(rng.Pick(ByDuty(neighbor)).Id);

        var agentPro = new OrderedDict<string, double>();
        foreach (var a in pool) agentPro[a] = rng.Int(45, 90);

        double growth = useAge <= 19 ? rng.Range(6, 16) : useAge <= 22 ? rng.Range(3, 10) : useAge <= 25 ? rng.Range(0, 5) : 0;
        int potential = (int)Clamp(DetMath.JsRound(overall + growth), overall, 99);
        int salary = SalaryFor(overall, tier);

        return new Player
        {
            Id = $"P{(_playerIdSeq++).ToString("D4")}",
            Ign = useIgn,
            RealName = realName,
            Country = country,
            Avatar = avatar,
            Synthetic = synthetic,
            Age = useAge,
            TeamId = teamId,
            Attrs = attrs,
            Overall = overall,
            Potential = potential,
            PeakOverall = overall,
            Form = (int)DetMath.JsRound(rng.Range(60, 80)),
            Morale = (int)DetMath.JsRound(rng.Range(60, 85)),
            Fatigue = (int)DetMath.JsRound(rng.Range(5, 30)),
            Salary = salary,
            ContractYears = rng.Int(1, 3),
            AgentPool = pool,
            AgentPro = agentPro,
            IsIgl = isIgl,
            Focus = "rest",
            Listed = false,
            ReleaseClause = rng.Chance(0.06) ? (int)(DetMath.JsRound(salary * 14 / 1000.0) * 1000) : 0,
            NoPoach = false,
            Traits = DeriveTraits(null, duty, attrs, rng),
            PromisedRole = "starter",
            InjuredUntilDay = 0,
            Homegrown = homegrown,
            BenchedWeeks = 0,
            BirthdayDay = rng.Int(1, 365),
            LastEventDay = 0,
            Career = new PlayerCareer { Clubs = teamId != null ? new List<string> { teamId } : new List<string>() },
        };
    }

    /// <summary>真实选手：id = R{vlrId}；属性从 vlr 统计推导。</summary>
    private static Player MakeRealPlayer(Rng rng, VlrPlayerStat vlrP, string teamId, int tier, bool forceIgl)
    {
        var w = WeightedStatsOf(vlrP);
        var mainAgent = w != null ? CoreData.Agents.FirstOrDefault(a => a.Id == w.ByAgent[0].Agent) : null;
        var usedDuty = mainAgent != null ? PrimaryDuty(mainAgent.Duty) : rng.Pick(DutyKeys.ToList());
        bool isIgl = forceIgl || (vlrP.Captain && rng.Chance(0.85));

        PlayerAttrs attrs;
        var agentPool = new List<string>();
        var agentPro = new OrderedDict<string, double>();
        if (w != null)
        {
            attrs = AttrsFromVlr(w, usedDuty, isIgl);
            int DutyRank(string agentId)
            {
                var a = CoreData.Agents.FirstOrDefault(x => x.Id == agentId);
                if (a == null) return 9;
                int best = 9;
                double bv = -1;
                foreach (var (k, v) in DutyEntries(a.Duty))
                {
                    if (v > bv) { bv = v; best = Array.IndexOf(DutyDisplayOrder, k); }
                }
                return best;
            }
            agentPool = w.ByAgent.Take(5).Select(t => t.Agent)
                .OrderBy(x => DutyRank(x)) // 稳定序
                .ToList();
            foreach (var a in w.ByAgent.Take(5))
                agentPro[a.Agent] = Clamp(48 + a.Share * 55 + (a.Rating - 1) * 22, 45, 95);
        }
        else
        {
            double target = tier == 1 ? 71 : 63;
            attrs = GenerateAttrs(rng, target + rng.Int(-4, 4), usedDuty, isIgl);
            agentPool = rng.Shuffle(ByDuty(usedDuty)).Take(3).Select(a => a.Id).ToList();
            foreach (var a in agentPool) agentPro[a] = rng.Int(50, 85);
        }
        if (agentPool.Count < 3)
        {
            var extra = rng.Shuffle(ByDuty(usedDuty).Where(a => !agentPool.Contains(a.Id)).ToList()).Take(3 - agentPool.Count).ToList();
            foreach (var a in extra)
            {
                agentPool.Add(a.Id);
                agentPro[a.Id] = rng.Int(45, 60);
            }
        }

        // 年龄：vlr 无生日字段 → 按 hash 确定性合成 19-29
        uint h = (uint)(vlrP.VlrId) ^ 0x5bf03635u;
        h = (h ^ (h >> 15)) * 0x2545f491u;
        int age = 19 + (int)(h % 11);
        int overall = ComputeOverall(attrs);
        double growth = age <= 19 ? rng.Range(6, 14) : age <= 22 ? rng.Range(3, 9) : age <= 25 ? rng.Range(0, 5) : 0;
        // 解约金（GDD §8.2）：明星 25% / 普通 8%，额度 ≈ 身价 ×1.5
        double releaseOdds = overall >= 80 ? 0.25 : 0.08;
        int salary = SalaryFor(overall, tier);
        int releaseClause = rng.Chance(releaseOdds) ? (int)(DetMath.JsRound(salary * 18 / 1000.0) * 1000) : 0;

        return new Player
        {
            Id = $"R{vlrP.VlrId}",
            Ign = vlrP.Alias,
            RealName = vlrP.Real.Length > 0 ? vlrP.Real : null,
            Country = vlrP.Country.Length > 0 ? vlrP.Country : null,
            Avatar = vlrP.Avatar,
            Age = age,
            TeamId = teamId,
            Attrs = attrs,
            Overall = overall,
            Potential = (int)Clamp(DetMath.JsRound(overall + growth), overall, 99),
            PeakOverall = overall,
            Form = (int)DetMath.JsRound(rng.Range(60, 80)),
            Morale = (int)DetMath.JsRound(rng.Range(60, 85)),
            Fatigue = (int)DetMath.JsRound(rng.Range(5, 30)),
            Salary = salary,
            ContractYears = rng.Int(1, 3),
            AgentPool = agentPool,
            AgentPro = agentPro,
            IsIgl = isIgl,
            Focus = "rest",
            Listed = false,
            ReleaseClause = releaseClause,
            NoPoach = false,
            Traits = DeriveTraits(vlrP.VlrId, usedDuty, attrs, rng),
            PromisedRole = "starter",
            InjuredUntilDay = 0,
            Homegrown = false,
            BenchedWeeks = 0,
            BirthdayDay = rng.Int(1, 365),
            LastEventDay = 0,
            Career = new PlayerCareer { Clubs = new List<string> { teamId } },
        };
    }

    /// <summary>DutyVector 的规范枚举序（duelist→initiator→controller→sentinel，对应 TS 对象字面量键序）。</summary>
    private static IEnumerable<(string Key, double Value)> DutyEntries(DutyVector d)
    {
        yield return ("duelist", d.Duelist);
        yield return ("initiator", d.Initiator);
        yield return ("controller", d.Controller);
        yield return ("sentinel", d.Sentinel);
    }

    private static Team MakeTeamSkeleton(Rng rng, string id, string name, string tag, int tier, string regionId)
    {
        var mapPref = new OrderedDict<string, double>();
        foreach (var m in CoreData.Maps) mapPref[m.Id] = rng.Int(45, 75);
        var personalities = new[] { "spender", "youth", "steady", "wheeler" };
        return new Team
        {
            Id = id,
            Name = name,
            Tag = tag,
            Tier = tier,
            RegionId = regionId,
            Roster = new List<string>(),
            Starters = new List<string>(),
            Coach = new Coach
            {
                Name = rng.Pick(CoachNames),
                Tactics = (int)DetMath.JsRound(rng.ClampNorm(tier == 1 ? 64 : 56, 8, 35, 90)),
                Development = (int)DetMath.JsRound(rng.ClampNorm(tier == 1 ? 62 : 58, 8, 35, 90)),
                Motivation = (int)DetMath.JsRound(rng.ClampNorm(tier == 1 ? 63 : 57, 8, 35, 90)),
            },
            Facilities = tier == 1 ? rng.Int(60, 85) : rng.Int(40, 60),
            Budget = tier == 1 ? rng.Int(3_000_000, 8_000_000) : rng.Int(300_000, 900_000),
            Reputation = tier == 1 ? rng.Int(50, 80) : rng.Int(30, 50),
            Personality = rng.Pick(personalities),
            Sponsors = new List<Sponsor>(),
            Staff = new StaffSlots
            {
                Training = new StaffSlot { Name = rng.Pick(CoachNames) + "（训练）", Value = (int)Clamp(DetMath.JsRound(rng.ClampNorm(tier == 1 ? 58 : 50, 12, 20, 90)), 20, 90) },
                MapTactics = new StaffSlot { Name = rng.Pick(CoachNames) + "（战术）", Value = (int)Clamp(DetMath.JsRound(rng.ClampNorm(tier == 1 ? 60 : 52, 12, 20, 90)), 20, 90) },
                Match = new StaffSlot { Name = rng.Pick(CoachNames) + "（比赛）", Value = (int)Clamp(DetMath.JsRound(rng.ClampNorm(tier == 1 ? 58 : 50, 12, 20, 90)), 20, 90) },
            },
            Academy = new List<string>(),
            MapPref = mapPref,
            Bond = rng.Int(45, 65),
        };
    }

    /// <summary>生成 v0.7 世界：四大赛区 64 队（真实数据快照），每队 ≤7 真实 roster + 青训补位。</summary>
    public static GameState GenerateWorld(long seed, bool resetSeq = false)
    {
        if (CoreData.Agents.Count == 0) throw new InvalidOperationException("Worldgen.LoadData must be called before GenerateWorld.");
        lock (GenGate)
        {
            if (resetSeq) _playerIdSeq = 0; // 重置必须在闸门内（与 TS resetPlayerSeq()+generateWorld 两步等价且原子）
            return GenerateWorldInner(seed);
        }
    }

    private static GameState GenerateWorldInner(long seed)
    {
        var rng = new Rng((uint)seed);
        var players = new List<Player>();
        var teams = new OrderedDict<string, Team>();
        var usedIgns = new HashSet<string>();

        // 赛区插入序 = REAL_TEAMS 首次出现序（TS Map 插入序语义）
        var regionOrder = new List<string>();
        var byRegion = new Dictionary<string, List<VlrTeamStat>>();
        foreach (var t in CoreData.RealTeams)
        {
            if (!byRegion.TryGetValue(t.Region, out var arr))
            {
                arr = new List<VlrTeamStat>();
                byRegion[t.Region] = arr;
                regionOrder.Add(t.Region);
            }
            arr.Add(t);
        }
        foreach (var region in regionOrder)
        {
            var sorted = byRegion[region].OrderBy(t => t.Rank).ToList(); // 稳定序
            foreach (var (vt, i) in sorted.WithIndex())
            {
                int tier = vt.Partnered ? 1 : 2;
                string id = $"{(tier == 1 ? "T" : "C")}{vt.VlrId}";
                var skeleton = MakeTeamSkeleton(rng, id, vt.Name, vt.Tag, tier, region);
                var realRoster = new List<string>();
                bool iglSet = false;
                foreach (var vlrId in vt.Roster)
                {
                    if (!CoreData.RealPlayersByVlr.TryGetValue(vlrId, out var vlrP)) continue;
                    var p = MakeRealPlayer(rng, vlrP, id, tier, false);
                    if (!iglSet && p.IsIgl) iglSet = true;
                    players.Add(p);
                    realRoster.Add(p.Id);
                    usedIgns.Add(p.Ign);
                }
                // 青训补位到 7
                while (realRoster.Count < 7)
                {
                    var duty = StarterTemplate[realRoster.Count % 4];
                    double target = tier == 1 ? 64 : 58;
                    var ap = MakePlayer(rng, id, tier, target + rng.Int(-3, 3), duty, false, (17, 21), usedIgns, true,
                        ign: rng.Pick(SynNames.GetValueOrDefault(region) ?? SynNames["china"]) + rng.Pick(SynSuffix),
                        synthetic: "academy",
                        age: rng.Int(17, 20));
                    ap.PromisedRole = "bench";
                    players.Add(ap);
                    realRoster.Add(ap.Id);
                }
                // IGL 保证恰 1（对最终名单，稳定序取 overall 最高）
                {
                    var finalPlayers = realRoster.Select(pid => players.First(x => x.Id == pid)).ToList();
                    if (finalPlayers.Count > 0 && finalPlayers.All(p => !p.IsIgl))
                    {
                        var top = finalPlayers.OrderByDescending(p => p.Overall).First();
                        top.IsIgl = true;
                        top.Attrs.Igl = Clamp(top.Attrs.Igl + 22, 35, 95);
                        top.Overall = ComputeOverall(top.Attrs);
                    }
                }
                // 替补超编（roster>7）：裁到 7，被裁者进自由池
                while (realRoster.Count > 7)
                {
                    var cut = realRoster[^1];
                    realRoster.RemoveAt(realRoster.Count - 1);
                    var cp = players.First(x => x.Id == cut);
                    cp.TeamId = null;
                    cp.PromisedRole = "bench";
                }
                // 青训营：每队初始 2 名 ≤18 岁学员
                for (int ai = 0; ai < 2; ai++)
                {
                    var duty = StarterTemplate[(realRoster.Count + ai) % 4];
                    var ap = MakePlayer(rng, id, tier, tier == 1 ? 58 : 52, duty, false, (16, 18), usedIgns, true,
                        ign: rng.Pick(SynNames.GetValueOrDefault(region) ?? SynNames["china"]) + rng.Pick(SynSuffix),
                        synthetic: "academy",
                        age: rng.Int(16, 18));
                    ap.PromisedRole = "bench";
                    players.Add(ap);
                    skeleton.Academy.Add(ap.Id);
                }
                skeleton.Roster = realRoster;
                skeleton.Starters = realRoster.Take(5).ToList();
                if (vt.Coach != null)
                    skeleton.Coach.Name = vt.Coach.Alias;
                else if (vt.Staff.Count > 0)
                    skeleton.Coach.Name = $"代理教练 {vt.Staff[0].Alias}";
                else
                    skeleton.Coach.Name = "暂无主教练";
                // 真实 staff 覆盖：role → 槽位（head→mapTactics / analyst→match / 其余→training）
                skeleton.Staff = new StaffSlots();
                foreach (var st in vt.Staff.Take(3))
                {
                    var slot = RoleFit(st.Role);
                    var cur = slot switch
                    {
                        "training" => skeleton.Staff.Training,
                        "mapTactics" => skeleton.Staff.MapTactics,
                        _ => skeleton.Staff.Match,
                    };
                    if (cur == null)
                    {
                        var s = new StaffSlot { Name = st.Alias, Value = 0 };
                        if (slot == "training") skeleton.Staff.Training = s;
                        else if (slot == "mapTactics") skeleton.Staff.MapTactics = s;
                        else skeleton.Staff.Match = s;
                    }
                }
                foreach (var (slot, s) in new[] { ("training", skeleton.Staff.Training), ("mapTactics", skeleton.Staff.MapTactics), ("match", skeleton.Staff.Match) })
                {
                    if (s != null && s.Value == 0)
                        s.Value = (int)Clamp(DetMath.JsRound(skeleton.Coach.Tactics + rng.Int(-8, 8)), 30, 90);
                }
                skeleton.VlrId = vt.VlrId;
                skeleton.Logo = vt.Logo;
                skeleton.Reputation = (int)Clamp(DetMath.JsRound((tier == 1 ? 50 : 30) + (16 - Math.Min(i, 15)) * 2 + rng.Int(0, 8)), 25, 90);
                teams[id] = skeleton;
            }
        }

        var playerMap = new OrderedDict<string, Player>();
        foreach (var p in players) playerMap[p.Id] = p;

        // 自由市场：按队伍规模等比
        int faCount = (int)DetMath.JsRound(teams.Count / 18.0 * 14);
        for (int i = 0; i < faCount; i++)
        {
            double target = rng.Int(60, 78);
            var fa = MakePlayer(rng, null, 1, target, rng.Pick(DutyKeys.ToList()), false, (18, 30), usedIgns, false, synthetic: "free");
            fa.PromisedRole = "bench";
            players.Add(fa);
            playerMap[fa.Id] = fa;
        }

        var state = new GameState
        {
            Seed = seed,
            Year = 2026,
            Day = 1,
            Stage = "preseason",
            MyTeamId = null,
            Teams = teams,
            Players = playerMap,
            LastEventDay = 0,
            Manager = new Manager
            {
                Name = "经理",
                Reputation = 40,
                Skills = new ManagerSkills { Training = 50, Negotiation = 50, Tactics = 50, Scouting = 50, Medical = 50, Business = 50, Locker = 50, Youth = 50 },
                Life = new ManagerLife { Wallet = 2000, Hunger = 80, Mood = 70 },
            },
            BoardConfidence = 62,
            Objective = null,
            ActionPoints = 3,
            TeamSchedule = new List<string> { "map", "map", "review", "scrim", "individual", "individual", "rest" },
            TrainingMaps = new List<string> { "ascent", "split" },
        };
        // 开局赞助：每队 2 档随机地方赞助
        foreach (var t in teams.Values)
        {
            t.Sponsors = new List<Sponsor>();
            for (int k = 0; k < 2; k++)
            {
                t.Sponsors.Add(new Sponsor
                {
                    Id = $"SP0_{t.Id}_{k}",
                    Name = rng.Pick(new[] { "晨光乳业", "飞毛腿快递", "街角咖啡", "雷霆文具" }),
                    Tier = 1,
                    PerSeason = (int)(DetMath.JsRound(rng.Range(80_000, 150_000) / 1000) * 1000),
                    Years = rng.Int(1, 2),
                    SignedYear = 2026,
                });
            }
        }
        // 野心：35-85 确定性分布
        foreach (var p in playerMap.Values) p.Ambition = 35 + (int)(Rng.HashString(p.Id) % 51);
        return state;
    }

    private static string RoleFit(string role) =>
        role.Contains("head", StringComparison.OrdinalIgnoreCase) ? "mapTactics"
        : role.Contains("analyst", StringComparison.OrdinalIgnoreCase) ? "match"
        : "training";

    /// <summary>生成自由人并入 state（迁移补池 / 休赛期补强共用）。</summary>
    public static void SpawnFreeAgents(GameState state, Rng rng, int count)
    {
        lock (GenGate)
        {
            SpawnFreeAgentsInner(state, rng, count);
        }
    }

    private static void SpawnFreeAgentsInner(GameState state, Rng rng, int count)
    {
        var usedIgns = new HashSet<string>(state.Players.Values.Select(p => p.Ign));
        for (int i = 0; i < count; i++)
        {
            double target = rng.Int(60, 78);
            var fa = MakePlayer(rng, null, 1, target, rng.Pick(DutyKeys.ToList()), false, (18, 30), usedIgns, false, synthetic: "free");
            fa.PromisedRole = "bench";
            state.Players[fa.Id] = fa;
        }
    }

    /// <summary>生成选秀新秀池：16-18 岁联盟新血，不入队；少量「本届天才」潜力拔高。</summary>
    public static List<Player> SpawnRookieClass(GameState state, Rng rng, int count)
    {
        lock (GenGate)
        {
            return SpawnRookieClassInner(state, rng, count);
        }
    }

    private static List<Player> SpawnRookieClassInner(GameState state, Rng rng, int count)
    {
        var usedIgns = new HashSet<string>(state.Players.Values.Select(p => p.Ign));
        var rookies = new List<Player>();
        for (int i = 0; i < count; i++)
        {
            var r = MakePlayer(rng, null, 1, rng.Int(54, 66), rng.Pick(DutyKeys.ToList()), false, (16, 18), usedIgns, false, synthetic: "rookie");
            rookies.Add(r);
            state.Players[r.Id] = r;
        }
        int prodigy = (int)Math.Max(1, DetMath.JsRound(count * 0.12));
        var byPotential = rookies.OrderByDescending(r => r.Potential).ToList(); // 稳定序
        foreach (var r in byPotential.Take(prodigy))
            r.Potential = (int)Clamp(Math.Min(94, r.Potential + rng.Int(6, 14)), r.Overall, 94);
        return rookies;
    }
}
