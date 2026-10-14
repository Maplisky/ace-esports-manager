/**
 * 选手特质（v0.8，原作 traits 移植+扩展，GDD 外用户需求完善）：
 * 生成 0-3 条；good 特质给引擎微加成、bad 为缺陷。纯数据+推导，引擎在 match.ts 消费。
 * 特质键与 mechTags/职责联动：突破手↔entry、残局王↔clutch 等。
 */
export interface TraitDef {
  key: string;
  label: string;
  good: boolean;
  desc: string;
}

export const TRAITS: readonly TraitDef[] = [
  { key: "entry", label: "突破手", good: true, desc: "首杀争夺意愿与成功率更高" },
  { key: "carry", label: "核心火力", good: true, desc: "回合击杀产出更高" },
  { key: "anchor", label: "定海神针", good: true, desc: "守下回合更稳" },
  { key: "headshot", label: "爆头机器", good: true, desc: "击杀分配更集中" },
  { key: "survivor", label: "生存大师", good: true, desc: "更难被击杀" },
  { key: "consistent", label: "稳定输出", good: true, desc: "回合发挥波动更小" },
  { key: "enabler", label: "串联核心", good: true, desc: "助攻与道具贡献更高" },
  { key: "clutch", label: "残局王", good: true, desc: "1vX 残局胜率显著提升" },
  { key: "glass", label: "玻璃大炮", good: false, desc: "高产出但容易送" },
  { key: "baiter", label: "苟", good: false, desc: "躲队友身后，首杀贡献低" },
];

export const TRAIT_BY_KEY: ReadonlyMap<string, TraitDef> = new Map(TRAITS.map((t) => [t.key, t]));
