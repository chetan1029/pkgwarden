import { describe, expect, it } from 'vitest';
import { canonicalJson, hashOf } from '../src/index.js';

describe('canonical JSON', () => {
  it('does not depend on key order or undefined values', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: undefined } })).toBe(canonicalJson({ a: { d: 2 }, b: 1 }));
  });

  it('gives different hashes to different values', () => {
    expect(hashOf({ a: 1 })).not.toBe(hashOf({ a: 2 }));
  });
});
