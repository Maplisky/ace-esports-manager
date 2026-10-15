/**
 * 成就页（v1.0-10，GDD §10.4 v2.5）：按剧本路径组织——四条线各 4 项（1 史诗）+ 通用层。
 * 挑战剧本（§18-7）进度占位复用同页。判定只读账本，解锁在 worker 推进/结算时完成。
 */
import { ACHIEVEMENTS, PATH_LABEL, type AchPath } from "../../core/sim/achievements.ts";
import type { GameState } from "../../core/types.ts";

const PATH_ORDER: AchPath[] = ["general", "rebuilder", "dynasty", "academy", "mercenary"];
const PATH_DESC: Record<AchPath, string> = {
  general: "跨路径通用里程碑——每条路都要经过它们",
  rebuilder: "接手低谷，把队伍从泥地里拉起来",
  dynasty: "赢，然后一直赢",
  academy: "亲手把 17 岁新秀带成世界级明星",
  mercenary: "履历就是武器，哪里需要哪里去",
};

export function AchievementsPage(props: { state: GameState }) {
  const { state } = props;
  const unlocked = state.achievements ?? {};
  const total = ACHIEVEMENTS.length;
  const got = ACHIEVEMENTS.filter((a) => unlocked[a.id]).length;

  return (
    <div>
      <div className="card" style={{ padding: "12px 18px", marginBottom: 12 }}>
        <h3 style={{ marginBottom: 2 }}>🏆 成就 · 剧本路径</h3>
        <div className="muted small">
          已解锁 <b>{got}</b> / {total} ——四条剧本线各自通向一种执教人生；史诗成就（★）是路径终点。
        </div>
        <div style={{ height: 6, borderRadius: 3, background: "var(--panel2)", marginTop: 8, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${(got / total) * 100}%`, background: "#fbbf24" }} />
        </div>
      </div>

      {PATH_ORDER.map((path) => {
        const defs = ACHIEVEMENTS.filter((a) => a.path === path);
        const n = defs.filter((a) => unlocked[a.id]).length;
        return (
          <div key={path} className="card" style={{ padding: "12px 18px", marginBottom: 12 }}>
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 2 }}>
              <b>{PATH_LABEL[path]}</b>
              <span className="muted small">{n}/{defs.length}</span>
            </div>
            <div className="muted small" style={{ marginBottom: 8 }}>{PATH_DESC[path]}</div>
            {defs.map((a) => {
              const u = unlocked[a.id];
              return (
                <div
                  key={a.id}
                  style={{
                    display: "flex", gap: 10, alignItems: "center",
                    padding: "7px 10px", marginBottom: 4, borderRadius: 8,
                    background: u ? "rgba(251,191,36,0.07)" : "var(--panel2)",
                    borderLeft: `3px solid ${u ? "#fbbf24" : "var(--line)"}`,
                    opacity: u ? 1 : 0.72,
                  }}
                >
                  <span style={{ fontSize: 18 }}>{u ? (a.epic ? "★" : "🏆") : "🔒"}</span>
                  <span style={{ minWidth: 110 }}>
                    <b style={{ color: u ? (a.epic ? "#fbbf24" : "var(--text)") : "var(--muted)" }}>{a.name}</b>
                    {a.epic && <span className="tag" style={{ marginLeft: 6, background: "#fbbf24", color: "#1a1a24" }}>史诗</span>}
                  </span>
                  <span className="small" style={{ flex: 1 }}>{a.desc}</span>
                  {u && <span className="muted small">{u.year} 年第 {u.day} 天</span>}
                </div>
              );
            })}
          </div>
        );
      })}

      <div className="card" style={{ padding: "12px 18px" }}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 2 }}>
          <b>🎭 挑战剧本（§18-7 · v1.x）</b>
          <span className="muted small">0/4</span>
        </div>
        <div className="muted small" style={{ marginBottom: 8 }}>开局参数组合 + 成就判定——与成就系统共用判定器，待 v1.x 开放。</div>
        {["全青训夺冠", "全年零转会", "次级队十年一城", "仅 U24 阵容"].map((s) => (
          <div key={s} style={{ display: "flex", gap: 10, alignItems: "center", padding: "7px 10px", marginBottom: 4, borderRadius: 8, background: "var(--panel2)", opacity: 0.55 }}>
            <span style={{ fontSize: 18 }}>🔒</span>
            <b style={{ color: "var(--muted)" }}>{s}</b>
            <span className="grow" />
            <span className="tag">未开放</span>
          </div>
        ))}
      </div>
    </div>
  );
}
