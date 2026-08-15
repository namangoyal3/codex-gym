import assert from 'node:assert/strict';
import { demoSnapshot, demoTimeline } from './static/demo.js';

const snapshot = demoSnapshot();
const timeline = demoTimeline();
const kinds = timeline.map(({ event }) => event.kind);

assert.equal(snapshot.kind, 'snapshot');
assert.ok(snapshot.zones.some((zone) => zone.equipment.some((item) => item.path === 'src/hello.py')));
assert.deepEqual(kinds.slice(0, 2), ['lifecycle', 'set_start']);
assert.ok(timeline.some(({ event }) => event.kind === 'rep' && event.exercise === 'deadlift' && event.ok));
assert.ok(timeline.some(({ event }) => event.kind === 'equip' && event.path === 'src/hello.py'));
assert.ok(timeline.some(({ event }) => event.kind === 'rep' && event.exercise === 'run' && event.ok));
assert.deepEqual(kinds.slice(-3), ['result', 'lifecycle', 'running']);
assert.ok(timeline.every(({ at }, index) => index === 0 || at > timeline[index - 1].at));
assert.ok(timeline.at(-1).at <= 45000);
console.log('scripted demo contract OK');
