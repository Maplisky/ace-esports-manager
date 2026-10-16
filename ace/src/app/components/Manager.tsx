/** 经理页（GDD v0.5-5 教练个人经济）：个人钱包/饱腹/心情 + 生活动作 */
import type { GameState } from "../../core/types.ts";
import { useState } from "react";
import { useStore } from "../store.ts";
import { SKILL_CN, SELF_STUDY_COST, SELF_STUDY_CAP, type ManagerSkillKey } from "../../core/sim/career.ts";
import { coachCompensation } from "../../core/sim/retirement.ts";

const fmt = (v: number) => `$${Math.round(v)}`;

export function ManagerPage(props: { state: GameState }) {
  const { state } = props;
  const managerLife = useStore((s) => s.managerLife);
  const selfStudyAction = useStore((s) => s.selfStudy);
  const upgradeFacility = useStore((s) => s.upgradeFacility);
  const [upgradeBusy, setUpgradeBusy] = useState(false);
  const [studySkill, setStudySkill] = useState<ManagerSkillKey>("tactics");
  const selfStudy = (skill: ManagerSkillKey) => selfStudyAction(skill);
  const mgr = state.manager;
  if (!mgr) return null;
  const life = mgr.life;
  const myTeam = state.myTeamId ? state.teams[state.myTeamId] : null;
  const moodColor = life.mood >= 60 ? "var(--green)" : life.mood >= 30 ? "var(--orange)" : "var(--accent)";
  const hungerColor = life.hunger >= 60 ? "var(--green)" : life.hunger >= 30 ? "var(--orange)" : "var(--accent)";

  return (
    <div>
      <div className="card">
        <h3>👔 经理档案</h3>
        <div className="row" style={{ flexWrap: "wrap", gap: 18 }}>
          <span>声望 <b>{Math.round(mgr.reputation)}</b></span>
          <span className={`tag${state.difficulty === "pro" ? " red" : state.difficulty === "hard" ? " orange" : ""}`}>
            {state.difficulty === "pro" ? "职业难度" : state.difficulty === "hard" ? "困难难度" : "普通难度"}
          </span>
          <span className="muted small">
            谈判 {mgr.skills.negotiation ?? 50} · 训练 {mgr.skills.training ?? 50} · 商务 {mgr.skills.business ?? 50}
          </span>
        </div>
      </div>

      <div className="card">
        <h3>🏋 训练设施（影响全队个人训练收益 ×0.85 + 设施/250）</h3>
        <div className="row" style={{ gap: 18, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 26, fontWeight: 900 }}>{myTeam?.facilities ?? 50}<span className="muted small" style={{ fontWeight: 400 }}> / 95 级</span></span>
          <span className="muted small">当前训练乘数 ×{(0.85 + (myTeam?.facilities ?? 50) / 250).toFixed(3)}</span>
          <button
            className="primary small"
            disabled={upgradeBusy || (myTeam?.facilities ?? 50) >= 95}
            onClick={() => { setUpgradeBusy(true); void upgradeFacility().finally(() => setUpgradeBusy(false)); }}
          >
            {(myTeam?.facilities ?? 50) >= 95 ? "已满级" : "升级设施（" + Math.round(60000 + (myTeam?.facilities ?? 50) ** 2 * 90).toLocaleString() + " 美元）"}
          </button>
          {upgradeBusy && <span className="muted small">施工中…</span>}
        </div>
        <div className="muted small" style={{ marginTop: 6 }}>升级费用随等级递增（原作公式 60000 + 等级² × 90 美元，俱乐部预算支出）。</div>
      </div>

      <div className="card">
        <h3>🍞 个人生活</h3>
        <div className="row" style={{ flexWrap: "wrap", gap: 18, marginBottom: 12 }}>
          <span>个人钱包 <b>{fmt(life.wallet)}</b></span>
          <span className="row" style={{ gap: 6 }}>
            饱腹
            <span className="bar-track"><span className="bar-fill" style={{ width: `${life.hunger}%`, background: hungerColor }} /></span>
            {Math.round(life.hunger)}
          </span>
          <span className="row" style={{ gap: 6 }}>
            心情
            <span className="bar-track"><span className="bar-fill" style={{ width: `${life.mood}%`, background: moodColor }} /></span>
            {Math.round(life.mood)}
          </span>
        </div>
        <div className="muted small" style={{ marginBottom: 10 }}>
          饱腹每天 −3、心情每天 −1；心情 &lt;30 时全队训练收益 −10%。月薪 5,833 每月自动入个人钱包。
        </div>
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          <button className="small" disabled={life.wallet < 30} onClick={() => void managerLife("meal")}>
            便饭 $30（饱腹 +35）
          </button>
          <button className="small" disabled={life.wallet < 120} onClick={() => void managerLife("feast")}>
            好好吃一顿 $120（饱腹 +60 心情 +10）
          </button>
          <button className="small" disabled={life.wallet < 300} onClick={() => void managerLife("fun")}>
            娱乐活动 $300（心情 +20）
          </button>
        </div>
        {/* 自我进修（GDD §9.5 v1.4）：个人钱包换技能成长 */}
        <div className="row" style={{ flexWrap: "wrap", gap: 8, marginTop: 10, alignItems: "center" }}>
          <span className="muted small">🎓 自我进修</span>
          <select className="small" value={studySkill} onChange={(e) => setStudySkill(e.target.value as never)}>
            {(Object.keys(SKILL_CN) as ManagerSkillKey[]).map((k) => (
              <option key={k} value={k}>{SKILL_CN[k]}（{state.manager.skills[k] ?? 50}）</option>
            ))}
          </select>
          <button className="small" disabled={life.wallet < SELF_STUDY_COST || (state.manager.skills[studySkill] ?? 50) >= SELF_STUDY_CAP} onClick={() => void selfStudy(studySkill)}>
            进修一门 $5K（+1，上限 {SELF_STUDY_CAP}）
          </button>
        </div>
      </div>

      <CoachStaffCard state={state} />
    </div>
  );
}

/** 教练组（v1.0-1 退役转教练）：三槽位 + 教练自由池签约（退役选手转型，GDD §8.3） */
function CoachStaffCard({ state }: { state: GameState }) {
  const signCoach = useStore((s) => s.signCoach);
  const fireCoachAction = useStore((s) => s.fireCoach);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const team = state.myTeamId ? state.teams[state.myTeamId] : null;
  if (!team) return null;
  const fire = async (slot: "training" | "mapTactics" | "match") => {
    setBusy(slot);
    const message = await fireCoachAction(slot);
    setBusy(null);
    setMsg(message);
  };
  const slots: { key: "training" | "mapTactics" | "match"; label: string; desc: string }[] = [
    { key: "training", label: "🏋 训练教练", desc: "个人训练收益" },
    { key: "mapTactics", label: "🗺 地图战术教练", desc: "图池熟练收益" },
    { key: "match", label: "🏁 比赛教练", desc: "比赛临场调整" },
  ];
  const pool = state.coachPool ?? [];
  const sign = async (coachId: string, slot: "training" | "mapTactics" | "match") => {
    setBusy(coachId + slot);
    const err = await signCoach(coachId, slot);
    setBusy(null);
    setMsg(err ?? "签约完成。");
  };
  return (
    <div className="card">
      <h3>🎖 教练组（退役选手转型执教 · GDD §8.3）</h3>
      <div className="row" style={{ gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        {slots.map((s) => {
          const cur = team.staff[s.key];
          return (
            <div key={s.key} style={{ flex: "1 1 200px", border: "1px solid var(--line-soft)", borderRadius: 8, padding: "8px 12px", background: "rgba(255,255,255,0.025)" }}>
              <div className="muted small">{s.label} · {s.desc}</div>
              {cur ? (
                <div style={{ marginTop: 4 }}>
                  <b>{cur.name}</b> <span className="tag green">能力 {cur.value}</span>
                  <div style={{ marginTop: 6 }}>
                    <button className="small" disabled={busy !== null} onClick={() => void fire(s.key)} title="解约后教练回到自由池（能力 -2），俱乐部声望 -1">
                      解约（声望 -1）
                    </button>
                  </div>
                </div>
              ) : (
                <div className="muted" style={{ marginTop: 4 }}>空缺</div>
              )}
            </div>
          );
        })}
      </div>
      <div className="muted small" style={{ marginBottom: 8 }}>
        教练能力 = 沟通 0.5 + 名望 0.2 + 冠军 3 + MVP 1.2（指挥 +6）。AI 俱乐部同样会从自由池签约退役名将。
      </div>
      {pool.length === 0 ? (
        <div className="muted small">教练自由池暂无人——退役名将（沟通/冠军达标者）会随赛季退役进入自由池。</div>
      ) : (
        <table>
          <thead>
            <tr><th style={{ textAlign: "left" }}>教练</th><th>潜力</th><th>背景</th><th style={{ textAlign: "left" }}>签约至</th></tr>
          </thead>
          <tbody>
            {pool.map((c) => (
              <tr key={c.id}>
                <td style={{ textAlign: "left" }}>
                  <b>{c.name}</b>{c.isIgl && <span className="tag" style={{ marginLeft: 5 }}>前指挥</span>}
                </td>
                <td><b>{c.value}</b></td>
                <td className="muted small">名望 {c.fame} · 冠军 {c.titles} · {c.retiredYear} 年退役</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {slots.map((s) => (
                    <button
                      key={s.key}
                      className="small"
                      disabled={busy !== null}
                      style={{ marginRight: 4 }}
                      onClick={() => void sign(c.id, s.key).then((err) => setMsg(err ?? `已签入${s.label.slice(2)}。`))}
                    >
                      {s.label.slice(2)}
                    </button>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {msg && <div className="muted small" style={{ marginTop: 6 }}>{msg}</div>}
      <PoachCard state={state} onMsg={setMsg} />
    </div>
  );
}

/** 挖角他队教练（v1.x 用户反馈，对齐原作两段式）：补偿金 = 身价 × 倍率；倍率越高成功率越高；失败钱照付声望-1 */
function PoachCard({ state, onMsg }: { state: GameState; onMsg: (m: string) => void }) {
  const poachCoach = useStore((s) => s.poachCoach);
  const [busy, setBusy] = useState(false);
  const [mult, setMult] = useState(1.6);
  const team = state.myTeamId ? state.teams[state.myTeamId] : null;
  if (!team) return null;
  const slots: { key: "training" | "mapTactics" | "match"; label: string }[] = [
    { key: "training", label: "训练" },
    { key: "mapTactics", label: "地图战术" },
    { key: "match", label: "比赛" },
  ];
  const targets: { team: NonNullable<ReturnType<typeof Object.values>> extends never ? never : any; slot: "training" | "mapTactics" | "match"; label: string; value: number; comp: number }[] = [];
  for (const t of Object.values(state.teams)) {
    if (t.id === team.id) continue;
    for (const s of slots) {
      const c = t.staff[s.key];
      if (c) targets.push({ team: t, slot: s.key, label: s.label, value: c.value, comp: coachCompensation(c.value) });
    }
  }
  targets.sort((a, b) => b.value - a.value);
  const chanceHint = (comp: number) => {
    const m = mult / Math.max(1, comp);
    void m;
    const repDiff = ((state.manager.reputation ?? 50) - 55) * 0.4;
    const base = 25 + (mult / Math.max(1, 1)) - 1.6 * 50;
    void base; void repDiff;
    // 展示口径与 core poachCoach 公式同源：0.25 + (mult-1.6)*0.5 + repDiff + negotiation
    const p = Math.round(Math.max(10, Math.min(92, (0.25 + (mult - 1.6) * 0.5 + ((state.manager.reputation ?? 50) - 55) * 0.004 + ((state.manager.skills.negotiation ?? 50) - 50) * 0.004) * 100)));
    void comp;
    return p;
  };

  return (
    <div style={{ marginTop: 12 }}>
      <div className="row" style={{ flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <b>🏴‍☠️ 挖角他队教练</b>
        <span className="muted small">先付补偿金（1 行动力），他也可能不来——你声望越低、对方越大牌越要溢价。</span>
        <span className="row" style={{ gap: 4 }}>
          {[1.3, 1.6, 2.2].map((m) => (
            <button key={m} className={mult === m ? "small primary" : "small"} onClick={() => setMult(m)}>×{m}</button>
          ))}
        </span>
        <span className="muted small">当前倍率下成功率约 {chanceHint(mult)}%（对每位目标相同；实际按声望差浮动）</span>
      </div>
      {targets.length === 0 ? (
        <div className="muted small">联盟里暂时没有在岗教练（各队教练组空缺中）。</div>
      ) : (
        <table>
          <thead>
            <tr><th style={{ textAlign: "left" }}>教练</th><th>现俱乐部</th><th>岗位</th><th>能力</th><th>参考补偿</th><th></th></tr>
          </thead>
          <tbody>
            {targets.slice(0, 20).map((t, i) => (
              <tr key={t.team.id + t.slot}>
                <td style={{ textAlign: "left" }}><b>{t.team.coach.name === t.team.staff[t.slot]?.name ? t.team.staff[t.slot]!.name : t.team.staff[t.slot]!.name}</b></td>
                <td className="muted small">{t.team.name}</td>
                <td className="muted small">{t.label}教练</td>
                <td><b>{t.value}</b></td>
                <td className="muted small">${(t.comp / 1000).toFixed(0)}K → 报价 ${((t.comp * mult) / 1000).toFixed(0)}K</td>
                <td>
                  <button
                    className="small"
                    disabled={busy || team.budget < t.comp * mult || state.actionPoints < 1}
                    onClick={() => {
                      setBusy(true);
                      void poachCoach(t.team.id, t.slot, Math.round(t.comp * mult)).then((m) => { onMsg(m ?? ""); setBusy(false); });
                    }}
                  >
                    挖角（1 行动力）
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
