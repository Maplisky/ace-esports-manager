/**
 * 系统页（v1.0-9，GDD §11.4/§10.1）：存档信任面板——
 * 3 手动槽 + 自动档 + 每日轮换备份（留 3 份）+ 导出/导入 JSON（永远可用，信任玩家）。
 */
import { useEffect, useRef, useState } from "react";
import { useStore } from "../store.ts";
import { MANUAL_SLOTS } from "../save.ts";
import { audioEnabled, setAudioEnabled, sfx } from "../audio.ts";

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function SystemPage() {
  const { state, saves, refreshSaves, saveToSlot, loadFromKey, removeSave, exportSave, importSaveText, setStopDensity, backToStart } = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [audioOn, setAudioOn] = useState(audioEnabled());
  const [backed, setBacked] = useState(false);

  useEffect(() => {
    void refreshSaves();
  }, [refreshSaves]);

  const byKey = new Map(saves.map((s) => [s.key, s]));
  const backups = saves.filter((s) => s.key.startsWith("bak-"));

  const row = (key: string, label: string, deletable: boolean) => {
    const e = byKey.get(key);
    return (
      <div key={key} className="row" style={{ padding: "7px 0", borderBottom: "1px dashed var(--line)", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        <b style={{ width: 92 }}>{label}</b>
        {e ? (
          <>
            <span className="small" style={{ minWidth: 210 }}>
              {e.meta ? `${e.meta.teamTag} · ${e.meta.manager} · ${e.meta.year} 年第 ${e.meta.day} 天 · ${e.meta.difficulty}` : "（旧档）"}
            </span>
            <span className="muted small">{fmtDate(e.savedAt)}</span>
            <span className="grow" />
            <button className="small" onClick={() => void loadFromKey(key)}>读取</button>
            {deletable && (
              <button className="small ghost" onClick={() => void removeSave(key)}>删除</button>
            )}
          </>
        ) : (
          <>
            <span className="muted small">空槽位</span>
            <span className="grow" />
            <button className="small" disabled={!state} onClick={() => void saveToSlot(key)}>保存到这里</button>
          </>
        )}
      </div>
    );
  };

  return (
    <div>
      <div className="card" style={{ padding: "14px 18px" }}>
        <h3 style={{ marginBottom: 4 }}>⚙️ 体验设置</h3>
        <div className="row" style={{ flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 8 }}>
          <span className="small">返回主界面（开局页可新建/切换存档）</span>
          <button className="small" disabled={!state || backed} onClick={() => void backToStart().then(() => setBacked(true))} title="离开前自动保存一次">
            {backed ? "✅ 已保存 · 可在下方读取任一存档" : "🏠 返回开头（自动保存）"}
          </button>
          {backed && <span className="tag green">已写入自动档</span>}
        </div>
        <div className="row" style={{ flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 8 }}>
          <span className="small">推进停靠密度</span>
          {([["light", "稀疏", "只在比赛日停靠，杂项提示只入新闻"], ["normal", "标准", "现状：比赛停靠 + 推进提示"], ["full", "密集", "每周一停靠并附训练周报"]] as const).map(([k, label, tip]) => (
            <button key={k} className={state?.stopDensity === k || (!state?.stopDensity && k === "normal") ? "small primary" : "small"} title={tip} onClick={() => void setStopDensity(k)}>{label}</button>
          ))}
        </div>
        <div className="row" style={{ flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <span className="small">音效</span>
          <button className={audioOn ? "small primary" : "small"} onClick={() => { const v = !audioOn; setAudioEnabled(v); setAudioOn(v); if (v) sfx("round"); }}>
            {audioOn ? "开（WebAudio 合成音）" : "关（默认）"}
          </button>
          <span className="muted small">回合提示 / 击杀 / 下包 / 赛点——振荡器自产合成，零外部素材</span>
        </div>
      </div>

      <div className="card" style={{ padding: "14px 18px" }}>
        <h3 style={{ marginBottom: 4 }}>💾 存档管理</h3>
        <div className="muted small" style={{ marginBottom: 10 }}>
          自动档随每次推进/操作更新；手动槽 3 个随时覆盖；每日首份持久化自动写入轮换备份（保留最近 3 份）。
          单机经营死于丢档多于死于无聊——导出文件永远可用。
        </div>
        {row("auto", "自动档", true)}
        {MANUAL_SLOTS.map((slot) => row(slot, `手动 ${slot.replace("slot", "槽 ")}`, true))}
        <div className="row" style={{ gap: 10, marginTop: 12, flexWrap: "wrap" }}>
          <button className="primary" disabled={!state} onClick={exportSave}>📤 导出当前存档（JSON）</button>
          <button onClick={() => fileRef.current?.click()}>📥 导入存档文件</button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              void f.text().then((t) => importSaveText(t));
              e.target.value = ""; // 允许重复导入同名文件
            }}
          />
        </div>
      </div>

      <div className="card" style={{ padding: "14px 18px", marginTop: 12 }}>
        <h3 style={{ marginBottom: 4 }}>🗂 每日轮换备份</h3>
        <div className="muted small" style={{ marginBottom: 8 }}>当天第一份持久化时自动快照，保留最近 3 份——误删/坏档的最后防线。</div>
        {backups.length === 0 && <div className="muted small">暂无备份（推进游戏后生成）。</div>}
        {backups
          .slice()
          .reverse()
          .map((b) => (
            <div key={b.key} className="row" style={{ padding: "6px 0", borderBottom: "1px dashed var(--line)", gap: 8, alignItems: "center" }}>
              <b style={{ width: 120 }}>{b.key.replace("bak-", "")}</b>
              <span className="small">{b.meta ? `${b.meta.teamTag} · ${b.meta.year} 年第 ${b.meta.day} 天` : ""}</span>
              <span className="muted small">{fmtDate(b.savedAt)}</span>
              <span className="grow" />
              <button className="small" onClick={() => void loadFromKey(b.key)}>读取</button>
              <button className="small ghost" onClick={() => void removeSave(b.key)}>删除</button>
            </div>
          ))}
      </div>
    </div>
  );
}
