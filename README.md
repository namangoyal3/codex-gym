# Codex Gym

Your repo is a gym. Your Codex agent is the athlete. You watch it train, in real time.

Codex Gym turns a repository into a gym floor you can tap. Every folder becomes a
training station — source code gets a power rack, tests get a bank of treadmills,
config gets a dumbbell rack, docs get a stretch studio, markup gets a boxing
ring. The badge on the sign is how many files are inside, and the bigger and more
loaded the station, the more code it holds. Tap one and the agent goes to work
there. Every tool call it makes becomes a rep, and the context window it is
burning becomes stamina.

Nothing is a mock-up. The agent edits your real repository, the base grows as it
writes files, and PROJECT tracks the whole thing from PLANNED to SHIPPED using
git and your actual test results.

## Demo video

**▶ [Watch the 70-second demo](https://drive.google.com/file/d/1b9aQo_nAt4xKXYsYrUtrWRhtZb5X5ERd/view?usp=sharing)** — the gym floor, a workout, and the agent shipping a change.

## Play it

Double-click **`play.command`**. It starts the local server and opens the gym.
Nothing is installed and nothing leaves your machine — the server listens on
`127.0.0.1` only.

No project to train on? Press **+ NEW** and give it a name. The gym builds you a
small real project, commits it to git, and puts it on the floor.

Then pick a workout from the board:

| Workout | What the agent actually does |
|---------|------------------------------|
| EXPLAIN THE PROJECT | Writes a README that matches the code |
| TEST THE BIG ONE | Writes tests for your heaviest file, then makes them pass |
| FIX WHAT'S BROKEN | Runs the tests and repairs the code until they pass |
| BUILD SOMETHING NEW | You describe it in one line; it builds it with a test |
| TIDY UP | Removes dead code without changing behaviour |
| EXPLAIN THE TRICKY PARTS | Documents the hardest-to-follow functions |
| BREAK UP THE HEAVIEST | Splits your biggest file into smaller modules |

You never write a prompt. Pick a goal, pick how hard the athlete should work
(**WARM-UP**, **WORKING SET**, **HEAVY**), and watch. The training log narrates
every step in plain English — "reading the code to understand it", "running the
tests", "writing a new file, stats.py".

The code it writes is real code in a real repository. Open the folder afterwards
and it is all there, committed history and all.

## Run it from a terminal

The server uses the Python standard library only. There is no `pip install` and
no `npm install`.

```bash
python3 server.py --repo ~/code/your-project
open http://127.0.0.1:8477
```

Press **ADVANCED** in the gym to write instructions yourself and to choose the
model, reasoning effort and sandbox directly.

Options:

| Flag | Purpose |
|------|---------|
| `--repo PATH` | The repository to lay out as the gym floor. Defaults to the current directory. |
| `--port N` | HTTP port. Defaults to 8477. |
| `--no-spectate` | Do not tail `~/.codex/sessions`. |
| `--selftest` | Run the built-in checks and exit. |

The server binds `127.0.0.1` only.

## Requirements

- Python 3.9 or later.
- Codex CLI on `PATH`, for the TRAIN button. Spectating works without it.

## The rules

1. **Every folder is a training station.** What it becomes depends on the code
   inside: red power rack for source, green treadmill bank for tests, blue
   dumbbell rack for config, yellow stretch studio for docs, purple boxing ring
   for markup. The badge is the file count; the load is the lines of code.
2. **Tap a station to put the agent to work there.** Add tests, document it,
   break it up, tidy it, run the tests. You never write a prompt.
3. **Lines of code are weight.** The bar starts at 20kg and gains 1kg for every
   4 lines, to a 400kg maximum.
4. **Every tool call is a rep.** Writing a file is a deadlift. Running tests is a
   treadmill sprint. Building is a bench press. Reading code is walking the
   floor. A command that exits non-zero is a missed rep.
5. **The context window is stamina.** The bar shows how much of the window is
   still free. Compaction is a towel-down, and stamina returns.
6. **Weekly quota is recovery.** Output tokens are calories.
7. **Personal records persist.** Level, streak, heaviest lift, and total volume
   are stored in `~/.codex-gym/records.json` and carry across sessions.

## Three ways to watch

Codex Gym normalizes different event sources into the same gym:

| Mode | Source | Use |
|------|--------|-----|
| Spectate | Tails `~/.codex/sessions/**/rollout-*.jsonl` | Watch a `codex` session you started in your terminal. |
| Dispatch | Streams `codex exec --json` | Watch a workout you started from the UI. |
| Replay | Reads a recorded session | Watch any past session as a workout, at 1x to 16x. |

A dispatched run also writes a rollout file. The spectator stands down while a
dispatched workout or a replay is running, so no event is counted twice. A replay
never touches your personal records — it is history, not training.

Replay also means the gym demos with no network and no tokens: every session you
have ever run is already on disk.

## Scores: which athlete is actually better

The SCORES tab reads your session history and reports each model as an athlete:

| Column | Meaning |
|--------|---------|
| REPS | Tool calls made |
| LIFTS | Edits that landed |
| MISS% | Commands that exited non-zero |
| R/SET | Tool calls per turn |
| CAL/LIFT | Output tokens burned per surviving edit — lower is more efficient |
| TTFT | Average seconds to first token |

The best value in each column is highlighted. Across 200 local sessions this
surfaced a real difference: one model averaged 4,673 calories per lift where
another needed 14,404 for the same unit of work.

## Controls

| Action | Result |
|--------|--------|
| A workout card | Starts that workout on the current floor. |
| WARM-UP / WORKING SET / HEAVY | How hard the athlete works (model plus reasoning effort). |
| RACK IT | Stops the running workout or replay. |
| + NEW | Builds a starter project and puts it on the floor. |
| Tap a station | Opens its card: files inside, and five actions to run there. |
| Drag / scroll / double-click | Pan, zoom, fit the whole base. |
| CAMERA | Toggles automatic push-in against a locked wide shot. |
| RULES | Reopens the explainer. |
| SOUND | Mutes or unmutes. |
| FLOOR | Switches to another project. |
| ADVANCED | Write the instruction yourself; pick model, effort and sandbox. |

`Cmd+Enter` submits the workout description, a custom instruction, or an answer.

## The lifecycle: how the game tracks your project

Every change travels one pipeline, and the PROJECT panel shows where you are.
Nothing here is guessed — each stage is read from `git` and from whether your
tests actually passed.

| Stage | It means | Read from |
|-------|----------|-----------|
| PLANNED | nothing started | no changes, no reps |
| TRAINING | the agent is changing code | reps, or `git status` shows changes |
| SPOTTER | **blocked** — it is asking you something | a set ended on a question |
| VERIFY | tests have been run | a test command was seen |
| CLEAN | tests pass, changes not saved yet | test passed + working tree dirty |
| LOGGED | committed to git | working tree clean, commits ahead |
| SHIPPED | pushed to the remote | clean, upstream exists, nothing ahead |

The stations show it too:

| On the station | It means |
|-----------------|----------|
| Amber ring | the agent is working here right now |
| Dashed blue ring | this folder has uncommitted changes |
| Red ring | tests are failing |
| Level badge | number of files in the folder |
| Plates and size | lines of code |

## Talk to the athlete

The **CHAT** tab is a conversation with Codex running in your project. Type a line,
press SEND, and the floor animates the work as it happens — the athlete walks to
the station it is touching and trains there.

Every message continues the *same* Codex session, so follow-ups keep their
context:

> **you** — Add a function `pluralise(word, n)` to src/hello.py that returns the word with an s when n is not 1. Add a test.
> **athlete** — Added `pluralise(word, n)` and a unit test. Verified with python3.
> **you** — Good. Now also handle n being zero the same way.
> **athlete** — `pluralise` already covers `0` because it only keeps the singular form for `1`. I'm adding the missing assertion.

**NEW SESSION** starts a fresh conversation that forgets the last one. A resumed
session keeps the working directory and sandbox it was started with, because
`codex exec resume` does not accept those flags.

## When the athlete asks you something

Codex sometimes stops to ask a question rather than guessing. The gym turns red,
says **THE ATHLETE IS ASKING**, and shows the question with a box to answer it.
Your answer resumes the same session, so the agent keeps its context.

## Athletes

The model becomes an athlete class, and the class changes the uniform.

| Model | Class |
|-------|-------|
| `gpt-5.6-sol` | Powerlifter |
| `gpt-5.6-luna` | Olympic lifter |
| `gpt-5.4` | Bodybuilder |
| `gpt-5.4-mini` | Sprinter |

Reasoning effort becomes the weight on the bar: `low` is a warm-up and `xhigh`
is a maximum-effort attempt. The sandbox policy becomes the spotter.

## Layout

```
play.command         double-click launcher
server.py            stdlib HTTP + SSE server, repo scan, event normalizer,
                     dispatch, quests, session index, replay, scoring
static/index.html    HUD structure
static/gym.css       design tokens and HUD styling
static/iso.js        gym floor bake, colour, and the arena's equipment sprites
static/building.js   the training stations: layout, drawing, hit testing
static/athlete.js    the athlete: pose keyframes and drawing
static/sfx.js        synthesised gym sound (no audio files)
static/app.js        SSE wiring, camera, arena, quests, HUD
```

## Tests

```bash
python3 server.py --selftest
```

The checks cover the parts that can be wrong without being obvious: the
lines-to-weight mapping, plate loading, command-to-exercise classification,
file-change parsing for both event schemas, re-weighing files, and input
validation on dispatch.

## Known limitations

- **No per-command approval.** `codex exec` is non-interactive, so individual
  commands cannot be waved through mid-set. You choose the spotter before you
  train, and that policy holds for the whole workout.
- The exec event stream names changed files but carries no diff bodies, so line
  counts for dispatched runs come from re-measuring the file on disk.
- The floor holds 420 stations. Anything beyond that is reported as not placed.
- SCORES reads the newest 200 sessions; the panel says so when there are more.
- Sound needs one click anywhere first, because browsers block audio until the
  page has been interacted with.
