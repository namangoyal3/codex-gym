import pathlib
import subprocess
import tempfile
import unittest

import server


ROOT = pathlib.Path(__file__).parent


class FrontendContractTest(unittest.TestCase):
    def test_game_surface_and_proof_strip_are_present(self):
        html = (ROOT / "static/index.html").read_text()
        css = (ROOT / "static/gym.css").read_text()

        for element_id in (
            "stage",
            "feed",
            "arena",
            "workoutPanel",
            "proofFlow",
            "proofSummary",
        ):
            self.assertIn(f'id="{element_id}"', html)

        for selector in ("hud", "panel", "row", "bubble", "stg", "proof-flow"):
            self.assertIn(f".{selector} {{", css)

        for phase in ("select", "edit", "verify", "result"):
            self.assertIn(f'<b data-proof="{phase}">{phase.upper()}</b>', html)

        self.assertIn(
            '<span id="proofSummary">Choose a task to start.</span>', html
        )
        self.assertLess(
            html.index('id="proofFlow"'),
            html.index('<section class="panel pipeline">'),
        )

    def test_live_events_drive_the_proof_flow(self):
        app = (ROOT / "static/app.js").read_text()

        self.assertIn("function setProofPhase(phase, summary)", app)
        self.assertIn("document.querySelectorAll('[data-proof]')", app)
        self.assertIn("el.classList.toggle('on', el.dataset.proof === phase)", app)
        self.assertIn("$('proofSummary').textContent = summary", app)

        snapshot = app.split("case 'snapshot':", 1)[1].split("case 'floor':", 1)[0]
        rep = app.split("case 'rep':", 1)[1].split("case 'record':", 1)[0]
        asking = app.split("case 'asking':", 1)[1].split("case 'replay':", 1)[0]
        lifecycle = app.split("case 'lifecycle':", 1)[1].split("case 'records':", 1)[0]

        self.assertIn("setProofPhase(", snapshot)
        self.assertIn("setProofPhase('edit'", rep)
        self.assertIn("setProofPhase('verify'", rep)
        self.assertIn("setProofPhase(", asking)
        self.assertIn("setProofPhase('select'", lifecycle)
        self.assertIn("setProofPhase('result'", lifecycle)
        self.assertIn("['completed', 'stopped', 'failed']", lifecycle)

        for redesign_only in (
            "./athlete3d.js",
            "createAthlete3D",
            "athlete3d",
            "resultCard",
            "resultMessage",
            "resultStats",
            "setExperienceState",
        ):
            self.assertNotIn(redesign_only, app)

    def test_git_porcelain_keeps_leading_status_column(self):
        with tempfile.TemporaryDirectory() as root:
            subprocess.run(["git", "init", "-q"], cwd=root, check=True)
            path = pathlib.Path(root, "tracked.txt")
            path.write_text("one\n")
            subprocess.run(["git", "add", "tracked.txt"], cwd=root, check=True)
            subprocess.run([
                "git", "-c", "user.name=Test", "-c", "user.email=test@example.com",
                "commit", "-qm", "initial",
            ], cwd=root, check=True)
            path.write_text("two\n")
            self.assertEqual(server.git(root, "status", "--porcelain"), " M tracked.txt")


if __name__ == "__main__":
    unittest.main()
