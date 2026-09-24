# Independent goal target and constraint transport

Source trace at staging `5039cca469be0d78b6c73b586a3fcd424efe296b`:

1. `/v2/run` receives a root `goal_threshold` or the selected raw goal node's already-normalised `goal_threshold`; the selected node separately supplies the attested frame. Root threshold retains precedence over node threshold. Raw-unit conversion is not introduced here.
2. `src/routes/v2/run.ts` compiles/filters constraints, then currently clears the independent target whenever explicit constraints survive. Auto-synthesis alone restores its target from the post-normalisation constraint value.
3. `src/integrations/isl/translator-v3.ts` independently emits threshold/frame and goal_constraints; goal_direction is separately forwarded without inference.
4. ISL `c00f50775389a928d03bc6ee16d46cd928a33561`, `src/services/robustness_analyzer_v2.py`, resolves threshold/frame once, then computes goal probability and constraint analysis separately. Both request members are accepted.
5. PLoT run response admits probability_of_goal only through the existing probability validator, and retains its independent constraint result/claim gates. Missing/error results remain missing; this transport fix does not grant leader permission or fabricate results.

Repair: retain the independent stated target alongside explicit constraints. Keep the existing auto-synthesised post-normalisation carry, frame omission/disclosure, domain-bound refusal and direction transport. Route tests inspect the outbound mocked ISL request; they are not live ISL computation or a served journey witness. The independently reported ISL minimise-tail defect remains outside this repair and must be resolved before accepting minimise goal-fit claims.
