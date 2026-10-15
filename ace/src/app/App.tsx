import { useEffect, useState } from "react";
import { useStore } from "./store.ts";
import { decodeReplay } from "../core/sim/share.ts";
import type { GameState, MatchRecord } from "../core/types.ts";
import { StartScreen } from "./components/StartScreen.tsx";
import { TopBar, OverviewPage } from "./components/Overview.tsx";
import { SchedulePage } from "./components/Schedule.tsx";
import { SquadPage } from "./components/Squad.tsx";
import { TacticsPage } from "./components/Tactics.tsx";
import { TrainingPage } from "./components/Training.tsx";
import { BusinessPage } from "./components/Business.tsx";
import { ManagerPage } from "./components/Manager.tsx";
import { CareerPage } from "./components/Career.tsx";
import { AchievementsPage } from "./components/Achievements.tsx";
import { TransferPage } from "./components/Transfer.tsx";
import { MatchPlayer } from "./components/MatchPlayer.tsx";
import { PreMatch } from "./components/PreMatch.tsx";
import { SystemPage } from "./components/SystemPage.tsx";
import { REGIONS } from "../core/sim/day.ts";
import { pageUnlocked, pageUnlockDay, type GuidePage } from "./guide.ts";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
import { EventCardModal } from "./components/EventCards.tsx";

const PAGES: { key: "overview" | "schedule" | "squad" | "tactics" | "training" | "business" | "transfer" | "manager" | "achievements" | "career" | "system"; label: string }[] = [
  { key: "overview", label: "总览" },
  { key: "schedule", label: "赛程" },
  { key: "squad", label: "阵容" },
  { key: "tactics", label: "战术" },
  { key: "training", label: "训练" },
  { key: "business", label: "商务" },
  { key: "transfer", label: "转会" },
  { key: "manager", label: "经理" },
  { key: "achievements", label: "成就" },
  { key: "career", label: "名人堂" },
  { key: "system", label: "系统" },
];

export function App() {
  const { ready, screen, page, state, records, viewerFixtureId, viewerStartFinished, held, busy, toast, boot, setPage, closeViewer, advance, advanceToNextMatch, playHeld, scoutTeam, managerLife, matchIntervene, matchFinish } = useStore();
  const [replayShell, setReplayShell] = useState<{ state: GameState; record: MatchRecord } | null>(null);

  useEffect(() => {
    void boot();
  }, [boot]);

  // 分享回放链接（v1.0-12，GDD §9.4）：#replay=<code> → 解码 → 壳世界渲染播放器（无需存档）
  useEffect(() => {
    const m = /#replay=([A-Za-z0-9\-_]+)/.exec(location.hash);
    if (!m) return;
    void decodeReplay(m[1]!).then((p) => {
      if (!p) return;
      const shell = {
        day: p.rec.day,
        year: p.rec.day > 300 ? p.rec.day : 1,
        teams: {
          [p.rec.teamA]: { ...p.teams.A, starters: p.teams.A.roster.slice(0, 5) },
          [p.rec.teamB]: { ...p.teams.B, starters: p.teams.B.roster.slice(0, 5) },
        },
        players: Object.fromEntries(Object.entries(p.players).map(([pid, v]) => [pid, { ...v, agentPool: [] }])),
      } as unknown as GameState;
      setReplayShell({ state: shell, record: p.rec });
    });
  }, []);

  if (!ready) return <div className="muted" style={{ padding: 40 }}>加载中…</div>;
  if (replayShell) {
    return (
      <MatchPlayer
        record={replayShell.record}
        state={replayShell.state}
        onClose={() => {
          history.replaceState(null, "", location.pathname);
          setReplayShell(null);
        }}
      />
    );
  }
  if (screen === "start" || !state) return <StartScreen />;

  const myTeam = state.teams[state.myTeamId ?? ""];
  const nextFixture = state.fixtures.find(
    (f) => !f.played && f.teamA !== "" && f.teamB !== "" && (f.teamA === state.myTeamId || f.teamB === state.myTeamId),
  );
  const viewerRecord = viewerFixtureId ? records[viewerFixtureId] : null;
  const ending = state.manager.career?.ending;

  // 生涯终局（v1.0-6，GDD §9.5）：下课/退休/名人堂收官 → 结局卡覆盖主界面，推进停止
  if (ending) {
    const c = state.manager.career!;
    const total = c.wins + c.losses;
    const wr = total > 0 ? ((c.wins / total) * 100).toFixed(1) : "—";
    const kindText = ending.kind === "fired" ? "🔻 光荣不再：你被解除了主帅职务" : ending.kind === "retired" ? "🎖 十年执教期满，光荣退休" : "📜 五年之约，传奇谢幕";
    return (
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "48px 20px" }}>
        <div className="card" style={{ textAlign: "center" }}>
          <h2>{kindText}</h2>
          <div className="muted" style={{ margin: "10px 0" }}>
            {state.manager.name} · {c.startYear}–{ending.year} · {c.seasons} 个赛季
          </div>
          <div className="row" style={{ justifyContent: "center", gap: 22, fontSize: 18, margin: "18px 0" }}>
            <span>🏆 冠军 <b>{c.titles}</b></span>
            <span>⚔️ 战绩 <b>{c.wins}胜{c.losses}负</b>（{wr}%）</span>
            <span>💼 个人存款 <b>${((state.manager.life.wallet ?? 0) / 1000).toFixed(0)}K</b></span>
          </div>
          <div className="muted small" style={{ margin: "12px 0 20px" }}>
            {c.titles >= 3 ? "名人堂评价：王朝缔造者。" : c.titles >= 1 ? "名人堂评价：冠军教头。" : total > 0 && c.wins / total >= 0.55 ? "名人堂评价：稳定器与 rebuilding 大师。" : "名人堂评价：路还长，江湖再见。"}
          </div>
          <button className="primary" onClick={() => location.reload()}>开始新的职业生涯</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <TopBar
        teamTag={myTeam?.tag ?? "?"}
        teamName={myTeam?.name ?? "?"}
        teamLogo={myTeam?.logo}
        regionLabel={REGIONS.find((r) => r.id === myTeam?.regionId)?.label}
        regionLogo={REGIONS.find((r) => r.id === myTeam?.regionId)?.logo}
        year={state.year}
        day={state.day}
        stage={stageName(state.stage)}
        budget={myTeam?.budget ?? 0}
        ap={state.actionPoints}
        confidence={Math.round(state.boardConfidence)}
        nextLabel={nextFixture ? nextFixtureLabel(state, nextFixture.teamA, nextFixture.teamB, nextFixture.day) : "赛季已收官"}
      />
      <div className="layout">
        <nav className="sidenav">
          {PAGES.map((p) => {
            const open = pageUnlocked(p.key as GuidePage, state);
            return (
              <button
                key={p.key}
                className={page === p.key ? "on" : ""}
                title={open ? undefined : `第 ${pageUnlockDay(p.key as GuidePage)} 天解锁`}
                onClick={() => setPage(p.key)}
              >
                {p.label}{!open && " 🔒"}
              </button>
            );
          })}
        </nav>
        <main className="content">
          {(() => {
            const cur = PAGES.find((p) => p.key === page)!;
            if (!pageUnlocked(cur.key as GuidePage, state)) {
              return (
                <div className="card" style={{ padding: "40px 20px", textAlign: "center" }}>
                  <div style={{ fontSize: 32 }}>🔒</div>
                  <h3 style={{ margin: "10px 0 6px" }}>{cur.label}页尚未开放</h3>
                  <div className="muted">系统将随执教进度逐日解锁（第 {pageUnlockDay(cur.key as GuidePage)} 天）——第二赛季起全部常开。</div>
                </div>
              );
            }
            return (
              <>
          {page === "overview" && (
            <OverviewPage
              state={state}
              busy={busy}
              onAdvance={() => void advance()}
              onAdvanceToMatch={() => void advanceToNextMatch()}
              onScout={(teamId) => void scoutTeam(teamId)}
            />
          )}
          {page === "schedule" && <SchedulePage state={state} records={records} />}
          {page === "squad" && <SquadPage state={state} />}
          {page === "tactics" && <TacticsPage state={state} />}
          {page === "training" && <TrainingPage state={state} />}
          {page === "transfer" && <TransferPage state={state} />}
          {page === "business" && <BusinessPage state={state} />}
          {page === "manager" && <ManagerPage state={state} />}
          {page === "achievements" && <AchievementsPage state={state} />}
          {page === "career" && <CareerPage state={state} />}
          {page === "system" && <SystemPage />}
              </>
            );
          })()}
        </main>
      </div>

      {held && (
        <PreMatch
          state={state}
          fixtureId={held.fixtureId}
          teamAId={held.teamA}
          teamBId={held.teamB}
          bo={held.bo}
          label={held.label}
          onConfirm={(r) => void playHeld(r)}
        />
      )}

      {viewerRecord && (() => {
        // v1.0-8：只有「已模拟未结算」的交互式比赛可喊话（历史回放只读）
        const fx = state.fixtures.find((f) => f.id === viewerFixtureId);
        const live = !!fx && fx.played && !fx.settled;
        return (
          <MatchPlayer
            record={viewerRecord}
            state={state}
            startFinished={viewerStartFinished}
            myTeamId={live ? state.myTeamId : null}
            tutorial={fx?.tutorial === true}
            onIntervene={(mapIdx, round, tactic, igl) => {
              if (viewerFixtureId) void matchIntervene(viewerFixtureId, mapIdx, round, tactic, igl);
            }}
            onFinished={() => {
              if (viewerFixtureId) void matchFinish(viewerFixtureId); // v1.0-8：播放结束才结算
            }}
            onClose={closeViewer}
          />
        );
      })()}

      {/* 事件卡最优先（GDD §9.3）：待决策队列逐张处理，盖在其他弹窗之上 */}
      {state.pendingEvents.length > 0 && <EventCardModal />}
      {toast && (
        <div
          style={{
            position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
            background: "var(--panel2)", border: "1px solid var(--accent)", borderRadius: 8,
            padding: "8px 18px", zIndex: 200,
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}

export function stageName(stage: string): string {
  switch (stage) {
    case "preseason": return "季前准备";
    case "cup": return "揭幕杯";
    case "masters": return "Masters";
    case "stage1": return "Stage 1";
    case "summer": return "夏季窗口";
    case "stage2": return "Stage 2";
    case "champions": return "Champions";
    default: return "休赛期";
  }
}

function nextFixtureLabel(state: import("../core/types.ts").GameState, teamA: string, teamB: string, day: number): string {
  const opp = teamA === state.myTeamId ? teamB : teamA;
  const tag = state.teams[opp]?.tag ?? "?";
  return `下一场：${tag} · ${day - state.day <= 0 ? "今天" : `${day - state.day}天后`}`;
}
