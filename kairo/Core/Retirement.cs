using System;
using System.Collections.Generic;
using System.Linq;
using Kairo.Core;

namespace Kairo.Core;

/// <summary>
/// 退役与转教练（v1.0-1，GDD §6.5/§8.3）：赛季末退役检定（年龄≥29 概率公式）→ 劝留对话
/// → 退役分流（执教意愿检定 → 教练自由池；高名望 → 解说；否则淡出）。
/// 一切随机走显式 Rng。TS 权威：ace/src/core/sim/retirement.ts。
/// </summary>
public static class Retirement
{
    /// <summary>名望折算（GDD §8.3：MVP/冠军/实力）。</summary>
    public static int FameOf(Player p) =>
        (int)MathUtil.Clamp(DetMath.JsRound(p.Career.Titles * 7 + p.Career.Mvps * 0.6 + (p.Overall - 70) * 0.8 + (p.Career.FirstKills > 300 ? 6 : 0)), 5, 100);

    /// <summary>教练能力折算：沟通 0.5 + 名望 0.2 + 冠军 3 + MVP 1.2 + 指挥 +6。</summary>
    public static int CoachValueOf(Player p)
    {
        int fame = FameOf(p);
        return (int)MathUtil.Clamp(DetMath.JsRound(p.Attrs.Communication * 0.5 + fame * 0.2 + p.Career.Titles * 3 + p.Career.Mvps * 1.2 + (p.IsIgl ? 6 : 0)), 25, 95);
    }

    /// <summary>退役检定概率（GDD §6.5）。</summary>
    public static double RetireProb(Player p)
    {
        double ambition = p.Ambition;
        double decline = Math.Max(0, p.Age - 31) * 0.04;
        return MathUtil.Clamp(0.08 + (p.Age - 29) * 0.06 + decline - p.Career.Titles * 0.03 - (ambition - 50) * 0.002, 0.02, 0.85);
    }

    private static void Feed(GameState state, string kind, string text)
    {
        // TS 权威：transferFeed 条目不落 important（入参 important 被忽略）——保持缺省省键语义
        state.TransferFeed.Add(new TransferFeedItem { Day = state.Day, Year = state.Year, Kind = kind, Text = text });
        if (state.TransferFeed.Count > 300) state.TransferFeed.RemoveRange(0, state.TransferFeed.Count - 300);
    }

    private static string FameTierPath(int fame, bool intentPass)
    {
        if (intentPass) return "coach";
        return fame >= 68 ? "media" : "fade";
    }

    public const string RetireCardId = "retire";

    /// <summary>执行退役：移出名单 → 意愿检定分流 → 名册补位 → 留档。ceremony=举办退役仪式。</summary>
    private static void ExecuteRetirement(GameState state, Player p, Rng rng, bool ceremony, List<NewsItem>? notes)
    {
        var team = p.TeamId != null && state.Teams.TryGetValue(p.TeamId, out var t0) ? t0 : null;
        string? teamName = team?.Name;
        if (team != null)
        {
            team.Roster = team.Roster.Where(id => id != p.Id).ToList();
            team.Starters = team.Starters.Where(id => id != p.Id).ToList();
            if (ceremony)
            {
                foreach (var pid in team.Roster)
                {
                    if (state.Players.TryGetValue(pid, out var q)) q.Morale = MathUtil.Clamp(q.Morale + 3, 10, 100);
                }
            }
            // 名册补位：签一名不高于队伍水平的自由人（避免 AI 永久残阵）
            if (team.Id != state.MyTeamId)
            {
                var fas = state.Players.Values.Where(x => x.TeamId == null && !x.Homegrown).ToList();
                if (fas.Count > 0)
                {
                    double avg = 0;
                    foreach (var id in team.Roster) avg += state.Players.TryGetValue(id, out var rp) ? rp.Overall : 0;
                    avg /= Math.Max(1, team.Roster.Count);
                    var pick = fas.Where(x => x.Overall <= avg + 5).OrderByDescending(x => x.Overall).FirstOrDefault()
                        ?? fas.OrderByDescending(x => x.Overall).First();
                    pick.TeamId = team.Id;
                    pick.PromisedRole = "rotation";
                    pick.Salary = (int)DetMath.JsRound(MathUtil.Clamp(pick.Overall * 900, 40_000, 900_000));
                    team.Roster.Add(pick.Id);
                }
            }
        }

        // 执教意愿检定（GDD §8.3）：沟通 + 冠军 + 指挥/母队加成
        int fame = FameOf(p);
        double intent = p.Attrs.Communication + Math.Min(30, p.Career.Titles * 4) + (p.IsIgl ? 12 : 0) + (p.Homegrown && team != null ? 6 : 0);
        bool intentPass = rng.Chance(MathUtil.Clamp(intent / 150.0 + 0.15, 0.2, 0.92));
        string path = FameTierPath(fame, intentPass);

        if (path == "coach")
        {
            state.CoachPool.Add(new CoachFreeAgent
            {
                Id = "coach_" + p.Id,
                Name = p.Ign,
                Fame = fame,
                Comm = p.Attrs.Communication,
                Titles = p.Career.Titles,
                Mvps = p.Career.Mvps,
                IsIgl = p.IsIgl,
                HomegrownClubId = p.Homegrown ? team?.Id : null,
                RetiredYear = state.Year,
                Value = CoachValueOf(p),
            });
        }

        string newsText = path == "coach"
            ? $"📋 {p.Ign} 宣布退役并以教练身份加入教练自由池（执教潜力 {CoachValueOf(p)}）。"
            : path == "media"
                ? $"🎙 {p.Ign} 宣布退役，转型解说/主播（名望 {fame}）。"
                : $"{p.Ign} 宣布退役，告别赛场。";
        Feed(state, "retire", newsText);
        notes?.Add(new NewsItem { Day = 1, Kind = "transfer", Important = path == "coach" && team != null, Text = newsText });

        var entry = new RetireLogItem
        {
            Year = state.Year,
            Ign = p.Ign,
            Name = p.Ign,
            Age = p.Age,
            Titles = p.Career.Titles,
            Mvps = p.Career.Mvps,
            Overall = p.Overall,
            Path = path,
            TeamName = teamName,
            CoachId = path == "coach" ? "coach_" + p.Id : null,
        };
        state.RetireLog.Add(entry);
        Narrative.NarrativeOnRetire(state, entry, notes ?? new List<NewsItem>()); // 名宿告别巡演（v1.5）：我队功勋末季文案
        if (p.TeamId != null && state.Teams.TryGetValue(p.TeamId, out var owner))
        {
            owner.Roster = owner.Roster.Where(id => id != p.Id).ToList();
            owner.Starters = owner.Starters.Where(id => id != p.Id).ToList();
        }
        state.Players.Remove(p.Id);
    }

    /// <summary>赛季末退役检定（App 翻年块调用）：本队出劝留对话卡，AI 自动决策；随后 AI 签教练。</summary>
    public static void SeasonRetirements(GameState state, Rng rng, List<NewsItem> notes)
    {
        foreach (var p in state.Players.Values.ToList())
        {
            if (p.TeamId == null || p.Age < 29) continue;
            if (!rng.Chance(RetireProb(p))) continue;
            var team = state.Teams[p.TeamId];
            if (team.Id == state.MyTeamId)
            {
                // 本队：劝留对话事件卡（选手留队待决，不立即移除）
                state.PendingEvents.Add(new PendingEventCard
                {
                    Uid = $"retire_{p.Id}_{state.Year}",
                    CardId = RetireCardId,
                    Title = $"退役劝留 · {p.Ign}",
                    Text = $"{p.Ign}（{p.Age} 岁，{p.Career.Titles} 冠 / {p.Career.Mvps} MVP）宣布考虑退役。管理层需要给出态度——沟通技巧将决定这位{(p.IsIgl ? "指挥" : "老将")}的去留。",
                    Negative = false,
                    TargetPlayerId = p.Id,
                    Day = state.Day,
                    Options =
                    {
                        new PendingEventOption { Label = $"加薪 30% 留队（${(int)DetMath.JsRound(p.Salary * 0.3 / 1000.0)}K/季）", Result = "" },
                        new PendingEventOption { Label = "转导师型替补", Result = "" },
                        new PendingEventOption { Label = "放上挂牌名单", Result = "" },
                        new PendingEventOption { Label = "举办退役仪式", Result = "" },
                        new PendingEventOption { Label = "深夜长谈", Result = "" },
                    },
                });
                continue;
            }
            // AI 队：预算充裕时 40% 概率加薪续约，否则退役 + 自动补位
            if (team.Budget > p.Salary * 4 && rng.Chance(0.4))
            {
                team.Budget -= p.Salary * 0.3;
                p.Salary = (int)DetMath.JsRound(p.Salary * 1.3);
                notes.Add(new NewsItem { Day = 1, Kind = "transfer", Text = $"📝 {team.Name} 加薪续约留住 {p.Ign}（{p.Age} 岁）。" });
                continue;
            }
            ExecuteRetirement(state, p, rng, ceremony: false, notes);
        }

        // AI 教练签约：空槽位按概率从自由池签入（同生态）
        foreach (var t in state.Teams.Values)
        {
            if (t.Id == state.MyTeamId) continue;
            foreach (var slot in new[] { "training", "mapTactics", "match" })
            {
                if (SlotOf(t.Staff, slot) != null) continue;
                if (state.CoachPool.Count == 0) break;
                if (!rng.Chance(0.22)) continue;
                var best = state.CoachPool.OrderByDescending(c => c.Value).First();
                SetSlot(t.Staff, slot, new StaffSlot { Name = best.Name, Value = best.Value });
                state.CoachPool = state.CoachPool.Where(c => c.Id != best.Id).ToList();
                notes.Add(new NewsItem { Day = 1, Kind = "transfer", Text = $"🎙 {t.Name} 邀请退役名将 {best.Name} 出任{(slot == "training" ? "训练" : slot == "mapTactics" ? "地图战术" : "比赛")}教练（能力 {best.Value}）。" });
            }
        }
    }

    private static StaffSlot? SlotOf(StaffSlots staff, string slot) => slot switch
    {
        "training" => staff.Training,
        "mapTactics" => staff.MapTactics,
        _ => staff.Match,
    };

    private static void SetSlot(StaffSlots staff, string slot, StaffSlot? value)
    {
        if (slot == "training") staff.Training = value;
        else if (slot == "mapTactics") staff.MapTactics = value;
        else staff.Match = value;
    }

    /// <summary>劝留对话结算（events.resolveEvent 按 cardId=retire 截断路由到这里）。</summary>
    public static (string Result, string Note) ResolveRetireCard(GameState state, PendingEventCard card, int optionIndex, Rng rng)
    {
        var p = card.TargetPlayerId != null && state.Players.TryGetValue(card.TargetPlayerId, out var tp) ? tp : null;
        if (p == null || p.TeamId == null) return ("该选手已离队，劝留无效。", "");
        var myTeam = state.Teams[state.MyTeamId!];
        var mgr = state.Manager.Skills;
        string Note(string s) => $"{p.Ign}：{s}";
        (string Result, string Note) SuccessText(string what) => ($"{p.Ign} 接受{what}，留队！", Note($"{what}成功"));
        // 挽留失败 → 退役：收集告别巡演等叙事新闻并入卡片 note
        (string Result, string Note) RetireNow(string resultTail, string noteKey)
        {
            var extra = new List<NewsItem>();
            ExecuteRetirement(state, p, rng, ceremony: false, extra);
            return ($"{p.Ign} {resultTail}", string.Join(" ", new[] { Note(noteKey) }.Concat(extra.Select(e => e.Text))));
        }

        switch (optionIndex)
        {
            case 0:
            { // 加薪 30%
                double chance = MathUtil.Clamp(0.3 + mgr.Negotiation / 250.0 + mgr.Locker / 250.0, 0.15, 0.9);
                if (rng.Chance(chance))
                {
                    myTeam.Budget = Math.Max(0, myTeam.Budget - p.Salary * 0.3);
                    p.Salary = (int)DetMath.JsRound(p.Salary * 1.3);
                    p.Morale = MathUtil.Clamp(p.Morale + 6, 10, 100);
                    var ok = SuccessText("加薪续约");
                    return (ok.Result + "（薪水上浮 30%。）", ok.Note);
                }
                return RetireNow("他婉拒了加薪：「钱不是全部。」还是挂靴了。", "加薪挽留失败");
            }
            case 1:
            { // 转导师型替补
                double chance = MathUtil.Clamp(0.55 + (p.Traits.Contains("enabler") ? 0.12 : 0), 0.3, 0.85);
                if (rng.Chance(chance))
                {
                    p.PromisedRole = "bench";
                    p.Track = "mentor";
                    p.MentorSince = state.Year;
                    p.Morale = MathUtil.Clamp(p.Morale + 4, 10, 100);
                    return SuccessText("转任导师型替补");
                }
                return RetireNow("他摇头：「我还想打主力。」谈判破裂，就此挂靴。", "导师转型失败");
            }
            case 2: // 挂牌
                p.Listed = true;
                p.ListedWeeks = 0;
                p.Morale = MathUtil.Clamp(p.Morale - 3, 10, 100);
                return ($"{p.Ign} 被放上挂牌名单，暂缓退役。", Note("挂牌"));
            case 3:
            { // 退役仪式
                myTeam.Budget = Math.Max(0, myTeam.Budget - 80_000);
                state.BoardConfidence = (int)MathUtil.Clamp(state.BoardConfidence + 2, 0, 100);
                foreach (var pid in myTeam.Roster)
                {
                    if (state.Players.TryGetValue(pid, out var q)) q.Morale = MathUtil.Clamp(q.Morale + 3, 10, 100);
                }
                ExecuteRetirement(state, p, rng, ceremony: true, null);
                return ($"{p.Ign} 的退役仪式星光熠熠——全队与观众起立致敬。声誉与凝聚力 +。", Note("退役仪式"));
            }
            default:
            { // 深夜长谈
                double chance = MathUtil.Clamp(0.4 + p.Attrs.Communication / 300.0, 0.25, 0.8);
                if (rng.Chance(chance))
                {
                    p.Morale = MathUtil.Clamp(p.Morale + 8, 10, 100);
                    return SuccessText("深夜长谈");
                }
                return RetireNow("去意已决（长谈到凌晨也没有结果）。", "深谈失败");
            }
        }
    }

    /// <summary>签约教练自由池选手到教练组槽位（替换允许）。返回 null = 成功。</summary>
    public static string? SignCoach(GameState state, string coachId, string slot)
    {
        var team = state.MyTeamId != null && state.Teams.TryGetValue(state.MyTeamId, out var t) ? t : null;
        if (team == null) return "无俱乐部";
        int idx = state.CoachPool.FindIndex(c => c.Id == coachId);
        if (idx < 0) return "该教练已被签走";
        var c = state.CoachPool[idx];
        // 顶替：原槽位教练回流自由池（v1.x：支持换人与解雇的闭环）
        var cur = SlotOf(team.Staff, slot);
        if (cur?.CoachId != null)
        {
            var origin = state.CoachPool.FirstOrDefault(x => x.Id == cur.CoachId);
            if (origin != null) origin.Value = cur.Value; // 在岗期间能力可能成长，回池同步
            else state.CoachPool.Add(new CoachFreeAgent { Id = cur.CoachId, Name = cur.Name, Fame = 50, Comm = cur.Value, Titles = 0, Mvps = 0, IsIgl = false, HomegrownClubId = team.Id, RetiredYear = state.Year, Value = cur.Value });
        }
        SetSlot(team.Staff, slot, new StaffSlot { Name = c.Name, Value = c.Value, CoachId = c.Id });
        state.CoachPool.RemoveAt(idx);
        return null;
    }

    /// <summary>解雇教练（v1.x 用户反馈）：回自由池 + 声望 -1；本人上限回落 2（离岗生疏）。零 RNG。</summary>
    public static string FireCoach(GameState state, string slot)
    {
        var team = state.MyTeamId != null && state.Teams.TryGetValue(state.MyTeamId, out var t) ? t : null;
        if (team == null) return "无俱乐部";
        var cur = SlotOf(team.Staff, slot);
        if (cur == null) return "该位置本来就空缺。";
        var origin = cur.CoachId != null ? state.CoachPool.FirstOrDefault(x => x.Id == cur.CoachId) : null;
        if (origin != null)
        {
            origin.Value = Math.Max(40, cur.Value - 2);
        }
        else
        {
            state.CoachPool.Add(new CoachFreeAgent { Id = cur.CoachId ?? "coach_fired_" + slot + "_" + state.Day, Name = cur.Name, Fame = 50, Comm = cur.Value, Titles = 0, Mvps = 0, IsIgl = false, HomegrownClubId = team.Id, RetiredYear = state.Year, Value = Math.Max(40, cur.Value - 2) });
        }
        SetSlot(team.Staff, slot, null);
        state.Manager.Reputation = (int)MathUtil.Clamp((state.Manager.Reputation) - 1, 20, 99);
        return $"{cur.Name} 已解约（声望 -1）。他回到了教练自由池。";
    }

    /// <summary>教练身价（参考补偿金）：主数值 × 2200——value 70 ≈ $154K。</summary>
    public static int CoachCompensation(int value) => (int)DetMath.JsRound(value * 2200 / 1000.0) * 1000;

    /// <summary>
    /// 挖角他队教练（v1.x 用户反馈）：补偿金付给原俱乐部；
    /// 失败：补偿金照付、声望 -1；成功：教练入槽（原队槽位清空），能力 -1。
    /// </summary>
    public static string PoachCoach(GameState state, string fromTeamId, string slot, int offer, Rng rng)
    {
        var team = state.MyTeamId != null && state.Teams.TryGetValue(state.MyTeamId, out var t) ? t : null;
        var from = state.Teams.GetValueOrDefault(fromTeamId);
        if (team == null || from == null) return "俱乐部不存在。";
        if (fromTeamId == state.MyTeamId) return "那是你自己的教练组。";
        var cur = SlotOf(from.Staff, slot);
        if (cur == null) return $"{from.Name} 的这个位置本来就空缺。";
        int comp = CoachCompensation(cur.Value);
        if (offer < comp) return $"补偿金低于参考身价（{FmtMoney(comp)}）——对方直接拒绝接触。";
        if (team.Budget < offer) return "俱乐部资金不足以支付这笔补偿金。";
        team.Budget -= offer;
        from.Budget += offer;
        Finance.LogFinance(state, $"事件 · 挖角教练补偿金（付 {from.Name}）", -offer);
        state.Manager.Reputation = (int)MathUtil.Clamp(state.Manager.Reputation - 1, 20, 99);
        double mult = offer / (double)Math.Max(1, comp);
        double repDiff = (state.Manager.Reputation - from.Reputation) * 0.004;
        double chance = MathUtil.Clamp(0.25 + (mult - 1.6) * 0.5 + repDiff + (state.Manager.Skills.Negotiation - 50) * 0.004, 0.1, 0.92);
        if (!rng.Chance(chance))
        {
            return $"挖角未遂：{from.Name} 收下补偿金后仍不放人，{cur.Name} 选择留任（声望 -1）。";
        }
        SetSlot(from.Staff, slot, null);
        SetSlot(team.Staff, slot, new StaffSlot { Name = cur.Name, Value = Math.Max(40, cur.Value - 1) });
        return $"挖角成功：{cur.Name}（能力 {cur.Value}）加盟你的教练组{(mult >= 2 ? "（溢价签下，即插即用）" : "")}。原队怒不可遏。";
    }

    private static string FmtMoney(double v) =>
        v >= 1_000_000 ? $"${DetMath.ToFixed2(v / 1_000_000)}M" : $"${(int)DetMath.JsRound(v / 1000)}K";
}
