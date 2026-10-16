/**
 * 退役与转教练（v1.0-1，GDD §6.5/§8.3）：
 * 赛季末退役检定（年龄≥29 概率公式）→ 劝留对话（本队五选项事件卡 / AI 自动决策）
 * → 退役分流（执教意愿检定 → 教练自由池；高名望 → 解说；否则淡出）。
 * 教练自由池可被任何俱乐部签入教练组空槽（声望=fame 折算，AI 同生态）。
 * 一切随机走显式 Rng；确定性约定不变。
 */
import { clamp, hashString, Rng } from "../rng.ts";
import type { CoachFreeAgent, GameState, PendingEventCard, Player, RetireLogItem, TransferFeedItem } from "../types.ts";
import { narrativeOnRetire } from "./narrative.ts";

/** 名望折算（GDD §8.3：MVP/冠军/实力） */
export function fameOf(p: Player): number {
  return clamp(Math.round((p.career.titles * 7 + p.career.mvps * 0.6 + (p.overall - 70) * 0.8 + (p.career.firstKills > 300 ? 6 : 0)) * 1), 5, 100);
}

/** 教练能力折算：沟通 0.5 + 名望 0.2 + 冠军 3 + MVP 1.2 + 指挥 +6 */
export function coachValueOf(p: Player): number {
  const fame = fameOf(p);
  return clamp(Math.round(p.attrs.communication * 0.5 + fame * 0.2 + p.career.titles * 3 + p.career.mvps * 1.2 + (p.isIgl ? 6 : 0)), 25, 95);
}

/** 退役检定概率（GDD §6.5）：clamp(0.08+(age−29)×0.06+下滑×0.04−冠军×0.03−(野心−50)×0.002, 0.02, 0.85) */
export function retireProb(p: Player): number {
  const ambition = p.ambition ?? 50;
  const decline = Math.max(0, p.age - 31) * 0.04;
  return clamp(0.08 + (p.age - 29) * 0.06 + decline - p.career.titles * 0.03 - (ambition - 50) * 0.002, 0.02, 0.85);
}

function feed(state: GameState, item: { kind: TransferFeedItem["kind"]; important?: boolean; text: string }): void {
  state.transferFeed.push({ day: state.day, year: state.year, kind: item.kind, text: item.text });
  if (state.transferFeed.length > 300) state.transferFeed.splice(0, state.transferFeed.length - 300);
}

function fameTierPath(fame: number, intentPass: boolean): "coach" | "media" | "fade" {
  if (intentPass) return "coach";
  return fame >= 68 ? "media" : "fade";
}

export const RETIRE_CARD_ID = "retire";

/** 执行退役：移出名单 → 意愿检定分流 → 名册补位 → 留档。ceremony=举办退役仪式（士气/声望/信任） */
function executeRetirement(
  state: GameState,
  p: Player,
  rng: Rng,
  opts: { ceremony?: boolean } = {},
  notes?: { day: number; kind: string; important?: boolean; text: string }[],
): void {
  const team = p.teamId ? state.teams[p.teamId] : null;
  const teamName = team?.name ?? null;
  if (team) {
    team.roster = team.roster.filter((id) => id !== p.id);
    team.starters = team.starters.filter((id) => id !== p.id);
    if (opts.ceremony) {
      for (const pid of team.roster) {
        const q = state.players[pid];
        if (q) q.morale = clamp(q.morale + 3, 10, 100);
      }
    }
    // 名册补位：签一名不高于队伍水平的自由人（避免 AI 永久残阵）
    if (team.id !== state.myTeamId) {
      const fas = Object.values(state.players).filter((x) => !x.teamId && !x.homegrown);
      if (fas.length) {
        const avg = team.roster.reduce((s, id) => s + (state.players[id]?.overall ?? 0), 0) / Math.max(1, team.roster.length);
        const pick = fas.filter((x) => x.overall <= avg + 5).sort((a, b) => b.overall - a.overall)[0] ?? fas.sort((a, b) => b.overall - a.overall)[0];
        if (pick) {
          pick.teamId = team.id;
          pick.promisedRole = "rotation";
          pick.salary = Math.round(clamp(pick.overall * 900, 40_000, 900_000));
          team.roster.push(pick.id);
        }
      }
    }
  }

  // 执教意愿检定（GDD §8.3）：沟通 + 冠军 + 指挥/母队加成
  const fame = fameOf(p);
  const intent = p.attrs.communication + Math.min(30, p.career.titles * 4) + (p.isIgl ? 12 : 0) + (p.homegrown && team ? 6 : 0);
  const intentPass = rng.chance(clamp(intent / 150 + 0.15, 0.2, 0.92));
  const path = fameTierPath(fame, intentPass);

  if (path === "coach") {
    state.coachPool!.push({
      id: "coach_" + p.id,
      name: p.ign,
      fame,
      comm: p.attrs.communication,
      titles: p.career.titles,
      mvps: p.career.mvps,
      isIgl: !!p.isIgl,
      homegrownClubId: p.homegrown ? team?.id ?? null : null,
      retiredYear: state.year,
      value: coachValueOf(p),
    });
  }

  const newsText = path === "coach"
    ? `📋 ${p.ign} 宣布退役并以教练身份加入教练自由池（执教潜力 ${coachValueOf(p)}）。`
    : path === "media"
      ? `🎙 ${p.ign} 宣布退役，转型解说/主播（名望 ${fame}）。`
      : `${p.ign} 宣布退役，告别赛场。`;
  feed(state, { kind: "retire", important: path === "coach" && !!team, text: newsText });
  notes?.push({ day: 1, kind: "transfer", important: path === "coach" && !!team, text: newsText });

  const entry: RetireLogItem = {
    year: state.year,
    ign: p.ign,
    name: p.ign,
    age: p.age,
    titles: p.career.titles,
    mvps: p.career.mvps,
    overall: p.overall,
    path,
    teamName,
    coachId: path === "coach" ? "coach_" + p.id : undefined,
  };
  state.retireLog!.push(entry);
  narrativeOnRetire(state, entry, (notes ?? []) as never); // 名宿告别巡演（v1.5）：我队功勋末季文案
  if (p.teamId) {
    const owner = state.teams[p.teamId];
    owner.roster = owner.roster.filter((id) => id !== p.id);
    owner.starters = owner.starters.filter((id) => id !== p.id);
  }
  delete state.players[p.id];
}

/** 赛季末退役检定（day.ts 翻年块调用）：本队出劝留对话卡，AI 自动决策；随后 AI 签教练 */
export function seasonRetirements(
  state: GameState,
  rng: Rng,
  notes: { day: number; kind: string; important?: boolean; text: string }[],
): void {
  for (const p of Object.values(state.players)) {
    if (!p.teamId || p.age < 29) continue;
    if (!rng.chance(retireProb(p))) continue;
    const team = state.teams[p.teamId];
    if (team.id === state.myTeamId) {
      // 本队：劝留对话事件卡（选手留队待决，不立即移除）
      state.pendingEvents.push({
        uid: `retire_${p.id}_${state.year}`,
        cardId: RETIRE_CARD_ID,
        title: `退役劝留 · ${p.ign}`,
        text: `${p.ign}（${p.age} 岁，${p.career.titles} 冠 / ${p.career.mvps} MVP）宣布考虑退役。管理层需要给出态度——沟通技巧将决定这位${p.isIgl ? "指挥" : "老将"}的去留。`,
        negative: false,
        targetPlayerId: p.id,
        day: state.day,
        options: [
          { label: `加薪 30% 留队（$${Math.round(p.salary * 0.3 / 1000)}K/季）`, result: "" },
          { label: "转导师型替补", result: "" },
          { label: "放上挂牌名单", result: "" },
          { label: "举办退役仪式", result: "" },
          { label: "深夜长谈", result: "" },
        ],
      });
      continue;
    }
    // AI 队：预算充裕时 40% 概率加薪续约，否则退役 + 自动补位
    if (team.budget > p.salary * 4 && rng.chance(0.4)) {
      team.budget -= p.salary * 0.3;
      p.salary = Math.round(p.salary * 1.3);
      notes.push({ day: 1, kind: "transfer", text: `📝 ${team.name} 加薪续约留住 ${p.ign}（${p.age} 岁）。` });
      continue;
    }
    executeRetirement(state, p, rng, {}, notes);
  }

  // AI 教练签约：空槽位按概率从自由池签入（同生态）
  for (const t of Object.values(state.teams)) {
    if (t.id === state.myTeamId) continue;
    for (const slot of ["training", "mapTactics", "match"] as const) {
      if (t.staff[slot]) continue;
      if (!state.coachPool!.length) break;
      if (!rng.chance(0.22)) continue;
      const best = [...state.coachPool!].sort((a, b) => b.value - a.value)[0]!;
      t.staff[slot] = { name: best.name, value: best.value };
      state.coachPool = state.coachPool!.filter((c) => c.id !== best.id);
      notes.push({ day: 1, kind: "transfer", text: `🎙 ${t.name} 邀请退役名将 ${best.name} 出任${slot === "training" ? "训练" : slot === "mapTactics" ? "地图战术" : "比赛"}教练（能力 ${best.value}）。` });
    }
  }
}

/** 劝留对话结算（events.resolveEvent 按 cardId=retire 截断路由到这里） */
export function resolveRetireCard(
  state: GameState,
  card: PendingEventCard,
  optionIndex: number,
  rng: Rng,
): { result: string; note: string } {
  const p = card.targetPlayerId ? state.players[card.targetPlayerId] : null;
  if (!p || !p.teamId) return { result: "该选手已离队，劝留无效。", note: "" };
  const myTeam = state.teams[state.myTeamId!];
  const mgr = state.manager?.skills ?? {};
  const note = (s: string) => `${p.ign}：${s}`;
  const successText = (what: string) => ({ result: `${p.ign} 接受${what}，留队！`, note: note(`${what}成功`) });
  // 挽留失败 → 退役：收集告别巡演等叙事新闻并入卡片 note（此前传 {} 会把 v1.5 告别文案静默丢弃）
  const retireNow = (resultTail: string, noteKey: string) => {
    const extra: string[] = [];
    executeRetirement(state, p, rng, {}, extra as never);
    return { result: `${p.ign} ${resultTail}`, note: [note(noteKey), ...extra].join(" ") };
  };

  switch (optionIndex) {
    case 0: { // 加薪 30%
      const chance = clamp(0.3 + (mgr.negotiation ?? 50) / 250 + (mgr.locker ?? 50) / 250, 0.15, 0.9);
      if (rng.chance(chance)) {
        myTeam.budget = Math.max(0, myTeam.budget - p.salary * 0.3);
        p.salary = Math.round(p.salary * 1.3);
        p.morale = clamp(p.morale + 6, 10, 100);
        return { ...successText("加薪续约"), result: successText("加薪续约").result + "（薪水上浮 30%。）" };
      }
      return retireNow("他婉拒了加薪：「钱不是全部。」还是挂靴了。", "加薪挽留失败");
    }
    case 1: { // 转导师型替补
      const chance = clamp(0.55 + (p.traits?.includes("enabler") ? 0.12 : 0), 0.3, 0.85);
      if (rng.chance(chance)) {
        p.promisedRole = "bench";
        p.track = "mentor";
        p.mentorSince = state.year;
        p.morale = clamp(p.morale + 4, 10, 100);
        return successText("转任导师型替补");
      }
      return retireNow("他摇头：「我还想打主力。」谈判破裂，就此挂靴。", "导师转型失败");
    }
    case 2: // 挂牌
      p.listed = true;
      p.listedWeeks = 0;
      p.morale = clamp(p.morale - 3, 10, 100);
      return { result: `${p.ign} 被放上挂牌名单，暂缓退役。`, note: note("挂牌") };
    case 3: { // 退役仪式
      myTeam.budget = Math.max(0, myTeam.budget - 80_000);
      state.boardConfidence = clamp(state.boardConfidence + 2, 0, 100);
      if (state.myTeamId) {
        for (const pid of myTeam.roster) {
          const q = state.players[pid];
          if (q) q.morale = clamp(q.morale + 3, 10, 100);
        }
      }
      executeRetirement(state, p, rng, { ceremony: true });
      return { result: `${p.ign} 的退役仪式星光熠熠——全队与观众起立致敬。声誉与凝聚力 +。`, note: note("退役仪式") };
    }
    default: { // 深夜长谈
      const chance = clamp(0.4 + p.attrs.communication / 300, 0.25, 0.8);
      if (rng.chance(chance)) {
        p.morale = clamp(p.morale + 8, 10, 100);
        return successText("深夜长谈");
      }
      return retireNow("去意已决（长谈到凌晨也没有结果）。", "深谈失败");
    }
  }
}

/** 签约教练自由池选手到教练组槽位（替换允许） */
export function signCoach(state: GameState, coachId: string, slot: "training" | "mapTactics" | "match"): string | null {
  const team = state.myTeamId ? state.teams[state.myTeamId] : null;
  if (!team) return "无俱乐部";
  const idx = state.coachPool!.findIndex((c) => c.id === coachId);
  if (idx < 0) return "该教练已被签走";
  const c = state.coachPool![idx]!;
  // 顶替：原槽位教练回流自由池（v1.x：支持换人与解雇的闭环）
  const cur = team.staff[slot];
  if (cur?.coachId) {
    const origin = state.coachPool!.find((x) => x.id === cur.coachId);
    if (origin) origin.value = cur.value; // 在岗期间能力可能成长，回池同步
    else state.coachPool!.push({ id: cur.coachId, name: cur.name, fame: 50, comm: cur.value, titles: 0, mvps: 0, isIgl: false, homegrownClubId: team.id, retiredYear: state.year, value: cur.value });
  }
  team.staff[slot] = { name: c.name, value: c.value, coachId: c.id };
  state.coachPool!.splice(idx, 1);
  return null;
}

/** 解雇教练（v1.x 用户反馈）：回自由池 + 声望 -1（业内口碑）；本人上限回落 2（离岗生疏）。零 RNG。 */
export function fireCoach(state: GameState, slot: "training" | "mapTactics" | "match"): string {
  const team = state.myTeamId ? state.teams[state.myTeamId] : null;
  if (!team) return "无俱乐部";
  const cur = team.staff[slot];
  if (!cur) return "该位置本来就空缺。";
  const origin = cur.coachId ? state.coachPool!.find((x) => x.id === cur.coachId) : null;
  if (origin) {
    origin.value = Math.max(40, cur.value - 2);
  } else {
    state.coachPool!.push({ id: cur.coachId ?? "coach_fired_" + slot + "_" + state.day, name: cur.name, fame: 50, comm: cur.value, titles: 0, mvps: 0, isIgl: false, homegrownClubId: team.id, retiredYear: state.year, value: Math.max(40, cur.value - 2) });
  }
  team.staff[slot] = undefined;
  state.manager.reputation = clamp((state.manager.reputation ?? 50) - 1, 20, 99);
  return `${cur.name} 已解约（声望 -1）。他回到了教练自由池。`;
}
