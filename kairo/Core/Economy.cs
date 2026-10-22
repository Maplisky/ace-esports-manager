using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Kairo.Core;

/// <summary>
/// M2 基地建设经济表（GDD 开罗版立项 §3.2）：地块价格曲线 / 设施清单（3 级）/ 邻接组合加成。
/// 灰盒期调参只改 Core.Data/economy.json——先表格模型后代码（立项 §9 M2 原则）。
/// C# 侧开罗专属系统：零 RNG、纯表格驱动；以「修正量输入」进入共享内核
/// （facilities 值 → Team.Facilities 供周结算读取；收入走 budget；恢复/士气由 C# 日循环在内核之外追加）。
/// </summary>
public sealed class EconomyTable
{
    public sealed class PlotConfig
    {
        public int BasePrice { get; set; }
        /// <summary>第 n 块地价格 = basePrice × growth^(n-1)（n = 当前已持有数）</summary>
        public double Growth { get; set; }
        public int MaxPlots { get; set; }
        public List<Coord> StartPlots { get; set; } = new();
    }

    public sealed class Coord
    {
        public int X { get; set; }
        public int Y { get; set; }
    }

    public sealed class Effects
    {
        /// <summary>计入 Team.Facilities 的训练加成（内核周结算 facF 读取）</summary>
        public List<int> Facilities { get; set; } = new();
        /// <summary>每周额外疲劳恢复（C# 日循环在内核外追加）</summary>
        public List<int> RestBonus { get; set; } = new();
        /// <summary>每周 roster 士气回复（C# 日循环追加）</summary>
        public List<int> Morale { get; set; } = new();
        /// <summary>主场容量（比赛日门票收入参数）</summary>
        public List<int> Capacity { get; set; } = new();
        /// <summary>常驻周收入（直接入预算）</summary>
        public List<int> WeeklyIncome { get; set; } = new();

        public int Get(string key, int level) => LevelListOf(key)[Math.Clamp(level, 1, 3) - 1];

        public List<int> LevelListOf(string key) => key switch
        {
            "facilities" => Facilities,
            "restBonus" => RestBonus,
            "morale" => Morale,
            "capacity" => Capacity,
            "weeklyIncome" => WeeklyIncome,
            _ => throw new ArgumentException($"unknown effect {key}"),
        };
    }

    public sealed class FacilityDef
    {
        public string Id { get; set; } = "";
        public string Name { get; set; } = "";
        /// <summary>training/rest/arena/commerce/support</summary>
        public string Cat { get; set; } = "";
        /// <summary>1-3 级造价（index = level-1）</summary>
        public List<int> Cost { get; set; } = new();
        /// <summary>1-3 级建造天数</summary>
        public List<int> BuildDays { get; set; } = new();
        public Effects Effects { get; set; } = new();
    }

    public sealed class ComboDef
    {
        public string A { get; set; } = "";
        public string B { get; set; } = "";
        /// <summary>正交相邻且双方 level ≥1 时生效（方向无关）</summary>
        public Dictionary<string, int> Bonus { get; set; } = new();
        public string Desc { get; set; } = "";
    }

    public sealed class TicketConfig
    {
        /// <summary>主场门票：收入 = 容量 × 票价（灰盒定值；后续可挂人气/声望曲线）</summary>
        public int PricePerSeat { get; set; }
    }

    public PlotConfig Plot { get; set; } = new();
    public TicketConfig Ticket { get; set; } = new();
    public List<FacilityDef> Facilities { get; set; } = new();
    public List<ComboDef> Combos { get; set; } = new();

    public FacilityDef? Facility(string id) => Facilities.FirstOrDefault(f => f.Id == id);
}

/// <summary>基地状态（存档序列化；插入序 = 购地序）。C# 侧独立结构，TS 存档不含。</summary>
public sealed class BaseState
{
    public string Key { get; set; } = "";

    public static string KeyOf(int x, int y) => $"{x},{y}";

    /// <summary>key "x,y" → 地块；level 0 = 空地</summary>
    public OrderedDict<string, PlotState> Plots { get; set; } = new();
}

public sealed class PlotState
{
    public int X { get; set; }
    public int Y { get; set; }
    /// <summary>设施 id；null = 空地</summary>
    public string? BuildingId { get; set; }
    /// <summary>1-3；0 = 未建</summary>
    public int Level { get; set; }
    /// <summary>建造/升级剩余天数（0 = 就绪）</summary>
    public int BuildRemainDays { get; set; }
    /// <summary>升级中：完成后到达的等级（期间按当前等级产出）</summary>
    public int PendingLevel { get; set; }
}

/// <summary>基地操作与结算（全部确定性：价格/效果均来自表格常量，零 RNG）。</summary>
public static class BaseOps
{
    private static readonly Lazy<EconomyTable> TableLazy = new(() =>
        JsonSerializer.Deserialize<EconomyTable>(
            File.ReadAllText(Path.Combine(FindDataDir(), "economy.json")),
            new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, PropertyNameCaseInsensitive = true })!);

    public static EconomyTable Table => TableLazy.Value;

    private static string FindDataDir()
    {
        foreach (var dir in new[] { Path.Combine(AppContext.BaseDirectory, "Core.Data"), Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "Core.Data") })
        {
            if (File.Exists(Path.Combine(dir, "economy.json"))) return dir;
        }
        throw new InvalidOperationException("Core.Data/economy.json not found");
    }

    public static BaseState NewBase()
    {
        var b = new BaseState();
        foreach (var c in Table.Plot.StartPlots)
        {
            b.Plots[BaseState.KeyOf(c.X, c.Y)] = new PlotState { X = c.X, Y = c.Y };
        }
        return b;
    }

    /// <summary>第 n 块地的价格（n = 购入前已持有数；取整到千）。DetMath.Pow 防 ARM/x64 平台 pow ulp 漂移。</summary>
    public static int PlotPrice(int ownedCount) =>
        (int)(DetMath.JsRound(Table.Plot.BasePrice * DetMath.Pow(Table.Plot.Growth, Math.Max(0, ownedCount - 1))) / 1000) * 1000;

    /// <summary>购入相邻空地（含对角？否——合战式正交相邻）。返回错误文本；null = 成功。</summary>
    public static string? BuyPlot(GameState state, BaseState b, int x, int y)
    {
        var myTeam = state.Teams[state.MyTeamId!];
        if (b.Plots.ContainsKey(BaseState.KeyOf(x, y))) return "该地块已在名下。";
        bool adjacent = new[] { (1, 0), (-1, 0), (0, 1), (0, -1) }.Any(d => b.Plots.ContainsKey(BaseState.KeyOf(x + d.Item1, y + d.Item2)));
        if (!adjacent) return "只能购买与现有地块相邻的土地。";
        if (b.Plots.Count >= Table.Plot.MaxPlots) return "已达地产上限。";
        int price = PlotPrice(b.Plots.Count);
        if (myTeam.Budget < price) return $"资金不足（需 {price}）。";
        myTeam.Budget -= price;
        Finance.LogFinance(state, "地产 · 购入地块", -price);
        b.Plots[BaseState.KeyOf(x, y)] = new PlotState { X = x, Y = y };
        return null;
    }

    /// <summary>建造 / 升级（level+1）。level 0 空地上造 1 级；3 级封顶。返回错误文本；null = 成功。</summary>
    public static string? StartBuild(GameState state, BaseState b, int x, int y, string facilityId)
    {
        var def = Table.Facility(facilityId);
        if (def == null) return "未知设施。";
        var key = BaseState.KeyOf(x, y);
        if (!b.Plots.TryGetValue(key, out var plot)) return "该地块不在名下。";
        if (plot.BuildingId != null && plot.BuildingId != facilityId) return "该地块已有其他设施（先拆除）。";
        if (plot.Level >= 3) return "已达最高等级。";
        if (plot.BuildRemainDays > 0) return "施工中。";
        int targetLevel = plot.Level + 1;
        int cost = def.Cost[targetLevel - 1];
        var myTeam = state.Teams[state.MyTeamId!];
        if (myTeam.Budget < cost) return $"资金不足（需 {cost}）。";
        myTeam.Budget -= cost;
        Finance.LogFinance(state, $"建设 · {def.Name} {targetLevel} 级", -cost);
        plot.BuildingId = facilityId;
        plot.PendingLevel = targetLevel;
        plot.BuildRemainDays = def.BuildDays[targetLevel - 1];
        return null;
    }

    /// <summary>拆除（返还 30% 当前等级造价；零 RNG）。返回错误文本；null = 成功。</summary>
    public static string? Demolish(GameState state, BaseState b, int x, int y)
    {
        var key = BaseState.KeyOf(x, y);
        if (!b.Plots.TryGetValue(key, out var plot)) return "该地块不在名下。";
        if (plot.BuildingId == null || plot.Level <= 0) return "空地无需拆除。";
        var def = Table.Facility(plot.BuildingId)!;
        int refund = (int)(DetMath.JsRound(def.Cost[plot.Level - 1] * 0.3) / 1000) * 1000;
        var myTeam = state.Teams[state.MyTeamId!];
        myTeam.Budget += refund;
        Finance.LogFinance(state, $"拆除 · {def.Name}", refund);
        plot.BuildingId = null;
        plot.Level = 0;
        plot.PendingLevel = 0;
        plot.BuildRemainDays = 0;
        return null;
    }

    /// <summary>日推进：施工天数递减，归零即落成（PendingLevel 生效）。在 C# 日循环内核推进后调用。</summary>
    public static void AdvanceBuildDay(BaseState b)
    {
        foreach (var plot in b.Plots.Values)
        {
            if (plot.BuildRemainDays <= 0) continue;
            plot.BuildRemainDays--;
            if (plot.BuildRemainDays == 0 && plot.PendingLevel > plot.Level)
            {
                plot.Level = plot.PendingLevel;
            }
        }
    }

    /// <summary>产出判定：已落成的当前等级持续产出（升级施工 L→L+1 期间按 L 产出；首次建造 Level=0 无产出）。</summary>
    private static bool Ready(PlotState p) => p.BuildingId != null && p.Level >= 1;

    private static Dictionary<string, int> EffectSums(EconomyTable t, BaseState b, Func<EconomyTable.FacilityDef, bool>? filter = null)
    {
        var sums = new Dictionary<string, int>();
        void Add(string key, int v)
        {
            sums[key] = (sums.TryGetValue(key, out var cur) ? cur : 0) + v;
        }
        foreach (var plot in b.Plots.Values)
        {
            if (!Ready(plot)) continue;
            var def = t.Facility(plot.BuildingId!)!;
            if (filter != null && !filter(def)) continue;
            foreach (var (key, list) in new Dictionary<string, List<int>>
            {
                ["facilities"] = def.Effects.Facilities,
                ["restBonus"] = def.Effects.RestBonus,
                ["morale"] = def.Effects.Morale,
                ["capacity"] = def.Effects.Capacity,
                ["weeklyIncome"] = def.Effects.WeeklyIncome,
            })
            {
                if (list.Count > 0) Add(key, list[Math.Clamp(plot.Level, 1, 3) - 1]);
            }
        }
        // 邻接组合：正交相邻、双方就绪；combo 双向匹配各计一次
        foreach (var combo in t.Combos)
        {
            foreach (var plot in b.Plots.Values)
            {
                if (!Ready(plot) || plot.BuildingId != combo.A) continue;
                bool touching = new[] { (1, 0), (-1, 0), (0, 1), (0, -1) }.Any(d =>
                    b.Plots.TryGetValue(BaseState.KeyOf(plot.X + d.Item1, plot.Y + d.Item2), out var nb)
                    && Ready(nb) && nb.BuildingId == combo.B);
                if (!touching) continue;
                foreach (var (k, v) in combo.Bonus) Add(k, v);
            }
        }
        return sums;
    }

    /// <summary>训练加成合计（→ Team.Facilities 修正量输入；施工中的设施不计）。</summary>
    public static int FacilitiesValue(BaseState b) => EffectSums(Table, b).TryGetValue("facilities", out var v) ? v : 0;

    public static int RestBonus(BaseState b) => EffectSums(Table, b).TryGetValue("restBonus", out var v) ? v : 0;

    public static int MoraleBonus(BaseState b) => EffectSums(Table, b).TryGetValue("morale", out var v) ? v : 0;

    /// <summary>主场容量（比赛日门票收入参数；0 = 无场馆）。</summary>
    public static int Capacity(BaseState b) => EffectSums(Table, b).TryGetValue("capacity", out var v) ? v : 0;

    /// <summary>常驻周收入合计。</summary>
    public static int WeeklyIncome(BaseState b) => EffectSums(Table, b).TryGetValue("weeklyIncome", out var v) ? v : 0;

    /// <summary>
    /// 周结算（C# 日循环在 DaySim.AdvanceDay 的周块之后调用）：
    /// 修正量输入 → myTeam.Facilities（内核训练效率读取）；常驻收入入预算；
    /// 宿舍/休息室 morale 与 restBonus 由本方法在内核外追加（确定性，零 RNG）。
    /// </summary>
    public static (int Income, int Facilities, int MoraleGain, int RestGain) ApplyWeekly(GameState state, BaseState b)
    {
        var sums = EffectSums(Table, b);
        int income = sums.TryGetValue("weeklyIncome", out var inc) ? inc : 0;
        int facilities = sums.TryGetValue("facilities", out var fac) ? fac : 0;
        int morale = sums.TryGetValue("morale", out var mor) ? mor : 0;
        int rest = sums.TryGetValue("restBonus", out var rst) ? rst : 0;
        var myTeam = state.Teams[state.MyTeamId!];
        myTeam.Facilities = facilities; // 修正量输入：内核 weeklyTick facF 读取
        if (income > 0)
        {
            myTeam.Budget += income;
            Finance.LogFinance(state, "基地 · 常驻收入", income);
        }
        if (morale > 0 || rest > 0)
        {
            foreach (var pid in myTeam.Roster)
            {
                if (!state.Players.TryGetValue(pid, out var p)) continue;
                if (morale > 0) p.Morale = MathUtil.Clamp(p.Morale + morale, 10, 100);
                if (rest > 0) p.Fatigue = MathUtil.Clamp(p.Fatigue - rest, 0, 100);
            }
        }
        return (income, facilities, morale, rest);
    }
}
