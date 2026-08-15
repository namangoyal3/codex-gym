# Scripted Demo Design

## Goal

Add one top-level control that runs a clear Codex Gym story without a live Codex session.

The demo must help a judge understand the product in less than 45 seconds.

## Scope

Add a `PLAY 45s DEMO` button beside `HOW TO PLAY`.

The button runs this fixed sequence:

1. Codex selects a task and walks to a building.
2. Codex reads a file.
3. Codex edits the file, and the building grows.
4. Codex runs a test on the treadmill.
5. The test passes, and the project pipeline advances.
6. The proof strip shows the result.

Disable the button while the sequence runs. Change the label to `REPLAY DEMO` when the sequence ends.

Do not add the admin portal in this change.

## Architecture

Reuse the existing `apply()` function for all demo events. Do not create a second animation or state system.

Store the fixed snapshot and the timed event sequence in one small browser module. Export the data builder for a direct Node check.

Use the fixed snapshot when the page cannot use the local Python server. Keep the current SSE connection on localhost.

Add one Vercel rewrite so the existing static app opens at the deployment root.

## Data Flow

The demo button resets the demo snapshot and sends each fixed event to `apply()` in order.

Each event updates the same arena, athlete, feed, vitals, project pipeline, and proof strip that live events update.

The sequence uses a file path from the fixed snapshot. This keeps camera focus and building growth deterministic.

## Failure Handling

If one demo event fails, restore the button and show a short error in the proof strip.

Do not send demo actions to the Python API.

## Verification

Add one dependency-free Node check for the event order and the static snapshot.

Run the existing Python tests, the Node syntax checks, the server self-test, and the Vercel build.

