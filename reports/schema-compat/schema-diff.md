# Schema Compatibility Report

**Risk Level**: LOW

## Changes from Baseline

- ADD: `model_averaging` (object, BMA results)
- ADD: `confidence.stability` (object, variance metrics)
- ADD: `identifiability` (object, causal identification)
- ADD: `actions[]` (array, action semantics)
- ADD: `reward` (object, regret + top_k)
- ADD: `time` (object, timing metrics)
- ADD: `provenance` (object, source stamps)
- REQUIRE: `model_card.response_hash` (SHA-256)

## Summary

All changes are additive and backward-compatible. No breaking changes detected.

## Rename Heuristics

None (all new fields).
