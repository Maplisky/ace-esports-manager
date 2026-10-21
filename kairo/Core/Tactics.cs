using System;
using System.Collections.Generic;
using System.Linq;

namespace Kairo.Core;

/// <summary>
/// 战术喊话效果表（v1.0-8）— C# 移植自 ace/src/core/sim/tactics.ts（权威实现）。
/// 玩家/AI 共用一套 3 回合强度修正；玩家喊话不消耗 RNG（干预重模拟红线）。
/// </summary>
public static class Tactics
{
    public sealed class TacticCallDef
    {
        /// <summary>喊话 id；带点位的以 :A/:B/:C 结尾</summary>
        public string Id = "";
        /// <summary>生效侧：atk/def</summary>
        public string Side = "atk";
        public string Label = "";
        public double AtkMod;
        public double DefMod;
        /// <summary>需要 ≥2 个「核心」档大招就绪（大招速攻）</summary>
        public bool NeedsCoreUlts;
        /// <summary>需要长枪局</summary>
        public bool NeedsFullBuy;
        /// <summary>克制 rush 系开局战术</summary>
        public bool CounterRush;
        /// <summary>需要玩家选点位</summary>
        public bool PickSite;
        public string Desc = "";
    }

    private static readonly Dictionary<string, (double AtkMod, double DefMod)> AiCalls = new()
    {
        ["rush"] = (2.4, -1.6),
        ["steady"] = (-1.2, 2.0),
    };

    /// <summary>玩家情境菜单：防守 4 项 + 进攻 4 项（字面量数值与 TS 逐位对齐）。</summary>
    public static readonly List<TacticCallDef> PlayerCalls = new()
    {
        new TacticCallDef { Id = "def:stackPush", Side = "def", Label = "抱团前压", AtkMod = -1.6, DefMod = 2.6, PickSite = true, Desc = "多点抱团抢开局，堆防拿首波交火；被慢攻拉扯时吃亏" },
        new TacticCallDef { Id = "def:rotate131", Side = "def", Label = "131 快速回防", AtkMod = -0.4, DefMod = 1.4, Desc = "一前压三机动一锚点，转点支援快；对单一强攻压制力一般" },
        new TacticCallDef { Id = "def:giveSite", Side = "def", Label = "放点打回防", AtkMod = -1.0, DefMod = 1.6, PickSite = true, Desc = "让出点位做回防包夹，赌对手下包节奏；被速通时风险大" },
        new TacticCallDef { Id = "def:sentinelTunnel", Side = "def", Label = "双哨位蹲通道", AtkMod = -0.2, DefMod = 1.2, CounterRush = true, Desc = "双哨位锁死侧翼通道，专治 rush；对慢速默认收益有限" },
        new TacticCallDef { Id = "atk:rush", Side = "atk", Label = "集火 Rush", AtkMod = 2.6, DefMod = -1.8, PickSite = true, Desc = "五人集火强吃一个点位；被前压/蹲点克制时损失惨重" },
        new TacticCallDef { Id = "atk:fakeRotate", Side = "atk", Label = "假打转点", AtkMod = 1.4, DefMod = -0.6, Desc = "佯攻拉防再转点，专破堆防；对面快速回防时打不出差" },
        new TacticCallDef { Id = "atk:slowDefault", Side = "atk", Label = "慢速默认+中局变奏", AtkMod = 0.9, DefMod = 0.9, Desc = "地图控制中局发力，攻防两益；上限低于激进选项" },
        new TacticCallDef { Id = "atk:ultRush", Side = "atk", Label = "大招速攻", AtkMod = 3.2, DefMod = -1.2, NeedsCoreUlts = true, NeedsFullBuy = true, PickSite = true, Desc = "≥2 个核心档大招开路一波强攻，强度脉冲最高；大招窗口仅此一波" },
    };

    /// <summary>去掉点位后缀（:A/:B/:C）。</summary>
    private static string BaseId(string id) =>
        id.Length >= 2 && id[^2] == ':' && (id[^1] == 'A' || id[^1] == 'B' || id[^1] == 'C') ? id[..^2] : id;

    /// <summary>id（含点位后缀）→ 定义；AI 的 rush/steady 也能查到数值。</summary>
    public static TacticCallDef? CallDefOf(string id)
    {
        if (AiCalls.TryGetValue(id, out var ai))
        {
            return new TacticCallDef { Id = id, Side = "atk", Label = id, AtkMod = ai.AtkMod, DefMod = ai.DefMod, Desc = "" };
        }
        var baseId = BaseId(id);
        return PlayerCalls.FirstOrDefault(c => c.Id == baseId);
    }

    /// <summary>喊话是否可作用于该侧（atk: 前缀只在我方进攻回合生效）。</summary>
    public static string CallSideOf(string id) => id.StartsWith("atk:", StringComparison.Ordinal) ? "atk" : "def";

    public static string CallLabel(string id)
    {
        var baseId = BaseId(id);
        var def = PlayerCalls.FirstOrDefault(c => c.Id == baseId);
        if (def == null)
        {
            var parts = id.Split(':');
            return parts.Length > 1 ? parts[1] : id;
        }
        string site = id.Length >= 2 ? id[^2..] : "";
        bool siteOk = site.Length == 2 && site[0] == ':' && (site[1] == 'A' || site[1] == 'B' || site[1] == 'C');
        return def.PickSite && siteOk ? $"{def.Label} {site[1]} 点" : def.Label;
    }

    public static string CallDesc(string id)
    {
        var baseId = BaseId(id);
        return PlayerCalls.FirstOrDefault(c => c.Id == baseId)?.Desc ?? "";
    }
}
