"""HTTP smoke test for the real Universal Doctor dashboard on localhost."""
import json
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "agents" / "universal-doctor"
sys.path.insert(0, str(ROOT))
from doctor_core.engine import Doctor
from doctor_core.dashboard import DashboardServer


def main():
    with tempfile.TemporaryDirectory(prefix="dark-phys-dashboard-") as tmp:
        project = Path(tmp) / "sample-project"
        project.mkdir()
        (project / "hello.py").write_text("print('hello')\n", encoding="utf-8")
        data = Path(tmp) / "doctor-data"
        doctor = Doctor(str(project), str(data), "diagnostic")
        server = DashboardServer(doctor, port=0).start(background=True)
        base = f"http://127.0.0.1:{server.port}"
        try:
            with urllib.request.urlopen(base + "/", timeout=5) as response:
                page = response.read().decode("utf-8")
                assert response.status == 200 and "Universal Doctor Agent" in page
                assert "__TOKEN__" not in page
            with urllib.request.urlopen(base + "/api/state", timeout=5) as response:
                state = json.loads(response.read().decode("utf-8"))
                assert response.status == 200 and "health" in state and "findings" in state
            request = urllib.request.Request(base + "/api/scan", data=b"{}", method="POST",
                                             headers={"Content-Type": "application/json"})
            try:
                urllib.request.urlopen(request, timeout=5)
                raise AssertionError("Mutation endpoint accepted a request without a session token")
            except urllib.error.HTTPError as error:
                assert error.code == 403
            print("PASS real Doctor dashboard launch, HTML, state API, and mutation-token guard")
        finally:
            server.stop()
            doctor.kb.close()


if __name__ == "__main__":
    main()
