import { readFileSync, writeFileSync } from "node:fs";
const p = "src/app/components/Tactics.tsx";
let s = readFileSync(p, "utf8");
if (s.includes("const VitalBar")) { console.log("already"); process.exit(0); }
const anchor = `    setPendingOut(null);
  };`;
if (!s.includes(anchor)) throw new Error("miss");
const ins = anchor + `

  // 状态条（与阵容页同款）
  const VitalBar = ({ v, color }: { v: number; color: string }) => (
    <span className="bar-track" title={String(Math.round(v))}>
      <span className="bar-fill" style={{ width: \`\${Math.max(0, Math.min(100, v))}%\`, background: color }} />
    </span>
  );`;
s = s.replace(anchor, ins);
writeFileSync(p, s);
console.log("vitalbar ok");
