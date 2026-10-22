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
    /// <summary>状态（TS number 语义：周结算产生小数，严禁 int 截断）</summary>
    public double Form { get; set; }
    public double Morale { get; set; }
    public double Fatigue { get; set; }
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
    /// <summary>已挂牌周数（AI 摘牌计时）</summary>
    public int? ListedWeeks { get; set; }
    public int ReleaseClause { get; set; }
    public bool NoPoach { get; set; }
    public List<string> Traits { get; set; } = new();
    /// <summary>野心（退役检定输入，35-85）</summary>
    public int Ambition { get; set; }
    /// <summary>替补三正路（v1.0）：successor/mentor/learner</summary>
    public string? Track { get; set; }
    /// <summary>接班人的导师（队内首发老将 id）</summary>
    public string? MentorId { get; set; }
    /// <summary>转导师型替补的年份（retirement 劝留卡写入）</summary>
    public int? MentorSince { get; set; }
    public int InjuredUntilDay { get; set; }
    public bool Homegrown { get; set; }
    public int BenchedWeeks { get; set; }
    /// <summary>本周商务占用天数（≥2 天训练收益 −25%/天；每周重置）</summary>
    public int CommercialDays { get; set; }
    /// <summary>个人积蓄（§8.4 v1.4：直播 60% 分成入个人钱包；TS 可选语义——入账前 undefined）</summary>
    public int? Wallet { get; set; }
    /// <summary>人气值 0-100（直播涨人气；加成商务邀约报酬）</summary>
    public int? Popularity { get; set; }
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

public class Sponsor
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public int Tier { get; set; }
    public int PerSeason { get; set; }
    public int Years { get; set; }
    public int SignedYear { get; set; }
    /// <summary>业绩条款（§8.4 v1.4）：联赛四强 ×1.2 / 夺冠 ×1.5——默认签约即带；weeklySponsorIncome 以 bonus===false 区分无条款</summary>
    public bool? Bonus { get; set; }
}

/// <summary>赞助意向（赞助 + 过期日）。</summary>
public sealed class SponsorOffer : Sponsor
{
    public int Expires { get; set; }
}

public sealed class GigOffer
{
    public string Id { get; set; } = "";
    public string PlayerId { get; set; } = "";
    public string Brand { get; set; } = "";
    public int Pay { get; set; }
    public int Day { get; set; }
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
    /// <summary>预算（TS number 语义：退役补偿等小数运算不改写，严禁 int 截断）</summary>
    public double Budget { get; set; }
    public int Reputation { get; set; }
    /// <summary>spender/youth/steady/wheeler</summary>
    public string Personality { get; set; } = "steady";
    /// <summary>图池熟练 20-95（插入序 = MAPS 序；周结算 +0.4×比赛折减浮点累进，round 会吃掉小数增量）</summary>
    public OrderedDict<string, double> MapPref { get; set; } = new();
    /// <summary>羁绊 0-100（TS number 语义：训练赛收益含小数增量）</summary>
    public double Bond { get; set; }
    public List<Sponsor> Sponsors { get; set; } = new();
    public StaffSlots Staff { get; set; } = new();
    public List<string> Academy { get; set; } = new();
    public OrderedDict<string, int> PatternUsage { get; set; } = new();
    /// <summary>地图预案库（mapId → 预案列表）</summary>
    public OrderedDict<string, List<Preset>> Presets { get; set; } = new();
    /// <summary>招牌战术指纹（mapId → 上场阵容指纹；结算点写入，simMap 只读）</summary>
    public OrderedDict<string, string> LastPattern { get; set; } = new();
}

/// <summary>选秀权交易转移（from 的一个签位转给 to）。</summary>
public sealed class DraftPickMove
{
    public string From { get; set; } = "";
    public string To { get; set; } = "";
}

public sealed class DraftPickRow
{
    public int PickNo { get; set; }
    public string TeamId { get; set; } = "";
    /// <summary>我队签位决策前留空（结算后补记）</summary>
    public string PlayerId { get; set; } = "";
}

public sealed class LastDraftRecord
{
    public int Year { get; set; }
    public List<DraftPickRow> Picks { get; set; } = new();
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

public sealed class CareerEnding
{
    /// <summary>fired/retired/hall</summary>
    public string Kind { get; set; } = "fired";
    public int Year { get; set; }
    public int Day { get; set; }
}

/// <summary>转会报价（含即时谈判进度；GDD §8.2 v1.1）。</summary>
public sealed class TransferOffer
{
    public string Id { get; set; } = "";
    public string PlayerId { get; set; } = "";
    /// <summary>null = 自由签约</summary>
    public string? FromTeam { get; set; }
    public string ToTeam { get; set; } = "";
    /// <summary>转会费（TS 各赋值点均经 Math.round 取整）</summary>
    public int Fee { get; set; }
    public int Salary { get; set; }
    public int Years { get; set; }
    public int SigningBonus { get; set; }
    /// <summary>core/starter/rotation/bench</summary>
    public string PromisedRole { get; set; } = "bench";
    /// <summary>替补三正路：successor/mentor/learner</summary>
    public string? Track { get; set; }
    /// <summary>报价日（答复窗 7 天）</summary>
    public int Day { get; set; }
    /// <summary>谈判轮次（1-3）；0 = 尚未开谈</summary>
    public int Round { get; set; }
    /// <summary>AI 最新诉求文本</summary>
    public string Demand { get; set; } = "";
    /// <summary>接受概率 0-100（实时评估）</summary>
    public int Attitude { get; set; }
}

/// <summary>问价单（原作式异步：2-5 天后反馈要价与意向）。</summary>
public sealed class TransferInquiry
{
    public string Id { get; set; } = "";
    public string PlayerId { get; set; } = "";
    public int AskDay { get; set; }
    public int ResolveDay { get; set; }
    public bool Done { get; set; }
    public int AskingFee { get; set; }
    public string Intent { get; set; } = "";
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
    /// <summary>分类冠军账本（大满贯判定；插入序）</summary>
    public OrderedDict<string, int> TitleKinds { get; set; } = new();
    /// <summary>跳槽次数（雇佣兵线成就数据源）</summary>
    public int JobHops { get; set; }
    /// <summary>终局（下课/收官/强制退休）：写入后停止推进</summary>
    public CareerEnding? Ending { get; set; }
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
    /// <summary>冠军积分（Champions 资格/选秀顺位）</summary>
    public OrderedDict<string, double> CircuitPoints { get; set; } = new();
    /// <summary>选秀权交易记录（应用即清空）</summary>
    public List<DraftPickMove> DraftPickMoves { get; set; } = new();
    /// <summary>上届选秀留档</summary>
    public LastDraftRecord? LastDraft { get; set; }
    /// <summary>收到 AI 报价（待我方答复）</summary>
    public List<TransferOffer> IncomingBids { get; set; } = new();
    /// <summary>问价单（原作式异步）</summary>
    public List<TransferInquiry> Inquiries { get; set; } = new();
    /// <summary>赞助意向池（我队）</summary>
    public List<SponsorOffer> SponsorOffers { get; set; } = new();
    /// <summary>选手商务邀约池（我队）</summary>
    public List<GigOffer> GigOffers { get; set; } = new();
    /// <summary>赞助业绩倍率（联赛四强 1.2 / 夺冠 1.5；缺省 1）</summary>
    public double? SponsorMult { get; set; }
    public Manager Manager { get; set; } = new();
    public int BoardConfidence { get; set; }
    public Objective? Objective { get; set; }
    public int ActionPoints { get; set; }
    public List<string> TeamSchedule { get; set; } = new();
    public List<string> TrainingMaps { get; set; } = new();
    /// <summary>赛事表（插入序=创建序；新赛季清理保留 cup 与 stageN-x-tN）</summary>
    public OrderedDict<string, Competition> Comps { get; set; } = new();
    /// <summary>选手个人训练焦点（playerId → option key）</summary>
    public OrderedDict<string, string> Schedules { get; set; } = new();
    /// <summary>轮换沟通豁免名单（每周 2 次，跨周清空）</summary>
    public List<string> RotationWaive { get; set; } = new();
    public RotationTalksState RotationTalks { get; set; } = new();
    /// <summary>练英雄计划（playerId → agentId；结算取前 5 条）</summary>
    public OrderedDict<string, string> AgentTraining { get; set; } = new();
    /// <summary>赛区风格 META（赛区 id → 风格/进攻性均值；展示+国际赛叙事）</summary>
    public OrderedDict<string, RegionMetaEntry> RegionMeta { get; set; } = new();
    /// <summary>训练赛记录（上限 20 条）</summary>
    public List<ScrimLogEntry> ScrimLog { get; set; } = new();
    /// <summary>已解锁成就（id → 解锁时间；幂等判定）</summary>
    public OrderedDict<string, AchievementUnlock> Achievements { get; set; } = new();
    /// <summary>教练自由池（退役名宿；任何俱乐部可签）</summary>
    public List<CoachFreeAgent> CoachPool { get; set; } = new();
}

public sealed class ScrimLogEntry
{
    public int Day { get; set; }
    public string OppId { get; set; } = "";
    public string MapId { get; set; } = "";
    /// <summary>blend/style/mappool</summary>
    public string Goal { get; set; } = "";
    public int ScoreA { get; set; }
    public int ScoreB { get; set; }
    public bool Won { get; set; }
}

public sealed class AchievementUnlock
{
    public int Year { get; set; }
    public int Day { get; set; }
}

/// <summary>教练自由池成员（退役选手折算；fame 名望 / value 执教能力）。</summary>
public sealed class CoachFreeAgent
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public int Fame { get; set; }
    /// <summary>沟通属性（double：来自选手八维）</summary>
    public double Comm { get; set; }
    public int Titles { get; set; }
    public int Mvps { get; set; }
    public bool IsIgl { get; set; }
    /// <summary>母队（青训出身；名宿回归叙事用）</summary>
    public string? HomegrownClubId { get; set; }
    public int RetiredYear { get; set; }
    public int Value { get; set; }
}

public sealed class StandingsEntry
{
    public string TeamId { get; set; } = "";
    public int W { get; set; }
    public int L { get; set; }
    public int MapW { get; set; }
    public int MapL { get; set; }
    public int RoundW { get; set; }
    public int RoundL { get; set; }
    public int Pts { get; set; }
}

public sealed class Competition
{
    public string Key { get; set; } = "";
    public string Name { get; set; } = "";
    public string Stage { get; set; } = "";
    public List<string> TeamIds { get; set; } = new();
    /// <summary>插入序=teamIds 序（积分榜平局时的稳定序依赖此序）</summary>
    public OrderedDict<string, StandingsEntry> Standings { get; set; } = new();
}

/// <summary>董事会阶段目标（GDD §9.5）</summary>
public sealed class Objective
{
    public string Stage { get; set; } = "";
    public int PlaceAtLeast { get; set; }
    public string Text { get; set; } = "";
}

public sealed class RegionMetaEntry
{
    public string Style { get; set; } = "";
    public double Aggr { get; set; }
}

public sealed class RotationTalksState
{
    public int Week { get; set; }
    public int Used { get; set; }
}
