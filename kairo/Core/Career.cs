using System;
using System.Collections.Generic;
using System.Linq;

namespace Kairo.Core;

/// <summary>
/// 经理人生涯（GDD §9.5，v1.0-6）— C# 移植自 ace/src/core/sim/career.ts（权威实现）。
/// 出身 3 选 1 / 下课（信任警告→连败/谷底）/ 跳槽申请 / 五年之约与第 10 年强制退休 / 名人堂数据源。
/// </summary>
public static class Career
{
    public const string MilestoneCardId = "milestone";

    public static string SkillCn(string skill) => skill switch
    {
        "training" => "训练", "negotiation" => "谈判", "tactics" => "战术", "scouting" => "眼光",
        "medical" => "医疗", "business" => "商务", "locker" => "更衣室", "youth" => "青训",
        _ => throw new ArgumentException(skill),
    };

    public const int TalentPool = 24;
    public const int TalentBase = 50;
    public const int TalentCap = 70;

    public sealed class TalentPreset
    {
        public string Key = "";
        public string Label = "";
        public string Desc = "";
        public OrderedDict<string, int> Points = new();
    }

    /// <summary>推荐配置（一键）：四套预制各恰好用满 24 点。</summary>
    public static readonly List<TalentPreset> TalentPresets = new()
    {
        new TalentPreset
        {
            Key = "even", Label = "均衡推荐", Desc = "八维各 +3——没有短板的新帅",
            Points = new OrderedDict<string, int>
            {
                ["training"] = 3, ["negotiation"] = 3, ["tactics"] = 3, ["scouting"] = 3,
                ["medical"] = 3, ["business"] = 3, ["locker"] = 3, ["youth"] = 3,
            },
        },
        new TalentPreset
        {
            Key = "tactics", Label = "战术大师", Desc = "战术 +7、眼光 +5——针对准备与读图先行",
            Points = new OrderedDict<string, int>
            {
                ["training"] = 4, ["negotiation"] = 2, ["tactics"] = 7, ["scouting"] = 5,
                ["medical"] = 1, ["business"] = 1, ["locker"] = 3, ["youth"] = 1,
            },
        },
        new TalentPreset
        {
            Key = "youth", Label = "青训教父", Desc = "青训 +7、训练 +5——门下弟子与跳槽背书",
            Points = new OrderedDict<string, int>
            {
                ["training"] = 5, ["negotiation"] = 2, ["tactics"] = 1, ["scouting"] = 4,
                ["medical"] = 1, ["business"] = 1, ["locker"] = 3, ["youth"] = 7,
            },
        },
        new TalentPreset
        {
            Key = "business", Label = "金牌经理", Desc = "商务 +7、谈判 +5——把俱乐部钱袋子攥在手里",
            Points = new OrderedDict<string, int>
            {
                ["training"] = 1, ["negotiation"] = 5, ["tactics"] = 2, ["scouting"] = 3,
                ["medical"] = 1, ["business"] = 7, ["locker"] = 4, ["youth"] = 1,
            },
        },
    };

    private static readonly string[] SkillKeys = { "training", "negotiation", "tactics", "scouting", "medical", "business", "locker", "youth" };

    /// <summary>应用天赋点（在 initCareer 之前调用：出身加成叠加在天赋之上）。</summary>
    public static void ApplyTalents(GameState state, IReadOnlyDictionary<string, int> points)
    {
        var mgr = state.Manager;
        foreach (var k in SkillKeys)
            SkillSet(mgr.Skills, k, Math.Min(70, Math.Max(15, TalentBase + (points.TryGetValue(k, out var v) ? v : 0))));
    }

    private static int SkillGet(ManagerSkills s, string k) => k switch
    {
        "training" => s.Training, "negotiation" => s.Negotiation, "tactics" => s.Tactics, "scouting" => s.Scouting,
        "medical" => s.Medical, "business" => s.Business, "locker" => s.Locker, "youth" => s.Youth,
        _ => throw new ArgumentException(k),
    };
    private static void SkillSet(ManagerSkills s, string k, int v)
    {
        switch (k)
        {
            case "training": s.Training = v; break;
            case "negotiation": s.Negotiation = v; break;
            case "tactics": s.Tactics = v; break;
            case "scouting": s.Scouting = v; break;
            case "medical": s.Medical = v; break;
            case "business": s.Business = v; break;
            case "locker": s.Locker = v; break;
            case "youth": s.Youth = v; break;
            default: throw new ArgumentException(k);
        }
    }

    public const int SelfStudyCost = 5_000;
    public const int SelfStudyCap = 75;

    /// <summary>自我进修（v1.4）：花个人钱包 $5K 给一项技能 +1（上限 75）——零 RNG。</summary>
    public static string SelfStudy(GameState state, string skill)
    {
        var life = state.Manager.Life;
        if (life.Wallet < SelfStudyCost) return $"个人积蓄不足（需 ${SelfStudyCost / 1000}K）。";
        int cur = SkillGet(state.Manager.Skills, skill);
        if (cur >= SelfStudyCap) return $"{SkillCn(skill)}已达进修上限（{SelfStudyCap}）。";
        life.Wallet -= SelfStudyCost;
        SkillSet(state.Manager.Skills, skill, cur + 1);
        return $"完成一门{SkillCn(skill)}进修课：{SkillCn(skill)} {cur} → {cur + 1}（${SelfStudyCost / 1000}K）。";
    }

    public sealed class OriginDef
    {
        public string Key = "";
        public string Label = "";
        public string Desc = "";
        public OrderedDict<string, int> SkillBonus = new();
    }

    /// <summary>出身定义（开档 3 选 1）：2 强 1 弱 + 起始资源差异。</summary>
    public static readonly List<OriginDef> Origins = new()
    {
        new OriginDef { Key = "legend", Label = "前豪门名宿", Desc = "声望 +15、谈判 +5、个人钱包 +$60K——名头好借，期望也高", SkillBonus = new OrderedDict<string, int> { ["negotiation"] = 5 } },
        new OriginDef { Key = "grassroots", Label = "次级联赛草根", Desc = "眼光 +8、俱乐部预算 +$400K——从泥地里爬上来的实干派", SkillBonus = new OrderedDict<string, int> { ["scouting"] = 8 } },
        new OriginDef { Key = "analyst", Label = "数据分析师出身", Desc = "战术 +5、眼光 +5、声望 -5——更衣室待证明自己", SkillBonus = new OrderedDict<string, int> { ["tactics"] = 5, ["scouting"] = 5 } },
    };

    /// <summary>开档初始化生涯账本并应用出身加成。</summary>
    public static void InitCareer(GameState state, string origin)
    {
        var mgr = state.Manager;
        mgr.Career = new ManagerCareer { StartYear = state.Year, Seasons = 1, Titles = 0, Wins = 0, Losses = 0, LoseStreak = 0, Warned = false, Origin = origin };
        int Negotiation() => SkillGet(mgr.Skills, "negotiation");
        int Scouting() => SkillGet(mgr.Skills, "scouting");
        int Tactics() => SkillGet(mgr.Skills, "tactics");
        mgr.Skills.Negotiation = (int)Math.Min(90, Math.Max(10, Negotiation() + (origin == "legend" ? 5 : 0)));
        mgr.Skills.Scouting = (int)Math.Min(90, Math.Max(10, Scouting() + (origin == "grassroots" ? 8 : origin == "analyst" ? 5 : 0)));
        mgr.Skills.Tactics = (int)Math.Min(90, Math.Max(10, Tactics() + (origin == "analyst" ? 5 : 0)));
        mgr.Reputation = (int)Math.Min(99, Math.Max(20, mgr.Reputation + (origin == "legend" ? 15 : origin == "analyst" ? -5 : 0)));
        if (origin == "legend") mgr.Life.Wallet += 60_000;
        if (origin == "grassroots" && state.MyTeamId != null && state.Teams.TryGetValue(state.MyTeamId, out var t))
            t.Budget += 400_000;
    }

    /// <summary>我的正式比赛结果入账：胜负/连败/下课判定。</summary>
    public static void NoteMatchResult(GameState state, bool won, List<NewsItem> notes)
    {
        var c = state.Manager.Career;
        if (c == null || c.Ending != null) return;
        if (won)
        {
            c.Wins++;
            c.LoseStreak = 0;
        }
        else
        {
            c.Losses++;
            c.LoseStreak++;
            if (c.Warned && c.LoseStreak >= 3)
            {
                FireManager(state, notes, "警告后三连败");
            }
        }
    }

    /// <summary>周结算下课检查（信任 ≤20 警告；≤6 直接下课）。</summary>
    public static void CareerWeeklyTick(GameState state, List<NewsItem> notes)
    {
        var c = state.Manager.Career;
        if (c == null || c.Ending != null) return;
        int conf = state.BoardConfidence;
        if (conf <= 6)
        {
            FireManager(state, notes, "董事会信心跌至谷底");
            return;
        }
        if (conf <= 20 && !c.Warned)
        {
            c.Warned = true;
            notes.Add(new NewsItem { Day = state.Day, Kind = "club", Important = true, Text = "⚠️ 董事会发出最后通牒：再遭连败或将解除主帅职务。" });
        }
        else if (conf > 45)
        {
            c.Warned = false; // 信任回暖解除警告
        }
    }

    private static void FireManager(GameState state, List<NewsItem> notes, string reason)
    {
        var c = state.Manager.Career!;
        c.Ending = new CareerEnding { Kind = "fired", Year = state.Year, Day = state.Day };
        int total = c.Wins + c.Losses;
        string wr = total > 0 ? DetMath.ToFixed1((double)c.Wins / total * 100) : "—";
        string teamName = state.MyTeamId != null && state.Teams.TryGetValue(state.MyTeamId, out var t) ? t.Name : "原东家";
        notes.Add(new NewsItem
        {
            Day = state.Day, Kind = "club", Important = true,
            Text = $"🔻 下课：{teamName} 解除了 {state.Manager.Name} 的主帅职务（{reason}）。任期 {c.Seasons} 赛季，战绩 {c.Wins}胜{c.Losses}负（胜率 {wr}%），冠军 {c.Titles} 座。",
        });
    }

    /// <summary>经理冠军计数（champTeamId 为我队才计）；kind 进分类账本（大满贯判定）。</summary>
    public static void NoteManagerTitle(GameState state, string champTeamId, string? kind = null)
    {
        var c = state.Manager.Career;
        if (c != null && c.Ending == null && champTeamId == state.MyTeamId)
        {
            c.Titles++;
            if (kind != null)
                c.TitleKinds[kind] = (c.TitleKinds.TryGetValue(kind, out var v) ? v : 0) + 1;
        }
    }

    /// <summary>跳槽目标市场：声望差距 ≤15 的 t1 队（非我队），按声望降序前 8。</summary>
    public static List<Team> JobOffers(GameState state)
    {
        int rep = state.Manager.Reputation;
        return state.Teams.Values
            .Where(t => t.Tier == 1 && t.Id != state.MyTeamId && t.Reputation <= rep + 15 && t.Reputation >= rep - 25)
            .OrderByDescending(t => t.Reputation)
            .Take(8)
            .ToList();
    }

    /// <summary>门下弟子数（跳槽背书；成就页数据源）：我队现役 overall ≥75 且属我培养。</summary>
    public static int DiscipleCount(GameState state)
    {
        if (state.MyTeamId == null) return 0;
        string my = state.MyTeamId;
        return state.Players.Values.Count(
            p => p.TeamId == my && p.Overall >= 75 && (p.Homegrown || p.Synthetic == "academy" || p.Synthetic == "rookie" || p.Track == "successor"));
    }

    /// <summary>申请执教（跳槽公式 + 门下弟子加成）：成功即切换俱乐部。</summary>
    public static (bool Ok, string Text) ApplyJob(GameState state, string teamId, Rng rng, List<NewsItem> notes)
    {
        if (!state.Teams.TryGetValue(teamId, out var target) || state.MyTeamId == null) return (false, "目标俱乐部不存在。");
        var c = state.Manager.Career;
        if (c?.Ending != null) return (false, "已离开教练席。");
        int rep = state.Manager.Reputation;
        double chance = Math.Min(0.9, Math.Max(0.05,
            0.1 + (rep - target.Reputation) * 0.011 + (c?.Titles ?? 0) * 0.03 + DiscipleCount(state) * 0.02 + (SkillGet(state.Manager.Skills, "negotiation") - 50) / 400.0));
        if (rng.Chance(chance))
        {
            string oldName = state.Teams[state.MyTeamId]?.Name ?? "原东家";
            state.MyTeamId = teamId;
            state.Manager.Reputation = (int)Math.Min(99, Math.Max(20, rep + 2));
            state.BoardConfidence = 60;
            state.Objective = null;
            if (c != null)
            {
                c.Warned = false;
                c.JobHops += 1; // 雇佣兵线成就数据源
            }
            notes.Add(new NewsItem
            {
                Day = state.Day, Kind = "club", Important = true,
                Text = $"🤝 {target.Name} 宣布新任主帅：{state.Manager.Name}（自 {oldName} 跳槽而来，签约成功）。",
            });
            return (true, $"签约成功：欢迎入主 {target.Name}。");
        }
        state.Manager.Reputation = (int)Math.Min(99, Math.Max(20, rep - 1));
        notes.Add(new NewsItem { Day = state.Day, Kind = "club", Text = $"📰 {target.Name} 拒绝了 {state.Manager.Name} 的执教申请。" });
        return (false, $"{target.Name} 礼貌回绝了你的申请（声望 -1）。");
    }

    /// <summary>翻年里程碑（五年之约 / 第 10 年强制退休）：在翻年块调用。</summary>
    public static void CheckCareerMilestone(GameState state, List<NewsItem> notes)
    {
        var c = state.Manager.Career;
        if (c == null || c.Ending != null) return;
        c.Seasons = state.Year - c.StartYear + 1;
        if (c.Seasons >= 10)
        {
            c.Ending = new CareerEnding { Kind = "retired", Year = state.Year, Day = state.Day };
            notes.Add(new NewsItem { Day = 1, Kind = "club", Important = true, Text = $"🎖 十年执教期满，{state.Manager.Name} 光荣退休——名人堂为其保留一席。" });
            return;
        }
        if (c.Seasons == 5 && !state.PendingEvents.Any(e => e.Uid == $"milestone-5-{state.Year}"))
        {
            state.PendingEvents.Add(new PendingEventCard
            {
                Uid = $"milestone-5-{state.Year}",
                CardId = MilestoneCardId,
                Title = "📜 五年之约",
                Text = "入主时的五年之约到期。可以选择继续追逐更高的荣誉，或在此刻画上句号、以名人堂身份收官。",
                Negative = false,
                Day = state.Day,
                Options =
                {
                    new PendingEventOption { Label = "继续执教（冲刺更多荣誉）", Result = "五年之约续期。" },
                    new PendingEventOption { Label = "就此收官（名人堂结局）", Result = "传奇谢幕。" },
                },
                Payload = new OrderedDict<string, object> { ["kind"] = "five-year" },
            });
        }
    }

    /// <summary>里程碑卡结算：五年之约（收官 → 名人堂结局）。</summary>
    public static (string Result, string Note) ResolveMilestoneCard(GameState state, PendingEventCard card, int optionIndex)
    {
        var c = state.Manager.Career;
        if (optionIndex == 1 && c != null && c.Ending == null)
        {
            c.Ending = new CareerEnding { Kind = "hall", Year = state.Year, Day = state.Day };
            return ($"📜 {state.Manager.Name} 宣布收官：{c.Seasons} 赛季 {c.Titles} 冠，名人堂席位已点亮。", "五年之约收官");
        }
        return ("五年之约续期：故事还在继续。", "");
    }
}
