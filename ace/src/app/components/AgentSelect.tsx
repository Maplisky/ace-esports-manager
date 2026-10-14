/**
 * 按场上位置分组的英雄选择器（参照原作）：
 * - 四个职责 optgroup 显式区分（决斗者/先锋/控场/哨卫），组内按熟练度 → vlr 选用次数降序
 * - training 模式：满熟练（100）隐藏；熟练相同按总选用次数
 * - vlr 数据只用于内部排序/初始熟练计算，不展示 ACS/生涯图数
 */
import type { Player } from "../../core/types.ts";
import { AGENTS, AGENT_BY_ID } from "../../core/data/agents.ts";
import type { AgentDef } from "../../core/types.ts";
import { REAL_PLAYERS_BY_VLR } from "../../core/data/real/real-data.ts";

export const DUTY_ORDER: { key: string; label: string }[] = [
  { key: "duelist", label: "决斗者" },
  { key: "initiator", label: "先锋" },
  { key: "controller", label: "控场" },
  { key: "sentinel", label: "哨卫" },
];

function primaryDutyOf(a: AgentDef): string {
  let best = "duelist";
  let bestV = -1;
  for (const [k, v] of Object.entries(a.duty)) {
    if ((v as number) > bestV) { bestV = v as number; best = k; }
  }
  return best;
}

/** 选手的 vlr 生涯选用次数（虚拟选手 0） */
function useCountOf(p: Player, agentId: string): number {
  if (!p.id.startsWith("R")) return 0;
  return REAL_PLAYERS_BY_VLR.get(Number(p.id.slice(1)))?.stats.find((s) => s.agent === agentId)?.maps ?? 0;
}

export interface AgentGroup {
  key: string;
  label: string;
  agents: { id: string; pro: number; maps: number }[];
}

/**
 * 构建按位置分组的英雄列表。
 * - pool 内英雄（可含熟练 0）
 * - training 模式：并入池外英雄（34 起步），隐藏满熟练（100）
 * - 组内排序：熟练 desc → 选用次数 desc → 名字
 */
export function buildAgentGroups(p: Player, mode: "select" | "training"): AgentGroup[] {
  const pro = (id: string) => p.agentPro[id] ?? 0;
  const candidates = mode === "training"
    ? AGENTS.filter((a) => (p.agentPro[a.id] ?? 0) < 100) // 满熟练不再练
    : AGENTS.filter((a) => p.agentPool.includes(a.id));
  return DUTY_ORDER.map(({ key, label }) => ({
    key,
    label,
    agents: candidates
      .filter((a) => primaryDutyOf(a) === key)
      .map((a) => ({ id: a.id, pro: pro(a.id), maps: useCountOf(p, a.id) }))
      .sort((x, y) => y.pro - x.pro || y.maps - x.maps || x.id.localeCompare(y.id)),
  })).filter((g) => g.agents.length > 0);
}

/** 统一英雄下拉（带位置 optgroup；空池回落全英雄） */
export function AgentSelect(props: {
  player: Player;
  value: string;
  mode?: "select" | "training";
  onChange: (agentId: string) => void;
  disabled?: boolean;
}) {
  const { player: p, value, mode = "select", onChange, disabled } = props;
  const groups = buildAgentGroups(p, mode);
  return (
    <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {mode === "training" && <option value="">（不练）</option>}
      {groups.length === 0 && <option value={value}>{AGENT_BY_ID.get(value)?.name ?? value}</option>}
      {groups.map((g) => (
        <optgroup key={g.key} label={g.label}>
          {g.agents.map((a) => (
            <option key={a.id} value={a.id}>
              {AGENT_BY_ID.get(a.id)?.name ?? a.id}（{Math.round(a.pro * 10) / 10}%）
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}


/** 位置倾向（主职业+副职业，参照原作）：英雄池按熟练度加权的职责向量取前二；副职业份额 ≥ 主 40% 才显示 */
export function dutyTendencyOf(p: Player): { main: string; mainKey: string; second: string | null; secondKey: string | null } {
  const sum = { duelist: 0, initiator: 0, controller: 0, sentinel: 0 };
  let w = 0;
  for (const agentId of p.agentPool) {
    const a = AGENT_BY_ID.get(agentId);
    if (!a) continue;
    const pro = p.agentPro[agentId] ?? 0;
    for (const k of ["duelist", "initiator", "controller", "sentinel"] as const) sum[k] += a.duty[k] * pro;
    w += pro;
  }
  if (w <= 0) return { main: "—", mainKey: "", second: null, secondKey: null };
  const ranked = (Object.keys(sum) as (keyof typeof sum)[]).sort((x, y) => sum[y] / w - sum[x] / w);
  const main = ranked[0]!;
  const second = ranked[1]!;
  const label = (k: string) => DUTY_ORDER.find((d) => d.key === k)?.label ?? k;
  return {
    main: label(main),
    mainKey: main,
    second: sum[second] / w >= (sum[main] / w) * 0.4 ? label(second) : null,
    secondKey: sum[second] / w >= (sum[main] / w) * 0.4 ? second : null,
  };
}

/** 岗位色（Valorant 角色色系）：决斗红 / 先锋橙 / 控场紫 / 哨卫绿 */
export const DUTY_COLORS: Record<string, string> = {
  duelist: "#e5484d",
  initiator: "#f5a524",
  controller: "#b687f8",
  sentinel: "#3dd68c",
};

/** 位置倾向芯片（原作式）：主位置=同色软底实芯片，副位置=同色描边弱化芯片 */
export function DutyTendency({ p, size = "normal" }: { p: Player; size?: "normal" | "small" }) {
  const t = dutyTendencyOf(p);
  const chip = (label: string, key: string | null, primary: boolean) => {
    const color = key ? DUTY_COLORS[key] ?? "#9aa3af" : "#9aa3af";
    const pad = size === "small" ? "0.5px 5px" : "1px 6px";
    return primary ? (
      <span style={{ background: color + "26", border: `1px solid ${color}66`, color, borderRadius: 4, padding: pad, fontSize: size === "small" ? 10 : 11, fontWeight: 600, whiteSpace: "nowrap" }}>{label}</span>
    ) : (
      <span style={{ border: `1px dashed ${color}55`, color: color + "cc", borderRadius: 4, padding: pad, fontSize: size === "small" ? 9.5 : 10.5, whiteSpace: "nowrap" }}>{label}</span>
    );
  };
  return (
    <span style={{ display: "inline-flex", gap: 4, alignItems: "center", whiteSpace: "nowrap" }}>
      {chip(t.main, t.mainKey, true)}
      {t.second && t.secondKey ? chip(t.second, t.secondKey, false) : null}
    </span>
  );
}
