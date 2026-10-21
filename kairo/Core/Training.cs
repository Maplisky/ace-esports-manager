using System;

namespace Kairo.Core;

/// <summary>
/// 个人训练项目表（GDD §6.3 v1.1）— C# 移植自 ace/src/core/data/training.ts（权威实现）。
/// </summary>
public static class Training
{
    public sealed class IndividualOption
    {
        public string Key = "";
        public string Name = "";
        /// <summary>训练指标（八维之一）；rest 为 null</summary>
        public string? Attr;
        public string Desc = "";
    }

    public static readonly IndividualOption[] IndividualOptions =
    {
        new() { Key = "aim", Name = "枪法", Attr = "aim", Desc = "压枪/爆头线" },
        new() { Key = "reaction", Name = "反应", Attr = "reaction", Desc = " peek 与拉枪速度" },
        new() { Key = "awareness", Name = "意识", Attr = "awareness", Desc = "地图信息与决策" },
        new() { Key = "utility", Name = "道具", Attr = "utility", Desc = "道具投掷与配合" },
        new() { Key = "clutch", Name = "残局", Attr = "clutch", Desc = "1vX 处理" },
        new() { Key = "teamwork", Name = "协同", Attr = "teamwork", Desc = "交叉火力与补枪" },
        new() { Key = "communication", Name = "沟通", Attr = "communication", Desc = "报点与指挥清晰度" },
        new() { Key = "igl", Name = "指挥", Attr = "igl", Desc = "读场与临场调度（建议指挥练）" },
        new() { Key = "rest", Name = "休息", Attr = null, Desc = "不安排个人加练" },
    };

    public static IndividualOption? OptionByKey(string key) => Array.Find(IndividualOptions, o => o.Key == key);

    /// <summary>推荐项目：按主职责 + 是否指挥（按实际职责而非申报位置；先锋/控场主打道具）。</summary>
    public static string RecommendFocus(string duty, bool isIgl)
    {
        if (isIgl) return "igl";
        return duty switch
        {
            "duelist" => "aim",
            "initiator" => "utility",
            "controller" => "utility",
            "sentinel" => "awareness",
            _ => "rest",
        };
    }

    /// <summary>各职责的次要训练项（主项达上限时的 fallback；先锋/控场次打意识）。</summary>
    public static string SecondaryFocus(string duty) => duty switch
    {
        "duelist" => "reaction",
        "initiator" => "awareness",
        "controller" => "awareness",
        "sentinel" => "clutch",
        _ => "rest",
    };

    public sealed class PlanRecommendation
    {
        public string Key = "";
        /// <summary>primary/secondary/rest-fatigue/rest-capped</summary>
        public string Reason = "";
    }

    private static double AttrGet(PlayerAttrs a, string k) => k switch
    {
        "aim" => a.Aim, "reaction" => a.Reaction, "awareness" => a.Awareness, "utility" => a.Utility,
        "clutch" => a.Clutch, "teamwork" => a.Teamwork, "communication" => a.Communication, "igl" => a.Igl,
        _ => 50,
    };

    /// <summary>属性成长上限（与 day.ts 训练结算同口径：potential + 5，硬顶 99）。</summary>
    private static bool AttrCapped(PlayerAttrs attrs, int potential, string attr)
    {
        double cap = Math.Min(99, potential + 5);
        return AttrGet(attrs, attr) >= cap;
    }

    /// <summary>一键训练推荐（v1.4）：疲劳 &gt;70 休息 → 主项 → 次项 → 休息保状态。</summary>
    public static PlanRecommendation RecommendPlan(PlayerAttrs attrs, int potential, double fatigue, bool isIgl, string duty)
    {
        if (fatigue > 70) return new PlanRecommendation { Key = "rest", Reason = "rest-fatigue" };
        var primary = RecommendFocus(duty, isIgl);
        var primaryOpt = OptionByKey(primary);
        if (primaryOpt?.Attr != null && !AttrCapped(attrs, potential, primaryOpt.Attr))
            return new PlanRecommendation { Key = primary, Reason = "primary" };
        var secondary = SecondaryFocus(duty);
        var secondaryOpt = OptionByKey(secondary);
        if (secondaryOpt?.Attr != null && !AttrCapped(attrs, potential, secondaryOpt.Attr))
            return new PlanRecommendation { Key = secondary, Reason = "secondary" };
        return new PlanRecommendation { Key = "rest", Reason = "rest-capped" };
    }

    /// <summary>每训练日经验基准（1.4~3.2/日）。</summary>
    public static (double Lo, double Hi) XpPerDay => (1.4, 3.2);
    public const int XpPerAttrPoint = 100;
}
