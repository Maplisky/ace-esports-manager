using System;
using System.Collections.Generic;
using System.Linq;
using Kairo.Core;

namespace Kairo.Core;

/// <summary>AppLoop.Advance 的一日推进结果。</summary>
public sealed class AppLoopResult
{
    public List<string> Notes { get; set; } = new();
    public List<string> PlayedMine { get; set; } = new();
    public bool SeasonEnded { get; set; }
    /// <summary>held 非 null = 我的比赛被拦截停车（等待赛前准备）</summary>
    public string? HeldFixtureId { get; set; }
}

/// <summary>
/// C# 侧游戏日循环（GDD 开罗版立项 §3.4 分层红线）：组合 DaySim.AdvanceDay 与开罗专属钩子——
/// 基地施工日推进 / 主场门票收入（容量修正量）/ 基地周结算（训练加成 → Team.Facilities + 常驻收入 + 恢复士气）/
/// 成就评估（对齐 TS worker：日推进后评估）/ 赛季末退役检定。
/// 全部确定性；内核纯函数红线不动——开罗系统只在内核之外追加状态变更。
/// 注：TS worker 从未接线 seasonRetirements（休眠系统）；本循环按立项 §3.2/§8.3 设计意图正式接线，
/// 种子 hash(seed:retire:year) 派生。成就/退役新闻与日推进新闻同流入档。
/// </summary>
public static class AppLoop
{
    /// <summary>推进至多 maxDays 天（赛季收官即停；held 停车即停）。onMatch/mineHold 语义与 DaySim.AdvanceDay 相同。</summary>
    public static AppLoopResult Advance(
        GameState state,
        int maxDays = 1,
        Action<MatchRecord, string, bool>? onMatch = null,
        Func<string, string, string, int, string, bool>? mineHold = null)
    {
        var result = new AppLoopResult();
        var notes = new List<NewsItem>();
        // 生涯终局（对齐 TS worker doAdvance）：下课/退休后世界冻结
        if (state.Manager.Career?.Ending != null) return result;

        for (int i = 0; i < maxDays; i++)
        {
            var played = new List<(string FixtureId, bool Mine)>();
            var r = DaySim.AdvanceDay(state, notes,
                (rec, fixtureId, mine) =>
                {
                    played.Add((fixtureId, mine));
                    onMatch?.Invoke(rec, fixtureId, mine);
                },
                mineHold);
            result.PlayedMine.AddRange(r.PlayedMine);
            // 开罗钩子 ①：主场门票收入（已建场馆容量 × 票价；补赛同样计）
            int tickets = TicketIncome(state, played);
            // 开罗钩子 ②：基地施工日推进
            if (state.Base != null) BaseOps.AdvanceBuildDay(state.Base);
            // 开罗钩子 ③：周结算（与内核周块同日界）
            if (state.Day % 7 == 0) ApplyBaseWeekly(state, notes);
            // 成就评估（对齐 TS worker：日推进后）
            Achievements.EvaluateAchievements(state, notes);
            result.SeasonEnded = r.SeasonEnded;
            if (result.SeasonEnded)
            {
                SeasonTurnover(state, notes);
                break;
            }
            // held 停车：本日有我的比赛被拦截（playedMine 含该 fixture 且未结算）→ 停
            var heldFix = r.PlayedMine.Select(id => state.Fixtures.FirstOrDefault(f => f.Id == id))
                .FirstOrDefault(f => f != null && !(f.Settled ?? false));
            if (heldFix != null)
            {
                result.HeldFixtureId = heldFix.Id;
                break;
            }
        }
        result.Notes = notes.Select(n => n.Text).ToList();
        return result;
    }

    /// <summary>主场门票：我的主场比赛按已建成场馆容量计收入（零 RNG）。</summary>
    public static int TicketIncome(GameState state, IEnumerable<(string FixtureId, bool Mine)> playedToday)
    {
        if (state.Base == null || state.MyTeamId == null) return 0;
        int capacity = BaseOps.Capacity(state.Base);
        if (capacity <= 0) return 0;
        int income = 0;
        foreach (var (fixtureId, mine) in playedToday)
        {
            if (!mine) continue;
            var f = state.Fixtures.FirstOrDefault(x => x.Id == fixtureId);
            if (f == null || f.TeamA != state.MyTeamId) continue; // teamA = 主队
            income += capacity * BaseOps.Table.Ticket.PricePerSeat;
            state.Teams[state.MyTeamId].Budget += capacity * BaseOps.Table.Ticket.PricePerSeat;
            Finance.LogFinance(state, $"门票 · 主场票房（容量 {capacity}）", capacity * BaseOps.Table.Ticket.PricePerSeat);
        }
        return income;
    }

    /// <summary>基地周结算（训练加成/常驻收入/恢复士气）；有产出时出一条新闻。</summary>
    public static (int Income, int Facilities) ApplyBaseWeekly(GameState state, List<NewsItem> notes)
    {
        if (state.Base == null || state.MyTeamId == null) return (0, 0);
        var (income, facilities, _, _) = BaseOps.ApplyWeekly(state, state.Base);
        if (income > 0 || facilities > 0)
        {
            notes.Add(new NewsItem
            {
                Day = state.Day, Kind = "club",
                Text = $"🏢 基地周报：常驻收入 {(income > 0 ? $"+${income}" : "—")}，训练环境加成 +{facilities}。",
            });
        }
        return (income, facilities);
    }

    /// <summary>赛季翻年附加结算：退役检定（劝留卡/AI 决策/教练自由池）。种子由 world seed + 年份派生。</summary>
    public static void SeasonTurnover(GameState state, List<NewsItem> notes)
    {
        var rng = new Rng(Rng.HashString($"{state.Seed}:retire:{state.Year}"));
        Retirement.SeasonRetirements(state, rng, notes);
    }

    /// <summary>赛前准备完成 → 模拟我的比赛（不结算，等播放/干预）；结算请走 SettleHeld。</summary>
    public static MatchRecord? PlayHeld(
        GameState state, string fixtureId, DaySim.HeldMatchOptions opts,
        Action<MatchRecord, string, bool>? onMatch = null)
        => DaySim.PlayHeldMatch(state, fixtureId, opts, onMatch);

    /// <summary>同 seed 干预重模拟。</summary>
    public static MatchRecord? InterveneHeld(
        GameState state, string fixtureId, MatchIntervention iv,
        Action<MatchRecord, string, bool>? onMatch = null)
        => DaySim.InterveneHeldMatch(state, fixtureId, iv, onMatch);

    /// <summary>结算我的交互式比赛 + 开罗钩子（主场门票 + 成就评估）。</summary>
    public static bool SettleHeld(
        GameState state, string fixtureId, MatchRecord? rec,
        Action<List<NewsItem>>? onNews = null)
    {
        bool settled = DaySim.SettleMatch(state, fixtureId, rec, onNews);
        if (!settled) return false;
        var f = state.Fixtures.FirstOrDefault(x => x.Id == fixtureId);
        if (f != null && state.MyTeamId != null && f.TeamA == state.MyTeamId)
        {
            TicketIncome(state, new[] { (fixtureId, true) });
        }
        var notes = new List<NewsItem>();
        Achievements.EvaluateAchievements(state, notes);
        if (onNews != null && notes.Count > 0) onNews(notes);
        return true;
    }
}
