// Ground, scenery and equipment sprites.
//
// Art direction: bright, saturated, toy-like. Every solid is a three-faced box
// shaded from one base colour, which is what makes flat canvas fills read as
// chunky objects instead of line art.
//
// The ground is baked once into a world-space canvas and the camera blits a
// window of it. Buildings live in building.js; the equipment sprites here are
// used by the arena close-up, where one file is shown at readable size.

export const TW = 32, TH = 16;            // tile footprint in buffer pixels

export function iso(gx, gy) {
  return { x: (gx - gy) * (TW / 2), y: (gx + gy) * (TH / 2) };
}

// ------------------------------------------------------------------ colour

// Accepts "#rrggbb" and its own "rgb(r,g,b)" output. Hex-only was a trap: a
// shaded colour fed back in parsed to NaN, canvas silently kept the previous
// fillStyle, and hovered buildings rendered with black faces.
function shade(color, f) {
  let r, g, b;
  if (typeof color === 'string' && color[0] === '#') {
    const n = parseInt(color.slice(1), 16);
    r = (n >> 16) & 255; g = (n >> 8) & 255; b = n & 255;
  } else {
    const m = /rgba?\(([^)]+)\)/.exec(String(color));
    if (!m) return String(color);
    const parts = m[1].split(',').map((v) => parseFloat(v));
    r = parts[0]; g = parts[1]; b = parts[2];
  }
  const t = (v) => Math.max(0, Math.min(255,
    Math.round(f < 1 ? v * f : v + (255 - v) * (f - 1))));
  return `rgb(${t(r)},${t(g)},${t(b)})`;
}

const PAL = {
  ground: '#6f7780',           // concrete beyond the sprung floor
  floor: '#d8c7a4',            // light sports-hall floor
  floorAlt: '#d0bd98',
  floorEdge: '#b8a681',
  line: '#e8b34a',             // painted court lines
  steel: '#aebac4',
  rubber: '#3c4650',
  amber: '#ffb020',
  chalk: '#fdfbf4',
  plate: { 25: '#e8452f', 20: '#2f7fe8', 15: '#f2c53d', 10: '#46b95c', 5: '#f4f8f8', 2.5: '#39424a' },
};

// --------------------------------------------------------------- primitives

function diamond(ctx, x, y, fill) {
  ctx.beginPath();
  ctx.moveTo(x, y - TH / 2);
  ctx.lineTo(x + TW / 2, y);
  ctx.lineTo(x, y + TH / 2);
  ctx.lineTo(x - TW / 2, y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

// A solid standing on the grid. Faces shade from one colour: top brightest,
// left mid, right darkest - the whole reason these read as objects.
function box3(ctx, x, y, w, d, h, color) {
  const hw = w / 2, hd = d / 2;
  ctx.beginPath();                                   // right face (darkest)
  ctx.moveTo(x + hw, y - h);
  ctx.lineTo(x, y - h + hd);
  ctx.lineTo(x, y + hd);
  ctx.lineTo(x + hw, y);
  ctx.closePath();
  ctx.fillStyle = shade(color, 0.58);
  ctx.fill();
  ctx.beginPath();                                   // left face
  ctx.moveTo(x - hw, y - h);
  ctx.lineTo(x, y - h + hd);
  ctx.lineTo(x, y + hd);
  ctx.lineTo(x - hw, y);
  ctx.closePath();
  ctx.fillStyle = shade(color, 0.78);
  ctx.fill();
  ctx.beginPath();                                   // top face (brightest)
  ctx.moveTo(x, y - h - hd);
  ctx.lineTo(x + hw, y - h);
  ctx.lineTo(x, y - h + hd);
  ctx.lineTo(x - hw, y - h);
  ctx.closePath();
  ctx.fillStyle = shade(color, 1.18);
  ctx.fill();
}

function shadow(ctx, x, y, rx, ry) {
  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = '#4a3a26';                         // warm, not black
  ctx.beginPath();
  ctx.ellipse(x, y + 2, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// a weight plate seen edge-on: chunky disc with a darker rim
function plate(ctx, x, y, kg, scale) {
  const r = (5 + (kg / 25) * 8) * (scale || 1);
  const w = 3 * (scale || 1);
  const col = PAL.plate[kg] || PAL.steel;
  ctx.fillStyle = shade(col, 0.6);
  ctx.beginPath();
  ctx.ellipse(x, y, w, r, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.ellipse(x - w * 0.25, y, w * 0.7, r * 0.86, 0, 0, Math.PI * 2);
  ctx.fill();
}

// ------------------------------------------------------------- equipment

function drawRack(ctx, x, y, e) {
  const kg = e.kg || 20;
  shadow(ctx, x, y, 20, 10);
  box3(ctx, x, y, 30, 16, 4, '#6b5236');                    // lifting platform

  // Height encodes size, the way building height did in the city this borrows
  // from: a 2000-line module towers over a 40-line helper, so the floor has a
  // skyline you can read at a glance.
  // 30 units is about shoulder height on the athlete sprite (~36 tall), so even
  // the lightest rack reads as gym-sized and a 400kg bar towers over the lifter
  const upH = 30 + (Math.min(kg, 400) / 400) * 30;
  box3(ctx, x - 12, y - 2, 6, 6, upH, '#59636e');            // neutral uprights,
  box3(ctx, x + 12, y - 2, 6, 6, upH, '#59636e');            // plates carry colour
  ctx.fillStyle = shade(e.tint || '#2f8f8f', 1.1);           // zone collar
  ctx.fillRect(x - 15, y - upH + 6, 6, 3);
  ctx.fillRect(x + 9, y - upH + 6, 6, 3);

  const barY = y - upH + 2;                                  // the loaded bar
  ctx.fillStyle = shade(PAL.steel, 0.7);
  ctx.fillRect(x - 22, barY - 1, 44, 4);
  ctx.fillStyle = shade(PAL.steel, 1.25);
  ctx.fillRect(x - 22, barY - 1, 44, 2);

  const stack = e.plates || [];
  let off = 0;
  stack.slice(0, 6).forEach((p) => {
    plate(ctx, x - 15 - off, barY + 1, p, 1);
    plate(ctx, x + 15 + off, barY + 1, p, 1);
    off += 4;
  });
  if (kg >= 200) {                                           // heavy bar sags
    ctx.fillStyle = 'rgba(0,0,0,.18)';
    ctx.fillRect(x - 8, barY + 3, 16, 1);
  }
}

function drawTreadmill(ctx, x, y, phase) {
  shadow(ctx, x, y, 18, 9);
  box3(ctx, x, y, 28, 15, 5, '#c9cfd6');                     // frame
  const deckY = y - 5;
  ctx.beginPath();                                            // belt
  ctx.moveTo(x, deckY - 7.5);
  ctx.lineTo(x + 14, deckY);
  ctx.lineTo(x, deckY + 7.5);
  ctx.lineTo(x - 14, deckY);
  ctx.closePath();
  ctx.fillStyle = PAL.rubber;
  ctx.fill();
  ctx.save();                                                 // tread lines
  ctx.clip();
  ctx.strokeStyle = shade(PAL.rubber, 1.5);
  ctx.lineWidth = 1;
  for (let i = 0; i < 8; i++) {
    const t = ((i * 4 + (phase || 0) * 12) % 32) - 16;
    ctx.beginPath();
    ctx.moveTo(x + t, deckY - 8 + Math.abs(t) * 0.5);
    ctx.lineTo(x + t + 7, deckY - 4.5 + Math.abs(t) * 0.5);
    ctx.stroke();
  }
  ctx.restore();
  box3(ctx, x + 11, y - 4, 5, 5, 16, '#c9cfd6');              // console post
  box3(ctx, x + 9, y - 19, 11, 6, 6, '#3a4450');
  ctx.fillStyle = phase > 1 ? PAL.amber : '#6f8f96';          // display
  ctx.fillRect(x + 5, y - 27, 7, 3);
}

function drawDumbbell(ctx, x, y, e) {
  shadow(ctx, x, y, 17, 8);
  box3(ctx, x, y, 26, 13, 8, '#3a4450');                      // A-frame rack
  for (let i = 0; i < 3; i++) {
    const dy = y - 8 - i * 5, dx = -7 + i * 2;
    ctx.fillStyle = shade(PAL.steel, 1.2);
    ctx.fillRect(x + dx - 6, dy - 1.5, 12, 3);
    const col = i === 0 ? (e.tint || '#c06a2f') : shade(PAL.steel, 0.75);
    ctx.fillStyle = col;
    ctx.fillRect(x + dx - 9, dy - 3.5, 3, 7);
    ctx.fillRect(x + dx + 6, dy - 3.5, 3, 7);
  }
}

function drawMat(ctx, x, y, e) {
  const col = e.tint || '#7a52c0';
  ctx.save();                                                  // mat on floor
  ctx.beginPath();
  ctx.moveTo(x, y - 8);
  ctx.lineTo(x + 16, y);
  ctx.lineTo(x, y + 8);
  ctx.lineTo(x - 16, y);
  ctx.closePath();
  ctx.fillStyle = shade(col, 1.1);
  ctx.fill();
  ctx.strokeStyle = shade(col, 0.7);
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
  box3(ctx, x + 6, y + 2, 9, 5, 5, shade(col, 0.85));          // rolled mat
}

function drawBag(ctx, x, y, sway) {
  shadow(ctx, x, y, 11, 6);
  const upH = 34;
  box3(ctx, x - 9, y, 5, 5, upH, '#5b6672');                   // frame
  ctx.fillStyle = shade('#5b6672', 1.1);
  ctx.fillRect(x - 11, y - upH, 18, 3);
  const s = (sway || 0) * 2.5;
  box3(ctx, x + 5 + s, y - upH + 22, 11, 8, 20, '#8a4a32');    // hanging bag
  ctx.fillStyle = 'rgba(255,255,255,.14)';
  ctx.fillRect(x + 1 + s, y - upH + 6, 3, 14);
}

// Draw a station at explicit coordinates, so the arena close-up can reuse the
// exact same sprites as the floor instead of keeping a second set in sync.
export function drawStation(ctx, x, y, e, anim) {
  if (e.kind === 'rack') drawRack(ctx, x, y, e);
  else if (e.kind === 'treadmill') drawTreadmill(ctx, x, y, anim);
  else if (e.kind === 'dumbbell') drawDumbbell(ctx, x, y, e);
  else if (e.kind === 'mat') drawMat(ctx, x, y, e);
  else drawBag(ctx, x, y, anim ? Math.sin(anim * 3) : 0);
}

export function drawEquipment(ctx, e, anim) {
  const p = iso(e.gx, e.gy);
  drawStation(ctx, p.x, p.y, e, anim);
}

// ------------------------------------------------------------------- props

// Scenery on the aisles so the room feels inhabited rather than laid out on a
// spreadsheet. Placement is hashed off the tile, so it never jitters.
function prop(ctx, x, y, which) {
  if (which === 0) {                                    // potted plant
    box3(ctx, x, y, 8, 6, 6, '#b5643c');
    ctx.fillStyle = '#3f8f45';
    [[0, -9, 5], [-4, -7, 3.5], [4, -7, 3.5], [0, -13, 3.5]].forEach(([dx, dy, r]) => {
      ctx.beginPath();
      ctx.ellipse(x + dx, y + dy, r, r * 0.85, 0, 0, Math.PI * 2);
      ctx.fill();
    });
  } else if (which === 1) {                             // water cooler
    box3(ctx, x, y, 9, 7, 12, '#e9eef2');
    box3(ctx, x, y - 12, 8, 6, 9, '#5aa9d8');
  } else if (which === 2) {                             // flat bench
    shadow(ctx, x, y, 12, 6);
    box3(ctx, x, y, 20, 9, 5, '#7b8794');
    box3(ctx, x, y - 5, 18, 7, 3, '#2f3740');
  } else {                                              // chalk bucket
    box3(ctx, x, y, 7, 5, 6, '#c9c2b0');
    ctx.fillStyle = PAL.chalk;
    ctx.beginPath();
    ctx.ellipse(x, y - 6, 3.5, 2, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function inZone(view, gx, gy) {
  return view.zones.some((z) => gx >= z.gx && gx < z.gx + z.w && gy >= z.gy && gy < z.gy + z.h);
}

// ----------------------------------------------------------- wall behind

const WALL_H = 60;

function wallFace(ctx, a, b, h, color) {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.lineTo(b.x, b.y - h);
  ctx.lineTo(a.x, a.y - h);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function band(ctx, a, b, y0, y1, color, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha == null ? 1 : alpha;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y - y0);
  ctx.lineTo(b.x, b.y - y0);
  ctx.lineTo(b.x, b.y - y1);
  ctx.lineTo(a.x, a.y - y1);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

function drawWalls(ctx, T) {
  const topN = iso(T.gx0 - 0.5, T.gy0 - 0.5);
  const east = iso(T.gx1 - 0.5, T.gy0 - 0.5);
  const west = iso(T.gx0 - 0.5, T.gy1 - 0.5);

  wallFace(ctx, topN, east, WALL_H, PAL.wall);            // lit wall
  band(ctx, topN, east, 14, 42, PAL.mirror);              // mirror run
  band(ctx, topN, east, 40, 42, shade(PAL.mirror, 1.2));
  band(ctx, topN, east, 14, 16, shade(PAL.mirror, 0.75));
  band(ctx, topN, east, 52, 56, PAL.amber, 0.85);         // signage stripe

  wallFace(ctx, topN, west, WALL_H, PAL.wallSide);        // shaded wall
  band(ctx, topN, west, 14, 42, shade(PAL.mirror, 0.86));
  band(ctx, topN, west, 40, 42, shade(PAL.mirror, 1.05));
  band(ctx, topN, west, 52, 56, shade(PAL.amber, 0.8), 0.7);

  const clock = { x: (topN.x + east.x) / 2, y: (topN.y + east.y) / 2 - 30 };
  ctx.fillStyle = '#2f3740';                              // wall clock
  ctx.beginPath();
  ctx.ellipse(clock.x, clock.y, 6, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = PAL.chalk;
  ctx.beginPath();
  ctx.ellipse(clock.x, clock.y, 4.5, 4.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#2f3740';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(clock.x, clock.y);
  ctx.lineTo(clock.x + 2, clock.y - 2.5);
  ctx.stroke();
}

// ----------------------------------------------------------- ground bake

// Grass, plots and scenery, baked once. Buildings are NOT baked: they react to
// hover and to what the agent is touching, so app.js draws them every frame.
export function buildGround(view) {
  const b = view.bounds;
  const cv = document.createElement('canvas');
  cv.width = Math.min(8192, Math.ceil(b.w));
  cv.height = Math.min(8192, Math.ceil(b.h));
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.translate(-b.x, -b.y);

  ctx.fillStyle = PAL.ground;
  ctx.fillRect(b.x, b.y, b.w, b.h);

  const T = view.tiles;
  const pad = new Set();
  view.buildings.forEach((bd) => {
    for (let gx = bd.gx; gx < bd.gx + bd.span; gx++) {
      for (let gy = bd.gy; gy < bd.gy + bd.span; gy++) pad.add(gx + ',' + gy);
    }
  });

  for (let gx = T.gx0; gx < T.gx1; gx++) {
    for (let gy = T.gy0; gy < T.gy1; gy++) {
      const p = iso(gx, gy);
      const edge = gx === T.gx0 || gy === T.gy0 || gx === T.gx1 - 1 || gy === T.gy1 - 1;
      const alt = (gx + gy) % 2 === 0;
      diamond(ctx, p.x, p.y, edge ? PAL.floorEdge : (alt ? PAL.floor : PAL.floorAlt));
      if (!edge && ((gx * 31 + gy * 17) % 7 === 0)) {
        ctx.fillStyle = 'rgba(120,90,50,.08)';           // floorboard grain
        ctx.fillRect(p.x - 5, p.y, 10, 1);
      }
    }
  }

  // painted walkway lines around each station, the way a real floor is marked
  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.strokeStyle = PAL.line;
  ctx.lineWidth = 2;
  view.buildings.forEach((bd) => {
    const c0 = iso(bd.gx - 0.6, bd.gy - 0.6);
    const c1 = iso(bd.gx + bd.span - 0.4, bd.gy - 0.6);
    const c2 = iso(bd.gx + bd.span - 0.4, bd.gy + bd.span - 0.4);
    const c3 = iso(bd.gx - 0.6, bd.gy + bd.span - 0.4);
    ctx.beginPath();
    ctx.moveTo(c0.x, c0.y); ctx.lineTo(c1.x, c1.y);
    ctx.lineTo(c2.x, c2.y); ctx.lineTo(c3.x, c3.y);
    ctx.closePath(); ctx.stroke();
  });
  ctx.restore();

  // ceiling light pools, so the hall reads as lit rather than flat
  view.buildings.forEach((bd) => {
    const c = iso(bd.cx, bd.cy);
    const r = bd.span * TW * 0.6;
    const g = ctx.createRadialGradient(c.x, c.y - 20, 0, c.x, c.y - 20, r);
    g.addColorStop(0, 'rgba(255,246,214,.26)');
    g.addColorStop(1, 'rgba(255,246,214,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, r, r * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
  });

  // gym furniture on the walkways: benches, coolers, plants, chalk bowls
  const props = [];
  for (let gx = T.gx0; gx < T.gx1; gx++) {
    for (let gy = T.gy0; gy < T.gy1; gy++) {
      if (pad.has(gx + ',' + gy)) continue;
      const hash = (gx * 73856093) ^ (gy * 19349663);
      if (((hash >>> 3) & 7) !== 0) continue;
      const p = iso(gx, gy);
      props.push({ d: gx + gy, fn: () => prop(ctx, p.x, p.y, (hash >>> 6) & 3) });
    }
  }
  props.sort((a, c) => a.d - c.d).forEach((x) => x.fn());

  return { canvas: cv, bounds: b };
}

export { PAL, shade };
