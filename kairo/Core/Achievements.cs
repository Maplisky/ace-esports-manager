using System;
using System.Collections.Generic;
using Kairo.Core;

namespace Kairo.Core;

/// <summary>
/// 成就系统（v1.0-10，GDD §10.4 v2.5 剧本路径）：四条剧本线 + 跨路径通用层。
/// 判定只读既有账本（career / retireLog / lastDraft / 球员标记），机制零新增。
/// TS 权威：ace/src/core/sim/achievements.ts。
/// </summary>
public static class Achievements
{
    public sealed class AchievementDef
    {
        public string Id { get; set; } = "";
        public string Path { get; set; } = "";
        public string Name { get; set; } = "";
        public string Desc { get; set; } = "";
        /// <summary>路径终点史诗</summary>
        public bool Epic { get; set; }
        public Func<GameState, bool> Check { get; set; } = _ => false;
    }

    public static readonly IReadOnlyDictionary<string, string> PathLabel = new Dictionary<string, string>
    {
        ["general"] = "通用", ["rebuilder"] = "重建者", ["dynasty"] = "王朝缔造者", ["academy"] = "青训教父", ["mercenary"] = "雇佣兵",
    };

    /// <summary>我队亲手培养的弟子中最高 overall（青训/选秀/接班人标记）。</summary>
    private static int BestDiscipleOverall(GameState s)
    {
        if (s.MyTeamId == null) return 0;
        int best = 0;
        foreach (var p in s.Players.Values)
        {
            if (p.TeamId != s.MyTeamId) continue;
            if (p.Homegrown || p.Synthetic == "academy" || p.Synthetic == "rookie" || p.Track == "successor")
                best = Math.Max(best, p.Overall);
        }
        return best;
    }

    /// <summary>我队最近一届选中的新秀最高潜力。</summary>
    private static int BestDraftPotential(GameState s)
    {
        if (s.MyTeamId == null) return 0;
        int best = 0;
        var picks = s.LastDraft?.Picks ?? new List<DraftPickRow>();
        foreach (var x in picks)
        {
            if (x.TeamId != s.MyTeamId || x.PlayerId == "") continue;
            if (s.Players.TryGetValue(x.PlayerId, out var p)) best = Math.Max(best, p.Potential);
        }
        return best;
    }

    private static ManagerCareer? CareerOf(GameState s) => s.Manager.Career;

    private static int Kinds(ManagerCareer? c, string kind) =>
        c != null && c.TitleKinds.TryGetValue(kind, out var v) ? v : 0;

    public static readonly AchievementDef[] List =
    {
        // ---- 通用层（跨路径） ----
        new() { Id = "g-firstwin", Path = "general", Name = "首胜", Desc = "赢下执教生涯第一场正式比赛", Check = s => (CareerOf(s)?.Wins ?? 0) >= 1 },
        new() { Id = "g-firsttitle", Path = "general", Name = "首冠", Desc = "捧起执教生涯第一座奖杯", Check = s => (CareerOf(s)?.Titles ?? 0) >= 1 },
        new()
        {
            Id = "g-slam", Path = "general", Name = "生涯大满贯", Epic = true,
            Desc = "联赛、Masters、Champions 冠军各至少一座（分类账本 v1.0-10 起记录；旧档夺冠不计入分类）",
            Check = s => Kinds(CareerOf(s), "league") >= 1 && Kinds(CareerOf(s), "masters") >= 1 && Kinds(CareerOf(s), "champions") >= 1,
        },
        new() { Id = "g-decade", Path = "general", Name = "十年执教", Desc = "在教练席上度过十个赛季", Check = s => (CareerOf(s)?.Seasons ?? 0) >= 10 },

        // ---- 重建者：接手低谷，把队伍拉起来 ----
        new() { Id = "r-hundred", Path = "rebuilder", Name = "百战老兵", Desc = "执教满 100 场正式比赛", Check = s => (CareerOf(s)?.Wins ?? 0) + (CareerOf(s)?.Losses ?? 0) >= 100 },
        new()
        {
            Id = "r-steady", Path = "rebuilder", Name = "稳定器", Desc = "执教 60 场以上且胜率 ≥60%",
            Check = s => { var c = CareerOf(s); int n = (c?.Wins ?? 0) + (c?.Losses ?? 0); return n >= 60 && c!.Wins / (double)Math.Max(1, n) >= 0.6; },
        },
        new() { Id = "r-comeback", Path = "rebuilder", Name = "绝境翻盘", Desc = "吃过董事会最后通牒之后仍然夺冠", Check = s => CareerOf(s)?.Warned == true && (CareerOf(s)?.Titles ?? 0) >= 1 },
        new() { Id = "r-phoenix", Path = "rebuilder", Name = "凤凰涅槃", Epic = true, Desc = "警告后续命并累计三冠", Check = s => CareerOf(s)?.Warned == true && (CareerOf(s)?.Titles ?? 0) >= 3 },

        // ---- 王朝缔造者：赢，然后一直赢 ----
        new() { Id = "d-defend", Path = "dynasty", Name = "卫冕", Desc = "累计两座奖杯", Check = s => (CareerOf(s)?.Titles ?? 0) >= 2 },
        new() { Id = "d-intl", Path = "dynasty", Name = "国际舞台", Desc = "夺得 Masters 或 Champions 冠军", Check = s => Kinds(CareerOf(s), "masters") + Kinds(CareerOf(s), "champions") >= 1 },
        new() { Id = "d-threepeat", Path = "dynasty", Name = "三冠王朝", Desc = "累计三座奖杯", Check = s => (CareerOf(s)?.Titles ?? 0) >= 3 },
        new() { Id = "d-dynasty", Path = "dynasty", Name = "王朝缔造者", Epic = true, Desc = "累计五座奖杯", Check = s => (CareerOf(s)?.Titles ?? 0) >= 5 },

        // ---- 青训教父：亲手把年轻人带成明星 ----
        new() { Id = "a-gold", Path = "academy", Name = "点石成金", Desc = "亲手培养出一名 overall ≥75 的弟子（青训/选秀/接班人）", Check = s => Career.DiscipleCount(s) >= 1 },
        new() { Id = "a-pipeline", Path = "academy", Name = "青训流水线", Desc = "同时拥有三名 ≥75 的亲传弟子", Check = s => Career.DiscipleCount(s) >= 3 },
        new() { Id = "a-eye", Path = "academy", Name = "选秀眼光", Desc = "选中的新秀潜力 ≥86", Check = s => BestDraftPotential(s) >= 86 },
        new() { Id = "a-legacy", Path = "academy", Name = "一城终身", Epic = true, Desc = "亲手带出 overall ≥85 的巨星且为俱乐部夺冠（选手与教头的双重荣耀）", Check = s => BestDiscipleOverall(s) >= 85 && (CareerOf(s)?.Titles ?? 0) >= 1 },

        // ---- 雇佣兵：履历就是武器 ----
        new() { Id = "m-hop", Path = "mercenary", Name = "跳槽达人", Desc = "成功跳槽一次", Check = s => (CareerOf(s)?.JobHops ?? 0) >= 1 },
        new() { Id = "m-tour", Path = "mercenary", Name = "名帅巡回", Desc = "累计跳槽两次", Check = s => (CareerOf(s)?.JobHops ?? 0) >= 2 },
        new() { Id = "m-rep", Path = "mercenary", Name = "名满江湖", Desc = "个人声望 ≥85", Check = s => s.Manager.Reputation >= 85 },
        new() { Id = "m-fireman", Path = "mercenary", Name = "救火专家", Epic = true, Desc = "三次跳槽仍在执教", Check = s => (CareerOf(s)?.JobHops ?? 0) >= 3 },
    };

    /// <summary>评估并解锁（幂等）：worker 在日推进与比赛结算后调用；新解锁进新闻流。</summary>
    public static int EvaluateAchievements(GameState state, List<NewsItem> notes)
    {
        var unlocked = state.Achievements;
        var c = state.Manager.Career;
        if (c == null) return 0;
        // 终局后世界冻结、不再推进，但「十年执教」恰在第 10 年退休时点亮——不做 ending 早退
        int n = 0;
        foreach (var def in List)
        {
            if (unlocked.ContainsKey(def.Id)) continue;
            bool ok;
            try
            {
                ok = def.Check(state);
            }
            catch
            {
                ok = false;
            }
            if (ok)
            {
                unlocked[def.Id] = new AchievementUnlock { Year = state.Year, Day = state.Day };
                n++;
                notes.Add(new NewsItem
                {
                    Day = state.Day,
                    Kind = "club",
                    Important = def.Epic,
                    Text = $"🏆 解锁成就{(def.Epic ? "（史诗）" : "")}：「{def.Name}」——{def.Desc}",
                });
            }
        }
        return n;
    }
}
