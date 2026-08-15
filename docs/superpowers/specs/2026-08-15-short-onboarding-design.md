# Short Onboarding Design

## Goal

Help a new user understand Codex Gym before the first interaction. Keep all instructions visible at one glance.

## Interface

Reuse the existing first-run overlay. Do not add a route, dependency, or second onboarding component.

Show three steps:

1. Pick work. Click a building or choose a workout.
2. Watch Codex train. Edits lift, tests sprint, and failures miss.
3. Verify the result. Follow the active file, test result, and Git proof.

Show three controls: drag to move, scroll to zoom, and double-click to reset.

Keep one primary action: `ENTER THE GYM`.

Rename `RULES` to `HOW TO PLAY`. This button opens the same overlay.

## First-run behavior

Use a new local storage key. This change shows the shorter guide once to users who saw the old guide.

## Verification

Check the required copy and controls in the frontend contract test. Run the JavaScript syntax check and the server self-test.
