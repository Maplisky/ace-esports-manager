/**
 * 财务页（v1.3 可视化核心，GDD §8.1「财务页必配现金流可视化」）：
 * 30 天现金流瀑布（finances.log 为唯一事实源，终点对账当前资金）+ 分类占比环 + 流水明细。
 * 纯 SVG 自绘；当前模拟口径：资金只经 转会/解约/选秀权/商务/事件 流动（薪资与奖金未模拟为现金流）。
 */
import { useState } from "react";
import type { GameState } from "../../core/types.ts";
import { financeWindow, financeBreakdown, FINANCE_CAT_CN, type FinanceCat } from "../../core/sim/finance.ts";
import { CollapsibleCard } from "./CollapsibleCard.tsx";

const fmtK = (v: number) => (Math.abs(v) >= 1_000_000 ? `$${(v / 1_000_000).toFixed(2)}M` : Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(0)}K` : `$${v}`);

const CAT_COLORS: Record<FinanceCat, string> = {
  transfer: "#e8c15a",
  release: "#f87171",
  draft: "#a78bfa",
  business: "#4ade80",
  event: "#60a5fa",
  other: "#94a3b8",
};

export function FinancePage(props: { state: GameState }) {
  const { state } = props;
  const myId = state.myTeamId ?? "";
  const team = state.teams[myId];
  const [days, setDays] = useState(30);
  if (!team) return null;

  const win = financeWindow(state, days);
  const cat = financeBreakdown(win.entries);
  const income = cat.reduce((s, c) => s + c.income, 0);
  const expense = cat.reduce((s, c) => s + c.expense, 0);

  // 瀑布几何：步进取「每笔」太密——按天聚合后画
  const byDay = new Map<number, number>();
  for (const e of win.entries) byDay.set(e.day, (byDay.get(e.day) ?? 0) + e.amount);
  const daySteps = [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([d, amt]) => ({ day: d, amt }));
  const W = 720;
  const H = 180;
  const pad = { l: 56, r: 12, t: 14, b: 22 };
  const allBals: number[] = [win.start];
  let acc = win.start;
  for (const s of daySteps) {
    acc += s.amt;
    allBals.push(acc);
  }
  const lo = Math.min(...allBals);
  const hi = Math.max(...allBals);
  const span = Math.max(1, hi - lo);
  const yOf = (v: number) => pad.t + (1 - (v - lo) / span) * (H - pad.t - pad.b);
  const xOf = (i: number) => pad.l + (i / Math.max(1, daySteps.length)) * (W - pad.l - pad.r);
  // 瀑布条：每天一根，从当日起点到当日终点
  let bal = win.start;
  const bars = daySteps.map((s, i) => {
    const from = bal;
    bal += s.amt;
    return { i, day: s.day, amt: s.amt, from, to: bal };
  });

  // 占比环几何（收入环与支出环并排，各画一个 donut）
  const donut = (items: { value: number; color: string }[], cx: number, cy: number, r: number) => {
    const total = items.reduce((s, x) => s + x.value, 0);
    if (total <= 0) return { arcs: [], total };
    let ang = -Math.PI / 2;
    const arcs = items.map((it) => {
      const frac = it.value / total;
      const a0 = ang;
      const a1 = ang + frac * 2 * Math.PI;
      ang = a1;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const p = (a: number): [number, number] => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
      const [x0, y0] = p(a0);
      const [x1, y1] = p(a1);
      return { d: `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`, color: it.color, value: it.value };
    });
    return { arcs, total };
  };
  const incItems = cat.map((c) => ({ value: c.income, color: CAT_COLORS[c.cat] })).filter((x) => x.value > 0);
  const expItems = cat.map((c) => ({ value: c.expense, color: CAT_COLORS[c.cat] })).filter((x) => x.value > 0);
  const incRing = donut(incItems, 110, 88, 62);
  const expRing = donut(expItems, 330, 88, 62);

  return (
    <div>
      <div className="card" data-tut="tut-finance-flow">
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <h3>💰 财务</h3>
          <div className="row" style={{ gap: 6 }}>
            {[7, 30, 90].map((d) => (
              <button key={d} className={days === d ? "small primary" : "small"} onClick={() => setDays(d)}>近 {d} 天</button>
            ))}
          </div>
        </div>
        <div className="row" style={{ gap: 18, flexWrap: "wrap", margin: "8px 0" }}>
          <span>当前资金 <b style={{ fontSize: 16 }}>{fmtK(team.budget)}</b></span>
          <span className={income - expense >= 0 ? "green" : "red"}>窗口净流 <b>{income - expense >= 0 ? "+" : ""}{fmtK(income - expense)}</b></span>
          <span className="green">收入 {fmtK(income)}</span>
          <span className="red">支出 {fmtK(expense)}</span>
        </div>
        {/* 瀑布（按天聚合） */}
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: W }}>
          <line x1={pad.l} y1={yOf(win.start)} x2={W - pad.r} y2={yOf(win.start)} stroke="rgba(255,255,255,0.25)" strokeDasharray="3 3" />
          <text x={pad.l - 6} y={yOf(win.start) + 3} fontSize={9} textAnchor="end" fill="rgba(255,255,255,0.5)">{fmtK(win.start)}</text>
          <text x={pad.l - 6} y={yOf(hi) + 8} fontSize={9} textAnchor="end" fill="rgba(255,255,255,0.35)">{fmtK(hi)}</text>
          <text x={pad.l - 6} y={yOf(lo) - 2} fontSize={9} textAnchor="end" fill="rgba(255,255,255,0.35)">{fmtK(lo)}</text>
          {bars.map((b) => {
            const x = xOf(b.i);
            const w = Math.max(3, (W - pad.l - pad.r) / Math.max(1, daySteps.length) - 2);
            const yTop = yOf(Math.max(b.from, b.to));
            const h = Math.max(1.5, Math.abs(yOf(b.from) - yOf(b.to)));
            return (
              <g key={b.day}>
                <rect x={x} y={yTop} width={w} height={h} fill={b.amt >= 0 ? "#4ade80" : "#f87171"} opacity={0.85} rx={1}>
                  <title>{`D${b.day}：${b.amt >= 0 ? "+" : ""}${fmtK(b.amt)} → ${fmtK(b.to)}`}</title>
                </rect>
              </g>
            );
          })}
          {bars.length === 0 && <text x={W / 2} y={H / 2} fontSize={12} textAnchor="middle" fill="rgba(255,255,255,0.4)">窗口内暂无资金流动</text>}
          <text x={pad.l} y={H - 6} fontSize={9} fill="rgba(255,255,255,0.4)">D{state.day - days + 1}</text>
          <text x={W - pad.r} y={H - 6} fontSize={9} textAnchor="end" fill="rgba(255,255,255,0.4)">今天 D{state.day}</text>
        </svg>
        <div className="muted small" style={{ marginTop: 4 }}>
          瀑布终点即当前资金（对账口径：期初 {fmtK(win.start)} + 窗口流水 = {fmtK(win.end)}）。当前模拟中资金只经 转会/解约/选秀权/商务/事件 流动。
        </div>
      </div>

      <div className="card">
        <h3>🍩 分类占比</h3>
        <div style={{ display: "flex", gap: 26, flexWrap: "wrap" }}>
          <svg viewBox="0 0 220 176" width={220}>
            {incRing.arcs.map((a, i) => <path key={i} d={a.d} fill={a.color} opacity={0.85} stroke="#0b0e15" strokeWidth={1}><title>{fmtK(a.value)}</title></path>)}
            <text x={110} y={84} fontSize={11} textAnchor="middle" fill="rgba(255,255,255,0.75)">收入</text>
            <text x={110} y={99} fontSize={10} textAnchor="middle" fill="rgba(255,255,255,0.5)">{fmtK(income)}</text>
            {incRing.arcs.length === 0 && <circle cx={110} cy={88} r={62} fill="none" stroke="rgba(255,255,255,0.12)" strokeDasharray="4 4" />}
          </svg>
          <svg viewBox="0 0 220 176" width={220}>
            {expRing.arcs.map((a, i) => <path key={i} d={a.d} fill={a.color} opacity={0.85} stroke="#0b0e15" strokeWidth={1}><title>{fmtK(a.value)}</title></path>)}
            <text x={110} y={84} fontSize={11} textAnchor="middle" fill="rgba(255,255,255,0.75)">支出</text>
            <text x={110} y={99} fontSize={10} textAnchor="middle" fill="rgba(255,255,255,0.5)">{fmtK(expense)}</text>
            {expRing.arcs.length === 0 && <circle cx={110} cy={88} r={62} fill="none" stroke="rgba(255,255,255,0.12)" strokeDasharray="4 4" />}
          </svg>
          <div style={{ flex: 1, minWidth: 220 }}>
            {cat.length === 0 && <div className="muted small">窗口内暂无流水。</div>}
            {cat.map((c) => (
              <div key={c.cat} className="row small" style={{ justifyContent: "space-between", gap: 8, padding: "2px 0" }}>
                <span className="row" style={{ gap: 6 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: CAT_COLORS[c.cat], display: "inline-block" }} />
                  {FINANCE_CAT_CN[c.cat]}
                </span>
                <span>
                  {c.income > 0 && <span className="green">+{fmtK(c.income)} </span>}
                  {c.expense > 0 && <span className="red">−{fmtK(c.expense)}</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <CollapsibleCard title={`📒 流水明细（最近 ${Math.min(30, win.entries.length)} 条）`} defaultOpen={false}>
        <table>
          <thead><tr><th>日期</th><th>事项</th><th style={{ textAlign: "right" }}>金额</th></tr></thead>
          <tbody>
            {win.entries.slice(-30).reverse().map((e, i) => (
              <tr key={i}>
                <td className="muted">D{e.day}</td>
                <td>{e.label}</td>
                <td style={{ textAlign: "right", color: e.amount >= 0 ? "#4ade80" : "#f87171" }}>{e.amount >= 0 ? "+" : ""}{fmtK(e.amount)}</td>
              </tr>
            ))}
            {win.entries.length === 0 && <tr><td colSpan={3} className="muted">暂无流水。</td></tr>}
          </tbody>
        </table>
      </CollapsibleCard>
    </div>
  );
}
