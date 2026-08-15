// The gym floor: one big training station per folder.
//
// Structure borrowed from base-builder games — a handful of large objects you
// can tap, each with a level badge, rather than hundreds of small ones. But the
// objects are gym equipment, not houses: a power rack, a bank of treadmills, a
// dumbbell rack, a stretch studio, a boxing ring. No walls, no roofs.
//
// Everything is stroked in near-black before it is filled. That outline is what
// makes flat canvas fills read as chunky, toy-like objects.

import { iso, shade, TW, TH } from './iso.js';

const OUTLINE = '#171012';
const GAP = 2;                      // tiles of walkway between stations
const NOM = 4;                      // sizes below are drawn for a 4-tile station

// what a folder of each kind becomes
const KIND_LOOK = {
  rack:      { wall: '#c9553f', mat: '#5e2a24', name: 'POWER RACK' },
  treadmill: { wall: '#3f9e63', mat: '#1f4a34', name: 'CARDIO BANK' },
  dumbbell:  { wall: '#3f7cb8', mat: '#1f3c5c', name: 'DUMBBELL RACK' },
  mat:       { wall: '#d0a63c', mat: '#5c4718', name: 'STRETCH STUDIO' },
  bag:       { wall: '#8a5fc0', mat: '#3d2a58', name: 'BOXING RING' },
};

const PLATE_COL = { 25: '#e8452f', 20: '#2f7fe8', 15: '#f2c53d', 10: '#46b95c', 5: '#f4f8f8', 2.5: '#39424a' };

function footprint(files) {
  if (files <= 2) return 3;
  if (files <= 6) return 4;
  if (files <= 14) return 5;
  return 6;
}

export function layoutBase(zones) {
  const buildings = [];
  zones.forEach((z, i) => {
    const files = z.equipment.length;
    const loc = z.loc || 0;
    const counts = {};
    z.equipment.forEach((e) => { counts[e.kind] = (counts[e.kind] || 0) + 1; });
    const kind = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || 'rack';
    const span = footprint(files);
    buildings.push({
      zone: z.name,
      label: z.name === '/' ? 'ROOT' : z.name.split('/').pop(),
      path: z.name === '/' ? '.' : z.name,
      files, loc, kind, span,
      level: files,
      // how loaded this station is: drives bar height, plate count, machine count
      load: Math.min(1, loc / 2200),
      look: KIND_LOOK[kind] || KIND_LOOK.rack,
      equipment: z.equipment,
      i,
    });
  });

  const order = buildings.slice().sort((a, b) => b.span - a.span);
  const shelfW = Math.max(8, Math.ceil(Math.sqrt(
    order.reduce((s, b) => s + (b.span + GAP) * (b.span + GAP), 0)) * 1.15));
  let cx = 0, cy = 0, shelfH = 0;
  order.forEach((b) => {
    if (cx > 0 && cx + b.span > shelfW) { cx = 0; cy += shelfH + GAP; shelfH = 0; }
    b.gx = cx; b.gy = cy;
    cx += b.span + GAP;
    shelfH = Math.max(shelfH, b.span);
  });

  const byPath = new Map();
  const fileByPath = new Map();
  buildings.forEach((b) => {
    b.cx = b.gx + (b.span - 1) / 2;
    b.cy = b.gy + (b.span - 1) / 2;
    b.equipment.forEach((e) => { byPath.set(e.path, b); fileByPath.set(e.path, e); });
  });

  let gx0 = 1e9, gy0 = 1e9, gx1 = -1e9, gy1 = -1e9;
  buildings.forEach((b) => {
    gx0 = Math.min(gx0, b.gx); gy0 = Math.min(gy0, b.gy);
    gx1 = Math.max(gx1, b.gx + b.span); gy1 = Math.max(gy1, b.gy + b.span);
  });
  const A = 2;
  const tiles = { gx0: gx0 - A, gy0: gy0 - A, gx1: gx1 + A, gy1: gy1 + A };

  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  [[tiles.gx0, tiles.gy0], [tiles.gx1, tiles.gy0],
   [tiles.gx0, tiles.gy1], [tiles.gx1, tiles.gy1]].forEach(([gx, gy]) => {
    const p = iso(gx, gy);
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  });
  const pad = 30, head = 110;
  return {
    buildings, byPath, fileByPath, tiles,
    bounds: { x: minX - pad, y: minY - pad - head,
              w: (maxX - minX) + pad * 2, h: (maxY - minY) + pad * 2 + head },
  };
}

// --------------------------------------------------------------- primitives

// outlined box standing on the floor: stroke the silhouette, then fill the faces
function post(ctx, x, y, w, d, h, col) {
  const hw = w / 2, hd = d / 2;
  ctx.beginPath();
  ctx.moveTo(x, y - h - hd);
  ctx.lineTo(x + hw, y - h);
  ctx.lineTo(x + hw, y);
  ctx.lineTo(x, y + hd);
  ctx.lineTo(x - hw, y);
  ctx.lineTo(x - hw, y - h);
  ctx.closePath();
  ctx.lineWidth = 2.4; ctx.strokeStyle = OUTLINE; ctx.stroke();

  ctx.beginPath();                                       // right face
  ctx.moveTo(x + hw, y - h); ctx.lineTo(x, y - h + hd);
  ctx.lineTo(x, y + hd); ctx.lineTo(x + hw, y);
  ctx.closePath(); ctx.fillStyle = shade(col, 0.6); ctx.fill();

  ctx.beginPath();                                       // left face
  ctx.moveTo(x - hw, y - h); ctx.lineTo(x, y - h + hd);
  ctx.lineTo(x, y + hd); ctx.lineTo(x - hw, y);
  ctx.closePath(); ctx.fillStyle = shade(col, 0.85); ctx.fill();

  ctx.beginPath();                                       // top face
  ctx.moveTo(x, y - h - hd); ctx.lineTo(x + hw, y - h);
  ctx.lineTo(x, y - h + hd); ctx.lineTo(x - hw, y - h);
  ctx.closePath(); ctx.fillStyle = shade(col, 1.2); ctx.fill();
}

function slab(ctx, x, y, w, d, h, col) { post(ctx, x, y, w, d, h, col); }

// a barbell seen end-on, with colour-coded plates by weight
function bar(ctx, x, y, halfLen, plates, s) {
  ctx.lineWidth = 5 * s; ctx.strokeStyle = OUTLINE;
  ctx.beginPath(); ctx.moveTo(x - halfLen, y); ctx.lineTo(x + halfLen, y); ctx.stroke();
  ctx.lineWidth = 2.6 * s; ctx.strokeStyle = '#d3dbe1';
  ctx.beginPath(); ctx.moveTo(x - halfLen, y); ctx.lineTo(x + halfLen, y); ctx.stroke();

  let off = 0;
  plates.slice(0, 6).forEach((p) => {
    const r = (5 + (p / 25) * 8) * s;
    [-1, 1].forEach((dir) => {
      const px = x + dir * (halfLen - 4 * s - off);
      ctx.fillStyle = OUTLINE;
      ctx.beginPath(); ctx.ellipse(px, y, 2.8 * s, r + 1.4 * s, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = PLATE_COL[p] || '#8a97a0';
      ctx.beginPath(); ctx.ellipse(px, y, 1.9 * s, r, 0, 0, Math.PI * 2); ctx.fill();
    });
    off += 4.4 * s;
  });
}

// ------------------------------------------------------------- the stations

function drawPowerRack(ctx, b) {
  const load = b.load;
  const upH = 44 + load * 26;
  slab(ctx, 0, 6, 84, 42, 5, '#7a5c3a');                 // lifting platform
  ctx.fillStyle = 'rgba(0,0,0,.14)';
  ctx.fillRect(-26, -2, 52, 3);

  [[-30, -10], [30, -10]].forEach(([px, py]) => post(ctx, px, py, 9, 9, upH, '#4e5a66'));
  [[-30, 12], [30, 12]].forEach(([px, py]) => post(ctx, px, py, 9, 9, upH - 6, '#3f4a55'));

  ctx.lineWidth = 5; ctx.strokeStyle = OUTLINE;          // top crossbar
  ctx.beginPath(); ctx.moveTo(-30, -10 - upH); ctx.lineTo(30, -10 - upH); ctx.stroke();
  ctx.lineWidth = 3; ctx.strokeStyle = '#5d6a76';
  ctx.beginPath(); ctx.moveTo(-30, -10 - upH); ctx.lineTo(30, -10 - upH); ctx.stroke();

  ctx.fillStyle = shade(b.look.wall, 1.05);              // branded uprights
  ctx.fillRect(-34, -10 - upH + 14, 8, 5);
  ctx.fillRect(26, -10 - upH + 14, 8, 5);

  const kg = 20 + load * 380;                            // the loaded bar
  const plates = [];
  let per = (kg - 20) / 2;
  [25, 20, 15, 10, 5, 2.5].forEach((p) => { while (per >= p - 1e-9) { plates.push(p); per -= p; } });
  bar(ctx, 0, -10 - upH * 0.55, 40, plates, 1);

  post(ctx, 44, 10, 12, 12, 20, '#3f4a55');              // plate tree
  [0, 1, 2].forEach((i) => {
    ctx.fillStyle = OUTLINE;
    ctx.beginPath(); ctx.ellipse(44, -4 - i * 7, 4.4, 8.4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = [PLATE_COL[25], PLATE_COL[20], PLATE_COL[15]][i];
    ctx.beginPath(); ctx.ellipse(44, -4 - i * 7, 3, 7, 0, 0, Math.PI * 2); ctx.fill();
  });
}

function drawCardioBank(ctx, b, t) {
  const n = Math.max(1, Math.min(4, b.files));
  for (let i = 0; i < n; i++) {
    const ox = -26 + i * (52 / Math.max(1, n - 1 || 1)) * (n > 1 ? 1 : 0);
    const oy = -14 + i * 9;
    const x = n > 1 ? ox : 0;
    slab(ctx, x, oy + 10, 46, 24, 6, '#c4ccd4');         // frame
    ctx.beginPath();                                      // belt
    ctx.moveTo(x, oy + 4 - 11); ctx.lineTo(x + 22, oy + 4);
    ctx.lineTo(x, oy + 4 + 11); ctx.lineTo(x - 22, oy + 4);
    ctx.closePath();
    ctx.fillStyle = '#2b333b'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = OUTLINE; ctx.stroke();
    ctx.save(); ctx.clip();                               // tread lines
    ctx.strokeStyle = '#47525c'; ctx.lineWidth = 1.5;
    for (let k = 0; k < 7; k++) {
      const tt = ((k * 6 + (t || 0) * 20) % 44) - 22;
      ctx.beginPath();
      ctx.moveTo(x + tt, oy + 4 - 11 + Math.abs(tt) * 0.5);
      ctx.lineTo(x + tt + 10, oy + 4 - 6 + Math.abs(tt) * 0.5);
      ctx.stroke();
    }
    ctx.restore();
    post(ctx, x + 17, oy + 2, 7, 7, 26, '#c4ccd4');       // console mast
    post(ctx, x + 14, oy - 24, 16, 9, 9, '#333c45');
    ctx.fillStyle = '#ffb020';
    ctx.fillRect(x + 8, oy - 36, 11, 5);
  }
}

function drawDumbbellRack(ctx, b) {
  slab(ctx, 0, 8, 88, 40, 4, '#333c45');                 // base
  const tiers = 2;
  for (let tier = 0; tier < tiers; tier++) {
    const ty = -2 - tier * 15;
    post(ctx, 0, ty + 8, 84, 22, 5, '#46525d');          // shelf
    const pairs = Math.max(2, Math.min(5, Math.ceil(b.files / (tier + 1))));
    for (let i = 0; i < pairs; i++) {
      const dx = -32 + i * (64 / Math.max(1, pairs - 1));
      const dy = ty - 2;
      ctx.lineWidth = 4; ctx.strokeStyle = OUTLINE;
      ctx.beginPath(); ctx.moveTo(dx - 7, dy); ctx.lineTo(dx + 7, dy); ctx.stroke();
      ctx.lineWidth = 2; ctx.strokeStyle = '#d3dbe1';
      ctx.beginPath(); ctx.moveTo(dx - 7, dy); ctx.lineTo(dx + 7, dy); ctx.stroke();
      const col = tier === 0 ? shade(b.look.wall, 1.05) : '#5d6a76';
      [-9, 7].forEach((ex) => {
        ctx.fillStyle = OUTLINE;
        ctx.fillRect(dx + ex - 1, dy - 6, 5, 12);
        ctx.fillStyle = col;
        ctx.fillRect(dx + ex, dy - 5, 3, 10);
      });
    }
  }
}

function drawStudio(ctx, b) {
  // A low mirror at the back edge, framed and clearly reflective. The first
  // version was a 40-unit slab that read as an unfinished white box.
  const mirrorH = 24;
  post(ctx, -4, -20, 58, 7, mirrorH, '#7d8892');          // frame
  ctx.beginPath();                                        // glass, inset
  ctx.moveTo(-25, -20 - mirrorH + 5);
  ctx.lineTo(25, -20 - mirrorH + 9);
  ctx.lineTo(25, -22);
  ctx.lineTo(-25, -26);
  ctx.closePath();
  const g = ctx.createLinearGradient(-25, -46, 25, -20);
  g.addColorStop(0, '#dfeaef');
  g.addColorStop(0.5, '#b6ccd6');
  g.addColorStop(1, '#cfdde4');
  ctx.fillStyle = g; ctx.fill();
  ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.stroke();

  [[-16, 8], [14, 16], [-2, 24]].slice(0, Math.max(1, Math.min(3, b.files))).forEach(([mx, my], i) => {
    ctx.beginPath();                                      // mats on the floor
    ctx.moveTo(mx, my - 11); ctx.lineTo(mx + 22, my);
    ctx.lineTo(mx, my + 11); ctx.lineTo(mx - 22, my);
    ctx.closePath();
    ctx.fillStyle = shade(b.look.wall, i === 0 ? 1.15 : 0.92); ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = OUTLINE; ctx.stroke();
  });

  ctx.fillStyle = OUTLINE;                                // exercise ball
  ctx.beginPath(); ctx.ellipse(33, 4, 11, 11, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = shade(b.look.wall, 1.3);
  ctx.beginPath(); ctx.ellipse(33, 3, 9.2, 9.2, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.4)';
  ctx.beginPath(); ctx.ellipse(30, 0, 3, 3, 0, 0, Math.PI * 2); ctx.fill();

  post(ctx, -34, 12, 20, 8, 7, '#5d6a76');                // foam roller
}

function drawRing(ctx, b) {
  slab(ctx, 0, 10, 92, 46, 12, '#5a6470');                // raised canvas
  ctx.beginPath();
  ctx.moveTo(0, -2 - 22); ctx.lineTo(44, -2);
  ctx.lineTo(0, -2 + 22); ctx.lineTo(-44, -2);
  ctx.closePath();
  ctx.fillStyle = '#e6e9ec'; ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = OUTLINE; ctx.stroke();
  ctx.fillStyle = shade(b.look.wall, 1.1);                // centre logo
  ctx.beginPath(); ctx.ellipse(0, -2, 13, 6.5, 0, 0, Math.PI * 2); ctx.fill();

  const corners = [[0, -24], [44, -2], [0, 20], [-44, -2]];
  corners.forEach(([px, py]) => post(ctx, px, py, 8, 8, 34, shade(b.look.wall, 0.8)));
  [10, 20, 30].forEach((h) => {                           // ropes
    ctx.lineWidth = 2.4; ctx.strokeStyle = '#f2f6f8';
    ctx.beginPath();
    corners.forEach(([px, py], i) => {
      if (i === 0) ctx.moveTo(px, py - h); else ctx.lineTo(px, py - h);
    });
    ctx.closePath(); ctx.stroke();
  });
}

const STATE_RING = { active: '#ffb020', dirty: '#5ac8e8', broken: '#ff5a3c' };

export function drawBuilding(ctx, b, opts) {
  const o = opts || {};
  const p = iso(b.cx, b.cy);
  const s = b.span / NOM;
  const hw = (b.span * TW) / 2 - 3;
  const hd = (b.span * TH) / 2 - 2;

  ctx.save();
  ctx.globalAlpha = 0.3;                                  // shadow under the pad
  ctx.fillStyle = '#3a2f22';
  ctx.beginPath();
  ctx.ellipse(p.x + 4, p.y + 4, hw, hd * 1.1, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.beginPath();                                        // rubber pad
  ctx.moveTo(p.x, p.y - hd); ctx.lineTo(p.x + hw, p.y);
  ctx.lineTo(p.x, p.y + hd); ctx.lineTo(p.x - hw, p.y);
  ctx.closePath();
  ctx.fillStyle = o.hover ? shade(b.look.mat, 1.35) : b.look.mat;
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = shade(b.look.wall, o.hover ? 1.3 : 0.95);
  ctx.stroke();

  if (o.ring) {                                           // status ring
    ctx.strokeStyle = STATE_RING[o.ring] || STATE_RING.active;
    ctx.lineWidth = 3;
    ctx.setLineDash(o.ring === 'active' ? [] : [6, 5]);
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + 2, hw + 5, hd + 5, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.scale(s, s);
  if (b.kind === 'treadmill') drawCardioBank(ctx, b, o.t);
  else if (b.kind === 'dumbbell') drawDumbbellRack(ctx, b);
  else if (b.kind === 'mat') drawStudio(ctx, b);
  else if (b.kind === 'bag') drawRing(ctx, b);
  else drawPowerRack(ctx, b);
  ctx.restore();
}

// how tall this station stands, for placing its sign in screen space
function stationHeight(b) {
  const s = b.span / NOM;
  const nominal = { rack: 78 + b.load * 26, treadmill: 60, dumbbell: 44, mat: 62, bag: 52 };
  return (nominal[b.kind] || 70) * s;
}

export function buildingAnchor(b) {
  const p = iso(b.cx, b.cy);
  return { x: p.x, y: p.y - stationHeight(b) - 10 };
}

// Hit the whole station, not a circle round its pad: these stand tall, so a
// pad-only target leaves the top of every rack dead. Front to back, so the
// nearer station wins wherever two overlap.
export function hitBuilding(view, wx, wy) {
  const order = view.buildings.slice().sort((a, b) => (b.gx + b.gy) - (a.gx + a.gy));
  for (let i = 0; i < order.length; i++) {
    const b = order[i];
    const p = iso(b.cx, b.cy);
    const hw = (b.span * TW) / 2;
    const hd = (b.span * TH) / 2;
    if (wx >= p.x - hw && wx <= p.x + hw
        && wy >= p.y - stationHeight(b) - 10 && wy <= p.y + hd + 4) return b;
  }
  return null;
}

export { KIND_LOOK };
