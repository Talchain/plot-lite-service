#!/bin/bash
echo "# Deflake Phase 1 Results"
echo ""
echo "| Run | Failed | Passed | Skipped | Total |"
echo "|-----|--------|--------|---------|-------|"

for i in 1 2 3 4 5; do
  line=$(grep "Test Files.*failed.*passed.*skipped" .ci-deflake-run$i.txt | tail -1)
  failed=$(echo "$line" | grep -oE '[0-9]+ failed' | grep -oE '[0-9]+')
  passed=$(echo "$line" | grep -oE '[0-9]+ passed' | grep -oE '[0-9]+')
  skipped=$(echo "$line" | grep -oE '[0-9]+ skipped' | grep -oE '[0-9]+')
  total=171
  echo "| $i   | $failed      | $passed    | $skipped       | $total   |"
done

echo ""
echo "## Analysis"
echo ""

# Extract all failed counts
failed_counts=$(for i in 1 2 3 4 5; do
  grep "Test Files.*failed.*passed.*skipped" .ci-deflake-run$i.txt | tail -1 | grep -oE '[0-9]+ failed' | grep -oE '[0-9]+'
done | sort -n)

min=$(echo "$failed_counts" | head -1)
max=$(echo "$failed_counts" | tail -1)
variance=$((max - min))

echo "- **Best case**: $min failing files"
echo "- **Worst case**: $max failing files"
echo "- **Variance**: ±$variance files"
echo ""
echo "### Comparison with Baseline"
echo ""
echo "| Metric | Baseline (main) | After Deflake | Improvement |"
echo "|--------|-----------------|---------------|-------------|"
echo "| Best case | 5 | $min | $(($min - 5)) |"
echo "| Worst case | 9 | $max | $(($max - 9)) |"
echo "| Variance | ±4 | ±$variance | $(($variance - 4)) |"
