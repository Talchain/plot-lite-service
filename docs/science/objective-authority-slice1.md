# Objective authority: PLoT consumer slice

Baseline: PLoT `75e7f9747977a28214533ce4af0efdb9ca28b155`.
This is a feature-branch implementation, not a deployment claim.

Data flow:

1. Read `graph.nodes[id=goal_node_id].goal_direction` from the raw canonical
   selected goal. Omission stays unknown; a malformed present value is a typed
   422. No label inference or request-level override exists.
2. Forward the scalar direction to ISL. A target uses that same goal node's
   existing `goal_threshold` and `goal_threshold_frame`; separate eligibility
   constraints must not erase the target. No target is inferred from a budget.
3. ISL owns `objective_ranking`: dense ranks over tie-split simulation win
   shares, with stable ID order for ties. PLoT forwards the envelope unchanged.
4. Validate its objective against the request, join every row to its option's
   exact share, then apply existing computation-status and constraint policy.
   No local re-sort, epsilon tie-break, mean-outcome fallback, or default
   direction is used. Equal best permitted ranks do not name one winner.
5. The one internal projection supplies `robustness.recommended_option_id`,
   the brief's permitted headline pair, and the brief's capture identity/share.
   Raw brief option ranks remain producer ranks. One eligible option has no
   comparative band. Missing/withheld objective truth has no ranked brief or
   recommendation; descriptive outcome statistics remain available.

The existing raw-population `near_tie` remains a descriptive statistic; it is
not a licence for a different permitted identity. It is absent without a valid
objective comparison or when every candidate breaches. Its arithmetic is
unchanged. Existing constraint thresholds and assumed-input disclosures are
unchanged. The broader assumed-data trust treatment is a separate slice.

Discriminating fixture: `tests/objective-authority.test.ts` calls the full
`/v2/run` handler with producer ranks `expensive/.8/rank1` and
`affordable/.2/rank2`, while the first option breaches a trusted budget. The
wire retains that raw ranking, recommends `affordable`, and captures its `.2`
share without a fabricated lead gap. Paired tests remove objective truth while
retaining legacy shares, omit the new producer's shares, reverse goal direction,
preserve true ties, and carry target plus separate budget constraints.

Validation: typecheck and direct dependent tests run locally. CI remains the
integration gate. The vendored 0.52.0 shared-schema candidate is a development
artifact; final reviewed bytes must be repinned before integration. No CEE/UI
files, uncertainty engine, disclosure arm, deployment, or merge are included.
