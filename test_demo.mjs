import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { demoSnapshot, demoTimeline } from './static/demo.js';

const snapshot = demoSnapshot();
const timeline = demoTimeline();
const kinds = timeline.map(({ event }) => event.kind);

assert.equal(snapshot.kind, 'snapshot');
assert.ok(snapshot.zones.some((zone) => zone.equipment.some((item) => item.path === 'src/hello.py')));
assert.equal(snapshot.project?.stage, 0);
assert.deepEqual(kinds.slice(0, 2), ['lifecycle', 'set_start']);
assert.ok(timeline.some(({ event }) => event.kind === 'rep' && event.exercise === 'deadlift' && event.ok));
assert.ok(timeline.some(({ event }) => event.kind === 'equip' && event.path === 'src/hello.py'));
assert.ok(timeline.some(({ event }) => event.kind === 'rep' && event.exercise === 'run' && event.ok));
assert.deepEqual(kinds.slice(-3), ['result', 'lifecycle', 'running']);
assert.ok(timeline.every(({ at }, index) => index === 0 || at > timeline[index - 1].at));
assert.ok(timeline.at(-1).at <= 45000);

const app = readFileSync(new URL('./static/app.js', import.meta.url), 'utf8');
const snapshotCase = app.split("case 'snapshot':", 2)[1].split("case 'floor':", 2)[0];
assert.ok(
  snapshotCase.indexOf("chatEl.innerHTML = ''") < snapshotCase.indexOf('if (m.chat && m.chat.length)')
    && snapshotCase.includes("chatEl.innerHTML = ''"),
  'snapshots must clear old chat before restoring entries',
);
assert.ok(snapshotCase.includes('if (m.project) paintProject(m.project)'), 'snapshots must reset the project pipeline');

const connect = app.split('function connect()', 2)[1].split('// ----------------------------------------------------------------- inputs', 2)[0];
const onmessage = connect.split('es.onmessage =', 2)[1].split('es.onerror', 2)[0];
assert.ok(
  onmessage.indexOf('if (demoRunning) return') < onmessage.indexOf('apply(JSON.parse(ev.data))')
    && onmessage.includes('if (demoRunning) return'),
  'live SSE must pause during the scripted demo',
);
assert.ok(app.includes('let eventSource = null;'), 'the app must own its EventSource');

const runDemo = app.split('async function runDemo()', 2)[1].split("$('demoBtn').onclick", 2)[0];
assert.ok(
  runDemo.indexOf('eventSource.close()') < runDemo.indexOf('apply(demoSnapshot())')
    && runDemo.includes('eventSource.close()') && runDemo.includes('eventSource = null'),
  'the demo must close and clear live SSE before fixture playback',
);
const cleanup = runDemo.split('finally', 2)[1];
assert.ok(
  cleanup.indexOf('connect()') < cleanup.indexOf('button.disabled = false') && cleanup.includes('connect()'),
  'the demo must reconnect before enabling replay',
);
console.log('scripted demo contract OK');
