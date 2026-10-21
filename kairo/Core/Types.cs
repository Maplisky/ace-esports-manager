using System.Collections.Generic;

namespace Kairo.Core;

/// <summary>类型移植自 ace/src/core/types.ts（worldgen 所需子集；sim 模块移植时增量补充）。</summary>

public sealed class DutyVector
{
    public double Duelist { get; set; }
    public double Initiator { get; set; }
    public double Controller { get; set; }
    public double Sentinel { get; set; }
}

public sealed class PlayerAttrs
{
    public double Aim { get; set; }
    public double Reaction { get; set; }
    public double Awareness { get; set; }
    public double Utility { get; set; }
    public double Clutch { get; set; }
    public double Teamwork { get; set; }
    public double Communication { get; set; }
    public double Igl { get; set; }

    public PlayerAttrs Clone() => (PlayerAttrs)MemberwiseClone();
}

public sealed class PlayerCareer
{
    public int Maps { get; set; }
    public int Rounds { get; set; }
    public int Kills { get; set; }
    public int Deaths { get; set; }
    public int Assists { get; set; }
    public int FirstKills { get; set; }
    public int FirstDeaths { get; set; }
    public int Clutches { get; set; }
    public int Mvps { get; set; }
    public int Titles { get; set; }
    /// <summary>曾效力俱乐部（id 列表，按时间序）</summary>
    public List<string> Clubs { get; set; } = new();
}

public sealed class StreamContract
{
    public int Weekly { get; set; }
    public int UntilDay { get; set; }
}

public sealed class Player
{
    public string Id { get; set; } = "";
    public string Ign { get; set; } = "";
    public string? RealName { get; set; }
    public string? Country { get; set; }
    public string? Avatar { get; set; }
    /// <summary>虚拟生成标注：academy / free / rookie</summary>
    public string? Synthetic { get; set; }
    public int Age { get; set; }
    public string? TeamId { get; set; }
    public PlayerAttrs Attrs { get; set; } = new();
    /// <summary>综合能力（八维加权合成）</summary>
    public int Overall { get; set; }
    public int Potential { get; set; }
    public int PeakOverall { get; set; }
    public int Form { get; set; }
    public int Morale { get; set; }
    public int Fatigue { get; set; }
    public int Salary { get; set; }
    public int ContractYears { get; set; }
    public List<string> AgentPool { get; set; } = new();
    /// <summary>英雄熟练度 0-100（真实选手可为小数：vlr 占比+效率加权；插入序 = pool 序）</summary>
    public OrderedDict<string, double> AgentPro { get; set; } = new();
    public bool IsIgl { get; set; }
    public bool ViceIgl { get; set; }
    /// <summary>承诺角色：core/starter/rotation/bench</summary>
    public string PromisedRole { get; set; } = "starter";
    public OrderedDict<string, double> Xp { get; set; } = new();
    public string Focus { get; set; } = "rest";
    public bool Listed { get; set; }
    public int ReleaseClause { get; set; }
    public bool NoPoach { get; set; }
    public List<string> Traits { get; set; } = new();
    /// <summary>野心（退役检定输入，35-85）</summary>
    public int Ambition { get; set; }
    public int InjuredUntilDay { get; set; }
    public bool Homegrown { get; set; }
    public int BenchedWeeks { get; set; }
    public int CommercialDays { get; set; }
    public StreamContract? Stream { get; set; }
    /// <summary>生日（赛季内第 N 天）</summary>
    public int BirthdayDay { get; set; }
    public int LastEventDay { get; set; }
    public PlayerCareer Career { get; set; } = new();
}

public sealed class Coach
{
    public string Name { get; set; } = "";
    public int Tactics { get; set; }
    public int Development { get; set; }
    public int Motivation { get; set; }
}

public sealed class Sponsor
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public int Tier { get; set; }
    public int PerSeason { get; set; }
    public int Years { get; set; }
    public int SignedYear { get; set; }
}

public sealed class StaffSlot
{
    public string Name { get; set; } = "";
    public int Value { get; set; }
    public string? CoachId { get; set; }
}

public sealed class StaffSlots
{
    public StaffSlot? Training { get; set; }
    public StaffSlot? MapTactics { get; set; }
    public StaffSlot? Match { get; set; }
}

public sealed class ScoutEntry
{
    public double Points { get; set; }
    public int Last { get; set; }
}

public sealed class PendingEventOption
{
    public string Label { get; set; } = "";
    /// <summary>结果文本（选定后展示）</summary>
    public string Result { get; set; } = "";
    /// <summary>数值效果（目标选手士气/全队士气/预算/声望/信任/不满/疲劳/羁绊/董事会信心）</summary>
    public int? Morale { get; set; }
    public int? TeamMorale { get; set; }
    public int? Budget { get; set; }
    public int? Reputation { get; set; }
    public int? Trust { get; set; }
    public int? Grievance { get; set; }
    public int? Fatigue { get; set; }
    public int? Bond { get; set; }
    public int? BoardConfidence { get; set; }
}

/// <summary>待决策事件卡实例（抽取时已绑定目标选手）。</summary>
public sealed class PendingEventCard
{
    public string Uid { get; set; } = "";
    public string CardId { get; set; } = "";
    public string Title { get; set; } = "";
    public string Text { get; set; } = "";
    /// <summary>负面卡（抑制器计数用）</summary>
    public bool Negative { get; set; }
    public string? TargetPlayerId { get; set; }
    public int Day { get; set; }
    public List<PendingEventOption> Options { get; set; } = new();
    /// <summary>卡专属数据（如选秀卡冻结新秀 id；随存档序列化）</summary>
    public OrderedDict<string, object>? Payload { get; set; }
}

public sealed class NewsItem
{
    public int Day { get; set; }
    /// <summary>kind：league/signing/scandal/milestone 等</summary>
    public string Kind { get; set; } = "league";
    /// <summary>TS 可选字段：未写即为缺省（dump 省键）</summary>
    public bool? Important { get; set; }
    public string Text { get; set; } = "";
}

/// <summary>转会流水条目（feed 即账本）：done/bid/list/release/retire/rumor/wants/off。</summary>
public sealed class TransferFeedItem
{
    public int Day { get; set; }
    public int Year { get; set; }
    public string Kind { get; set; } = "rumor";
    public string Text { get; set; } = "";
    /// <summary>传闻浓度（仅 rumor）：1=绯闻 2=有消息称 3=谈判中</summary>
    public int? C { get; set; }
    /// <summary>买方（rumor/off：谁在关注 / 谈崩的是哪家；wants：意向去向）</summary>
    public string? ToTeamId { get; set; }
    /// <summary>涉事选手</summary>
    public string? PlayerId { get; set; }
}

public sealed class PatchChange
{
    public string AgentId { get; set; } = "";
    public double Meta { get; set; }
    /// <summary>buff / nerf</summary>
    public string Dir { get; set; } = "buff";
    /// <summary>变化幅度百分比（整数，Math.round 产物）</summary>
    public int Pct { get; set; }
}

public sealed class PatchNote
{
    public string Version { get; set; } = "";
    public List<PatchChange> Changes { get; set; } = new();
    /// <summary>mapNotes（mapId → 文本；插入序）</summary>
    public OrderedDict<string, string> MapNotes { get; set; } = new();
}

public sealed class FinanceLogState
{
    public List<FinanceEntry> Log { get; set; } = new();
}

public sealed class FinanceEntry
{
    public int Day { get; set; }
    public string Label { get; set; } = "";
    public int Amount { get; set; }
    /// <summary>分类（读取时按 label 推导，不入账）</summary>
    public string? Cat { get; set; }
}

public sealed class Team
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Tag { get; set; } = "";
    public int Tier { get; set; }
    public string RegionId { get; set; } = "";
    public int? VlrId { get; set; }
    public string? Logo { get; set; }
    public List<string> Roster { get; set; } = new();
    public List<string> Starters { get; set; } = new();
    public Coach Coach { get; set; } = new();
    public int Facilities { get; set; }
    public int Budget { get; set; }
    public int Reputation { get; set; }
    /// <summary>spender/youth/steady/wheeler</summary>
    public string Personality { get; set; } = "steady";
    /// <summary>图池熟练 20-95（插入序 = MAPS 序）</summary>
    public OrderedDict<string, int> MapPref { get; set; } = new();
    public int Bond { get; set; }
    public List<Sponsor> Sponsors { get; set; } = new();
    public StaffSlots Staff { get; set; } = new();
    public List<string> Academy { get; set; } = new();
    public OrderedDict<string, int> PatternUsage { get; set; } = new();
    /// <summary>地图预案库（mapId → 预案列表）</summary>
    public OrderedDict<string, List<Preset>> Presets { get; set; } = new();
    /// <summary>招牌战术指纹（mapId → 上场阵容指纹；结算点写入，simMap 只读）</summary>
    public OrderedDict<string, string> LastPattern { get; set; } = new();
}

public sealed class ManagerSkills
{
    public int Training { get; set; }
    public int Negotiation { get; set; }
    public int Tactics { get; set; }
    public int Scouting { get; set; }
    public int Medical { get; set; }
    public int Business { get; set; }
    public int Locker { get; set; }
    public int Youth { get; set; }
}

public sealed class ManagerLife
{
    public int Wallet { get; set; }
    public int Hunger { get; set; }
    public int Mood { get; set; }
}

public sealed class ManagerCareer
{
    public int StartYear { get; set; }
    public int Seasons { get; set; }
    /// <summary>经理冠军数（联赛+国际赛）</summary>
    public int Titles { get; set; }
    public int Wins { get; set; }
    public int Losses { get; set; }
    /// <summary>当前连败（下课触发器）</summary>
    public int LoseStreak { get; set; }
    /// <summary>董事会已警告（信任 ≤20 后置位）</summary>
    public bool Warned { get; set; }
    /// <summary>出身：legend/grassroots/analyst</summary>
    public string? Origin { get; set; }
    /// <summary>终局（下课/收官/强制退休）：写入后停止推进</summary>
    public string? Ending { get; set; }
}

public sealed class Manager
{
    public string Name { get; set; } = "";
    public int Reputation { get; set; }
    public ManagerSkills Skills { get; set; } = new();
    public ManagerLife Life { get; set; } = new();
    /// <summary>生涯账本（v1.0-6）：下课/名人堂/五年之约的数据源</summary>
    public ManagerCareer? Career { get; set; }
}

public sealed class RetireLogItem
{
    public int Year { get; set; }
    public string Ign { get; set; } = "";
    /// <summary>path=coach 时为教练名；选手退役时为退役时队伍名</summary>
    public string Name { get; set; } = "";
    public int Age { get; set; }
    public int Titles { get; set; }
    public int Mvps { get; set; }
    public int Overall { get; set; }
    /// <summary>coach/media/fade/mentor</summary>
    public string Path { get; set; } = "fade";
    public string? TeamName { get; set; }
    public string? CoachId { get; set; }
}

/// <summary>GameState：worldgen 填充子集；sim 移植时增量补集合字段。</summary>
public sealed class GameState
{
    /// <summary>种子（TS number 语义可为任意 uint32，用 long 承载）。</summary>
    public long Seed { get; set; }
    public int Year { get; set; }
    public int Day { get; set; }
    public string Stage { get; set; } = "preseason";
    public string? MyTeamId { get; set; }
    public OrderedDict<string, Team> Teams { get; set; } = new();
    public OrderedDict<string, Player> Players { get; set; } = new();
    public int LastEventDay { get; set; }
    /// <summary>情报（oppTeamId → {points,last}；插入序=侦察序）</summary>
    public OrderedDict<string, ScoutEntry> Scouting { get; set; } = new();
    /// <summary>风格特训应对熟练度（StyleKey → 点数）</summary>
    public OrderedDict<string, double> StyleCounter { get; set; } = new();
    /// <summary>当前版本补丁（末位为生效版本）</summary>
    public List<PatchNote> PatchNotes { get; set; } = new();
    /// <summary>难度：normal/hard/pro（AI 侦察强度用）</summary>
    public string? Difficulty { get; set; }
    /// <summary>赛程（插入序=生成序）</summary>
    public List<Fixture> Fixtures { get; set; } = new();
    /// <summary>待决策事件卡队列（上限 4）</summary>
    public List<PendingEventCard> PendingEvents { get; set; } = new();
    /// <summary>财务流水（唯一事实源，裁剪至最近 100 条）</summary>
    public FinanceLogState Finances { get; set; } = new();
    /// <summary>新闻流（插入序）</summary>
    public List<NewsItem> News { get; set; } = new();
    /// <summary>转会流水（feed 即账本，裁剪至最近 300 条）</summary>
    public List<TransferFeedItem> TransferFeed { get; set; } = new();
    /// <summary>退役留档（名宿叙事数据源）</summary>
    public List<RetireLogItem> RetireLog { get; set; } = new();
    public Manager Manager { get; set; } = new();
    public int BoardConfidence { get; set; }
    public object? Objective { get; set; }
    public int ActionPoints { get; set; }
    public List<string> TeamSchedule { get; set; } = new();
    public List<string> TrainingMaps { get; set; } = new();
}
