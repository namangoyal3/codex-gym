// Wiring: SSE -> gym state -> camera, athlete, HUD.

import { iso, buildGround, drawStation, shade, TW, TH } from './iso.js';
import { layoutBase, drawBuilding, hitBuilding, buildingAnchor, KIND_LOOK } from './building.js';
import { Animator, drawAthlete } from './athlete.js';
import * as sfx from './sfx.js';

const BUF_W = 800, BUF_H = 450;
const ARENA_W = 220, ARENA_H = 128, ARENA_SCALE = 2.0, ARENA_GROUND = 98;
const PLATES = [25, 20, 15, 10, 5, 2.5];

function platesFor(kg) {
  let per = Math.max(0, (kg - 20) / 2);
  const out = [];
  PLATES.forEach((p) => { while (per >= p - 1e-9) { out.push(p); per -= p; } });
  return out;
}

const $ = (id) => document.getElementById(id);
const cv = $('stage');
const ctx = cv.getContext('2d');
cv.width = BUF_W; cv.height = BUF_H;
ctx.imageSmoothingEnabled = false;

const acv = $('arena');
const actx = acv.getContext('2d');
acv.width = ARENA_W; acv.height = ARENA_H;
actx.imageSmoothingEnabled = false;

const S = {
  view: null, floor: null, stats: null, hud: {}, records: {},
  running: false, feed: [],
};
const cam = { x: 0, y: 0, zoom: 0.6, tx: 0, ty: 0, tz: 0.6, mode: 'auto' };
const anim = new Animator();
const lifter = { x: 0, y: 0, tx: 0, ty: 0, walking: false, facing: 1 };
const labels = [];
let shake = 0;

// ------------------------------------------------------------------ floor

function loadFloor(zones, stats) {
  S.stats = stats;
  S.view = layoutBase(zones.map((z) => ({ ...z, equipment: z.equipment.map((e) => ({ ...e })) })));
  S.ground = buildGround(S.view);
  S.selected = null;
  closeMenu();
  const b = S.view.bounds;
  cam.tx = cam.x = b.x + b.w / 2;
  cam.ty = cam.y = b.y + b.h / 2;
  cam.tz = cam.zoom = fitZoom();
  const start = biggestBuilding();
  if (start) {
    const p = iso(start.cx, start.cy);
    lifter.x = lifter.tx = p.x; lifter.y = lifter.ty = p.y + 14;
  }
  renderFloorMeta();
}

// the athlete idles at the biggest building, which reads as their home gym
function biggestBuilding() {
  let best = null;
  (S.view ? S.view.buildings : []).forEach((b) => {
    if (!best || b.loc > best.loc) best = b;
  });
  return best;
}

function fitZoom() {
  // floor at 0.42 so a big repo crops rather than becoming unreadable confetti;
  // signage is screen-space now, so it stays sharp even down here
  const b = S.view.bounds;
  return Math.max(0.42, Math.min(1.8, Math.min(BUF_W / b.w, BUF_H / b.h)));
}


// Tiny glyphs of the actual sprites. A colour swatch would be a lie here - the
// stations are told apart by shape on the floor, so the key uses shape too.
const GLYPH = {
  rack: '<rect x="1" y="3" width="2" height="9" fill="#59636e"/><rect x="9" y="3" width="2" height="9" fill="#59636e"/>'
      + '<rect x="1" y="4" width="10" height="2" fill="#cfd8de"/><rect x="0" y="3" width="2" height="4" fill="#e8452f"/>'
      + '<rect x="10" y="3" width="2" height="4" fill="#e8452f"/>',
  treadmill: '<polygon points="1,9 8,6 11,8 4,11" fill="#3c4650"/><rect x="9" y="1" width="2" height="6" fill="#c9cfd6"/>'
      + '<rect x="8" y="0" width="4" height="2" fill="#ffb020"/>',
  dumbbell: '<rect x="2" y="6" width="8" height="2" fill="#cfd8de"/><rect x="0" y="4" width="3" height="6" fill="#2f7fe8"/>'
      + '<rect x="9" y="4" width="3" height="6" fill="#2f7fe8"/>',
  mat: '<polygon points="1,7 6,4 11,7 6,10" fill="#7a52c0"/>',
  bag: '<rect x="1" y="1" width="2" height="10" fill="#5b6672"/><rect x="1" y="1" width="8" height="2" fill="#8a939c"/>'
      + '<rect x="6" y="3" width="4" height="7" fill="#8a4a32"/>',
};
const MEANS = {
  rack: ['POWER RACK', 'source code'],
  treadmill: ['CARDIO BANK', 'tests'],
  dumbbell: ['DUMBBELL RACK', 'config'],
  mat: ['STRETCH STUDIO', 'docs'],
  bag: ['BOXING RING', 'html / css'],
};

function renderFloorMeta() {
  const s = S.stats;
  $('repo').textContent = s.repo;
  $('floorStats').textContent = `${s.zones} STATIONS · ${s.equipment} FILES · ${s.loc.toLocaleString()} LOC`;
  // the swatch is the building's real wall colour, so the key cannot lie
  $('kinds').innerHTML = Object.entries(s.kinds).filter(([, v]) => v).map(([k, v]) => {
    const [name, means] = MEANS[k];
    const look = KIND_LOOK[k] || KIND_LOOK.rack;
    return `<div class="lrow" title="${name} = ${means}">`
      + `<i style="background:${look.wall}"></i>`
      + `<b>${v}</b><span>${means}</span></div>`;
  }).join('');
  $('truncNote').textContent = s.truncated ? `${s.truncated} files did not fit on the floor` : '';
}

// ------------------------------------------------------------------ arena

// A persistent close-up of the lift. The floor answers "where in my repo?"; at
// wide zoom the lifter is 30px tall, so this panel answers "what is happening?"
function drawArena(now) {
  const g = actx.createLinearGradient(0, 0, 0, ARENA_H);
  g.addColorStop(0, '#1d4450');
  g.addColorStop(1, '#2b5a63');
  actx.fillStyle = g;
  actx.fillRect(0, 0, ARENA_W, ARENA_H);

  actx.fillStyle = '#d8c7a4';                                  // floor band
  actx.fillRect(0, ARENA_GROUND - 26, ARENA_W, ARENA_H);
  actx.fillStyle = 'rgba(255,246,214,.22)';                    // spotlight pool
  actx.beginPath();
  actx.ellipse(ARENA_W * 0.5, ARENA_GROUND, 74, 17, 0, 0, Math.PI * 2);
  actx.fill();

  actx.save();
  actx.scale(ARENA_SCALE, ARENA_SCALE);
  const gx = ARENA_W * 0.5 / ARENA_SCALE, gy = ARENA_GROUND / ARENA_SCALE;

  const e = S.activePath && S.view ? S.view.fileByPath.get(S.activePath) : null;
  if (e) {
    drawStation(actx, gx + 2, gy, e, now / 1000 * 2.2);
  } else {
    // no station in play: give the lifter a platform so they are not floating
    actx.fillStyle = '#6b5236';
    actx.beginPath();
    actx.moveTo(gx, gy - 8); actx.lineTo(gx + 17, gy);
    actx.lineTo(gx, gy + 8); actx.lineTo(gx - 17, gy);
    actx.closePath(); actx.fill();
  }

  drawAthlete(actx, Math.round(gx - 4), Math.round(gy + 3), anim.pose, {
    scale: 1,
    klass: (S.hud.athlete && S.hud.athlete.klass) || 'LIFTER',
    plates: platesFor(S.hud.active_kg || 20),
    puffs: anim.puffs,
  });
  actx.restore();
}

function paintArena() {
  const h = S.hud;
  const ex = anim.exercise();
  $('aEx').textContent = (LIFT_NAME[ex] || ex || 'RACKED').toUpperCase();
  $('aKg').textContent = (ex === 'deadlift' || ex === 'squat' || ex === 'press')
    ? `${h.active_kg || 20}kg on the bar` : '';
  // the coach's own words: what the athlete is doing, in plain English
  $('aFile').textContent = S.lastSays || h.active_file || 'waiting for the agent';
  const caption = S.lastSays || h.active_file || (S.running ? 'Codex is working…' : 'Ready for a new workout');
  $('arenaZone').textContent = caption;
}

const LIFT_NAME = {
  deadlift: 'deadlift', squat: 'squat', bench: 'bench press', press: 'overhead press',
  run: 'treadmill sprint', scout: 'walking the floor', chalk: 'chalking up',
  racked: 'racked', fail: 'missed rep', pr: 'personal record',
};

// ----------------------------------------------------------------- camera

// send the athlete to the building that holds this file
function focusOn(path) {
  if (!S.view) return;
  const b = S.view.byPath.get(path);
  S.activePath = path;
  S.activeBuilding = b || null;
  if (!b) return;
  const p = iso(b.cx, b.cy);
  const tx = p.x, ty = p.y + b.span * 8;        // stand in front of the door
  if (Math.abs(tx - lifter.x) > 2) lifter.facing = tx > lifter.x ? 1 : -1;
  lifter.tx = tx; lifter.ty = ty;
  if (Math.abs(lifter.x - tx) + Math.abs(lifter.y - ty) > 6) lifter.walking = true;
  if (cam.mode === 'auto') { cam.tx = p.x; cam.ty = p.y - 10; cam.tz = 1.7; }
}

function goWide() {
  cam.tx = S.view.bounds.x + S.view.bounds.w / 2;
  cam.ty = S.view.bounds.y + S.view.bounds.h / 2;
  cam.tz = fitZoom();
}

function worldToScreen(wx, wy) {
  const vw = BUF_W / cam.zoom, vh = BUF_H / cam.zoom;
  return { x: (wx - (cam.x - vw / 2)) * cam.zoom, y: (wy - (cam.y - vh / 2)) * cam.zoom };
}

// ------------------------------------------------------------------- loop

let last = performance.now();
let idleSince = performance.now();

function frame(now) {
  const dt = Math.min(64, now - last);
  last = now;

  if (S.ground) {
    // pull back to the wide shot when nothing has happened for a while
    if (cam.mode === 'auto' && now - idleSince > 6000 && cam.tz > 1) goWide();

    const k = 1 - Math.pow(0.0025, dt / 1000);
    cam.x += (cam.tx - cam.x) * k;
    cam.y += (cam.ty - cam.y) * k;
    cam.zoom += (cam.tz - cam.zoom) * k;

    const wk = 1 - Math.pow(0.004, dt / 1000);
    lifter.x += (lifter.tx - lifter.x) * wk;
    lifter.y += (lifter.ty - lifter.y) * wk;
    if (lifter.walking && Math.abs(lifter.tx - lifter.x) + Math.abs(lifter.ty - lifter.y) < 3) {
      lifter.walking = false;
      // arriving hands the lifter back to whatever they should be doing there:
      // keep working if a set is live, otherwise stand and breathe
      const ex = S.hud.exercise;
      anim.setIdle(S.running && ex && ex !== 'racked' ? ex : 'racked');
    }

    draw(dt, now);
    drawArena(now, dt);
    paintArena();
  }
  requestAnimationFrame(frame);
}

function draw(dt, now) {
  const b = S.ground.bounds;
  const vw = BUF_W / cam.zoom, vh = BUF_H / cam.zoom;
  const sx = cam.x - vw / 2, sy = cam.y - vh / 2;

  ctx.fillStyle = '#2d5a86';
  ctx.fillRect(0, 0, BUF_W, BUF_H);
  ctx.save();
  if (shake > 0) {
    ctx.translate(Math.round((Math.random() - 0.5) * shake), Math.round((Math.random() - 0.5) * shake));
    shake -= dt / 60;
  }
  ctx.drawImage(S.ground.canvas, sx - b.x, sy - b.y, vw, vh, 0, 0, BUF_W, BUF_H);

  // Buildings are drawn live, back to front, because each one reacts: hover,
  // the agent working inside it, uncommitted changes.
  ctx.save();
  ctx.scale(cam.zoom, cam.zoom);
  ctx.translate(-sx, -sy);
  const t = now / 1000;
  const order = S.view.buildings.slice().sort((a, c) => (a.gx + a.gy) - (c.gx + c.gy));
  // the athlete is drawn in the same depth queue as the buildings, so a hall in
  // front of them actually hides them instead of the figure floating over roofs
  const pose = anim.tick(dt);
  if (lifter.walking) anim.setIdle('scout');
  const lifterDepth = (2 * lifter.y) / TH;
  let lifterDrawn = false;
  const drawLifter = () => {
    lifterDrawn = true;
    drawAthlete(ctx, Math.round(lifter.x), Math.round(lifter.y), pose, {
      scale: 1, klass: (S.hud.athlete && S.hud.athlete.klass) || 'LIFTER',
      plates: platesFor(S.hud.active_kg || 20), puffs: anim.puffs,
      flip: lifter.facing < 0,
    });
  };

  order.forEach((bd) => {
    if (!lifterDrawn && (bd.gx + bd.gy) > lifterDepth) drawLifter();
    const p = iso(bd.cx, bd.cy);
    if (p.x < sx - 120 || p.x > sx + vw + 120 || p.y < sy - 160 || p.y > sy + vh + 120) return;
    let ring = null;
    if (S.activeBuilding === bd) ring = 'active';
    else if (S.selected === bd) ring = 'active';
    else if (bd.dirty) ring = 'dirty';
    if (bd.broken) ring = 'broken';
    drawBuilding(ctx, bd, { hover: S.hover === bd || S.selected === bd, ring, t });
  });
  if (!lifterDrawn) drawLifter();
  ctx.restore();

  // signs in screen space: name plus the level badge, legible at any zoom
  ctx.textAlign = 'center';
  order.forEach((bd) => {
    const a = buildingAnchor(bd);
    const s = worldToScreen(a.x, a.y);
    if (s.x < -70 || s.x > BUF_W + 70 || s.y < -20 || s.y > BUF_H + 20) return;
    const showName = cam.zoom > 0.62 || S.hover === bd || S.selected === bd || S.activeBuilding === bd;
    if (!showName) return;
    const label = bd.label.toUpperCase().slice(0, 16);
    ctx.font = 'bold 9px ui-monospace, Menlo, monospace';
    const w = ctx.measureText(label).width + 24;
    ctx.fillStyle = 'rgba(14,20,26,.9)';
    ctx.fillRect(Math.round(s.x - w / 2), Math.round(s.y - 12), w, 13);
    ctx.fillStyle = shade(bd.look.wall, 1.3);
    ctx.fillRect(Math.round(s.x - w / 2), Math.round(s.y - 12), w, 2);
    ctx.fillStyle = '#fdfbf4';
    ctx.fillText(label, s.x + 7, Math.round(s.y - 2));
    // level badge: file count, the "how built up is this folder" number
    ctx.fillStyle = '#ffb020';
    ctx.beginPath();
    ctx.ellipse(Math.round(s.x - w / 2 + 9), Math.round(s.y - 5), 7, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#14202a';
    ctx.font = 'bold 8px ui-monospace, Menlo, monospace';
    ctx.fillText(String(bd.level), Math.round(s.x - w / 2 + 9), Math.round(s.y - 2));
  });

  // marker and callouts stay in screen space so they never shrink away
  const sp = worldToScreen(lifter.x, lifter.y);
  const scale = cam.zoom;

  // in the wide shot the lifter is small - mark them so they stay findable
  if (cam.zoom < 1.3) {
    const pulse = 0.5 + Math.sin(now / 220) * 0.25;
    ctx.strokeStyle = `rgba(255,176,32,${pulse})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(sp.x, sp.y + 2, 18, 9, 0, 0, Math.PI * 2);
    ctx.stroke();
    const ay = sp.y - 62 * scale / 2 - 14 + Math.sin(now / 300) * 3;
    ctx.fillStyle = `rgba(255,176,32,${pulse})`;            // bobbing marker
    ctx.beginPath();
    ctx.moveTo(sp.x, ay + 9);
    ctx.lineTo(sp.x - 5, ay);
    ctx.lineTo(sp.x + 5, ay);
    ctx.closePath();
    ctx.fill();
  }

  // floating rep callouts
  ctx.font = '10px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'center';
  for (let i = labels.length - 1; i >= 0; i--) {
    const L = labels[i];
    L.life -= dt / 1400;
    L.y -= dt / 26;
    if (L.life <= 0) { labels.splice(i, 1); continue; }
    ctx.globalAlpha = Math.min(1, L.life * 1.6);
    ctx.fillStyle = L.color;
    ctx.fillText(L.text, sp.x + L.x, sp.y - 52 * scale / 2 + L.y);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

function callout(text, color) {
  labels.push({ text, color: color || '#ffb020', x: (Math.random() - 0.5) * 20, y: 0, life: 1 });
  if (labels.length > 8) labels.shift();
}

// ------------------------------------------------------------------- HUD

function bar(el, frac, cls) {
  const n = 22, on = Math.round(Math.max(0, Math.min(1, frac)) * n);
  el.innerHTML = Array.from({ length: n }, (_, i) =>
    `<i class="${i < on ? 'on ' + (cls || '') : ''}"></i>`).join('');
}

function paintHud() {
  const h = S.hud;
  const a = h.athlete || {};
  $('athlete').textContent = a.klass || '—';
  $('model').textContent = a.model || '—';
  $('effort').textContent = (h.effort || '—').toUpperCase();
  $('spotter').textContent = (h.spotter || '—').toUpperCase();
  $('state').textContent = h.state || 'IDLE';
  $('state').className = 'state s-' + String(h.state || '').toLowerCase().replace(/\W/g, '');
  $('setNo').textContent = h.set || 0;
  $('repNo').textContent = h.reps || 0;
  bar($('stamina'), h.stamina || 0, h.stamina < 0.25 ? 'low' : '');
  $('staminaPct').textContent = Math.round((h.stamina || 0) * 100) + '%';
  $('ctxNums').textContent = h.context
    ? `${(h.tokens || 0).toLocaleString()} / ${h.context.toLocaleString()} tok` : '—';
  bar($('recovery'), h.recovery == null ? 0 : 1 - h.recovery / 100, 'rec');
  $('recoveryPct').textContent = h.recovery == null ? '—' : (100 - h.recovery).toFixed(0) + '%';
  $('calories').textContent = (h.calories || 0).toLocaleString();
  $('credits').textContent = h.credits ? Number(h.credits).toFixed(0) : '—';
  // the current lift now lives in the arena panel, painted every frame
}

function paintRecords() {
  const r = S.records || {};
  $('level').textContent = r.level || 1;
  $('streak').textContent = (r.streak || 0) + 'd';
  $('heaviest').textContent = (r.heaviest_kg || 0) + 'kg';
  $('heaviestFile').textContent = r.heaviest_file || '';
  $('volume').textContent = (r.volume_lines || 0).toLocaleString();
  $('totalReps').textContent = (r.total_reps || 0).toLocaleString();
  $('totalSets').textContent = (r.total_sets || 0).toLocaleString();
}

const FEED = $('feed');
function feedRow(m) {
  const div = document.createElement('div');
  if (m.kind === 'rep') {
    div.className = 'row ' + (m.ok ? '' : 'bad');
    // plain English is the readable text; the raw command is on hover, so the
    // log works for someone who does not read shell
    div.innerHTML = `<span class="n">${String(m.n).padStart(3, '0')}</span>`
      + `<span class="ex">${m.label}</span>`
      + `<span class="kg">${m.exercise === 'deadlift' ? m.kg + 'kg' : ''}</span>`
      + `<span class="dt" title="${escape_(m.detail || '')}">${escape_(m.says || m.detail || '')}</span>`;
  } else if (m.kind === 'record') {
    div.className = 'row pr';
    div.innerHTML = `<span class="ex">NEW PR</span><span class="dt">${escape_(m.text)}</span>`;
  } else {
    div.className = 'row note ' + (m.tone || '');
    div.textContent = m.text;
  }
  FEED.appendChild(div);
  while (FEED.children.length > 90) FEED.removeChild(FEED.firstChild);
  FEED.scrollTop = FEED.scrollHeight;
}

function escape_(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function setProofPhase(phase, summary) {
  document.querySelectorAll('[data-proof]').forEach((el) => {
    el.classList.toggle('on', el.dataset.proof === phase);
  });
  $('proofSummary').textContent = summary;
}

// ------------------------------------------------------------------- SSE

function apply(m) {
  switch (m.kind) {
    case 'snapshot':
      loadFloor(m.zones, m.stats);
      S.hud = m.hud; S.records = m.records; S.running = m.running;
      S.replaying = m.replaying || null;
      FEED.innerHTML = '';
      m.feed.forEach(feedRow);
      if (m.chat && m.chat.length) { chatEl.innerHTML = ''; m.chat.forEach(chatBubble); }
      paintHud(); paintRecords(); paintRunning();
      paintReplay(); paintAsk(m.question);
      S.result = m.result || null;
      if (m.question) setProofPhase(null, `BLOCKED · ${m.question}`);
      else if (m.running) setProofPhase('select', 'TRAINING · Codex is selecting the next action.');
      else if (m.status && ['completed', 'stopped', 'failed'].includes(m.status)) {
        setProofPhase('result', `${m.status.toUpperCase()} · ${m.result || 'The workout ended.'}`);
      } else setProofPhase('select', 'Choose a task to start.');
      break;
    case 'floor':
      loadFloor(m.zones, m.stats);
      loadQuests();          // targets are per-repo, so they move with the floor
      loadProject();
      break;
    case 'equip': {
      // the file grew or shrank: the building it lives in grows with it
      const e = S.view && S.view.fileByPath.get(m.path);
      const bd = S.view && S.view.byPath.get(m.path);
      if (e) {
        e.loc = m.loc; e.kg = m.kg;
        if (bd) {
          bd.loc = bd.equipment.reduce((sum, f) => sum + (f.loc || 0), 0);
          bd.h = 16 + Math.min(1, bd.loc / 2200) * 34;
        }
        const up = m.kg > m.prev_kg;
        callout(`${up ? '+' : ''}${(m.kg - m.prev_kg).toFixed(0)}kg`, up ? '#3fa85a' : '#ff4d2e');
        sfx.play('weight');
      }
      break;
    }
    case 'hud':
      Object.assign(S.hud, m);
      if (m.exercise === 'chalk') anim.setIdle('chalk');
      if (m.state === 'RESTING' || m.state === 'DONE') anim.setIdle('racked');
      paintHud();
      break;
    case 'set_start':
      idleSince = performance.now();
      // The server mutates its own hud under lock and emits only this event, no
      // `hud` event — so without these the SET/REPS counters and the state badge
      // froze at whatever the last snapshot said.
      S.hud.set = m.set;
      S.hud.reps = 0;
      S.hud.state = 'LIFTING';
      sfx.play('setStart');
      feedRow({ kind: 'note', text: `— SET ${m.set} —`, tone: 'cue' });
      paintHud();
      break;
    case 'set_end': {
      anim.setIdle('racked');
      // a set that ends with no reps and a question means the agent stopped to
      // ask; say so loudly, or it reads as "the workout just did nothing"
      sfx.play('setEnd');
      const asked = !S.hud.reps && m.message && m.message.includes('?');
      feedRow({
        kind: 'note', tone: m.aborted || asked ? 'bad' : 'cue',
        text: m.aborted ? 'SET ABORTED'
          : asked ? 'RE-RACKED — the athlete is asking you a question'
          : `SET DONE · ${(m.ms / 1000).toFixed(1)}s`,
      });
      if (m.message) feedRow({ kind: 'note', tone: 'coach', text: '🗣 ' + m.message });
      if (asked) { S.hud.state = 'ASKING'; paintHud(); }
      goWide();
      break;
    }
    case 'rep': {
      idleSince = performance.now();
      const testing = m.exercise === 'run' || (m.exercise === 'fail' && S.hud.exercise === 'run');
      anim.push(m.exercise);
      anim.flash();
      if (m.path) focusOn(m.path);
      S.hud.exercise = m.exercise;
      S.hud.active_kg = m.kg;
      S.hud.reps = m.n;          // same reason as set_start: no `hud` event follows
      S.lastDetail = m.detail || '';
      S.lastSays = m.says || '';
      if (m.exercise === 'deadlift') { shake = 3; callout(m.kg + 'kg', '#ffb020'); }
      if (!m.ok) { shake = 5; callout('MISS', '#ff4d2e'); }
      if (m.exercise === 'run') callout('SPRINT', '#3fa85a');
      sfx.play(m.ok ? m.exercise : 'fail');
      if (['deadlift', 'squat', 'bench', 'press', 'run'].includes(m.exercise)) anim.setIdle(m.exercise);   // keep training between reps
      feedRow(m);
      paintHud();
      if (testing) {
        setProofPhase('verify', `${m.ok ? 'PASS' : 'FAIL'} · ${m.detail || m.says || 'Test finished.'}`);
      } else if (m.exercise === 'deadlift' || m.path) {
        setProofPhase('edit', [m.path, m.detail].filter(Boolean).join(' · ') || 'Codex changed a file.');
      }
      break;
    }
    case 'record':
      callout(m.text, '#e8f2f0');
      shake = 4;
      sfx.play('pr');
      feedRow(m);
      break;
    case 'asking':
      paintAsk(m.question);
      if (m.question) sfx.play('asking');
      if (m.question) setProofPhase(null, `BLOCKED · ${m.question}`);
      break;
    case 'replay':
      S.replaying = m.replaying;
      paintReplay();
      break;
    case 'project':
      paintProject(m.project);
      break;
    case 'chat':
      chatBubble(m);
      break;
    case 'result':
      S.result = m.text || '';
      break;
    case 'lifecycle':
      if (m.status === 'running') {
        S.result = null;
        setProofPhase('select', 'TRAINING · Codex is selecting the next action.');
      } else if (['completed', 'stopped', 'failed'].includes(m.status)) {
        if (S.question) break;
        const result = m.status === 'stopped' ? 'The workout was stopped.'
          : m.error || S.result || (m.status === 'completed' ? 'Codex completed the workout.' : 'The workout failed.');
        setProofPhase('result', `${m.status.toUpperCase()} · ${result}`);
        anim.setIdle(m.status === 'completed' ? 'pr' : 'fail');
      }
      break;
    case 'records':
      S.records = m.records; paintRecords();
      break;
    case 'note':
      feedRow(m);
      break;
    case 'running':
      S.running = m.running; paintRunning();
      break;
    default:
      break;
  }
}

function paintRunning() {
  $('train').disabled = S.running;
  $('rack').disabled = !S.running;
  $('questGo').disabled = S.running;
  $('chatSend').disabled = S.running;
  document.querySelectorAll('.quest').forEach((b) => { b.disabled = S.running; });
  document.querySelectorAll('.bma').forEach((b) => { b.disabled = S.running; });
  document.body.classList.toggle('live', S.running);
}

function connect() {
  const es = new EventSource('/api/events');
  es.onmessage = (ev) => { try { apply(JSON.parse(ev.data)); } catch (e) { /* skip */ } };
  es.onerror = () => { $('conn').textContent = 'RECONNECTING'; };
  es.onopen = () => { $('conn').textContent = 'LIVE'; };
}

// ----------------------------------------------------------------- inputs

async function post(url, body) {
  const r = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return r.json();
}

$('train').onclick = async () => {
  const text = $('prompt').value.trim();
  if (!text) return;
  setProofPhase('select', 'STARTING · Codex is entering the gym.');
  const res = await post('/api/chat', {
    text,
    difficulty: S.difficulty,
    model: $('modelSel').value || null,
    effort: $('effortSel').value,
    sandbox: $('spotterSel').value,
    resume: S.freshNext ? false : undefined,
  });
  if (res.error) {
    setProofPhase('select', `READY · ${res.error}`);
    feedRow({ kind: 'note', tone: 'bad', text: 'CANNOT START: ' + res.error });
    return;
  }
  S.freshNext = false;
  S.result = null;
  $('prompt').value = '';
};
$('rack').onclick = () => post('/api/rack', {});
$('prompt').onkeydown = (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') $('train').click();
};

function setCameraLabel() {
  // short label: a fourth tab left no room for the word CAMERA
  $('wide').textContent = 'CAM ' + cam.mode.toUpperCase();
}

$('wide').onclick = () => {
  cam.mode = cam.mode === 'auto' ? 'wide' : 'auto';
  setCameraLabel();
  if (cam.mode === 'wide') goWide();
};

$('repoSel').onchange = async () => {
  const root = $('repoSel').value;
  // browsers restore form state on reload and can fire change for it, which
  // would silently move the player to a different gym
  if (!root || (S.stats && root === S.stats.root)) return;
  const res = await post('/api/repo', { root });
  if (res.error) feedRow({ kind: 'note', tone: 'bad', text: res.error });
};

function loadRepos() {
  fetch('/api/repos').then((r) => r.json()).then((d) => {
    const all = d.repos.includes(d.current) ? d.repos : d.repos.concat([d.current]);
    $('repoSel').innerHTML = all.map((p) =>
      `<option value="${escape_(p)}"${p === d.current ? ' selected' : ''}>${escape_(p.split('/').pop())}</option>`).join('');
  }).catch(() => { /* offline is survivable */ });
}
loadRepos();
loadQuests();
loadProject();
setCameraLabel();

// ------------------------------------------------------- project lifecycle

// The pipeline every change travels. Stages come from real git and test state,
// so this is the honest answer to "where is my project right now".
function paintProject(pr) {
  if (!pr) return;
  S.project = pr;
  const at = pr.stage;
  const blocked = pr.stages[at] && pr.stages[at].name === 'SPOTTER';
  $('stages').innerHTML = pr.stages.map((st, i) => {
    let cls = 'stg';
    if (i === at) cls += blocked ? ' blocked' : ' at';
    else if (i < at) cls += ' done';
    return `<div class="${cls}" title="${escape_(st.note)}">${escape_(st.name)}</div>`;
  }).join('');

  $('plBranch').textContent = pr.git ? (pr.branch || 'no commits yet') : 'not a git repo';
  const bits = [];
  if (pr.dirty_n) bits.push(`${pr.dirty_n} file${pr.dirty_n === 1 ? '' : 's'} changed`);
  if (pr.ahead) bits.push(`${pr.ahead} commit${pr.ahead === 1 ? '' : 's'} to push`);
  if (pr.tests === true) bits.push('tests passing');
  if (pr.tests === false) bits.push('tests failing');
  if (!bits.length) bits.push(pr.stages[at] ? pr.stages[at].note : '—');
  $('plNote').textContent = bits.join(' · ');

  // mark the buildings holding uncommitted work, and the broken ones
  if (S.view) {
    const dirty = new Set(pr.dirty || []);
    S.view.buildings.forEach((b) => {
      b.dirty = b.equipment.some((f) => dirty.has(f.path));
      b.broken = pr.tests === false && b.kind === 'treadmill';
    });
  }
}

function loadProject() {
  fetch('/api/project').then((r) => r.json()).then(paintProject).catch(() => {});
}

// --------------------------------------------------------- building menu

// Tap a building and act on that folder. This is the whole point: the map is not
// a readout, it is the control surface.
const BUILDING_ACTIONS = [
  { id: 'tests', label: 'ADD TESTS', note: 'write tests and make them pass' },
  { id: 'comment', label: 'DOCUMENT', note: 'explain the tricky parts' },
  { id: 'split', label: 'BREAK IT UP', note: 'split into smaller modules' },
  { id: 'cleanup', label: 'TIDY UP', note: 'remove dead code' },
  { id: 'fix', label: 'RUN THE TESTS', note: 'and fix what fails' },
];

const menuEl = $('bmenu');

function closeMenu() { if (menuEl) menuEl.hidden = true; }

function selectBuilding(b, px, py) {
  S.selected = b;
  focusOnBuilding(b);
  sfx.play('scout');

  const files = b.equipment.slice().sort((x, y) => y.loc - x.loc);
  $('bmName').textContent = b.label.toUpperCase();
  $('bmKind').textContent = b.look.name;
  $('bmPath').textContent = b.path === '.' ? 'project root' : b.path;
  $('bmStats').textContent =
    `LEVEL ${b.level} · ${b.files} file${b.files === 1 ? '' : 's'} · ${b.loc.toLocaleString()} LOC`;
  $('bmFiles').innerHTML = files.slice(0, 8).map((f) =>
    `<div class="bmf"><span>${escape_(f.name)}</span><b>${f.kg}kg</b></div>`).join('')
    + (files.length > 8 ? `<div class="bmf more">+${files.length - 8} more</div>` : '');
  $('bmActions').innerHTML = BUILDING_ACTIONS.map((a) =>
    `<button class="bma" data-id="${a.id}"><b>${a.label}</b><span>${a.note}</span></button>`).join('');
  $('bmActions').querySelectorAll('.bma').forEach((btn) => {
    btn.disabled = S.running;
    btn.onclick = async () => {
      const res = await post('/api/quest', {
        id: btn.dataset.id, target: b.path, difficulty: S.difficulty,
      });
      if (res.error) {
        feedRow({ kind: 'note', tone: 'bad', text: 'CANNOT START: ' + res.error });
        return;
      }
      closeMenu();
      document.querySelector('.tab[data-tab="log"]').click();
    };
  });

  // place the card next to the tap, kept inside the window
  const r = cv.getBoundingClientRect();
  menuEl.hidden = false;
  const mw = menuEl.offsetWidth || 250, mh = menuEl.offsetHeight || 260;
  const sx = r.left + (px / BUF_W) * r.width;
  const sy = r.top + (py / BUF_H) * r.height;
  menuEl.style.left = Math.round(Math.min(Math.max(8, sx + 14), window.innerWidth - mw - 8)) + 'px';
  menuEl.style.top = Math.round(Math.min(Math.max(8, sy - 40), window.innerHeight - mh - 8)) + 'px';
}

function focusOnBuilding(b) {
  const p = iso(b.cx, b.cy);
  if (Math.abs(p.x - lifter.x) > 2) lifter.facing = p.x > lifter.x ? 1 : -1;
  lifter.tx = p.x; lifter.ty = p.y + b.span * 8;
  lifter.walking = true;
  if (cam.mode === 'auto') { cam.tx = p.x; cam.ty = p.y - 10; cam.tz = Math.max(cam.tz, 1.4); }
}

$('bmClose').onclick = () => { S.selected = null; closeMenu(); };
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && menuEl && !menuEl.hidden) { S.selected = null; closeMenu(); }
});

// ------------------------------------------------------ pointer: pan, zoom, tap

function screenToWorld(clientX, clientY) {
  const r = cv.getBoundingClientRect();
  const px = (clientX - r.left) * (BUF_W / r.width);
  const py = (clientY - r.top) * (BUF_H / r.height);
  const vw = BUF_W / cam.zoom, vh = BUF_H / cam.zoom;
  return { x: px / cam.zoom + (cam.x - vw / 2), y: py / cam.zoom + (cam.y - vh / 2), px, py };
}

const drag = { on: false, id: null, lastX: 0, lastY: 0, moved: 0 };

cv.addEventListener('pointerdown', (ev) => {
  drag.on = true; drag.id = ev.pointerId; drag.moved = 0;
  drag.lastX = ev.clientX; drag.lastY = ev.clientY;
  cv.setPointerCapture(ev.pointerId);
  cv.style.cursor = 'grabbing';
});

cv.addEventListener('pointermove', (ev) => {
  if (!S.view) return;
  if (drag.on && ev.pointerId === drag.id) {
    const r = cv.getBoundingClientRect();
    const k = (BUF_W / r.width) / cam.zoom;
    const dx = (ev.clientX - drag.lastX) * k, dy = (ev.clientY - drag.lastY) * k;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    drag.lastX = ev.clientX; drag.lastY = ev.clientY;
    if (drag.moved > 3) {
      cam.mode = 'manual';                     // the player has taken the wheel
      setCameraLabel();
      cam.x -= dx; cam.y -= dy;
      cam.tx = cam.x; cam.ty = cam.y;
    }
    return;
  }
  const w = screenToWorld(ev.clientX, ev.clientY);
  S.hover = hitBuilding(S.view, w.x, w.y);
  cv.style.cursor = S.hover ? 'pointer' : 'grab';
});

function endDrag(ev) {
  if (!drag.on) return;
  const wasTap = drag.moved <= 3;
  drag.on = false;
  cv.style.cursor = S.hover ? 'pointer' : 'grab';
  if (!wasTap || !S.view) return;
  const w = screenToWorld(ev.clientX, ev.clientY);
  const b = hitBuilding(S.view, w.x, w.y);
  if (b) selectBuilding(b, w.px, w.py);
  else { S.selected = null; closeMenu(); }
}
cv.addEventListener('pointerup', endDrag);
cv.addEventListener('pointercancel', () => { drag.on = false; });

cv.addEventListener('wheel', (ev) => {
  ev.preventDefault();
  if (!S.view) return;
  const before = screenToWorld(ev.clientX, ev.clientY);
  const f = Math.exp(-ev.deltaY * 0.0016);
  cam.zoom = Math.max(0.3, Math.min(4, cam.zoom * f));
  cam.tz = cam.zoom;
  // keep the point under the cursor pinned while zooming
  const after = screenToWorld(ev.clientX, ev.clientY);
  cam.x += before.x - after.x;
  cam.y += before.y - after.y;
  cam.tx = cam.x; cam.ty = cam.y;
  cam.mode = 'manual';
  setCameraLabel();
}, { passive: false });

cv.addEventListener('dblclick', () => { cam.mode = 'auto'; setCameraLabel(); goWide(); });

// ----------------------------------------------------------- quest board

// A player picks a goal in plain words; the server owns the prompt template and
// fills it from this repo, so nobody has to know how to brief an agent.
S.difficulty = 'normal';

async function loadQuests() {
  let d;
  try { d = await (await fetch('/api/quests')).json(); } catch (e) { d = null; }
  if (!d || !d.quests) return;
  S.quests = d.quests;
  $('quests').innerHTML = d.quests.map((q) => `
    <button class="quest" data-id="${q.id}" ${q.needs ? 'data-needs="1"' : ''}>
      <b>${escape_(q.name)}</b><span class="ql">${escape_(q.lift)}</span>
      <span class="qb">${escape_(q.blurb)}</span>
      ${q.target ? `<span class="qt">→ ${escape_(q.target)} · ${q.target_kg}kg</span>` : ''}
    </button>`).join('');
  $('quests').querySelectorAll('.quest').forEach((b) => {
    b.onclick = () => {
      const q = S.quests.find((x) => x.id === b.dataset.id);
      if (q && q.needs) {
        S.askingQuest = q.id;
        $('questNeed').textContent = q.needs;
        $('questInput').hidden = false;
        $('quests').hidden = true;
        $('questText').focus();
      } else {
        startQuest(b.dataset.id);
      }
    };
  });
  paintRunning();
}

async function startQuest(id, input) {
  const res = await post('/api/quest', { id, input, difficulty: S.difficulty });
  if (res.error) {
    feedRow({ kind: 'note', tone: 'bad', text: 'CANNOT START: ' + res.error });
    return;
  }
  backToQuests();
  document.querySelector('.tab[data-tab="log"]').click();
}

function backToQuests() {
  S.askingQuest = null;
  $('questInput').hidden = true;
  $('quests').hidden = false;
  $('questText').value = '';
}

$('questGo').onclick = () => {
  if (S.askingQuest) startQuest(S.askingQuest, $('questText').value);
};
$('questBack').onclick = backToQuests;
$('questText').onkeydown = (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') $('questGo').click();
};

document.querySelectorAll('.wbtn').forEach((b) => {
  b.onclick = () => {
    S.difficulty = b.dataset.diff;
    document.querySelectorAll('.wbtn').forEach((o) => {
      o.classList.toggle('on', o === b);
      o.setAttribute('aria-checked', String(o === b));
    });
  };
});

$('advBtn').onclick = () => {
  const on = $('advanced').hidden;
  $('advanced').hidden = !on;
  $('advBtn').setAttribute('aria-pressed', String(on));
};

// ---------------------------------------------------------------- new gym

$('newGymBtn').onclick = () => {
  $('newGymBox').hidden = !$('newGymBox').hidden;
  if (!$('newGymBox').hidden) $('newGymName').focus();
};
$('newGymCancel').onclick = () => { $('newGymBox').hidden = true; };
$('newGymGo').onclick = async () => {
  const res = await post('/api/newgym', { name: $('newGymName').value });
  if (res.error) { feedRow({ kind: 'note', tone: 'bad', text: res.error }); return; }
  $('newGymBox').hidden = true;
  $('newGymName').value = '';
  loadQuests();
  loadRepos();
};
$('newGymName').onkeydown = (e) => { if (e.key === 'Enter') $('newGymGo').click(); };

// ------------------------------------------------------------------ chat

// Every line you send runs Codex in your project, resuming the same session so
// follow-ups keep their context. The floor animates the work as it happens.
const chatEl = $('chat');

function chatBubble(m) {
  const first = chatEl.querySelector('.chatempty');
  if (first) first.remove();
  const div = document.createElement('div');
  div.className = 'bubble ' + (m.who === 'you' ? 'you' : 'coach');
  div.innerHTML = `<span class="who">${m.who === 'you' ? 'YOU' : 'ATHLETE'}</span>`
    + escape_(m.text);
  chatEl.appendChild(div);
  while (chatEl.children.length > 60) chatEl.removeChild(chatEl.firstChild);
  chatEl.scrollTop = chatEl.scrollHeight;
}

async function sendChat(fresh) {
  const text = $('chatText').value.trim();
  if (!text) return;
  $('chatText').value = '';
  const res = await post('/api/chat', {
    text, difficulty: S.difficulty, resume: fresh ? false : undefined,
  });
  if (res.error) {
    feedRow({ kind: 'note', tone: 'bad', text: 'CANNOT SEND: ' + res.error });
    chatBubble({ who: 'coach', text: 'I could not start: ' + res.error });
  }
}

$('chatSend').onclick = () => {
  const fresh = !!S.freshNext;
  S.freshNext = false;
  sendChat(fresh);
};
$('chatNew').onclick = () => {
  S.freshNext = true;
  chatBubble({ who: 'coach', text: 'Starting a new session — the next message forgets the last one.' });
};
$('chatText').onkeydown = (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') $('chatSend').click();
};

// ------------------------------------------------------------------ tabs

let loadedTab = {};
document.querySelectorAll('.tab').forEach((t) => {
  t.onclick = () => {
    const name = t.dataset.tab;
    document.querySelectorAll('.tab').forEach((o) => o.classList.toggle('on', o === t));
    ['chat', 'log', 'replay', 'scores'].forEach((n) => { $('tab-' + n).hidden = n !== name; });
    if (name === 'chat') $('chatText').focus();
    if (name === 'replay' && !loadedTab.replay) loadSessions();
    if (name === 'scores') loadScores();          // cheap and worth refreshing
  };
});

// ----------------------------------------------------------------- replay

function timeOf(s) {
  const m = /rollout-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})/.exec(s.file || '');
  return m ? `${m[3]}/${m[2]} ${m[4]}:${m[5]}` : '';
}

async function loadSessions() {
  loadedTab.replay = true;
  const el = $('sessions');
  el.textContent = 'reading ~/.codex/sessions …';
  let d;
  try { d = await (await fetch('/api/sessions')).json(); } catch (e) { d = null; }
  if (!d || !d.sessions) { el.textContent = 'could not read sessions'; return; }
  S.sessions = d.sessions;
  $('replayNote').textContent = d.total > d.scanned
    ? `Newest ${d.scanned} of ${d.total} sessions. Older ones are not listed.`
    : `${d.sessions.length} past sessions. Click one to watch it as a workout.`;
  el.innerHTML = d.sessions.map((s) => `
    <button class="sess" data-file="${escape_(s.file)}">
      <span class="sp">${escape_(s.prompt || s.cwd || s.file)}</span>
      <span class="sm">${escape_((s.model || '?').replace('gpt-', ''))}</span>
      <span class="sd">${timeOf(s)} · ${s.reps} reps · ${s.edits} lifts · ${s.sets} sets${s.cwd ? ' · ' + escape_(s.cwd.split('/').pop()) : ''}</span>
    </button>`).join('') || 'no sessions found';
  el.querySelectorAll('.sess').forEach((b) => {
    b.onclick = () => startReplay(b.dataset.file, b);
  });
}

async function startReplay(file, btn) {
  const res = await post('/api/replay', { file, speed: Number($('speedSel').value) });
  if (res.error) {
    feedRow({ kind: 'note', tone: 'bad', text: 'CANNOT REPLAY: ' + res.error });
    return;
  }
  $('sessions').querySelectorAll('.sess').forEach((b) => b.classList.toggle('on', b === btn));
  document.querySelector('.tab[data-tab="log"]').click();
}

$('replayStop').onclick = () => post('/api/replay/stop', {});

function paintReplay() {
  const on = !!S.replaying;
  $('replayStop').disabled = !on;
  if (on) {
    $('replayNote').textContent = `REPLAYING ${S.replaying.file} at ${S.replaying.speed}x`;
  } else {
    $('sessions').querySelectorAll('.sess.on').forEach((b) => b.classList.remove('on'));
  }
}

// ----------------------------------------------------------------- scores

// lowerBetter marks the columns where the smallest number wins
const SCORE_COLS = [
  ['reps', 'REPS', false], ['edits', 'LIFTS', false], ['miss_pct', 'MISS%', true],
  ['reps_per_set', 'R/SET', false], ['cal_per_edit', 'CAL/LIFT', true],
  ['ttft_s', 'TTFT', true],
];

async function loadScores() {
  const el = $('scores');
  if (!el.dataset.loaded) el.textContent = 'scoring past sessions …';
  let d;
  try { d = await (await fetch('/api/scores')).json(); } catch (e) { d = null; }
  if (!d || !d.models) { el.textContent = 'could not score sessions'; return; }
  el.dataset.loaded = '1';
  $('scoresNote').textContent =
    `${d.models.length} athletes over ${d.sessions} sessions${d.total > d.scanned ? ` (newest ${d.scanned} of ${d.total})` : ''}`;
  if (!d.models.length) { el.textContent = 'no sessions to score yet'; return; }

  // mark the best value per column so the table reads as a leaderboard.
  // the server sends null where a metric has no data, so 0 is always real.
  const best = {};
  SCORE_COLS.forEach(([k, , lowerBetter]) => {
    const vals = d.models.map((m) => m[k]).filter((v) => typeof v === 'number');
    if (vals.length > 1) best[k] = lowerBetter ? Math.min(...vals) : Math.max(...vals);
  });

  el.innerHTML = `<table><thead><tr><th>ATHLETE</th>${
    SCORE_COLS.map(([, l]) => `<th>${l}</th>`).join('')}</tr></thead><tbody>${
    d.models.map((m) => `<tr><td class="who">${escape_(m.klass)}<small>${escape_(m.model)}</small></td>${
      SCORE_COLS.map(([k]) => {
        const v = m[k];
        const txt = v == null ? '—' : v;
        const hit = typeof v === 'number' && v === best[k] ? ' class="best"' : '';
        return `<td${hit}>${txt}</td>`;
      }).join('')}</tr>`).join('')}</tbody></table>`;
}

// -------------------------------------------------------------- ask panel

function paintAsk(question) {
  S.question = question || null;
  const on = !!S.question;
  $('askPanel').hidden = !on;
  $('workoutPanel').hidden = on;
  if (on) {
    $('askQ').textContent = S.question;
    $('askText').focus();
  }
}

$('askSend').onclick = async () => {
  const text = $('askText').value.trim();
  if (!text) return;
  const res = await post('/api/answer', {
    text,
    model: $('modelSel').value || null,
    effort: $('effortSel').value,
    sandbox: $('spotterSel').value,
    cwd: S.stats.root,
  });
  if (res.error) { feedRow({ kind: 'note', tone: 'bad', text: 'CANNOT ANSWER: ' + res.error }); return; }
  $('askText').value = '';
  paintAsk(null);
};
$('askSkip').onclick = () => paintAsk(null);
$('askText').onkeydown = (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') $('askSend').click();
};

// ----------------------------------------------------------------- sound

$('sndBtn').onclick = () => {
  const on = !sfx.isEnabled();
  sfx.setEnabled(on);
  $('sndBtn').textContent = on ? 'SOUND ON' : 'SOUND OFF';
  $('sndBtn').setAttribute('aria-pressed', String(on));
  if (on) sfx.play('chalk');
};
// browsers will not start audio without a gesture
document.addEventListener('pointerdown', () => sfx.unlock(), { once: true });

// ----------------------------------------------------------------- intro

const introEl = $('intro');
function showIntro() { introEl.hidden = false; }
function hideIntro() {
  introEl.hidden = true;
  try { localStorage.setItem('codexgym.onboarding.v2', '1'); } catch (e) { /* private mode */ }
}
$('introGo').onclick = hideIntro;
$('helpBtn').onclick = showIntro;
introEl.onclick = (ev) => { if (ev.target === introEl) hideIntro(); };
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && !introEl.hidden) hideIntro();
});
let seen = null;
try { seen = localStorage.getItem('codexgym.onboarding.v2'); } catch (e) { /* ignore */ }
if (!seen) showIntro();

connect();
requestAnimationFrame(frame);
