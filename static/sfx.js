// Gym sound, synthesised. No audio files: a hackathon demo should not depend on
// assets loading, and a barbell is mostly noise plus a low thud anyway.
//
// Browsers refuse to start audio without a gesture, so the context is created
// on the first click and stays muted until then.

let ctx = null;
let master = null;
let enabled = true;
let noiseBuf = null;

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);

  // one second of white noise, reused by every percussive sound
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return ctx;
}

export function unlock() {
  const c = ensure();
  if (c && c.state === 'suspended') c.resume();
}

export function setEnabled(v) {
  enabled = v;
  if (master) master.gain.value = v ? 0.5 : 0;
}

export function isEnabled() { return enabled; }

function tone(freq, dur, type, gain, slideTo, delay) {
  const c = ensure();
  if (!c || !enabled) return;
  const t0 = c.currentTime + (delay || 0);
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type || 'sine';
  o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain == null ? 0.3 : gain, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

function noise(dur, gain, freq, q, delay, type) {
  const c = ensure();
  if (!c || !enabled) return;
  const t0 = c.currentTime + (delay || 0);
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  const f = c.createBiquadFilter();
  f.type = type || 'bandpass';
  f.frequency.value = freq || 1200;
  f.Q.value = q || 1;
  const g = c.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain == null ? 0.25 : gain, t0 + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

// ------------------------------------------------------------------ voices

const VOICE = {
  // plates settling on the platform: body thud plus metal ring
  deadlift() {
    tone(64, 0.34, 'sine', 0.5, 34);
    noise(0.09, 0.3, 2600, 3);
    noise(0.3, 0.12, 5200, 6, 0.03);
    tone(220, 0.22, 'triangle', 0.1, 180, 0.02);
  },
  squat() { VOICE.deadlift(); },
  press() {                                   // lighter clink
    tone(150, 0.14, 'triangle', 0.22, 120);
    noise(0.07, 0.16, 3200, 4);
  },
  bench() {
    tone(96, 0.2, 'sine', 0.3, 70);
    noise(0.12, 0.2, 1800, 3);
  },
  run() {                                     // treadmill footfalls
    for (let i = 0; i < 3; i++) noise(0.06, 0.14, 320, 1.5, i * 0.11, 'lowpass');
  },
  scout() { noise(0.05, 0.07, 700, 1.2); },   // footstep
  chalk() {                                   // hands clap, dust
    noise(0.05, 0.22, 2200, 1.4);
    noise(0.16, 0.08, 6000, 1, 0.02, 'highpass');
  },
  fail() {                                    // bar dropped
    tone(150, 0.5, 'sawtooth', 0.28, 42);
    noise(0.34, 0.3, 900, 1.2);
    noise(0.5, 0.16, 3200, 2, 0.05);
  },
  pr() {                                      // personal best fanfare
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.2, 'square', 0.16, null, i * 0.07));
  },
  setStart() {                                // coach's whistle
    tone(1180, 0.16, 'square', 0.12, 1320);
    tone(1320, 0.1, 'square', 0.1, null, 0.14);
  },
  setEnd() {
    tone(420, 0.16, 'sine', 0.16, 300);
    tone(300, 0.24, 'sine', 0.14, 220, 0.14);
  },
  asking() {                                  // needs your attention
    tone(760, 0.14, 'square', 0.16);
    tone(560, 0.2, 'square', 0.16, null, 0.16);
  },
  weight() { noise(0.1, 0.18, 1500, 3); },     // plate added to a bar
};

export function play(name) {
  const v = VOICE[name];
  if (v && enabled) {
    try { v(); } catch (e) { /* audio is never worth breaking the app for */ }
  }
}
