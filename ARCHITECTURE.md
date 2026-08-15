# How Codex Gym works

One page. What the screen can show you, and where every number on it comes from.

---

## 1. The whole thing in one sentence

**Codex writes code in your project; the gym watches the file it writes and turns
each action into a rep.**

Everything else is detail hanging off that sentence.

```
  YOUR PROJECT              CODEX                    THE GYM
  ~/code/thing/       →     runs, edits,      →      floor of stations
  folders + files           runs tests               athlete doing reps
       │                        │                          │
       │                        │                          │
       └── scanned once ────────┼──────────────────────────┘
           (folders become      │
            stations)           └── every action becomes an event
```

Two mappings do all the work:

| Your project | The gym |
|--------------|---------|
| a folder | a training station |
| files in that folder | the station's level badge |
| lines of code in it | how loaded the station is |
| Codex writing a file | a deadlift at that station |
| Codex running tests | a treadmill sprint |
| Codex reading code | walking the floor |
| a command that failed | a missed rep |
| context window filling up | stamina draining |
| git state + test result | the PROJECT pipeline |

---

## 2. Backend: where the data comes from

There are **three** places Codex activity can come from. All three are converted
into **one** kind of event, so the front end only ever learns one language.

```
  (1) SPECTATE ──┐   you ran `codex` yourself in a terminal
      tails ~/.codex/sessions/**/rollout-*.jsonl
                 │
  (2) DISPATCH ──┼──►  normalizer  ──►  gym events  ──►  SSE  ──►  browser
      `codex exec --json`, started by the gym          /api/events
                 │
  (3) REPLAY  ───┘   a recorded session, played back in tempo
      reads an old rollout-*.jsonl
```

**Why three.** Spectate means the gym is useful even when you drive Codex from the
terminal. Dispatch means you can drive it from the game. Replay means you can demo
with no network and no tokens, because every session you have ever run is already
on disk.

**Only one runs at a time.** A dispatched run also writes a rollout file, so the
spectator stands down while dispatch or replay is live. Otherwise every event would
be counted twice.

### The two schemas

The two live sources do **not** share a format. This is the single most
surprising thing in the codebase.

| | Rollout file (spectate, replay) | `codex exec --json` (dispatch) |
|---|---|---|
| envelope | `event_msg` / `response_item` | `thread.started`, `turn.*`, `item.*` |
| a command | `custom_tool_call` + `..._output` | `command_execution` |
| a file write | `patch_apply_end`, **with the diff** | `file_change`, **no diff body** |
| tokens | `token_count` with the context window | `usage` on `turn.completed` |

Because the exec stream carries no diff, line counts for dispatched runs come from
**re-measuring the file on disk** after the write. Both paths end up in the same
place regardless.

### The event contract

Everything the browser knows arrives as one of these, over a single SSE stream:

| Event | Means | Drives |
|-------|-------|--------|
| `snapshot` | full state, sent on connect | everything (survives refresh) |
| `floor` | the project was scanned | the gym floor itself |
| `rep` | one action happened | the athlete, the log, sound, camera |
| `set_start` / `set_end` | a turn began / ended | SET counter, PROJECT refresh |
| `hud` | vitals changed | stamina, calories, recovery, state |
| `equip` | a file grew or shrank | that station's size and plates |
| `record` / `records` | a personal best | PERSONAL RECORDS |
| `note` | something worth logging | TRAINING LOG |
| `chat` | a line of conversation | CHAT |
| `asking` | Codex is blocked on a question | the red ASK panel |
| `project` | git or test state changed | the PROJECT pipeline |
| `running` | a workout started or stopped | button enable/disable |
| `replay` | a replay started or stopped | the REPLAY tab |

---

## 3. UI: what each surface can show

Ten panels. Here is every one, what it can tell you, and what feeds it.

### The floor (the canvas behind everything)

| It shows | Meaning | Source |
|----------|---------|--------|
| a station per folder | your project's shape | `floor` |
| level badge | how many files in that folder | `floor` |
| station size and plate load | how many lines of code | `floor`, `equip` |
| station type and colour | source / test / config / docs / markup | `floor` |
| the athlete, walking and lifting | what Codex is doing right now | `rep` |
| amber ring | Codex is working here | `rep` |
| dashed blue ring | this folder has uncommitted changes | `project` |
| red ring | tests are failing | `project` |

Tap a station and you get its card: the files inside with their weights, and five
actions that put Codex to work on that folder.

### The panels

| Panel | Answers | Source |
|-------|---------|--------|
| **CODEX GYM** (top left) | which project am I in, how big is it | `floor` |
| **HOW TO READ THE GYM** | the legend, so the floor is not a puzzle | `floor` |
| **VITALS** | stamina (context left), recovery (weekly quota), calories (output tokens), credits, set and rep count, current state | `hud` |
| **ARENA** | a close-up of the current lift, big enough to read, plus the coach's plain-English line | `rep` |
| **PROJECT** | where the work stands: PLANNED → TRAINING → SPOTTER → VERIFY → CLEAN → LOGGED → SHIPPED | `project` |
| **TODAY'S WORKOUT** | pick a goal in plain words; difficulty; ADVANCED for the raw controls | `/api/quests` |
| **PERSONAL RECORDS** | level, streak, heaviest lift, volume, lifetime reps and sets | `records` |
| **THE ATHLETE IS ASKING** | appears only when Codex is blocked on a question, with a box to answer | `asking` |
| **CHAT / LOG / REPLAY / SCORES** | four tabs, below | mixed |

### The four tabs

| Tab | Answers |
|-----|---------|
| **CHAT** | talk to Codex; every line continues the same session |
| **LOG** | every rep in order, in plain English, raw command on hover |
| **REPLAY** | your past sessions; play any one back as a workout |
| **SCORES** | which model is the better athlete: reps, lifts, miss rate, calories per lift, time to first token |

---

## 4. One request, end to end

You type *"add a shout() function with a test"* into CHAT.

```
  1  browser  POST /api/chat {text}
  2  server   emit chat{who:"you"}            → your bubble appears
  3  server   spawn: codex exec --json ...    → Codex starts in your project
  4  server   emit running{true}              → buttons disable
  5  codex    item: reasoning                 → athlete chalks up
  6  codex    item: command_execution "rg"    → emit rep{scout}
                                              → athlete WALKS to that station
  7  codex    item: file_change hello.py      → emit rep{deadlift}, equip
                                              → athlete DEADLIFTS, station grows
  8  codex    item: command_execution pytest  → emit rep{run}   → treadmill sprint
  9  codex    item: agent_message             → emit chat{coach} → reply bubble
 10  server   turn.completed                  → emit set_end, project
                                              → PROJECT advances to CLEAN
```

Ten steps. Every one of them is a real thing that happened in your repository.

---

## 5. What is real, and what is not

**Real, verified end to end:**
- Codex edits your actual repository; the code survives after you close the tab.
- Stamina is the real context window; calories are real output tokens; recovery is
  your real weekly quota.
- SCORES is computed from your real session history on disk.
- The PROJECT pipeline is read from `git status` and from whether your tests passed.
- Chat follow-ups keep context, because they resume the same Codex session.

**Known gaps:**
- **No per-command approval.** `codex exec` is non-interactive, so you choose the
  sandbox before the run and it holds for the whole run.
- **No progress bar for a long turn.** You see reps as they land, but not "40% done",
  because Codex does not report progress.
- **The floor caps at 420 stations.** Bigger repos say how many did not fit.
- **SCORES reads the newest 200 sessions**, not all of them.

---

## 6. The honest problem with this document

It took six sections to explain, which means the product currently has more
surfaces than story: **16 endpoints, 14 event types, 10 panels and 4 tabs.**

Nobody meets a product through its architecture. The fix is not more explanation —
it is fewer things on screen at once, with the rest revealed when they matter.
That is a product decision, not a technical one.
