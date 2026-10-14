// 逐图标定预览生成器：node gen-map-preview.mjs [mapId] → dist/maps-preview.html
import { GEN_ZONES } from './src/core/data/mapplans.zones.ts';
import { positionFor } from './src/core/data/mapplans.ts';
import { writeFileSync } from 'node:fs';
const DUTIES = ['duelist', 'initiator', 'controller', 'sentinel', 'flex'];
const only = process.argv[2] ?? null;
const colors = { site: '#e8c15a', spawnA: '#4ade80', spawnB: '#60a5fa', mid: '#8b7cf6', lane: '#6b7280' };
let html = '<html><body style="background:#111;color:#eee;font-family:monospace"><div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;padding:10px">';
for (const [id, zones] of Object.entries(GEN_ZONES)) {
  if (only && id !== only) continue;
  html += '<div><div style="text-align:center;font-size:14px">' + id + '</div><svg viewBox="0 0 400 400" style="width:100%;background:#000">';
  html += '<image href="assets/maps/' + id + '.png" x="0" y="0" width="400" height="400" opacity="0.95"/>';
  for (const z of zones) {
    const c = colors[z.kind] ?? '#888';
    html += '<rect x="' + z.x + '" y="' + z.y + '" width="' + z.w + '" height="' + z.h + '" fill="none" stroke="' + c + '" stroke-width="1.2" opacity="0.85" rx="4"/>';
    if (z.kind === 'site' && z.label) html += '<text x="' + (z.x + 4) + '" y="' + (z.y + 13) + '" fill="' + c + '" font-size="12" font-weight="700">' + z.label + '</text>';
    if (z.kind === 'spawnA') html += '<text x="' + (z.x + z.w / 2) + '" y="' + (z.y + z.h / 2) + '" fill="#4ade80" font-size="11" text-anchor="middle">进攻</text>';
    if (z.kind === 'spawnB') html += '<text x="' + (z.x + z.w / 2) + '" y="' + (z.y + z.h / 2) + '" fill="#60a5fa" font-size="11" text-anchor="middle">防守</text>';
    if (z.kind === 'mid') html += '<text x="' + (z.x + z.w / 2) + '" y="' + (z.y + 12) + '" fill="#8b7cf6" font-size="10" text-anchor="middle">中路</text>';
  }
  const draw = (tactic, isAtk, color, roundN) => {
    DUTIES.forEach((duty, i) => {
      const p = positionFor(id, { duty, isAttacking: isAtk, roundN, pid: duty + i, side: isAtk ? 'bottom' : 'top', tactic, slot: i });
      html += '<circle cx="' + p.x + '" cy="' + p.y + '" r="8" fill="' + color + '" stroke="#000" opacity="0.9"/>';
    });
  };
  draw('atk:default', true, '#4ade80', 4);
  draw('def:standard', false, '#60a5fa', 4);
  draw('atk:rush:A', true, '#fb9234', 9);
  html += '</svg></div>';
}
html += '</div></body></html>';
writeFileSync('dist/maps-preview.html', html);
console.log('preview:', only ?? 'all');
