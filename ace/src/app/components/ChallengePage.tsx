/**
 * 种子挑战赛页（GDD §11.5 v1.x，发布后运营活动）：静态 JSON 挑战包 → 锁 seed/约束开档 →
 * 本地确定性跑 → challengeReport 成绩摘要（回放链接在分享面板生成后一并提交）。
 */
import { useEffect, useState } from "react";
import type { GameState } from "../../core/types.ts";
import { loadChallengePack, validateChallengeStart, challengeScore, challengeReport, type Challenge } from "../../core/sim/challenge.ts";

const PACK_URLS = ["challenges/c-2026-01.json"];

export function ChallengePage(props: { state: GameState }) {
  const { state } = props;
  const [packs, setPacks] = useState<Challenge[]>([]);
  const [busy, setBusy] = useState(false);
  const my = state.myTeamId ? state.teams[state.myTeamId] : null;

  useEffect(() => {
    void (async () => {
      const loaded: Challenge[] = [];
      for (const url of PACK_URLS) {
        try {
          const res = await fetch(url);
          const c = loadChallengePack(await res.json());
          if (c) loaded.push(c);
        } catch { /* 静态包缺失（本地 dev 未拷贝）时忽略 */ }
      }
      setPacks(loaded);
    })();
  }, []);

  const startChallenge = (ch: Challenge) => {
    // 挑战开档：seed/出身/难度经 localStorage 带到开档界面锁定；队伍由用户选（档位/年龄约束由队卡 ✓/✗ 标记与开局校验兜底）
    setBusy(true);
    try {
      localStorage.setItem("ace-challenge", JSON.stringify({ id: ch.id, seed: ch.seed, origin: ch.constraints.origin, difficulty: ch.constraints.difficulty, tier: ch.constraints.tier, maxAge: ch.constraints.maxAge, name: ch.name }));
    } catch { /* 隐私模式无暂存则退化为普通开档 */ }
    location.href = location.pathname + "#challenge=" + ch.id;
    location.reload();
  };

  return (
    <div>
      <div className="card">
        <h3>🏁 种子挑战赛</h3>
        <div className="muted small" style={{ margin: "6px 0 10px" }}>
          官方发种子 + 约束，本地确定性演算，全员同一个世界比成绩；成绩以回放链接为凭证（服务端零模拟）。
        </div>
        {packs.length === 0 && <div className="muted small">暂无挑战包（发布后经静态 JSON 下发）。</div>}
        {packs.map((ch) => (
          <div key={ch.id} className="card" style={{ padding: "10px 14px", margin: "8px 0" }}>
            <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <b>{ch.name} <span className="tag">{ch.id}</span></b>
              <span className="muted small">种子 {ch.seed} · {ch.seasons} 赛季 · 比拼{ch.goal === "titles" ? "冠军数" : "冠军积分"}</span>
            </div>
            <div className="muted small" style={{ margin: "6px 0" }}>{ch.desc}</div>
            <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              {ch.constraints.origin && <span className="tag">出身：{{ legend: "名宿", grassroots: "草根", analyst: "分析师" }[ch.constraints.origin]}</span>}
              {ch.constraints.difficulty && <span className="tag">难度：{{ normal: "普通", hard: "困难", pro: "职业" }[ch.constraints.difficulty]}</span>}
              {ch.constraints.tier && <span className="tag">{ch.constraints.tier === 2 ? "挑战者俱乐部" : "VCT 合作队"}</span>}
              {ch.constraints.maxAge != null && <span className="tag">U{ch.constraints.maxAge}</span>}
              <button className="primary small" disabled={busy} onClick={() => startChallenge(ch)}>开始挑战（开新档）</button>
            </div>
          </div>
        ))}
      </div>

      {my && (
        <div className="card">
          <h3>📊 我的挑战成绩</h3>
          <div className="muted small" style={{ margin: "6px 0" }}>
            当前存档按各挑战口径演算（约束校验不通过的包不计分）。提交成绩：复制摘要 + 从回放库任选一场生成分享链接一并提交。
          </div>
          {packs.length === 0 && <div className="muted small">无挑战包。</div>}
          {packs.map((ch) => {
            const violation = state.seed === ch.seed ? validateChallengeStart(state, ch) : `种子不符（当前 ${state.seed} ≠ ${ch.seed}）`;
            const s = challengeScore(state, ch);
            return (
              <div key={ch.id} className="small" style={{ padding: "5px 0", borderBottom: "1px dashed var(--line)" }}>
                <b>{ch.name}</b>：{violation ? <span className="muted">不计分——{violation}</span> : (
                  <span>
                    {ch.goal === "titles" ? "冠军数" : "冠军积分"} <b>{s.value}</b> · 已赛 {s.seasonsPlayed}/{ch.seasons} 赛季{s.qualified ? "（完赛）" : ""}
                  </span>
                )}
                <button className="small" style={{ marginLeft: 8 }} onClick={() => { void navigator.clipboard.writeText(challengeReport(state, ch)).catch(() => {}); }}>复制摘要</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
