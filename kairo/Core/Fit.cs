using System;

namespace Kairo.Core;

/// <summary>
/// 英雄×地图适配 fit（GDD §4.3 v1.9）— C# 移植自 ace/src/core/sim/fit.ts（权威实现）。
/// 由 地图几何标签 × 英雄机制标签 查表推导，值域 0.70-1.30。
/// </summary>
public static class Fit
{
    public static double ComputeFit(string agentId, MapDef map)
    {
        var agent = CoreData.Agent(agentId);
        if (agent == null) return 1;
        double fit = 1;
        bool Has(string t) => Array.IndexOf(agent.MechTags, t) >= 0;

        // 侦察：开阔图增值（视野延伸），封闭图贬值
        if (Has("recon")) fit += (map.Openness - 0.5) * 0.5;
        // 烟幕：点位越多越有用
        if (Has("smoke")) fit += map.Sites == 3 ? 0.08 : 0.04;
        // 哨置：窄通道图增值，开阔图贬值
        if (Has("anchor")) fit += (0.5 - map.Corridor) * 0.4;
        // 机动：开阔图 + 多点位图增值（转点快）
        if (Has("mobility")) fit += (map.Openness - 0.5) * 0.3 + (map.Sites == 3 ? 0.06 : 0);
        // 强开/区域杀伤：窄通道图增值
        if (Has("entry") || Has("area")) fit += (0.5 - map.Corridor) * 0.15;
        // 垂直图奖励机动与侦察
        if (map.Vertical > 0.6 && (Has("mobility") || Has("recon"))) fit += 0.05;

        return Math.Min(1.3, Math.Max(0.7, DetMath.JsRound(fit * 100) / 100));
    }
}
