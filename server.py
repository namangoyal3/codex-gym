#!/usr/bin/env python3
"""Codex Gym - your repo is a gym, your Codex agent is the athlete.

Two event sources, one normalizer:
  spectate : tails ~/.codex/sessions/**/rollout-*.jsonl   (your interactive `codex` TUI)
  dispatch : streams `codex exec --json` stdout            (workouts you start from the UI)

Stdlib only. No pip, no npm. Binds 127.0.0.1.

    python3 server.py --repo ~/code/ccost
    python3 server.py --selftest
"""
import argparse
import json
import os
import queue
import re
import shutil
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(HERE, "static")
CODEX_SESSIONS = os.path.expanduser("~/.codex/sessions")
RECORDS_PATH = os.path.expanduser("~/.codex-gym/records.json")

# ---------------------------------------------------------------- gym floor

SKIP_DIRS = {
    ".git", "node_modules", ".venv", "venv", "__pycache__", "dist", "build",
    ".next", ".nuxt", "target", ".mypy_cache", ".pytest_cache", ".ruff_cache",
    "vendor", ".cache", "coverage", ".turbo", ".gradle", "Pods", ".idea",
    ".tox", "site-packages", ".terraform", ".svelte-kit", "out",
}
SOURCE_EXT = {
    ".py", ".js", ".jsx", ".ts", ".tsx", ".go", ".rs", ".java", ".kt", ".swift",
    ".c", ".h", ".cc", ".cpp", ".hpp", ".cs", ".rb", ".php", ".scala", ".ex",
    ".exs", ".dart", ".m", ".mm", ".sh", ".zsh", ".bash", ".lua", ".pl", ".r",
    ".sql", ".vue", ".svelte", ".zig", ".hs", ".clj", ".jl",
}
CONFIG_EXT = {
    ".json", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".env",
    ".lock", ".properties", ".gradle", ".tf", ".tfvars",
}
DOC_EXT = {".md", ".mdx", ".rst", ".txt", ".adoc", ".org"}
STYLE_EXT = {".css", ".scss", ".sass", ".less", ".html", ".htm", ".svg"}

# equipment kinds -> the five stations on the floor
RACK, TREADMILL, DUMBBELL, MAT, BAG = "rack", "treadmill", "dumbbell", "mat", "bag"

MAX_EQUIPMENT = 420          # floor gets unreadable past this; truncation is logged
MAX_PER_ZONE = 48
MAX_READ_BYTES = 2_000_000
STARTING = object()


def is_test_path(rel):
    low = rel.lower()
    base = os.path.basename(low)
    if base.startswith("test_") or base.startswith("test."):
        return True
    if re.search(r"(_test|\.test|\.spec|_spec)\.[a-z]+$", base):
        return True
    parts = low.split(os.sep)
    return any(p in ("test", "tests", "spec", "specs", "__tests__") for p in parts[:-1])


def classify(rel):
    """Which piece of equipment does this file become?"""
    ext = os.path.splitext(rel)[1].lower()
    if is_test_path(rel):
        return TREADMILL
    if ext in SOURCE_EXT:
        return RACK
    if ext in CONFIG_EXT:
        return DUMBBELL
    if ext in DOC_EXT:
        return MAT
    if ext in STYLE_EXT:
        return BAG
    return None


def count_lines(path):
    try:
        if os.path.getsize(path) > MAX_READ_BYTES:
            return 0
        with open(path, "rb") as fh:
            return fh.read().count(b"\n") + 1
    except (OSError, ValueError):
        return 0


def loc_to_kg(loc):
    """Lines of code -> plates on the bar. Bar is 20kg empty; caps at 400kg.

    Rounds to 5kg because plates load in pairs and the smallest is 2.5kg, so a
    real bar can only ever total 20 + 5n. 142.5kg is not a loadable weight.
    """
    if loc <= 0:
        return 20.0
    kg = 20.0 + loc / 4.0
    kg = round(kg / 5.0) * 5.0
    return float(min(400.0, max(20.0, kg)))


PLATES = (25.0, 20.0, 15.0, 10.0, 5.0, 2.5)


def kg_to_plates(kg):
    """Plates on ONE side of a 20kg bar, heaviest first. Real gym math.

    No plate-count cap: the loaded total must always equal the number on the
    HUD, and every 5kg step up to 400kg resolves in <=9 plates a side. Each
    pass removes at least 2.5kg, so this always terminates.
    """
    per_side = max(0.0, (kg - 20.0) / 2.0)
    out = []
    for p in PLATES:
        while per_side >= p - 1e-9:
            out.append(p)
            per_side -= p
    return out


def scan_repo(root):
    """Walk the repo and lay out the gym floor. Returns (zones, stats)."""
    root = os.path.abspath(os.path.expanduser(root))
    by_zone = {}
    truncated = 0
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS and not d.startswith("."))
        for name in sorted(filenames):
            if name.startswith("."):
                continue
            full = os.path.join(dirpath, name)
            if os.path.islink(full):
                continue
            rel = os.path.relpath(full, root)
            kind = classify(rel)
            if kind is None:
                continue
            # zone by the file's own directory, not just the top level: a repo
            # with 150 files under src/ should read as several training areas,
            # not one crowded one that overflows the per-zone cap
            zone = os.path.dirname(rel) or "/"
            loc = count_lines(full)
            by_zone.setdefault(zone, []).append(
                {"path": rel, "name": name, "kind": kind, "loc": loc, "kg": loc_to_kg(loc)}
            )

    zones = []
    total = 0
    for zone in sorted(by_zone):
        items = sorted(by_zone[zone], key=lambda e: -e["loc"])
        if len(items) > MAX_PER_ZONE:
            truncated += len(items) - MAX_PER_ZONE
            items = items[:MAX_PER_ZONE]
        if total + len(items) > MAX_EQUIPMENT:
            room = max(0, MAX_EQUIPMENT - total)
            truncated += len(items) - room
            items = items[:room]
        if not items:
            continue
        total += len(items)
        zones.append({
            "name": zone,
            "equipment": items,
            "loc": sum(e["loc"] for e in items),
        })

    stats = {
        "root": root,
        "repo": os.path.basename(root) or root,
        "equipment": total,
        "zones": len(zones),
        "loc": sum(z["loc"] for z in zones),
        "truncated": truncated,
        "kinds": {k: sum(1 for z in zones for e in z["equipment"] if e["kind"] == k)
                  for k in (RACK, TREADMILL, DUMBBELL, MAT, BAG)},
    }
    return zones, stats


# ---------------------------------------------------------- exercise mapping

TEST_RE = re.compile(
    r"\b(pytest|jest|vitest|mocha|rspec|phpunit|unittest|nose2"
    r"|go\s+test|cargo\s+test|dotnet\s+test|mvn\s+test|gradle\s+test"
    r"|(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test)\b")
BUILD_RE = re.compile(
    r"\b(tsc|webpack|rollup|esbuild|cmake|make|cargo\s+build|go\s+build"
    r"|mvn\s+(?:package|install)|gradle\s+(?:build|assemble)|docker\s+build"
    r"|(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?build|(?:next|vite|nuxt)\s+build)\b")
READ_RE = re.compile(
    r"^\s*(cat|bat|head|tail|less|more|sed|awk|rg|grep|egrep|ack|ag|find|fd"
    r"|ls|tree|wc|file|stat|nl|jq|yq|column|diff|realpath|basename|dirname)\b")
# `apply_patch` arrives either as the tool name or as the raw patch envelope
PATCH_RE = re.compile(
    r"(\b(apply_patch|git\s+apply|patch\s+-p)\b"
    r"|\*\*\*\s+(Begin Patch|Update File|Add File|Delete File))")
COMMIT_RE = re.compile(r"^\s*git\s+(commit|push|tag)\b")

# exercise -> (label, station kind it happens at)
DEADLIFT, SQUAT, BENCH, PRESS, RUN, SCOUT, CHALK, RACKED, FAIL, PR = (
    "deadlift", "squat", "bench", "press", "run", "scout", "chalk", "racked", "fail", "pr")


# Codex sends a tool call either as a shell string or as a JS harness snippet
# that calls tools.exec_command({cmd:"..."}). The log has to show the command.
EXEC_CALL_RE = re.compile(
    r"""exec_command\(\s*\{\s*['"]?cmd['"]?\s*:\s*(['"])(.*?)(?<!\\)\1""", re.S)
# stop at a real newline OR a literal backslash-n: patches arrive embedded in JS
# string literals, where the body follows the path as an escape sequence
PATCH_FILE_RE = re.compile(
    r"\*\*\*\s+(Add|Update|Delete) File:[ \t]*(.+?)[ \t]*(?:\\+n|[\r\n]|$)")
RUN_FILE_RE = re.compile(
    r"\b(?:python3?|node|deno|bun|ruby|php)\s+\S*(?:test|spec)\S*\.(?:py|js|ts|mjs|rb|php)\b")


def command_of(raw):
    """Best-effort real command from a tool-call input, for display and mapping."""
    if not raw:
        return ""
    s = raw if isinstance(raw, str) else str(raw)
    m = EXEC_CALL_RE.search(s)
    if m:
        cmd = m.group(2)
        for a, b in (("\\\\", "\\"), ('\\"', '"'), ("\\'", "'"),
                     ("\\n", "\n"), ("\\t", "\t")):
            cmd = cmd.replace(a, b)
        return strip_shell_wrapper(cmd)
    files = PATCH_FILE_RE.findall(s)
    if files:
        named = [(v.lower(), os.path.basename(p.strip())) for v, p in files[:3]]
        named = [(v, n) for v, n in named if n]        # skip a path we misread
        if named:
            return "  ".join("%s %s" % (v, n) for v, n in named)
    return strip_shell_wrapper(s)


def exercise_for_input(raw):
    """Classify a raw tool-call input, unwrapping the harness first."""
    if PATCH_RE.search(raw or ""):
        return DEADLIFT
    cmd = command_of(raw)
    if RUN_FILE_RE.search(cmd):          # `python3 tests/test_calc.py`
        return RUN
    return exercise_for_command(cmd)


def tool_output_text(output):
    """First chunk of a custom_tool_call_output, whatever shape it arrived in."""
    if isinstance(output, str):
        return output
    if isinstance(output, list) and output:
        head = output[0]
        if isinstance(head, dict):
            return head.get("text") or ""
        if isinstance(head, str):
            return head
    if isinstance(output, dict):
        return output.get("text") or output.get("output") or ""
    return ""


def tool_ok(output):
    """Did the command succeed?

    Codex prefixes shell output with `Script completed` or `Script failed`, and
    sometimes an explicit `Exit code: N`. Unknown shapes count as success, so a
    format change cannot invent a floor full of missed reps.
    """
    text = tool_output_text(output)
    head = text[:400]
    if re.search(r"^\s*Script failed", head, re.M):
        return False
    m = re.search(r"^\s*Exit code:\s*(\d+)", head, re.M)
    if m and m.group(1) != "0":
        return False
    return True


def strip_shell_wrapper(cmd):
    """`/bin/zsh -lc 'pytest -q'` -> `pytest -q` so the regexes see the real command."""
    if not cmd:
        return ""
    m = re.match(r"^\s*\S*(?:sh|bash|zsh)\s+(?:-[a-zA-Z]+\s+)*(.*)$", cmd, re.S)
    body = m.group(1) if m else cmd
    body = body.strip()
    if len(body) >= 2 and body[0] == body[-1] and body[0] in "'\"":
        body = body[1:-1]
    return body.strip()


def exercise_for_command(cmd):
    """A shell command becomes a lift. This is the heart of the metaphor."""
    body = strip_shell_wrapper(cmd)
    if PATCH_RE.search(body):
        return DEADLIFT
    if COMMIT_RE.search(body):
        return PR
    if TEST_RE.search(body):
        return RUN
    if BUILD_RE.search(body):
        return BENCH
    if READ_RE.search(body):
        return SCOUT
    return PRESS


def diff_files(changes):
    """One {path, added, removed} per file touched by a Codex file-change payload.

    Both event sources speak the same add/delete/update + unified_diff
    vocabulary, but one hands us a path->change map and the other a list, so
    accept either. Must stay per-file: a patch that edits four files is four
    lifts, and collapsing it to the first path silently loses the rest.
    """
    if isinstance(changes, dict):
        items = list(changes.items())
    elif isinstance(changes, list):
        items = [((c or {}).get("path"), c) for c in changes if isinstance(c, dict)]
    else:
        return []

    out = []
    for key, change in items:
        change = change if isinstance(change, dict) else {}
        path = key or change.get("path")
        diff = change.get("unified_diff")
        if diff is None:
            for nested in change.values():                # e.g. {"update": {...}}
                if isinstance(nested, dict) and "unified_diff" in nested:
                    diff = nested["unified_diff"]
                    break
        added = removed = 0
        if diff:
            for line in str(diff).splitlines():
                if line.startswith("+") and not line.startswith("+++"):
                    added += 1
                elif line.startswith("-") and not line.startswith("---"):
                    removed += 1
        else:                                             # numeric fallback
            added = int(change.get("added") or change.get("insertions") or 0)
            removed = int(change.get("removed") or change.get("deletions") or 0)
        out.append({"path": path, "added": added, "removed": removed})
    return out


def lift_each(gym, changes, ok=True):
    """Turn a file-change payload into one deadlift per file touched."""
    files = diff_files(changes)
    if not files:
        files = [{"path": None, "added": 0, "removed": 0}]
    for f in files:
        moved = gym.remeasure(f["path"])
        lines = f["added"] + f["removed"]
        if not lines and moved:
            # the exec stream carries no diff bodies, so the measured change in
            # file size is the only volume signal available
            lines = abs(moved["delta"])
        gym.bump(lines=lines)
        gym.rep(DEADLIFT if ok else FAIL, ok=ok, path=f["path"],
                detail=lift_detail(f["path"], f["added"], f["removed"], moved))
    gym.emit("records", records=gym.records.snapshot())


EXERCISE_LABEL = {
    DEADLIFT: "DEADLIFT", SQUAT: "SQUAT", BENCH: "BENCH PRESS", PRESS: "OVERHEAD PRESS",
    RUN: "TREADMILL", SCOUT: "WALKING THE FLOOR", CHALK: "CHALKING UP",
    RACKED: "RACKED", FAIL: "FAILED REP", PR: "PERSONAL RECORD",
}

# model slug -> athlete class. Most specific first; dicts keep insertion order.
ATHLETES = {
    "gpt-5.6-sol":  ("POWERLIFTER", "Heavy compound lifts. Deep reasoning, long horizons."),
    "gpt-5.6-luna": ("OLYMPIC LIFTER", "Explosive and technical. Fast under load."),
    "gpt-5.6-terra": ("STRONGMAN", "Grinds through heavy, awkward loads."),
    "gpt-5.6":      ("POWERLIFTER", "Heavy compound lifts."),
    "mini":         ("SPRINTER", "Light, quick sets. Errands and small edits."),
    "gpt-5.5":      ("STRONGMAN", "Proven workhorse. Steady volume."),
    "gpt-5":        ("BODYBUILDER", "Balanced hypertrophy. Everyday sets."),
    "codex":        ("SPECIALIST", "Purpose-built for the platform."),
}
EFFORT_WEIGHT = {"low": 0.45, "medium": 0.7, "high": 0.9, "xhigh": 1.0, "minimal": 0.3}


def athlete_for_model(model):
    m = (model or "").lower()
    for key, val in ATHLETES.items():
        if key in m:
            return {"model": model, "klass": val[0], "blurb": val[1]}
    return {"model": model or None, "klass": "LIFTER", "blurb": "Unclassified athlete."}


# ------------------------------------------------------------------- records

class Records(object):
    """Persistent PRs so the athlete visibly gets stronger across sessions."""

    def __init__(self, path=RECORDS_PATH):
        self.path = path
        self.lock = threading.Lock()
        self.data = {
            "total_reps": 0, "total_sets": 0, "volume_lines": 0,
            "heaviest_kg": 0.0, "heaviest_file": "", "longest_set_ms": 0,
            "days": {}, "level": 1,
        }
        try:
            with open(path) as fh:
                self.data.update(json.load(fh))
        except (OSError, ValueError):
            pass

    def bump(self, **kw):
        """Returns the list of records broken by this update."""
        broken = []
        with self.lock:
            d = self.data
            d["total_reps"] += kw.get("reps", 0)
            d["total_sets"] += kw.get("sets", 0)
            d["volume_lines"] += kw.get("lines", 0)
            kg = kw.get("kg", 0.0)
            if kg > d["heaviest_kg"]:
                d["heaviest_kg"] = round(kg, 1)
                d["heaviest_file"] = kw.get("file", "")
                broken.append("HEAVIEST LIFT %.1fkg" % kg)
            ms = kw.get("set_ms", 0)
            if ms > d["longest_set_ms"]:
                d["longest_set_ms"] = ms
                broken.append("LONGEST SET %ds" % (ms // 1000))
            today = time.strftime("%Y-%m-%d")
            day = d["days"].setdefault(today, {"reps": 0, "lines": 0, "sets": 0})
            day["reps"] += kw.get("reps", 0)
            day["lines"] += kw.get("lines", 0)
            day["sets"] += kw.get("sets", 0)
            lvl = 1 + int((d["volume_lines"] / 500.0) ** 0.5)
            if lvl > d["level"]:
                d["level"] = lvl
                broken.append("LEVEL %d" % lvl)
            self._save()
        return broken

    def streak(self):
        days = set(self.data.get("days", {}))
        n, t = 0, time.time()
        while time.strftime("%Y-%m-%d", time.localtime(t - n * 86400)) in days:
            n += 1
        return n

    def snapshot(self):
        out = dict(self.data)
        out["streak"] = self.streak()
        out.pop("days", None)
        return out

    def _save(self):
        try:
            os.makedirs(os.path.dirname(self.path), exist_ok=True)
            tmp = self.path + ".tmp"
            with open(tmp, "w") as fh:
                json.dump(self.data, fh, indent=1)
            os.replace(tmp, self.path)
        except OSError:
            pass


# ------------------------------------------------------------------ the gym

class Gym(object):
    """Owns floor state, the live set, subscribers, and the running workout."""

    def __init__(self, repo, records):
        self.records = records
        self.lock = threading.Lock()
        self.run_lock = threading.Lock()
        self.subs = []
        self.feed = []
        self.seq = 0
        self.baseline = {}          # path -> LOC as of the last credited weigh-in
        self._last_scan = 0.0
        self.load_repo(repo)
        self.hud = {
            "athlete": athlete_for_model(None), "effort": None, "spotter": None,
            "stamina": 1.0, "tokens": 0, "context": 0, "calories": 0,
            "recovery": None, "resets_at": None, "credits": None,
            "set": 0, "reps": 0, "state": "IDLE", "exercise": None,
            "active_file": None, "active_kg": 0.0, "session": None, "cwd": None,
        }
        self.set_started = None
        self.thread_id = None
        self.out_tokens = 0          # cumulative calories for the exec stream
        self.workout = None          # live subprocess.Popen for dispatched runs
        self.run_generation = 0
        self.replaying = None        # {"file","speed"} while replaying a session
        self.replay_stop = None
        self.pending_question = None
        self.run_status = "idle"
        self.final_response = None
        self.pending_tool = None     # tool call awaiting its result
        self.last_test = None        # True/False once tests have run
        self.chat = []                # the conversation, newest last

    def dispatching(self):
        """True while we own a `codex exec` run.

        A dispatched run also writes a rollout file, so the spectator would
        double-count every event. One athlete, one gym: the exec stream wins.
        """
        with self.run_lock:
            return self.workout is STARTING or (
                self.workout is not None and self.workout.poll() is None)

    def busy(self):
        return self.dispatching() or self.replaying is not None

    def bump(self, **kw):
        """Single choke point for records.

        A replay is history, not training: crediting it would mint personal
        bests for work that already happened, and re-running one session would
        inflate them again every time.
        """
        if self.replaying is not None:
            return []
        return self.records.bump(**kw)

    def replay_end(self):
        self.replaying = None
        self.replay_stop = None
        self.set_hud(state="DONE", exercise=RACKED)
        self.emit("replay", replaying=None)
        self.emit("running", running=False)

    def flush_tool(self, ok=True):
        """Emit the held tool call as a rep, now that its result is known."""
        pend = self.pending_tool
        if not pend:
            return
        self.pending_tool = None
        self.rep(pend["ex"] if ok else FAIL, ok=ok,
                 label=None if ok else "FAILED REP",
                 detail=command_of(pend["cmd"])[:200])

    def say(self, who, text):
        """Add a turn to the conversation. `who` is 'you' or 'coach'."""
        text = (text or "").strip()
        if not text:
            return
        msg = {"who": who, "text": text[:4000], "t": time.time()}
        with self.lock:
            self.chat.append(msg)
            del self.chat[:-60]
        self.emit("chat", **msg)

    def ask(self, question):
        """The agent stopped to ask something. Surface it as a blocking prompt."""
        self.pending_question = question
        self.set_hud(state="ASKING")
        self.emit("asking", question=question[:1200])

    def begin_run(self):
        self.run_status = "running"
        self.final_response = None
        self.pending_question = None
        self.emit("lifecycle", status="running")

    def reserve_run(self, resume=None):
        with self.run_lock:
            if self.workout is STARTING or (
                    self.workout is not None and self.workout.poll() is None):
                raise ValueError("already training - rack it first")
            if self.replaying is not None:
                raise ValueError("replay is running - stop it first")
            self.run_generation += 1
            generation = self.run_generation
            self.workout = STARTING
            if not resume:
                self.thread_id = None
        self.begin_run()
        return generation

    def attach_run(self, generation, proc):
        with self.run_lock:
            if generation == self.run_generation and self.workout is STARTING:
                self.workout = proc

    def complete_run(self, generation, proc, status, error=None):
        with self.run_lock:
            if generation != self.run_generation or self.workout is not proc:
                return False
            self.workout = None
        self.set_hud(state="DONE", exercise=RACKED)
        self.finish_run(status, error)
        self.emit("running", running=False)
        return True

    def finish_run(self, status, error=None):
        self.run_status = status
        self.emit("lifecycle", status=status, error=(error or "")[:1200] or None)

    def result(self, text):
        text = (text or "").strip()
        if not text:
            return
        self.final_response = text[:8000]
        self.emit("result", text=self.final_response, thread_id=self.thread_id)

    # -- fanout ---------------------------------------------------------
    def subscribe(self):
        q = queue.Queue(maxsize=600)
        with self.lock:
            self.subs.append(q)
        return q

    def unsubscribe(self, q):
        with self.lock:
            if q in self.subs:
                self.subs.remove(q)

    def emit(self, kind, **payload):
        with self.lock:
            self.seq += 1
            msg = dict(payload)
            msg["kind"] = kind
            msg["seq"] = self.seq
            msg["t"] = time.time()
            if kind in ("rep", "note", "record"):
                self.feed.append(msg)
                del self.feed[:-120]
            dead = []
            for q in self.subs:
                try:
                    q.put_nowait(msg)
                except queue.Full:
                    dead.append(q)
            for q in dead:
                self.subs.remove(q)

    def snapshot(self):
        with self.lock:
            return {
                "kind": "snapshot", "seq": self.seq, "zones": self.zones,
                "stats": self.stats, "hud": dict(self.hud),
                "feed": list(self.feed[-40:]), "records": self.records.snapshot(),
                "running": self.busy(), "replaying": self.replaying,
                "status": self.run_status, "thread_id": self.thread_id,
                "result": self.final_response,
                "question": self.pending_question,
                "chat": list(self.chat[-40:]),
            }

    # -- state helpers --------------------------------------------------
    def set_hud(self, **kw):
        with self.lock:
            self.hud.update(kw)
        self.emit("hud", **kw)

    def find_equipment(self, path):
        """Match an absolute/relative path to a piece of equipment on the floor."""
        if not path:
            return None
        root = self.stats["root"]
        rel = os.path.relpath(path, root) if os.path.isabs(path) else path
        if rel.startswith(".."):
            rel = os.path.basename(path)
        for z in self.zones:
            for e in z["equipment"]:
                if e["path"] == rel:
                    return e
        base = os.path.basename(rel)
        for z in self.zones:
            for e in z["equipment"]:
                if e["name"] == base:
                    return e
        return None

    def load_repo(self, root):
        """Lay out a fresh floor and treat everything already there as the baseline."""
        zones, stats = scan_repo(root)
        with self.lock:
            self.zones, self.stats = zones, stats
            self.baseline = {e["path"]: e["loc"] for z in zones for e in z["equipment"]}
        self._last_scan = time.time()
        return stats

    def remeasure(self, path):
        """Re-weigh a file the agent just touched, so the bar tracks the code.

        The exec stream names changed files but carries no diff bodies, so the
        file on disk is the only honest source for the new weight.

        The delta comes from `baseline`, never from the equipment's current LOC:
        one rescan picks up every file of a multi-file patch at its final size,
        so comparing against the floor would credit only whichever file happened
        to be reported first and call the rest "touched".
        """
        if not path:
            return None
        eq = self.find_equipment(path)
        if eq is None:
            # a file we have never seen means the floor itself grew, and a new
            # station IS the reason to re-lay the floor, so do not throttle
            self.rescan(force=True)
            eq = self.find_equipment(path)
            if eq is None:
                return None
        full = os.path.join(self.stats["root"], eq["path"])
        loc = count_lines(full) if os.path.isfile(full) else 0
        with self.lock:
            rel = eq["path"]
            prev_loc = self.baseline.get(rel, 0)
            self.baseline[rel] = loc
            eq["loc"], eq["kg"] = loc, loc_to_kg(loc)
            kg = eq["kg"]
        prev_kg = loc_to_kg(prev_loc)
        if loc != prev_loc:
            self.emit("equip", path=rel, loc=loc, kg=kg, prev_loc=prev_loc,
                      prev_kg=prev_kg, fresh=(prev_loc == 0))
        return {"delta": loc - prev_loc, "kg": kg, "prev_kg": prev_kg}

    def rescan(self, force=False):
        """Re-lay the floor. Throttled: agents create files in bursts.

        Files that appear here are new since the last baseline, so they start at
        zero and the next weigh-in credits their whole size.
        """
        now = time.time()
        if not force and now - self._last_scan < 3.0:
            return
        self._last_scan = now
        zones, stats = scan_repo(self.stats["root"])
        with self.lock:
            self.zones, self.stats = zones, stats
            for z in zones:
                for e in z["equipment"]:
                    self.baseline.setdefault(e["path"], 0)
        self.emit("floor", zones=zones, stats=stats)

    def start_set(self, context_window=None):
        self.set_started = time.time()
        with self.lock:
            self.hud["set"] += 1
            self.hud["reps"] = 0
            self.hud["state"] = "LIFTING"
            if context_window:
                self.hud["context"] = context_window
            n = self.hud["set"]
        self.emit("set_start", set=n)
        self.emit("note", text="SET %d - approach the bar" % n, tone="cue")

    def end_set(self, message=None, aborted=False):
        ms = int((time.time() - (self.set_started or time.time())) * 1000)
        broken = self.bump(sets=1, set_ms=ms)
        reps = self.hud.get("reps") or 0
        self.set_hud(state="INJURED" if aborted else "RESTING", exercise=RACKED)
        self.emit("set_end", ms=ms, aborted=aborted, message=(message or "")[:900])
        # a set with no reps that ends on a question means the agent is blocked
        # on us, which must not look like a workout that quietly did nothing
        if message and not reps and not aborted and "?" in message:
            self.ask(message)
        # git state only moves at set boundaries, so this is where to re-read it
        self.emit("project", project=project_state(self))
        for b in broken:
            self.emit("record", text=b)
        self.emit("records", records=self.records.snapshot())

    def rep(self, exercise, label=None, detail="", ok=True, kg=None, path=None):
        eq = self.find_equipment(path) if path else None
        if kg is None:
            kg = eq["kg"] if eq else 20.0
        with self.lock:
            self.hud["reps"] += 1
            n = self.hud["reps"]
            self.hud["exercise"] = exercise
            self.hud["active_kg"] = kg
            if eq:
                self.hud["active_file"] = eq["path"]
        # a test run is the project's verdict, and drives the VERIFY/CLEAN stages
        if exercise == RUN:
            self.last_test = ok
        elif exercise == FAIL and (TEST_RE.search(detail or "")
                                   or RUN_FILE_RE.search(detail or "")):
            self.last_test = False
        broken = self.bump(reps=1, kg=(kg if ok and exercise == DEADLIFT else 0.0),
                                   file=(eq["path"] if eq else (path or "")))
        self.emit("rep", n=n, exercise=exercise, ok=ok, kg=kg,
                  label=label or EXERCISE_LABEL.get(exercise, exercise.upper()),
                  detail=detail[:220], path=(eq["path"] if eq else path),
                  says=plain_english(exercise, detail,
                                     os.path.basename(eq["path"] if eq else (path or ""))),
                  plates=kg_to_plates(kg))
        for b in broken:
            self.emit("record", text=b)

    def tokens(self, in_context, calories, window, recovery=None, resets=None, credits=None):
        """Stamina is how much of the context window is still free.

        `in_context` must be the CURRENT occupancy (last request's prompt +
        reply), not lifetime token spend - cumulative usage crosses the window
        within a few turns and pins stamina at zero for the rest of the session.
        """
        window = window or self.hud.get("context") or 0
        stamina = 1.0
        if window:
            stamina = min(1.0, max(0.0, 1.0 - float(in_context) / float(window)))
        self.set_hud(stamina=round(stamina, 4), tokens=in_context, context=window,
                     calories=calories, recovery=recovery, resets_at=resets,
                     credits=credits)


# ------------------------------------------------- source A: rollout tailer

def newest_rollout(after=0.0):
    best, best_m = None, after
    if not os.path.isdir(CODEX_SESSIONS):
        return None
    for dirpath, dirnames, filenames in os.walk(CODEX_SESSIONS):
        for name in filenames:
            if not (name.startswith("rollout-") and name.endswith(".jsonl")):
                continue
            full = os.path.join(dirpath, name)
            try:
                m = os.path.getmtime(full)
            except OSError:
                continue
            if m > best_m:
                best, best_m = full, m
    return best


def handle_rollout_event(gym, ev):
    """Normalize one line of a rollout-*.jsonl into gym actions."""
    typ = ev.get("type")
    p = ev.get("payload") or {}
    ptyp = p.get("type")

    if typ == "session_meta":
        gym.set_hud(session=p.get("session_id"), cwd=p.get("cwd"), state="WARMING UP")
        gym.emit("note", text="GYM OPEN - %s" % (p.get("cwd") or ""), tone="cue")
        return

    if typ == "turn_context":
        mode = (p.get("collaboration_mode") or {}).get("settings") or {}
        effort = mode.get("reasoning_effort")
        gym.set_hud(athlete=athlete_for_model(p.get("model")), effort=effort,
                    spotter=p.get("approval_policy"))
        return

    if typ != "event_msg":
        if typ == "response_item" and ptyp == "reasoning":
            gym.set_hud(exercise=CHALK, state="CHALKING")
        elif typ == "response_item" and ptyp == "custom_tool_call":
            # hold the rep until its output arrives: the command text says what
            # the lift is, but only the result says whether it was made
            cmd = p.get("input") or p.get("name") or ""
            gym.pending_tool = {"cmd": cmd, "ex": exercise_for_input(cmd)}
            gym.set_hud(exercise=gym.pending_tool["ex"], state="LIFTING")
        elif typ == "response_item" and ptyp == "custom_tool_call_output":
            gym.flush_tool(ok=tool_ok(p.get("output")))
        return

    if ptyp == "task_started":
        gym.start_set(p.get("model_context_window"))
    elif ptyp == "task_complete":
        gym.flush_tool()                     # never silently drop a held rep
        gym.end_set(p.get("last_agent_message"))
    elif ptyp == "turn_aborted":
        gym.flush_tool(ok=False)
        gym.end_set(aborted=True)
        gym.emit("note", text="BAR DROPPED - turn aborted", tone="bad")
    elif ptyp == "token_count":
        info = p.get("info") or {}
        last = info.get("last_token_usage") or {}
        tot = info.get("total_token_usage") or {}
        rl = (p.get("rate_limits") or {})
        prim = rl.get("primary") or {}
        cred = (rl.get("credits") or {}).get("balance")
        in_context = (last.get("input_tokens") or 0) + (last.get("output_tokens") or 0)
        gym.tokens(in_context, tot.get("output_tokens", 0),
                   info.get("model_context_window"),
                   recovery=prim.get("used_percent"), resets=prim.get("resets_at"),
                   credits=cred)
    elif ptyp == "patch_apply_end":
        lift_each(gym, p.get("changes"), ok=bool(p.get("success")))
    elif ptyp == "context_compacted":
        gym.emit("note", text="TOWEL DOWN - context compacted", tone="cue")
        gym.set_hud(exercise=RACKED, state="RESTING")
    elif ptyp == "mcp_tool_call_end":
        gym.rep(PRESS, label="MACHINE ASSIST", detail=str(p.get("invocation") or "")[:160])
    elif ptyp == "web_search_end":
        gym.rep(SCOUT, label="STUDYING FORM", detail=str(p.get("query") or "")[:160])


def spectate_loop(gym, stop):
    """Tail the newest rollout file; follow along when Codex opens a new session.

    Reads in binary and tracks a byte offset. Text-mode iteration would be
    tempting here but disables tell(), which raises OSError mid-tail.
    """
    path, pos, first = None, 0, True
    while not stop.is_set():
        if gym.busy():
            # the exec stream is driving; re-attach at the end afterwards so we
            # do not replay the workout we just watched
            path, first = None, True
            stop.wait(0.35)
            continue
        newest = newest_rollout()
        if newest and newest != path:
            path = newest
            # at startup the newest file is usually a finished session, so join
            # at the end; a session that appears later is followed from its start
            try:
                pos = os.path.getsize(path) if first else 0
            except OSError:
                pos = 0
            first = False
            gym.emit("note", text="SPECTATING %s" % os.path.basename(path), tone="cue")
        if path:
            try:
                with open(path, "rb") as fh:
                    fh.seek(pos)
                    chunk = fh.read()
            except OSError:
                path = None
                chunk = b""
            cut = chunk.rfind(b"\n") + 1          # whole lines only
            if cut:
                pos += cut
                for raw in chunk[:cut].splitlines():
                    raw = raw.strip()
                    if not raw:
                        continue
                    try:
                        handle_rollout_event(gym, json.loads(raw.decode("utf-8", "replace")))
                    except (ValueError, KeyError, TypeError, AttributeError):
                        continue
        stop.wait(0.35)


# -------------------------------------------- source B: `codex exec --json`

def context_window_for(thread_id):
    """Read just the context window out of a session's rollout header.

    `codex exec --json` never reports the window, and stamina is meaningless
    without it. Guessing a number per model would silently rot, so read the one
    the session actually recorded - a couple of lines, once per run.
    """
    if not thread_id or not os.path.isdir(CODEX_SESSIONS):
        return None
    for dirpath, _dirs, files in os.walk(CODEX_SESSIONS):
        for name in files:
            if thread_id not in name or not name.endswith(".jsonl"):
                continue
            try:
                with open(os.path.join(dirpath, name), "rb") as fh:
                    for _ in range(80):
                        line = fh.readline()
                        if not line:
                            return None
                        if b"model_context_window" in line:
                            payload = (json.loads(line) or {}).get("payload") or {}
                            return payload.get("model_context_window")
            except (OSError, ValueError):
                return None
    return None


def handle_exec_event(gym, ev):
    """Normalize one line of `codex exec --json` stdout."""
    typ = ev.get("type") or ""

    if typ == "thread.started":
        gym.thread_id = ev.get("thread_id")
        gym.set_hud(session=gym.thread_id, state="WARMING UP")
        return
    if typ == "turn.started":
        if not gym.hud.get("context"):
            gym.set_hud(context=context_window_for(gym.thread_id) or 0)
        gym.start_set()
        return
    if typ in ("turn.completed", "turn.failed"):
        usage = ev.get("usage") or {}
        in_context = (usage.get("input_tokens") or 0) + (usage.get("output_tokens") or 0)
        gym.out_tokens += usage.get("output_tokens") or 0   # usage is per turn
        if in_context:
            gym.tokens(in_context, gym.out_tokens, gym.hud.get("context"))
        gym.end_set(gym.final_response, aborted=(typ == "turn.failed"))
        return

    item = ev.get("item") or {}
    itype = item.get("type")
    started = typ == "item.started"

    if itype == "command_execution":
        cmd = item.get("command") or ""
        ex = exercise_for_input(cmd)
        if started:
            gym.set_hud(exercise=ex, state="LIFTING")
            return
        code = item.get("exit_code")
        ok = code in (0, None)
        gym.rep(ex if ok else FAIL, ok=ok,
                detail=command_of(cmd)[:200],
                label=None if ok else "FAILED REP")
    elif itype == "file_change":
        if started:
            return
        lift_each(gym, item.get("changes") or item.get("files"),
                  ok=item.get("status") in (None, "completed"))
    elif itype == "reasoning":
        if started:
            gym.set_hud(exercise=CHALK, state="CHALKING")
    elif itype == "mcp_tool_call":
        if not started:
            gym.rep(PRESS, label="MACHINE ASSIST",
                    detail="%s.%s" % (item.get("server", ""), item.get("tool", "")))
    elif itype == "web_search":
        if not started:
            gym.rep(SCOUT, label="STUDYING FORM", detail=str(item.get("query") or "")[:160])
    elif itype == "agent_message":
        if not started:
            text = item.get("text") or ""
            gym.result(text)
            gym.emit("note", text=text[:600], tone="coach")
            gym.say("coach", text)
    elif itype == "error":
        gym.emit("note", text=(item.get("message") or "error")[:400], tone="bad")


def lift_detail(path, added, removed, moved):
    """Log line for a lift: exact diff when we have one, else the weight change.

    Pure formatter - `moved` is a remeasure() result supplied by the caller, so
    building a log string never has the side effect of re-weighing the floor.
    """
    name = os.path.basename(path or "") or "?"
    if added or removed:
        head = "+%d -%d" % (added, removed)
    elif moved and moved["delta"]:
        head = "%+d lines" % moved["delta"]
    else:
        head = "touched"
    if moved and moved["kg"] != moved["prev_kg"]:
        return "%s  %s  %gkg -> %gkg" % (head, name, moved["prev_kg"], moved["kg"])
    return "%s  %s" % (head, name)


STARTER_BASE = os.path.expanduser("~/codex-gym-projects")
NAME_OK = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")

STARTER = {
    "README.md": (
        "# {name}\n\nA starter project, built to be trained in Codex Gym.\n\n"
        "## Run\n\n    python3 src/hello.py\n\n## Test\n\n    python3 tests/test_hello.py\n"),
    "src/hello.py": (
        '"""The first station on the floor."""\n\n\n'
        "def greet(name):\n"
        '    """Return a greeting for `name`."""\n'
        '    return "Hello, %s!" % name\n\n\n'
        'if __name__ == "__main__":\n'
        '    print(greet("world"))\n'),
    "tests/test_hello.py": (
        "import os\nimport sys\nimport unittest\n\n"
        'sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))\n'
        "from hello import greet\n\n\n"
        "class TestGreet(unittest.TestCase):\n"
        "    def test_greet(self):\n"
        '        self.assertEqual(greet("world"), "Hello, world!")\n\n\n'
        'if __name__ == "__main__":\n'
        "    unittest.main()\n"),
}


def make_starter(name):
    """Create a small real project so a player with no repo can still train.

    Confined to ~/codex-gym-projects/<name>, never overwrites, and the name is
    matched against an allowlist rather than sanitised.
    """
    name = (name or "").strip().lower().replace(" ", "-")
    if not NAME_OK.match(name):
        raise ValueError("use lowercase letters, numbers and dashes")
    root = os.path.join(STARTER_BASE, name)
    if os.path.exists(root):
        raise ValueError("you already have a gym called that")
    for rel, body in STARTER.items():
        full = os.path.join(root, rel)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w") as fh:
            fh.write(body.replace("{name}", name))
    git = shutil.which("git")
    if git:
        for args in (["init", "-q"], ["add", "-A"],
                     ["-c", "user.email=gym@local", "-c", "user.name=Codex Gym",
                      "commit", "-qm", "first day at the gym"]):
            try:
                subprocess.run([git] + args, cwd=root, stdin=subprocess.DEVNULL,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                               timeout=20)
            except (OSError, subprocess.SubprocessError):
                break
    return root


MODEL_OK = re.compile(r"^[A-Za-z0-9._:\-]{1,64}$")
EFFORTS = ("minimal", "low", "medium", "high", "xhigh")
SANDBOXES = ("read-only", "workspace-write", "danger-full-access")


def exec_cmd(exe, prompt, model, effort, sandbox, cwd, resume=None):
    """Build the `codex exec` argv.

    `codex exec resume` accepts a strict subset of the flags: it rejects `-C` and
    `-s` outright, and a resumed session keeps the working directory and sandbox
    policy it was started with. Usage is
    `exec resume [OPTIONS] [SESSION_ID] [PROMPT]`, so the id sits after the flags
    and immediately before the prompt.
    """
    cmd = [exe, "exec"]
    if resume:
        cmd.append("resume")
    cmd += ["--json", "--skip-git-repo-check"]
    if not resume:
        cmd += ["-C", cwd, "-s", sandbox]
    cmd += ["-c", "model_reasoning_effort=%s" % effort]
    if model:
        cmd += ["-m", model]
    if resume:
        if resume == "--last":
            cmd.append("--last")
        elif MODEL_OK.match(resume):
            cmd.append(resume)
        else:
            raise ValueError("bad session id")
    cmd.append(prompt)
    return cmd


def dispatch(gym, prompt, model, effort, sandbox, cwd, resume=None):
    """Start a workout: `codex exec --json`, stream stdout into the gym.

    `resume` continues an existing thread, which is how an answer to the agent's
    question gets back to it.
    """
    prompt = (prompt or "").strip()
    if not prompt:
        raise ValueError("empty workout")
    if len(prompt) > 8000:
        raise ValueError("workout too long")
    if model and not MODEL_OK.match(model):
        raise ValueError("bad model")
    if effort not in EFFORTS:
        raise ValueError("bad effort")
    if sandbox not in SANDBOXES:
        raise ValueError("bad sandbox")
    cwd = os.path.abspath(os.path.expanduser(cwd or gym.stats["root"]))
    if not os.path.isdir(cwd):
        raise ValueError("no such directory")
    exe = shutil.which("codex")
    if not exe:
        raise ValueError("codex not on PATH")

    cmd = exec_cmd(exe, prompt, model, effort, sandbox, cwd, resume)
    generation = gym.reserve_run(resume)
    try:
        proc = subprocess.Popen(
            cmd, cwd=cwd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, text=True, bufsize=1,
            env=dict(os.environ, RUST_LOG="error"))
    except OSError as exc:
        gym.complete_run(generation, STARTING, "failed", str(exc))
        raise ValueError("could not start codex: %s" % exc)
    gym.attach_run(generation, proc)
    gym.emit("asking", question=None)
    gym.set_hud(athlete=athlete_for_model(model or "gpt-5.6"), effort=effort,
                spotter=sandbox, state="WARMING UP")
    gym.emit("note", text=("ANSWER: " if resume else "WORKOUT: ") + prompt[:180], tone="cue")
    gym.emit("running", running=True)

    def pump():
        try:
            for line in proc.stdout:
                line = line.strip()
                if not line:
                    continue
                try:
                    handle_exec_event(gym, json.loads(line))
                except ValueError:
                    continue
                except Exception as exc:                      # keep the set alive
                    gym.emit("note", text="mapper: %s" % exc, tone="bad")
        finally:
            proc.wait()
            err = (proc.stderr.read() or "").strip() if proc.stderr else ""
            if proc.returncode not in (0, -15, -2):
                gym.emit("note", text="codex exit %s %s" % (proc.returncode, err[-300:]),
                         tone="bad")
            status = "stopped" if proc.returncode in (-15, -2) else (
                "completed" if proc.returncode == 0 else "failed")
            gym.complete_run(generation, proc, status,
                             err if status == "failed" else None)

    threading.Thread(target=pump, daemon=True).start()
    return True


# --------------------------------------------------------------- http layer

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "CodexGym"
    gym = None

    def log_message(self, fmt, *args):
        pass

    # -- helpers
    def _send(self, code, body, ctype="application/json"):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _json(self, code, obj):
        self._send(code, json.dumps(obj), "application/json")

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path in ("/", "/index.html"):
            return self._file("index.html")
        if path == "/api/state":
            return self._json(200, self.gym.snapshot())
        if path == "/api/repos":
            out = []
            # starter gyms first: a new player's own projects should top the list
            for base in (STARTER_BASE, os.path.expanduser("~/code")):
                if not os.path.isdir(base):
                    continue
                for name in sorted(os.listdir(base)):
                    full = os.path.join(base, name)
                    if os.path.isdir(full) and full not in out:
                        out.append(full)
            return self._json(200, {"repos": out[:200], "current": self.gym.stats["root"]})
        if path == "/api/project":
            return self._json(200, project_state(self.gym))
        if path == "/api/quests":
            return self._json(200, {
                "quests": quest_list(self.gym),
                "difficulty": DIFFICULTY,
                "repo": self.gym.stats["repo"],
            })
        if path == "/api/sessions":
            idx = session_index()
            return self._json(200, {
                # `path` stays server-side; the client replays by `file` name
                "sessions": [{k: v for k, v in s.items() if k != "path"}
                             for s in idx["sessions"]],
                "total": idx["total"], "scanned": idx["scanned"],
            })
        if path == "/api/scores":
            idx = session_index()
            return self._json(200, {
                "models": score_models(idx["sessions"]),
                "sessions": len(idx["sessions"]),
                "total": idx["total"], "scanned": idx["scanned"],
            })
        if path == "/api/events":
            return self._sse()
        if path.startswith("/static/"):
            return self._file(path[len("/static/"):])
        return self._send(404, "not found", "text/plain")

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            n = 0
        if n > 64_000:
            return self._json(413, {"error": "too big"})
        try:
            body = json.loads(self.rfile.read(n) or b"{}")
        except ValueError:
            return self._json(400, {"error": "bad json"})
        if not isinstance(body, dict):
            return self._json(400, {"error": "bad body"})

        if path == "/api/train":
            try:
                dispatch(self.gym, body.get("prompt"), body.get("model"),
                         body.get("effort", "medium"), body.get("sandbox", "workspace-write"),
                         body.get("cwd"))
            except ValueError as exc:
                return self._json(400, {"error": str(exc)})
            return self._json(200, {"ok": True})

        if path == "/api/rack":
            proc = self.gym.workout
            if proc is not None and proc is not STARTING and proc.poll() is None:
                proc.terminate()
                self.gym.emit("note", text="RACK IT - workout stopped", tone="bad")
                return self._json(200, {"ok": True})
            return self._json(200, {"ok": False, "error": "nothing running"})

        if path == "/api/quest":
            level = DIFFICULTY.get(body.get("difficulty") or "normal")
            if not level:
                return self._json(400, {"error": "pick a weight"})
            try:
                prompt = quest_prompt(self.gym, body.get("id"), body.get("input"),
                                      body.get("target"))
                dispatch(self.gym, prompt, level["model"], level["effort"],
                         body.get("sandbox") or "workspace-write",
                         self.gym.stats["root"])
            except ValueError as exc:
                return self._json(400, {"error": str(exc)})
            return self._json(200, {"ok": True, "prompt": prompt})

        if path == "/api/newgym":
            try:
                root = make_starter(body.get("name"))
            except ValueError as exc:
                return self._json(400, {"error": str(exc)})
            except OSError as exc:
                return self._json(400, {"error": "could not create it: %s" % exc})
            stats = self.gym.load_repo(root)
            self.gym.emit("floor", zones=self.gym.zones, stats=stats)
            self.gym.emit("note", tone="cue", text="NEW GYM OPENED - %s" % root)
            return self._json(200, {"ok": True, "root": root, "stats": stats})

        if path == "/api/replay":
            name = body.get("file") or ""
            try:
                speed = float(body.get("speed") or 4.0)
            except (TypeError, ValueError):
                return self._json(400, {"error": "bad speed"})
            speed = max(0.25, min(32.0, speed))
            # resolve by basename against the index, so no client-supplied path
            # ever reaches open() - this endpoint reads files off disk
            match = None
            for s in session_index()["sessions"]:
                if s["file"] == name:
                    match = s
                    break
            if not match:
                return self._json(400, {"error": "unknown session"})
            if self.gym.busy():
                return self._json(400, {"error": "already busy - stop it first"})

            gym = self.gym
            if match.get("cwd") and os.path.isdir(match["cwd"]):
                gym.emit("floor", zones=gym.zones, stats=gym.load_repo(match["cwd"]))
            gym.replaying = {"file": match["file"], "speed": speed}
            gym.replay_stop = threading.Event()
            gym.emit("replay", replaying=gym.replaying)
            gym.emit("running", running=True)
            gym.emit("note", tone="cue", text="REPLAY %s  (%gx)" % (match["file"], speed))
            threading.Thread(target=replay_loop,
                             args=(gym, match["path"], speed, gym.replay_stop),
                             daemon=True).start()
            return self._json(200, {"ok": True})

        if path == "/api/replay/stop":
            if self.gym.replay_stop:
                self.gym.replay_stop.set()
                return self._json(200, {"ok": True})
            return self._json(200, {"ok": False, "error": "not replaying"})

        if path == "/api/chat":
            text = (body.get("text") or "").strip()
            if not text:
                return self._json(400, {"error": "say something first"})
            level = DIFFICULTY.get(body.get("difficulty") or "normal") or DIFFICULTY["normal"]
            model = body.get("model") or level["model"]
            effort = body.get("effort") or level["effort"]
            resume = self.gym.thread_id if body.get("resume") is not False else None
            self.gym.say("you", text)
            try:
                dispatch(self.gym, text, model, effort,
                         body.get("sandbox") or "workspace-write",
                         self.gym.stats["root"], resume=resume)
            except ValueError as exc:
                # a fresh session is the right fallback when the old one is gone
                if resume:
                    try:
                        dispatch(self.gym, text, model, effort,
                                 body.get("sandbox") or "workspace-write",
                                 self.gym.stats["root"])
                        return self._json(200, {"ok": True, "resumed": False})
                    except ValueError as exc2:
                        return self._json(400, {"error": str(exc2)})
                return self._json(400, {"error": str(exc)})
            return self._json(200, {"ok": True, "resumed": bool(resume)})

        if path == "/api/answer":
            if not self.gym.pending_question:
                return self._json(400, {"error": "nothing was asked"})
            try:
                dispatch(self.gym, body.get("text"), body.get("model") or None,
                         body.get("effort", "medium"),
                         body.get("sandbox", "workspace-write"),
                         body.get("cwd") or self.gym.stats["root"],
                         resume=self.gym.thread_id or "--last")
            except ValueError as exc:
                return self._json(400, {"error": str(exc)})
            return self._json(200, {"ok": True})

        if path == "/api/repo":
            target = body.get("root") or ""
            root = os.path.abspath(os.path.expanduser(target))
            if not os.path.isdir(root):
                return self._json(400, {"error": "no such directory"})
            stats = self.gym.load_repo(root)
            self.gym.emit("floor", zones=self.gym.zones, stats=stats)
            if stats["truncated"]:
                self.gym.emit("note", tone="cue", text="FLOOR FULL - %d files not placed"
                              % stats["truncated"])
            return self._json(200, {"ok": True, "stats": stats})

        return self._json(404, {"error": "not found"})

    # -- static files, traversal-safe
    def _file(self, rel):
        full = os.path.abspath(os.path.join(STATIC, rel))
        if not full.startswith(STATIC + os.sep) or not os.path.isfile(full):
            return self._send(404, "not found", "text/plain")
        ctype = {".html": "text/html", ".css": "text/css",
                 ".js": "application/javascript"}.get(os.path.splitext(full)[1],
                                                      "application/octet-stream")
        with open(full, "rb") as fh:
            return self._send(200, fh.read(), ctype + "; charset=utf-8")

    # -- server sent events
    def _sse(self):
        q = self.gym.subscribe()
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        try:
            self._push(self.gym.snapshot())
            while True:
                try:
                    self._push(q.get(timeout=15))
                except queue.Empty:
                    self.wfile.write(b": ping\n\n")
                    self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            self.gym.unsubscribe(q)

    def _push(self, msg):
        self.wfile.write(b"data: " + json.dumps(msg).encode("utf-8") + b"\n\n")
        self.wfile.flush()


# ------------------------------------------------- project lifecycle states

# One pipeline every piece of work travels, from "on the board" to "shipped".
# Each stage is derived from real git and test state, never guessed.
STAGES = [
    ("PLANNED", "on the board, nothing started"),
    ("TRAINING", "the agent is changing code"),
    ("SPOTTER", "blocked: it is asking you something"),
    ("VERIFY", "tests have been run"),
    ("CLEAN", "tests pass, changes not saved yet"),
    ("LOGGED", "committed to git"),
    ("SHIPPED", "pushed to the remote"),
]


def git(root, *args, **kw):
    """Run a read-only git command. Returns right-stripped stdout, or None."""
    exe = shutil.which("git")
    if not exe or not os.path.isdir(root):
        return None
    try:
        p = subprocess.run([exe] + list(args), cwd=root, stdin=subprocess.DEVNULL,
                           stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                           text=True, timeout=kw.get("timeout", 10))
    except (OSError, subprocess.SubprocessError):
        return None
    if p.returncode != 0:
        return None
    return p.stdout.rstrip()


def project_state(gym):
    """Where this project actually stands, from git plus the session's own tests."""
    root = gym.stats["root"]
    inside = git(root, "rev-parse", "--is-inside-work-tree") == "true"
    st = {
        "git": inside, "branch": None, "dirty": [], "dirty_n": 0, "ahead": None,
        "upstream": False, "last_commit": None, "tests": gym.last_test,
        "stages": [{"name": n, "note": d} for n, d in STAGES],
        "stage": 0,
    }
    if not inside:
        st["stage"] = 1 if (gym.hud.get("reps") or 0) else 0
        return st

    st["branch"] = git(root, "rev-parse", "--abbrev-ref", "HEAD")
    porcelain = git(root, "status", "--porcelain") or ""
    files = []
    for line in porcelain.splitlines():
        name = line[3:].strip()
        if " -> " in name:                       # renames
            name = name.split(" -> ")[-1]
        if name:
            files.append(name)
    st["dirty"] = files[:200]
    st["dirty_n"] = len(files)
    st["last_commit"] = git(root, "log", "-1", "--format=%h %s")

    ahead = git(root, "rev-list", "--count", "@{u}..HEAD")
    if ahead is not None and ahead.isdigit():
        st["upstream"] = True
        st["ahead"] = int(ahead)

    # furthest stage reached, then let a block override it
    stage = 0
    if files or (gym.hud.get("reps") or 0):
        stage = 1
    if gym.last_test is not None:
        stage = 3
        if gym.last_test:
            stage = 4
    if not files and st["ahead"]:
        stage = 5
    if not files and st["upstream"] and st["ahead"] == 0:
        stage = 6
    if gym.pending_question:
        stage = 2
    st["stage"] = stage
    return st


# ---------------------------------------------------- quests (layman mode)

# A non-technical player picks a goal in plain language; the app writes the
# engineering prompt. Templates are filled from the actual floor, so "train the
# heaviest lift" names a real file in the player's own repo.
QUESTS = [
    {
        "id": "readme", "name": "EXPLAIN THE PROJECT", "lift": "Warm-up",
        "blurb": "Write a README so a newcomer understands what this is.",
        "prompt": ("Write or improve README.md so a newcomer understands what this project "
                   "does, how to run it, and how to test it. Keep every statement accurate "
                   "to the code that is actually here. Do not invent features."),
    },
    {
        "id": "tests", "name": "TEST THE BIG ONE", "lift": "Heavy set",
        "blurb": "Add tests for the heaviest file on the floor.",
        "target": "heaviest",
        "prompt": ("Write tests for {target}. Cover the main behaviours and the obvious edge "
                   "cases. Put them where the existing tests live, or in tests/ if there are "
                   "none. Then run the test suite and make everything pass."),
    },
    {
        "id": "fix", "name": "FIX WHAT'S BROKEN", "lift": "Form check",
        "blurb": "Run the tests and repair anything failing.",
        "prompt": ("Run the project's test suite. If anything fails, fix the source code "
                   "rather than weakening the tests, until everything passes. If everything "
                   "already passes, say so and stop without changing anything."),
    },
    {
        "id": "feature", "name": "BUILD SOMETHING NEW", "lift": "Max effort",
        "blurb": "Describe it in one line and the athlete builds it.",
        "needs": "Describe the feature in one line",
        "prompt": ("Add this feature: {input}\n\nFollow the conventions already used in this "
                   "codebase. Add a test for the new behaviour, then run the test suite and "
                   "make it pass."),
    },
    {
        "id": "cleanup", "name": "TIDY UP", "lift": "Cut",
        "blurb": "Remove dead code without changing behaviour.",
        "prompt": ("Find and remove dead code: unused functions, unused imports, unreachable "
                   "branches and files nothing references. Do not change any behaviour. Run "
                   "the test suite afterwards to prove nothing broke."),
    },
    {
        "id": "comment", "name": "EXPLAIN THE TRICKY PARTS", "lift": "Mobility",
        "blurb": "Document the code that is hardest to follow.",
        "prompt": ("Find the handful of functions in this project that are hardest to follow "
                   "and add a short docstring or comment to each, explaining why the code is "
                   "the way it is. Do not restate what the code obviously does. Change no "
                   "behaviour."),
    },
    {
        "id": "split", "name": "BREAK UP THE HEAVIEST", "lift": "Max lift",
        "blurb": "Split the biggest file into smaller modules.",
        "target": "heaviest",
        "prompt": ("Split {target} into smaller focused modules without changing any "
                   "behaviour. Keep the public names importable from where they are today. "
                   "Run the test suite to prove the refactor is safe."),
    },
]

# plain words in, model and effort out
DIFFICULTY = {
    "easy":   {"model": "gpt-5.4-mini", "effort": "low",
               "label": "WARM-UP", "note": "quick and cheap"},
    "normal": {"model": None, "effort": "medium",
               "label": "WORKING SET", "note": "your configured model"},
    "hard":   {"model": "gpt-5.6-sol", "effort": "high",
               "label": "HEAVY", "note": "slower, thinks harder"},
}


def heaviest_file(gym):
    best = None
    for z in gym.zones:
        for e in z["equipment"]:
            if e["kind"] in (RACK, TREADMILL) and (best is None or e["kg"] > best["kg"]):
                best = e
    return best


def quest_list(gym):
    """Quests with their targets resolved against this repo."""
    heavy = heaviest_file(gym)
    out = []
    for q in QUESTS:
        item = {k: v for k, v in q.items() if k != "prompt"}
        if q.get("target") == "heaviest":
            if not heavy:
                continue                       # nothing to aim at yet
            item["target"] = heavy["path"]
            item["target_kg"] = heavy["kg"]
        out.append(item)
    return out


def quest_prompt(gym, quest_id, user_input=None, target=None):
    """Turn a quest choice into the real prompt sent to Codex.

    `target` lets a click on a building aim the same workout at that folder or
    file instead of whatever the board picked by default.
    """
    quest = next((q for q in QUESTS if q["id"] == quest_id), None)
    if not quest:
        raise ValueError("unknown workout")
    text = quest["prompt"]
    if target:
        # only somewhere that exists inside this project may be aimed at
        root = gym.stats["root"]
        full = os.path.abspath(os.path.join(root, target))
        if not full.startswith(root + os.sep) and full != root:
            raise ValueError("that is not in this project")
        if not os.path.exists(full):
            raise ValueError("no such file or folder")
        rel = os.path.relpath(full, root)
        text = text.replace("{target}", rel)
        if "{target}" not in quest["prompt"]:
            text += "\n\nWork on %s specifically." % rel
    elif quest.get("target") == "heaviest":
        heavy = heaviest_file(gym)
        if not heavy:
            raise ValueError("no files on the floor to train")
        text = text.replace("{target}", heavy["path"])
    if quest.get("needs"):
        detail = (user_input or "").strip()
        if not detail:
            raise ValueError("tell the athlete what to build")
        if len(detail) > 2000:
            raise ValueError("keep it to a line or two")
        text = text.replace("{input}", detail)
    # a layman cannot be expected to know it must say this, and without it the
    # agent often stops to ask instead of training
    return text + ("\n\nMake reasonable choices and proceed rather than asking "
                   "questions. Keep the change as small as it can be.")


# ------------------------------------------------------- plain english coach

def plain_english(exercise, detail, name=None):
    """One human sentence for a rep, for players who do not read shell.

    `name` is the file the caller already knows about. Recovering it from the
    formatted detail is unreliable: "+5 -0  hello.py  25kg -> 35kg" ends in a
    weight, which is how this once reported "editing 35kg".
    """
    d = (detail or "").strip()
    if not name:
        name = d.split()[-1] if d else ""
    if exercise == DEADLIFT:
        if d.startswith("add "):
            return "writing a new file, %s" % d[4:]
        if d.startswith("update "):
            return "rewriting part of %s" % d[7:]
        if d.startswith("delete "):
            return "deleting %s" % d[7:]
        return "editing %s" % (name or "a file")
    if exercise == RUN:
        return "running the tests"
    if exercise == BENCH:
        return "building the project"
    if exercise == SCOUT:
        return "reading the code to understand it"
    if exercise == PR:
        return "saving the work to git"
    if exercise == FAIL:
        return "that command failed — working out why"
    if exercise == CHALK:
        return "thinking"
    return "running a command"


# ---------------------------------------------- session index, replay, eval

SESSION_SCAN_LIMIT = 200        # newest N rollouts; anything older is reported


def rollout_files():
    out = []
    if not os.path.isdir(CODEX_SESSIONS):
        return out
    for dirpath, _dirs, files in os.walk(CODEX_SESSIONS):
        for name in files:
            if name.startswith("rollout-") and name.endswith(".jsonl"):
                full = os.path.join(dirpath, name)
                try:
                    out.append((os.path.getmtime(full), full))
                except OSError:
                    continue
    out.sort(reverse=True)
    return [f for _m, f in out]


def read_session(path):
    """Summarise one rollout: identity plus the numbers an eval needs.

    One pass, and only fields that are cheap to pull - roughly 8ms per file.
    """
    s = {
        "path": path, "id": None, "file": os.path.basename(path), "model": None,
        "cwd": None, "started": None, "prompt": None, "sets": 0, "reps": 0,
        "edits": 0, "failed_edits": 0, "aborts": 0, "calories": 0, "misses": 0,
        "tokens": 0, "duration_ms": 0, "ttft_ms": 0, "ttft_n": 0, "lines": 0,
    }
    try:
        with open(path, "rb") as fh:
            for raw in fh:
                if not raw.strip():
                    continue
                try:
                    d = json.loads(raw)
                except ValueError:
                    continue
                p = d.get("payload") or {}
                t, pt = d.get("type"), p.get("type")
                if t == "session_meta":
                    s["id"] = p.get("session_id") or p.get("id")
                    s["cwd"] = p.get("cwd")
                    s["started"] = p.get("timestamp") or d.get("timestamp")
                elif t == "turn_context":
                    s["model"] = s["model"] or p.get("model")
                elif t == "response_item" and pt == "custom_tool_call":
                    s["reps"] += 1
                elif t == "response_item" and pt == "custom_tool_call_output":
                    if not tool_ok(p.get("output")):
                        s["misses"] += 1
                elif t == "event_msg":
                    if pt == "task_started":
                        s["sets"] += 1
                    elif pt == "user_message" and not s["prompt"]:
                        s["prompt"] = (p.get("message") or "")[:160]
                    elif pt == "task_complete":
                        s["duration_ms"] += int(p.get("duration_ms") or 0)
                        if p.get("time_to_first_token_ms"):
                            s["ttft_ms"] += int(p["time_to_first_token_ms"])
                            s["ttft_n"] += 1
                    elif pt == "turn_aborted":
                        s["aborts"] += 1
                    elif pt == "patch_apply_end":
                        if p.get("success"):
                            s["edits"] += 1
                        else:
                            s["failed_edits"] += 1
                        for f in diff_files(p.get("changes")):
                            s["lines"] += f["added"] + f["removed"]
                    elif pt == "token_count":
                        info = p.get("info") or {}
                        tot = info.get("total_token_usage") or {}
                        s["calories"] = tot.get("output_tokens") or s["calories"]
                        s["tokens"] = tot.get("total_tokens") or s["tokens"]
    except OSError:
        return None
    if not s["model"] and not s["reps"] and not s["sets"]:
        return None                       # empty or unreadable session
    return s


_index = {"at": 0.0, "sessions": [], "total": 0, "scanned": 0}
_index_lock = threading.Lock()


def session_index(force=False):
    """Newest sessions, summarised. Cached: the walk plus parse is ~2s cold."""
    with _index_lock:
        if not force and time.time() - _index["at"] < 60 and _index["sessions"]:
            return _index
        files = rollout_files()
        rows = []
        for path in files[:SESSION_SCAN_LIMIT]:
            row = read_session(path)
            if row:
                rows.append(row)
        _index.update({"at": time.time(), "sessions": rows,
                       "total": len(files), "scanned": len(files[:SESSION_SCAN_LIMIT])})
        return _index


def score_models(sessions):
    """Per-model training report. The gym's answer to 'which model is better'."""
    by = {}
    for s in sessions:
        m = s.get("model")
        if not m:
            continue
        a = by.setdefault(m, {
            "model": m, "klass": athlete_for_model(m)["klass"], "sessions": 0,
            "sets": 0, "reps": 0, "misses": 0, "edits": 0, "failed_edits": 0,
            "aborts": 0, "calories": 0, "lines": 0, "duration_ms": 0,
            "ttft_ms": 0, "ttft_n": 0,
        })
        a["sessions"] += 1
        for k in ("sets", "reps", "misses", "edits", "failed_edits", "aborts",
                  "calories", "lines", "duration_ms", "ttft_ms", "ttft_n"):
            a[k] += s.get(k) or 0

    out = []
    for a in by.values():
        edits = a["edits"] or 0
        attempts = edits + a["failed_edits"]
        # None, not 0, where there is no data: the leaderboard highlights the
        # best value per column, and a placeholder zero would always win
        a["reps_per_set"] = round(a["reps"] / a["sets"], 1) if a["sets"] else None
        # the headline eval number: output tokens burned per surviving edit
        a["cal_per_edit"] = int(a["calories"] / edits) if edits else None
        a["lines_per_edit"] = round(a["lines"] / edits, 1) if edits else None
        a["miss_pct"] = round(100.0 * a["misses"] / a["reps"], 1) if a["reps"] else None
        a["clean_pct"] = round(100.0 * edits / attempts, 1) if attempts else None
        a["ttft_s"] = round(a["ttft_ms"] / a["ttft_n"] / 1000.0, 2) if a["ttft_n"] else None
        a["set_s"] = round(a["duration_ms"] / a["sets"] / 1000.0, 1) if a["sets"] else None
        out.append(a)
    out.sort(key=lambda x: -x["reps"])
    return out


def replay_loop(gym, path, speed, stop_evt):
    """Play a recorded session back through the same normalizer, in tempo.

    Real inter-event gaps are kept but clamped: a 40-minute session with long
    idle stretches has to stay watchable, and records must not move (see
    Gym.bump) or a replay would mint fake personal bests.
    """
    prev = None
    try:
        with open(path, "rb") as fh:
            lines = fh.readlines()
    except OSError:
        gym.emit("note", text="cannot read that session", tone="bad")
        gym.replay_end()
        return

    for raw in lines:
        if stop_evt.is_set():
            break
        raw = raw.strip()
        if not raw:
            continue
        try:
            ev = json.loads(raw)
        except ValueError:
            continue
        now = parse_ts(ev.get("timestamp"))
        if prev is not None and now is not None:
            gap = max(0.0, min(1.2, now - prev)) / max(0.1, speed)
            if gap:
                stop_evt.wait(gap)
        elif prev is None:
            stop_evt.wait(0.05)
        if now is not None:
            prev = now
        try:
            handle_rollout_event(gym, ev)
        except (ValueError, KeyError, TypeError, AttributeError):
            continue
    gym.emit("note", text="REPLAY COMPLETE", tone="cue")
    gym.replay_end()


def parse_ts(ts):
    """ISO-8601 with a Z suffix -> epoch seconds. Python 3.9 rejects the Z."""
    if not ts or not isinstance(ts, str):
        return None
    try:
        import datetime
        return datetime.datetime.fromisoformat(
            ts.replace("Z", "+00:00")).timestamp()
    except (ValueError, TypeError):
        return None


class GymServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def handle_error(self, request, client_address):
        """Browsers drop the SSE stream on refresh; that is not an error."""
        exc = sys.exc_info()[1]
        if isinstance(exc, (BrokenPipeError, ConnectionResetError)):
            return
        ThreadingHTTPServer.handle_error(self, request, client_address)


# ------------------------------------------------------------------ selftest

def selftest():
    assert classify("src/app.ts") == RACK
    assert classify("src/app_test.go") == TREADMILL
    assert classify("tests/helpers.py") == TREADMILL
    assert classify("test_thing.py") == TREADMILL
    assert classify("package.json") == DUMBBELL
    assert classify("README.md") == MAT
    assert classify("ui/main.css") == BAG
    assert classify("logo.png") is None

    assert loc_to_kg(0) == 20.0
    assert loc_to_kg(1078) == 290.0
    assert loc_to_kg(10 ** 6) == 400.0
    assert loc_to_kg(40) == 30.0

    # every weight the floor can produce must be exactly loadable on a real bar,
    # and stay inside the sleeve budget the renderer draws
    for loc in list(range(0, 3000)) + [10 ** 6]:
        kg = loc_to_kg(loc)
        pl = kg_to_plates(kg)
        assert abs(20.0 + 2 * sum(pl) - kg) < 0.01, (loc, kg, pl)
        assert len(pl) <= 10, (loc, kg, pl)
    assert kg_to_plates(60.0) == [20.0]
    assert kg_to_plates(20.0) == []

    assert strip_shell_wrapper("/bin/zsh -lc 'pytest -q'") == "pytest -q"
    assert strip_shell_wrapper('bash -c "npm run build"') == "npm run build"
    assert strip_shell_wrapper("ls -a") == "ls -a"

    assert exercise_for_command("/bin/zsh -lc 'pytest -q tests/'") == RUN
    assert exercise_for_command("/bin/zsh -lc 'npm run test'") == RUN
    assert exercise_for_command("bash -lc 'cargo build --release'") == BENCH
    assert exercise_for_command("apply_patch <<EOF") == DEADLIFT
    assert exercise_for_command("git commit -m x") == PR
    assert exercise_for_command("/bin/zsh -lc 'rg foo src/'") == SCOUT
    assert exercise_for_command("cat README.md") == SCOUT
    assert exercise_for_command("curl https://x") == PRESS
    # a patch beats a test runner in the same line
    assert exercise_for_command("git apply p.diff && pytest") == DEADLIFT
    # the rollout stream sends the raw patch envelope, not the tool name
    assert exercise_for_command("*** Begin Patch\n*** Update File: src/calc.py") == DEADLIFT
    assert exercise_for_command("*** Add File: a.py") == DEADLIFT

    # both event sources speak add/update/delete + unified_diff but disagree on
    # the container, so diff_stats has to read a map and a list alike
    DIFF = "@@\n+one\n+two\n-gone\n+++ b/x\n--- a/x\n"
    one = {"path": "a/b.py", "added": 2, "removed": 1}
    assert diff_files({"a/b.py": {"type": "update", "unified_diff": DIFF}}) == [one]
    assert diff_files([{"path": "a/b.py", "unified_diff": DIFF}]) == [one]
    assert diff_files([{"path": "a/b.py", "update": {"unified_diff": DIFF}}]) == [one]
    assert diff_files([{"path": "d.py", "added": 4, "removed": 2}]) == [
        {"path": "d.py", "added": 4, "removed": 2}]
    assert diff_files(None) == [] and diff_files([]) == []
    # a multi-file patch is one lift per file, never just the first
    multi = diff_files({"a.py": {"unified_diff": DIFF}, "b.py": {"unified_diff": DIFF}})
    assert len(multi) == 2, multi
    assert sorted(f["path"] for f in multi) == ["a.py", "b.py"]

    assert athlete_for_model("gpt-5.6-sol")["klass"] == "POWERLIFTER"
    assert athlete_for_model("gpt-5.6-luna")["klass"] == "OLYMPIC LIFTER"
    assert athlete_for_model("gpt-5.6-terra")["klass"] == "STRONGMAN"

    # real inputs seen in the wild: the harness wraps commands in JS, and the
    # log must show the command, not the plumbing around it
    js = 'const r = await tools.exec_command({cmd:"python3 tests/test_calc.py","workdir":"/x"});'
    assert command_of(js) == "python3 tests/test_calc.py", command_of(js)
    assert exercise_for_input(js) == RUN, exercise_for_input(js)
    js2 = "await tools.exec_command({ 'cmd': 'rg -n foo src/' })"
    assert command_of(js2) == "rg -n foo src/", command_of(js2)
    assert exercise_for_input(js2) == SCOUT
    js3 = 'tools.exec_command({cmd:"echo \\"hi there\\""})'
    assert command_of(js3) == 'echo "hi there"', command_of(js3)
    patch = 'const patch = "*** Begin Patch\n*** Add File: /a/b/money.py\n+x\n*** End Patch"'
    assert command_of(patch) == "add money.py", command_of(patch)
    assert exercise_for_input(patch) == DEADLIFT
    multi = "*** Begin Patch\n*** Update File: /a/x.py\n*** Add File: /a/y.py\n"
    assert command_of(multi) == "update x.py  add y.py", command_of(multi)
    # the same patch embedded in a JS string literal: the body follows the path
    # as a literal backslash-n and must not be swallowed into the filename
    esc = 'const patch = "*** Begin Patch\\n*** Add File: /a/money.py\\n+\\"\\"\\"Money.\\"\\"\\"\\n";'
    assert command_of(esc) == "add money.py", command_of(esc)
    assert "\\n" not in command_of(esc)
    # a plain shell string must pass straight through
    assert command_of("/bin/zsh -lc 'pytest -q'") == "pytest -q"
    assert exercise_for_input("/bin/zsh -lc 'pytest -q'") == RUN
    assert command_of("") == "" and command_of(None) == ""

    # command results decide whether a rep counts as made or missed
    assert tool_ok("Script completed\nWall time 0.2 seconds\nOutput:\n") is True
    assert tool_ok([{"type": "input_text", "text": "Script completed\nOutput:\n"}]) is True
    assert tool_ok([{"type": "input_text", "text": "Script failed\nOutput:\nboom"}]) is False
    assert tool_ok("Exit code: 1\n") is False
    assert tool_ok("Exit code: 0\n") is True
    assert tool_ok(None) is True and tool_ok([]) is True      # unknown != failure
    assert tool_ok("something new entirely") is True

    # a held tool call becomes a rep only once its result lands
    held = Gym(HERE, Records(path=os.path.join(HERE, ".selftest-held.json")))
    handle_rollout_event(held, {"type": "event_msg", "payload": {"type": "task_started"}})
    handle_rollout_event(held, {"type": "response_item", "payload": {
        "type": "custom_tool_call", "input": "/bin/zsh -lc 'pytest -q'"}})
    assert held.hud["reps"] == 0, "rep must wait for its result"
    handle_rollout_event(held, {"type": "response_item", "payload": {
        "type": "custom_tool_call_output", "output": "Script failed\nboom"}})
    assert held.hud["reps"] == 1 and held.hud["exercise"] == FAIL, held.hud
    # a call with no result must still be counted when the set closes
    handle_rollout_event(held, {"type": "response_item", "payload": {
        "type": "custom_tool_call", "input": "cat README.md"}})
    handle_rollout_event(held, {"type": "event_msg", "payload": {"type": "task_complete"}})
    assert held.hud["reps"] == 2, held.hud["reps"]
    os.remove(os.path.join(HERE, ".selftest-held.json"))
    assert athlete_for_model("gpt-5.4-mini")["klass"] == "SPRINTER"
    assert athlete_for_model(None)["klass"] == "LIFTER"

    # normalizer end-to-end on the real rollout schema
    rec = Records(path=os.path.join(HERE, ".selftest-records.json"))
    gym = Gym(HERE, rec)

    # quests must resolve against the real floor and always produce a prompt
    qs = quest_list(gym)
    assert qs and all("prompt" not in q for q in qs)      # template stays server-side
    heavy = heaviest_file(gym)
    assert heavy is not None
    p_tests = quest_prompt(gym, "tests")
    assert heavy["path"] in p_tests, p_tests
    assert "{target}" not in p_tests
    p_feat = quest_prompt(gym, "feature", "a dark mode toggle")
    assert "a dark mode toggle" in p_feat and "{input}" not in p_feat
    for bad in (("feature", ""), ("feature", "   "), ("nope", "x")):
        try:
            quest_prompt(gym, bad[0], bad[1])
            raise AssertionError("accepted %r" % (bad,))
        except ValueError:
            pass
    assert set(DIFFICULTY) == {"easy", "normal", "hard"}

    # the coach speaks plain English, never shell
    assert plain_english(DEADLIFT, "add money.py") == "writing a new file, money.py"
    assert plain_english(DEADLIFT, "+3 -1  calc.py") == "editing calc.py"
    # a weight-change suffix must not be mistaken for the filename
    assert plain_english(DEADLIFT, "+5 -0  hello.py  25kg -> 35kg", "hello.py") \
        == "editing hello.py"
    assert plain_english(DEADLIFT, "touched  x.py", "x.py") == "editing x.py"
    assert plain_english(RUN, "pytest -q") == "running the tests"
    assert plain_english(FAIL, "rm -rf /x") .startswith("that command failed")
    assert plain_english(PRESS, "curl x") == "running a command"
    assert plain_english(DEADLIFT, "") == "editing a file"

    # starter-gym names are matched against an allowlist, not sanitised
    for bad in ("../escape", "/abs", "Has Caps!", "", "x" * 60, "-lead"):
        try:
            make_starter(bad)
            raise AssertionError("accepted %r" % bad)
        except ValueError:
            pass

    handle_rollout_event(gym, {"type": "event_msg", "payload": {
        "type": "task_started", "model_context_window": 258400}})
    assert gym.hud["set"] == 1 and gym.hud["context"] == 258400
    # stamina tracks CURRENT context occupancy, not lifetime spend: cumulative
    # usage passes the window after a few turns and would pin the bar at zero
    handle_rollout_event(gym, {"type": "event_msg", "payload": {
        "type": "token_count", "info": {
            "last_token_usage": {"input_tokens": 25540, "output_tokens": 300},
            "total_token_usage": {"total_tokens": 900000, "output_tokens": 4000},
            "model_context_window": 258400}}})
    assert abs(gym.hud["stamina"] - 0.9) < 0.01, gym.hud["stamina"]
    assert gym.hud["calories"] == 4000, gym.hud["calories"]
    # and it never runs past the ends of the bar
    for used in (0, 258400, 10 ** 9):
        gym.tokens(used, 0, 258400)
        assert 0.0 <= gym.hud["stamina"] <= 1.0, (used, gym.hud["stamina"])
    handle_rollout_event(gym, {"type": "event_msg", "payload": {
        "type": "patch_apply_end", "success": True, "changes": {
            "a/b.py": {"unified_diff": "@@\n+one\n+two\n-gone\n"}}}})
    assert gym.hud["reps"] == 1
    handle_rollout_event(gym, {"type": "event_msg", "payload": {
        "type": "task_complete", "last_agent_message": "done"}})
    assert gym.hud["state"] == "RESTING"

    # exec schema (as observed from `codex exec --json`)
    state = gym.snapshot()
    assert state["status"] == "idle"
    assert state["thread_id"] is None and state["result"] is None
    lifecycle = gym.subscribe()
    gym.begin_run()
    assert gym.snapshot()["status"] == "running"
    handle_exec_event(gym, {"type": "thread.started", "thread_id": "thread-1"})
    handle_exec_event(gym, {"type": "turn.started"})
    handle_exec_event(gym, {"type": "item.completed", "item": {
        "type": "command_execution", "command": "/bin/zsh -lc 'ls -a'", "exit_code": 0}})
    assert gym.hud["exercise"] == SCOUT
    handle_exec_event(gym, {"type": "item.completed", "item": {
        "type": "command_execution", "command": "/bin/zsh -lc 'pytest'", "exit_code": 1}})
    assert gym.hud["exercise"] == FAIL
    before = gym.hud["reps"]
    handle_exec_event(gym, {"type": "item.completed", "item": {
        "type": "file_change", "changes": [
            {"path": "src/calc.py", "unified_diff": DIFF},
            {"path": "src/stats.py", "unified_diff": DIFF}]}})
    assert gym.hud["reps"] == before + 2, gym.hud["reps"]      # two files, two lifts
    assert gym.hud["exercise"] == DEADLIFT
    handle_exec_event(gym, {"type": "item.completed", "item": {
        "type": "agent_message", "text": "Finished cleanly."}})
    assert gym.snapshot()["result"] == "Finished cleanly."
    handle_exec_event(gym, {"type": "turn.completed", "usage": {}})
    gym.finish_run("completed")
    state = gym.snapshot()
    assert state["status"] == "completed" and state["thread_id"] == "thread-1"
    events = []
    while True:
        try:
            events.append(lifecycle.get_nowait())
        except queue.Empty:
            break
    gym.unsubscribe(lifecycle)
    assert [e["status"] for e in events if e["kind"] == "lifecycle"] == [
        "running", "completed"]
    assert [e["text"] for e in events if e["kind"] == "result"] == [
        "Finished cleanly."]

    class FakeProc(object):
        def __init__(self, code=None):
            self.code = code

        def poll(self):
            return self.code

    gym.thread_id = "old-thread"
    old_generation = gym.reserve_run()
    assert gym.thread_id is None                    # a fresh run cannot resume stale state
    assert gym.complete_run(old_generation, STARTING, "completed")
    gym.thread_id = "resume-thread"
    generation = gym.reserve_run("resume-thread")
    assert gym.thread_id == "resume-thread"
    current = FakeProc()
    gym.attach_run(generation, current)
    try:
        gym.reserve_run()
        raise AssertionError("admitted an overlapping run")
    except ValueError:
        pass
    assert not gym.complete_run(old_generation, STARTING, "failed", "stale")
    assert gym.run_status == "running" and gym.workout is current
    assert gym.complete_run(generation, current, "stopped")

    # spectator must stand down while we own a dispatched run, or every event
    # gets counted twice
    assert gym.dispatching() is False

    # The counters live in the server's hud, but start_set/rep emit only their
    # own event -- no `hud` event follows. The browser therefore has to read the
    # count off these events, so they MUST carry it. They did not, and SET/REPS
    # sat frozen at whatever the last snapshot said for the whole session.
    counter = Gym(HERE, Records(path=os.path.join(HERE, ".selftest-counter.json")))
    sub = counter.subscribe()
    counter.start_set()
    counter.rep(PRESS, detail="one")
    counter.rep(PRESS, detail="two")
    seen = []
    while True:
        try:
            seen.append(sub.get_nowait())
        except queue.Empty:
            break
    counter.unsubscribe(sub)
    starts = [m for m in seen if m["kind"] == "set_start"]
    reps = [m for m in seen if m["kind"] == "rep"]
    assert len(starts) == 1 and starts[0].get("set") == 1, starts
    assert [m.get("n") for m in reps] == [1, 2], reps
    # and the server's own copy must agree with what it told the browser
    assert counter.hud["set"] == 1 and counter.hud["reps"] == 2, counter.hud
    os.remove(os.path.join(HERE, ".selftest-counter.json"))

    # re-weighing: growing a file must load more plates on its bar
    probe = os.path.join(HERE, "selftest_probe.py")
    with open(probe, "w") as fh:
        fh.write("x = 1\n" * 10)
    gym.load_repo(HERE)          # seeds the baseline, so this file is pre-existing
    eq = gym.find_equipment("selftest_probe.py")
    assert eq is not None and eq["loc"] == 11, eq
    light = eq["kg"]
    with open(probe, "a") as fh:
        fh.write("y = 2\n" * 400)
    moved = gym.remeasure("selftest_probe.py")
    assert moved["delta"] == 400, moved
    assert moved["kg"] > light, moved

    # with no diff to read, the log line falls back to the measured delta and
    # reports the new weight on the bar
    with open(probe, "a") as fh:
        fh.write("z = 3\n" * 100)
    detail = lift_detail("selftest_probe.py", 0, 0, gym.remeasure("selftest_probe.py"))
    assert "+100 lines" in detail and "->" in detail, detail
    # an explicit diff always wins over the measured delta
    assert "+5 -2" in lift_detail("selftest_probe.py", 5, 2, None)
    os.remove(probe)
    # a file that vanished weighs the empty bar, and must not raise
    assert gym.remeasure("selftest_probe.py")["kg"] == 20.0
    assert gym.remeasure(None) is None

    # a brand new file wheels a new station onto the floor and counts as volume
    fresh = os.path.join(HERE, "selftest_fresh.py")
    gym.rescan(force=True)
    stations = gym.stats["equipment"]
    with open(fresh, "w") as fh:
        fh.write("n = 0\n" * 40)
    # first sighting: whole file is new volume, and a station appears
    detail = lift_detail("selftest_fresh.py", 0, 0, gym.remeasure("selftest_fresh.py"))
    assert "+41 lines" in detail, detail
    assert gym.stats["equipment"] == stations + 1, gym.stats["equipment"]
    # second sighting with no edit reports no phantom volume
    assert "touched" in lift_detail("selftest_fresh.py", 0, 0, gym.remeasure("selftest_fresh.py"))
    os.remove(fresh)
    gym.rescan(force=True)

    # a patch that creates SEVERAL files must credit every one of them: the
    # single rescan sees them all at final size, so a floor-based delta would
    # credit the first and call the rest "touched"
    batch = [os.path.join(HERE, "selftest_b%d.py" % i) for i in range(3)]
    for i, p in enumerate(batch):
        with open(p, "w") as fh:
            fh.write("b = %d\n" % i * (10 + i * 5))
    details = [lift_detail(os.path.basename(p), 0, 0, gym.remeasure(os.path.basename(p)))
               for p in batch]
    assert all("lines" in d for d in details), details
    assert all("touched" not in d for d in details), details
    for p in batch:
        os.remove(p)
    gym.rescan(force=True)

    # a replay is history: it must never move the personal records, or watching
    # one session twice would inflate them twice
    gym.records.data["total_reps"] = 0
    gym.records.data["heaviest_kg"] = 0.0
    gym.replaying = {"file": "x", "speed": 4}
    assert gym.bump(reps=1, kg=999.0, file="fake.py") == []
    gym.rep(DEADLIFT, path="server.py")
    assert gym.records.data["total_reps"] == 0, gym.records.data["total_reps"]
    assert gym.records.data["heaviest_kg"] == 0.0
    gym.replaying = None
    gym.bump(reps=1, kg=45.0, file="real.py")
    assert gym.records.data["total_reps"] == 1
    assert gym.busy() is False

    assert parse_ts("2026-08-13T21:15:16.961Z") is not None      # 3.9 rejects Z
    assert parse_ts(None) is None and parse_ts("nonsense") is None
    t0 = parse_ts("2026-08-13T21:15:16.000Z")
    t1 = parse_ts("2026-08-13T21:15:18.500Z")
    assert abs((t1 - t0) - 2.5) < 0.01

    # per-model eval maths
    scored = score_models([
        {"model": "gpt-5.6-sol", "sets": 2, "reps": 20, "misses": 3, "edits": 4,
         "failed_edits": 1, "aborts": 0, "calories": 800, "lines": 40,
         "duration_ms": 60000, "ttft_ms": 4000, "ttft_n": 2},
        {"model": "gpt-5.4-mini", "sets": 1, "reps": 5, "misses": 0, "edits": 1,
         "failed_edits": 0, "aborts": 0, "calories": 100, "lines": 10,
         "duration_ms": 10000, "ttft_ms": 1000, "ttft_n": 1},
    ])
    sol = [m for m in scored if m["model"] == "gpt-5.6-sol"][0]
    assert sol["reps_per_set"] == 10.0, sol
    assert sol["cal_per_edit"] == 200, sol
    assert sol["miss_pct"] == 15.0, sol            # 3 of 20 commands failed
    assert sol["clean_pct"] == 80.0, sol           # 4 of 5 patches stuck
    assert sol["ttft_s"] == 2.0 and sol["set_s"] == 30.0, sol
    assert scored[0]["model"] == "gpt-5.6-sol"     # ranked by volume of work
    assert score_models([{"model": None, "reps": 9}]) == []

    # `codex exec resume` rejects -C and -s. Passing them made every follow-up
    # in the chat exit with "unexpected argument '-C' found".
    fresh = exec_cmd("/x/codex", "hi", "gpt-5.6-sol", "high", "workspace-write", "/repo")
    assert fresh[:2] == ["exec", "--json"] or fresh[1] == "exec", fresh
    assert "-C" in fresh and "/repo" in fresh and "-s" in fresh
    assert "resume" not in fresh and fresh[-1] == "hi"

    cont = exec_cmd("/x/codex", "and now this", None, "low", "workspace-write", "/repo",
                    resume="019fff00-dead-beef")
    assert cont[1] == "exec" and cont[2] == "resume", cont
    assert "-C" not in cont and "-s" not in cont, cont
    assert "--json" in cont and "model_reasoning_effort=low" in cont
    assert cont[-2] == "019fff00-dead-beef" and cont[-1] == "and now this", cont

    last = exec_cmd("/x/codex", "again", None, "low", "read-only", "/repo", resume="--last")
    assert last[-2] == "--last" and "-C" not in last, last
    try:
        exec_cmd("/x/codex", "x", None, "low", "read-only", "/repo", resume="; rm -rf /")
        raise AssertionError("accepted an injected session id")
    except ValueError:
        pass

    for bad in ({"effort": "turbo"}, {"model": "a b; rm -rf /"}, {"sandbox": "none"}):
        kw = {"prompt": "hi", "model": None, "effort": "low",
              "sandbox": "read-only", "cwd": HERE}
        kw.update(bad)
        try:
            dispatch(gym, **kw)
            raise AssertionError("accepted %r" % bad)
        except ValueError:
            pass

    os.remove(os.path.join(HERE, ".selftest-records.json"))
    print("selftest OK - %d equipment across %d zones in %s"
          % (gym.stats["equipment"], gym.stats["zones"], gym.stats["repo"]))


def main():
    ap = argparse.ArgumentParser(description="Codex Gym")
    ap.add_argument("--repo", default=os.getcwd(), help="repo to lay out as the gym floor")
    ap.add_argument("--port", type=int, default=8477)
    ap.add_argument("--no-spectate", action="store_true", help="skip tailing ~/.codex/sessions")
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()

    if args.selftest:
        return selftest()

    records = Records()
    gym = Gym(args.repo, records)
    Handler.gym = gym
    print("CODEX GYM  %s  %d equipment / %d zones / %d LOC"
          % (gym.stats["repo"], gym.stats["equipment"], gym.stats["zones"], gym.stats["loc"]))
    if gym.stats["truncated"]:
        print("  note: %d files not placed on the floor (cap %d)"
              % (gym.stats["truncated"], MAX_EQUIPMENT))

    stop = threading.Event()
    if not args.no_spectate:
        threading.Thread(target=spectate_loop, args=(gym, stop), daemon=True).start()
        print("  spectating %s" % CODEX_SESSIONS)

    httpd = GymServer(("127.0.0.1", args.port), Handler)
    print("  open http://127.0.0.1:%d" % args.port)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        stop.set()
        if gym.workout and gym.workout.poll() is None:
            gym.workout.terminate()
        httpd.shutdown()


if __name__ == "__main__":
    sys.exit(main())
