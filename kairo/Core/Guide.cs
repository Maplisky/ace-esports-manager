using System.Collections.Generic;
using Kairo.Core;

namespace Kairo.Core;

/// <summary>
/// 系统解锁节奏（§9.1）：首赛季按天解锁提示，逐日由 AppLoop 在推进后检查并出提示新闻。
/// 对齐 TS worker UNLOCK_NOTES（D8 转会 / D12 商务 / D20 情报与生涯）+ 开罗基地线（D3 建造 / D17 训练赛）。
/// 第二赛季起不再打扰（对齐 TS：career.seasons <= 1 才播）。
/// </summary>
public static class Guide
{
    public sealed class UnlockNote
    {
        public int Day { get; init; }
        public string Text { get; init; } = "";
    }

    public static readonly UnlockNote[] Notes =
    {
        new() { Day = 3, Text = "📖 基地建造已开放（D3）：购地与设施开工。射击房是训练加成的第一块砖。" },
        new() { Day = 8, Text = "📖 转会窗口已开放（D8）：自由市场报价、问价与挂牌功能解锁。先看看替补深度。" },
        new() { Day = 12, Text = "📖 商务中心已开放（D12）：赞助谈判、商务日与直播合同可以运营了——钱和训练时间的永恒交易。" },
        new() { Day = 17, Text = "📖 训练赛已开放（D17）：约战拉练、情报侦察与陪练收益，输球也是情报的大来源。" },
        new() { Day = 20, Text = "📖 情报与生涯系统全开（D20）：侦察对手图池、成就与名人堂解锁。祝执教顺利！" },
    };

    /// <summary>日推进后调用：首赛季命中解锁日出提示；返回提示（无则空列表）。重复调用幂等（同一天只命中一次）。</summary>
    public static List<NewsItem> DailyUnlockNotes(GameState state)
    {
        var result = new List<NewsItem>();
        var c = state.Manager.Career;
        if (c == null || c.Seasons > 1 || c.StartYear != state.Year) return result; // 第二赛季起不再打扰
        foreach (var u in Notes)
        {
            if (state.Day != u.Day) continue;
            result.Add(new NewsItem { Day = state.Day, Kind = "club", Text = u.Text });
        }
        return result;
    }
}
