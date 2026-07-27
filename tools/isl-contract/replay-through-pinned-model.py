#!/usr/bin/env python3
"""
Replay PLoT's ISL request bodies through ISL's OWN pinned Pydantic models.

Contract step-2 slice 2 — request-side drift pairing (Codex GO-AMENDED: exercise
the exact pinned candidate model, not an independent hand-written copy).

This is the ONLY step in the pairing that needs a Python runtime. It produces
`tests/fixtures/isl-pinned/replay-transcript.json`, which the standing vitest
gate consumes hermetically. The gate re-derives every input this driver was
given and compares hashes, so a transcript can never quietly outlive the bytes
it describes.

WHAT IT RECORDS, AND WHAT IT DELIBERATELY DOES NOT
--------------------------------------------------
It records the model's own OUTPUT — `model_dump(by_alias=True,
exclude_unset=True)` — and nothing derived from a second reading of ISL's
schema. The accepted/rejected split is then computed in TypeScript as
`input paths` minus `parsed-dump paths`. That keeps the "which keys does ISL
declare" judgement inside ISL's own runtime exactly once. A second walker here
would be the hand-maintained mirror this slice exists to delete.

USAGE
    tools/isl-contract/replay-through-pinned-model.py --isl-repo /path/to/isl-clone

    The clone must be checked out at the sha in PIN.json. Every file listed in
    PIN.json.source_sha256 is verified before anything is imported; a mismatch
    aborts. Required interpreter/deps (see PIN.json.runtime):
        python 3.11+, pydantic==2.6.1, pydantic-settings==2.2.1, numpy>=1.26
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
PINNED_DIR = REPO_ROOT / "tests" / "fixtures" / "isl-pinned"
PIN_PATH = PINNED_DIR / "PIN.json"
OPENAPI_PATH = PINNED_DIR / "isl-openapi.json"
EGRESS_DIR = PINNED_DIR / "egress"
TRANSCRIPT_PATH = PINNED_DIR / "replay-transcript.json"

# Authentic bodies captured off the live PLoT -> ISL wire on the dates in the
# directory names. Replayed alongside the synthetic producer captures so the
# pairing is anchored to traffic that actually happened, not only to fixtures
# this lane wrote.
CAPTURED_LIVE_BODIES = [
    "tests/fixtures/isl-v2-live-20260706/isl-v2-request.json",
    "tests/fixtures/isl-v2-live-20260706/isl-v2-request-b.json",
    "tests/fixtures/isl-v2-live-20260707/isl-v2-request.json",
    "tests/fixtures/isl-v2-live-20260707/isl-v2-request-pathdecomp.json",
    "tests/fixtures/isl-v2-live-20260708/isl-v2-request.json",
]


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def canonical_pin_digest(pin: dict) -> str:
    """Must match `canonicalDigest()` in tests/helpers/isl-pinned-artifacts.ts."""
    text = json.dumps(pin, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return sha256_bytes(text.encode("utf-8"))


def verify_pin(isl_repo: Path, pin: dict) -> None:
    """Refuse to run against anything but the pinned bytes."""
    problems: list[str] = []
    for rel, expected in pin["source_sha256"].items():
        if rel.startswith("_"):
            continue
        f = isl_repo / rel
        if not f.is_file():
            problems.append(f"MISSING  {rel}")
            continue
        actual = sha256_file(f)
        if actual != expected:
            problems.append(f"MISMATCH {rel}\n           expected {expected}\n           actual   {actual}")

    upstream_openapi = isl_repo / pin["artifacts"]["isl_openapi_json"]["upstream_path"]
    expected_openapi = pin["artifacts"]["isl_openapi_json"]["sha256"]
    if not upstream_openapi.is_file():
        problems.append(f"MISSING  {upstream_openapi}")
    elif sha256_file(upstream_openapi) != expected_openapi:
        problems.append(f"MISMATCH {upstream_openapi} (ISL's own openapi.json)")

    vendored = sha256_file(OPENAPI_PATH)
    if vendored != expected_openapi:
        problems.append(
            "MISMATCH vendored tests/fixtures/isl-pinned/isl-openapi.json vs PIN.json"
            f"\n           expected {expected_openapi}\n           actual   {vendored}"
        )

    if problems:
        print("PIN VERIFICATION FAILED — refusing to generate a transcript.\n", file=sys.stderr)
        for p in problems:
            print("  " + p, file=sys.stderr)
        print(
            f"\nPIN.json expects ISL @ {pin['isl']['sha']} ({pin['isl']['repo']}).",
            file=sys.stderr,
        )
        sys.exit(2)


def normalise_refs(node: Any) -> Any:
    """`#/$defs/X` (model_json_schema) vs `#/components/schemas/X` (FastAPI)."""
    if isinstance(node, dict):
        out = {}
        for k, v in node.items():
            if k == "$ref" and isinstance(v, str):
                out[k] = v.replace("#/components/schemas/", "#/$defs/")
            else:
                out[k] = normalise_refs(v)
        return out
    if isinstance(node, list):
        return [normalise_refs(v) for v in node]
    return node


def openapi_closure(openapi: dict, root_name: str) -> dict:
    """The root schema plus every schema reachable from it, as a $defs bundle."""
    schemas = openapi["components"]["schemas"]
    seen: set[str] = set()
    pending = [root_name]
    while pending:
        name = pending.pop()
        if name in seen:
            continue
        seen.add(name)
        text = json.dumps(schemas[name])
        for other in schemas:
            if f'"#/components/schemas/{other}"' in text and other not in seen:
                pending.append(other)
    root = dict(schemas[root_name])
    defs = {n: schemas[n] for n in sorted(seen) if n != root_name}
    if defs:
        root["$defs"] = defs
    return normalise_refs(root)


def model_closure(model: Any) -> dict:
    return normalise_refs(model.model_json_schema(ref_template="#/$defs/{model}"))


def paths_of(value: Any, prefix: str = "") -> list[str]:
    """Every JSON path in `value`, arrays collapsed to `[]`. Mirrors the TS walker."""
    out: list[str] = []
    if isinstance(value, dict):
        for k, v in value.items():
            p = f"{prefix}.{k}" if prefix else str(k)
            out.append(p)
            out.extend(paths_of(v, p))
    elif isinstance(value, list):
        for item in value:
            out.extend(paths_of(item, f"{prefix}[]"))
    return out


def replay(model: Any, body: Any) -> dict:
    """Feed one body to the pinned model. Records the model's own output only."""
    try:
        parsed = model.model_validate(body)
    except Exception as exc:  # pydantic.ValidationError and anything else
        errors = []
        if hasattr(exc, "errors"):
            for e in exc.errors():
                errors.append(
                    {
                        "loc": [str(x) for x in e.get("loc", ())],
                        "type": e.get("type"),
                        "msg": e.get("msg"),
                    }
                )
        return {
            "parses": False,
            "validation_errors": errors or [{"type": type(exc).__name__, "msg": str(exc)}],
            "parsed_dump": None,
        }

    dump = parsed.model_dump(mode="json", by_alias=True, exclude_unset=True)
    return {
        "parses": True,
        "validation_errors": [],
        "parsed_dump": dump,
        # Recorded so a reviewer can see the parse is non-vacuous without
        # re-running Python: the model kept this many top-level members.
        "parsed_top_level_keys": sorted(dump.keys()),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--isl-repo", required=True, help="Path to an ISL clone checked out at PIN.json's sha")
    args = ap.parse_args()

    isl_repo = Path(args.isl_repo).resolve()
    pin = json.loads(PIN_PATH.read_text())
    verify_pin(isl_repo, pin)

    sys.path.insert(0, str(isl_repo))
    import pydantic  # noqa: E402

    expected_pydantic = pin["runtime"]["pydantic"].split()[0]
    if pydantic.VERSION != expected_pydantic:
        print(
            f"pydantic {pydantic.VERSION} != pinned {expected_pydantic}. "
            "Install the pinned version; a different version can emit a different schema.",
            file=sys.stderr,
        )
        return 2

    from src.models.robustness_v2 import RobustnessRequestV2  # noqa: E402
    from src.models.requests import CounterfactualRequest  # noqa: E402

    MODELS = {
        "/api/v1/robustness/analyze/v2": ("RobustnessRequestV2", RobustnessRequestV2),
        "/api/v1/causal/counterfactual": ("CounterfactualRequest", CounterfactualRequest),
    }

    openapi = json.loads(OPENAPI_PATH.read_text())

    # ---- Agreement: the vendored artifact IS this model's own output ---------
    # The standing gate reads the vendored openapi.json hermetically. That is
    # only legitimate if the artifact and the executed model say the same thing,
    # so prove it here rather than assuming it.
    schema_agreement = {}
    for path, (name, model) in MODELS.items():
        from_artifact = openapi_closure(openapi, name)
        from_model = model_closure(model)
        # FastAPI post-processes the document (titles/examples/description
        # placement); compare the part the pairing actually uses — the declared
        # member set of every class in the closure.
        def members(bundle: dict) -> dict:
            out = {}
            if "properties" in bundle:
                out[bundle.get("title", name)] = sorted(bundle["properties"].keys())
            for defname, defschema in (bundle.get("$defs") or {}).items():
                if "properties" in defschema:
                    out[defname] = sorted(defschema["properties"].keys())
            return out

        a, m = members(from_artifact), members(from_model)
        schema_agreement[path] = {
            "model": name,
            "classes_compared": sorted(set(a) | set(m)),
            "agrees": a == m,
            "only_in_artifact": {k: v for k, v in a.items() if k not in m or m[k] != v},
            "only_in_model": {k: v for k, v in m.items() if k not in a or a[k] != v},
        }

    # ---- Replays ------------------------------------------------------------
    egress_results = {}
    for fixture_path in sorted(EGRESS_DIR.glob("*.json")):
        fixture = json.loads(fixture_path.read_text())
        endpoint = fixture["endpoint"]
        entry: dict = {
            "fixture": str(fixture_path.relative_to(REPO_ROOT)),
            "endpoint": endpoint,
            "liveness": fixture["liveness"],
            "wire_bytes_sha256": fixture["wire_bytes_sha256"],
        }
        if endpoint in MODELS:
            name, model = MODELS[endpoint]
            entry["model"] = name
            entry.update(replay(model, fixture["body"]))
        else:
            entry["model"] = None
            entry["parses"] = None
            entry["parsed_dump"] = None
            entry["unpairable_reason"] = (
                "ISL does not mount this path at the pin, so no request model exists to pair against. "
                "See PIN.json.unmounted_at_this_pin."
            )
        egress_results[fixture["producer"]] = entry

    captured_results = {}
    for rel in CAPTURED_LIVE_BODIES:
        p = REPO_ROOT / rel
        raw = p.read_bytes()
        body = json.loads(raw)
        name, model = MODELS["/api/v1/robustness/analyze/v2"]
        entry = {
            "fixture": rel,
            "endpoint": "/api/v1/robustness/analyze/v2",
            "file_sha256": sha256_bytes(raw),
            "model": name,
        }
        entry.update(replay(model, body))
        captured_results[rel] = entry

    transcript = {
        "_README": (
            "GENERATED by tools/isl-contract/replay-through-pinned-model.py — do not hand-edit. "
            "Every `parsed_dump` below is the return value of ISL's own pinned Pydantic model "
            "under the pinned interpreter; the accepted/rejected split is derived from it in "
            "tests/isl-request-drift-pairing.contract.test.ts."
        ),
        "pin_digest": canonical_pin_digest(pin),
        "isl_sha": pin["isl"]["sha"],
        "pydantic_version": pydantic.VERSION,
        "python_version": sys.version.split()[0],
        "models": {k: v[0] for k, v in MODELS.items()},
        "schema_agreement": schema_agreement,
        "egress": egress_results,
        "captured_live": captured_results,
    }

    TRANSCRIPT_PATH.write_text(json.dumps(transcript, indent=2, ensure_ascii=False, sort_keys=False) + "\n")
    print(f"wrote {TRANSCRIPT_PATH.relative_to(REPO_ROOT)}")
    print(f"  pin_digest        {transcript['pin_digest']}")
    print(f"  pydantic          {pydantic.VERSION} / python {transcript['python_version']}")
    for path, ag in schema_agreement.items():
        print(f"  schema agreement  {path}: {'OK' if ag['agrees'] else 'DISAGREES'}")
    for producer, entry in egress_results.items():
        print(f"  egress            {producer}: parses={entry['parses']}")
    for rel, entry in captured_results.items():
        print(f"  captured          {Path(rel).parent.name}/{Path(rel).name}: parses={entry['parses']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
