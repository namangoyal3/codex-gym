function demoProject(stage) {
  return {
    git: true, branch: 'demo/codex-gym', dirty: [], dirty_n: 0, ahead: 0,
    upstream: true, last_commit: 'demo baseline', tests: null,
    stages: [
      { name: 'PLANNED', note: 'task selected' },
      { name: 'TRAINING', note: 'code changed' },
      { name: 'SPOTTER', note: 'no blocker' },
      { name: 'VERIFY', note: 'tests ran' },
      { name: 'CLEAN', note: 'tests pass' },
      { name: 'LOGGED', note: 'commit ready' },
      { name: 'SHIPPED', note: 'ready to push' },
    ],
    stage,
  };
}

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
    stats: {
      root: '/demo/codex-gym', repo: 'codex-gym-demo', equipment: 4, zones: 3, loc: 120,
      truncated: 0, kinds: { rack: 2, treadmill: 1, dumbbell: 0, mat: 1, bag: 0 },
    },
    hud: {
      athlete: { model: 'gpt-5-codex', klass: 'BUILDER', blurb: 'Builds and verifies product changes.' },
      effort: 'high', spotter: 'workspace-write', stamina: 0.92, tokens: 8200, context: 128000,
      calories: 1840, recovery: 18, credits: '100', set: 0, reps: 0, state: 'IDLE',
      exercise: 'chalk', active_file: '', active_kg: 20,
    },
    records: {
      level: 12, streak: 18, heaviest_kg: 90, heaviest_file: 'src/greetings.py',
      volume_lines: 7420, total_reps: 146, total_sets: 42,
    },
    feed: [{ kind: 'note', tone: 'coach', text: 'DEMO READY · Watch Codex change and verify the project.' }],
    project: demoProject(0),
    chat: [], running: false, replaying: null, question: null, status: 'idle', result: null,
  };
}

export function demoTimeline() {
  return [
    { at: 300, event: { kind: 'lifecycle', status: 'running' } },
    { at: 800, event: { kind: 'set_start', set: 1 } },
    { at: 1200, event: { kind: 'running', running: true } },
    { at: 2500, event: {
      kind: 'rep', n: 1, exercise: 'scout', ok: true, kg: 20,
      label: 'READING THE CODE', detail: 'open src/hello.py', path: 'src/hello.py',
      says: 'reading hello.py to understand the current behavior',
    } },
    { at: 6000, event: {
      kind: 'rep', n: 2, exercise: 'deadlift', ok: true, kg: 55,
      label: 'EDITING', detail: 'add format_name() and its edge-case handling', path: 'src/hello.py',
      says: 'editing hello.py',
    } },
    { at: 6900, event: { kind: 'equip', path: 'src/hello.py', loc: 30, kg: 55, prev_kg: 25 } },
    { at: 9800, event: {
      kind: 'rep', n: 3, exercise: 'run', ok: true, kg: 20,
      label: 'TEST SPRINT', detail: 'python -m unittest · 8 passed', path: 'tests/test_hello.py',
      says: 'running the test suite',
    } },
    { at: 11000, event: { kind: 'project', project: {
      ...demoProject(4), dirty: ['src/hello.py'], dirty_n: 1, ahead: 1,
      last_commit: 'demo Add format_name', tests: true,
    } } },
    { at: 12400, event: { kind: 'record', text: 'TEST SUITE PASSED · 8/8' } },
    { at: 13600, event: {
      kind: 'set_end', ms: 12800, aborted: false,
      message: 'Added format_name() and verified all 8 tests.',
    } },
    { at: 14600, event: { kind: 'result', text: 'Feature built. Tests pass. Change ready for review.' } },
    { at: 15400, event: { kind: 'lifecycle', status: 'completed' } },
    { at: 16000, event: { kind: 'running', running: false } },
  ];
}
