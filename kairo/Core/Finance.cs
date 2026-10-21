using System;
using System.Collections.Generic;
using System.Linq;

namespace Kairo.Core;

/// <summary>
/// 财务可视化核心（GDD v1.3）— C# 移植自 ace/src/core/sim/finance.ts（权威实现）。
/// finances.log 是唯一事实源；当前模拟资金只经 转会/解约/选秀权/商务/事件 流动。
/// </summary>
public static class Finance
{
    public static readonly string[] FinanceCatCn =
    {
        "transfer", "release", "draft", "business", "event", "other",
    };

    public static string CatCn(string cat) => cat switch
    {
        "transfer" => "转会", "release" => "解约", "draft" => "选秀权",
        "business" => "商务", "event" => "事件", _ => "其他",
    };

    /// <summary>入账 helper：push + 统一裁剪到最近 100 条。</summary>
    public static void LogFinance(GameState state, string label, int amount)
    {
        state.Finances.Log.Add(new FinanceEntry { Day = state.Day, Label = label, Amount = amount });
        if (state.Finances.Log.Count > 100)
            state.Finances.Log.RemoveRange(0, state.Finances.Log.Count - 100);
    }

    /// <summary>流水分类：按 label 前缀/关键词（与各入账点文案约定同步）。</summary>
    public static string Categorize(string label)
    {
        if (label.StartsWith("转会", StringComparison.Ordinal) || label.Contains("签字费")) return "transfer";
        if (label.StartsWith("解约", StringComparison.Ordinal)) return "release";
        if (label.StartsWith("选秀权", StringComparison.Ordinal)) return "draft";
        if (label.StartsWith("商务", StringComparison.Ordinal)) return "business";
        if (label.StartsWith("事件", StringComparison.Ordinal)) return "event";
        return "other";
    }

    public sealed class FinanceWindow
    {
        /// <summary>窗口起点余额（= 当前预算 − 窗口内流水合计）</summary>
        public int Start;
        public List<FinanceEntry> Entries = new();
        /// <summary>瀑布步进：每笔后的累计余额（含起点）</summary>
        public List<(int Day, int Balance, string Label, int Amount)> Steps = new();
        /// <summary>窗口终点余额——对账不变量：恒等于当前预算</summary>
        public int End;
    }

    /// <summary>windowDays（默认 30）现金流窗口：取 [day-window+1, day] 的流水。</summary>
    public static FinanceWindow GetFinanceWindow(GameState state, int windowDays = 30)
    {
        var my = state.MyTeamId != null && state.Teams.TryGetValue(state.MyTeamId, out var t) ? t : null;
        int budget = my?.Budget ?? 0;
        int from = state.Day - windowDays + 1;
        var entries = state.Finances.Log
            .Where(e => e.Day >= from && e.Day <= state.Day)
            .Select(e => new FinanceEntry { Day = e.Day, Label = e.Label, Amount = e.Amount, Cat = Categorize(e.Label) })
            .ToList();
        int net = entries.Sum(e => e.Amount);
        int start = budget - net;
        var window = new FinanceWindow { Start = start, Entries = entries };
        window.Steps.Add((from, start, "期初", 0));
        int acc = start;
        foreach (var e in entries)
        {
            acc += e.Amount;
            window.Steps.Add((e.Day, acc, e.Label, e.Amount));
        }
        window.End = acc;
        return window;
    }

    /// <summary>分类占比（收入/支出分开聚合，0 值类不出现；插入序=首次出现序）。</summary>
    public static List<(string Cat, int Income, int Expense)> FinanceBreakdown(IEnumerable<FinanceEntry> entries)
    {
        var map = new OrderedDict<string, (int Income, int Expense)>();
        foreach (var e in entries)
        {
            if (!map.TryGetValue(e.Cat ?? "other", out var cur)) { cur = (0, 0); map[e.Cat ?? "other"] = cur; }
            if (e.Amount >= 0) cur.Income += e.Amount;
            else cur.Expense += -e.Amount;
            map[e.Cat ?? "other"] = cur;
        }
        return map.Select(kv => (kv.Key, kv.Value.Income, kv.Value.Expense)).ToList();
    }

    /// <summary>顶栏现金流预测：近 days 日净流均值外推下周（$/天；无流水返回 null）。</summary>
    public static (double PerDay, int Week)? CashFlowForecast(GameState state, int days = 7)
    {
        int from = state.Day - days + 1;
        var entries = state.Finances.Log.Where(e => e.Day >= from && e.Day <= state.Day).ToList();
        if (entries.Count == 0) return null;
        int net = entries.Sum(e => e.Amount);
        return ((double)net / days, net);
    }
}
