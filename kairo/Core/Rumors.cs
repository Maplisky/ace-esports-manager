using System;
using System.Collections.Generic;
using System.Linq;

namespace Kairo.Core;

/// <summary>
/// 转会传闻与意向生态（v1.x）— C# 移植自 ace/src/core/sim/rumors.ts（权威实现）。
/// 全部确定性（显式 Rng）、零新状态（feed 即账本）。
/// </summary>
public static class Rumors
{
    private static string RumorLabel(int c) => c switch { 1 => "绯闻", 2 => "有消息称", 3 => "谈判中", _ => "" };

    private static void PushFeed(GameState state, TransferFeedItem item)
    {
        state.TransferFeed.Add(item);
        if (state.TransferFeed.Count > 300)
            state.TransferFeed.RemoveRange(0, state.TransferFeed.Count - 300);
    }

    /// <summary>战绩口径：我方全部赛程胜负（弱队判定用）；无赛程队返回中性。</summary>
    private static (int W, int L) SeasonRecord(GameState state, string teamId)
    {
        int w = 0, l = 0;
        foreach (var f in state.Fixtures)
        {
            if (!f.Played || f.WinnerTeamId == null || (f.TeamA != teamId && f.TeamB != teamId)) continue;
            if (f.WinnerTeamId == teamId) w++;
            else l++;
        }
        return (w, l);
    }

    /// <summary>
    /// 周传闻生成（windowTick 调用，rng 为当周显式流）：
    /// 1) 战绩差 AI 队好球员提离队（意向→自动挂牌）；2) 强队关注强选手（绯闻→有消息称→谈判中）；
    /// 3) 谈判中一周后见分晓（55% 成交 / 告吹）。
    /// </summary>
    public static void WeeklyRumors(GameState state, Rng rng, List<NewsItem> notes)
    {
        string myId = state.MyTeamId ?? "";
        bool windowOpen = Transfer.TransferWindows.Any(w => state.Day >= w[0] && state.Day <= w[1]);
        // 1) 战绩差 AI 队的好球员提离队（意向）——不满口径：士气 <55
        foreach (var t in state.Teams.Values)
        {
            if (t.Id == myId || t.Tier != 1) continue;
            var (w, l) = SeasonRecord(state, t.Id);
            if (w + l < 6 || w >= l) continue; // 至少 6 场且胜率 <50%
            var stars = t.Roster
                .Select(id => state.Players.TryGetValue(id, out var p) ? p : null)
                .Where(p => p != null && p.Overall >= 78 && !p.Listed && p.Morale < 55)
                .Cast<Player>()
                .ToList();
            if (stars.Count == 0 || !rng.Chance(0.15)) continue;
            // pick 更高 overall；平手取更低 morale（TS reduce 复合条件语义）
            var star = stars[0];
            for (int i = 1; i < stars.Count; i++)
            {
                var cand = stars[i];
                bool pickCand = (cand.Overall - star.Overall) != 0 || (star.Morale - cand.Morale) > 0;
                if (pickCand) star = cand;
            }
            var buyers = state.Teams.Values.Where(x => x.Id != t.Id && x.Reputation > t.Reputation).ToList();
            var to = buyers.Count > 0 ? rng.Pick(buyers) : null;
            star.Listed = true;
            star.Morale = (int)Math.Min(100, Math.Max(10, star.Morale - 5));
            string why = $"战绩 {w} 胜 {l} 负";
            PushFeed(state, new TransferFeedItem
            {
                Day = state.Day, Year = state.Year, Kind = "wants", PlayerId = star.Id,
                ToTeamId = to?.Id,
                Text = $"{star.Ign}（{t.Tag} · {star.Overall}）对球队战绩不满，提出离队意向{(to != null ? $"，想去 {to.Tag}" : "")}（{why}），已被挂牌。",
            });
            if (star.Overall >= 80)
                notes.Add(new NewsItem { Day = state.Day, Kind = "transfer", Text = $"📋 {star.Ign}（{t.Tag} · {star.Overall}）因战绩申请转会，已被挂牌{(to != null ? $"，他想去 {to.Tag}" : "")}。" });
        }
        // 2) 新关注传闻（不限窗——原作休赛期绯闻照飞；升格/成交才限窗）
        var strongTeams = state.Teams.Values.Where(t => t.Id != myId && t.Reputation >= 70).ToList();
        var allStars = state.Players.Values.Where(p => p.TeamId != null && p.TeamId != myId && p.Overall >= 82 && !p.Listed).ToList();
        if (strongTeams.Count > 0 && allStars.Count > 0 && rng.Chance(0.3))
        {
            var buyer = rng.Pick(strongTeams);
            var star = rng.Pick(allStars);
            if (star.TeamId != buyer.Id)
            {
                PushFeed(state, new TransferFeedItem
                {
                    Day = state.Day, Year = state.Year, Kind = "rumor", C = 1, PlayerId = star.Id, ToTeamId = buyer.Id,
                    Text = $"{RumorLabel(1)}：{buyer.Tag} 正在关注 {star.Ign}（{(state.Teams.TryGetValue(star.TeamId!, out var ot) ? ot.Tag : "?")} · {star.Overall}）。",
                });
                // 野心大的人听到传闻会飘（士气 -3）
                if (star.Ambition > 70) star.Morale = (int)Math.Min(100, Math.Max(10, star.Morale - 3));
            }
        }
        if (!windowOpen) return;
        // 2b) 升级既有传闻（c1→c2→c3）；选手已退役/易主则静默过期
        var open = state.TransferFeed.Where(f => f.Kind == "rumor" && state.Day - f.Day <= 21).ToList();
        foreach (var f in open)
        {
            if (f.C == 3 || f.PlayerId == null) continue;
            if (!state.Players.TryGetValue(f.PlayerId, out var p) || p.TeamId == null) continue;
            if (f.C == 2 && rng.Chance(0.3))
            {
                f.C = 3;
                f.Day = state.Day; // 谈判中起始日
                PushFeed(state, new TransferFeedItem
                {
                    Day = state.Day, Year = f.Year, Kind = "rumor", C = 3, PlayerId = f.PlayerId, ToTeamId = f.ToTeamId,
                    Text = $"{RumorLabel(3)}：{f.ToTeamId ?? "?"} 与 {p.Ign} 方面正式接触，约一周后见分晓。",
                });
            }
            else if (f.C == 1 && rng.Chance(0.25))
            {
                f.C = 2;
                PushFeed(state, new TransferFeedItem
                {
                    Day = state.Day, Year = f.Year, Kind = "rumor", C = 2, PlayerId = f.PlayerId, ToTeamId = f.ToTeamId,
                    Text = $"{RumorLabel(2)} {f.ToTeamId ?? "?"} 正在关注 {p.Ign}。",
                });
            }
        }
        // 3) c3 一周后见分晓
        var deals = state.TransferFeed.Where(f => f.Kind == "rumor" && f.C == 3 && state.Day - f.Day >= 7).ToList();
        foreach (var f in deals)
        {
            var p = f.PlayerId != null && state.Players.TryGetValue(f.PlayerId, out var pp) ? pp : null;
            var to = f.ToTeamId != null && state.Teams.TryGetValue(f.ToTeamId, out var tt) ? tt : null;
            if (p == null || to == null || p.TeamId == null || p.TeamId == myId)
            {
                f.Kind = "off";
                f.Text = $"{f.Text}（涉事选手已易主）";
                continue;
            }
            var from = state.Teams[p.TeamId];
            if (rng.Chance(0.55) && to.Budget > 500_000 && to.Roster.Count < 7 && from.Roster.Count > 5)
            {
                // 成交：轻量成交（复用资金/名单主路径）
                int fee = (int)(DetMath.JsRound(p.Overall * 9000 * (1 + p.ContractYears * 0.12) / 1000.0) * 1000);
                to.Budget -= fee;
                from.Budget += fee;
                from.Roster = from.Roster.Where(id => id != p.Id).ToList();
                from.Starters = from.Starters.Where(id => id != p.Id).ToList();
                to.Roster.Add(p.Id);
                if (to.Starters.Count < 5) to.Starters.Add(p.Id);
                p.TeamId = to.Id;
                p.Listed = false;
                p.Morale = (int)Math.Min(100, Math.Max(10, p.Morale + 8));
                Finance.LogFinance(state, $"转会收入 · {p.Ign}", fee);
                PushFeed(state, new TransferFeedItem
                {
                    Day = state.Day, Year = state.Year, Kind = "done", PlayerId = p.Id, ToTeamId = to.Id,
                    Text = $"传闻成真：{to.Name} 以 {FmtFee(fee)} 从 {from.Name} 签下 {p.Ign}（{p.Overall}）。",
                });
                notes.Add(new NewsItem { Day = state.Day, Kind = "transfer", Text = $"✅ 传闻成真：{to.Tag} 签下 {p.Ign}（{from.Tag} → {to.Tag}，{FmtFee(fee)}）。" });
            }
            else
            {
                f.Kind = "off";
                p.Morale = (int)Math.Min(100, Math.Max(10, p.Morale + 3)); // 留队安抚
                PushFeed(state, new TransferFeedItem
                {
                    Day = state.Day, Year = state.Year, Kind = "off", PlayerId = p.Id, ToTeamId = to.Id,
                    Text = $"告吹：{to.Name} 与 {p.Ign} 的谈判未能达成一致。",
                });
            }
        }
    }

    /// <summary>费用格式化：≥$1M 用 toFixed(1)M（detToFixed1 双端一致），否则 K。</summary>
    private static string FmtFee(int v) =>
        v >= 1_000_000 ? $"${DetMath.ToFixed1(v / 1_000_000.0)}M" : $"${(int)DetMath.JsRound(v / 1000.0)}K";
}
