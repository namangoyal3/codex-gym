import * as THREE from './vendor/three.module.min.js';

export const EXERCISE_STATES = Object.freeze({
  idle: 'idle', chalk: 'chalk', scout: 'scout', deadlift: 'deadlift',
  bench: 'bench', press: 'press', run: 'run', fail: 'fail', pr: 'pr',
});

const ALIASES = Object.freeze({ racked: 'idle', walk: 'scout', sprint: 'run', squat: 'deadlift' });
export const normalizeExercise = (name) => EXERCISE_STATES[name] || ALIASES[name] || 'idle';

const mat = (color, roughness = 0.75, metalness = 0) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness });

function mesh(geometry, material, parent, position = [0, 0, 0]) {
  const item = new THREE.Mesh(geometry, material);
  item.position.set(...position);
  item.castShadow = item.receiveShadow = true;
  parent.add(item);
  return item;
}

function limb(parent, material, length, radius = 0.12) {
  const pivot = new THREE.Group();
  parent.add(pivot);
  const part = mesh(new THREE.CapsuleGeometry(radius, length - radius * 2, 5, 8), material, pivot, [0, -length / 2, 0]);
  return { pivot, part };
}

function buildAthlete(scene) {
  const root = new THREE.Group();
  scene.add(root);
  const skin = mat(0xb97850), kit = mat(0xd83b32), shorts = mat(0x192633), shoe = mat(0xe8eee9);
  const hips = new THREE.Group(); root.add(hips); hips.position.y = 1.65;
  mesh(new THREE.BoxGeometry(.62, .38, .38), shorts, hips);
  const torso = mesh(new THREE.CapsuleGeometry(.31, .72, 6, 10), kit, hips, [0, .72, 0]);
  const head = mesh(new THREE.SphereGeometry(.27, 16, 12), skin, hips, [0, 1.55, 0]);
  mesh(new THREE.SphereGeometry(.275, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x231a17), head, [0, .04, 0]);

  const legs = [-1, 1].map((side) => {
    const upper = limb(hips, skin, .72, .15); upper.pivot.position.set(side * .2, -.12, 0);
    const lower = limb(upper.pivot, skin, .68, .12); lower.pivot.position.y = -.7;
    const foot = mesh(new THREE.BoxGeometry(.25, .13, .43), shoe, lower.pivot, [0, -.7, .1]);
    return { upper: upper.pivot, lower: lower.pivot, foot };
  });
  const arms = [-1, 1].map((side) => {
    const upper = limb(hips, skin, .62, .12); upper.pivot.position.set(side * .39, 1.15, 0);
    const lower = limb(upper.pivot, skin, .58, .1); lower.pivot.position.y = -.6;
    return { upper: upper.pivot, lower: lower.pivot };
  });
  return { root, hips, torso, head, legs, arms };
}

function buildGym(scene) {
  const steel = mat(0x495762, .35, .65), pad = mat(0x223747), rubber = mat(0x151b1e);
  const floor = mesh(new THREE.CircleGeometry(4.8, 48), mat(0x26373b), scene);
  floor.rotation.x = -Math.PI / 2;
  const bar = mesh(new THREE.CylinderGeometry(.045, .045, 2.25, 12), steel, scene, [0, .42, .25]); bar.rotation.z = Math.PI / 2;
  [-1, 1].forEach((s) => mesh(new THREE.CylinderGeometry(.3, .3, .15, 18), mat(0xc33b32), bar, [0, s * .92, 0]).rotation.x = Math.PI / 2);
  const bench = new THREE.Group(); scene.add(bench);
  mesh(new THREE.BoxGeometry(.55, .15, 1.7), pad, bench, [0, .55, 0]);
  mesh(new THREE.BoxGeometry(.12, .55, .12), steel, bench, [0, .28, .55]);
  mesh(new THREE.BoxGeometry(.12, .55, .12), steel, bench, [0, .28, -.55]);
  const rack = new THREE.Group(); scene.add(rack);
  [-1, 1].forEach((s) => mesh(new THREE.BoxGeometry(.1, 2.3, .1), steel, rack, [s * 1.1, 1.15, 0]));
  mesh(new THREE.BoxGeometry(2.3, .1, .1), steel, rack, [0, 2.25, 0]);
  const treadmill = new THREE.Group(); scene.add(treadmill);
  mesh(new THREE.BoxGeometry(1, .16, 2.25), rubber, treadmill, [0, .12, 0]);
  mesh(new THREE.BoxGeometry(1.1, .07, 2.0), mat(0x253239), treadmill, [0, .22, 0]);
  return { floor, bar, bench, rack, treadmill };
}

export function createAthlete3D(canvas) {
  if (!(canvas instanceof HTMLCanvasElement)) throw new TypeError('createAthlete3D requires a canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene(); scene.fog = new THREE.Fog(0x091a20, 7, 13);
  const camera = new THREE.PerspectiveCamera(34, 1, .1, 30); camera.position.set(4.6, 3.1, 6.3); camera.lookAt(0, 1.15, 0);
  scene.add(new THREE.HemisphereLight(0xc4f2ff, 0x142027, 2.2));
  const key = new THREE.DirectionalLight(0xffdfba, 3.4); key.position.set(3, 6, 4); key.castShadow = true; scene.add(key);
  const gym = buildGym(scene), athlete = buildAthlete(scene);
  let state = 'idle', elapsed = 0, intensity = 1, disposed = false;

  function setExercise(name, options = {}) {
    state = normalizeExercise(String(name || '').toLowerCase());
    intensity = Math.max(.25, Math.min(2.5, Number(options.intensity) || 1));
    if (options.color != null) athlete.torso.material.color.set(options.color);
    elapsed = options.restart === false ? elapsed : 0;
  }

  function resize() {
    const width = canvas.clientWidth || canvas.width || 1, height = canvas.clientHeight || canvas.height || 1;
    if (canvas.width !== Math.round(width * renderer.getPixelRatio()) || canvas.height !== Math.round(height * renderer.getPixelRatio())) renderer.setSize(width, height, false);
    camera.aspect = width / height; camera.updateProjectionMatrix();
  }

  function render(dt = 1 / 60) {
    if (disposed) return;
    dt = Math.min(Number(dt) > 1 ? Number(dt) / 1000 : Number(dt), .1) || 0;
    elapsed += dt * intensity;
    const s = Math.sin(elapsed * 3), rep = (1 - Math.cos(elapsed * 5)) / 2;
    const { root, hips, head, arms, legs } = athlete;
    root.position.set(0, 0, 0); root.rotation.set(0, 0, 0); hips.position.y = 1.65;
    arms.forEach((a, i) => { a.upper.rotation.set(0, 0, (i ? 1 : -1) * .12); a.lower.rotation.set(0, 0, 0); });
    legs.forEach((l) => { l.upper.rotation.x = 0; l.lower.rotation.x = 0; });
    gym.bar.visible = ['deadlift', 'bench', 'press', 'fail', 'pr'].includes(state);
    gym.bench.visible = state === 'bench'; gym.rack.visible = state === 'press'; gym.treadmill.visible = state === 'run';
    gym.bar.position.set(0, .42, .25); gym.bar.rotation.set(0, 0, Math.PI / 2);

    if (state === 'idle') { hips.position.y += s * .025; head.rotation.y = s * .12; }
    if (state === 'chalk') { arms[0].upper.rotation.z = -1.4; arms[1].upper.rotation.z = 1.4; arms[0].lower.rotation.z = .9 + s * .25; arms[1].lower.rotation.z = -.9 - s * .25; }
    if (state === 'scout') { root.position.x = Math.sin(elapsed) * 1.2; root.rotation.y = Math.cos(elapsed) * .35; head.rotation.y = s * .35; }
    if (state === 'run') {
      legs.forEach((l, i) => { const phase = s * (i ? -1 : 1); l.upper.rotation.x = phase * .75; l.lower.rotation.x = Math.max(0, -phase) * .9; });
      arms.forEach((a, i) => a.upper.rotation.x = s * (i ? 1 : -1) * .7); hips.position.y += Math.abs(s) * .08;
    }
    if (state === 'deadlift' || state === 'pr') {
      const lift = state === 'pr' ? Math.min(1, elapsed * .7) : rep;
      hips.rotation.x = (1 - lift) * -.75; hips.position.y -= (1 - lift) * .45; gym.bar.position.y = .42 + lift * 1.15;
      arms.forEach((a, i) => { a.upper.rotation.x = -.55; a.upper.rotation.z = (i ? 1 : -1) * .15; });
      if (state === 'pr' && lift === 1) { root.rotation.y = s * .08; head.rotation.x = -.2; }
    }
    if (state === 'bench') {
      root.rotation.x = -Math.PI / 2; root.position.set(0, .62, .65); hips.position.y = .7;
      arms.forEach((a, i) => { a.upper.rotation.z = (i ? 1 : -1) * (1.15 - rep * .5); a.lower.rotation.z = (i ? -1 : 1) * .8; });
      gym.bar.position.set(0, 1.25 + rep * .65, .05);
    }
    if (state === 'press') { arms.forEach((a, i) => { a.upper.rotation.z = (i ? 1 : -1) * (1.15 - rep * 1.05); a.lower.rotation.z = (i ? -1 : 1) * (.8 - rep * .7); }); gym.bar.position.y = 2.45 + rep * .65; }
    if (state === 'fail') { root.rotation.z = -.72 * Math.min(1, elapsed * 1.8); root.position.y = -.25 * Math.min(1, elapsed * 1.8); gym.bar.position.set(.8, .3, .3); }
    resize(); renderer.render(scene, camera);
  }

  function dispose() {
    if (disposed) return; disposed = true;
    scene.traverse((item) => { item.geometry?.dispose(); if (Array.isArray(item.material)) item.material.forEach((m) => m.dispose()); else item.material?.dispose(); });
    renderer.dispose();
  }

  return { setExercise, resize, render, dispose };
}

