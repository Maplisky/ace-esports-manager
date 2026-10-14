/**
 * vlr.gg 数据爬取（v0.7 真实数据包）：四大赛区队伍 → roster → 选手统计(?timespan=all) → 头像下载
 * 产出：src/core/data/real/vlr-teams.json / vlr-players.json + public/assets/{teams,players}/*.png
 * 用法：node tools/crawl-vlr.mjs [--only-meta]（跳过选手页与头像，只刷队伍层）
 */
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const CONCURRENCY = 5;
const DELAY_MS = 180;

/** 大区子区配额（贴近 VCT 联赛名额分布） */
/** 候选配额：抓取量 > 最终名额（16/区），team 页判定合作身份后：合作队全取 + 挑战者按排名补足 */
const REGION_PLAN = {
  americas: [["north-america", 12], ["brazil", 7], ["la-n", 4], ["la-s", 4]],
  emea: [["europe", 24]],
  pacific: [["asia-pacific", 12], ["korea", 7], ["japan", 4]],
  china: [["china", 16]],
};
const FINAL_PER_REGION = 16;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url, tries = 3, timeoutMs = 25_000) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(800 * (i + 1));
    }
  }
  return "";
}

async function download(url, dest) {
  if (existsSync(dest)) return true;
  try {
    const fixed = url.startsWith("//") ? `https:${url}` : url.startsWith("/") ? `https://www.vlr.gg${url}` : url;
    const res = await fetch(fixed, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(25_000) });
    if (!res.ok) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 200) return false;
    await writeFile(dest, buf);
    return true;
  } catch {
    return false;
  }
}

const decode = (s) =>
  s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();

/** 从队伍全名生成 2-4 字母 tag */
function tagOf(name) {
  const words = name.replace(/[^A-Za-z0-9 ]/g, "").split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words.map((w) => w[0]).join("").slice(0, 4).toUpperCase();
}

/** 解析一个子区 rankings 页 → [{vlrId, slug, name, logo, country, rank, rating}]（子区页为 div 结构） */
function parseRankings(html) {
  const rows = [];
  const itemRe = /<div class="rank-item wf-card fc-flex">[\s\S]*?(?=<div class="rank-item wf-card fc-flex">|<\/div>\s*<\/div>\s*<\/div>\s*<\/div>)/g;
  let m;
  while ((m = itemRe.exec(html))) {
    const item = m[0];
    const teamM = /<a href="\/team\/(\d+)\/([a-z0-9-]+)"[^>]*class="rank-item-team[^"]*">[\s\S]*?<img src="([^"]+)" alt="([^"]+)">[\s\S]*?rank-item-team-country">([^<]*)</.exec(item);
    if (!teamM) continue;
    const rankM = /rank-item-rank-num">\s*(\d+)/.exec(item);
    const ratingM = /data-sort-value="([\d.]+)" class="rank-item-rating"/.exec(item) ?? /rank-item-rating">\s*([\d.]+)/.exec(item);
    rows.push({
      vlrId: Number(teamM[1]),
      slug: teamM[2],
      name: decode(teamM[4]),
      logo: teamM[3],
      country: decode(teamM[5]),
      rank: rankM ? Number(rankM[1]) : 999,
      rating: ratingM ? Number(ratingM[1]) : 0,
    });
  }
  return rows;
}

/** 解析 team 页 roster：按 Current Roster 的模块分节（players / staff）——staff 带 role 标签 */
function parseRoster(html) {
  const players = [];
  const staff = [];
  // 截取 Current Roster 之后的部分
  const rosterIdx = html.indexOf("Current\tRoster") >= 0 ? html.indexOf("Current\tRoster") : html.indexOf("Current Roster");
  const section = rosterIdx >= 0 ? html.slice(rosterIdx) : html;
  // 按模块（players/staff）切块
  const moduleRe = /<div class="wf-module-label"[^>]*>\s*(players|staff|coach(?:es)?)\s*<\/div>([\s\S]*?)(?=<div class="wf-module-label"|<\/div>\s*<\/div>\s*<\/div>\s*<|$)/g;
  let mod;
  while ((mod = moduleRe.exec(section))) {
    const kind = mod[1];
    const block = mod[2];
    const itemRe = /<div class="team-roster-item">[\s\S]*?<\/div>\s*<\/a>/g;
    let m;
    while ((m = itemRe.exec(block))) {
      const item = m[0];
      const linkM = /<a href="\/player\/(\d+)\/([a-z0-9-]+)"/.exec(item);
      if (!linkM) continue;
      const imgM = /<img src="([^"]+)"/.exec(item);
      const aliasM = /team-roster-item-name-alias">\s*(?:<i[^>]*><\/i>)?\s*([^<]+?)\s*<\/div>/.exec(item);
      const realM = /team-roster-item-name-real">\s*([^<]*?)\s*<\/div>/.exec(item);
      const flagM = /<i class="flag mod-([a-z-]+)"/.exec(item);
      const roleM = /team-roster-item-name-role">\s*([^<]*?)\s*<\/div>/.exec(item);
      const entry = {
        vlrId: Number(linkM[1]),
        slug: linkM[2],
        alias: decode(aliasM?.[1] ?? linkM[2]),
        real: decode(realM?.[1] ?? ""),
        country: flagM?.[1] ?? "",
        avatar: imgM?.[1] ?? "",
        role: roleM ? decode(roleM[1]).toLowerCase() : "",
        captain: item.includes('title="Team Captain"'),
      };
      if (kind === "players" || !entry.role) players.push(entry);
      else staff.push(entry);
    }
  }
  return { players, staff };
}

/** team 页页头：官方 tag + 合作队判定（铁证：VCT 联赛或冠军赛；挑战者页两者皆无） */
function parseTeamMeta(html) {
  const tagM = /team-header-tag">\s*([^<]+?)\s*<\/h2>/.exec(html);
  const vctLeague = /VCT \d{2}: [A-Za-z]/.test(html) || /Valorant Champions 20\d\d/.test(html);
  return { officialTag: tagM ? decode(tagM[1]).toUpperCase() : "", partnered: vctLeague };
}

/** 解析 player 页 ?timespan=all 的按英雄统计表 */
function parseAgentStats(html) {
  const tableM = /<table class="st-table mod-agent-rows"[\s\S]*?<\/table>/.exec(html);
  if (!tableM) return { agents: [] };
  const rows = [];
  const trRe = /<tr>\s*<td class="mod-agent">[\s\S]*?<\/tr>/g;
  let m;
  while ((m = trRe.exec(tableM[0]))) {
    const tr = m[0];
    const agentM = /alt="([a-z-]+)"/.exec(tr);
    const tds = [...tr.matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map((x) => decode(x[1]));
    // 列序：Use("(6) 38%") Rnd R ACS K:D KAST ADR KPR APR FK:FD K D A FK FD
    const useM = /\((\d+)\)/.exec(tds[0] ?? "");
    rows.push({
      agent: agentM?.[1] ?? "?",
      maps: useM ? Number(useM[1]) : 0,
      rounds: Number(tds[1] ?? 0),
      rating: Number(tds[2] ?? 0),
      acs: Number(tds[3] ?? 0),
      kd: Number(tds[4] ?? 0),
      kast: Number((tds[5] ?? "0%").replace("%", "")),
      adr: Number(tds[6] ?? 0),
      kpr: Number(tds[7] ?? 0),
      apr: Number(tds[8] ?? 0),
      fk: Number(tds[13] ?? 0),
      fd: Number(tds[14] ?? 0),
    });
  }
  return { agents: rows.filter((r) => r.rounds > 0) };
}

/** 简易并发池 */
async function pool(items, workerFn, size = CONCURRENCY) {
  const queue = [...items];
  const failures = [];
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (queue.length) {
        const item = queue.shift();
        try {
          await workerFn(item);
        } catch (e) {
          failures.push({ item, error: String(e) });
        }
        await sleep(DELAY_MS);
      }
    }),
  );
  return failures;
}

async function main() {
  const onlyMeta = process.argv.includes("--only-meta");
  await mkdir(path.join(ROOT, "src/core/data/real"), { recursive: true });
  await mkdir(path.join(ROOT, "public/assets/teams"), { recursive: true });
  await mkdir(path.join(ROOT, "public/assets/players"), { recursive: true });
  await mkdir(path.join(ROOT, "public/assets/regions"), { recursive: true });

  // ① 子区 rankings
  const subRegionPages = [...new Set(Object.values(REGION_PLAN).flat().map(([s]) => s))];
  const subRankings = {};
  await pool(subRegionPages, async (sub) => {
    const html = await fetchText(`https://www.vlr.gg/rankings/${sub}`, 3, 90_000);
    subRankings[sub] = parseRankings(html);
    console.log(`rankings/${sub}: ${subRankings[sub].length} 队`);
  }, 4);

  // ② 按配额合成四大赛区各 16 队
  const teams = [];
  for (const [region, plan] of Object.entries(REGION_PLAN)) {
    for (const [sub, quota] of plan) {
      for (const row of (subRankings[sub] ?? []).slice(0, quota)) {
        teams.push({ ...row, region });
      }
    }
  }
  const seen = new Set();
  const deduped = teams.filter((t) => (seen.has(t.vlrId) ? false : (seen.add(t.vlrId), true)));
  console.log(`四大赛区合计 ${deduped.length} 队`);

  // ③ team 页 → roster（players/staff 分节）+ 官方 tag + 合作队判定 + 教练
  await pool(deduped, async (t) => {
    const html = await fetchText(`https://www.vlr.gg/team/${t.vlrId}/${t.slug}`);
    const { players: rosterPlayers, staff } = parseRoster(html);
    t.roster = rosterPlayers.slice(0, 7);
    t.staff = staff;
    const meta = parseTeamMeta(html);
    t.officialTag = meta.officialTag;
    t.partnered = meta.partnered;
    t.logoLocal = (await download(t.logo, path.join(ROOT, `public/assets/teams/${t.vlrId}.png`))) ? `assets/teams/${t.vlrId}.png` : null;
    for (const s of staff) {
      await download(s.avatar, path.join(ROOT, `public/assets/players/${s.vlrId}.png`));
    }
    console.log(`team ${t.name}: roster ${t.roster.length}, staff ${staff.length}, tag ${meta.officialTag || "-"}, ${meta.partnered ? "VCT" : "挑战者"}`);
  });
  const missingRoster = deduped.filter((t) => !t.roster || t.roster.length === 0);
  if (missingRoster.length) console.warn(`⚠ ${missingRoster.length} 队 roster 为空: ${missingRoster.map((t) => t.name).join(", ")}`);
  const vctCount = deduped.filter((t) => t.partnered).length;
  console.log(`合作队 ${vctCount} / ${deduped.length}`);

  // 名额定版：每区 = 全部合作队 + 非合作队按子区排名补足 16
  const finalTeams = [];
  for (const region of Object.keys(REGION_PLAN)) {
    const rs = deduped.filter((t) => t.region === region);
    const vct = rs.filter((t) => t.partnered);
    const challengers = rs.filter((t) => !t.partnered).sort((a, b) => a.rank - b.rank);
    const take = [...vct, ...challengers].slice(0, Math.max(FINAL_PER_REGION, vct.length));
    finalTeams.push(...take);
    console.log(`${region}: VCT ${vct.length} + 挑战者 ${take.length - vct.length} = ${take.length}`);
  }

  // ④ player 页统计 + 头像
  const players = [];
  if (!onlyMeta) {
    const allP = finalTeams.flatMap((t) => (t.roster ?? []).map((p) => ({ ...p, teamVlrId: t.vlrId })));
    await pool(allP, async (p) => {
      const html = await fetchText(`https://www.vlr.gg/player/${p.vlrId}/${p.slug}?timespan=all`);
      const { agents } = parseAgentStats(html);
      p.stats = agents;
      p.avatarLocal = (await download(p.avatar, path.join(ROOT, `public/assets/players/${p.vlrId}.png`))) ? `assets/players/${p.vlrId}.png` : null;
      players.push(p);
      console.log(`player ${p.alias}: ${agents.length} 英雄`);
    });
  }

  // ⑤ 输出（staff: role=coach 为主教练，其余为助教组；Inactive 选手保留供市场，不进首发优先）
  const coachOf = (staff) =>
    (staff ?? []).find((s) => s.role === "coach") ?? (staff ?? []).find((s) => /coach/.test(s.role)) ?? null;
  const teamsOut = finalTeams.map((t) => {
    const head = coachOf(t.staff);
    const assistants = (t.staff ?? []).filter((s) => s !== head && /coach|analyst/.test(s.role));
    return {
      vlrId: t.vlrId, slug: t.slug, name: t.name,
      tag: t.officialTag || tagOf(t.name), region: t.region,
      country: t.country, rank: t.rank, rating: t.rating, logo: t.logoLocal,
      partnered: !!t.partnered,
      coach: head ? { alias: head.alias, real: head.real, country: head.country, avatar: `assets/players/${head.vlrId}.png` } : null,
      staff: assistants.slice(0, 3).map((s) => ({ alias: s.alias, role: s.role, avatar: `assets/players/${s.vlrId}.png` })),
      roster: (t.roster ?? []).map((p) => p.vlrId),
    };
  });
  const playersOut = players.map((p) => ({
    vlrId: p.vlrId, teamVlrId: p.teamVlrId, alias: p.alias, real: p.real, country: p.country,
    avatar: p.avatarLocal, captain: p.captain, stats: p.stats,
  }));
  await writeFile(path.join(ROOT, "src/core/data/real/vlr-teams.json"), JSON.stringify(teamsOut, null, 1));
  await writeFile(path.join(ROOT, "src/core/data/real/vlr-players.json"), JSON.stringify(playersOut, null, 1));
  const withStats = playersOut.filter((p) => p.stats.length > 0).length;
  console.log(`✅ 队伍 ${teamsOut.length}，选手 ${playersOut.length}（有统计 ${withStats}，无统计将走虚拟生成）`);
}

main().catch((e) => {
  console.error("爬取失败:", e);
  process.exit(1);
});
