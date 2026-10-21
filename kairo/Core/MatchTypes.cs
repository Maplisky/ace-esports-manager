using System.Collections.Generic;

namespace Kairo.Core;

/// <summary>比赛记录类型 — 移植自 ace/src/core/types.ts（RoundEvent/MapRecord 等）。</summary>

public sealed class RoundEvent
{
    /// <summary>kill/plant/defuse/ultReady/timeout/ace/clutch/flawless</summary>
    public string T { get; set; } = "kill";
    /// <summary>击杀者/动作主体</summary>
    public string? S { get; set; }
    /// <summary>受害者</summary>
    public string? V { get; set; }
    public bool First { get; set; }
    /// <summary>1vX 残局 X</summary>
    public int? Vs { get; set; }
    /// <summary>大招就绪的档位</summary>
    public string? Tier { get; set; }
    /// <summary>A/B</summary>
    public string? Side { get; set; }
    /// <summary>击杀伤害（实时 ACS 用；旧档缺省按 150）</summary>
    public double? Dmg { get; set; }
    /// <summary>玩家喊的战术暂停（v1.0-8）</summary>
    public bool? Player { get; set; }
    /// <summary>喊话的战术 id</summary>
    public string? Tactic { get; set; }
    /// <summary>IGL 场上阅读采纳的喊话</summary>
    public bool? Igl { get; set; }
}

public sealed class RoundEnd
{
    /// <summary>win: A/B</summary>
    public string Win { get; set; } = "A";
    /// <summary>how: elim/spike/defuse/time</summary>
    public string How { get; set; } = "elim";
    /// <summary>alive: A/B 存活数</summary>
    public int AliveA { get; set; }
    public int AliveB { get; set; }
    /// <summary>score: [A, B]</summary>
    public int ScoreA { get; set; }
    public int ScoreB { get; set; }
    /// <summary>回合末助攻名单（旧档缺省空）</summary>
    public List<string> Assists { get; set; } = new();
    /// <summary>回合残伤（选手 id → 非击杀伤害；插入序=揭示序）</summary>
    public OrderedDict<string, double> DmgBonus { get; set; } = new();
    /// <summary>回合末大招进度（就绪=7；TS 语义：存在即替换快照，空对象也替换）</summary>
    public OrderedDict<string, int>? Ults { get; set; }
    /// <summary>回合末经济池</summary>
    public MoneyPool? Money { get; set; }
    /// <summary>回合末剩余暂停次数</summary>
    public MoneyPool? Timeouts { get; set; }
}

public sealed class MoneyPool
{
    public int A { get; set; }
    public int B { get; set; }
}

public sealed class RoundRecord
{
    public int N { get; set; }
    /// <summary>本回合进攻方 A/B</summary>
    public string Atk { get; set; } = "A";
    /// <summary>buys: A/B（full/force/eco）</summary>
    public string BuyA { get; set; } = "full";
    public string BuyB { get; set; } = "full";
    public string? TacticAtk { get; set; }
    public string? TacticDef { get; set; }
    public List<RoundEvent> Events { get; set; } = new();
    public RoundEnd End { get; set; } = new();
}

public sealed class PlayerLine
{
    public int Kills { get; set; }
    public int Deaths { get; set; }
    public int Assists { get; set; }
    public int FirstKills { get; set; }
    public int FirstDeaths { get; set; }
    public int Clutches { get; set; }
    public double Damage { get; set; }
    public int Rounds { get; set; }
    public double Acs { get; set; }
}

public sealed class EdgeBreakdown
{
    public double Base, Igl, Chem, Coach, Meta, Map, Prep, Familiarity, ShortHanded, Aim, Awareness, MapTactics;
}

public sealed class IglReading
{
    public int Round { get; set; }
    public string IglId { get; set; } = "";
    public string Suggested { get; set; } = "";
    public int Quality { get; set; }
    public bool Correct { get; set; }
}

public sealed class MapRecord
{
    public string Map { get; set; } = "";
    /// <summary>[A 得分, B 得分]</summary>
    public int ScoreA { get; set; }
    public int ScoreB { get; set; }
    public List<RoundRecord> Rounds { get; set; } = new();
    /// <summary>lines（插入序=创建序）</summary>
    public OrderedDict<string, PlayerLine> Lines { get; set; } = new();
    public string? Mvp { get; set; }
    /// <summary>本图英雄分配（插入序=分配序）</summary>
    public OrderedDict<string, string> Agents { get; set; } = new();
    /// <summary>双方强度归因分解</summary>
    public EdgeBreakdown EdgesA { get; set; } = new();
    public EdgeBreakdown EdgesB { get; set; } = new();
    public List<IglReading> Readings { get; set; } = new();
}
