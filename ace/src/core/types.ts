/** ACE core 类型定义 — 与 GDD §4.4 数据 Schema 同构（调研导出的原作 JSON 为模板） */

export type Duty = "duelist" | "initiator" | "controller" | "sentinel";

/** 赛历阶段（GDD §4.2）：自然年内六段 + 休赛期 */
export type Stage = "preseason" | "cup" | "stage1" | "summer" | "stage2" | "offseason";

export const DUTIES: readonly Duty[] = ["duelist", "initiator", "controller", "sentinel"];

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
  injuredUntilDay: number;
  /** 导师型替补绑定的弟子 id */
  apprenticeId?: string;
  /** 本队青训标记 */
  homegrown: boolean;
  /** 生涯累计缺场周数（挖角倾向参考） */
  benchedWeeks: number;
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

export type Personality = "spender" | "youth" | "steady" | "wheeler";

export interface Team {
  id: string;
  name: string;
  tag: string;
  tier: 1 | 2;
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
  /** 玩家可用预案：每图多套（key = mapId）；v0.1 core 仅存储，由战术层消费 */
  presets: Record<string, Preset[]>;
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
}

export interface RoundRecord {
  n: number;
  /** 本回合进攻方 */
  atk: "A" | "B";
  buys: { A: BuyType; B: BuyType };
  events: RoundEvent[];
  end: {
    win: "A" | "B";
    how: "elim" | "spike" | "defuse" | "time";
    alive: { A: number; B: number };
    score: [number, number];
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
  /** 玩家手动 BP 锁定的图序列（赛前准备写入，引擎优先于自动 BP） */
  mapLock?: string[];
  /** 赛前准备的每图英雄分配（mapId → 选手 id → 英雄 id）；随比赛走，不污染预案库 */
  agentLock?: Record<string, Record<string, string>>;
  /** 淘汰赛胜者去向（下一轮 fixtureId），杯赛用 */
  nextFixtureId?: string;
  /** 淘汰赛 slot 标记（teamA/teamB 待定时的占位） */
  slotFor?: "winner" | "loser";
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
  kind: "done" | "bid" | "list" | "release";
  text: string;
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
  };
  /** 转会动态（最近 300 条） */
  transferFeed: TransferFeedItem[];
  /** 待答复的 AI 报价（挖角我方；7 天答复窗） */
  incomingBids: TransferOffer[];
  /** 待决策事件卡队列（先进先出，玩家逐张处理；GDD §9.3） */
  pendingEvents: PendingEventCard[];
  /** 上次事件日（空回合补偿用） */
  lastEventDay: number;
  /** 情报系统（GDD §7.2）：对手 teamId → 情报点 0-10 与最近侦察日 */
  scouting: Record<string, { points: number; last: number }>;
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
