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
    /// <summary>是否首杀（TS 可选字段：非首杀事件不存在该键，C# 用 null 对应）</summary>
    public bool? First { get; set; }
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

public sealed class IglReading
{
    public int Round { get; set; }
    public string IglId { get; set; } = "";
    public string Suggested { get; set; } = "";
    public int Quality { get; set; }
    public bool Correct { get; set; }
}

/// <summary>地图预案（GDD §7.1）：选手 id → 英雄 id（插入序=配置序）。</summary>
public sealed class Preset
{
    public string Name { get; set; } = "";
    public OrderedDict<string, string> Agents { get; set; } = new();
    public bool Preferred { get; set; }
}

/// <summary>赛程条目（GDD §5.3）：赛果/手动 BP 锁/干预列表的事实源。</summary>
public sealed class Fixture
{
    public string Id { get; set; } = "";
    public int Day { get; set; }
    public string Stage { get; set; } = "";
    public string Comp { get; set; } = "";
    public string TeamA { get; set; } = "";
    public string TeamB { get; set; } = "";
    /// <summary>赛制 1/3/5</summary>
    public int Bo { get; set; }
    public string Label { get; set; } = "";
    public bool Played { get; set; }
    /// <summary>胜者队 id（积分/推进的唯一事实源）</summary>
    public string? WinnerTeamId { get; set; }
    /// <summary>玩家手动 BP 锁定的图序列（引擎优先于自动 BP）</summary>
    public List<string>? MapLock { get; set; }
    /// <summary>赛前准备每图英雄分配（插入序）</summary>
    public OrderedDict<string, OrderedDict<string, string>>? AgentLock { get; set; }
    public string? NextFixtureId { get; set; }
    public string? NextLoserFixtureId { get; set; }
    /// <summary>已结算（我方比赛先出 Record 供播放器，后结算）</summary>
    public bool? Settled { get; set; }
    /// <summary>玩家比赛中干预列表（重模拟的唯一输入）</summary>
    public List<MatchIntervention>? Interventions { get; set; }
}

/// <summary>玩家比赛中干预（v1.0-8）：同 seed 重模拟的唯一输入（不消耗 RNG）。</summary>
public sealed class MatchIntervention
{
    /// <summary>图序号（MatchRecord.Maps 下标）</summary>
    public int Map { get; set; }
    /// <summary>生效回合（该回合起持续 3 回合；IGL 采纳 2 回合）</summary>
    public int Round { get; set; }
    /// <summary>战术 id</summary>
    public string Tactic { get; set; } = "";
    /// <summary>IGL 场上阅读采纳（效果 80%、不耗暂停次数）</summary>
    public bool? Igl { get; set; }
}

public sealed class MatchRecord
{
    public string Id { get; set; } = "";
    public long Seed { get; set; }
    /// <summary>赛制 1/3/5</summary>
    public int Format { get; set; }
    public string TeamA { get; set; } = "";
    public string TeamB { get; set; } = "";
    public string Stage { get; set; } = "";
    public int Day { get; set; }
    public List<MapRecord> Maps { get; set; } = new();
    /// <summary>[A 图胜, B 图胜]</summary>
    public int ScoreA { get; set; }
    public int ScoreB { get; set; }
    /// <summary>胜方 A/B</summary>
    public string Winner { get; set; } = "A";
    public string? Mvp { get; set; }
    /// <summary>玩家干预审计（随比赛落档）</summary>
    public List<MatchIntervention>? Interventions { get; set; }
}

public sealed class MapRecord
{
    public string Map { get; set; } = "";
    /// <summary>[A 得分, B 得分]</summary>
    public int ScoreA { get; set; }
    public int ScoreB { get; set; }
    /// <summary>A 队上半场进攻（回放器推导每回合攻防方；2026-10-22 预研补：此前为 SimMatch 局部变量未落档）</summary>
    public bool AAttacksFirst { get; set; }
    public List<RoundRecord> Rounds { get; set; } = new();
    /// <summary>lines（插入序=创建序）</summary>
    public OrderedDict<string, PlayerLine> Lines { get; set; } = new();
    public string? Mvp { get; set; }
    /// <summary>本图英雄分配（插入序=分配序）</summary>
    public OrderedDict<string, string> Agents { get; set; } = new();
    /// <summary>双方强度归因分解</summary>
    public Strength.SideEdge EdgesA { get; set; } = new();
    public Strength.SideEdge EdgesB { get; set; } = new();
    public List<IglReading> Readings { get; set; } = new();
}
