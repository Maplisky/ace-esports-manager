using System.Collections.Generic;

namespace Kairo.Core;

/// <summary>
/// 事件卡池（GDD §9.3 v0.5-2）— 数据移植自 ace/src/core/data/events.ts（20 张手写卡）。
/// 选项的 {ign}/{teamName} 占位符由 spawnCard 的 fill 代入（与 TS 两段式一致）。
/// </summary>
public static class EventPool
{
    public sealed class CardDef
    {
        public string Id = "";
        public string Title = "";
        public string Text = "";
        public bool Negative;
        public int Weight;
        public List<PendingEventOption> Options = new();
    }

    private static PendingEventOption P(string label, string result, int? morale = null, int? teamMorale = null, int? budget = null, int? reputation = null, int? fatigue = null, int? bond = null) =>
        new() { Label = label, Result = result, Morale = morale, TeamMorale = teamMorale, Budget = budget, Reputation = reputation, Fatigue = fatigue, Bond = bond };

    public static readonly CardDef[] Pool =
    {
        new()
        {
            Id = "interview-goal", Title = "赛季目标采访", Negative = false, Weight = 3,
            Text = "本地媒体采访 {ign}：“这个赛季的目标是什么？”镜头怼到了脸上。",
            Options =
            {
                P("放话争冠", "“我们的目标是冠军。”{ign} 说得斩钉截铁，更衣室里士气为之一振。", 3),
                P("低调务实", "“一场一场打。”{ign} 的回答四平八稳，没有风险，也没有火花。", 1),
            },
        },
        new()
        {
            Id = "fan-gift", Title = "粉丝来信", Negative = false, Weight = 3,
            Text = "{ign} 收到一整箱粉丝来信和手绘应援卡，堆积在训练基地门口。",
            Options =
            {
                P("公开感谢", "{ign} 在社媒晒出应援卡，粉丝社区一片欢腾。", 3),
                P("转赠队友", "应援卡贴满了训练室墙——大家训练时都更有劲了。", 2, bond: 2),
            },
        },
        new()
        {
            Id = "quarrel", Title = "训练室争吵", Negative = true, Weight = 2,
            Text = "训练赛中 {ign} 和队友为一个点位争执不下，摔了鼠标，气氛僵住。",
            Options =
            {
                P("各打五十大板", "“都少说两句。”气氛缓和了，但心结未必解开。", -1),
                P("私下疏导", "你分别找两人谈了很久，矛盾压下去了。", 1),
                P("加练共担", "罚两人搭档加练一天——不打不相识，默契反而上来了。", 0, bond: 3, fatigue: 4),
            },
        },
        new()
        {
            Id = "stream-request", Title = "直播邀约", Negative = false, Weight = 2,
            Text = "{ign} 想在休息日晚间开两小时直播，和粉丝聊聊天。",
            Options =
            {
                P("批准直播", "弹幕刷着“状态可以啊”，{ign} 心情不错——就是熬了点夜。", 3, fatigue: 4),
                P("婉拒专注训练", "{ign} 点点头关掉了推流页面，多少有点遗憾。", -1),
            },
        },
        new()
        {
            Id = "net-flame", Title = "网络风波", Negative = true, Weight = 2,
            Text = "上一场失误的集锦被剪出来反复播放，{ign} 的评论区沦陷了。",
            Options =
            {
                P("俱乐部发文力挺", "官方一声“我们信任他”，评论区风向明显好转。", 3),
                P("让时间冲淡", "不回应，不解释。{ign} 自己消化了几天，状态略有起伏。", -2),
            },
        },
        new()
        {
            Id = "muscle-tight", Title = "肌肉紧绷", Negative = true, Weight = 2,
            Text = "{ign} 训练后总觉得前臂发紧，队医建议休息观察。",
            Options =
            {
                P("强制休息三天", "三天后复查无碍，虚惊一场。", 0, fatigue: -6),
                P("贴肌效贴继续", "“小问题，能扛。”——希望真是小问题。", -1, fatigue: 3),
            },
        },
        new()
        {
            Id = "grind-late", Title = "深夜加练", Negative = false, Weight = 2,
            Text = "凌晨一点，监控里还有一个人影在训练室——是 {ign}，在一个人磨枪法。",
            Options =
            {
                P("进去陪练", "你陪他打了半小时残局。离开时他说：“稳了。”", 2, fatigue: 3),
                P("劝他休息", "“明天再练。”{ign} 收拾设备回了宿舍。", 0, fatigue: -2),
            },
        },
        new()
        {
            Id = "ad-shoot", Title = "品牌广告拍摄", Negative = false, Weight = 2,
            Text = "一家外设品牌想请 {ign} 拍一支广告，报价已经放到桌上。",
            Options =
            {
                P("接下拍摄", "拍摄占用了半天训练，但 $8K 的进账很实在。", 0, budget: 8000),
                P("婉拒聚焦训练", "经纪人说“训练期不接”。品牌方表示遗憾。", 0),
            },
        },
        new()
        {
            Id = "rival-taunt", Title = "对手挑衅", Negative = true, Weight = 2,
            Text = "对手选手在直播里公开嘲讽：“{teamName}？他们不值得研究。”",
            Options =
            {
                P("官方回击", "俱乐部账号发布训练照配文：“赛场上见。”粉丝炸了。", 2),
                P("沉默是金", "不予理会——用成绩说话。", 0),
                P("公开反击", "{ign} 的回击视频播放量爆炸，本人斗志高涨。", 4),
            },
        },
        new()
        {
            Id = "gaming-cafe", Title = "网吧签名会", Negative = false, Weight = 1,
            Text = "一家连锁网吧邀请全队出席线下签名会，与粉丝近距离互动。",
            Options =
            {
                P("全队出席", "排队两小时的粉丝让队员们受宠若惊，士气与口碑双收。", 2, reputation: 1, fatigue: 3),
                P("派队长代表", "队长带去了签名队服，效果中规中矩。", 1),
            },
        },
        new()
        {
            Id = "old-friend", Title = "故人来访", Negative = false, Weight = 1,
            Text = "{ign} 的老教练来基地探班，带来了一箱家乡特产。",
            Options =
            {
                P("共进晚餐", "一顿饭吃得其乐融融，{ign} 的状态肉眼可见地松弛了。", 3),
                P("婉言谢绝", "训练为重，探访改期。", 0),
            },
        },
        new()
        {
            Id = "device-broken", Title = "设备故障", Negative = true, Weight = 1,
            Text = "{ign} 的主力鼠标在训练中双击失灵——他坚持那是“手感的一部分”。",
            Options =
            {
                P("立即换新旗舰", "新鼠标到货，{ign} 爱不释手。", 2, budget: -1500),
                P("用备件凑合", "备件手感一般，{ign} 有点别扭。", -1),
            },
        },
        new()
        {
            Id = "content-viral", Title = "离谱名场面", Negative = false, Weight = 2,
            Text = "{ign} 在训练赛的一记离谱操作被剪成梗视频全网传播。",
            Options =
            {
                P("官方玩梗", "俱乐部账号跟进二创，播放量再翻一番。", 2),
                P("低调处理", "训练内容不该外传——删了。{ign} 有点可惜。", 0),
            },
        },
        new()
        {
            Id = "study-tactic", Title = "战术笔记", Negative = false, Weight = 2,
            Text = "{ign} 交上来一份手写的战术笔记，密密麻麻二十页。",
            Options =
            {
                P("全队传阅", "笔记印出来人手一份，大家都被这份用心感染。", 2, bond: 2),
                P("私下嘉奖", "你单独请 {ign} 吃了顿好的，笔记收进教练组档案。", 3),
            },
        },
        new()
        {
            Id = "spam-scam", Title = "可疑私信", Negative = true, Weight = 1,
            Text = "{ign} 收到“高薪试训”的私信，条款好得不太真实——像是骗局。",
            Options =
            {
                P("俱乐部辟谣提醒", "官方发布防诈骗提示，粉丝称赞处理及时。", 1),
                P("让经纪人处理", "经纪人拉黑了对方，风波止于萌芽。", 0),
            },
        },
        new()
        {
            Id = "fan-meet-issue", Title = "签名会争执", Negative = true, Weight = 1,
            Text = "签名会上有粉丝越过警戒线拉扯 {ign}，现场一度混乱。",
            Options =
            {
                P("安抚粉丝", "{ign} 主动缓和气氛，还多签了十分钟。口碑 +1。", 2),
                P("加强安保", "流程整改，安全第一。{ign} 心有余悸。", -1),
            },
        },
        new()
        {
            Id = "role-model", Title = "青训询问", Negative = false, Weight = 1,
            Text = "本地青训机构来信：孩子们想请 {ign} 录一段鼓励视频。",
            Options =
            {
                P("录视频鼓励", "视频在青训营循环播放，{ign} 的名字成了孩子们的目标。", 2, reputation: 1),
                P("婉拒", "训练日程太满，遗憾婉拒。", 0),
            },
        },
        new()
        {
            Id = "roommate", Title = "宿舍调换", Negative = false, Weight = 1,
            Text = "{ign} 提出想换宿舍——隔壁工地的施工声太吵，睡不好。",
            Options =
            {
                P("立即调换", "行政部门连夜安排，{ign} 睡了个好觉。", 2, budget: -2000),
                P("装隔音耳塞", "耳塞解决了大半问题。", 0, budget: -200),
            },
        },
        new()
        {
            Id = "nutrition", Title = "营养师建议", Negative = false, Weight = 1,
            Text = "营养师提交了针对 {ign} 的特调食谱——预算要涨一点。",
            Options =
            {
                P("批准特调", "两周后 {ign} 的体能数据肉眼可见地好转。", 1, budget: -1500, fatigue: -4),
                P("维持现状", "食堂标准餐继续。", 0),
            },
        },
        new()
        {
            Id = "tournament-vod", Title = "对手录像带", Negative = false, Weight = 2,
            Text = "匿名邮件送来一份对手最近的完整训练录像——来源不明。",
            Options =
            {
                P("收下研究", "教练组连夜拆解录像。来源问题装作没看见。", 1),
                P("原样退回", "“赢要赢得干净。”录像原封退回。", 0, reputation: 1),
            },
        },
    };
}
