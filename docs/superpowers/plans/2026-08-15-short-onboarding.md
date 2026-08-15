# Short Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the long rules overlay with a concise three-step guide.

**Architecture:** Reuse the existing overlay, button handlers, and local storage behavior. Change only the copy, compact layout styles, storage key, and contract test.

**Tech Stack:** HTML, CSS, vanilla JavaScript, Python unittest

---

### Task 1: Build the concise onboarding

**Files:**
- Modify: `static/index.html`
- Modify: `static/gym.css`
- Modify: `static/app.js`
- Test: `test_frontend.py`

- [ ] **Step 1: Add the failing contract assertions**

Add these expectations to `test_frontend.py`:

```python
for copy in (
    "Pick work", "Watch Codex train", "Verify the result",
    "Drag to move", "Scroll to zoom", "Double-click to reset",
    "HOW TO PLAY",
):
    self.assertIn(copy, html)
self.assertIn("codexgym.onboarding.v2", app)
```

- [ ] **Step 2: Run the test and confirm failure**

Run: `python3 -B -m unittest -v test_frontend.py`

Expected: the onboarding copy assertion fails.

- [ ] **Step 3: Replace the long rules**

Use this structure inside `#intro`:

```html
<div class="introbox">
  <div class="intro-kicker">YOUR REPOSITORY. TRAINING LIVE.</div>
  <h1>CODEX GYM</h1>
  <p class="tagline">Watch Codex turn real engineering work into a workout.</p>
  <div class="intro-steps">
    <div><b>Pick work</b><span>Click a building or choose a workout.</span></div>
    <div><b>Watch Codex train</b><span>Edits lift. Tests sprint. Failures miss.</span></div>
    <div><b>Verify the result</b><span>Follow the active file, tests, and Git proof.</span></div>
  </div>
  <div class="intro-controls"><span>Drag to move</span><span>Scroll to zoom</span><span>Double-click to reset</span></div>
  <button id="introGo" class="btn primary">ENTER THE GYM</button>
</div>
```

Rename the existing `RULES` button to `HOW TO PLAY`.

- [ ] **Step 4: Add compact responsive styles**

Use the existing palette. Style `.intro-steps` as three columns on laptops and one column below 640 pixels.

```css
.intro-steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 18px 0; }
.intro-steps > div { display: grid; gap: 5px; padding: 12px; background: rgba(255,255,255,.04); border-top: 2px solid var(--amber); }
.intro-steps span, .intro-controls { color: var(--dim); font-size: 11px; line-height: 1.45; }
.intro-controls { display: flex; justify-content: center; gap: 18px; margin-bottom: 16px; }
@media (max-width: 640px) { .intro-steps { grid-template-columns: 1fr; } .intro-controls { flex-wrap: wrap; gap: 8px 14px; } }
```

- [ ] **Step 5: Version the first-run key**

Replace `codexgym.seen` with `codexgym.onboarding.v2` in `static/app.js`.

- [ ] **Step 6: Verify and commit**

Run: `python3 -B -m unittest -v test_frontend.py && node --check static/app.js && python3 -B server.py --selftest && git diff --check`

Expected: all commands exit with status zero.

```bash
git add docs/superpowers/plans/2026-08-15-short-onboarding.md static/index.html static/gym.css static/app.js test_frontend.py
git commit -m "Add the short game onboarding"
```
