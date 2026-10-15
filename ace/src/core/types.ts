/** ACE core 类型定义 — 与 GDD §4.4 数据 Schema 同构（调研导出的原作 JSON 为模板） */

export type Duty = "duelist" | "initiator" | "controller" | "sentinel";

/** 赛历阶段（GDD §4.2）：自然年内六段 + 休赛期 */
export type Stage = "preseason" | "cup" | "stage1" | "summer" | "stage2" | "offseason" | "masters" | "champions";


/** 职责向量：四项之和 = 1（GDD §6.1） */
export interface DutyVector {
  duelist: number;
  initiator: number;
  controller: number;
  sentinel: number;
}

export type UltTier = "core" | "harvest" | "combo" | "utility" | "info";

export interface AgentDef {
  id: string;
  name: string;
  duty: DutyVector;
  /** 大招档位（可多标签，首个为主档；GDD §5.4 v1.6 多标签规则） */
  ultTiers: UltTier[];
  /** 大招所需点数（v1.0 按真实游戏逐特工实录：芮娜/赛博/不死鸟/幻棱 6，杰斯/猎枭/贤者等 8） */
  ultCost: number;
  /** 机制标签：驱动地图适配 fit 与推荐训练项（侦察/烟幕/闪光/信息/机动/哨置/治疗/强开） */
  mechTags: string[];
  newUntilVersion?: string;
}

export interface MapDef {
  id: string;
  name: string;
  sites: 2 | 3;
  /** 几何标签 0-1：驱动 fit 推导（GDD §4.3 v1.9） */
  openness: number;
  vertical: number;
  corridor: number;
}

export interface PlayerAttrs {
  aim: number;
  reaction: number;
  awareness: number;
  utility: number;
  clutch: number;
  teamwork: number;
  communication: number;
  igl: number;
}

export interface PlayerCareer {
  maps: number;
  rounds: number;
  kills: number;
  deaths: number;
  assists: number;
  firstKills: number;
  firstDeaths: number;
  clutches: number;
  mvps: number;
  titles: number;
  /** 曾效力俱乐部（id 列表，按时间序） */
  clubs: string[];
}

export interface Player {
  id: string;
  ign: string;
  /** 真实姓名（vlr.gg；虚拟选手为空） */
  realName?: string;
  /** 国籍/地区码（vlr.gg flag，如 fi / kr / cn） */
  country?: string;
  /** 头像（public/assets 相对路径） */
  avatar?: string;
  /** 虚拟生成标注：academy=青训补充 / free=自由池（非 vlr.gg 数据，UI 需标注） */
  synthetic?: "academy" | "free" | "rookie";
  age: number;
  teamId: string | null;
  attrs: PlayerAttrs;
  /** 综合能力（由八维加权合成，见 strength.ts） */
  overall: number;
  potential: number;
  peakOverall: number;
  form: number; // 30-99
  morale: number; // 10-100
  fatigue: number; // 0-100
  salary: number;
  contractYears: number;
  agentPool: string[];
  agentPro: Record<string, number>; // 0-100
  isIgl: boolean;
  /** 副指挥（最多 1 人；强度 mid 微加成，GDD 外用户需求） */
  viceIgl?: boolean;
  /** 承诺角色（GDD §6.4 出场期望）：core/starter/rotation/bench */
  promisedRole: "core" | "starter" | "rotation" | "bench";
  /** 个人训练经验池（attr key → 0-100，攒满 +1 属性；GDD §6.3） */
  xp: Record<string, number>;
  /** 个人训练项目（本周；key 见 data/training.ts） */
  focus: string;
  /** 挂牌中（转会费 ×0.75，AI 更愿意报价） */
  listed: boolean;
  /** 解约金（0 = 无；报价 ≥ 解约金时原队无权拒绝） */
  releaseClause: number;
  /** 抢人保护条款（挂牌/解约金触发前其他队不可报价） */
  noPoach: boolean;
  /** 已挂牌周数（AI 摘牌计时；我方挂牌显示用） */
  listedWeeks?: number;
  /** 选手特质（0-3 条，原作 traits 移植）：key 见 data/traits.ts */
  traits?: string[];
  /** 野心（v1.0 退役检定输入，35-85；旧档缺省 50） */
  ambition?: number;
  /** 导师型替补起始年（v1.0 替补三正路；旧档缺省无） */
  mentorSince?: number;
  /** 替补三正路（v1.0）：接班人 / 导师 / 学习型（GDD §6.4；旧档缺省无） */
  track?: "successor" | "mentor" | "learner";
  /** 接班人的导师（队内首发老将 id；离队触发自动转正） */
  mentorId?: string;
  injuredUntilDay: number;
  /** 导师型替补绑定的弟子 id（= track 为 successor 的选手） */
  apprenticeId?: string;
  /** 本队青训标记 */
  homegrown: boolean;
  /** 生涯累计缺场周数（挖角倾向参考） */
  benchedWeeks: number;
  /** 本周商务占用天数（≥2 天训练收益 −25%/天；每周重置） */
  commercialDays: number;
  /** 直播合同（null = 无；GDD §8.4） */
  stream: { weekly: number; untilDay: number } | null;
  /** 生日（赛季内第 N 天，seeded 生成；当日开 7 天祝福窗口） */
  birthdayDay: number;
  /** 上次成为负面事件主角的天（14 天抑制器） */
  lastEventDay: number;
  career: PlayerCareer;
}

export interface Coach {
  name: string;
  tactics: number;
  development: number;
  motivation: number;
}

export interface PatchChange {
  agentId: string;
  meta: number;
  dir: "buff" | "nerf";
  pct: number;
}

export interface PatchNote {
  version: string;
  changes: PatchChange[];
  mapNotes: { mapId: string; text: string }[];
}

export type Personality = "spender" | "youth" | "steady" | "wheeler";

export interface Team {
  id: string;
  name: string;
  tag: string;
  tier: 1 | 2;
  /** 赛区（v0.7 真实四赛区：americas / emea / pacific / china；旧档 xia/yao 兼容） */
  regionId: string;
  /** vlr.gg 队伍 id（真实数据包；虚拟队为空） */
  vlrId?: number;
  /** 队徽（public/assets 相对路径；无则 UI 用首字母 fallback） */
  logo?: string;
  roster: string[];
  starters: string[];
  coach: Coach;
  facilities: number;
  budget: number;
  reputation: number;
  personality: Personality;
  /** 图池熟练 20-95（key = mapId） */
  mapPref: Record<string, number>;
  /** 全队羁绊 0-100 */
  bond: number;
  /** 赞助商（GDD §8.4） */
  sponsors: Sponsor[];
  /** 教练组（GDD §8.3 v1.7：训练/地图战术/比赛三类助教，主数值 0-99） */
  staff: {
    training?: { name: string; value: number };
    mapTactics?: { name: string; value: number };
    match?: { name: string; value: number };
  };
  /** 青训营（v0.9）：≤18 岁选手池，不占一线名单；成长 ×1.5、比赛经验 ×0.5（GDD §6.5） */
  academy: string[];
  /** 招牌战术使用计数（key = mapId；对手针对性准备的泄露来源，GDD §6.4） */
  patternUsage: Record<string, number>;
  /** 玩家可用预案：每图多套（key = mapId）；v0.1 core 仅存储，由战术层消费 */
  presets: Record<string, Preset[]>;
}

export interface Sponsor {
  id: string;
  name: string;
  tier: 1 | 2 | 3;
  perSeason: number;
  years: number;
  signedYear: number;
}

export interface SponsorOffer extends Sponsor {
  expires: number;
}

export interface TransferInquiry {
  id: string;
  playerId: string;
  /** 发起日 */
  askDay: number;
  /** 反馈日（askDay + 2~5） */
  resolveDay: number;
  done: boolean;
  /** 反馈：俱乐部要价（美元） */
  askingFee: number;
  /** 反馈：本人意向文案 */
  intent: string;
}

export interface GigOffer {
  id: string;
  playerId: string;
  brand: string;
  pay: number;
  day: number;
}

export interface Preset {
  name: string;
  /** 选手 id → 英雄 id */
  agents: Record<string, string>;
  /** 首选标记 */
  preferred?: boolean;
}

export type BuyType = "full" | "force" | "eco";

export interface RoundEvent {
  t: "kill" | "plant" | "defuse" | "ultReady" | "timeout" | "ace" | "clutch" | "flawless";
  /** 击杀者/动作主体 */
  s?: string;
  /** 受害者 */
  v?: string;
  first?: boolean;
  /** 1vX 残局 X */
  vs?: number;
  /** 大招就绪的档位 */
  tier?: UltTier;
  side?: "A" | "B";
  /** 击杀伤害（实时 ACS 用；旧档缺省按 150） */
  dmg?: number;
}

export interface RoundRecord {
  n: number;
  /** 本回合进攻方 */
  atk: "A" | "B";
  buys: { A: BuyType; B: BuyType };
  /** 开局战术（GDD §5.4 二期；旧档缺省 default/standard） */
  tacticAtk?: string;
  tacticDef?: string;
  events: RoundEvent[];
  end: {
    win: "A" | "B";
    how: "elim" | "spike" | "defuse" | "time";
    alive: { A: number; B: number };
    score: [number, number];
    /** 回合末助攻名单（胜方存活无击杀者的 teamplay 判定；旧档缺省 []） */
    assists?: string[];
    /** 回合残伤（选手 id → 非击杀伤害；实时 ACS 揭示用，旧档缺省 {}） */
    dmgBonus?: Record<string, number>;
    /** 回合末大招进度（就绪=7；旧档缺省 {}） */
    ults?: Record<string, number>;
    /** 回合末经济池（team money，旧档缺省 null） */
    money?: { A: number; B: number } | null;
  };
}

export interface PlayerLine {
  kills: number;
  deaths: number;
  assists: number;
  firstKills: number;
  firstDeaths: number;
  clutches: number;
  damage: number;
  rounds: number;
  acs: number;
}

  /** 单边强度修正分解（GDD §5.2 edge，§10.2 归因条数据源） */
  export interface EdgeBreakdown {
    base: number;
    igl: number;
    chem: number;
    coach: number;
    meta: number;
    map: number;
    prep: number;
    familiarity: number;
    shortHanded: number;
    aim: number;
    awareness: number;
    mapTactics: number;
  }

export interface MapRecord {
  map: string;
  /** [A 得分, B 得分] */
  score: [number, number];
  rounds: RoundRecord[];
  lines: Record<string, PlayerLine>;
  mvp: string | null;
  /** 本图英雄分配（选手 id → 英雄 id），播放器展示用 */
  agents: Record<string, string>;
  /** 双方强度归因分解（赛后归因条） */
  edges: { A: EdgeBreakdown; B: EdgeBreakdown };
}

export interface MatchRecord {
  id: string;
  seed: number;
  format: 1 | 3 | 5;
  teamA: string;
  teamB: string;
  stage: string;
  day: number;
  maps: MapRecord[];
  /** [A 图胜, B 图胜] */
  score: [number, number];
  winner: "A" | "B";
  mvp: string | null;
}

export interface Fixture {
  id: string;
  day: number;
  stage: Stage;
  comp: string;
  teamA: string;
  teamB: string;
  bo: 1 | 3 | 5;
  label: string;
  played: boolean;
  /** 赛果（打完即写）：胜者队 id——双败树回填/GSL 推进/积分名次的唯一事实源 */
  winnerTeamId?: string;
  /** 玩家手动 BP 锁定的图序列（赛前准备写入，引擎优先于自动 BP） */
  mapLock?: string[];
  /** 赛前准备的每图英雄分配（mapId → 选手 id → 英雄 id）；随比赛走，不污染预案库 */
  agentLock?: Record<string, Record<string, string>>;
  /** 淘汰赛胜者去向（下一轮 fixtureId），杯赛/双败树用 */
  nextFixtureId?: string;
  /** 双败树败者去向（败者组下一轮 fixtureId） */
  nextLoserFixtureId?: string;
}

export interface StandingsEntry {
  teamId: string;
  w: number;
  l: number;
  mapW: number;
  mapL: number;
  roundW: number;
  roundL: number;
  pts: number;
}

export interface Competition {
  key: string;
  name: string;
  stage: Fixture["stage"];
  teamIds: string[];
  standings: Record<string, StandingsEntry>;
}

export interface NewsItem {
  day: number;
  kind: "match" | "transfer" | "club" | "league";
  text: string;
  important?: boolean;
}

/** 转会动态（GDD §8.2 Feed，上限 300 条） */
export interface TransferFeedItem {
  day: number;
  year: number;
  kind: "done" | "bid" | "list" | "release" | "retire";
  text: string;
}

/** 教练自由池条目（v1.0 退役转教练） */
export interface CoachFreeAgent {
  id: string;
  name: string;
  fame: number;
  comm: number;
  titles: number;
  mvps: number;
  isIgl: boolean;
  homegrownClubId: string | null;
  retiredYear: number;
  value: number;
}

/** 退役留档（名人堂页数据源） */
export interface RetireLogItem {
  year: number;
  ign: string;
  name: string;
  age: number;
  titles: number;
  mvps: number;
  overall: number;
  path: "coach" | "media" | "fade" | "mentor";
  teamName: string | null;
  coachId?: string;
}

/** 一份转会报价（含即时谈判进度；GDD §8.2 v1.1） */
export interface TransferOffer {
  id: string;
  playerId: string;
  fromTeam: string | null; // null = 自由签约
  toTeam: string;
  fee: number;
  salary: number;
  years: number;
  signingBonus: number;
  promisedRole: "core" | "starter" | "rotation" | "bench";
  /** 替补三正路（v1.0）：bench/rotation 定位时可附 teleport 接班人/导师/学习型（GDD §6.4） */
  track?: "successor" | "mentor" | "learner";
  /** 报价日（答复窗 7 天） */
  day: number;
  /** 谈判轮次（1-3）；0 = 尚未开谈 */
  round: number;
  /** AI 最新诉求文本 */
  demand: string;
  /** 接受概率 0-1（实时评估） */
  attitude: number;
}

export interface NegotiationSession {
  offer: TransferOffer;
  /** 本会话的谈判日志 */
  log: string[];
  /** 是否已到终局（成/败已定） */
  settled: false;
}

/** 事件卡选项（GDD §9.3） */
export interface PendingEventOption {
  label: string;
  /** 结果文本（选定后展示） */
  result: string;
  /** 数值效果 */
  morale?: number; // 目标选手士气
  teamMorale?: number; // 全队士气
  budget?: number;
  reputation?: number;
  trust?: number;
  grievance?: number;
  fatigue?: number;
  bond?: number;
  boardConfidence?: number;
}

/** 待决策事件卡实例（抽取时已绑定目标选手） */
export interface PendingEventCard {
  uid: string;
  cardId: string;
  title: string;
  text: string;
  /** 负面卡（抑制器计数用） */
  negative: boolean;
  targetPlayerId?: string;
  day: number;
  options: PendingEventOption[];
  /** 卡专属数据（如选秀卡携带冻结新秀 id 列表；随存档序列化） */
  payload?: Record<string, unknown>;
}

export interface Objective {
  stage: Fixture["stage"];
  placeAtLeast: number;
  text: string;
}

/** 全局状态：存档即此结构的序列化（ACESAVE v1） */
export interface GameState {
  seed: number;
  year: number;
  day: number;
  stage: Fixture["stage"];
  myTeamId: string | null;
  teams: Record<string, Team>;
  players: Record<string, Player>;
  fixtures: Fixture[];
  comps: Record<string, Competition>;
  news: NewsItem[];
  /** 经理（v0.5：8 项技能挂接转会/训练/医疗等系统；GDD §9.5） */
  manager: {
    name: string;
    reputation: number;
    skills: Record<string, number>;
    /** 个人生活（v0.5-5 教练个人经济）：钱包/饱腹/心情，只影响经理自身效率 */
    life: { wallet: number; hunger: number; mood: number };
    /** 生涯账本（v1.0-6，GDD §9.5）：下课/名人堂/五年之约的数据源 */
    career?: {
      startYear: number;
      seasons: number;
      titles: number; // 经理冠军数（联赛+国际赛）
      wins: number;
      losses: number;
      loseStreak: number; // 当前连败（下课触发器）
      warned: boolean; // 董事会已警告（信任 ≤20 后置位）
      /** 出身（开档 3 选 1）：legend=前豪门名宿 / grassroots=次级草根 / analyst=数据分析师 */
      origin?: "legend" | "grassroots" | "analyst";
      /** 终局（下课/收官/强制退休）：写入后 App 停止推进并显示结局卡 */
      ending?: { kind: "fired" | "retired" | "hall" | "contract"; year: number; day: number };
    };
  };
  /** 转会动态（最近 300 条） */
  transferFeed: TransferFeedItem[];
  /** 教练自由池（v1.0 退役转教练；worker migrate 兜底） */
  coachPool?: CoachFreeAgent[];
  /** 退役留档（名人堂页数据源） */
  retireLog?: RetireLogItem[];
  /** 冠军积分账本（v1.0 国际赛资格；worker migrate 兜底） */
  circuitPoints?: Record<string, number>;
  /** 最近一届选秀留档（v1.0-4；名人堂/生涯页数据源） */
  lastDraft?: { year: number; picks: { pickNo: number; teamId: string; playerId: string }[] };
  /** 赛区风格 META（v1.0-5，GDD §18-3）：每赛区 t1 队伍聚合的风格倾向（展示+国际赛叙事） */
  regionMeta?: Record<string, { style: string; aggr: number }>;
  /** 待答复的 AI 报价（挖角我方；7 天答复窗） */
  incomingBids: TransferOffer[];
  /** 轮换沟通豁免（本周已沟通的选手 id；周重置，每周 2 次） */
  rotationWaive: string[];
  rotationTalks: { week: number; used: number };
  /** 练英雄（GDD §6.3）：pid → 目标英雄；≤5 人/周，周结算熟练 +4.2×效率（0.7+(意识+道具)/400），池外英雄 34 入池 */
  agentTraining: Record<string, string>;
  /** 问价（GDD §8.2 原作式异步）：发起后 2-5 天出要价+意向，结果置顶可从结果报价 */
  inquiries: TransferInquiry[];
  /** 版本历史（meta 二维化，GDD §4.3）：末条为当前生效版本 */
  patchNotes: PatchNote[];
  /** 待决策事件卡队列（先进先出，玩家逐张处理；GDD §9.3） */
  pendingEvents: PendingEventCard[];
  /** 上次事件日（空回合补偿用） */
  lastEventDay: number;
  /** 情报系统（GDD §7.2）：对手 teamId → 情报点 0-10 与最近侦察日 */
  scouting: Record<string, { points: number; last: number }>;
  /** 赞助意向池（每周刷新，带过期） */
  sponsorOffers: SponsorOffer[];
  /** 选手商务邀约（本周有效） */
  gigOffers: GigOffer[];
  /** 资金流水（最近 100 条；余额以 team.budget 为准） */
  finances: { log: { day: number; label: string; amount: number }[] };
  boardConfidence: number;
  objective: Objective | null;
  /** 行动力（v0.1：3/天） */
  actionPoints: number;
  /** 收件箱待办（助教建议 Top3 的数据源） */
  inbox: InboxItem[];
  /** 训练课表：playerId → 7 天个人轨道（v0.1 简化：记录主项目） */
  schedules: Record<string, string>;
  /** 团队周课表：7 槽项目 map/review/scrim/individual/rest */
  teamSchedule: string[];
  /** 跑图计划针对的地图（≤2 张） */
  trainingMaps: string[];
}

export interface InboxItem {
  id: string;
  day: number;
  kind: "advice" | "event" | "deadline";
  text: string;
  reason?: string;
}
