import { useEffect } from "react";
import { useStore } from "./store.ts";
import { StartScreen } from "./components/StartScreen.tsx";
import { TopBar, OverviewPage } from "./components/Overview.tsx";
import { SchedulePage } from "./components/Schedule.tsx";
import { SquadPage } from "./components/Squad.tsx";
import { TacticsPage } from "./components/Tactics.tsx";
import { TrainingPage } from "./components/Training.tsx";
import { BusinessPage } from "./components/Business.tsx";
import { ManagerPage } from "./components/Manager.tsx";
import { TransferPage } from "./components/Transfer.tsx";
import { MatchPlayer } from "./components/MatchPlayer.tsx";
import { PreMatch } from "./components/PreMatch.tsx";
import { EventCardModal } from "./components/EventCards.tsx";

const PAGES: { key: "overview" | "schedule" | "squad" | "tactics" | "training" | "business" | "transfer" | "manager"; label: string }[] = [
  { key: "overview", label: "总览" },
  { key: "schedule", label: "赛程" },
  { key: "squad", label: "阵容" },
  { key: "tactics", label: "战术" },
  { key: "training", label: "训练" },
  { key: "business", label: "商务" },
  { key: "transfer", label: "转会" },
  { key: "manager", label: "经理" },
];

export function App() {
  const { ready, screen, page, state, records, viewerFixtureId, viewerStartFinished, held, busy, toast, boot, setPage, closeViewer, advance, advanceToNextMatch, playHeld, scoutTeam, managerLife } = useStore();

  useEffect(() => {
    void boot();
  }, [boot]);

  if (!ready) return <div className="muted" style={{ padding: 40 }}>加载中…</div>;
  if (screen === "start" || !state) return <StartScreen />;

  const myTeam = state.teams[state.myTeamId ?? ""];
  const nextFixture = state.fixtures.find(
    (f) => !f.played && f.teamA !== "" && f.teamB !== "" && (f.teamA === state.myTeamId || f.teamB === state.myTeamId),
  );
  const viewerRecord = viewerFixtureId ? records[viewerFixtureId] : null;

  return (
    <div>
      <TopBar
        teamTag={myTeam?.tag ?? "?"}
        teamName={myTeam?.name ?? "?"}
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
          {PAGES.map((p) => (
            <button key={p.key} className={page === p.key ? "on" : ""} onClick={() => setPage(p.key)}>
              {p.label}
            </button>
          ))}
        </nav>
        <main className="content">
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

      {viewerRecord && (
        <MatchPlayer
          record={viewerRecord}
          state={state}
          startFinished={viewerStartFinished}
          onClose={closeViewer}
        />
      )}

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
    default: return "休赛期";
  }
}

function nextFixtureLabel(state: import("../core/types.ts").GameState, teamA: string, teamB: string, day: number): string {
  const opp = teamA === state.myTeamId ? teamB : teamA;
  const tag = state.teams[opp]?.tag ?? "?";
  return `下一场：${tag} · ${day - state.day <= 0 ? "今天" : `${day - state.day}天后`}`;
}
