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
import { AgentIcon } from "./Avatar.tsx";

export const DUTY_ORDER: { key: string; label: string }[] = [
  { key: "duelist", label: "决斗者" },
  { key: "initiator", label: "先锋" },
  { key: "controller", label: "控场" },
  { key: "sentinel", label: "哨卫" },
];

export function primaryDutyOf(a: AgentDef): string {
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

/** 行内英雄头像+名（Dossier/PreMatch 复用） */
export function AgentChip({ agentId, size = 30 }: { agentId: string; size?: number }) {
  const a = AGENT_BY_ID.get(agentId);
  return (
    <span className="row" style={{ gap: 6, alignItems: "center" }}>
      <AgentIcon agentId={agentId} size={size} name={a?.name} />
      <span className="small">{a?.name ?? agentId}</span>
    </span>
  );
}
