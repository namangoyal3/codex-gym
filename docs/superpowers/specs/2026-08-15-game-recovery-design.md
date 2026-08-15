# Codex Gym Game Recovery Design

## Goal

Restore the isometric repository game. Add a compact event loop that helps judges follow live Codex work.

## Scope

Keep the original game shell, controls, HUD, chat, replay, and project pipeline. Keep the newer server lifecycle and result events.

Remove the full-screen redesign from the default experience. Do not load the separate Three.js athlete.

## Screen hierarchy

The isometric repository fills the center. The existing panels frame it without covering the stations.

Add one proof strip above the lower HUD. It shows four phases: `SELECT`, `EDIT`, `VERIFY`, and `RESULT`.

The strip also shows the active file or the latest Codex message. A completion ribbon shows changed files and test status.

## State model

Use five product states: `READY`, `TRAINING`, `BLOCKED`, `COMPLETE`, and `FAILED`. Treat edits and tests as activities inside `TRAINING`.

Map SSE events directly:

- `lifecycle: running` selects `TRAINING`.
- `rep` with an edit selects `EDIT`.
- `rep` with a test command selects `VERIFY`.
- `asking` selects `BLOCKED`.
- Terminal lifecycle events select `RESULT`.

## Demo path

Run live Codex first. Keep replay available as the deterministic fallback.

Show the repository map, start one task, watch the active file, show the test result, and finish on the proof ribbon.

## Constraints

Use Python, vanilla JavaScript, SSE, Canvas, and CSS. Add no dependency and no page.

