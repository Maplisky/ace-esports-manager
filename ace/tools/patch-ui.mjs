/** 一次性 UI 接线补丁（v0.7）：Squad/Overview/Transfer 加头像 */
import { readFileSync, writeFileSync } from "node:fs";

const q = (s) => JSON.stringify(s);

// Squad：首发行 + 替补行 + 轮换面板加头像
{
  let s = readFileSync("src/app/components/Squad.tsx", "utf8");
  if (!s.includes("Avatar.tsx")) {
    s = s.replace('import { useStore } from "../store.ts";', 'import { useStore } from "../store.ts";\nimport { PlayerFace, SyntheticBadge } from "./Avatar.tsx";');
    s = s.replace(
      "                  <td>\n                    {p.ign}\n                    {p.isIgl && <span className=\"tag\" style={{ marginLeft: 6 }}>指挥</span>}\n                  </td>",
      "                  <td style={{ whiteSpace: \"nowrap\" }}>\n                    <span className=\"row\" style={{ alignItems: \"center\", gap: 6 }}>\n                      <PlayerFace p={p} size={26} />\n                      <span>{p.ign}<SyntheticBadge p={p} />{p.isIgl && <span className=\"tag\" style={{ marginLeft: 6 }}>指挥</span>}</span>\n                    </span>\n                  </td>",
    );
    s = s.replace("                <td>{p.ign}</td>", "                <td style={{ whiteSpace: \"nowrap\" }}><span className=\"row\" style={{ alignItems: \"center\", gap: 6 }}><PlayerFace p={p} size={22} />{p.ign}<SyntheticBadge p={p} /></span></td>");
    s = s.replace("                <b style={{ width: 100 }}>{p.ign}</b>", "                <span className=\"row\" style={{ alignItems: \"center\", gap: 6, width: 118 }}><PlayerFace p={p} size={24} /><b>{p.ign}</b><SyntheticBadge p={p} /></span>");
    writeFileSync("src/app/components/Squad.tsx", s);
    console.log("Squad ok");
  }
}

// Overview：首发速览加头像
{
  let s = readFileSync("src/app/components/Overview.tsx", "utf8");
  if (!s.includes("Avatar.tsx")) {
    s = s.replace('import { useStore } from "../store.ts";', 'import { useStore } from "../store.ts";\nimport { PlayerFace } from "./Avatar.tsx";');
    s = s.replace(
      "                    <td>{p.ign}{p.isIgl && <span className=\"tag\" style={{ marginLeft: 6 }}>指挥</span>}</td>",
      "                    <td><span className=\"row\" style={{ alignItems: \"center\", gap: 6 }}><PlayerFace p={p} size={24} showTag={false} />{p.ign}{p.isIgl && <span className=\"tag\" style={{ marginLeft: 6 }}>指挥</span>}</span></td>",
    );
    writeFileSync("src/app/components/Overview.tsx", s);
    console.log("Overview ok");
  }
}

// Transfer：报价行 + 名单 + 市场表加头像
{
  let s = readFileSync("src/app/components/Transfer.tsx", "utf8");
  if (!s.includes("Avatar.tsx")) {
    s = s.replace('import { useStore } from "../store.ts";', 'import { useStore } from "../store.ts";\nimport { PlayerFace, SyntheticBadge } from "./Avatar.tsx";');
    s = s.replace("                <b style={{ width: 90 }}>{p.ign}</b>", "                <span className=\"row\" style={{ alignItems: \"center\", gap: 6, width: 110 }}><PlayerFace p={p} size={24} /><b>{p.ign}</b><SyntheticBadge p={p} /></span>");
    s = s.replace("                    {p.ign}", "                    <span className=\"row\" style={{ alignItems: \"center\", gap: 6 }}><PlayerFace p={p} size={20} />{p.ign}</span>");
    s = s.replace("                <td>{p.ign}</td>", "                <td><span className=\"row\" style={{ alignItems: \"center\", gap: 6 }}><PlayerFace p={p} size={22} showTag={false} />{p.ign}</span></td>");
    writeFileSync("src/app/components/Transfer.tsx", s);
    console.log("Transfer ok");
  }
}
void q;
