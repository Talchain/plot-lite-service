# Template Authoring Guide (v1.2)

## v1.2 Schema Requirements

### Graph Structure
```typescript
{
  version: "1.2",
  default_seed: 4242,  // For determinism
  nodes: Node[],
  edges: Edge[]
}
```

### Node Fields
```typescript
{
  id: string,           // kebab-case or snake_case
  label: string,        // Human-readable (≤50 chars)
  kind: "decision" | "option" | "outcome" | "factor",
  body: string          // Plain English explanation (≤140 chars)
}
```

### Edge Fields
```typescript
{
  from: string,
  to: string,
  weight: number,       // -0.8 to 0.8
  belief: number,       // 0.25 to 0.9
  provenance: "template"
}
```

## Calibration Bands

| Strength | Weight Range | Belief Range | Use Case |
|----------|-------------|--------------|----------|
| Strong   | 0.6–0.8     | 0.75–0.9    | Direct causal links |
| Medium   | 0.3–0.5     | 0.5–0.7     | Moderate influence |
| Weak     | 0.1–0.2     | 0.25–0.45   | Indirect effects |

**Rules:**
- Never use `belief=1.0` (overconfident)
- Never use `weight=0.0` (no effect)
- Include negative weights for inverse relationships

## Structure Rules

1. **Acyclic (DAG)** — No cycles allowed
2. **Flow** — Decision → Options → Factors → Outcomes
3. **Size** — 12–16 nodes, 18–30 edges (target)
4. **Connectivity** — Every option must reach ≥1 outcome

## Node Body Style

Keep bodies ≤140 chars, plain English:
- ✅ "Lower unit cost with higher variability."
- ✅ "Risk of insolvency or disruption."
- ❌ "This is the cost factor that..." (too verbose)

## Determinism

Set `default_seed: 4242` for stable hashes across runs.

## Example Template

```typescript
supplier_selection_resilience: {
  version: '1.2',
  default_seed: 4242,
  nodes: [
    { id: 'supplier_choice', label: 'Which supplier?', kind: 'decision', 
      body: 'Choose a sourcing strategy balancing cost, quality, continuity.' },
    { id: 'supplier_a', label: 'Supplier A (cheapest)', kind: 'option',
      body: 'Lower unit cost with higher variability.' },
    { id: 'unit_cost', label: 'Unit cost', kind: 'factor',
      body: 'All-in unit cost including freight and duties.' },
    { id: 'gross_margin', label: 'Gross margin %', kind: 'outcome',
      body: 'Revenue minus COGS as percentage of revenue.' }
  ],
  edges: [
    { from: 'supplier_choice', to: 'supplier_a', weight: 0.33, belief: 0.9, provenance: 'template' },
    { from: 'supplier_a', to: 'unit_cost', weight: 0.7, belief: 0.85, provenance: 'template' },
    { from: 'unit_cost', to: 'gross_margin', weight: -0.7, belief: 0.85, provenance: 'template' }
  ]
}
```
