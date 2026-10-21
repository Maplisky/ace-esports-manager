using System;
using System.Collections.Generic;
using System.Linq;

namespace Kairo.Core;

/// <summary>
/// 中期生涯叙事（v1.5，GDD §9.5 v2.5）— C# 移植自 ace/src/core/sim/narrative.ts（权威实现）。
/// 全部由既有账本驱动的文案模板——机制零新增、零 RNG：金句从模板池按 hashString(ign) 确定性选取。
/// </summary>
public static class Narrative
{
    public static readonly string[] ReunionQuotes =
    {
        "「教练，那天在训练房说的话我还记得——但今天，请让我赢。」",
        "「他把我的枪法磨出来了，现在我用它打败他。这很公平。」",
        "「离开不是为了报复。但赢下这一刻，感觉确实很好。」",
    };
    public static readonly string[] TurncoatQuotes =
    {
        "「我在这里学到了一切。现在，是时候亲手把它翻过去了。」",
        "「他教我的第一课是尊重比赛——所以我用了全力。」",
    };
    public static readonly string[] DynastyQuotes =
    {
        "全联盟的教练组都在连夜拆解你的比赛录像——王朝的代价，是所有人都在研究你。",
        "解说席开始用「时代」这个词形容你的球队。而挖角的电话，已经打进了更衣室。",
        "「击败他们」成了每支队赛季动员会上唯一的目标。你已经成为别人的梦想。",
    };
    public static readonly string[] FarewellQuotes =
    {
        "「最后一舞，我想留给这身队服。」——赛季结束后，他将挂起鼠标。",
        "「我打过最重要的比赛，都穿着这件衣服。」——告别巡演，从这一站开始。",
        "「年轻人们，场地交给你们了。」——老将的最后一季，每一场都是主场。",
    };
    public static readonly string[] MvpQuotes =
    {
        "「状态来了谁都拦不住，今晚的准度你们也看到了。」",
        "「战术是教练给的，但扣扳机的是我。」",
        "「个人奖放在柜子里，赢下的地图放在履历里——今晚两样都进账了。」",
    };
    public static readonly string[] RookieDebutQuotes =
    {
        "「上场前手一直在抖，第一枪打完就好了。」",
        "「教练让我当普通训练赛打。我信了，也没掉链子。」",
        "「这是第一步。下一步是让首发名单里再也写上别人的名字。」",
    };
    public static readonly string[] LockerWinQuotes =
    {
        "「照这个势头打下去，谁碰上我们都得掉层皮。」",
        "「今天赢得干净，但复盘会上一个回合都逃不掉。」",
        "「更衣室在放歌。赢球的日子，连训练房都是亮的。」",
    };
    public static readonly string[] LockerLossQuotes =
    {
        "「没人想谈这场录像。但明天十点，还是要一帧一帧过。」",
        "「我们输给了自己。对面没有变强，是我们掉线了。」",
        "「沉默的返程大巴。有人说了一句『下把赢回来』——没人接话，但都听见了。」",
    };
    public static readonly string[] LockerGrimQuotes =
    {
        "「更衣室气氛很僵，有人开始公开质疑轮换——这是危险的信号。」",
        "「连续的失利正在侵蚀信任。再输下去，问题就不再是战术了。」",
    };

    private static string Pick(string[] pool, string key) => pool[(int)(Rng.HashString(key) % (uint)pool.Length)];

    /// <summary>去掉首尾的「 " 」引号字符（对应 TS replace(/^[「"]|[」"]$/g, "")）。</summary>
    private static string StripQuotes(string q)
    {
        int start = 0;
        int end = q.Length;
        while (start < end && (q[start] == '「' || q[start] == '"')) start++;
        while (end > start && (q[end - 1] == '」' || q[end - 1] == '"')) end--;
        return q[start..end];
    }

    /// <summary>我的正式赛败局后包装：胜方为对方时进入叙事；国际赛淘汰局加标签。</summary>
    public static void NarrativeAfterMyLoss(GameState state, string label, string teamA, string teamB, string winner, List<NewsItem> notes)
    {
        string? myId = state.MyTeamId;
        if (myId == null) return;
        bool iWon = winner == "A" ? teamA == myId : teamB == myId;
        if (iWon) return;
        if (!state.Teams.TryGetValue(winner == "A" ? teamA : teamB, out var winnerTeam)) return;
        string? knockout = System.Text.RegularExpressions.Regex.IsMatch(label, "淘汰|败者组|胜者组|总决赛|瑞士轮") ? label : null;
        NarrativeOnMyLoss(state, winnerTeam, notes, knockout);
    }

    public static void NarrativeOnMyLoss(GameState state, Team winnerTeam, List<NewsItem> notes, string? knockoutLabel)
    {
        string? myId = state.MyTeamId;
        string? myName = myId != null && state.Teams.TryGetValue(myId, out var my) ? my.Name : null;
        if (myId == null || myName == null) return;

        var oldBoys = winnerTeam.Roster
            .Select(pid => state.Players.TryGetValue(pid, out var p) ? p : null)
            .Where(p => p != null && p.Career.Clubs.Contains(myId))
            .Cast<Player>()
            .ToList();
        if (oldBoys.Count > 0)
        {
            var star = oldBoys[0];
            foreach (var b in oldBoys.Skip(1))
                if (b.Career.Titles > star.Career.Titles) star = b;
            notes.Add(new NewsItem
            {
                Day = state.Day, Kind = "club",
                Text = $"🤝 旧部重逢：{star.Ign}（{winnerTeam.Tag}，曾效力 {myName}）{(knockoutLabel != null ? $"在{knockoutLabel}" : "")}亲手淘汰了老东家。{Pick(ReunionQuotes, star.Ign)}",
                Important = knockoutLabel != null,
            });
        }

        var coachName = winnerTeam.Coach?.Name;
        if (coachName != null)
        {
            var disciple = state.RetireLog.FirstOrDefault(
                r => r.Path == "coach" && r.Name == coachName && r.TeamName == myName);
            if (disciple != null)
            {
                notes.Add(new NewsItem
                {
                    Day = state.Day, Kind = "club", Important = true,
                    Text = $"🗡 弟子反戈：{winnerTeam.Name} 主帅 {coachName}——{myName} 退役名宿、你亲手送上的教练席——{(knockoutLabel != null ? $"在{knockoutLabel}" : "")}击败了你。{Pick(TurncoatQuotes, coachName)}",
                });
            }
        }
    }

    private static readonly int[] DynastyStages = { 2, 3, 5 };

    /// <summary>王朝里程碑（我夺冠后调用）：生涯冠军数抵达 2/3/5 时各触发一次全联盟反应文案。</summary>
    public static void NarrativeOnTitle(GameState state, List<NewsItem> notes)
    {
        var c = state.Manager.Career;
        if (c == null || state.MyTeamId == null) return;
        int? stage = Array.Find(DynastyStages, s => c.Titles == s);
        if (stage == 0) return;
        string myName = state.Teams.TryGetValue(state.MyTeamId, out var t) ? t.Name : "你的球队";
        notes.Add(new NewsItem
        {
            Day = state.Day, Kind = "league", Important = true,
            Text = $"👑 王朝里程碑：{myName} 第 {c.Titles} 冠。{Pick(DynastyQuotes, $"{myName}:{stage}")}",
        });
    }

    /// <summary>名宿告别巡演：32+ 岁、2+ 冠、从我这退役 → 末季事件链开场文案。</summary>
    public static void NarrativeOnRetire(GameState state, RetireLogItem entry, List<NewsItem> notes)
    {
        string? myName = state.MyTeamId != null && state.Teams.TryGetValue(state.MyTeamId, out var t) ? t.Name : null;
        if (myName == null || entry.TeamName != myName) return;
        if (entry.Age < 32 || entry.Titles < 2) return;
        notes.Add(new NewsItem
        {
            Day = state.Day, Kind = "transfer", Important = true,
            Text = $"🎖 名宿告别巡演：{entry.Ign}（{entry.Titles} 冠 · {myName}）确认这是他的最后一个赛季。{Pick(FarewellQuotes, entry.Ign)}",
        });
    }

    /// <summary>
    /// 首秀名单捕获：在赛后入账之前调用，返回我队 career.maps===0 的首发（入账后无法再区分首秀）。
    /// </summary>
    public static List<string> CaptureDebuts(GameState state)
    {
        string? myId = state.MyTeamId;
        if (myId == null || !state.Teams.TryGetValue(myId, out var my)) return new List<string>();
        return my.Starters.Where(pid => (state.Players.TryGetValue(pid, out var p) ? p.Career.Maps : 1) == 0).ToList();
    }

    /// <summary>
    /// 资讯活水：我队正式赛后的三类软新闻——MVP 高光 / 小将首战 / 更衣室舆论。零新增状态、零 RNG。
    /// debutPids 由调用方在入账前经 CaptureDebuts 捕获。
    /// </summary>
    public static void NarrativeOnMyMatch(GameState state, string fixtureId, MatchRecord rec, List<NewsItem> notes, IReadOnlySet<string>? debutPids = null)
    {
        string? myId = state.MyTeamId;
        if (myId == null || !state.Teams.TryGetValue(myId, out var my)) return;
        bool won = (rec.Winner == "A" ? rec.TeamA : rec.TeamB) == myId;

        // ① MVP 高光：系列赛 MVP 是我队选手（含败方 MVP 的「虽败犹荣」）
        var mvp = rec.Mvp != null && state.Players.TryGetValue(rec.Mvp, out var m) ? m : null;
        if (mvp != null && mvp.TeamId == myId)
        {
            var acsAll = rec.Maps.Select(mm => mm.Lines.TryGetValue(mvp.Id, out var l) ? l.Acs : 0).ToList();
            int avgAcs = (int)DetMath.JsRound(acsAll.Sum() / Math.Max(1, acsAll.Count));
            notes.Add(new NewsItem
            {
                Day = state.Day, Kind = "match",
                Text = $"⭐ MVP 高光：{mvp.Ign} {(won ? "率队取胜" : "虽败犹荣")}——系列赛场均 {avgAcs} ACS。{Pick(MvpQuotes, mvp.Ign)}",
            });
        }

        // ② 小将首战：入账前捕获的首秀首发（≤19 岁）；只讲最年轻的（age 升序；ign 平局序按 ordinal 近似——同龄平局由夹具规避）
        var kids = (debutPids ?? new HashSet<string>())
            .Select(pid => state.Players.TryGetValue(pid, out var p) ? p : null)
            .Where(p => p != null && p.Age <= 19)
            .Cast<Player>()
            .OrderBy(p => p.Age)
            .ThenBy(p => p.Ign, StringComparer.Ordinal)
            .ToList();
        if (kids.Count > 0)
        {
            var kid = kids[0];
            notes.Add(new NewsItem
            {
                Day = state.Day, Kind = "club",
                Text = $"🌱 小将首战：{kid.Ign}（{kid.Age} 岁）迎来职业生涯首场正式比赛——{(won ? "用一场胜利纪念出道" : "结果苦涩，但天赋藏不住")}。{Pick(RookieDebutQuotes, kid.Ign)}",
            });
        }

        // ③ 更衣室舆论：发言人由 fixtureId 哈希选定；败局且发言人士气 <40 → 尖锐版
        var starters = my.Starters
            .Select(pid => state.Players.TryGetValue(pid, out var p) ? p : null)
            .Where(p => p != null)
            .Cast<Player>()
            .ToList();
        if (starters.Count > 0)
        {
            var voice = starters[(int)(Rng.HashString(fixtureId) % (uint)starters.Count)];
            bool grim = !won && voice.Morale < 40;
            string quote = StripQuotes(grim ? Pick(LockerGrimQuotes, fixtureId) : won ? Pick(LockerWinQuotes, fixtureId) : Pick(LockerLossQuotes, fixtureId));
            notes.Add(new NewsItem
            {
                Day = state.Day, Kind = "club",
                Text = $"🎙 更衣室：{voice.Ign}{(grim ? "（士气低落）" : "")}——「{quote}」",
            });
        }
    }
}
