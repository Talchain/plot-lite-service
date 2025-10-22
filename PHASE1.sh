#!/bin/bash
set -e

echo "Phase 1: Backup & Reset"

# Create backup
git branch backup/main-with-features-$(date +%Y%m%d)

# Reset to stable
git reset --hard 50e88ef

echo "✅ Phase 1 complete"
echo "Backup created, main reset to 50e88ef"
echo ""
echo "Next: Run ./PHASE2_P2-1.sh"
