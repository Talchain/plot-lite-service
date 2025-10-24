#!/bin/bash
echo "## Failing Files Analysis"
echo ""

# Extract all unique failing files across all runs
all_fails=$(for i in 1 2 3 4 5; do
  grep "^[[:space:]]*FAIL[[:space:]]*tests/" .ci-main-run$i.txt | \
    sed 's/^[[:space:]]*FAIL[[:space:]]*//; s/[[:space:]].*//'
done | sort -u)

echo "### Consistency Check"
echo ""
echo "| File | Run1 | Run2 | Run3 | Run4 | Run5 | Frequency |"
echo "|------|------|------|------|------|------|-----------|"

for file in $all_fails; do
  count=0
  status=""
  for i in 1 2 3 4 5; do
    if grep -q "FAIL.*$file" .ci-main-run$i.txt; then
      status="${status}❌   |"
      count=$((count + 1))
    else
      status="${status}✅   |"
    fi
  done
  echo "| $(basename $file) | $status $count/5 |"
done

echo ""
echo "### Classification"
echo ""

# Consistent failures (5/5)
echo "**Consistent failures (5/5 runs)**:"
for file in $all_fails; do
  count=0
  for i in 1 2 3 4 5; do
    if grep -q "FAIL.*$file" .ci-main-run$i.txt; then
      count=$((count + 1))
    fi
  done
  if [ $count -eq 5 ]; then
    echo "- \`$file\`"
  fi
done

echo ""
echo "**Flaky (1-4/5 runs)**:"
for file in $all_fails; do
  count=0
  for i in 1 2 3 4 5; do
    if grep -q "FAIL.*$file" .ci-main-run$i.txt; then
      count=$((count + 1))
    fi
  done
  if [ $count -lt 5 ] && [ $count -gt 0 ]; then
    echo "- \`$file\` ($count/5)"
  fi
done
