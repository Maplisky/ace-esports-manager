/**
 * 战术喊话效果表（v1.0-8，GDD §5.4 情境化暂停战术菜单 + IGL 场上阅读）：
 * 玩家/AI 共用一套 3 回合强度修正；AI 的 rush/steady 数值与 v1.0-7 前完全一致（回放红线）。
 * 玩家喊话不消耗 RNG——干预只是重模拟的显式输入，不操作即逐位一致（§13 验收）。
 */

export interface TacticCallDef {
  /** 喊话 id；带点位的以 :A/:B/:C 结尾 */
  id: string;
  /** 生效侧：喊话时我方处于进攻/防守 */
  side: "atk" | "def";
  label: string;
  /** 本方进攻回合的强度修正（持续喊话回合） */
  atkMod: number;
  /** 本方防守回合的强度修正 */
  defMod: number;
  /** 需要 ≥2 个「核心」档大招就绪（大招速攻） */
  needsCoreUlts?: boolean;
  /** 需要长枪局（大招速攻不在 eco/强起出现） */
  needsFullBuy?: boolean;
  /** 克制 rush 系开局战术：对面 rush 时防守额外 +1.2（双哨位蹲通道） */
  counterRush?: boolean;
  /** 需要玩家选点位（菜单展开 A/B） */
  pickSite?: boolean;
  desc: string;
}

/** AI 自动暂停沿用既有数值（rush/steady）——不进玩家菜单 */
const AI_CALLS: Record<string, Pick<TacticCallDef, "atkMod" | "defMod">> = {
  rush: { atkMod: 2.4, defMod: -1.6 },
  steady: { atkMod: -1.2, defMod: 2.0 },
};

/** 玩家情境菜单（GDD §5.4）：防守 4 项 + 进攻 4 项，按攻防方/经济/大招状态过滤展示 */
export const PLAYER_CALLS: TacticCallDef[] = [
  {
    id: "def:stackPush",
    side: "def",
    label: "抱团前压",
    atkMod: -1.6,
    defMod: 2.6,
    pickSite: true,
    desc: "多点抱团抢开局，堆防拿首波交火；被慢攻拉扯时吃亏",
  },
  {
    id: "def:rotate131",
    side: "def",
    label: "131 快速回防",
    atkMod: -0.4,
    defMod: 1.4,
    desc: "一前压三机动一锚点，转点支援快；对单一强攻压制力一般",
  },
  {
    id: "def:giveSite",
    side: "def",
    label: "放点打回防",
    atkMod: -1.0,
    defMod: 1.6,
    pickSite: true,
    desc: "让出点位做回防包夹，赌对手下包节奏；被速通时风险大",
  },
  {
    id: "def:sentinelTunnel",
    side: "def",
    label: "双哨位蹲通道",
    atkMod: -0.2,
    defMod: 1.2,
    counterRush: true,
    desc: "双哨位锁死侧翼通道，专治 rush；对慢速默认收益有限",
  },
  {
    id: "atk:rush",
    side: "atk",
    label: "集火 Rush",
    atkMod: 2.6,
    defMod: -1.8,
    pickSite: true,
    desc: "五人集火强吃一个点位；被前压/蹲点克制时损失惨重",
  },
  {
    id: "atk:fakeRotate",
    side: "atk",
    label: "假打转点",
    atkMod: 1.4,
    defMod: -0.6,
    desc: "佯攻拉防再转点，专破堆防；对面快速回防时打不出差",
  },
  {
    id: "atk:slowDefault",
    side: "atk",
    label: "慢速默认+中局变奏",
    atkMod: 0.9,
    defMod: 0.9,
    desc: "地图控制中局发力，攻防两益；上限低于激进选项",
  },
  {
    id: "atk:ultRush",
    side: "atk",
    label: "大招速攻",
    atkMod: 3.2,
    defMod: -1.2,
    needsCoreUlts: true,
    needsFullBuy: true,
    pickSite: true,
    desc: "≥2 个核心档大招开路一波强攻，强度脉冲最高；大招窗口仅此一波",
  },
];

/** id（含点位后缀）→ 定义；AI 的 rush/steady 也能查到数值（引擎泛化喊话结构用） */
export function callDefOf(id: string): TacticCallDef | null {
  if (AI_CALLS[id]) {
    return { id, side: "atk", label: id, atkMod: AI_CALLS[id]!.atkMod, defMod: AI_CALLS[id]!.defMod, desc: "" };
  }
  const base = id.replace(/:[ABC]$/, "");
  return PLAYER_CALLS.find((c) => c.id === base) ?? null;
}

/** 喊话是否可作用于该侧（atk: 前缀只在我方进攻回合生效，反之亦然） */
export function callSideOf(id: string): "atk" | "def" {
  return id.startsWith("atk:") ? "atk" : "def";
}

export function callLabel(id: string): string {
  const base = id.replace(/:[ABC]$/, "");
  const def = PLAYER_CALLS.find((c) => c.id === base);
  if (!def) return id.split(":")[1] ?? id;
  const site = id.slice(-2);
  return def.pickSite && /^:[ABC]$/.test(site) ? `${def.label} ${site[1]} 点` : def.label;
}

export function callDesc(id: string): string {
  const base = id.replace(/:[ABC]$/, "");
  return PLAYER_CALLS.find((c) => c.id === base)?.desc ?? "";
}
