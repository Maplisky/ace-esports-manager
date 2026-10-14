/** UI 接线补丁 2：TopBar 队徽+赛区徽标、积分榜队徽、MatchPlayer/PreMatch 双方队徽 */
import { readFileSync, writeFileSync } from "node:fs";

// TopBar：加 logo/regionLogo props
{
  let s = readFileSync("src/app/components/Overview.tsx", "utf8");
  if (!s.includes("TeamLogo")) {
    s = s.replace('import { PlayerFace } from "./Avatar.tsx";', 'import { PlayerFace, TeamLogo } from "./Avatar.tsx";');
    s = s.replace(
      'export function TopBar(props: {\n  teamTag: string; teamName: string; year: number; day: number; stage: string;',
      'export function TopBar(props: {\n  teamTag: string; teamName: string; year: number; day: number; stage: string;\n  teamLogo?: string; regionLabel?: string; regionLogo?: string;',
    );
    s = s.replace(
      '        <span className="v">{props.teamName} <span className="tag">{props.teamTag}</span></span>',
      '        <span className="v" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>\n          {props.teamLogo && <img src={props.teamLogo} alt="" width={18} height={18} style={{ borderRadius: 3, objectFit: "contain" }} />}\n          {props.teamName} <span className="tag">{props.teamTag}</span>\n          {props.regionLogo && <span title={props.regionLabel} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><img src={props.regionLogo} alt={props.regionLabel} width={16} height={16} style={{ borderRadius: 3 }} /><span className="muted small">{props.regionLabel}</span></span>}\n        </span>',
    );
    writeFileSync("src/app/components/Overview.tsx", s);
    console.log("TopBar ok");
  }
}

// App.tsx：传 logo/region
{
  let s = readFileSync("src/app/App.tsx", "utf8");
  if (!s.includes("teamLogo=")) {
    s = s.replace(
      '        teamTag={myTeam?.tag ?? "?"}\n        teamName={myTeam?.name ?? "?"}',
      '        teamTag={myTeam?.tag ?? "?"}\n        teamName={myTeam?.name ?? "?"}\n        teamLogo={myTeam?.logo}\n        regionLabel={REGIONS.find((r) => r.id === myTeam?.regionId)?.label}\n        regionLogo={REGIONS.find((r) => r.id === myTeam?.regionId)?.logo}',
    );
    s = s.replace('import { PreMatch } from "./components/PreMatch.tsx";', 'import { PreMatch } from "./components/PreMatch.tsx";\nimport { REGIONS } from "../core/sim/day.ts";');
    writeFileSync("src/app/App.tsx", s);
    console.log("App ok");
  }
}

// Overview 积分榜：战队列加队徽
{
  let s = readFileSync("src/app/components/Overview.tsx", "utf8");
  if (!s.includes("TeamLogo team={state.teams")) {
    // 找积分榜行渲染（{i + 1} 名次 + 队名）
    const m = /(\s+)<td>\{i \+ 1\}<\/td>\n\s+<td>\{state\.teams\[e\.teamId\]\?\.name[^\n]*\n/.exec(s);
    if (m) {
      console.log("积分榜行 pattern:", JSON.stringify(m[0].slice(0, 120)));
    }
    writeFileSync("src/app/components/Overview.tmp", s);
  }
}

// MatchPlayer：记分牌双方队徽（teamA/teamB 名字渲染处）
{
  let s = readFileSync("src/app/components/MatchPlayer.tsx", "utf8");
  if (!s.includes("TeamLogo")) {
    s = s.replace('import { useStore } from "../store.ts";', 'import { useStore } from "../store.ts";\nimport { TeamLogo } from "./Avatar.tsx";');
    writeFileSync("src/app/components/MatchPlayer.tsx", s);
    console.log("MatchPlayer import ok（渲染点下一步）");
  }
}
