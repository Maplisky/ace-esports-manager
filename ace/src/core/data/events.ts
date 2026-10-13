/**
 * 事件卡池（GDD §9.3 v0.5-2）：20 张手写卡 + 结构化效果。
 * effects 数值即增减量；target: "player" = 抽卡时绑定的选手，"team" = 全队/俱乐部。
 * 写法遵循原作叙事风格：口语化、有性格、选项有取舍（GDD §10.3 文案基调）。
 */
import type { PendingEventOption } from "../types.ts";

export interface EventCardDef {
  id: string;
  title: string;
  text: string;
  /** 负面卡（触发 14 天抑制器） */
  negative: boolean;
  /** 权重（抽取池中的相对概率） */
  weight: number;
  options: (ctx: { ign: string; teamName: string }) => PendingEventOption[];
}

const p = (label: string, result: string, morale?: number, extra?: Partial<PendingEventOption>): PendingEventOption => ({
  label, result, morale, ...extra,
});

export const EVENT_POOL: readonly EventCardDef[] = [
  {
    id: "interview-goal", title: "赛季目标采访", negative: false, weight: 3,
    text: "本地媒体采访 {ign}：“这个赛季的目标是什么？”镜头怼到了脸上。",
    options: (c) => [
      p("放话争冠", `“我们的目标是冠军。”{ign} 说得斩钉截铁，更衣室里士气为之一振。`, 3),
      p("低调务实", "“一场一场打。”{ign} 的回答四平八稳，没有风险，也没有火花。", 1),
    ],
  },
  {
    id: "fan-gift", title: "粉丝来信", negative: false, weight: 3,
    text: "{ign} 收到一整箱粉丝来信和手绘应援卡，堆积在训练基地门口。",
    options: (c) => [
      p("公开感谢", "{ign} 在社媒晒出应援卡，粉丝社区一片欢腾。", 3),
      p("转赠队友", "应援卡贴满了训练室墙——大家训练时都更有劲了。", 2, { bond: 2 }),
    ],
  },
  {
    id: "quarrel", title: "训练室争吵", negative: true, weight: 2,
    text: "训练赛中 {ign} 和队友为一个点位争执不下，摔了鼠标，气氛僵住。",
    options: (c) => [
      p("各打五十大板", "“都少说两句。”气氛缓和了，但心结未必解开。", -1),
      p("私下疏导", "你分别找两人谈了很久，矛盾压下去了。", 1),
      p("加练共担", "罚两人搭档加练一天——不打不相识，默契反而上来了。", 0, { bond: 3, fatigue: 4 }),
    ],
  },
  {
    id: "stream-request", title: "直播邀约", negative: false, weight: 2,
    text: "{ign} 想在休息日晚间开两小时直播，和粉丝聊聊天。",
    options: (c) => [
      p("批准直播", "弹幕刷着“状态可以啊”，{ign} 心情不错——就是熬了点夜。", 3, { fatigue: 4 }),
      p("婉拒专注训练", "{ign} 点点头关掉了推流页面，多少有点遗憾。", -1),
    ],
  },
  {
    id: "net-flame", title: "网络风波", negative: true, weight: 2,
    text: "上一场失误的集锦被剪出来反复播放，{ign} 的评论区沦陷了。",
    options: (c) => [
      p("俱乐部发文力挺", "官方一声“我们信任他”，评论区风向明显好转。", 3),
      p("让时间冲淡", "不回应，不解释。{ign} 自己消化了几天，状态略有起伏。", -2),
    ],
  },
  {
    id: "muscle-tight", title: "肌肉紧绷", negative: true, weight: 2,
    text: "{ign} 训练后总觉得前臂发紧，队医建议休息观察。",
    options: (c) => [
      p("强制休息三天", "三天后复查无碍，虚惊一场。", 0, { fatigue: -6 }),
      p("贴肌效贴继续", "“小问题，能扛。”——希望真是小问题。", -1, { fatigue: 3 }),
    ],
  },
  {
    id: "grind-late", title: "深夜加练", negative: false, weight: 2,
    text: "凌晨一点，监控里还有一个人影在训练室——是 {ign}，在一个人磨枪法。",
    options: (c) => [
      p("进去陪练", "你陪他打了半小时残局。离开时他说：“稳了。”", 2, { fatigue: 3 }),
      p("劝他休息", "“明天再练。”{ign} 收拾设备回了宿舍。", 0, { fatigue: -2 }),
    ],
  },
  {
    id: "ad-shoot", title: "品牌广告拍摄", negative: false, weight: 2,
    text: "一家外设品牌想请 {ign} 拍一支广告，报价已经放到桌上。",
    options: (c) => [
      p("接下拍摄", "拍摄占用了半天训练，但 $8K 的进账很实在。", 0, { budget: 8000 }),
      p("婉拒聚焦训练", "经纪人说“训练期不接”。品牌方表示遗憾。", 0),
    ],
  },
  {
    id: "rival-taunt", title: "对手挑衅", negative: true, weight: 2,
    text: "对手选手在直播里公开嘲讽：“{teamName}？他们不值得研究。”",
    options: (c) => [
      p("官方回击", "俱乐部账号发布训练照配文：“赛场上见。”粉丝炸了。", 2),
      p("沉默是金", "不予理会——用成绩说话。", 0),
      p("让 {ign} 反击", "{ign} 的回击视频播放量爆炸，本人斗志高涨。", 4),
    ],
  },
  {
    id: "gaming-cafe", title: "网吧签名会", negative: false, weight: 1,
    text: "一家连锁网吧邀请全队出席线下签名会，与粉丝近距离互动。",
    options: (c) => [
      p("全队出席", "排队两小时的粉丝让队员们受宠若惊，士气与口碑双收。", 2, { reputation: 1, fatigue: 3 }),
      p("派队长代表", "队长带去了签名队服，效果中规中矩。", 1),
    ],
  },
  {
    id: "old-friend", title: "故人来访", negative: false, weight: 1,
    text: "{ign} 的老教练来基地探班，带来了一箱家乡特产。",
    options: (c) => [
      p("共进晚餐", "一顿饭吃得其乐融融，{ign} 的状态肉眼可见地松弛了。", 3),
      p("婉言谢绝", "训练为重，探访改期。", 0),
    ],
  },
  {
    id: "device-broken", title: "设备故障", negative: true, weight: 1,
    text: "{ign} 的主力鼠标在训练中双击失灵——他坚持那是“手感的一部分”。",
    options: (c) => [
      p("立即换新旗舰", "新鼠标到货，{ign} 爱不释手。", 2, { budget: -1500 }),
      p("用备件凑合", "备件手感一般，{ign} 有点别扭。", -1),
    ],
  },
  {
    id: "content-viral", title: "离谱名场面", negative: false, weight: 2,
    text: "{ign} 在训练赛的一记离谱操作被剪成梗视频全网传播。",
    options: (c) => [
      p("官方玩梗", "俱乐部账号跟进二创，播放量再翻一番。", 2),
      p("低调处理", "训练内容不该外传——删了。{ign} 有点可惜。", 0),
    ],
  },
  {
    id: "study-tactic", title: "战术笔记", negative: false, weight: 2,
    text: "{ign} 交上来一份手写的战术笔记，密密麻麻二十页。",
    options: (c) => [
      p("全队传阅", "笔记印出来人手一份，大家都被这份用心感染。", 2, { bond: 2 }),
      p("私下嘉奖", "你单独请 {ign} 吃了顿好的，笔记收进教练组档案。", 3),
    ],
  },
  {
    id: "spam-scam", title: "可疑私信", negative: true, weight: 1,
    text: "{ign} 收到“高薪试训”的私信，条款好得不太真实——像是骗局。",
    options: (c) => [
      p("俱乐部辟谣提醒", "官方发布防诈骗提示，粉丝称赞处理及时。", 1),
      p("让经纪人处理", "经纪人拉黑了对方，风波止于萌芽。", 0),
    ],
  },
  {
    id: "fan-meet-issue", title: "签名会争执", negative: true, weight: 1,
    text: "签名会上有粉丝越过警戒线拉扯 {ign}，现场一度混乱。",
    options: (c) => [
      p("安抚粉丝", "{ign} 主动缓和气氛，还多签了十分钟。口碑 +1。", 2),
      p("加强安保", "流程整改，安全第一。{ign} 心有余悸。", -1),
    ],
  },
  {
    id: "role-model", title: "青训询问", negative: false, weight: 1,
    text: "本地青训机构来信：孩子们想请 {ign} 录一段鼓励视频。",
    options: (c) => [
      p("录视频鼓励", "视频在青训营循环播放，{ign} 的名字成了孩子们的目标。", 2, { reputation: 1 }),
      p("婉拒", "训练日程太满，遗憾婉拒。", 0),
    ],
  },
  {
    id: "roommate", title: "宿舍调换", negative: false, weight: 1,
    text: "{ign} 提出想换宿舍——隔壁工地的施工声太吵，睡不好。",
    options: (c) => [
      p("立即调换", "行政部门连夜安排，{ign} 睡了个好觉。", 2, { budget: -2000 }),
      p("装隔音耳塞", "耳塞解决了大半问题。", 0, { budget: -200 }),
    ],
  },
  {
    id: "nutrition", title: "营养师建议", negative: false, weight: 1,
    text: "营养师提交了针对 {ign} 的特调食谱——预算要涨一点。",
    options: (c) => [
      p("批准特调", "两周后 {ign} 的体能数据肉眼可见地好转。", 1, { budget: -1500, fatigue: -4 }),
      p("维持现状", "食堂标准餐继续。", 0),
    ],
  },
  {
    id: "tournament-vod", title: "对手录像带", negative: false, weight: 2,
    text: "匿名邮件送来一份对手最近的完整训练录像——来源不明。",
    options: (c) => [
      p("收下研究", "教练组连夜拆解录像。来源问题装作没看见。", 1),
      p("原样退回", "“赢要赢得干净。”录像原封退回。", 0, { reputation: 1 }),
    ],
  },
];
