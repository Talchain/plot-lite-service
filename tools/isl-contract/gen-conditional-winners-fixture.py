#!/usr/bin/env python3
"""
Emit ISL's OWN serialisation of a populated `conditional_winners` array.

The bytes come out of ISL's own Pydantic models, executed from a read-only
clone of Talchain/Inference-Service-Layer at the sha below — NOT from a
hand-written reading of ISL's schema. That is the whole point: a fixture
written from PLoT's type claims is exactly what kept the ISL<->PLoT bucket
field-name mismatch invisible for two months.

USAGE
    <venv-python> gen-isl-cw-fixture.py --isl-repo /path/to/isl-clone-at-28fe0c95

Deps (PIN.json.runtime): pydantic==2.6.1, pydantic-settings==2.2.1, numpy>=1.26
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

EXPECTED_SHA = "28fe0c950f6ca5737f4555c863353d37b734dddf"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--isl-repo", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    repo = Path(args.isl_repo).resolve()
    head = subprocess.run(
        ["git", "-C", str(repo), "rev-parse", "HEAD"],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    if head != EXPECTED_SHA:
        print(f"ABORT: clone is at {head}, expected {EXPECTED_SHA}", file=sys.stderr)
        return 1

    sys.path.insert(0, str(repo))
    from src.models.response_v2 import BucketResultV2, ConditionalWinnerV2  # noqa: E402

    rows = [
        # Row A — the full shape: flip, both runner-ups, a split unit.
        ConditionalWinnerV2(
            factor_id="factor-demand",
            factor_label="Customer demand",
            split_value=0.42,
            split_unit="units/quarter",
            low_bucket=BucketResultV2(
                n_samples=2500, winner_id="opt-a", winner_label="Option A",
                winner_probability=0.71, runner_up_id="opt-b", runner_up_probability=0.29,
            ),
            high_bucket=BucketResultV2(
                n_samples=2500, winner_id="opt-b", winner_label="Option B",
                winner_probability=0.63, runner_up_id="opt-a", runner_up_probability=0.37,
            ),
            winner_flips=True,
        ),
        # Row B — the Optional members ABSENT under exclude_none (no split_unit,
        # no runner-up), and a NEGATIVE split_value: the live census found a real
        # persisted row at -0.017, so a sign-asymmetric guard would silently eat
        # it (trap 13d).
        ConditionalWinnerV2(
            factor_id="factor-churn",
            factor_label="Churn rate",
            split_value=-0.017,
            low_bucket=BucketResultV2(
                n_samples=1200, winner_id="opt-b", winner_label="Option B",
                winner_probability=0.55,
            ),
            high_bucket=BucketResultV2(
                n_samples=1300, winner_id="opt-c", winner_label="Option C",
                winner_probability=0.48,
            ),
            winner_flips=True,
        ),
        # Row C — probability at the [0,1] BOUNDARIES, which must survive
        # (prob01 is inclusive) rather than be treated as degenerate.
        ConditionalWinnerV2(
            factor_id="factor-price",
            factor_label="Unit price",
            split_value=12.5,
            split_unit="GBP",
            low_bucket=BucketResultV2(
                n_samples=900, winner_id="opt-a", winner_label="Option A",
                winner_probability=1.0, runner_up_id="opt-b", runner_up_probability=0.0,
            ),
            high_bucket=BucketResultV2(
                n_samples=900, winner_id="opt-b", winner_label="Option B",
                winner_probability=0.0,
            ),
            winner_flips=True,
        ),
    ]

    # ISL serialises its V2 response with exclude_none=True (see
    # src/utils/response_builder.py and the middleware model_dump calls), so an
    # absent Optional is an ABSENT KEY on the wire, never a JSON null.
    payload = [r.model_dump(mode="json", exclude_none=True) for r in rows]
    Path(args.out).write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {args.out} from ISL {head}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
