import { useState } from "react";
import type { GameState } from "../../core/types.ts";
import { MAPS } from "../../core/data/maps.ts";
import { useStore } from "../store.ts";

const SLOTS: { key: string; name: string; desc: string }[] = [
  { key: "map", name: "跑图", desc: "所选地图熟练 +0.4/天（上限 95），阵容磨合" },
  { key: "review", name: "复盘", desc: "意识/沟通缓速成长（受潜力上限约束）" },
  { key: "scrim", name: "对抗", desc: "队内赛：疲劳 +5，士气 +1" },
  { key: "individual", name: "个人", desc: "自由训练（v0.5 接个人轨道）" },
  { key: "rest", name: "休息", desc: "疲劳 −4" },
];

/** 训练页（GDD §6.3 v1.1 逐日课表，v0.1 团队层） */
export function TrainingPage(props: { state: GameState }) {
  const { state } = props;
  const setTeamSchedule = useStore((s) => s.setTeamSchedule);
  const [slots, setSlots] = useState<string[]>(() => (state.teamSchedule.length === 7 ? state.teamSchedule.slice() : ["map", "map", "review", "scrim", "individual", "individual", "rest"]));
  const [maps, setMaps] = useState<string[]>(() => (state.trainingMaps.length ? state.trainingMaps.slice() : [MAPS[0]!.id]));

  const setSlot = (idx: number, key: string) => {
    const next = slots.slice();
    next[idx] = key;
    setSlots(next);
  };
  const toggleMap = (id: string) => {
    setMaps((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      return [...cur, id].slice(-2); // 最多两张（GDD §6.3：一周最多两张图）
    });
  };
  const mapDays = slots.filter((s) => s === "map").length;
  const restDays = slots.filter((s) => s === "rest").length;

  return (
    <div>
      <div className="card">
        <h3>🏋 团队周课表（确定后练 7 天）</h3>
        <table>
          <thead>
            <tr><th>日</th><th>项目</th></tr>
          </thead>
          <tbody>
            {slots.map((slot, i) => (
              <tr key={i}>
                <td className="muted">第 {i + 1} 天</td>
                <td>
                  <select value={slot} onChange={(e) => setSlot(i, e.target.value)}>
                    {SLOTS.map((s) => (
                      <option key={s.key} value={s.key}>{s.name}</option>
                    ))}
                  </select>
                  <span className="muted small" style={{ marginLeft: 10 }}>
                    {SLOTS.find((s) => s.key === slot)?.desc}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="muted small" style={{ marginTop: 8 }}>
          本周：跑图 {mapDays} 天 · 休息 {restDays} 天 · 比赛日自动占槽（无训练收益）
        </div>
      </div>

      <div className="card">
        <h3>🗺 跑图目标（≤2 张，四周不练的图会衰减）</h3>
        <div className="row" style={{ flexWrap: "wrap" }}>
          {MAPS.map((m) => {
            const on = maps.includes(m.id);
            return (
              <button key={m.id} className={on ? "primary" : ""} onClick={() => toggleMap(m.id)}>
                {m.name} <span className="muted small">{state.myTeamId ? state.teams[state.myTeamId]?.mapPref[m.id] ?? 50 : 50}</span>
              </button>
            );
          })}
        </div>
      </div>

      <button
        className="primary"
        onClick={() => {
          const finalMaps = mapDays > 0 && maps.length === 0 ? ["jingjie"] : maps;
          void setTeamSchedule(slots, finalMaps);
        }}
      >
        📌 确定本周训练计划
      </button>
      <div className="muted small" style={{ marginTop: 8 }}>
        教练与设施会乘算训练收益；商务活动占用的天数会扣减训练（GDD §6.3）。
      </div>
    </div>
  );
}
