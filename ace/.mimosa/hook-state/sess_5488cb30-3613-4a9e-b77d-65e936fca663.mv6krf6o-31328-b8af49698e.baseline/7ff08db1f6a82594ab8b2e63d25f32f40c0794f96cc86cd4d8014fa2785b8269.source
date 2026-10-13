/**
 * 英雄×地图适配 fit（GDD §4.3 v1.9）：
 * 由 地图几何标签 × 英雄机制标签 查表推导初始值，值域 0.70-1.30。
 * 上线后用职业出场数据校准（meta 二维化：版本只动 meta[agent]，fit 是世界常量）。
 */
import { AGENT_BY_ID } from "../data/agents.ts";
import type { MapDef } from "../types.ts";

export function computeFit(agentId: string, map: MapDef): number {
  const agent = AGENT_BY_ID.get(agentId);
  if (!agent) return 1;
  let fit = 1;
  const has = (t: string) => agent.mechTags.includes(t);

  // 侦察：开阔图增值（视野延伸），封闭图贬值
  if (has("recon")) fit += (map.openness - 0.5) * 0.5;
  // 烟幕：点位越多越有用
  if (has("smoke")) fit += map.sites === 3 ? 0.08 : 0.04;
  // 哨置：窄通道图增值，开阔图贬值
  if (has("anchor")) fit += (0.5 - map.corridor) * 0.4;
  // 机动：开阔图 + 多点位图增值（转点快）
  if (has("mobility")) fit += (map.openness - 0.5) * 0.3 + (map.sites === 3 ? 0.06 : 0);
  // 强开/区域杀伤：窄通道图增值
  if (has("entry") || has("area")) fit += (0.5 - map.corridor) * 0.15;
  // 垂直图奖励机动与侦察
  if (map.vertical > 0.6 && (has("mobility") || has("recon"))) fit += 0.05;

  return Math.min(1.3, Math.max(0.7, Math.round(fit * 100) / 100));
}
