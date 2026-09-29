"""Export API snapshots for the static (GitHub Pages) build: python -m scripts.export_static <out_dir>."""
import json
import os
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("NWIS_DB", os.path.join(tempfile.mkdtemp(), "export.db"))
from fastapi.testclient import TestClient  # noqa: E402

from app import db  # noqa: E402
from app.main import TARGET, app  # noqa: E402

out = Path(sys.argv[1] if len(sys.argv) > 1 else "../frontend/public/data")
out.mkdir(parents=True, exist_ok=True)


def dump(name, obj):
    (out / name).write_text(json.dumps(obj, separators=(",", ":"), ensure_ascii=False))


with TestClient(app) as c:
    for r in range(1, 16):
        dump(f"wells_{r}.json", c.get("/api/wells", params={"target": TARGET, "radius_km": r}).json())
        dump(f"risk_{r}.json", c.get("/api/risk", params={"radius_km": r}).json())
        dump(f"offsets_{r}.json", c.get("/api/offsets", params={"radius_km": r}).json())
        dump(f"dash_{r}.json", c.get("/api/dashboard/manager", params={"radius_km": r}).json())
        dump(f"traj3d_{r}.json", c.get("/api/trajectories3d", params={"radius_km": r}).json())
    dump("telemetry.json", c.get("/api/telemetry", params={"radius_km": 10}).json())
    for w in db.wells():
        dump(f"log_{w.id}.json", c.get(f"/api/wells/{w.id}/log", params={"step": 10}).json())
    # raw field model for client-side look-ahead / search / RAG
    wells = [{**{k: v for k, v in w.__dict__.items() if k != "events"}, "events": w.events} for w in db.wells()]
    dump("field.json", {"wells": wells, "documents": db.q("SELECT * FROM documents")})
    (out / "prespud.pdf").write_bytes(c.get("/api/report/prespud.pdf", params={"radius_km": 10}).content)
print("exported to", out)
