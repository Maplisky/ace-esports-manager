/** 战术页：选手名点开 Dossier + 轮换（换下/提上首发，与 Squad 同交互） */
import { readFileSync, writeFileSync } from "node:fs";

let s = readFileSync("src/app/components/Tactics.tsx", "utf8");

// 1) 导入
if (!s.includes("PlayerDossier")) {
  s = s.replace(
    'import { useStore } from "../store.ts";',
    'import { useStore } from "../store.ts";\nimport { PlayerDossier } from "./PlayerDossier.tsx";',
  );
}

// 2) state：dossier + pendingOut（待换下对象）+ setStarters
s = s.replace(
  "  const { setPreset, applyPreset } = useStore();",
  "  const { setPreset, applyPreset, setStarters } = useStore();",
);
s = s.replace(
  "  const [adaptMsg, setAdaptMsg] = useState<string | null>(null);",
  "  const [adaptMsg, setAdaptMsg] = useState<string | null>(null);\n  const [dossier, setDossier] = useState<string | null>(null);\n  const [pendingOut, setPendingOut] = useState<string | null>(null);",
);

// 3) roster/bench 派生（在 starters 之后）
s = s.replace(
  "  const starters = team.starters.map((pid) => state.players[pid]!);",
  "  const starters = team.starters.map((pid) => state.players[pid]!);\n  const bench = team.roster.map((pid) => state.players[pid]!).filter((p) => !team.starters.includes(p.id));\n  const swap = (outId: string, inId: string) => {\n    void setStarters(team.starters.filter((id) => id !== outId).concat(inId));\n    setPendingOut(null);\n  };",
);

// 4) 首发行：ign 可点 + 换下按钮
s = s.replace(
  '                  <td>{p.ign}{p.isIgl && <span className="tag" style={{ marginLeft: 6 }}>指挥</span>}</td>',
  '                  <td>\n                    <span\n                      style={{ cursor: "pointer", textDecoration: pendingOut === p.id ? "line-through" : "underline dotted" }}\n                      onClick={() => setDossier(p.id)}\n                    >\n                      {p.ign}\n                    </span>\n                    {p.isIgl && <span className="tag" style={{ marginLeft: 6 }}>指挥</span>}\n                    {pendingOut === p.id && <span className="tag orange" style={{ marginLeft: 6 }}>待换下</span>}\n                  </td>',
);

// 5) 首发行尾加换下按钮（在熟练度 td 后）
s = s.replace(
  '                    {offDuty && <span className="tag red" style={{ marginLeft: 6 }}>错位</span>}\n                  </td>',
  '                    {offDuty && <span className="tag red" style={{ marginLeft: 6 }}>错位</span>}\n                    <button\n                      className="small"\n                      style={{ marginLeft: 8 }}\n                      onClick={() => setPendingOut(pendingOut === p.id ? null : p.id)}\n                    >\n                      {pendingOut === p.id ? "取消" : "换下"}\n                    </button>\n                  </td>',
);
s = s.replace(
  "          <thead>\n            <tr><th>选手</th><th>位置倾向</th><th>本图英雄</th><th>熟练度</th></tr>\n          </thead>",
  "          <thead>\n            <tr><th>选手</th><th>位置倾向</th><th>本图英雄</th><th>熟练度</th><th></th></tr>\n          </thead>",
);

// 6) 表后加轮换块（替补提上首发；选了待换下对象则直接换，否则弹选择换下谁）
const benchBlock = `
        <div className="row" style={{ marginTop: 10, flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <span className="muted small">轮换：</span>
          {bench.map((p) =>
            pendingOut ? (
              <button key={p.id} className="small" onClick={() => swap(pendingOut, p.id)}>
                {p.ign} ⇄ 换下 {state.players[pendingOut]?.ign}
              </button>
            ) : (
              <select
                key={p.id}
                className="small"
                defaultValue=""
                onChange={(e) => e.target.value && swap(e.target.value, p.id)}
                title={`提上 ${p.ign}（选择换下谁）`}
              >
                <option value="">提上 {p.ign}：换下谁…</option>
                {team.starters.map((sid) => (
                  <option key={sid} value={sid}>
                    {state.players[sid]?.ign}（{state.players[sid]?.overall}）
                  </option>
                ))}
              </select>
            ),
          )}
          {!bench.length && <span className="muted small">替补席无人。</span>}
        </div>
`;
const anchor = '        <div className="row" style={{ marginTop: 12 }}>\n          <input\n            placeholder="预案名（如：打 DRG 用）"';
if (!s.includes(anchor)) throw new Error("bench anchor miss");
s = s.replace(anchor, benchBlock + "\n" + anchor);

// 7) 弹窗渲染（组件尾部）
const tailIdx = s.lastIndexOf("    </div>\n  );\n}");
if (tailIdx < 0) throw new Error("tail miss");
const modal = "      {dossier && state.players[dossier] && (\n        <PlayerDossier state={state} player={state.players[dossier]!} onClose={() => setDossier(null)} />\n      )}\n    </div>\n  );\n}";
s = s.slice(0, tailIdx) + modal;

writeFileSync("src/app/components/Tactics.tsx", s);
console.log("tactics patched");
