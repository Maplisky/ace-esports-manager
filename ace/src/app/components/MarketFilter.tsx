/**
 * 市场筛选器（自由市场 / 有主问价共用，v0.8 用户反馈：入口+展开面板+多选复杂筛选）：
 * useMarketFilters() 持有状态与过滤逻辑；MarketFilterPanel 渲染展开面板。
 */
import { useState } from "react";
import type { Player } from "../../core/types.ts";
import { AGENTS } from "../../core/data/agents.ts";
import { DUTY_ORDER, dutyTendencyOf } from "./AgentSelect.tsx";

export interface MarketFilters {
  dutySet: Set<string>;
  agentSet: Set<string>;
  iglFilter: "" | "main" | "vice" | "none";
  hideSynthetic: boolean;
  minOvr: string;
  minPot: string;
  ageMax: string;
  minValue: string;
  sortBy: string;
  show: boolean;
}

export function useMarketFilters(defaultSort = "value") {
  const [f, setF] = useState<Omit<MarketFilters, "show">>({
    dutySet: new Set(), agentSet: new Set(), iglFilter: "", hideSynthetic: false,
    minOvr: "", minPot: "", ageMax: "", minValue: "", sortBy: defaultSort,
  });
  const showState = useState(false);
  const set = (patch: Partial<Omit<MarketFilters, "show">>) => setF((prev) => ({ ...prev, ...patch }));
  const activeCount =
    f.dutySet.size + f.agentSet.size + (f.iglFilter ? 1 : 0) + (f.hideSynthetic ? 1 : 0) +
    (f.minOvr ? 1 : 0) + (f.minPot ? 1 : 0) + (f.ageMax ? 1 : 0) + (f.minValue ? 1 : 0);
  return {
    filters: f,
    show: showState[0],
    setShow: showState[1],
    set,
    activeCount,
    reset: () => setF({ dutySet: new Set(), agentSet: new Set(), iglFilter: "", hideSynthetic: false, minOvr: "", minPot: "", ageMax: "", minValue: "", sortBy: defaultSort }),
    /** 过滤+排序（valueOf：身价预计算 Map） */
    apply: (list: Player[], valueOf: Map<string, number>) =>
      list
        .filter((p) => {
          if (f.dutySet.size > 0 && !f.dutySet.has(dutyTendencyOf(p).mainKey)) return false;
          if (f.agentSet.size > 0 && !p.agentPool.some((a) => f.agentSet.has(a))) return false;
          if (f.iglFilter === "main" && !p.isIgl) return false;
          if (f.iglFilter === "vice" && !(p.isIgl || p.viceIgl)) return false;
          if (f.iglFilter === "none" && (p.isIgl || p.viceIgl)) return false;
          if (f.hideSynthetic && p.synthetic) return false;
          if (f.minOvr && p.overall < Number(f.minOvr)) return false;
          if (f.minPot && p.potential < Number(f.minPot)) return false;
          if (f.ageMax && p.age > Number(f.ageMax)) return false;
          if (f.minValue && valueOf.get(p.id)! < Number(f.minValue) * 1000) return false;
          return true;
        })
        .sort((a, b) => {
          switch (f.sortBy) {
            case "ovr": return b.overall - a.overall;
            case "pot": return b.potential - a.potential;
            case "ageAsc": return a.age - b.age;
            case "ageDesc": return b.age - a.age;
            case "valueAsc": return valueOf.get(a.id)! - valueOf.get(b.id)!;
            default: return valueOf.get(b.id)! - valueOf.get(a.id)!;
          }
        }),
  };
}

export function MarketFilterPanel(props: {
  mf: ReturnType<typeof useMarketFilters>;
  /** 追加的自定义筛选项（如问价卡的队伍下拉） */
  extra?: React.ReactNode;
}) {
  const { mf, extra } = props;
  const f = mf.filters;
  const toggleSet = (set: Set<string>, id: string) => {
    const n = new Set(set);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  };
  return (
    <div className="card" style={{ padding: "10px 14px", marginBottom: 10, background: "rgba(255,255,255,0.03)" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 }}>
        <div>
          <div className="muted small" style={{ marginBottom: 4, fontWeight: 700 }}>位置（可多选，按主职业）</div>
          {DUTY_ORDER.map((d) => (
            <label key={d.key} className="small" style={{ display: "block", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={f.dutySet.has(d.key)}
                onChange={(e) => mf.set({ dutySet: toggleSet(f.dutySet, d.key) })}
              />{" "}
              {d.label}
            </label>
          ))}
          {extra}
        </div>
        <div>
          <div className="muted small" style={{ marginBottom: 4, fontWeight: 700 }}>指挥身份</div>
          {[["", "不限"], ["main", "仅主指挥"], ["vice", "主/副指挥"], ["none", "无指挥身份"]].map(([v, l]) => (
            <label key={v} className="small" style={{ display: "block", cursor: "pointer" }}>
              <input type="radio" name={"igl_" + (f.minOvr ? f.minOvr : "x") + Math.random()} checked={f.iglFilter === v} onChange={() => mf.set({ iglFilter: v as MarketFilters["iglFilter"] })} /> {l}
            </label>
          ))}
        </div>
        <div>
          <div className="muted small" style={{ marginBottom: 4, fontWeight: 700 }}>范围</div>
          <div className="small" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            <span>能力≥ <input type="number" value={f.minOvr} onChange={(e) => mf.set({ minOvr: e.target.value })} style={{ width: 52 }} /></span>
            <span>潜力≥ <input type="number" value={f.minPot} onChange={(e) => mf.set({ minPot: e.target.value })} style={{ width: 52 }} /></span>
            <span>年龄≤ <input type="number" value={f.ageMax} onChange={(e) => mf.set({ ageMax: e.target.value })} style={{ width: 48 }} /></span>
            <span>身价≥ <input type="number" value={f.minValue} onChange={(e) => mf.set({ minValue: e.target.value })} style={{ width: 64 }} />K$</span>
          </div>
          <label className="small" style={{ display: "block", marginTop: 6, cursor: "pointer" }}>
            <input type="checkbox" checked={f.hideSynthetic} onChange={(e) => mf.set({ hideSynthetic: e.target.checked })} /> 隐藏虚构选手（只看 vlr 真实数据）
          </label>
        </div>
        <div>
          <div className="muted small" style={{ marginBottom: 4, fontWeight: 700 }}>英雄池含（可多选）</div>
          <div style={{ maxHeight: 132, overflowY: "auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
            {AGENTS.map((a) => (
              <label key={a.id} className="small" style={{ cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={f.agentSet.has(a.id)}
                  onChange={(e) => mf.set({ agentSet: toggleSet(f.agentSet, a.id) })}
                />{" "}
                {a.name}
              </label>
            ))}
          </div>
        </div>
      </div>
      <div className="row" style={{ justifyContent: "space-between", marginTop: 8 }}>
        <span className="row" style={{ gap: 6, alignItems: "center" }}>
          <span className="muted small">排序</span>
          <select value={f.sortBy} onChange={(e) => mf.set({ sortBy: e.target.value })}>
            <option value="value">身价 高→低</option>
            <option value="valueAsc">身价 低→高</option>
            <option value="ovr">能力 高→低</option>
            <option value="pot">潜力 高→低</option>
            <option value="ageAsc">年龄 低→高</option>
            <option value="ageDesc">年龄 高→低</option>
          </select>
        </span>
        <button className="small" onClick={mf.reset}>清空筛选</button>
      </div>
    </div>
  );
}
