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
