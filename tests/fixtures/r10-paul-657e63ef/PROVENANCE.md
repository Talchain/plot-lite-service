# r10-paul-657e63ef

`cee-to-plot.request.json` is Paul's production scenario `657e63ef-f220-4fd5-9b4b-25e04334b3e4` (28 Sep 2026, 13:43Z Run; ISL request `87425558…`, payload hash `6643dcde06c2`, 4011 B).

**Rebuilt, not captured.** Production does not log the request bodies. The source is the UI debug export `olumi-debug-9ede200a-20260928.json`:
- `full_graph` gives 14 nodes and 26 edges, with null-valued keys dropped;
- `cee_options` gives the 4 options and their interventions.

**One stated derivation.** The status quo `current_approach` carries today's levels (`ai_assistant_use` 0, `human_assistant_capacity` 0, `annual_assistant_tool_cost` 0). CEE fills these server-side; the export shows `{}`.

**What it reproduces (R10 step 1, R&C #72 5872171875).** Staging PLoT `b4eaa0c5` rewrote the 10 drawn causal links to 9:
- e-22 outcome→outcome deleted, and e-23/e-24 risk→outcome deleted;
- 2 factor→outcome links invented at mean 0.25.
Replayed through ISL `e24c88c` (seed 1820648605), the win% were:
- rerouted: Current 48.3 / AI 36.4 (matching the DL's ≈48/37 simulation);
- as drawn: 53.3 / 32.4.
