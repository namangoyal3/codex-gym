import pathlib
import subprocess
import tempfile
import unittest

import server


ROOT = pathlib.Path(__file__).parent


class FrontendContractTest(unittest.TestCase):
    def test_prompt_workout_shell_is_wired(self):
        html = (ROOT / "static/index.html").read_text()
        app = (ROOT / "static/app.js").read_text()

        for element_id in (
            "workoutStage",
            "athlete3d",
            "chatText",
            "chatSend",
            "liveCaption",
            "resultCard",
            "projectDrawer",
            "activityDrawer",
            "settingsDrawer",
        ):
            self.assertIn(f'id="{element_id}"', html)

        self.assertIn("./athlete3d.js", app)
        self.assertIn("setExperienceState", app)
        self.assertIn("model: $('modelSel').value || null", app)
        self.assertIn("if (S.question) break", app)
        self.assertIn("!m.running && m.status", app)

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
