#!/usr/bin/env python3
"""
Replay PLoT's `parameter_uncertainties` entries through ISL's OWN FactorSampler
and record where the samples actually land.

WHY THIS EXISTS (ROADMAP: prior-only external factor sampling centre).
`replay-through-pinned-model.py` answers "does ISL PARSE the keys PLoT sends?".
It cannot answer "does ISL SAMPLE where PLoT meant?" — and a key that parses
cleanly while the sampler centres somewhere else is the silent-wrongness class
this driver exists to make visible. Parsing is a shape claim; this is a
BEHAVIOUR claim, and only ISL's real sampler can settle it.

The oracle is ISL's own `FactorSampler`, never a Python re-implementation of it
here. A second sampler written in this file would be the hand-maintained mirror
the estate keeps paying for, and it could agree with a wrong expectation
forever.

USAGE
    tools/isl-contract/replay-factor-sampler.py --isl-repo /path/to/isl-clone

    The clone must be checked out at the sha in
    tests/fixtures/isl-sampler-pinned/PIN.json. Every file listed in that PIN's
    `source_sha256` is verified before anything is imported; a mismatch ABORTS,
    so a transcript can never be produced from bytes other than those. Required
    runtime (see the PIN's `runtime` block): python 3.11+, pydantic 2.6.1,
    pydantic-settings 2.2.1, numpy >= 1.26.

    Run it from inside the ISL clone's own environment, e.g.
        cd <isl-clone> && poetry run python <plot>/tools/isl-contract/replay-factor-sampler.py \
            --isl-repo <isl-clone>

INPUT   tests/fixtures/isl-sampler-pinned/cases.json   (see the file's own header)
OUTPUT  tests/fixtures/isl-sampler-pinned/sampler-transcript.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
import statistics
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
PINNED_DIR = REPO_ROOT / "tests" / "fixtures" / "isl-sampler-pinned"
PIN_PATH = PINNED_DIR / "PIN.json"
CASES_PATH = PINNED_DIR / "cases.json"
TRANSCRIPT_PATH = PINNED_DIR / "sampler-transcript.json"


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def canonical_pin_digest(pin: dict) -> str:
    """Must match `canonicalDigest()` in tests/helpers/isl-sampler-pinned.ts."""
    return sha256_bytes(
        json.dumps(pin, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--isl-repo", required=True, help="Path to an ISL clone at the PIN sha")
    args = ap.parse_args()

    isl_repo = Path(args.isl_repo).resolve()
    pin = json.loads(PIN_PATH.read_text())
    cases_doc = json.loads(CASES_PATH.read_text())

    # --- Refuse to run against bytes other than the pinned ones ---------------
    mismatches: list[str] = []
    for rel, expected in pin["source_sha256"].items():
        if rel.startswith("_"):
            continue
        actual_path = isl_repo / rel
        if not actual_path.is_file():
            mismatches.append(f"{rel}: MISSING in {isl_repo}")
            continue
        actual = sha256_file(actual_path)
        if actual != expected:
            mismatches.append(f"{rel}: {actual} != pinned {expected}")
    if mismatches:
        print("REFUSING TO RUN — the ISL clone does not match the pin:", file=sys.stderr)
        for m in mismatches:
            print(f"  {m}", file=sys.stderr)
        return 2

    sys.path.insert(0, str(isl_repo))

    import pydantic  # noqa: E402

    from src.models.robustness_v2 import NodeV2, ParameterUncertainty  # noqa: E402
    from src.services.robustness_analyzer_v2 import FactorSampler  # noqa: E402
    from src.utils.rng import SeededRNG  # noqa: E402

    # Trap 9d: prove the modules we just imported live inside the clone we
    # verified, not in some other checkout an editable .pth rebound us to.
    import src.models.robustness_v2 as _models_mod  # noqa: E402
    import src.services.robustness_analyzer_v2 as _analyzer_mod  # noqa: E402

    binding = {
        "src/models/robustness_v2.py": _models_mod.__file__,
        "src/services/robustness_analyzer_v2.py": _analyzer_mod.__file__,
    }
    for rel, resolved in binding.items():
        if Path(resolved).resolve() != (isl_repo / rel).resolve():
            print(
                f"REFUSING TO RUN — import rebound outside the verified clone: "
                f"{rel} resolved to {resolved}",
                file=sys.stderr,
            )
            return 2

    n_samples = int(cases_doc["n_samples"])
    seed = int(cases_doc["seed"])
    results: list[dict[str, Any]] = []

    for case in cases_doc["cases"]:
        entry: dict[str, Any] = {
            "name": case["name"],
            "node": case["node"],
            "parameter_uncertainty": case["parameter_uncertainty"],
        }
        try:
            node = NodeV2(**case["node"])
            pu = ParameterUncertainty(**case["parameter_uncertainty"])
        except pydantic.ValidationError as exc:
            # A REJECTION is a first-class result: it is the loud failure that
            # proves a malformed centre does not silently sample somewhere.
            entry["outcome"] = "model_rejected"
            entry["error_type"] = type(exc).__name__
            entry["error_count"] = len(exc.errors())
            entry["error_types"] = sorted({e["type"] for e in exc.errors()})
            results.append(entry)
            continue

        sampler = FactorSampler(nodes=[node], uncertainties=[pu], rng=SeededRNG(seed))
        draws = [sampler.sample_factor_values()[case["node"]["id"]] for _ in range(n_samples)]
        entry["outcome"] = "sampled"
        entry["n_samples"] = n_samples
        entry["sample_mean"] = statistics.fmean(draws)
        entry["sample_std"] = statistics.pstdev(draws)
        entry["sample_min"] = min(draws)
        entry["sample_max"] = max(draws)
        results.append(entry)

    # ------------------------------------------------------------------------
    # Root-default detector arm.
    #
    # The centre being right is only half the harm. ISL suppresses its
    # ROOT_NODE_DEFAULT_VALUE disclosure on the mere PRESENCE of a
    # ParameterUncertainty entry, so the old centre-less wire bought silence it
    # had not earned: wrong AND uncaveated. Two things have to be true after the
    # fix, and only one of them is about the fix:
    #   (a) a properly-specified uniform is genuinely specified, so NO warning is
    #       the correct answer — not an accident of the suppression rule;
    #   (b) the detector must STILL FIRE for a genuinely defaulted root. A fix
    #       that quietly disabled the alarm would look identical to (a) from the
    #       outside, which is exactly why (b) is measured rather than assumed.
    # Run through the real RobustnessAnalyzerV2.analyze(), never a re-reading of
    # the predicate.
    from src.models.robustness_v2 import RobustnessRequestV2  # noqa: E402
    from src.services.robustness_analyzer_v2 import RobustnessAnalyzerV2  # noqa: E402

    detector_results: list[dict[str, Any]] = []
    for case in cases_doc["detector_cases"]:
        req = RobustnessRequestV2(**case["request"])
        response = RobustnessAnalyzerV2().analyze(req)
        warnings = [
            {"code": w.code, "field": w.field, "node_id": (w.detail or {}).get("node_id")}
            for w in (response.inference_warnings or [])
        ]
        detector_results.append(
            {
                "name": case["name"],
                "parameter_uncertainties": case["request"].get("parameter_uncertainties"),
                "root_default_warned_node_ids": sorted(
                    w["node_id"] for w in warnings if w["code"] == "ROOT_NODE_DEFAULT_VALUE"
                ),
                "all_warning_codes": sorted({w["code"] for w in warnings}),
            }
        )

    transcript = {
        "_README": [
            "GENERATED by tools/isl-contract/replay-factor-sampler.py. Do not hand-edit.",
            "Records where ISL's OWN FactorSampler puts the samples for each PLoT-emitted",
            "parameter_uncertainties entry, plus whether ISL's root-default detector fires.",
            "Consumed hermetically by tests/isl-factor-sampler-centre.contract.test.ts.",
        ],
        "pin_digest": canonical_pin_digest(pin),
        "cases_sha256": sha256_file(CASES_PATH),
        "isl_sha": pin["isl"]["sha"],
        "runtime": {
            "python": sys.version.split()[0],
            "pydantic": pydantic.VERSION,
        },
        "n_samples": n_samples,
        "seed": seed,
        "results": results,
        "detector_results": detector_results,
    }
    TRANSCRIPT_PATH.write_text(
        json.dumps(transcript, indent=2, sort_keys=False, ensure_ascii=False) + "\n", "utf8"
    )
    print(f"wrote {TRANSCRIPT_PATH}")
    for r in results:
        if r["outcome"] == "sampled":
            print(f"  {r['name']}: mean={r['sample_mean']:.6f} std={r['sample_std']:.6f}")
        else:
            print(f"  {r['name']}: {r['outcome']} ({','.join(r.get('error_types', []))})")
    for d in detector_results:
        warned = d["root_default_warned_node_ids"] or ["<none>"]
        print(f"  [detector] {d['name']}: ROOT_NODE_DEFAULT_VALUE for {','.join(warned)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
