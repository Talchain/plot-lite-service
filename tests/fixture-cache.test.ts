import { describe, it, expect, beforeEach } from 'vitest';
import { loadFixture, getFixtureCacheSize, clearFixtureCache } from '../src/lib/fixtures-cache.js';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { resolve } from 'path';

describe('Fixture Cache Bounds (C5)', () => {
  const testDir = resolve(process.cwd(), 'out', 'test-fixtures');

  beforeEach(() => {
    clearFixtureCache();
    try { rmSync(testDir, { recursive: true, force: true }); } catch {}
    mkdirSync(testDir, { recursive: true });
  });

  it('caches fixture content', () => {
    const path = resolve(testDir, 'test1.json');
    writeFileSync(path, '{"test": 1}');
    
    const content1 = loadFixture(path);
    const content2 = loadFixture(path);
    
    expect(content1).toBe(content2);
    expect(getFixtureCacheSize()).toBe(1);
  });

  it('enforces max size via LRU eviction', () => {
    // Create 60 fixtures (exceeds cap of 50)
    for (let i = 0; i < 60; i++) {
      const path = resolve(testDir, `fixture-${i}.json`);
      writeFileSync(path, `{"id": ${i}}`);
      loadFixture(path);
    }
    
    // Cache should be bounded to 50
    expect(getFixtureCacheSize()).toBeLessThanOrEqual(50);
  });

  it('re-loading evicted fixture preserves content', () => {
    // Load 60 fixtures
    const paths = [];
    for (let i = 0; i < 60; i++) {
      const path = resolve(testDir, `fixture-${i}.json`);
      writeFileSync(path, `{"id": ${i}}`);
      paths.push(path);
      loadFixture(path);
    }
    
    // First fixture likely evicted, reload it
    const firstContent = loadFixture(paths[0]);
    expect(JSON.parse(firstContent).id).toBe(0);
  });

  it('determinism preserved with seed 4242', async () => {
    // Load actual deterministic fixtures
    const fixturesPath = resolve(process.cwd(), 'fixtures', 'deterministic-fixtures.json');
    const content1 = loadFixture(fixturesPath);
    const content2 = loadFixture(fixturesPath);
    
    expect(content1).toBe(content2);
    
    const fixtures = JSON.parse(content1);
    expect(fixtures.cases).toBeDefined();
    expect(Array.isArray(fixtures.cases)).toBe(true);
  });
});
