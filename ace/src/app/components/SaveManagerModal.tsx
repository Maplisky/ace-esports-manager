/**
 * 存档管理弹窗（v1.x 用户反馈：做窗口式存档管理界面）：
 * 自动/手动 3 槽/每日备份的 读取 · 保存 · 删除 · 导出 一屏完成。
 * 开局页（无档也可导出迁移）与系统页共用；导出为 JSON 文件下载。
 */
import { useRef } from "react";
import type { GameState, MatchRecord } from "../../core/types.ts";
import { MANUAL_SLOTS } from "../save.ts";
import { useStore } from "../store.ts";

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const fmtK = (v: number) => `$${Math.round(v / 1000)}K`;

export function SaveManagerModal(props: { state: GameState; records: Record<string, MatchRecord>; onClose: () => void }) {
  const { state, records } = props;
  const { saves, refreshSaves, saveToSlot, loadFromKey, removeSave, exportSave } = useStore();
  const busyRef = useRef(false);

  const byKey = new Map(saves.map((s) => [s.key, s]));
  const backups = saves.filter((s) => s.key.startsWith("bak-"));
  const budget = state.myTeamId ? state.teams[state.myTeamId]?.budget ?? 0 : 0;

  const row = (key: string, label: string, canSave: boolean, canExport = false) => {
    const e = byKey.get(key);
    return (
      <div key={key} className="row" style={{ padding: "8px 0", borderBottom: "1px dashed var(--line)", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        <b style={{ width: 96 }}>{label}</b>
        {e ? (
          <>
            <span className="small" style={{ minWidth: 200 }}>
              {e.meta ? `${e.meta.teamTag} · ${e.meta.manager} · ${e.meta.year} 年第 ${e.meta.day} 天` : "（旧档）"}
              <span className="muted small" style={{ marginLeft: 6 }}>{e.meta?.difficulty}</span>
            </span>
            <span className="muted small">{fmtDate(e.savedAt)}</span>
            <span className="grow" />
            <button className="small" disabled={busyRef.current} onClick={() => void loadFromKey(key).then(() => props.onClose())}>读取</button>
            {canExport && <button className="small" onClick={exportSave}>📤 导出</button>}
            <button className="small ghost" onClick={() => void removeSave(key).then(() => refreshSaves())}>删除</button>
          </>
        ) : (
          <>
            <span className="muted small">空槽位</span>
            <span className="grow" />
            {canSave && <button className="small" disabled={!state || busyRef.current} onClick={() => void saveToSlot(key).then(() => refreshSaves())}>保存当前进度</button>}
          </>
        )}
      </div>
    );
  };

  return (
    <div className="viewer-backdrop" onClick={props.onClose}>
      <div className="viewer" style={{ width: "min(720px, 94vw)", maxHeight: "88vh", overflowY: "auto", padding: "16px 22px" }} onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>💾 存档管理</h3>
          <button className="small ghost" onClick={props.onClose}>关闭 ✕</button>
        </div>
        <div className="muted small" style={{ marginBottom: 10 }}>
          当前进度：{state.myTeamId ? `${state.teams[state.myTeamId]?.name ?? "?"} · ${state.manager?.name ?? "经理"} · ${state.year} 年第 ${state.day} 天 · ${fmtK(budget)}` : "未开档"}
        </div>

        {row("auto", "自动档", false, true)}
        {MANUAL_SLOTS.map((slot) => row(slot, `手动 ${slot.replace("slot", "槽 ")}`, true))}
        {row(`bak-${new Date().toISOString().slice(0, 10)}`, "今日备份", false)}

        {backups.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div className="muted small" style={{ marginBottom: 4 }}>历史备份（每日轮换，留 3 份）：</div>
            {backups.map((b) => (
              <div key={b.key} className="row" style={{ padding: "5px 0", borderBottom: "1px dashed var(--line)", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                <span className="muted small" style={{ width: 96 }}>备份</span>
                <span className="small" style={{ minWidth: 200 }}>{b.meta ? `${b.meta.teamTag} · ${b.meta.year} 年第 ${b.meta.day} 天` : "（旧档）"}</span>
                <span className="muted small">{fmtDate(b.savedAt)}</span>
                <span className="grow" />
                <button className="small" onClick={() => void loadFromKey(b.key).then(() => props.onClose())}>读取</button>
              </div>
            ))}
          </div>
        )}

        <div className="muted small" style={{ marginTop: 10 }}>
          导出当前进度为 JSON 文件——跨设备迁移或云端备份用；「导入存档文件」在开局页与系统页都有。单机经营死于丢档多于死于无聊，导出文件永远可用。
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <button className="primary" disabled={!state} onClick={exportSave}>📤 导出当前存档（JSON）</button>
        </div>
      </div>
    </div>
  );
}
