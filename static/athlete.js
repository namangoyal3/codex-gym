// The athlete: a side-profile pixel lifter, posed from keyframes.
// Every joint is an [x, y] in local units with y pointing UP from the feet, so
// poses are readable as data and interpolate without any angle maths.

const J = ['ankleB', 'kneeB', 'ankleF', 'kneeF', 'hip', 'neck', 'head', 'shoulder', 'elbow', 'hand'];

function P(o) {
  return {
    ankleB: [-2, 0], kneeB: [-2, 9], ankleF: [2, 0], kneeF: [2, 9],
    hip: [0, 17], neck: [0, 28], head: [0, 33], shoulder: [0, 27],
    elbow: [1, 21], hand: [2, 16], bar: null, ...o,
  };
}

const POSES = {
  // idle arms sit away from the torso: at 30px tall, limbs tucked against the
  // body merge with it into one unreadable blob
  stand: P({ elbow: [7, 21], hand: [9, 16] }),
  breatheIn: P({ neck: [0, 29], head: [0, 34], shoulder: [0, 28], elbow: [8, 22], hand: [10, 17] }),
  racked: P({ elbow: [9, 23], hand: [5, 17] }),          // hands on hips

  squatTop: P({ elbow: [-4, 25], hand: [-7, 28], bar: [0, 28] }),
  squatBottom: P({
    hip: [-2, 9], kneeF: [7, 7], ankleF: [3, 0], kneeB: [-6, 7], ankleB: [-4, 0],
    neck: [-2, 20], head: [-2, 25], shoulder: [-2, 19], elbow: [-6, 17], hand: [-9, 20],
    bar: [-2, 20],
  }),

  deadBottom: P({
    hip: [-4, 12], kneeF: [4, 8], ankleF: [2, 0], kneeB: [-5, 8], ankleB: [-3, 0],
    neck: [3, 20], head: [6, 22], shoulder: [3, 19], elbow: [4, 11], hand: [5, 4],
    bar: [5, 4],
  }),
  deadMid: P({
    hip: [-2, 15], kneeF: [3, 9], ankleF: [2, 0], kneeB: [-3, 9], ankleB: [-2, 0],
    neck: [1, 25], head: [3, 29], shoulder: [1, 24], elbow: [2, 17], hand: [3, 10],
    bar: [3, 10],
  }),
  deadTop: P({ elbow: [2, 21], hand: [3, 15], bar: [3, 15] }),

  pressDown: P({ elbow: [-5, 24], hand: [-6, 28], bar: [0, 28] }),
  pressUp: P({ shoulder: [0, 28], elbow: [-3, 33], hand: [-2, 39], bar: [0, 39] }),

  // lying on the bench: torso runs along x, head to the left, press goes up
  benchDown: P({
    ankleB: [7, 0], kneeB: [4, 8], ankleF: [10, 1], kneeF: [6, 9],
    hip: [-1, 10], neck: [-9, 11], head: [-13, 11], shoulder: [-8, 12],
    elbow: [-9, 16], hand: [-6, 14], bar: [-6, 14],
  }),
  benchUp: P({
    ankleB: [7, 0], kneeB: [4, 8], ankleF: [10, 1], kneeF: [6, 9],
    hip: [-1, 10], neck: [-9, 11], head: [-13, 11], shoulder: [-8, 12],
    elbow: [-7, 18], hand: [-6, 23], bar: [-6, 23],
  }),

  run1: P({
    kneeF: [5, 10], ankleF: [8, 3], kneeB: [-4, 9], ankleB: [-7, 1],
    elbow: [3, 22], hand: [5, 18],
  }),
  run2: P({ kneeF: [2, 10], ankleF: [2, 1], kneeB: [0, 9], ankleB: [-2, 4], elbow: [0, 22], hand: [0, 18] }),
  run3: P({
    kneeB: [5, 10], ankleB: [8, 3], kneeF: [-4, 9], ankleF: [-7, 1],
    elbow: [-3, 22], hand: [-5, 18],
  }),
  run4: P({ kneeB: [2, 10], ankleB: [2, 1], kneeF: [0, 9], ankleF: [-2, 4], elbow: [0, 22], hand: [0, 18] }),

  chalkOpen: P({ elbow: [5, 22], hand: [7, 24] }),
  chalkClap: P({ elbow: [3, 22], hand: [1, 24] }),

  fail: P({
    hip: [-5, 13], kneeF: [3, 8], ankleF: [4, 0], kneeB: [-8, 7], ankleB: [-9, 0],
    neck: [-6, 23], head: [-8, 26], shoulder: [-6, 22], elbow: [-9, 18], hand: [-10, 14],
    bar: [7, 1],
  }),
};

// exercise -> keyframe cycle. `dur` is one full rep in ms.
const CYCLES = {
  deadlift: { keys: ['deadBottom', 'deadMid', 'deadTop', 'deadMid', 'deadBottom'], dur: 1500, station: 'floor' },
  squat: { keys: ['squatTop', 'squatBottom', 'squatTop'], dur: 1400, station: 'rack' },
  bench: { keys: ['benchDown', 'benchUp', 'benchDown'], dur: 1300, station: 'bench' },
  press: { keys: ['pressDown', 'pressUp', 'pressDown'], dur: 1200, station: 'rack' },
  run: { keys: ['run1', 'run2', 'run3', 'run4', 'run1'], dur: 700, station: 'treadmill', loop: true },
  scout: { keys: ['run1', 'run2', 'run3', 'run4', 'run1'], dur: 1000, station: 'floor', loop: true },
  chalk: { keys: ['chalkOpen', 'chalkClap', 'chalkOpen'], dur: 900, station: 'floor', loop: true },
  racked: { keys: ['racked', 'breatheIn', 'racked'], dur: 2600, station: 'floor', loop: true },
  pr: { keys: ['deadTop', 'pressUp', 'deadTop'], dur: 1600, station: 'floor' },
  fail: { keys: ['deadMid', 'fail', 'fail'], dur: 1500, station: 'floor' },
};

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function lerpPose(a, b, t) {
  const out = {};
  J.forEach((k) => {
    out[k] = [a[k][0] + (b[k][0] - a[k][0]) * t, a[k][1] + (b[k][1] - a[k][1]) * t];
  });
  if (a.bar && b.bar) out.bar = [a.bar[0] + (b.bar[0] - a.bar[0]) * t, a.bar[1] + (b.bar[1] - a.bar[1]) * t];
  else out.bar = b.bar || a.bar || null;
  return out;
}

// ------------------------------------------------------------- animator

export class Animator {
  constructor() {
    this.queue = [];
    this.current = null;       // {ex, t, dur}
    this.idle = 'racked';
    this.pose = POSES.stand;
    this.puffs = [];
    this.repFlash = 0;
  }

  // a rep landed: play one cycle of it. Fast-forward if we're falling behind
  // reality, so the athlete stays in sync with the agent instead of lagging.
  push(ex) {
    if (!CYCLES[ex]) ex = 'press';
    this.queue.push(ex);
    if (this.queue.length > 4) this.queue.splice(0, this.queue.length - 4);
  }

  // Switching the idle has to interrupt a looping cycle. A loop used to restart
  // forever without ever re-reading `idle`, so the lifter locked into "racked"
  // and the walk cycle never played once.
  setIdle(ex) {
    const next = CYCLES[ex] ? ex : 'racked';
    if (next === this.idle) return;
    this.idle = next;
    if (this.current && this.current.loop) this.current = null;
  }

  station() {
    const ex = this.current ? this.current.ex : this.idle;
    return (CYCLES[ex] || CYCLES.racked).station;
  }

  exercise() { return this.current ? this.current.ex : this.idle; }

  tick(dt) {
    if (!this.current) {
      const next = this.queue.shift();
      const ex = next || this.idle;
      const c = CYCLES[ex] || CYCLES.racked;
      // backlog of reps means the agent is moving fast; the lifter speeds up
      const rush = Math.max(0.45, 1 - this.queue.length * 0.18);
      this.current = { ex, t: 0, dur: c.dur * rush, loop: !!c.loop && !next };
    }
    const cur = this.current;
    const c = CYCLES[cur.ex] || CYCLES.racked;
    cur.t += dt;
    let u = cur.t / cur.dur;
    if (u >= 1) {
      // only keep looping while this really is still the idle we want
      if (cur.loop && !this.queue.length && this.idle === cur.ex) { cur.t = 0; u = 0; }
      else { this.current = null; u = 1; }
    }
    const keys = c.keys;
    const span = 1 / (keys.length - 1);
    const i = Math.min(keys.length - 2, Math.floor(u / span));
    const local = ease(Math.min(1, Math.max(0, (u - i * span) / span)));
    this.pose = lerpPose(POSES[keys[i]], POSES[keys[i + 1]], local);

    if (cur.ex === 'chalk' && u > 0.45 && u < 0.55 && this.puffs.length < 14) {
      for (let k = 0; k < 4; k++) {
        this.puffs.push({ x: 1, y: 24, vx: (Math.random() - 0.5) * 8, vy: Math.random() * 6 + 2, life: 1 });
      }
    }
    if (this.repFlash > 0) this.repFlash -= dt / 260;
    this.puffs.forEach((p) => {
      p.x += p.vx * dt / 1000; p.y += p.vy * dt / 1000; p.vy -= dt / 90; p.life -= dt / 700;
    });
    this.puffs = this.puffs.filter((p) => p.life > 0);
    return this.pose;
  }

  flash() { this.repFlash = 1; }
}

// --------------------------------------------------------------- drawing

const KIT = {
  POWERLIFTER: { singlet: '#e03b2f', trim: '#7a1c14' },
  STRONGMAN: { singlet: '#2f6fe0', trim: '#173c7c' },
  BODYBUILDER: { singlet: '#ffb020', trim: '#8a5a08' },
  OLYMPIC: { singlet: '#3fa85a', trim: '#1e5c31' },
  SPRINTER: { singlet: '#2fd3c4', trim: '#146b63' },
  SPECIALIST: { singlet: '#a06fe0', trim: '#4d2f74' },
  LIFTER: { singlet: '#8a97a0', trim: '#4c565d' },
};
const SKIN = '#c98f5f', SKIN_DK = '#9c6b42', HAIR = '#211a16', SHOE = '#e8f2f0';

const OUTLINE = '#1b1410';

function shadeHex(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const m = (v) => Math.max(0, Math.min(255, Math.round(f < 1 ? v * f : v + (255 - v) * (f - 1))));
  return `rgb(${m(r)},${m(g)},${m(b)})`;
}

function limb(ctx, a, b, w, color, ox, oy, s) {
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, w);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(Math.round(ox + a[0] * s), Math.round(oy - a[1] * s));
  ctx.lineTo(Math.round(ox + b[0] * s), Math.round(oy - b[1] * s));
  ctx.stroke();
}

// Thick limbs and a big head: a chunky silhouette survives being 30px tall on a
// bright floor, where a thin stick figure just disappears.
const W = { torso: 7.5, thigh: 5.5, shin: 4.2, upperArm: 4, foreArm: 3.4, foot: 4, head: 7 };
const SHORTS = '#2b3340';   // legs read separately from the singlet

// Every part is stroked twice - once fat in near-black, then in colour - which
// gives the sprite one continuous outline and keeps it readable over anything.
function body(ctx, p, x, y, s, kit, outline) {
  const pad = outline ? 2.0 * s : 0;
  const col = (c) => (outline ? OUTLINE : c);

  limb(ctx, p.hip, p.kneeB, W.thigh * s + pad, col(shadeHex(SHORTS, 0.7)), x, y, s);
  limb(ctx, p.kneeB, p.ankleB, W.shin * s + pad, col(SKIN_DK), x, y, s);
  limb(ctx, p.ankleB, [p.ankleB[0] + 3.5, p.ankleB[1]], W.foot * s + pad, col('#7d878e'), x, y, s);

  limb(ctx, p.hip, p.neck, W.torso * s + pad, col(kit.singlet), x, y, s);

  limb(ctx, p.hip, p.kneeF, W.thigh * s + pad, col(SHORTS), x, y, s);
  limb(ctx, p.kneeF, p.ankleF, W.shin * s + pad, col(SKIN), x, y, s);
  limb(ctx, p.ankleF, [p.ankleF[0] + 3.5, p.ankleF[1]], W.foot * s + pad, col(SHOE), x, y, s);

  const hx = Math.round(x + p.head[0] * s), hy = Math.round(y - p.head[1] * s);
  const hr = (W.head * s + pad) / 2;
  ctx.fillStyle = col(SKIN);
  ctx.beginPath();
  ctx.ellipse(hx, hy, hr, hr * 1.05, 0, 0, Math.PI * 2);
  ctx.fill();

  limb(ctx, p.shoulder, p.elbow, W.upperArm * s + pad, col(SKIN), x, y, s);
  limb(ctx, p.elbow, p.hand, W.foreArm * s + pad, col(SKIN), x, y, s);
}

export function drawAthlete(ctx, x, y, pose, opts) {
  const o = opts || {};
  const s = o.scale || 1;
  if (o.flip) {                     // mirror so the lifter faces their heading
    ctx.save();
    ctx.translate(x * 2, 0);
    ctx.scale(-1, 1);
  }
  const kit = KIT[(o.klass || 'LIFTER').split(' ')[0]] || KIT.LIFTER;
  const p = pose;

  ctx.save();
  ctx.globalAlpha = 0.28;                                   // warm ground shadow
  ctx.fillStyle = '#4a3a26';
  ctx.beginPath();
  ctx.ellipse(x, y + 1, 11 * s, 5 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  body(ctx, p, x, y, s, kit, true);                         // outline pass
  body(ctx, p, x, y, s, kit, false);                        // colour pass

  const hx = Math.round(x + p.head[0] * s), hy = Math.round(y - p.head[1] * s);
  const hr = W.head * s / 2;
  ctx.fillStyle = HAIR;                                     // hair cap
  ctx.beginPath();
  ctx.ellipse(hx, hy - hr * 0.45, hr * 0.98, hr * 0.62, 0, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = OUTLINE;                                  // eye
  ctx.fillRect(hx + hr * 0.2, hy - hr * 0.1, Math.max(1, 1.4 * s), Math.max(1, 1.6 * s));

  if (p.bar) {
    const bx = Math.round(x + p.bar[0] * s), by = Math.round(y - p.bar[1] * s);
    ctx.fillStyle = OUTLINE;
    ctx.fillRect(bx - 19 * s, by - 2.4 * s, 38 * s, 4.8 * s);
    ctx.fillStyle = '#cfd8de';
    ctx.fillRect(bx - 18 * s, by - 1.6 * s, 36 * s, 3.2 * s);
    ctx.fillStyle = '#f2f6f8';
    ctx.fillRect(bx - 18 * s, by - 1.6 * s, 36 * s, 1.2 * s);

    const cols = { 25: '#e8452f', 20: '#2f7fe8', 15: '#f2c53d', 10: '#46b95c', 5: '#f4f8f8', 2.5: '#39424a' };
    let off = 0;
    (o.plates || []).slice(0, 6).forEach((pl) => {
      const r = (5 + (pl / 25) * 7) * s;
      [-1, 1].forEach((dir) => {
        const px = bx + dir * (13 * s + off);
        ctx.fillStyle = OUTLINE;
        ctx.beginPath();
        ctx.ellipse(px, by, 2.6 * s, r + 1.2 * s, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = cols[pl] || '#8a97a0';
        ctx.beginPath();
        ctx.ellipse(px, by, 1.8 * s, r, 0, 0, Math.PI * 2);
        ctx.fill();
      });
      off += 4.2 * s;
    });
  }

  (o.puffs || []).forEach((pf) => {                         // chalk dust
    ctx.globalAlpha = Math.max(0, pf.life) * 0.8;
    ctx.fillStyle = '#fdfbf4';
    ctx.beginPath();
    ctx.ellipse(Math.round(x + pf.x * s), Math.round(y - pf.y * s), 1.8 * s, 1.8 * s, 0, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
  if (o.flip) ctx.restore();
}

export { POSES, CYCLES };
