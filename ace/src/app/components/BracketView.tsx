/**
 * 晋级对阵图（v1.x 用户反馈）：当前国际赛事的双败淘汰树一屏可视化。
 * 左→右：胜者组三轮 → 总决赛；下排败者组四轮 → 败者组决赛 → 总决赛。
 * 每场显示双方 tag、胜者加亮、比分；未打的场次显示「待定/待 TBC」。
 * 数据派生自 fixtures（label + winnerTeamId），零新状态。
 */
import type { GameState } from "../../core/types.ts";
import { TeamLogo } from "./Avatar.tsx";

const tag = (state: GameState, id: string | null | undefined) =>
  (id && state.teams[id]?.tag) || "待定";

interface Slot { label: string; teamA: string; teamB: string; winnerTeamId?: string; score?: [number, number] }

function bracketSlot(fx: Slot[], label: string): Slot {
  return fx.find((f) => f.label === label) ?? { label, teamA: "", teamB: "" };
}

function MatchCell(props: { state: GameState; slot: Slot; highlightId: string }) {
  const { state, slot, highlightId } = props;
  const decided = !!slot.winnerTeamId;
  const loser = decided ? (slot.winnerTeamId === slot.teamA ? slot.teamB : slot.teamA) : null;
  return (
    <div
      style={{
        border: `1px solid ${slot.winnerTeamId === highlightId ? "var(--accent)" : "var(--line-soft)"}`,
        borderRadius: 6,
        padding: "3px 8px",
        marginBottom: 4,
        background: decided ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.015)",
        minWidth: 130,
      }}
    >
      {[slot.teamA, slot.teamB].map((id) => (
        <div key={id} className="small" style={{ display: "flex", justifyContent: "space-between", gap: 6, opacity: decided && id === loser ? 0.45 : 1 }}>
          <span style={{ fontWeight: id === highlightId ? 700 : 400 }}>{tag(state, id)}</span>
          {decided && slot.score && (
            <b style={{ color: slot.winnerTeamId === id ? "var(--green)" : "inherit" }}>
              {slot.winnerTeamId === id ? slot.score[0] : slot.score[1]}
            </b>
          )}
        </div>
      ))}
    </div>
  );
}

export function BracketView(props: { state: GameState; compKey: string; myId: string }) {
  const { state, myId, compKey } = props;
  const comp = state.comps[compKey];
  if (!comp) return null;
  const all = state.fixtures.filter((f) => f.comp === compKey && f.label.includes("组") || (f.comp === compKey && /决赛|第\d+轮/.test(f.label)));
  const fx: Slot[] = all
    .filter((f) => !f.label.includes("揭幕战") && !f.label.includes("出线决定赛") && !f.label.includes("胜者组决赛") && !f.label.includes("败者组决赛") || true)
    .map((f) => ({ label: f.label.replace(`${comp.name} `, ""), teamA: f.teamA, teamB: f.teamB, winnerTeamId: f.played ? f.winnerTeamId : undefined, score: undefined }));

  const by = (label: string) => bracketSlot(fx, label);
  const ubR1a = by("胜者组第1轮") && fx.filter((f) => f.label.includes("胜者组第1轮"));
  const ubR1 = fx.filter((f) => f.label === "胜者组第1轮" || f.label.includes("胜者组第1轮"));
  const ubSf = fx.filter((f) => f.label.includes("胜者组半决赛"));
  const ubF = [by("胜者组决赛")];
  const lbR1 = fx.filter((f) => f.label.includes("败者组第1轮"));
  const lbR2 = fx.filter((f) => f.label.includes("败者组第2轮"));
  const lbR3 = [by("败者组第3轮")];
  const lbF = [by("败者组决赛")];
  const gf = [by("总决赛")];

  const col = (title: string, slots: Slot[]) => (
    <div style={{ flex: "1 1 150px", minWidth: 140 }}>
      <div className="muted small" style={{ marginBottom: 4, textAlign: "center" }}>{title}</div>
      {slots.length === 0 ? (
        <div className="muted small" style={{ textAlign: "center", padding: "8px 0" }}>待晋级</div>
      ) : (
        slots.map((s, i) => <MatchCell key={i} state={state} slot={s} highlightId={myId} />)
      )}
    </div>
  );

  return (
    <div>
      <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
        {col("胜者组 R1", ubR1)}
        {col("胜者组 半决赛", ubSf)}
        {col("胜者组 决赛", ubF)}
        {col("总决赛", gf)}
        {col("败者组 决赛", lbF)}
        {col("败者组 R3", lbR3)}
        {col("败者组 R2", lbR2)}
        {col("败者组 R1", lbR1)}
      </div>
      <div className="muted small" style={{ marginTop: 6 }}>
        加亮边框 = 我们的比赛中；灰色名字 = 已淘汰方。
      </div>
    </div>
  );
}
