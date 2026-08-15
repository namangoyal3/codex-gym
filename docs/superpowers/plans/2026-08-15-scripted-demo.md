# Scripted Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic judge demo that works locally and on a static Vercel deployment.

**Architecture:** A small `demo.js` module owns the fixed snapshot and event timeline. The existing `apply()` function consumes every event, so the demo uses the real game UI and animation path.

**Tech Stack:** Browser JavaScript modules, HTML, CSS, Node assertions, Vercel static hosting.

---

### Task 1: Add the scripted demo and static deployment

**Files:**
- Create: `static/demo.js`
- Create: `test_demo.mjs`
- Create: `vercel.json`
- Modify: `static/index.html`
- Modify: `static/app.js`

- [ ] **Step 1: Write the failing demo contract**

Create `test_demo.mjs`. Import `demoSnapshot` and `demoTimeline` from `static/demo.js`.

Assert these requirements:

```js
import assert from 'node:assert/strict';
import { demoSnapshot, demoTimeline } from './static/demo.js';

const snapshot = demoSnapshot();
const timeline = demoTimeline();
const kinds = timeline.map(({ event }) => event.kind);

assert.equal(snapshot.kind, 'snapshot');
assert.ok(snapshot.zones.some((zone) => zone.equipment.some((item) => item.path === 'src/hello.py')));
assert.deepEqual(kinds.slice(0, 2), ['lifecycle', 'set_start']);
assert.ok(timeline.some(({ event }) => event.kind === 'rep' && event.exercise === 'deadlift'));
assert.ok(timeline.some(({ event }) => event.kind === 'equip' && event.path === 'src/hello.py'));
assert.ok(timeline.some(({ event }) => event.kind === 'rep' && event.exercise === 'run' && event.ok));
assert.deepEqual(kinds.slice(-3), ['result', 'lifecycle', 'running']);
assert.ok(timeline.every(({ at }, index) => index === 0 || at > timeline[index - 1].at));
assert.ok(timeline.at(-1).at <= 45000);
console.log('scripted demo contract OK');
```

- [ ] **Step 2: Run the contract and verify the red state**

Run: `node test_demo.mjs`

Expected: FAIL because `static/demo.js` does not exist.

- [ ] **Step 3: Add the fixed demo data**

Create `static/demo.js` with this data shape:

```js
export function demoSnapshot() {
  return {
    kind: 'snapshot',
    zones: [
      { name: 'src', loc: 54, equipment: [
        { path: 'src/hello.py', name: 'hello.py', kind: 'rack', loc: 24, kg: 25 },
        { path: 'src/greetings.py', name: 'greetings.py', kind: 'rack', loc: 30, kg: 30 },
      ] },
      { name: 'tests', loc: 48, equipment: [
        { path: 'tests/test_hello.py', name: 'test_hello.py', kind: 'treadmill', loc: 48, kg: 40 },
      ] },
      { name: 'docs', loc: 18, equipment: [
        { path: 'README.md', name: 'README.md', kind: 'mat', loc: 18, kg: 25 },
      ] },
    ],
    stats: { root: '/demo/codex-gym', repo: 'codex-gym-demo', equipment: 4, zones: 3, loc: 120,
      truncated: 0, kinds: { rack: 2, treadmill: 1, dumbbell: 0, mat: 1, bag: 0 } },
    hud: { athlete: { model: 'gpt-5-codex', klass: 'BUILDER', blurb: 'Builds and verifies product changes.' },
      effort: 'high', spotter: 'workspace-write', stamina: 0.92, tokens: 8200, context: 128000,
      calories: 1840, recovery: 18, credits: '100', set: 0, reps: 0, state: 'IDLE',
      exercise: 'chalk', active_file: '', active_kg: 20 },
    records: { level: 12, streak: 18, heaviest_kg: 90, heaviest_file: 'src/greetings.py',
      volume_lines: 7420, total_reps: 146, total_sets: 42 },
    feed: [{ kind: 'note', tone: 'coach', text: 'DEMO READY · Watch Codex change and verify the project.' }],
    chat: [], running: false, replaying: null, question: null, status: 'idle', result: null,
  };
}

export function demoTimeline() {
  return [
    { at: 300, event: { kind: 'lifecycle', status: 'running' } },
    { at: 800, event: { kind: 'set_start', set: 1 } },
    { at: 1200, event: { kind: 'running', running: true } },
    { at: 2500, event: { kind: 'rep', n: 1, exercise: 'scout', ok: true, kg: 20,
      label: 'READING THE CODE', detail: 'open src/hello.py', path: 'src/hello.py',
      says: 'reading hello.py to understand the current behavior' } },
    { at: 6000, event: { kind: 'rep', n: 2, exercise: 'deadlift', ok: true, kg: 55,
      label: 'EDITING', detail: 'add format_name() and its edge-case handling', path: 'src/hello.py',
      says: 'editing hello.py' } },
    { at: 6900, event: { kind: 'equip', path: 'src/hello.py', loc: 30, kg: 55, prev_kg: 25 } },
    { at: 9800, event: { kind: 'rep', n: 3, exercise: 'run', ok: true, kg: 20,
      label: 'TEST SPRINT', detail: 'python -m unittest · 8 passed', path: 'tests/test_hello.py',
      says: 'running the test suite' } },
    { at: 11000, event: { kind: 'project', project: { git: true, branch: 'demo/codex-gym', dirty: ['src/hello.py'],
      dirty_n: 1, ahead: 1, upstream: true, last_commit: 'demo Add format_name', tests: true,
      stages: [
        { name: 'PLANNED', note: 'task selected' }, { name: 'TRAINING', note: 'code changed' },
        { name: 'SPOTTER', note: 'no blocker' }, { name: 'VERIFY', note: 'tests ran' },
        { name: 'CLEAN', note: 'tests pass' }, { name: 'LOGGED', note: 'commit ready' },
        { name: 'SHIPPED', note: 'ready to push' },
      ], stage: 4 } } },
    { at: 12400, event: { kind: 'record', text: 'TEST SUITE PASSED · 8/8' } },
    { at: 13600, event: { kind: 'set_end', ms: 12800, aborted: false,
      message: 'Added format_name() and verified all 8 tests.' } },
    { at: 14600, event: { kind: 'result', text: 'Feature built. Tests pass. Change ready for review.' } },
    { at: 15400, event: { kind: 'lifecycle', status: 'completed' } },
    { at: 16000, event: { kind: 'running', running: false } },
  ];
}
```

- [ ] **Step 4: Run the contract and verify the green state**

Run: `node test_demo.mjs`

Expected: `scripted demo contract OK`

- [ ] **Step 5: Add the top demo control**

Import both demo exports in `static/app.js`.

Add this button beside `HOW TO PLAY` in `static/index.html`:

```html
<button id="demoBtn" class="btn primary">PLAY 45s DEMO</button>
```

Implement `runDemo()` in `static/app.js` with one active promise and native timers:

```js
let demoRunning = false;
async function runDemo() {
  if (demoRunning) return;
  demoRunning = true;
  const button = $('demoBtn');
  button.disabled = true;
  button.textContent = 'DEMO PLAYING';
  try {
    if (!introEl.hidden) hideIntro();
    apply(demoSnapshot());
    let elapsed = 0;
    for (const step of demoTimeline()) {
      await new Promise((resolve) => setTimeout(resolve, step.at - elapsed));
      elapsed = step.at;
      apply(step.event);
    }
    button.textContent = 'REPLAY DEMO';
  } catch (error) {
    setProofPhase(null, 'DEMO ERROR · Reload the page and try again.');
    button.textContent = 'RETRY DEMO';
  } finally {
    demoRunning = false;
    button.disabled = false;
  }
}
$('demoBtn').onclick = runDemo;
```

Use `location.hostname` to detect `localhost` and `127.0.0.1`. Call `connect()` only for these hosts.

Replace the unconditional `connect()` call with:

```js
if (['localhost', '127.0.0.1'].includes(location.hostname)) connect();
else {
  apply(demoSnapshot());
  $('conn').textContent = 'DEMO';
}
```

- [ ] **Step 6: Add the Vercel root rewrite**

Create `vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "rewrites": [{ "source": "/", "destination": "/static/index.html" }]
}
```

- [ ] **Step 7: Run all checks**

Run:

```bash
node test_demo.mjs
node --check static/demo.js
node --check static/app.js
python3 -B -m unittest -v test_frontend.py
python3 -B server.py --selftest
git diff --check
```

Expected: All commands exit with status 0.

- [ ] **Step 8: Commit the implementation**

```bash
git add static/demo.js test_demo.mjs vercel.json static/index.html static/app.js
git commit -m "Add the scripted judge demo"
```
