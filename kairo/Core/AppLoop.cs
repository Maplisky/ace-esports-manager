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
            // 翻年前一天预采样最终积分榜（advanceDay 翻年块会重建 comps 归零榜单，晋级判定须用赛季末终榜）
            Dictionary<string, List<StandingsEntry>>? finalTables = null;
            if (state.Day + 1 == DaySim.DaysInYear(state.Year) && state.Comps.ContainsKey("stage2-china-t2"))
                finalTables = SampleFinalTables(state);
            var played = new List<(string FixtureId, bool Mine, bool Won, string Stage)>();
            // advanceDay 契约：每天传新列表、由其内部归档（跨天共享列表会全量重复入档——TS worker 同款逐日新表）
            var dayNotes = new List<NewsItem>();
            var r = DaySim.AdvanceDay(state, dayNotes,
                (rec, fixtureId, mine) =>
                {
                    var fx = state.Fixtures.FirstOrDefault(f => f.Id == fixtureId);
                    bool won = mine && ((rec.Winner == "A" && fx?.TeamA == state.MyTeamId) || (rec.Winner == "B" && fx?.TeamB == state.MyTeamId));
                    played.Add((fixtureId, mine, won, fx?.Stage ?? ""));
                    onMatch?.Invoke(rec, fixtureId, mine);
                },
                mineHold);
            result.PlayedMine.AddRange(r.PlayedMine);
            // 开罗钩子 ①：比赛奖金（胜场，按赛事级别）+ 主场门票（已建场馆容量 × 票价；补赛同样计）
            MatchRewards(state, played);
            // 开罗钩子 ②：基地施工日推进
            if (state.Base != null) BaseOps.AdvanceBuildDay(state.Base);
            // 开罗钩子 ③：周结算（与内核周块同日界）
            if (state.Day % 7 == 0) ApplyBaseWeekly(state, dayNotes);
            // 成就评估（对齐 TS worker：日推进后）
            Achievements.EvaluateAchievements(state, dayNotes);
            ArchiveNotes(state, dayNotes); // 钩子新闻（advanceDay 只归档它自己的 dayNotes）
            notes.AddRange(dayNotes);
            result.SeasonEnded = r.SeasonEnded;
            if (result.SeasonEnded)
            {
                var turnoverNotes = new List<NewsItem>();
                SeasonTurnover(state, turnoverNotes, finalTables);
                ArchiveNotes(state, turnoverNotes); // 翻年附加新闻（晋级/退役）在 advanceDay 归档之后产生，须补入档
                notes.AddRange(turnoverNotes);
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

    /// <summary>比赛奖金（胜场，按赛事级别表格）+ 主场门票（容量 × 票价）。返回合计入账。</summary>
    public static int MatchRewards(GameState state, IEnumerable<(string FixtureId, bool Mine, bool Won, string Stage)> playedToday)
    {
        if (state.MyTeamId == null) return 0;
        var myTeam = state.Teams[state.MyTeamId];
        int capacity = state.Base != null ? BaseOps.Capacity(state.Base) : 0;
        int total = 0;
        foreach (var (fixtureId, mine, won, stage) in playedToday)
        {
            if (!mine) continue;
            var f = state.Fixtures.FirstOrDefault(x => x.Id == fixtureId);
            if (f == null) continue;
            int bonus = stage switch
            {
                "stage1" or "stage2" => BaseOps.Table.MatchBonus.LeagueWin,
                "cup" => BaseOps.Table.MatchBonus.CupWin,
                "masters" or "champions" => BaseOps.Table.MatchBonus.InternationalWin,
                _ => 0,
            };
            if (won && bonus > 0)
            {
                myTeam.Budget += bonus;
                Finance.LogFinance(state, $"奖金 · {StageCn(stage)}获胜", bonus);
                total += bonus;
            }
            // 门票仅联赛主场（§11-5：揭幕杯跨赛区、Masters/Champions 国际赛均为中立场地，无主票）
            if (capacity > 0 && f.TeamA == state.MyTeamId && (f.Stage == "stage1" || f.Stage == "stage2"))
            {
                int ticket = capacity * BaseOps.Table.Ticket.PricePerSeat;
                myTeam.Budget += ticket;
                Finance.LogFinance(state, $"门票 · 主场票房（容量 {capacity}）", ticket);
                total += ticket;
            }
        }
        return total;
    }

    private static string StageCn(string stage) => stage switch
    {
        "stage1" => "Stage 1", "stage2" => "Stage 2", "cup" => "揭幕杯",
        "masters" => "Masters", "champions" => "Champions", _ => "友谊赛",
    };

    /// <summary>新闻入档（上限 400 条，优先裁非重要）——语义与 DaySim.AdvanceDay 尾部一致。</summary>
    private static void ArchiveNotes(GameState state, List<NewsItem> notes)
    {
        foreach (var n in notes)
        {
            state.News.Add(n);
            while (state.News.Count > 400)
            {
                int idx = state.News.FindIndex(x => !(x.Important ?? false));
                if (idx < 0) break;
                state.News.RemoveAt(idx);
            }
        }
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

    /// <summary>赛季末终榜采样（翻年前一天调用；晋级判定用）。</summary>
    private static Dictionary<string, List<StandingsEntry>> SampleFinalTables(GameState state)
    {
        var tables = new Dictionary<string, List<StandingsEntry>>();
        foreach (var (rId, _, _) in DaySim.Regions)
        {
            tables[$"stage2-{rId}-t1"] = DaySim.PublicSortedTable(state, $"stage2-{rId}-t1");
            tables[$"stage2-{rId}-t2"] = DaySim.PublicSortedTable(state, $"stage2-{rId}-t2");
        }
        return tables;
    }

    /// <summary>赛季翻年附加结算：晋级体系（§11-4）→ 退役检定。
    /// 晋级：每赛区 stage2 挑战者联赛冠军升 t1、stage1 联赛垫底降 t2（守恒，我队不豁免）。
    /// 判定用翻年前采样的赛季末终榜（翻年块会重置榜单）。
    /// 改 Tier 后须重建赛程（内核翻年块已按旧分级建过一次——同 seed 重建，确定性不受影响）。
    /// 退役：种子由 world seed + 年份派生（TS 侧休眠系统按立项 §8.3 意图正式接线）。</summary>
    public static void SeasonTurnover(GameState state, List<NewsItem> notes, Dictionary<string, List<StandingsEntry>>? finalTables)
    {
        // ── 晋级体系（每赛区一升一降）──
        var promotions = new List<(string TeamId, string Region, bool Up)>();
        foreach (var (rId, rLabel, _) in DaySim.Regions)
        {
            if (finalTables == null
                || !finalTables.TryGetValue($"stage2-{rId}-t2", out var t2Table) || t2Table.Count == 0
                || !finalTables.TryGetValue($"stage2-{rId}-t1", out var t1Table) || t1Table.Count == 0) continue;
            var champ = t2Table[0].TeamId;
            var bottom = t1Table[^1].TeamId;
            if (state.Teams.TryGetValue(champ, out var up) && up.Tier == 2)
            {
                up.Tier = 1;
                promotions.Add((champ, rId, true));
                notes.Add(new NewsItem { Day = state.Day, Kind = "league", Important = champ == state.MyTeamId, Text = $"🏆 {up.Name} 以 {rLabel} 挑战者联赛冠军身份升入 VCT {rLabel}！" });
            }
            if (state.Teams.TryGetValue(bottom, out var down) && down.Tier == 1)
            {
                down.Tier = 2;
                promotions.Add((bottom, rId, false));
                notes.Add(new NewsItem { Day = state.Day, Kind = "league", Important = bottom == state.MyTeamId, Text = $"⬇ {down.Name} 于 {rLabel} 联赛垫底，降入挑战者联赛。" });
            }
        }
        if (promotions.Count > 0)
        {
            // 新赛季赛程按新分级重建（翻年块已按旧分级建过一次：清空后同 seed 重建）
            state.Fixtures = new List<Fixture>();
            DaySim.InitSeasonFixtures(state);
        }
        // ── 退役检定（劝留卡 / AI 决策 / 教练自由池）──
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

    /// <summary>结算我的交互式比赛 + 开罗钩子（主场门票 + 奖金 + 成就评估）。</summary>
    public static bool SettleHeld(
        GameState state, string fixtureId, MatchRecord? rec,
        Action<List<NewsItem>>? onNews = null)
    {
        bool settled = DaySim.SettleMatch(state, fixtureId, rec, onNews);
        if (!settled) return false;
        var f = state.Fixtures.FirstOrDefault(x => x.Id == fixtureId);
        if (f != null && state.MyTeamId != null)
        {
            bool won = rec!.Winner == "A" ? f.TeamA == state.MyTeamId : f.TeamB == state.MyTeamId;
            MatchRewards(state, new[] { (fixtureId, true, won, f.Stage) });
        }
        var notes = new List<NewsItem>();
        Achievements.EvaluateAchievements(state, notes);
        if (onNews != null && notes.Count > 0) onNews(notes);
        return true;
    }
}
