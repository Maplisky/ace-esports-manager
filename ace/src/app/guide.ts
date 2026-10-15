/**
 * 开局引导骨架（v1.0-11，GDD §9.1 系统解锁表 / §3 First 30 Minutes 前移子集）：
 * 解锁完全由「当年天数 + 生涯赛季数」推导——零新状态、零迁移；第二赛季起全解锁。
 * 完整版（捏人天赋/引导任务清单）留 v1.2。
 */
import type { GameState } from "../core/types.ts";

export type GuidePage =
  | "overview" | "schedule" | "squad" | "tactics" | "training" | "business"
  | "transfer" | "manager" | "achievements" | "career" | "system";

/** 解锁日（当年第 N 天；GDD §9.1：D8 转会 → D12 商务 → D20 情报全开。
 *  v1.2 修订：训练页 D1 即开——GDD §3 First 30 Minutes 要求开局 10 分钟内排第一周课表，与原 D4 解锁冲突，以 §3 为准） */
export const UNLOCK_DAYS: Record<GuidePage, number> = {
  overview: 1,
  schedule: 1,
  squad: 1,
  tactics: 1,
  system: 1,
  training: 1,
  transfer: 8,
  business: 12,
  manager: 12,
  achievements: 20,
  career: 20,
};

export function pageUnlockDay(page: GuidePage): number {
  return UNLOCK_DAYS[page] ?? 1;
}

/** 解锁判定：当年达到解锁日，或已进入第二赛季（GDD：第二赛段起全解锁）；旧档天然全开 */
export function pageUnlocked(page: GuidePage, state: GameState): boolean {
  const seasons = state.manager.career?.seasons ?? 1;
  return seasons >= 2 || state.day >= pageUnlockDay(page);
}

/** 解锁提示文案（worker 在首赛季 D8/D12/D20 推进时推送——「解锁即场景任务」的骨架版） */
export const UNLOCK_NOTES: { day: number; text: string }[] = [
  { day: 8, text: "📖 转会窗口已开放（D8）：自由市场报价、问价与挂牌功能解锁。先看看替补深度。" },
  { day: 12, text: "📖 商务中心已开放（D12）：赞助谈判、商务日与直播合同可以运营了——钱和训练时间的永恒交易。" },
  { day: 20, text: "📖 情报与生涯系统全开（D20）：侦察对手图池、成就与名人堂解锁。祝执教顺利！" },
];
