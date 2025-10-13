# Mathematical Annex

## BMA (Bisimulation Minimisation Algorithm)

### Overview
BMA reduces state graphs by merging bisimilar states while preserving observable behavior. Two states are bisimilar if they exhibit identical behavior under all possible observations.

### Algorithm
1. **Initial partition**: Group states by observable output
2. **Refinement**: Iteratively split partitions where states have transitions to different partitions
3. **Convergence**: Terminate when no further splits occur
4. **Quotient graph**: Collapsed graph with one representative per partition

### Identifiability
A system is identifiable when:
- Different parameter values produce distinguishable behaviors
- BMA minimisation yields a unique minimal graph
- No observational equivalences mask structural differences

### Application to PLoT Engine
- **States**: Narrative positions in decision flows
- **Transitions**: User actions (choices, inputs)
- **Observations**: Output fragments (text, metadata)
- **Bisimilarity**: Two flows are bisimilar if all observable outputs match

### Complexity
- Time: O(n² log n) using Paige-Tarjan algorithm
- Space: O(n + m) where n = states, m = transitions

## Action Semantics

### Primitive Actions
- **select(choice_id)**: Navigate to choice branch
- **input(field, value)**: Provide user input
- **observe(output)**: Record observable output

### Composition
- **Sequential**: a₁ ; a₂ (execute a₁ then a₂)
- **Parallel**: a₁ ‖ a₂ (concurrent execution)
- **Choice**: a₁ + a₂ (non-deterministic choice)

### Trace Semantics
- A trace is a sequence of observable events
- Two systems are trace-equivalent if they produce the same set of traces
- BMA preserves trace semantics under bisimulation

## References
- Paige, R., & Tarjan, R. E. (1987). "Three partition refinement algorithms"
- Milner, R. (1989). "Communication and Concurrency"
- Sangiorgi, D. (2011). "Introduction to Bisimulation and Coinduction"
