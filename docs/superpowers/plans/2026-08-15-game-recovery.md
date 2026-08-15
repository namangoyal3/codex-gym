# Codex Gym Game Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the playable repository gym and add a visible judge-facing Codex flow.

**Architecture:** Restore the original HTML and CSS contract. Keep the current backend lifecycle events, then map them into one proof strip in the existing frontend.

**Tech Stack:** Python standard library, vanilla JavaScript, Canvas, CSS, SSE

---

### Task 1: Restore the game surface

**Files:**
- Modify: `static/index.html`
- Modify: `static/gym.css`
- Test: `test_frontend.py`

- [ ] **Step 1: Replace the redesign contract test**

Assert that the page contains `stage`, `feed`, `arena`, `workoutPanel`, `proofFlow`, and `proofSummary`. Assert that the stylesheet defines `.hud`, `.panel`, `.row`, `.bubble`, `.stg`, and `.proof-flow`.

- [ ] **Step 2: Run the test and verify failure**

Run: `python3 -B -m unittest -v test_frontend.py`

Expected: the proof-strip assertions fail.

- [ ] **Step 3: Restore the original shell and styles**

Restore `static/index.html` and `static/gym.css` from `main`. Add this markup above the project panel:

```html
<section id="proofFlow" class="proof-flow" aria-live="polite">
  <div class="proof-steps"><b data-proof="select">SELECT</b><b data-proof="edit">EDIT</b><b data-proof="verify">VERIFY</b><b data-proof="result">RESULT</b></div>
  <span id="proofSummary">Choose a task to start.</span>
</section>
```

Add CSS that positions the strip without covering the canvas. Reuse the existing palette and pixel type.

- [ ] **Step 4: Run the test and verify success**

Run: `python3 -B -m unittest -v test_frontend.py`

Expected: all frontend tests pass.

### Task 2: Connect the live event flow

**Files:**
- Modify: `static/app.js`
- Test: `test_frontend.py`

- [ ] **Step 1: Add failing source-contract assertions**

Assert that `static/app.js` defines `setProofPhase`, handles lifecycle results, and does not import `athlete3d.js`.

- [ ] **Step 2: Run the test and verify failure**

Run: `python3 -B -m unittest -v test_frontend.py`

Expected: the proof-phase assertions fail.

- [ ] **Step 3: Restore the 2D arena and add the event mapper**

Use one helper:

```js
function setProofPhase(phase, summary) {
  document.querySelectorAll('[data-proof]').forEach((el) => {
    el.classList.toggle('on', el.dataset.proof === phase);
  });
  $('proofSummary').textContent = summary;
}
```

Call it from `lifecycle`, `rep`, `asking`, and snapshot recovery. Keep the existing server result data.

- [ ] **Step 4: Run all frontend checks**

Run: `python3 -B -m unittest -v test_frontend.py && node --check static/app.js`

Expected: all checks pass.

### Task 3: Verify and publish

**Files:**
- Verify: `server.py`
- Verify: `static/index.html`
- Verify: `static/gym.css`
- Verify: `static/app.js`

- [ ] **Step 1: Run the complete check**

Run: `python3 -B server.py --selftest && python3 -B -m unittest -v test_frontend.py && node --check static/app.js && git diff --check`

Expected: all commands exit with status zero.

- [ ] **Step 2: Run the local smoke test**

Start `python3 -B server.py --port 8479`. Confirm that `/`, `/api/state`, and `/api/project` return successful responses.

- [ ] **Step 3: Commit and push**

```bash
git add docs/superpowers static/index.html static/gym.css static/app.js test_frontend.py
git commit -m "Restore the Codex Gym game"
git push -u origin agent/recover-game
```
