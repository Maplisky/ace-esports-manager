using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using Kairo.Core;

namespace Kairo.Core;

/// <summary>AdvanceDay 返回（GDD §2 微循环）。</summary>
public sealed class AdvanceResult
{
    public int Day { get; set; }
    public List<string> Notes { get; set; } = new();
    public List<string> PlayedMine { get; set; } = new();
    public bool SeasonEnded { get; set; }
}

/// <summary>
/// 日推进（GDD §2 微循环 / §9.6 停靠规则）：赛季中 1 回合 = 1 天；每 7 天结算一次训练/状态回归。
/// 比赛模拟经 Match.SimMatch（确定性 seed = HashString(worldSeed:fixtureId)）。
/// TS 权威：ace/src/core/sim/day.ts——排序全部走 LINQ 稳定序（V8 sort 稳定语义），数值全程 double。
/// </summary>
public static class DaySim
{
    private static class CALENDAR
    {
        public const int PreseasonEnd = 24;
        public const int CupStart = 25;
        public const int CupEnd = 52;
        public const int Stage1Start = 53;
        public const int Stage1Mid = 87;
        public const int Stage1End = 122;
        public const int SummerStart = 123;
        public const int MastersStart = 126;
        public const int SummerEnd = 152;
        public const int Stage2Start = 153;
        public const int Stage2Mid = 192;
        public const int Stage2End = 232;
        public const int ChampionsDraw = 236;
        public const int ChampionsGroupStart = 240;
        public const int DraftDay = 280;
        public const int OffseasonStart = 233;
    }

    private static bool IsLeapYear(int y) => (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    public static int DaysInYear(int y) => IsLeapYear(y) ? 366 : 365;

    /// <summary>赛区注册表（v0.7 真实四赛区，数据来自 vlr.gg）。</summary>
    public static readonly (string Id, string Label, string Logo)[] Regions =
    {
        ("americas", "Americas", "assets/regions/americas.svg"),
        ("emea", "EMEA", "assets/regions/emea.svg"),
        ("pacific", "Pacific", "assets/regions/pacific.svg"),
        ("china", "China", "assets/regions/china.svg"),
    };
    private static readonly Dictionary<string, string> LegacyRegionLabel = new() { ["xia"] = "霞赛区", ["yao"] = "曜赛区" };
    private static string RegionLabel(string id)
    {
        foreach (var r in Regions) if (r.Id == id) return r.Label;
        return LegacyRegionLabel.GetValueOrDefault(id) ?? "联赛";
    }

    /// <summary>插入序去重（TS [...new Set(arr)] 语义：保留首次出现序）。</summary>
    private static List<string> DistinctInOrder(IEnumerable<string> src)
    {
        var seen = new HashSet<string>();
        var list = new List<string>();
        foreach (var x in src) if (seen.Add(x)) list.Add(x);
        return list;
    }

    /// <summary>旧档 comp key 迁移（v0.6-1）：单赛区旧命名 → 霞赛区新命名。</summary>
    public static void MigrateLegacyComps(GameState state)
    {
        var renames = new Dictionary<string, string>
        {
            ["stage1-t1"] = "stage1-xia-t1",
            ["stage1-t2"] = "stage1-xia-t2",
            ["stage2-t1"] = "stage2-xia-t1",
            ["stage2-t2"] = "stage2-xia-t2",
        };
        foreach (var (oldK, newK) in renames)
        {
            if (!state.Comps.TryGetValue(oldK, out var oldComp) || state.Comps.ContainsKey(newK)) continue;
            var migrated = new Competition
            {
                Key = newK, Name = oldComp.Name, Stage = oldComp.Stage,
                TeamIds = oldComp.TeamIds.ToList(), Standings = oldComp.Standings,
            };
            state.Comps[newK] = migrated;
            state.Comps.Remove(oldK);
            foreach (var f in state.Fixtures)
            {
                if (f.Comp == oldK) f.Comp = newK;
            }
        }
    }

    /// <summary>开赛程：揭幕杯（跨赛区一级前 8）+ 四赛区双循环联赛（VCT/挑战者 × Stage1/Stage2）。按年份变化种子。</summary>
    public static void InitSeasonFixtures(GameState state)
    {
        var rng = new Rng((uint)((int)state.Seed ^ Rng.Imul(state.Year, unchecked((int)0x9e3779b9))));
        var all = state.Teams.Values.ToList();
        var t1 = all.Where(t => t.Tier == 1).ToList();
        // 揭幕杯：跨赛区一级按平均 overall 取前 8（季前国际热身）
        double AvgOverall(string id)
        {
            var t = state.Teams[id];
            double s = 0;
            foreach (var pid in t.Roster) s += state.Players.TryGetValue(pid, out var pl) ? pl.Overall : 0;
            return s / t.Roster.Count;
        }
        var cupTeams = t1.OrderByDescending(t => AvgOverall(t.Id)).Take(8).Select(t => t.Id).ToList();
        state.Comps["cup"] = new Competition { Key = "cup", Name = "揭幕杯", Stage = "cup", TeamIds = cupTeams, Standings = new OrderedDict<string, StandingsEntry>() };
        Fixtures.BuildCup(state.Fixtures, "cup", "揭幕杯", "cup", cupTeams, CALENDAR.CupStart + 1, 8, 3, rng);
        // 四赛区：VCT + 挑战者联赛（Stage1/Stage2 双循环）
        foreach (var st in new[] { "stage1", "stage2" })
        {
            var sName = st == "stage1" ? "Stage 1" : "Stage 2";
            int start = st == "stage1" ? CALENDAR.Stage1Start : CALENDAR.Stage2Start;
            int end = st == "stage1" ? CALENDAR.Stage1End : CALENDAR.Stage2End;
            foreach (var (rId, rLabel, _) in Regions)
            {
                var rt1 = all.Where(t => t.Tier == 1 && (string.IsNullOrEmpty(t.RegionId) ? "xia" : t.RegionId) == rId).Select(t => t.Id).ToList();
                var rt2 = all.Where(t => t.Tier == 2 && (string.IsNullOrEmpty(t.RegionId) ? "xia" : t.RegionId) == rId).Select(t => t.Id).ToList();
                var k1 = $"{st}-{rId}-t1";
                var k2 = $"{st}-{rId}-t2";
                state.Comps[k1] = new Competition { Key = k1, Name = $"VCT {rLabel} · {sName}", Stage = st, TeamIds = rt1, Standings = new OrderedDict<string, StandingsEntry>() };
                state.Comps[k2] = new Competition { Key = k2, Name = $"挑战者 {rLabel} · {sName}", Stage = st, TeamIds = rt2, Standings = new OrderedDict<string, StandingsEntry>() };
                Fixtures.BuildLeague(state.Fixtures, k1, $"{rLabel} 联赛", st, rt1, start + 2, end, 3, rng);
                Fixtures.BuildLeague(state.Fixtures, k2, $"{rLabel} 挑战者联赛", st, rt2, start + 2, end, 3, rng);
            }
        }
        // 清掉上一赛季遗留的 comp（去年的 Masters/旧 key 联赛不残留到总览）
        foreach (var k in state.Comps.Keys.ToList())
        {
            if (!Regex.IsMatch(k, @"^stage\d+-[a-z]+-t\d$") && k != "cup") state.Comps.Remove(k);
        }
        // 赛区风格 META 聚合（v1.0-5，GDD §18-3）：每赛区 t1 队伍首发进攻性均值 → 风格标签
        state.RegionMeta = new OrderedDict<string, RegionMetaEntry>();
        foreach (var (rId, _, _) in Regions)
        {
            var t1Teams = all.Where(t => t.Tier == 1 && (string.IsNullOrEmpty(t.RegionId) ? "xia" : t.RegionId) == rId);
            var aggrs = t1Teams
                .Select(t => Strength.AggrOfLineup(t.Starters.Select(id => state.Players.TryGetValue(id, out var pl) ? pl : null).Where(p => p != null).Select(p => p!).ToList()))
                .Where(v => v > 0)
                .ToList();
            double aggr = aggrs.Count > 0 ? aggrs.Sum() / aggrs.Count : 0.5;
            state.RegionMeta[rId] = new RegionMetaEntry { Style = Strength.StyleOf(aggr), Aggr = aggr };
        }
        foreach (var comp in state.Comps.Values)
        {
            if (comp.Key == "cup" || comp.Key == "masters") continue;
            foreach (var id in comp.TeamIds)
            {
                comp.Standings[id] = new StandingsEntry { TeamId = id };
            }
        }
    }

    /// <summary>Masters 国际赛（GDD §7.3）：四赛区第 1 直通淘汰赛；第 2/3 名共 8 队瑞士轮出 4 队；8 队双败。</summary>
    private static void BuildMasters(GameState state, List<NewsItem> notes)
    {
        var direct = new List<string>();
        var pot2 = new List<string>();
        var pot3 = new List<string>();
        foreach (var (rId, _, _) in Regions)
        {
            var table = SortedTable(state, $"stage1-{rId}-t1");
            if (table.Count < 3) return; // 赛区数据不足不开赛（防御）
            direct.Add(table[0].TeamId);
            pot2.Add(table[1].TeamId);
            pot3.Add(table[2].TeamId);
        }
        var allTeamIds = direct.Concat(pot2).Concat(pot3).ToList();
        state.Comps["masters"] = new Competition { Key = "masters", Name = "Masters 国际赛", Stage = "masters", TeamIds = allTeamIds, Standings = new OrderedDict<string, StandingsEntry>() };
        foreach (var id in allTeamIds)
        {
            state.Comps["masters"].Standings[id] = new StandingsEntry { TeamId = id };
        }
        // 瑞士轮第 1 轮：第 2 名档 × 第 3 名档循环错位，保证首轮不撞同赛区
        var pairs = pot2.Select((t, i) => (t, pot3[(i + 1) % pot3.Count])).ToList();
        Fixtures.BuildSwissRound(state.Fixtures, "masters", "Masters", "masters", pairs, CALENDAR.MastersStart, 1, 3);
        var styleNote = string.Join("、", Regions.Select(r =>
        {
            var style = state.RegionMeta.TryGetValue(r.Id, out var rm) ? rm.Style : "balanced";
            return $"{r.Label}={(Strength.StyleLabel.TryGetValue(style, out var lb) ? lb : "均衡")}";
        }));
        notes.Add(new NewsItem
        {
            Day = state.Day, Kind = "league", Important = true,
            Text = $"🌍 Masters 国际赛开抽：{string.Join("/", direct.Select(id => state.Teams.TryGetValue(id, out var t) ? t.Tag : "?"))} 以赛区头名直通淘汰赛，8 队瑞士轮（两胜出线、两败淘汰）决出另外 4 席，淘汰赛双败。赛区风格 META：{styleNote}——遭遇海外风格时相性折算（遭遇战规则）。",
        });
    }

    /// <summary>masters comp 内某队当前战绩（淘汰赛未建阶段 = 瑞士轮战绩）。</summary>
    private static (int W, int L) MasterRecord(GameState state, string teamId)
    {
        var s = state.Comps.TryGetValue("masters", out var m) && m.Standings.TryGetValue(teamId, out var e) ? e : null;
        return (s?.W ?? 0, s?.L ?? 0);
    }

    /// <summary>Masters 瑞士轮推进：一轮全部打完（且非当日）→ 按战绩配对下一轮；4 队出线 → 建双败淘汰赛。</summary>
    private static void ProgressMasters(GameState state, List<NewsItem> notes)
    {
        if (!state.Comps.ContainsKey("masters")) return;
        var swiss = state.Fixtures.Where(f => f.Comp == "masters" && f.Label.Contains("瑞士轮", StringComparison.Ordinal)).ToList();
        if (swiss.Count == 0) return;
        if (state.Fixtures.Any(f => f.Comp == "masters" && f.Label.Contains("胜者组第1轮", StringComparison.Ordinal))) return; // 淘汰赛已建
        if (swiss.Any(f => !f.Played)) return;
        int lastDay = swiss.Max(f => f.Day);
        if (lastDay >= state.Day) return; // 当天刚打完，次日检测再排（下一轮日 = 上轮日 + 3，日程不漂移）
        var swissTeams = swiss.SelectMany(f => new[] { f.TeamA, f.TeamB });
        var qualified = DistinctInOrder(swissTeams).Where(id => MasterRecord(state, id).W >= 2).ToList();
        if (qualified.Count == 4)
        {
            BuildMastersPlayoffs(state, notes, qualified);
            return;
        }
        // 未出线且未淘汰的队继续配对（两胜制 8 队）
        var active = DistinctInOrder(swissTeams).Where(id => MasterRecord(state, id).W < 2 && MasterRecord(state, id).L < 2).ToList();
        var playedPairs = new HashSet<string>(swiss.Select(f => string.CompareOrdinal(f.TeamA, f.TeamB) < 0 ? $"{f.TeamA}|{f.TeamB}" : $"{f.TeamB}|{f.TeamA}"));
        string RegionOf(string id) => state.Teams.TryGetValue(id, out var t) ? t.RegionId : "";
        var pairs = Fixtures.PairSwissRound(
            active.Select(id => (id, MasterRecord(state, id).W, MasterRecord(state, id).L)).ToList(),
            RegionOf, playedPairs);
        if (pairs.Count == 0)
        {
            // 防御：战绩异常导致无法配对，用当前战绩前 4 补位出线
            var fallback = DistinctInOrder(swissTeams).OrderByDescending(id => MasterRecord(state, id).W).Take(4).ToList();
            BuildMastersPlayoffs(state, notes, fallback);
            return;
        }
        int roundNo = 1 + swiss.Max(f =>
        {
            var m = Regex.Match(f.Label, @"瑞士轮第(\d+)轮");
            return m.Success ? int.Parse(m.Groups[1].Value) : 0;
        });
        Fixtures.BuildSwissRound(state.Fixtures, "masters", "Masters", "masters", pairs, lastDay + 3, roundNo, 3);
    }

    /// <summary>Masters 淘汰赛：4 直通种子 × 4 瑞士轮出线，错位回避同赛区，双败树。</summary>
    private static void BuildMastersPlayoffs(GameState state, List<NewsItem> notes, List<string> qualified)
    {
        var direct = new List<string>();
        foreach (var (rId, _, _) in Regions)
        {
            var table = SortedTable(state, $"stage1-{rId}-t1");
            var top = table.Count > 0 ? table[0].TeamId : null; // Stage1 已收官，直通种子可从榜上重推导
            if (top != null) direct.Add(top);
        }
        if (direct.Count != 4 || qualified.Count != 4) return;
        // 瑞士轮出线种子：(w-l) 降序 + id 升序（TS 显式平局裁决）
        var swissSeeds = qualified
            .Select(id => (Id: id, Wl: MasterRecord(state, id).W - MasterRecord(state, id).L))
            .OrderByDescending(x => x.Wl)
            .ThenBy(x => x.Id, StringComparer.Ordinal)
            .Select(x => x.Id)
            .ToList();
        string RegionOf(string id) => state.Teams.TryGetValue(id, out var t) ? t.RegionId : "";
        var pool = swissSeeds.ToList();
        var pairs = new List<(string A, string B)>();
        foreach (var d in direct)
        {
            int idx = pool.FindIndex(s => RegionOf(s) != RegionOf(d));
            if (idx < 0) idx = 0;
            pairs.Add((d, pool[idx]));
            pool.RemoveAt(idx);
        }
        var swiss = state.Fixtures.Where(f => f.Comp == "masters" && f.Label.Contains("瑞士轮", StringComparison.Ordinal)).ToList();
        int lastDay = swiss.Max(f => f.Day);
        Fixtures.BuildDoubleElim(state.Fixtures, "masters", "Masters", "masters", pairs, lastDay + 4, 3, 3);
        notes.Add(new NewsItem
        {
            Day = state.Day, Kind = "league", Important = true,
            Text = $"🌍 Masters 淘汰赛对阵出炉：{string.Join("、", pairs.Select(p => $"{Tag(state, p.A)} vs {Tag(state, p.B)}"))}，双败淘汰。",
        });
    }

    private static string Tag(GameState state, string id) => state.Teams.TryGetValue(id, out var t) ? t.Tag : "?";

    private static string TeamName(GameState state, string id) => state.Teams.TryGetValue(id, out var t) ? t.Name : "?";

    /// <summary>Champions 年末冠军赛（GDD §7.3）：每赛区冠军积分前 4 共 16 队 → 4 组 GSL 双败小组 → 8 队双败淘汰。</summary>
    private static void BuildChampions(GameState state, List<NewsItem> notes)
    {
        if (state.Comps.ContainsKey("champions")) return;
        var regionTop = new List<List<string>>();
        foreach (var (rId, _, _) in Regions)
        {
            var t1 = (state.Comps.TryGetValue($"stage2-{rId}-t1", out var c) ? c.TeamIds : new List<string>())
                .Where(id => state.Teams.ContainsKey(id)).ToList();
            var pos = new Dictionary<string, int>();
            var table = SortedTable(state, $"stage2-{rId}-t1");
            for (int i = 0; i < table.Count; i++) pos[table[i].TeamId] = i;
            var ranked = t1
                .OrderByDescending(id => state.CircuitPoints.TryGetValue(id, out var p) ? p : 0)
                .ThenBy(id => pos.GetValueOrDefault(id, 99))
                .ThenBy(id => id, StringComparer.Ordinal)
                .ToList();
            if (ranked.Count < 4) return; // 赛区队伍不足不开赛（防御）
            regionTop.Add(ranked.Take(4).ToList());
        }
        // 分组：每组每赛区恰 1 队（循环错位），头名种子分散到不同组
        var groups = new[] { "A", "B", "C", "D" }.Select((_, gi) =>
            regionTop.Select((top, ri) => top[(gi + ri) % 4]).ToList()).ToList();
        var all = groups.SelectMany(g => g).ToList();
        state.Comps["champions"] = new Competition { Key = "champions", Name = "Champions 冠军赛", Stage = "champions", TeamIds = all, Standings = new OrderedDict<string, StandingsEntry>() };
        foreach (var id in all)
        {
            state.Comps["champions"].Standings[id] = new StandingsEntry { TeamId = id };
        }
        for (int gi = 0; gi < groups.Count; gi++)
        {
            var g = groups[gi];
            foreach (var (a, b) in new[] { (g[0], g[1]), (g[2], g[3]) })
            {
                state.Fixtures.Add(Fixtures.CreateFixture(new Fixture
                {
                    Day = CALENDAR.ChampionsGroupStart, Stage = "champions", Comp = "champions",
                    TeamA = a, TeamB = b, Bo = 3, Label = $"Champions {"ABCD"[gi]}组 揭幕战",
                }));
            }
        }
        notes.Add(new NewsItem
        {
            Day = state.Day, Kind = "league", Important = true,
            Text = "🏆 Champions 冠军赛抽签：16 队按冠军积分入席，4 组 GSL 双败小组（前二出线）→ 8 队双败淘汰，全年最高荣誉开战。",
        });
    }

    /// <summary>已打比赛的胜者：WinnerTeamId 为唯一事实源（旧档缺失时按积分兜底）。</summary>
    private static string FixtureWinner(GameState state, Fixture f)
    {
        if (f.WinnerTeamId != null) return f.WinnerTeamId;
        int pa = state.Comps.TryGetValue(f.Comp, out var ca) && ca.Standings.TryGetValue(f.TeamA, out var sa) ? sa.Pts : 0;
        int pb = state.Comps.TryGetValue(f.Comp, out var cb) && cb.Standings.TryGetValue(f.TeamB, out var sb) ? sb.Pts : 0;
        return pa >= pb ? f.TeamA : f.TeamB;
    }

    /// <summary>Champions 推进：各组揭幕战打完 → 胜者组/败者组决赛；打完 → 出线决定赛；4 组齐 → 8 队双败淘汰。</summary>
    private static void ProgressChampions(GameState state, List<NewsItem> notes)
    {
        if (!state.Comps.TryGetValue("champions", out var comp)) return;
        var fx = state.Fixtures.Where(f => f.Comp == "champions").ToList();
        if (fx.Any(f => f.Label.Contains("胜者组第1轮", StringComparison.Ordinal))) return; // 淘汰赛已建
        var groups = new[] { "A", "B", "C", "D" };
        var deciders = new List<(string Group, int Day, string Winner, string RunnerUp)>();
        foreach (var g in groups)
        {
            List<Fixture> Of(string tag) => fx.Where(f => f.Label == $"Champions {g}组 {tag}").ToList();
            var openers = Of("揭幕战");
            if (openers.Count != 2 || openers.Any(f => !f.Played)) continue;
            var wl = Of("胜者组决赛").Concat(Of("败者组决赛")).ToList();
            if (wl.Count == 0)
            {
                var o1 = openers[0];
                var o2 = openers[1];
                var w1 = FixtureWinner(state, o1);
                var l1 = o1.TeamA == w1 ? o1.TeamB : o1.TeamA;
                var w2 = FixtureWinner(state, o2);
                var l2 = o2.TeamA == w2 ? o2.TeamB : o2.TeamA;
                int day = o1.Day + 3;
                state.Fixtures.Add(Fixtures.CreateFixture(new Fixture { Day = day, Stage = "champions", Comp = "champions", TeamA = w1, TeamB = w2, Bo = 3, Label = $"Champions {g}组 胜者组决赛" }));
                state.Fixtures.Add(Fixtures.CreateFixture(new Fixture { Day = day, Stage = "champions", Comp = "champions", TeamA = l1, TeamB = l2, Bo = 3, Label = $"Champions {g}组 败者组决赛" }));
                continue;
            }
            if (wl.Any(f => !f.Played)) continue;
            var wF = Of("胜者组决赛").FirstOrDefault();
            var lF = Of("败者组决赛").FirstOrDefault();
            if (wF == null || lF == null) continue;
            var decider = Of("出线决定赛").FirstOrDefault();
            if (decider == null)
            {
                var wFLoser = wF.TeamA == FixtureWinner(state, wF) ? wF.TeamB : wF.TeamA;
                var lFWinner = FixtureWinner(state, lF);
                state.Fixtures.Add(Fixtures.CreateFixture(new Fixture
                {
                    Day = wF.Day + 3, Stage = "champions", Comp = "champions",
                    TeamA = wFLoser, TeamB = lFWinner, Bo = 3, Label = $"Champions {g}组 出线决定赛",
                }));
                continue;
            }
            if (!decider.Played) continue;
            deciders.Add((g, decider.Day, FixtureWinner(state, wF), FixtureWinner(state, decider)));
        }
        if (deciders.Count != 4) return;
        // 淘汰赛对阵：小组第一 × 邻组第二（W_A-R_B / W_B-R_C / W_C-R_D / W_D-R_A）
        var byGroup = deciders.ToDictionary(d => d.Group, d => d);
        var order = groups.Select((g, i) =>
        {
            var w = byGroup[g];
            var r = byGroup[groups[(i + 1) % 4]];
            return (w.Winner, r.RunnerUp);
        }).ToList();
        int lastDay = deciders.Max(d => d.Day);
        Fixtures.BuildDoubleElim(state.Fixtures, "champions", "Champions", "champions", order, lastDay + 4, 3, 3);
        notes.Add(new NewsItem
        {
            Day = state.Day, Kind = "league", Important = true,
            Text = $"🏆 Champions 淘汰赛八强出炉：{string.Join("、", order.Select(p => $"{Tag(state, p.Item1)} vs {Tag(state, p.Item2)}"))}，双败淘汰，胜者加冕世界冠军。",
        });
    }

    private static void ApplyStandings(GameState state, string compKey, string teamA, string teamB, int scoreA, int scoreB, List<MapRecord> maps)
    {
        if (!state.Comps.TryGetValue(compKey, out var comp)) return;
        if (!comp.Standings.TryGetValue(teamA, out var sa) || !comp.Standings.TryGetValue(teamB, out var sb)) return;
        if (scoreA > scoreB)
        {
            sa.W++; sb.L++; sa.Pts += 3;
        }
        else
        {
            sb.W++; sa.L++; sb.Pts += 3;
        }
        sa.MapW += scoreA; sa.MapL += scoreB;
        sb.MapW += scoreB; sb.MapL += scoreA;
        foreach (var m in maps)
        {
            sa.RoundW += m.ScoreA; sa.RoundL += m.ScoreB;
            sb.RoundW += m.ScoreB; sb.RoundL += m.ScoreA;
        }
    }

    /// <summary>周结算（每 7 天）：团队课表与个人训练并行（GDD §6.3）+ 疲劳恢复、状态/士气回归。</summary>
    private static void WeeklyTick(GameState state, Rng rng)
    {
        var myTeam = state.MyTeamId != null && state.Teams.TryGetValue(state.MyTeamId, out var mt) ? mt : null;
        // 难度预算微调（v1.0-7，GDD §9.5）：困难/职业下 AI 一级队每周联盟补贴
        int aiSub = state.Difficulty == "pro" ? 12_000 : state.Difficulty == "hard" ? 6_000 : 0;
        if (aiSub > 0)
        {
            foreach (var t in state.Teams.Values)
            {
                if (t.Tier == 1 && t.Id != state.MyTeamId) t.Budget += aiSub;
            }
        }
        int trainDays = state.TeamSchedule.Count(s => s != "rest");
        // 比赛日占槽（GDD §6.3 v1.9 检错）：本周我的正式比赛天数折减训练收益
        string myId = state.MyTeamId ?? "";
        int weekStart = state.Day - 6;
        int myMatchDays = myTeam != null
            ? state.Fixtures
                .Where(f => f.Played && f.Day >= weekStart && f.Day <= state.Day && (f.TeamA == myId || f.TeamB == myId))
                .Select(f => f.Day).Distinct().Count()
            : 0;
        double matchFactor = (7 - Math.Min(7, myMatchDays)) / 7.0; // 比赛日越多，训练收益越低

        // ── 团队层：跑图涨图池熟练（每天 +0.4，浮点累进——round 会吃掉小数增量）──
        if (myTeam != null)
        {
            foreach (var slot in state.TeamSchedule)
            {
                if (slot == "map")
                {
                    foreach (var mid in state.TrainingMaps)
                    {
                        myTeam.MapPref[mid] = MathUtil.Clamp((myTeam.MapPref.TryGetValue(mid, out var mp) ? mp : 50) + 0.4 * matchFactor, 20, 95);
                    }
                }
            }
        }

        foreach (var p in state.Players.Values)
        {
            if (p.InjuredUntilDay > state.Day) continue;
            bool isMine = myTeam != null && p.TeamId == myTeam.Id;
            double acadF = p.Homegrown && p.Age <= 18 && (myTeam?.Academy?.Contains(p.Id) ?? false) ? 1.5 : 1.0;
            if (myTeam != null && isMine)
            {
                // ── 团队层选手效果：复盘日给全队意识/沟通经验 ──
                int reviewDays = state.TeamSchedule.Count(s => s == "review");
                double cap = Math.Min(99, p.Potential + 5);
                if (reviewDays > 0)
                {
                    p.Xp["awareness"] = (p.Xp.TryGetValue("awareness", out var aw) ? aw : 0) + reviewDays * 1.2 * acadF;
                    p.Xp["communication"] = (p.Xp.TryGetValue("communication", out var cm) ? cm : 0) + reviewDays * 0.6 * acadF;
                }
                // ── 个人层（并行）：每周一个项目，非休息日按天积累经验（GDD §6.3）──
                string focus = state.Schedules.TryGetValue(p.Id, out var fc) ? fc : "rest";
                var opt = Training.OptionByKey(focus);
                int effTrainDays = Math.Max(0, trainDays - myMatchDays);
                if (opt != null && opt.Attr != null && effTrainDays > 0)
                {
                    double attrCap = Math.Min(99, p.Potential + 5);
                    if (AttrGet(p.Attrs, opt.Attr) < attrCap)
                    {
                        double moraleF = 0.75 + p.Morale / 200;
                        double fatigueF = p.Fatigue > 70 ? 0.5 : p.Fatigue > 45 ? 0.8 : 1;
                        double coachF = 1 + (myTeam.Coach.Development - 55) / 100.0;
                        double commF = 1 - 0.25 * Math.Min(2, p.CommercialDays); // 商务占用惩罚（GDD §8.4）
                        double staffF = 1 + (myTeam.Staff.Training?.Value ?? 0) * 0.004; // 训练助教（GDD §8.3）
                        double moodF = state.Manager?.Life?.Mood < 30 ? 0.9 : 1; // 教练心情低落 → -10%（GDD v0.5-5）
                        double facF = 0.85 + myTeam.Facilities / 250.0; // 设施乘数（v0.8）
                        double learnF = p.Track == "learner" ? 1.1 : 1; // 学习型替补 +10%（GDD §6.4）
                        double gain = rng.Range(Training.XpPerDay.Lo, Training.XpPerDay.Hi) * effTrainDays * moraleF * fatigueF * coachF * commF * staffF * moodF * facF * acadF * learnF;
                        p.Xp[opt.Attr] = (p.Xp.TryGetValue(opt.Attr, out var xv) ? xv : 0) + gain;
                    }
                }
                else if (focus == "rest")
                {
                    p.Fatigue = MathUtil.Clamp(p.Fatigue - 2, 0, 100);
                }
                if (p.Stream != null && p.Stream.UntilDay > state.Day) p.Fatigue = MathUtil.Clamp(p.Fatigue + 2, 0, 100); // 直播占用（GDD §8.4）
                // 经验满 100 → 属性 +1（可多次触发；读池子当前值，否则跨过 100 会死循环——v1.9 检错）
                foreach (var attrKey in p.Xp.Keys.ToList())
                {
                    while (p.Xp.TryGetValue(attrKey, out var cur) && cur >= Training.XpPerAttrPoint)
                    {
                        p.Xp[attrKey] = cur - Training.XpPerAttrPoint;
                        AttrSet(p.Attrs, attrKey, MathUtil.Clamp(AttrGet(p.Attrs, attrKey) + 1, 30, cap));
                    }
                }
                p.Overall = Worldgen.ComputeOverall(p.Attrs);
                // 出场期望（GDD §6.4①）：核心/首发承诺坐板凳 → 周士气惩罚；轮换/替补获得首发 → 安心
                // 轮换沟通豁免（GDD §6.4②）：本周已沟通的选手不受罚
                bool waive = state.RotationWaive.Contains(p.Id);
                if ((p.PromisedRole == "core" || p.PromisedRole == "starter") && !myTeam.Starters.Contains(p.Id) && p.InjuredUntilDay <= state.Day && !waive)
                {
                    p.Morale = MathUtil.Clamp(p.Morale - 3, 10, 100);
                }
                else if ((p.PromisedRole == "rotation" || p.PromisedRole == "bench") && myTeam.Starters.Contains(p.Id))
                {
                    p.Morale = MathUtil.Clamp(p.Morale + 2, 10, 100);
                }
                // 团队课表的体能效果
                foreach (var slot in state.TeamSchedule)
                {
                    if (slot == "scrim") p.Fatigue = MathUtil.Clamp(p.Fatigue + 5, 0, 100);
                    else if (slot == "map") p.Fatigue = MathUtil.Clamp(p.Fatigue + 2, 0, 100);
                    else if (slot == "individual") p.Fatigue = MathUtil.Clamp(p.Fatigue + 3, 0, 100); // 旧档兼容
                }
            }
            p.Fatigue = MathUtil.Clamp(p.Fatigue - rng.Range(15, 28), 0, 100);
            p.Form = MathUtil.Clamp(p.Form + (70 - p.Form) * 0.06 + rng.Range(-2, 2), 30, 99);
            p.Morale = MathUtil.Clamp(p.Morale + (68 - p.Morale) * 0.05 + rng.Range(-1.5, 1.5), 10, 100);
            var team = p.TeamId != null && state.Teams.TryGetValue(p.TeamId, out var tm) ? tm : null;
            if (team != null)
            {
                if (team.Starters.Contains(p.Id)) p.BenchedWeeks = 0;
                else if (p.Track == "successor" || p.Track == "mentor")
                {
                    // 替补三正路（GDD §6.4）：接班人出场期望减半 / 导师型传帮带——不积累板凳不满
                    // 接班人的导师离队 → 自动转正为首发承诺（忠诚 +15 折算为士气与安定）
                    if (p.Track == "successor" && p.MentorId != null && !team.Roster.Contains(p.MentorId))
                    {
                        p.PromisedRole = "starter";
                        p.Morale = MathUtil.Clamp(p.Morale + 15, 10, 100);
                        p.Track = null;
                        p.MentorId = null;
                        state.TransferFeed.Add(new TransferFeedItem { Day = state.Day, Year = state.Year, Kind = "list", Text = $"⭐ 导师离队：{team.Name} 的 {p.Ign} 按接班人计划自动升为首发承诺。" });
                        if (state.TransferFeed.Count > 300) state.TransferFeed.RemoveRange(0, state.TransferFeed.Count - 300);
                    }
                }
                else p.BenchedWeeks++;
            }
        }
    }

    private static double AttrGet(PlayerAttrs a, string k) => k switch
    {
        "aim" => a.Aim, "reaction" => a.Reaction, "awareness" => a.Awareness, "utility" => a.Utility,
        "clutch" => a.Clutch, "teamwork" => a.Teamwork, "communication" => a.Communication, "igl" => a.Igl,
        _ => 50,
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
        }
    }

    private static void SetStage(GameState state)
    {
        int d = state.Day;
        state.Stage =
            d <= CALENDAR.PreseasonEnd ? "preseason"
            : d <= CALENDAR.CupEnd ? "cup"
            : d <= CALENDAR.Stage1End ? "stage1"
            : d <= CALENDAR.SummerEnd ? "summer"
            : d <= CALENDAR.Stage2End ? "stage2"
            // Champions 窗口（v1.0-3b）：抽签到总决赛打完显示为冠军赛阶段，随赛程自然漂移
            : state.Comps.ContainsKey("champions") && !state.Fixtures.Any(f => f.Comp == "champions" && f.Label.Contains("总决赛", StringComparison.Ordinal) && f.Played)
                ? "champions"
                : "offseason";
    }

    /// <summary>阶段收官结算：按最终名次结算董事会目标（GDD §9.5）。</summary>
    private static void SettleObjective(GameState state, string compKey, string stageName, List<NewsItem> notes)
    {
        var obj = state.Objective;
        if (obj == null || state.MyTeamId == null) return;
        var table = SortedTable(state, compKey);
        int place = table.FindIndex(s => s.TeamId == state.MyTeamId) + 1;
        if (place <= 0) return;
        bool met = place <= obj.PlaceAtLeast;
        state.BoardConfidence = (int)MathUtil.Clamp(state.BoardConfidence + (met ? Math.Min(14, 6 + (obj.PlaceAtLeast - place) * 2) : -Math.Min(16, 2 + (place - obj.PlaceAtLeast) * 3)), 0, 100);
        notes.Add(new NewsItem
        {
            Day = state.Day, Kind = "club", Important = true,
            Text = met
                ? $"✅ {stageName}目标达成：第 {place} 名（要求前 {obj.PlaceAtLeast}），董事会满意。"
                : $"❌ {stageName}目标未达成：第 {place} 名（要求前 {obj.PlaceAtLeast}），董事会不满。",
        });
    }

    /// <summary>我的球队所在联赛 comp key（按赛区 + 级别）。</summary>
    private static string? MyLeagueCompKey(GameState state, string stage)
    {
        if (state.MyTeamId == null) return null;
        if (!state.Teams.TryGetValue(state.MyTeamId, out var t)) return null;
        return $"{stage}-{(string.IsNullOrEmpty(t.RegionId) ? "xia" : t.RegionId)}-t{t.Tier}";
    }

    /// <summary>中段里程碑（v1.x 用户反馈①）：Stage1/Stage2 赛程中点即时名次 → 进度新闻 + 信心 ±2。</summary>
    private static void MidSeasonCheckpoint(GameState state, string stage, string stageName, List<NewsItem> notes)
    {
        if (state.MyTeamId == null) return;
        var compKey = MyLeagueCompKey(state, stage);
        var table = compKey != null ? SortedTable(state, compKey) : new List<StandingsEntry>();
        if (table.Count < 2) return;
        int place = table.FindIndex(s => s.TeamId == state.MyTeamId) + 1;
        if (place <= 0) return;
        bool onPace = place <= (int)Math.Ceiling(table.Count / 2.0);
        state.BoardConfidence = (int)MathUtil.Clamp(state.BoardConfidence + (onPace ? 2 : -2), 0, 100);
        var obj = state.Objective != null && state.Objective.Stage == stage ? $"（目标前 {state.Objective.PlaceAtLeast}）" : "";
        notes.Add(new NewsItem
        {
            Day = state.Day, Kind = "club",
            Text = onPace
                ? $"📊 {stageName}中期检查：目前第 {place} 名 / 共 {table.Count} 队{obj}，管理层认可进度（信心 +2）。"
                : $"📊 {stageName}中期检查：目前第 {place} 名 / 共 {table.Count} 队{obj}，成绩低于预期，董事会开始关注（信心 -2）。",
        });
    }

    /// <summary>冠军积分表（GDD §7.3 v1.0）：揭幕杯 [6,4,3,2] / 联赛 [9,7,5,4,3,3,2,2] / Masters 双败口径。</summary>
    private static readonly double[] CupCircuit = { 6, 4, 3, 2 };
    private static readonly double[] LeagueCircuit = { 9, 7, 5, 4, 3, 3, 2, 2 };
    private static readonly double[] MastersCircuit = { 12, 9, 7, 7, 5, 5, 4, 4 };

    private static void AddCircuit(GameState state, string teamId, double pts)
    {
        state.CircuitPoints[teamId] = (state.CircuitPoints.TryGetValue(teamId, out var p) ? p : 0) + pts;
    }

    private static List<StandingsEntry> SortedTable(GameState state, string compKey)
    {
        // TS sort 稳定语义：pts 降序 → mapDiff 降序 → roundDiff 降序，平序保持插入序（= teamIds 序）
        var src = (state.Comps.TryGetValue(compKey, out var c) ? c.Standings.Values : Enumerable.Empty<StandingsEntry>()).ToList();
        return src.OrderByDescending(s => s.Pts)
            .ThenByDescending(s => s.MapW - s.MapL)
            .ThenByDescending(s => s.RoundW - s.RoundL)
            .ToList();
    }

    /// <summary>公开积分榜（晋级体系等 C# 侧系统读取；排序语义同 SortedTable）。</summary>
    public static List<StandingsEntry> PublicSortedTable(GameState state, string compKey) => SortedTable(state, compKey);

    /// <summary>联赛收官发积分（仅 t1 合作联赛计入国际赛积分；挑战者不计）。</summary>
    public static void AwardLeagueCircuitPoints(GameState state, string compKey)
    {
        if (!compKey.EndsWith("t1", StringComparison.Ordinal)) return;
        var table = SortedTable(state, compKey);
        for (int i = 0; i < table.Count && i < LeagueCircuit.Length; i++) AddCircuit(state, table[i].TeamId, LeagueCircuit[i]);
    }

    /// <summary>杯赛/Masters 总决赛落幕发积分。</summary>
    public static void AwardCupCircuitPoints(GameState state, string comp, List<NewsItem> notes, string champTeamId)
    {
        var final = state.Fixtures.FirstOrDefault(f => f.Comp == comp && f.Label.Contains("总决赛", StringComparison.Ordinal) && f.Played);
        if (final == null) return;
        var runnerUp = final.TeamA == champTeamId ? final.TeamB : final.TeamA;
        List<string> order;
        if (comp == "masters")
        {
            string LoserOf(Fixture f)
            {
                var w = FixtureWinner(state, f);
                return f.TeamA == w ? f.TeamB : f.TeamA;
            }
            List<Fixture> Find(string tag) =>
                state.Fixtures.Where(f => f.Comp == "masters" && f.Label.EndsWith(tag, StringComparison.Ordinal) && f.Played).ToList();
            var lbF = Find("败者组决赛").FirstOrDefault();
            var lbR3 = Find("败者组第3轮").FirstOrDefault();
            var lbR2 = Find("败者组第2轮");
            var lbR1 = Find("败者组第1轮");
            if (lbF != null && lbR3 != null && lbR2.Count >= 2 && lbR1.Count >= 2)
            {
                order = new List<string> { champTeamId, runnerUp, LoserOf(lbF), LoserOf(lbR3) };
                order.AddRange(lbR2.Select(LoserOf));
                order.AddRange(lbR1.Select(LoserOf));
            }
            else
            {
                // 旧档回退：升级前生成的单败树按名次入账
                var sfLosers = state.Fixtures
                    .Where(f => f.Comp == "masters" && f.Label.Contains("半决赛", StringComparison.Ordinal) && f.Played)
                    .Select(f => (f.TeamA == final.TeamA || f.TeamA == final.TeamB) ? f.TeamB : f.TeamA)
                    .ToList();
                order = new List<string> { champTeamId, runnerUp };
                order.AddRange(sfLosers);
            }
        }
        else
        {
            var sfLosers = state.Fixtures
                .Where(f => f.Comp == comp && f.Label.Contains("半决赛", StringComparison.Ordinal) && f.Played)
                .Select(f => (f.TeamA == final.TeamA || f.TeamA == final.TeamB) ? f.TeamB : f.TeamA)
                .ToList();
            order = new List<string> { champTeamId, runnerUp };
            order.AddRange(sfLosers);
        }
        var table = comp == "masters" ? MastersCircuit : CupCircuit;
        for (int i = 0; i < order.Count; i++)
        {
            if (order[i] != null) AddCircuit(state, order[i], i < table.Length ? table[i] : table[table.Length - 1]);
        }
        notes.Add(new NewsItem { Day = state.Day, Kind = "league", Text = $"📈 {TeamName(state, champTeamId)} 收获 {table[0]} 冠军积分（Champions 资格竞逐）。" });
    }

    /// <summary>国际赛总决赛落幕统一结算：冠军荣誉 + 新闻 + 冠军积分（Champions 为赛季终点，不计积分）。</summary>
    private static void SettleFinal(GameState state, Fixture f, MatchRecord rec, List<NewsItem> notes)
    {
        if (!f.Label.Contains("总决赛", StringComparison.Ordinal)) return;
        if (f.Comp != "cup" && f.Comp != "masters" && f.Comp != "champions") return;
        var champ = rec.Winner == "A" ? f.TeamA : f.TeamB;
        if (!state.Teams.TryGetValue(champ, out var champTeam)) return;
        foreach (var pid in champTeam.Roster)
        {
            if (state.Players.TryGetValue(pid, out var p)) p.Career.Titles++; // 冠军荣誉（GDD §8.3）
        }
        var compName = f.Comp == "masters" ? "Masters 国际赛" : f.Comp == "champions" ? "Champions 世界冠军赛" : "揭幕杯";
        notes.Add(new NewsItem { Day = state.Day, Kind = "league", Important = true, Text = $"🏆 {champTeam.Name} 夺得{compName}冠军！" });
        Career.NoteManagerTitle(state, champ, f.Comp); // 经理生涯冠军计数（分类入账）
        Narrative.NarrativeOnTitle(state, notes); // 王朝里程碑
        if (f.Comp != "champions") AwardCupCircuitPoints(state, f.Comp, notes, champ);
    }

    private static void AwardLeagueTitle(GameState state, string compKey, List<NewsItem> notes)
    {
        var table = SortedTable(state, compKey);
        var champ = table.Count > 0 ? table[0].TeamId : null;
        if (champ == null) return;
        Career.NoteManagerTitle(state, champ, "league"); // 经理生涯冠军计数
        // 冠军积分：仅 t1 合作联赛计入（挑战者不计）
        if (compKey.EndsWith("t1", StringComparison.Ordinal)) AwardLeagueCircuitPoints(state, compKey);
        // 赞助业绩条款倍率（§8.4 v1.4）：我的联赛夺冠 ×1.5 / 四强 ×1.2
        if (state.MyTeamId != null && compKey.EndsWith("t1", StringComparison.Ordinal))
        {
            int myIdx = table.FindIndex(r => r.TeamId == state.MyTeamId);
            if (myIdx == 0)
            {
                state.SponsorMult = 1.5;
                notes.Add(new NewsItem { Day = state.Day, Kind = "league", Important = true, Text = "💰 夺冠触发赞助业绩条款：带条款赞助收入 ×1.5（本赛段余下周期）。" });
            }
            else if (myIdx >= 0 && myIdx < 4)
            {
                state.SponsorMult = 1.2;
                notes.Add(new NewsItem { Day = state.Day, Kind = "league", Text = "💰 联赛四强触发赞助业绩条款：带条款赞助收入 ×1.2（本赛段余下周期）。" });
            }
            else
            {
                state.SponsorMult = 1;
            }
        }
        if (state.Teams.TryGetValue(champ, out var champTeam))
        {
            foreach (var pid in champTeam.Roster)
            {
                if (state.Players.TryGetValue(pid, out var p)) p.Career.Titles++;
            }
        }
        var m = Regex.Match(compKey, @"^stage(\d)-([a-z]+)-t(\d)$");
        var label = m.Success
            ? $"{RegionLabel(m.Groups[2].Value)}{(m.Groups[3].Value == "2" ? "挑战者联赛" : "联赛")} Stage {m.Groups[1].Value}"
            : compKey;
        notes.Add(new NewsItem { Day = state.Day, Kind = "league", Important = true, Text = $"🏆 {TeamName(state, champ)} 加冕 {label} 冠军" });
        Narrative.NarrativeOnTitle(state, notes); // 王朝里程碑：我夺冠后按生涯冠军数触发全联盟反应文案
    }

    /// <summary>推进一天。onMatch：每场结束回调。mineHold：我的比赛开打前暂停（返回 true 表示拦截）。</summary>
    public static AdvanceResult AdvanceDay(
        GameState state,
        List<NewsItem>? notes = null,
        Action<MatchRecord, string, bool>? onMatch = null,
        Func<string, string, string, int, string, bool>? mineHold = null)
    {
        notes ??= new List<NewsItem>();
        state.Day++;
        SetStage(state);
        state.ActionPoints = 3;
        var rng = new Rng(Rng.HashString($"{state.Seed}:day:{state.Day}"));
        var playedMine = new List<string>();
        bool seasonEnded = false;
        bool held = false;

        // 教练个人生活（GDD v0.5-5）：饥饿/心情每日衰减 + 月薪入个人钱包
        if (state.Manager?.Life != null)
        {
            var life = state.Manager.Life;
            life.Hunger = Math.Max(0, Math.Min(100, life.Hunger - 3));
            life.Mood = Math.Max(10, Math.Min(100, life.Mood - 1));
            if (state.Day % 30 == 0) life.Wallet += 5_833; // 70K 年薪 / 12
        }

        // 阶段切换
        if (state.Day == CALENDAR.CupStart)
        {
            notes.Add(new NewsItem { Day = state.Day, Kind = "league", Text = "—— 进入揭幕杯 ——" });
        }
        else if (state.Day == CALENDAR.Stage1Start)
        {
            notes.Add(new NewsItem { Day = state.Day, Kind = "league", Text = "—— 进入 Stage 1 联赛 ——" });
            // 版本发布（GDD §4.3 meta 二维化）：每赛段重掷英雄 meta
            string seg = "1"; // TS 三元：此分支恒为 stage1Start
            var patch = Patch.RollPatch(state, seg, rng);
            notes.Add(new NewsItem { Day = state.Day, Kind = "league", Important = true, Text = $"📢 版本 {patch.Version} 发布：{string.Join("、", patch.Changes.Select(c => $"{CoreData.Agent(c.AgentId)?.Name ?? c.AgentId} {(c.Dir == "buff" ? "↑" : "↓")}{c.Pct}%"))}。" });
            if (state.MyTeamId != null)
            {
                bool chal = state.Teams.TryGetValue(state.MyTeamId, out var myT) && myT.Tier == 2;
                state.Objective = new Objective { Stage = "stage1", PlaceAtLeast = 4, Text = chal ? "董事会要求：Stage 1 挑战者联赛进入前四。" : "董事会要求：Stage 1 联赛进入前四。" };
                notes.Add(new NewsItem { Day = state.Day, Kind = "club", Important = true, Text = state.Objective.Text });
            }
        }
        else if (state.Day == CALENDAR.Stage1Mid)
        {
            MidSeasonCheckpoint(state, "stage1", "Stage 1", notes);
        }
        else if (state.Day == CALENDAR.SummerStart)
        {
            // Stage1 收官：结算目标 + 冠军荣誉 + Masters 抽签
            SettleObjective(state, MyLeagueCompKey(state, "stage1") ?? "stage1-xia-t1", "Stage 1", notes);
            foreach (var comp in state.Comps.Values.ToList())
            {
                if (Regex.IsMatch(comp.Key, @"^stage1-[a-z]+-t[12]$")) AwardLeagueTitle(state, comp.Key, notes);
            }
            BuildMasters(state, notes);
            notes.Add(new NewsItem { Day = state.Day, Kind = "league", Text = "—— 进入夏季窗口（休整与练兵）——" });
        }
        else if (state.Day == CALENDAR.Stage2Start)
        {
            notes.Add(new NewsItem { Day = state.Day, Kind = "league", Text = "—— 进入 Stage 2 联赛 ——" });
            var patch2 = Patch.RollPatch(state, "2", rng);
            notes.Add(new NewsItem { Day = state.Day, Kind = "league", Important = true, Text = $"📢 版本 {patch2.Version} 发布：{string.Join("、", patch2.Changes.Select(c => $"{CoreData.Agent(c.AgentId)?.Name ?? c.AgentId} {(c.Dir == "buff" ? "↑" : "↓")}{c.Pct}%"))}。" });
            if (state.MyTeamId != null)
            {
                int tier = state.Teams.TryGetValue(state.MyTeamId, out var myT2) ? myT2.Tier : 1;
                state.Objective = new Objective { Stage = "stage2", PlaceAtLeast = 4, Text = tier == 2 ? "董事会要求：Stage 2 挑战者联赛进入前四。" : "董事会要求：Stage 2 联赛进入前四。" };
                notes.Add(new NewsItem { Day = state.Day, Kind = "club", Important = true, Text = state.Objective.Text });
            }
        }
        else if (state.Day == CALENDAR.Stage2Mid)
        {
            MidSeasonCheckpoint(state, "stage2", "Stage 2", notes);
        }
        else if (state.Day == CALENDAR.OffseasonStart)
        {
            // Stage2 收官
            SettleObjective(state, MyLeagueCompKey(state, "stage2") ?? "stage2-xia-t1", "Stage 2", notes);
            foreach (var comp in state.Comps.Values.ToList())
            {
                if (Regex.IsMatch(comp.Key, @"^stage2-[a-z]+-t[12]$")) AwardLeagueTitle(state, comp.Key, notes);
            }
            notes.Add(new NewsItem { Day = state.Day, Kind = "league", Text = "—— 进入休赛期 ——" });
        }
        else if (state.Day == CALENDAR.ChampionsDraw)
        {
            BuildChampions(state, notes);
        }
        else if (state.Day == CALENDAR.DraftDay)
        {
            Draft.RunDraft(state, notes);
        }

        // 逾期清扫：过期未打的比赛按"错过准备"自动补打，避免赛程/杯赛树永久卡死
        var overdue = state.Fixtures.Where(f => !f.Played && f.Day < state.Day && f.TeamA != "" && f.TeamB != "").ToList();
        foreach (var f in overdue)
        {
            bool mine = f.TeamA == state.MyTeamId || f.TeamB == state.MyTeamId;
            long seed = Rng.HashString($"{state.Seed}:{f.Id}");
            var rec = Match.SimMatch(state, f.TeamA, f.TeamB, f.Bo, seed, f.Id, f.MapLock, f.AgentLock);
            var debuts = mine ? Narrative.CaptureDebuts(state) : null; // 首秀快照：入账前捕获
            Match.ApplyMatchEffects(state, rec);
            f.Played = true;
            f.Settled = true;
            f.WinnerTeamId = rec.Winner == "A" ? f.TeamA : f.TeamB;
            onMatch?.Invoke(rec, f.Id, mine);
            ApplyStandings(state, f.Comp, f.TeamA, f.TeamB, rec.ScoreA, rec.ScoreB, rec.Maps);
            Fixtures.FillNextSlot(state.Fixtures, f, rec.Winner == "A" ? f.TeamA : f.TeamB);
            var tagA = state.Teams[f.TeamA].Tag;
            var tagB = state.Teams[f.TeamB].Tag;
            notes.Add(new NewsItem { Day = state.Day, Kind = "match", Text = $"{f.Label}（补赛）｜{tagA} {rec.ScoreA}-{rec.ScoreB} {tagB}", Important = mine });
            if (mine)
            {
                playedMine.Add(f.Id); // 逾期补赛同样计入我的比赛
                Career.NoteMatchResult(state, (rec.Winner == "A" ? f.TeamA : f.TeamB) == state.MyTeamId, notes);
                Narrative.NarrativeOnMyMatch(state, f.Id, rec, notes, new HashSet<string>(debuts ?? new List<string>()));
            }
            SettleFinal(state, f, rec, notes);
        }

        // 当日比赛
        var todays = state.Fixtures.Where(f => f.Day == state.Day && !f.Played && f.TeamA != "" && f.TeamB != "").ToList();
        foreach (var f in todays)
        {
            bool mine = f.TeamA == state.MyTeamId || f.TeamB == state.MyTeamId;
            if (mine && mineHold != null && !held)
            {
                // TS 权威语义：mineHold 返回 false 同样 continue（比赛顺延为次日补赛）——注释与行为不符，按行为复刻
                if (!mineHold(f.Id, f.TeamA, f.TeamB, f.Bo, f.Label)) continue;
                held = true;
                playedMine.Add(f.Id); // 标记为"我的比赛待打"
                continue; // 暂停：等玩家完成赛前准备后由 PlayHeldMatch 重放
            }
            long seed = Rng.HashString($"{state.Seed}:{f.Id}");
            var rec = Match.SimMatch(state, f.TeamA, f.TeamB, f.Bo, seed, f.Id, f.MapLock, f.AgentLock);
            var debuts = mine ? Narrative.CaptureDebuts(state) : null;
            Match.ApplyMatchEffects(state, rec);
            f.Played = true;
            f.Settled = true;
            f.WinnerTeamId = rec.Winner == "A" ? f.TeamA : f.TeamB;
            onMatch?.Invoke(rec, f.Id, mine);
            ApplyStandings(state, f.Comp, f.TeamA, f.TeamB, rec.ScoreA, rec.ScoreB, rec.Maps);
            Fixtures.FillNextSlot(state.Fixtures, f, rec.Winner == "A" ? f.TeamA : f.TeamB);
            // 招牌战术反向泄露的源头累计（GDD §6.4）：我方正式比赛逐图 +1；指纹同点记录
            if (mine && state.MyTeamId != null && state.Teams.TryGetValue(state.MyTeamId, out var mt))
            {
                foreach (var m in rec.Maps)
                {
                    mt.PatternUsage[m.Map] = (mt.PatternUsage.TryGetValue(m.Map, out var u) ? u : 0) + 1;
                    Match.RecordPatternFingerprint(state, state.MyTeamId, m.Map, f.AgentLock);
                }
            }
            var tagA = state.Teams[f.TeamA].Tag;
            var tagB = state.Teams[f.TeamB].Tag;
            notes.Add(new NewsItem { Day = state.Day, Kind = "match", Text = $"{f.Label}｜{tagA} {rec.ScoreA}-{rec.ScoreB} {tagB}", Important = mine });
            if (mine)
            {
                playedMine.Add(f.Id);
                Career.NoteMatchResult(state, (rec.Winner == "A" ? f.TeamA : f.TeamB) == state.MyTeamId, notes);
                Narrative.NarrativeOnMyMatch(state, f.Id, rec, notes, new HashSet<string>(debuts ?? new List<string>()));
            }
            SettleFinal(state, f, rec, notes);
        }

        // 国际赛推进：瑞士轮逐轮配对/出线接双败淘汰、GSL 小组逐轮接淘汰赛
        ProgressMasters(state, notes);
        ProgressChampions(state, notes);

        // 问价结算（GDD §8.2 原作式异步）：到反馈日出要价+意向
        Transfer.ResolveInquiries(state);

        // 事件卡：生日 + 每日抽取（队列上限 4）
        Events.SpawnBirthdays(state);
        Events.SpawnDailyEvents(state, rng);

        // 周结算
        if (state.Day % 7 == 0)
        {
            WeeklyTick(state, rng);
            Career.CareerWeeklyTick(state, notes); // 下课检查
            Business.RefreshCommercialWeek(state, rng);
            Intel.DecayIntel(state); // 情报过时衰减（GDD §7.2）
            Rumors.WeeklyRumors(state, rng, notes); // 转会传闻/意向生态
            // 轮换沟通周重置（GDD §6.4②）：每周 2 次，跨周清空豁免名单
            int weekIdx = (int)Math.Floor((double)state.Day / 7);
            if (state.RotationTalks.Week != weekIdx)
            {
                state.RotationWaive = new List<string>();
                // 练英雄周结算（GDD §6.3 v0.8）：≤5 人，+4.2×效率；池外英雄达 34 入池
                var trainAgents = state.AgentTraining.Take(5).ToList();
                foreach (var (pid, agentId) in trainAgents)
                {
                    if (!state.Players.TryGetValue(pid, out var p) || p.TeamId != state.MyTeamId || p.InjuredUntilDay > state.Day) continue;
                    double eff = 0.7 + (p.Attrs.Awareness + p.Attrs.Utility) / 400.0;
                    double gain = 4.2 * eff;
                    // 池外英雄从 34 基线起步（首周结算即达标入池）
                    double cur = p.AgentPool.Contains(agentId)
                        ? (p.AgentPro.TryGetValue(agentId, out var ap1) ? ap1 : 34)
                        : Math.Max(34, p.AgentPro.TryGetValue(agentId, out var ap2) ? ap2 : 0);
                    if (cur >= 100) continue;
                    p.AgentPro[agentId] = Math.Min(100, cur + gain);
                    if (!p.AgentPool.Contains(agentId) && p.AgentPro[agentId] >= 34)
                    {
                        p.AgentPool.Add(agentId);
                        state.News.Add(new NewsItem { Day = state.Day, Kind = "league", Text = $"🎭 {p.Ign} 的 {agentId} 练习达标（34），正式进入英雄池。" });
                    }
                }
                state.RotationTalks = new RotationTalksState { Week = weekIdx, Used = 0 };
            }
            // 商务周结算：赞助/直播收入入账 + 邀约刷新（GDD §8.4）
            int bizIncome = Business.WeeklySponsorIncome(state);
            if (bizIncome > 0 && state.MyTeamId != null && state.Teams.TryGetValue(state.MyTeamId, out var myTeam))
            {
                myTeam.Budget += bizIncome;
                Finance.LogFinance(state, "商务周收入（赞助/直播）", bizIncome);
            }
            // AI 转会动态 + 挖角（GDD §8.2）
            var aiNotes = Transfer.AiWeeklyTransfers(state, rng, (offer) =>
            {
                notes.Add(new NewsItem { Day = state.Day, Kind = "transfer", Important = true, Text = offer.Demand });
            });
            foreach (var t in aiNotes) notes.Add(new NewsItem { Day = state.Day, Kind = "transfer", Text = t });
            // 报价答复窗到期：7 天未答复视为拒绝
            var expired = state.IncomingBids.Where(b => state.Day - b.Day > 7).ToList();
            foreach (var b in expired)
            {
                state.Players.TryGetValue(b.PlayerId, out var p);
                if (p != null) p.Morale = MathUtil.Clamp(p.Morale - 4, 10, 100);
                notes.Add(new NewsItem { Day = state.Day, Kind = "transfer", Text = $"⌛ 对 {p?.Ign ?? "?"} 的报价已逾期，视为拒绝（士气 -4）。" });
            }
            state.IncomingBids = state.IncomingBids.Where(b => state.Day - b.Day <= 7).ToList();
        }

        // 年末收官 + 翻年（按自然年天数，闰年 366 天）
        if (state.Day == DaysInYear(state.Year))
        {
            seasonEnded = true;
            notes.Add(new NewsItem { Day = state.Day, Kind = "league", Important = true, Text = $"—— {state.Year} 赛季收官 ——" });
            // 翻年：年龄 +1 / 合同 −1 / 抑制器与事件状态重置 / 新赛季赛程
            state.Year++;
            // 赞助合同到期：年限 −1，归零移除（休赛期窗口 C 内可续签）
            foreach (var t in state.Teams.Values)
            {
                var expiredNames = new List<string>();
                foreach (var s in t.Sponsors)
                {
                    s.Years--;
                    if (s.Years <= 0) expiredNames.Add(s.Name);
                }
                t.Sponsors = t.Sponsors.Where(s => s.Years > 0).ToList();
                if (expiredNames.Count > 0)
                {
                    notes.Add(new NewsItem { Day = 1, Kind = "transfer", Text = $"📢 {t.Name} 的赞助合同到期：{string.Join("、", expiredNames)}。" });
                }
            }
            foreach (var p in state.Players.Values)
            {
                p.Age++;
                // 青训毕业（v0.9 补丁）：学员满 19 岁自动毕业——一线有空位直接补入，否则进自由市场
                if (p.Homegrown && p.Age > 18)
                {
                    var owner = state.Teams.Values.FirstOrDefault(t => t.Academy.Contains(p.Id));
                    if (owner != null)
                    {
                        owner.Academy = owner.Academy.Where(id => id != p.Id).ToList();
                        if (owner.Roster.Count < 7)
                        {
                            owner.Roster.Add(p.Id);
                            p.PromisedRole = "rotation";
                            notes.Add(new NewsItem { Day = 1, Kind = "transfer", Important = true, Text = $"🎓 {owner.Name} 青训毕业：{p.Ign}（{p.Overall}）直升一线名单。" });
                        }
                        else
                        {
                            p.TeamId = null;
                            p.PromisedRole = "bench";
                            notes.Add(new NewsItem { Day = 1, Kind = "transfer", Text = $"🎓 青训毕业：{p.Ign}（{p.Overall}）因一线名单满，进入自由市场。" });
                        }
                    }
                }
                if (p.ContractYears > 0) p.ContractYears--;
                p.LastEventDay = 0;
                p.Stream = null; // 直播合同按绝对 day 计，跨年统一作废
            }
            // 跨年时间窗集合作废（差值类过期在翻年后为负数 → 永不过期、永久残留）
            state.IncomingBids = new List<TransferOffer>();
            state.GigOffers = new List<GigOffer>();
            state.SponsorOffers = new List<SponsorOffer>();
            state.LastEventDay = 0;
            state.Day = 1;
            state.Fixtures = new List<Fixture>();
            state.Objective = null;
            state.BoardConfidence = (int)MathUtil.Clamp(state.BoardConfidence, 20, 90);
            InitSeasonFixtures(state);
            // 冠军积分年度清零：Champions 落幕即赛季积分周期结束
            state.CircuitPoints = new OrderedDict<string, double>();
            // 生涯里程碑（v1.0-6，GDD §9.5）：五年之约 / 第 10 年强制退休
            Career.CheckCareerMilestone(state, notes);
            // 休赛期自由市场补强（GDD §6.5）：按队伍规模等比
            var faRng = new Rng((uint)((int)state.Seed ^ Rng.Imul(state.Year, 0x5f5f)));
            int faScale = Math.Max(1, (int)DetMath.JsRound(state.Teams.Count / 18.0));
            Worldgen.SpawnFreeAgents(state, faRng, 8 * faScale + faRng.Int(0, 4 * faScale));
            // 自由池上限（v0.7 检错）：保留最强 ~90 人
            var fas = state.Players.Values.Where(p => p.TeamId == null).ToList();
            const int faCap = 90;
            if (fas.Count > faCap)
            {
                var keep = new HashSet<string>(fas.OrderByDescending(p => p.Overall).Take(faCap).Select(p => p.Id));
                foreach (var p in fas) if (!keep.Contains(p.Id)) state.Players.Remove(p.Id);
            }
            notes.Add(new NewsItem { Day = 1, Kind = "league", Important = true, Text = $"—— {state.Year} 赛季开始 · 季前准备 ——" });
        }

        // 新闻入档（上限 400 条）
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

        return new AdvanceResult
        {
            Day = state.Day,
            Notes = notes.Select(n => n.Text).ToList(),
            PlayedMine = playedMine,
            SeasonEnded = seasonEnded,
        };
    }

    /// <summary>赛前准备选项（PlayHeldMatch 用）。</summary>
    public sealed class HeldMatchOptions
    {
        public List<string>? Starters { get; set; }
        public List<string>? Maps { get; set; }
        public OrderedDict<string, OrderedDict<string, string>>? AgentPicks { get; set; }
    }

    /// <summary>
    /// 赛前准备完成 → 模拟我的比赛（v1.0-8 交互式改版）：
    /// 只产出 Record 供播放器消费，不结算——玩家可经 InterveneHeldMatch 干预重模拟，
    /// 播放结束/关闭/推进兜底时调 SettleMatch 入账。AI 场次不经此路径。
    /// </summary>
    public static MatchRecord? PlayHeldMatch(
        GameState state,
        string fixtureId,
        HeldMatchOptions opts,
        Action<MatchRecord, string, bool>? onMatch = null)
    {
        var f = state.Fixtures.FirstOrDefault(x => x.Id == fixtureId);
        if (f == null || f.Played) return null;
        // 首发确认
        if (opts.Starters != null && state.MyTeamId != null && state.Teams.TryGetValue(state.MyTeamId, out var team))
        {
            team.Starters = opts.Starters.ToList();
        }
        // 手动 BP → 覆盖该场图池（引擎优先读取）
        if (opts.Maps != null && opts.Maps.Count > 0)
        {
            f.MapLock = opts.Maps.ToList();
        }
        // 每图英雄 → 挂到 fixture 上（随比赛走，不污染用户预案库——v0.5-2 检错）
        if (opts.AgentPicks != null && opts.AgentPicks.Count > 0)
        {
            f.AgentLock = opts.AgentPicks;
        }
        var rec = SimMatchHeld(state, f);
        f.Played = true; // 已模拟未结算：App 的下一场查找跳过、AdvanceDay 不再补打
        f.Settled = false; // 显式 false：与旧档（字段缺省=打完即结算）区分
        onMatch?.Invoke(rec, f.Id, true);
        return rec;
    }

    /// <summary>同 seed 重模拟我的比赛（v1.0-8）：追加干预后整场重跑——干预前的回合逐位一致。</summary>
    public static MatchRecord? InterveneHeldMatch(
        GameState state,
        string fixtureId,
        MatchIntervention iv,
        Action<MatchRecord, string, bool>? onMatch = null)
    {
        var f = state.Fixtures.FirstOrDefault(x => x.Id == fixtureId);
        if (f == null || !f.Played || (f.Settled ?? false)) return null;
        f.Interventions ??= new List<MatchIntervention>();
        // 同图同回合的旧喊话被新喊话替换（喊话未生效前反悔）；IGL 采纳不与手动喊话互斥去重
        if (!(iv.Igl ?? false))
            f.Interventions = f.Interventions.Where(x => !(x.Map == iv.Map && x.Round == iv.Round && !(x.Igl ?? false))).ToList();
        f.Interventions.Add(iv);
        var rec = SimMatchHeld(state, f);
        onMatch?.Invoke(rec, f.Id, true);
        return rec;
    }

    private static MatchRecord SimMatchHeld(GameState state, Fixture f)
    {
        long seed = Rng.HashString($"{state.Seed}:{f.Id}");
        return Match.SimMatch(state, f.TeamA, f.TeamB, f.Bo, seed, f.Id, f.MapLock, f.AgentLock, f.Interventions);
    }

    /// <summary>
    /// 结算我的交互式比赛（v1.0-8）：播放结束/关闭/推进/读档兜底时调用一次（幂等守卫 settled）。
    /// 胜者落档、泄露累计、生涯入账、积分榜/对阵树推进、新闻、教练心态与决赛积分。
    /// </summary>
    public static bool SettleMatch(
        GameState state,
        string fixtureId,
        MatchRecord? rec,
        Action<List<NewsItem>>? onNews = null)
    {
        var f = state.Fixtures.FirstOrDefault(x => x.Id == fixtureId);
        if (f == null || !f.Played || (f.Settled ?? false)) return false;
        if (rec == null) return false;
        f.Settled = true;
        f.WinnerTeamId = rec.Winner == "A" ? f.TeamA : f.TeamB;
        // 首秀名单快照（v1.x 反馈④）：必须在 ApplyMatchEffects 入账前捕获
        bool isMine = f.TeamA == state.MyTeamId || f.TeamB == state.MyTeamId;
        var debuts = isMine ? Narrative.CaptureDebuts(state) : null;
        Match.ApplyMatchEffects(state, rec);
        // 招牌战术反向泄露的源头累计（GDD §6.4）：我的赛前准备场次同样逐图 +1
        if (state.MyTeamId != null && state.Teams.TryGetValue(state.MyTeamId, out var mt))
        {
            foreach (var m in rec.Maps)
            {
                mt.PatternUsage[m.Map] = (mt.PatternUsage.TryGetValue(m.Map, out var u) ? u : 0) + 1;
                Match.RecordPatternFingerprint(state, state.MyTeamId, m.Map, f.AgentLock);
            }
        }
        var notes = new List<NewsItem>();
        ApplyStandings(state, f.Comp, f.TeamA, f.TeamB, rec.ScoreA, rec.ScoreB, rec.Maps);
        Fixtures.FillNextSlot(state.Fixtures, f, rec.Winner == "A" ? f.TeamA : f.TeamB);
        var tagA = state.Teams[f.TeamA].Tag;
        var tagB = state.Teams[f.TeamB].Tag;
        notes.Add(new NewsItem { Day = state.Day, Kind = "match", Text = $"{f.Label}｜{tagA} {rec.ScoreA}-{rec.ScoreB} {tagB}", Important = true });
        Career.NoteMatchResult(state, rec.Winner == "A" ? f.TeamA == state.MyTeamId : f.TeamB == state.MyTeamId, notes); // 赛前准备路径同样入账
        Narrative.NarrativeAfterMyLoss(state, f.Label, f.TeamA, f.TeamB, rec.Winner == "A" ? f.TeamA : f.TeamB, notes); // 中期叙事（v1.5）
        if (isMine) Narrative.NarrativeOnMyMatch(state, f.Id, rec, notes, new HashSet<string>(debuts ?? new List<string>()));
        SettleFinal(state, f, rec, notes); // 赛前准备路径同样结算冠军/积分
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
        onNews?.Invoke(notes);
        return true;
    }
}
