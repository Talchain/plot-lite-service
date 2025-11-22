#!/bin/bash
set -e

echo "🔍 FINAL VERIFICATION: P0-1 + E2E + P0-2"
echo "=========================================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Track status
PASS=0
FAIL=0

check() {
  if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ $1${NC}"
    ((PASS++))
  else
    echo -e "${RED}❌ $1${NC}"
    ((FAIL++))
  fi
}

echo "1️⃣ Build Check"
npm run build > /dev/null 2>&1
check "Build passes"
echo ""

echo "2️⃣ P0-1 Tests (Response Validation)"
npx vitest run tests/p0-1-response-validation.test.ts --reporter=dot > /dev/null 2>&1
check "P0-1 tests (3/3)"
echo ""

echo "3️⃣ P0-2 Tests (Secret Rotation)"
npx vitest run tests/secret-rotation.test.ts --reporter=dot > /dev/null 2>&1
check "P0-2 integration tests (3/3)"

npx vitest run tests/secret-rotation-verify-unit.test.ts --reporter=dot > /dev/null 2>&1
check "P0-2 unit tests (2/2)"
echo ""

echo "4️⃣ File Checks"
if [ ! -f "src/plugins/validation-observer.ts" ]; then
  echo -e "${GREEN}✅ Dead file removed${NC}"
  ((PASS++))
else
  echo -e "${RED}❌ Dead file still exists${NC}"
  ((FAIL++))
fi

if [ -f "tests/secret-rotation-verify-unit.test.ts" ]; then
  echo -e "${GREEN}✅ Direct unit test added${NC}"
  ((PASS++))
else
  echo -e "${RED}❌ Direct unit test missing${NC}"
  ((FAIL++))
fi

if [ -f "MERGE_AND_RELEASE_GUIDE.md" ]; then
  echo -e "${GREEN}✅ Merge guide created${NC}"
  ((PASS++))
else
  echo -e "${RED}❌ Merge guide missing${NC}"
  ((FAIL++))
fi

if [ -f "PR_DESCRIPTIONS.md" ]; then
  echo -e "${GREEN}✅ PR descriptions ready${NC}"
  ((PASS++))
else
  echo -e "${RED}❌ PR descriptions missing${NC}"
  ((FAIL++))
fi
echo ""

echo "5️⃣ E2E Infrastructure"
if grep -q "PROMETHEUS_ENABLE=1" docker-compose.e2e.yml; then
  echo -e "${GREEN}✅ PROMETHEUS_ENABLE in E2E${NC}"
  ((PASS++))
else
  echo -e "${RED}❌ PROMETHEUS_ENABLE missing${NC}"
  ((FAIL++))
fi

if [ -f "e2e/lib/prom-wait.ts" ]; then
  echo -e "${GREEN}✅ Robust PromQL wait added${NC}"
  ((PASS++))
else
  echo -e "${RED}❌ prom-wait.ts missing${NC}"
  ((FAIL++))
fi
echo ""

echo "📊 Summary"
echo "=========="
echo "Checks Passed: $PASS"
echo "Checks Failed: $FAIL"
echo ""

if [ $FAIL -eq 0 ]; then
  echo -e "${GREEN}✅ ALL CHECKS PASSED - READY TO MERGE${NC}"
  echo ""
  echo "📋 Next Steps:"
  echo "1. Review PR_DESCRIPTIONS.md for copy-paste PR text"
  echo "2. Follow MERGE_AND_RELEASE_GUIDE.md for merge order"
  echo "3. Tag release after all PRs merged"
  echo ""
  exit 0
else
  echo -e "${RED}❌ SOME CHECKS FAILED - REVIEW REQUIRED${NC}"
  exit 1
fi
