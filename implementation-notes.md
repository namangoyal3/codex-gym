# Implementation notes — Codex Gym

Append-only log of decisions and surprises that are not obvious from the diff.

## Brief

Build the gym equivalent of Claude City (Parth Mittal, 2nd place at the Anthropic
x Elevation Push-to-Prod hackathon): repo becomes an isometric world, agent
telemetry becomes gameplay. Locked choices: hybrid wide-floor plus pushed-in
close-up, control-room scope (dispatch from the UI, not just spectate), and
isometric pixel art.

## Event sources: two schemas, one normalizer

`codex exec --json` and the session rollout files do **not** share a schema.
Verified both against real output rather than assuming:

- Rollout (`~/.codex/sessions/**/rollout-*.jsonl`): `event_msg` / `response_item`
  envelopes, `task_started`, `token_count`, `patch_apply_end` with full
  `unified_diff` bodies, `custom_tool_call`.
- Exec stdout: `thread.started`, `turn.started`, `item.started`,
  `item.completed`, `turn.completed`. Item types are `agent_message`,
  `reasoning`, `command_execution`, `file_change`, `mcp_tool_call`,
  `web_search`, `todo_list`, `error`.

`file_change` is a `FileChangeItem with 6 elements` (id, changes, status,
auto_approved, stdout, stderr) and its changes use the same `add` / `delete` /
`update` + `unified_diff` + `move_path` vocabulary as the rollout — but the exec
stream ships **no diff bodies**. That is why weight deltas for dispatched runs
come from re-measuring the file on disk, not from parsing a diff.

## Bugs found by running it, not by reading it

Each of these survived code review and only appeared under real Codex output.

1. **Tailer died every tick.** `fh.tell()` inside `for line in fh` raises
   `OSError: telling position disabled by next() call`. The `except OSError`
   reset the path, so the gym re-announced "SPECTATING …" forever. Fix: read in
   binary and track a byte offset.

2. **Every event counted twice.** A dispatched run also writes a rollout file, so
   the tailer and the exec stream both fed the same gym — two SET 1s, two SET
   ENDs, duplicate deadlifts. Fix: the spectator stands down while
   `gym.dispatching()`.

3. **Patches classified as overhead press.** The rollout sends the raw patch
   envelope (`*** Begin Patch` / `*** Update File:`), not the string
   `apply_patch`, so `PATCH_RE` missed it and the heaviest lift in the app was
   mislabelled.

4. **Multi-file patches lost all but the first file.** `diff_stats` returned a
   single `(path, added, removed)`. A patch creating three modules produced one
   deadlift and the floor never grew. Fix: `diff_files` returns one entry per
   file and `lift_each` emits a lift for each.

5. **Batch-created files were not credited.** One rescan discovers every new file
   at its final size, so comparing against the floor's current LOC credited
   whichever file was reported first and called the rest "touched". Fix: an
   explicit `baseline` map that `rescan` seeds at 0 for newly-seen paths and only
   `remeasure` updates.

6. **Stamina pinned at 0% showing 372,186 / 258,400 tokens.** I was summing
   `total_token_usage` (lifetime spend), which crosses the context window within
   a few turns. Fix: use `last_token_usage` input+output — current occupancy —
   and clamp to [0,1]. Lifetime output tokens became "calories" instead.

## Correctness details worth keeping

- **Plate maths.** Plates load in pairs and the smallest is 2.5kg, so a real bar
  can only total `20 + 5n`. The first version rounded LOC to 2.5kg and produced
  142.5kg, which is not loadable — the plate greedy left 1.25kg unplaced. Weight
  now rounds to 5kg, and the selftest asserts that every weight the floor can
  produce reconstructs exactly and needs at most 10 plates a side.
- **No plate-count cap.** An arbitrary cap made the displayed total disagree with
  the plates drawn. The loop terminates anyway: each pass removes at least 2.5kg.
- **`lift_detail` is a pure formatter.** It used to call `remeasure` internally,
  so building a log string re-weighed the floor as a side effect. The caller now
  passes the remeasure result in.
- **Dispatch validation.** Model matched against a character allowlist, effort and
  sandbox against fixed tuples, prompt length capped, args passed as a list with
  `shell=False`, `stdin=DEVNULL` (an inherited stdin made Codex wait on "Reading
  additional input from stdin"), and the server binds 127.0.0.1 only.
- **Context window for dispatched runs.** `codex exec --json` never reports it,
  and a hardcoded per-model table would rot silently. `context_window_for()`
  reads the number out of the session's own rollout header instead — a couple of
  lines, once per run.

## Art direction: first attempt was wrong

The first pass was a dark warehouse with thin grey line-art. Correct feedback
from the user: it did not read as a game. The reference's appeal is bright,
saturated and chunky, not moody.

Rewrite: light sports-wood floor, saturated rubber zone mats held well back in
value so equipment is what the eye lands on, and every solid drawn as a
three-faced `box3()` shaded from one base colour — that shading is what makes
flat canvas fills read as objects. Added props (plants, coolers, benches, wall
clock) so the room looks inhabited, and mirrored walls behind.

Rack **height** encodes LOC, which is the move that made Claude City readable:
the floor gains a skyline you can scan. Uprights are neutral steel so the
coloured plates carry the signal.

The athlete is stroked twice — fat in near-black, then in colour — giving one
continuous outline that survives being 30px tall on a bright floor. Idle arms sit
away from the torso; tucked against it, thick limbs merged into one blob.

## Comprehension pass (second round of feedback)

The art was better but still did not teach the viewer. Nothing on screen
explained the metaphor, and at wide zoom the athlete is 30px tall with no focal
point. Added:

- **ARENA panel** — a persistent close-up of the current lift at readable scale,
  reusing the same sprites via `drawStation()` so there is no second set of art
  to keep in sync. The floor answers "where in my repo"; the arena answers "what
  is happening".
- **HOW TO READ THE FLOOR legend** — station glyphs as tiny inline SVGs of the
  real sprites. A colour swatch would have been a lie: stations are told apart by
  shape on the floor.
- **First-run intro** with the five rules, reopenable via RULES.
- **Spotlight** on the active station so the eye lands on the action.
- **Question state.** A set that ends with no reps and a question mark means the
  agent stopped to ask; that now reads as "RE-RACKED — the athlete is asking you
  a question" instead of looking like the workout did nothing.

## Screenshot tooling

Not worth repeating: the Playwright MCP browser reported dpr 0.25 with a 6400px
viewport and duplicated the image on some resizes, and headless Chrome hung with
`--virtual-time-budget` because the SSE stream never lets the network go idle.
Working recipe: resize to 1600x900, navigate, then scale `.hud` by
`innerWidth / 1440` so HUD proportions match a real laptop.

## Layman mode

Requirement added mid-build: a non-technical person should be able to *play* this
and still end up with real code. The barriers were prompt-writing, jargon
(`workspace-write`, `xhigh`), needing a repo, and a log full of shell.

- **Quest board.** Seven goals in plain language. The prompt templates live on
  the server and are filled from the actual floor, so "TEST THE BIG ONE" names
  the player's own heaviest file. Templates never reach the client — the client
  posts a quest id, not a prompt.
- Every generated prompt ends with "make reasonable choices and proceed rather
  than asking questions". Without it the agent frequently stopped to ask, which a
  layman cannot be expected to anticipate.
- **WARM-UP / WORKING SET / HEAVY** replaces model plus effort. The real controls
  still exist behind ADVANCED.
- **Plain-English coach.** Every rep carries a `says` field: "reading the code to
  understand it", "writing a new file, stats.py". The raw command moves to the
  hover title. `plain_english()` takes the filename as an argument rather than
  parsing it back out of the formatted detail — it once reported "editing 35kg"
  by picking the weight-change suffix off the end of the string.
- **+ NEW** scaffolds a real starter project (README, a module, a passing test,
  git init and a first commit) under `~/codex-gym-projects`. Names are matched
  against an allowlist rather than sanitised, and it never overwrites.

Proven end to end: a fresh starter gym, then the single sentence "a function that
turns a number into words, like 12 becomes twelve" on WARM-UP produced 49 lines
of working code plus a passing test.

## HUD layout

The HUD grew past the window: 986px of content on a 1440x810 laptop. Capping the
quest list with a pixel value only moved the problem, and a `vh` cap could not be
verified in the test browser (its viewport reports 3600px tall at dpr 0.25).

The fix is structural, not a magic number: `.workout` stretches to fill its grid
row and `.quests` is `flex: 1 1 auto` with a `min-height`, so the list absorbs
whatever space is left and scrolls when there is none. Verified by measuring
panel bottoms at 1280x720, 1366x768, 1440x810 and 1680x1050 — the quest list
ranges from 89px to 419px and nothing overflows.

## Replay, sound, scores

- **Replay** plays a recorded rollout back through the same normalizer. Real gaps
  between events are kept but clamped to 1.2s, so a 40-minute session stays
  watchable. `Gym.bump()` is the single choke point for records and returns early
  while replaying: crediting history would mint personal bests for work already
  done, and watching one session twice would inflate them twice.
- Replay resolves sessions by basename against the server's own index, so no
  client-supplied path ever reaches `open()`.
- **Sound** is synthesised (`static/sfx.js`) rather than sampled: a demo should
  not depend on assets loading, and a barbell is mostly filtered noise over a low
  thud anyway. The context is created on the first click because browsers refuse
  to start audio otherwise.
- **Scores** needed a real failure signal. Patch success is ~always 100%, so
  CLEAN% measured nothing. The usable signal is in the tool output: Codex prefixes
  shell results with `Script completed` or `Script failed` (21 failures in 2,274
  calls across 40 sessions). Unknown output shapes count as success, so a format
  change cannot invent a floor full of missed reps.
- Finding that also fixed a live gap: reps were emitted on the tool *call*, before
  the result was known, so spectated sessions never showed a missed rep. The call
  is now held and becomes a rep when its output lands, and is flushed on
  `task_complete` so nothing is silently dropped.
- Derived metrics return `null`, not `0`, where there is no data — the leaderboard
  highlights the best value per column and a placeholder zero always won.

## Command unwrapping

Real logs showed harness plumbing instead of commands: Codex sends tool input
either as a shell string or as a JS snippet calling
`tools.exec_command({cmd:"..."})`, and patches arrive as JS string literals where
the body follows the path as a literal `\n`. `command_of()` unwraps all three, and
`exercise_for_input()` classifies the unwrapped command — which also made
`python3 tests/test_calc.py` register as a treadmill sprint rather than a generic
press.

## From stations to buildings

Feedback: "I am not able to do anything in the game", "very difficult to explain
it to someone", "the graphics are very bad — take inspiration from Clash of
Clans". Those turned out to be one problem with one fix.

Measured first, before changing anything:

- A click only printed a log line. There were **zero** camera controls bound —
  no pan, no zoom, no hover.
- A medium repo drew 68 objects (the cap allowed 420). A Clash of Clans base
  shows roughly forty large buildings you tap.

So the floor was a dense readout, not a control surface. The fix was to
aggregate: **one building per folder** instead of one small object per file. That
single change did all three jobs at once — objects got big enough to draw with
real detail, big enough to tap, and the explanation collapsed to one sentence: a
folder is a building, the badge is how many files, the height is how much code.

Art direction taken from the reference rather than its assets:

- Every silhouette is stroked in near-black *before* the faces are filled. That
  outline is what makes flat canvas fills read as chunky toys.
- Roofs overhang and carry a ridge highlight; windows light up; doors are cut in.
- The base sits on grass with dirt plots and water beyond, not a flat floor.
- Height still encodes size, so the base keeps a skyline you can scan.

Interaction added: drag to pan, wheel to zoom anchored on the cursor, hover
highlight, double-click to fit, and tap-a-building for a card listing its files
with an action menu that dispatches a quest scoped to that folder.

Two real bugs came out of it:

- `shade()` only parsed `#rrggbb`. Hovering pre-shaded the wall colour and fed
  the resulting `rgb(...)` string back in, which parsed to `NaN`, so canvas
  silently kept the previous `fillStyle` — the outline colour. Hovered buildings
  rendered with **black faces**. It now accepts both forms.
- The hit target was a circle around each building's base, leaving the top two
  thirds of every tall building dead. It took fourteen synthetic clicks to land
  one. Now it tests the whole silhouette, front to back so the nearer building
  wins, and 44% of the sampled base area is a live target.
- The athlete was drawn after every building and appeared to stand on roofs. It
  is now inserted into the same depth queue as the buildings.

## Open-source graphics: what is actually usable

Verified rather than assumed, because licensing here is a trap.

- **Kenney** packs are genuinely CC0, downloadable, and fine commercially:
  Isometric Tiles City (128 tiles at 132x104, `License.txt` confirms CC0),
  Isometric Tiles Buildings, Modular Buildings, Isometric Medieval Town. The
  city pack is mostly ground and road tiles, so it suits the terrain layer more
  than the buildings.
- **Not usable:** the `coc-assets` / `clash-assets` GitHub repos are Supercell's
  own artwork redistributed under a fan-content policy. Fine for fan tools,
  unusable for anything published. Take the art *direction* from Clash of Clans,
  never its files.

Migrating to sprite sheets is a larger change than it looks: Kenney's tiles are
132x104 against this renderer's 32x16 grid, so the grid, depth sort and anchors
all move. The procedural buildings were upgraded instead, which keeps one
dependency-free file and no asset pipeline.

## Correction: a gym, not a city

I had started migrating to Kenney's CC0 isometric city/buildings sprites — pack
downloaded, geometry measured, modular stackable storeys confirmed. The user
stopped it: "it should be a gym version in the game and not the city version."

Correct call. Generic city buildings would have made this Claude City with a
different name, and the whole vocabulary here is gym — deadlift, treadmill,
plates, kg. No CC0 pack contains isometric gym equipment, so the art stays
procedural.

What survived from the base-builder structure, because that part was right:
a handful of large tappable objects, one per folder, each with a level badge, a
status ring, and an action menu. What changed is what the object *is*. No walls,
no roofs — a coloured rubber pad with real equipment standing on it:

| Folder holds | Station |
|--------------|---------|
| source code | power rack: platform, four uprights, loaded bar, plate tree |
| tests | cardio bank: up to four treadmills, belts animating |
| config | dumbbell rack: two tiers of colour-coded pairs |
| docs | stretch studio: framed mirror, mats, exercise ball, foam roller |
| html / css | boxing ring: raised canvas, corner posts, three rows of ropes |

Bar load and upright height scale with lines of code, so the plate stacks read as
"how much code" at a glance — the same signal building height carried, but in the
gym's own language. The ground became a light sports-hall floor with painted
walkway lines and ceiling light pools, with concrete beyond it.

The stretch studio's first mirror was a 40-unit slab that rendered as a blank
white box and dominated the whole station. It is now a low framed panel with a
reflective gradient.

Hit testing keys off a per-kind nominal height rather than a building height, so
tall power racks stay clickable to their top bar. Measured after the change: 58%
of the sampled floor is a live target and all eight stations in the test repo are
reachable with the right station type.

## The walk animation had never played

Reported as "not a single motion graphic when the character walks to a particular
space", and it was exactly true.

`Animator.tick` restarted a looping cycle forever:

    if (cur.loop && !this.queue.length) { cur.t = 0; u = 0; }

Nothing in that branch re-read `this.idle`. The animator starts on `racked`,
which loops, so it locked into `racked` on the first frame and `setIdle('scout')`
could never take effect for the rest of the session. Every walk was a slide with
a standing pose.

Three fixes: `setIdle` now drops a looping `current` so the swap is immediate; the
loop branch only restarts while `this.idle === cur.ex`; and the run/scout cycles
close on their first frame (`run1..run4,run1`) so the loop does not snap. The
lifter also mirrors to face its heading.

Related: the lifter used to fall back to standing between reps, so a running set
looked like a statue with occasional twitches. While a set is live the idle is now
the current exercise, so it keeps lifting the way a builder keeps hammering, and
arriving at a station hands it back to the right activity rather than always to
`racked`.

Verified by sampling the exercise label across a walk: `WALKING THE FLOOR` now
appears between two stations, where before only `RACKED` was ever reachable.

## Chat: commands from the game, Codex in the terminal

A CHAT tab where each message runs `codex exec` in the project and the replies
come back as bubbles, while the floor animates the work.

Continuity comes from `codex exec resume <session-id>`, and that subcommand takes
a **strict subset** of the flags — it rejects `-C` and `-s` outright. Passing them
made every follow-up die with `unexpected argument '-C' found`, which showed up as
a turn that finished in five seconds having done nothing. The argv build moved
into a pure `exec_cmd()` so the selftest can assert that a resume carries neither
flag and that the session id sits immediately before the prompt. A resumed session
keeps the working directory and sandbox it started with, which is the right
default anyway.

If a resume fails because the session is gone, the endpoint falls back to starting
a fresh one rather than dropping the message.

Proven across two turns: "add pluralise(word, n)... " then "now also handle n being
zero the same way" — the agent answered "`pluralise` already covers `0` because it
only keeps the singular form for `1`" without the name being restated, and the
test file gained the `0` case. Three tests pass.
