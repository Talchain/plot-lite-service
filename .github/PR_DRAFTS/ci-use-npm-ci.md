# chore(ci): switch CI back to `npm ci` after lockfile update

Please run locally before merging:

1. From repo root, run:

```
cd /Users/paulslee/Documents/GitHub/plot-lite-service
npm install
git add package-lock.json
git commit -m "chore(ci): refresh lockfile for npm ci"
git push -u origin chore/ci-use-npm-ci
```

Then merge when Actions go green. This PR flips CI back to `npm ci` on Node 18/20.
