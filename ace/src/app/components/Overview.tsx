import type { GameState } from "../../core/types.ts";
import { AGENT_BY_ID } from "../../core/data/agents.ts";
import { MAPS } from "../../core/data/maps.ts";
import { stageName } from "../App.tsx";
import { PlayerFace, TeamLogo } from "./Avatar.tsx";
import { intelOf, estimateMapStrength, starsOf } from "../../core/sim/intel.ts";

export function TopBar(props: {
  teamTag: string; teamName: string; year: number; day: number; stage: string;
  teamLogo?: string; regionLabel?: string; regionLogo?: string;
  budget: number; ap: number; confidence: number; nextLabel: string;
}) {
  const date = formatDate(props.year, props.day);
  return (
    <div className="topbar">
      <span className="logo">ACE</span>
      <div className="stat">
        <span className="k">俱乐部</span>
        <span className="v" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          {props.teamLogo && <img src={props.teamLogo} alt="" width={18} height={18} style={{ borderRadius: 3, objectFit: "contain" }} />}
          {props.teamName} <span className="tag">{props.teamTag}</span>
          {props.regionLogo && <span title={props.regionLabel} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><img src={props.regionLogo} alt={props.regionLabel} width={16} height={16} style={{ borderRadius: 3 }} /><span className="muted small">{props.regionLabel}</span></span>}
        </span>
      </div>
      <div className="stat">
        <span className="k">日期</span>
        <span className="v">{date}</span>
      </div>
      <div className="stat">
        <span className="k">阶段</span>
        <span className="v">{props.stage}</span>
      </div>
      <div className="stat">
        <span className="k">资金</span>
        <span className="v">${fmtK(props.budget)}</span>
      </div>
      <div className="stat">
        <span className="k">行动力</span>
        <span className="v">{props.ap}/3</span>
      </div>
      <div className="stat">
        <span className="k">董事会信任</span>
        <span className="v">{props.confidence}%</span>
      </div>
      <div className="grow" />
      <div className="stat" style={{ textAlign: "right" }}>
        <span className="k">赛程</span>
        <span className="v">{props.nextLabel}</span>
      </div>
    </div>
  );
}

export function OverviewPage(props: {
  state: GameState;
  busy: boolean;
  onAdvance: () => void;
  onAdvanceToMatch: () => void;
  onScout: (teamId: string) => void;
}) {
  const { state } = props;
  const myId = state.myTeamId ?? "";
  const myTeam = state.teams[myId];
  const advice = advisor(state);

  const nextFixture = state.fixtures.find(
    (f) => !f.played && f.teamA !== "" && f.teamB !== "" && (f.teamA === myId || f.teamB === myId),
  );
  const recentNews = state.news.slice(-14).reverse();
  const nextOppId = nextFixture ? (nextFixture.teamA === myId ? nextFixture.teamB : nextFixture.teamA) : null;
  const intel = nextOppId ? intelOf(state, nextOppId) : 0;
  const intelLv = intel >= 6 ? 3 : intel >= 3 ? 2 : intel >= 1 ? 1 : 0;

  return (
    <div>
      {/* 助教建议（GDD §9.1 收件箱 v1） */}
      <div className="card">
        <h3>📋 收件箱</h3>
        {advice.length === 0 && <div className="muted small">一切正常，按计划推进。</div>}
        {advice.map((a, i) => (
          <div key={i} className="news-item">
            ▸ {a}
          </div>
        ))}
      </div>

      <div className="card">
        <h3>⏱ 推进</h3>
        <div className="row">
          <button className="primary" disabled={props.busy} onClick={props.onAdvance}>
            推进一天 ▶
          </button>
          <button disabled={props.busy} onClick={props.onAdvanceToMatch}>
            直接推进到下一场比赛 ⏭
          </button>
          <span className="muted small">
            {nextFixture
              ? `下一场：${fixtureLabel(state, nextFixture)}`
              : "赛季已收官"}
          </span>
        </div>
        {props.busy && <div className="muted small" style={{ marginTop: 8 }}>世界演算中…</div>}
      </div>

      {/* 侦察对手（GDD §7.2 情报系统） */}
      {nextOppId && (
        <div className="card">
          <h3>🔍 情报 · {state.teams[nextOppId]?.name}
            <span className={`tag${intelLv >= 2 ? " green" : intelLv === 1 ? " orange" : ""}`} style={{ marginLeft: 10 }}>
              情报 {intel}/10
            </span>
          </h3>
          {intelLv === 0 ? (
            <div className="muted small">尚未侦察：看不到对手的图池倾向与强度评估。</div>
          ) : (
            <div className="row small" style={{ flexWrap: "wrap", gap: 12 }}>
              {MAPS.map((m) => {
                const oppTeam = state.teams[nextOppId]!;
                const stars = starsOf(estimateMapStrength(state, oppTeam, m));
                return (
                  <span key={m.id}>
                    {m.name} <span className={stars === 3 ? "tag red" : stars === 2 ? "tag orange" : "tag green"}>{"★".repeat(stars)}</span>
                  </span>
                );
              })}
            </div>
          )}
          <div className="row" style={{ marginTop: 8 }}>
            <button className="small" disabled={props.busy || state.actionPoints < 1} onClick={() => props.onScout(nextOppId)}>
              🔍 侦察对手（1 行动力，情报 +2）
            </button>
            <span className="muted small">情报带来针对性准备加成（最高 +2.2 强度），长期不侦察会过时。</span>
          </div>
        </div>
      )}

      {myTeam && (
        <div className="card">
          <h3>🏟 {myTeam.name} · 首发五人</h3>
          <table>
            <thead>
              <tr><th>选手</th><th>位置</th><th>能力</th><th>状态</th><th>士气</th><th>体能</th></tr>
            </thead>
            <tbody>
              {myTeam.starters.map((pid) => {
                const p = state.players[pid]!;
                return (
                  <tr key={pid}>
                    <td><span className="row" style={{ alignItems: "center", gap: 6 }}><PlayerFace p={p} size={24} showTag={false} />{p.ign}{p.isIgl && <span className="tag" style={{ marginLeft: 6 }}>指挥</span>}</span></td>
                    <td className="muted">{dutyName(pid, state)}</td>
                    <td>{p.overall}</td>
                    <td>{Math.round(p.form)}</td>
                    <td>{Math.round(p.morale)}</td>
                    <td>{Math.round(p.fatigue)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {Object.values(state.comps)
        .filter((c) => {
          if (Object.keys(c.standings).length === 0) return false;
          if (c.key === "masters") return true;
          // 休整期（夏季窗口/Masters）看 Stage1 收官表；Stage2/休赛期看 Stage2；季前看即将开打的 Stage1
          const activeStage = state.stage === "stage2" || state.stage === "offseason" ? "stage2" : "stage1";
          if (c.stage !== activeStage) return false; // 当前/即将阶段的表（16 张表洪水治理）
          const myRegion = myTeam?.regionId;
          if (c.key.includes(`-${myRegion}-`)) return true; // 我的赛区全量
          return !c.key.endsWith("t2"); // 其它赛区只看 VCT 榜
        })
        .sort((a, b) => a.key.localeCompare(b.key))
        .map((comp) => {
        const table = Object.values(comp.standings).sort(
          (a, b) => b.pts - a.pts || (b.mapW - b.mapL) - (a.mapW - a.mapL) || (b.roundW - b.roundL) - (a.roundW - a.roundL),
        );
        return (
          <div className="card" key={comp.key}>
            <h3>📊 {comp.name} · 积分榜</h3>
            <table>
              <thead>
                <tr><th>#</th><th>战队</th><th>赛</th><th>胜</th><th>负</th><th>积分</th><th>图分</th></tr>
              </thead>
              <tbody>
                {table.map((e, i) => (
                  <tr key={e.teamId} className={e.teamId === myId ? "me" : ""}>
                    <td>{i + 1}</td>
                    <td><span className="row" style={{ alignItems: "center", gap: 6 }}>{state.teams[e.teamId] && <TeamLogo team={state.teams[e.teamId]} size={18} />}{state.teams[e.teamId]?.name}</span></td>
                    <td>{e.w + e.l}</td>
                    <td>{e.w}</td>
                    <td>{e.l}</td>
                    <td><b>{e.pts}</b></td>
                    <td className="muted">{e.mapW}-{e.mapL}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}

      <div className="card">
        <h3>📰 新闻</h3>
        {recentNews.length === 0 && <div className="muted small">还没有新闻。推进时间看看世界发生了什么。</div>}
        {recentNews.map((n, i) => (
          <div key={i} className={`news-item${n.important ? " important" : ""}`}>
            <span className="muted small">[{formatDate(state.year, n.day)}] </span>
            {n.text}
          </div>
        ))}
      </div>
    </div>
  );
}

/** 助教建议 Top3（GDD §9.1：规则透明，每条可解释） */
function advisor(state: GameState): string[] {
  const myId = state.myTeamId ?? "";
  const team = state.teams[myId];
  if (!team) return [];
  const out: string[] = [];
  const day = state.day;
  for (const pid of team.starters) {
    const p = state.players[pid]!;
    if (p.injuredUntilDay > day) {
      out.push(`⚕️ ${p.ign} 伤病中（预计第 ${p.injuredUntilDay} 天复出），请从替补席补位。`);
    } else if (p.fatigue > 70) {
      out.push(`😮‍💨 ${p.ign} 疲劳 ${Math.round(p.fatigue)}，伤病风险翻倍——考虑轮换或安排休息日。`);
    }
  }
  const nextFixture = state.fixtures.find(
    (f) => !f.played && f.teamA !== "" && f.teamB !== "" && (f.teamA === myId || f.teamB === myId),
  );
  if (nextFixture && nextFixture.day - day <= 2 && state.teamSchedule.every((s) => s === "rest")) {
    out.push("⚠️ 本周全是休息日，比赛临近建议安排训练。");
  }
  return out.slice(0, 3);
}

export function fixtureLabel(state: GameState, f: { teamA: string; teamB: string; label: string; day: number; played: boolean }): string {
  const a = state.teams[f.teamA]?.tag ?? "?";
  const b = state.teams[f.teamB]?.tag ?? "?";
  const score = f.played ? "" : `（D${f.day}）`;
  return `${f.label}｜${a} vs ${b}${score}`;
}

export function formatDate(year: number, day: number): string {
  const d = new Date(Date.UTC(year, 0, 1));
  d.setUTCDate(d.getUTCDate() + day - 1); // 第 1 天 = 1 月 1 日；闰年由 Date 自然处理
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

export function fmtK(v: number): string {
  if (Math.abs(v) >= 1_000_000) return (v / 1_000_000).toFixed(2) + "M";
  return Math.round(v / 1000) + "K";
}

const DUTY_CN: Record<string, string> = { duelist: "决斗者", initiator: "先锋", controller: "控场", sentinel: "哨卫" };

function dutyName(playerId: string, state: GameState): string {
  const p = state.players[playerId];
  if (!p) return "—";
  const sum = { duelist: 0, initiator: 0, controller: 0, sentinel: 0 };
  let w = 0;
  for (const agentId of p.agentPool) {
    const a = AGENT_BY_ID.get(agentId);
    if (!a) continue;
    const pro = p.agentPro[agentId] ?? 0;
    for (const k of ["duelist", "initiator", "controller", "sentinel"] as const) sum[k] += a.duty[k] * pro;
    w += pro;
  }
  if (w <= 0) return "—";
  let best = "duelist";
  let bestV = -1;
  for (const k of ["initiator", "controller", "sentinel", "duelist"] as const) {
    if (sum[k] / w > bestV) {
      bestV = sum[k] / w;
      best = k;
    }
  }
  return DUTY_CN[best] ?? "—";
}
