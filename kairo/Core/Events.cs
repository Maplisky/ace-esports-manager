using System;
using System.Collections.Generic;
using System.Linq;

namespace Kairo.Core;

/// <summary>
/// 事件卡系统（GDD §9.3 v0.5-2）— C# 移植自 ace/src/core/sim/events.ts（权威实现）。
/// 每日抽取 0-3 张（35% 基础 + 空 6 天保底）· 负面卡 14 天抑制器 · 生日事件。
/// 退役/选秀/里程碑卡结算依赖 retirement/draft/career 模块（移植时补专属分支）。
/// </summary>
public static class Events
{
    private static string Fill(string text, string ign, string teamName) =>
        text.Replace("{ign}", ign).Replace("{teamName}", teamName);

    private static string InstUid(GameState state, string cardId, string pid) =>
        $"E{state.Year}_{state.Day}_{cardId}_{pid}";

    private static void SpawnCard(GameState state, Rng rng, EventPool.CardDef def, Player p, Team team)
    {
        var card = new PendingEventCard
        {
            Uid = InstUid(state, def.Id, p.Id),
            CardId = def.Id,
            Title = def.Title,
            Text = Fill(def.Text, p.Ign, team.Name),
            Negative = def.Negative,
            TargetPlayerId = p.Id,
            Day = state.Day,
        };
        foreach (var o in def.Options)
        {
            card.Options.Add(new PendingEventOption
            {
                Label = Fill(o.Label, p.Ign, team.Name),
                Result = Fill(o.Result, p.Ign, team.Name),
                Morale = o.Morale, TeamMorale = o.TeamMorale, Budget = o.Budget,
                Reputation = o.Reputation, Trust = o.Trust, Grievance = o.Grievance,
                Fatigue = o.Fatigue, Bond = o.Bond, BoardConfidence = o.BoardConfidence,
            });
        }
        state.PendingEvents.Add(card);
    }

    /// <summary>每日事件抽取（advanceDay 调用）：队列上限 4，基础 35%，空 6 天保底 1 张。</summary>
    public static void SpawnDailyEvents(GameState state, Rng rng)
    {
        var myTeam = state.MyTeamId != null && state.Teams.TryGetValue(state.MyTeamId, out var mt) ? mt : null;
        if (myTeam == null) return;
        var roster = myTeam.Roster
            .Select(id => state.Players.TryGetValue(id, out var p) ? p : null)
            .Where(p => p != null && p.InjuredUntilDay <= state.Day)
            .Cast<Player>()
            .ToList();
        if (roster.Count == 0) return;

        int idleDays = state.Day - state.LastEventDay;
        bool starved = idleDays >= 6;
        // Deadline Day：转会窗最后 3 天事件密度 ×2（阈值 0.35→0.55，单日上限 3→6）
        bool deadlineSoon = Transfer.TransferWindows.Any(w => state.Day >= w[1] - 2 && state.Day <= w[1]);
        int draws = 0;
        if (starved)
        {
            draws = 1;
        }
        else
        {
            double threshold = deadlineSoon ? 0.55 : 0.35;
            int cap = deadlineSoon ? 6 : 3;
            double roll = rng.Next();
            while (roll < threshold && draws < cap && state.PendingEvents.Count + draws < (deadlineSoon ? 6 : 4))
            {
                draws++;
                roll = rng.Next();
            }
        }
        if (draws == 0) return;

        for (int i = 0; i < draws; i++)
        {
            if (state.PendingEvents.Count >= 4) break;
            var p = rng.Pick(roster);
            // 负面卡抑制器：该选手 14 天内当过负面主角 → 只从正面卡里抽（权重置 0 后加权选取）
            bool suppress = state.Day - p.LastEventDay < 14;
            int pickIdx = rng.WeightedIndex(EventPool.Pool.Select(d => (double)(d.Negative && suppress ? 0 : d.Weight)).ToList());
            var def = EventPool.Pool[pickIdx];
            if (def.Negative && suppress) def = EventPool.Pool[0]; // 兜底：全被抑制时取第一张正面卡
            SpawnCard(state, rng, def, p, myTeam);
            if (def.Negative) p.LastEventDay = state.Day;
            state.LastEventDay = state.Day;
        }
    }

    /// <summary>生日事件：当日生日的我队选手生成祝福卡（uid 含年份，天然一年一次）。</summary>
    public static void SpawnBirthdays(GameState state)
    {
        var myTeam = state.MyTeamId != null && state.Teams.TryGetValue(state.MyTeamId, out var mt) ? mt : null;
        if (myTeam == null) return;
        foreach (var pid in myTeam.Roster)
        {
            if (!state.Players.TryGetValue(pid, out var p) || p.BirthdayDay != state.Day) continue;
            string uid = $"BD_{state.Year}_{p.Id}";
            if (state.PendingEvents.Any(e => e.Uid == uid)) continue;
            state.PendingEvents.Add(new PendingEventCard
            {
                Uid = uid,
                CardId = "birthday",
                Title = $"🎂 {p.Ign} 的生日",
                Text = $"今天 {p.Ign} 满 {p.Age} 岁。更衣室里已经有人偷偷准备惊喜了——要不要表示一下？",
                Negative = false,
                TargetPlayerId = p.Id,
                Day = state.Day,
                Options =
                {
                    new PendingEventOption { Label = "口头祝福", Result = "一句“生日快乐”，{ign} 笑着说“谢谢教练”。", Morale = 2 },
                    new PendingEventOption { Label = "送小礼物（$200）", Result = "一份精致的小礼物，{ign} 很感动（士气 +5）。", Morale = 5, Budget = -200 },
                    new PendingEventOption { Label = "组织全队庆祝（$2,500）", Result = "更衣室小型派对：蛋糕、合影、闹到很晚。全队士气 +2。", TeamMorale = 2, Bond = 2, Budget = -2500 },
                },
            });
        }
    }

    /// <summary>结算事件卡：应用选项效果并移出队列。返回结果文本（含目标名）。
    /// 退役/选秀/里程碑卡走专属结算（数值效果系统无法表达），先出队再结算——对齐 TS resolveEvent 路由序。</summary>
    public static (string Result, string Note)? ResolveEvent(GameState state, string uid, int optionIndex, Rng rng)
    {
        int idx = state.PendingEvents.FindIndex(e => e.Uid == uid);
        if (idx < 0) return null;
        var card = state.PendingEvents[idx];
        if (card.CardId == Retirement.RetireCardId)
        {
            state.PendingEvents.RemoveAt(idx);
            var r = Retirement.ResolveRetireCard(state, card, optionIndex, rng);
            return r;
        }
        if (card.CardId == Draft.DraftCardId)
        {
            state.PendingEvents.RemoveAt(idx);
            var d = Draft.ResolveDraftCard(state, card, optionIndex);
            return (d.Result, d.Note);
        }
        if (card.CardId == Career.MilestoneCardId)
        {
            state.PendingEvents.RemoveAt(idx);
            var m = Career.ResolveMilestoneCard(state, card, optionIndex);
            return (m.Result, m.Note);
        }
        if (optionIndex < 0 || optionIndex >= card.Options.Count) return null;
        var opt = card.Options[optionIndex];
        var myTeam = state.MyTeamId != null && state.Teams.TryGetValue(state.MyTeamId, out var mt) ? mt : null;
        var target = card.TargetPlayerId != null && state.Players.TryGetValue(card.TargetPlayerId, out var tp) ? tp : null;
        // 目标已离队（转会/解约）→ 选手向效果作废，卡仍按俱乐部层结算移出
        bool targetOnMyTeam = target != null && target.TeamId == state.MyTeamId;

        if (opt.Morale.HasValue && target != null && targetOnMyTeam)
            target.Morale = Math.Min(100, Math.Max(10, target.Morale + opt.Morale.Value));
        if (card.Negative && target != null) target.LastEventDay = state.Day; // 负面抑制器起点
        if (opt.TeamMorale.HasValue && myTeam != null)
        {
            foreach (var pid in myTeam.Roster)
            {
                if (state.Players.TryGetValue(pid, out var p))
                    p.Morale = Math.Min(100, Math.Max(10, p.Morale + opt.TeamMorale.Value));
            }
        }
        if (opt.Budget.HasValue && myTeam != null)
        {
            myTeam.Budget += opt.Budget.Value;
            Finance.LogFinance(state, $"事件 · {card.Title}", opt.Budget.Value);
        }
        if (opt.Reputation.HasValue && myTeam != null)
            myTeam.Reputation = (int)Math.Min(99, Math.Max(20, myTeam.Reputation + opt.Reputation.Value));
        if (opt.Bond.HasValue && myTeam != null)
            teamBond(myTeam, opt.Bond.Value);
        if (opt.Fatigue.HasValue && target != null && targetOnMyTeam)
            target.Fatigue = Math.Min(100, Math.Max(0, target.Fatigue + opt.Fatigue.Value));
        if (opt.BoardConfidence.HasValue)
            state.BoardConfidence = (int)Math.Min(100, Math.Max(0, state.BoardConfidence + opt.BoardConfidence.Value));

        state.PendingEvents.RemoveAt(idx);
        state.LastEventDay = state.Day;
        string result = Fill(opt.Result, target?.Ign ?? "", myTeam?.Name ?? "");
        if (target != null && !targetOnMyTeam) result += "（注：他已离队，选手向效果作废。）";
        return (result, $"【{card.Title}】{result}");
    }

    private static void teamBond(Team team, int delta) => team.Bond = Math.Min(100, Math.Max(0, team.Bond + delta));
}
