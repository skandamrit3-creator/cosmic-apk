#!/usr/bin/env python3
"""Build an allow-listed frontend-only COSMIC feature pack with SHA-256 hashes."""
import hashlib
import json
import os
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ.get("COSMIC_FEATURE_OUT", "/tmp/cosmic-feature-pack"))
ASSET_DIR = OUT / "assets"
FILES = sorted((ROOT / "frontend" / folder).glob("*.css" if folder == "css" else "*.js")
               for folder in ("css", "js"))
OUT.mkdir(parents=True, exist_ok=True)
ASSET_DIR.mkdir(parents=True, exist_ok=True)
manifest_files = []
for group in FILES:
    for source in group:
        rel = source.relative_to(ROOT / "frontend").as_posix()
        data = source.read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        asset_name = "frontend__" + rel.replace("/", "__")
        shutil.copyfile(source, ASSET_DIR / asset_name)
        manifest_files.append({
            "path": rel,
            "asset_name": asset_name,
            "sha256": digest,
            "size": len(data),
            "content_type": "text/css" if rel.endswith(".css") else "text/javascript",
        })
manifest = {
    "schema": 1,
    "version": "features-" + os.environ.get("GITHUB_RUN_NUMBER", "local"),
    "commit": os.environ.get("GITHUB_SHA", "local"),
    "min_version_code": 12,
    "files": manifest_files,
}
(OUT / "cosmic-feature-manifest.json").write_text(
    json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
)
print("Prepared", len(manifest_files), "frontend assets")
