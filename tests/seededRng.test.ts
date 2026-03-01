import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng/seededRng';

describe('SeededRng', () => {
  it('produces identical sequence for identical seeds', () => {
    const a = new SeededRng(123456);
    const b = new SeededRng(123456);

    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());

    expect(seqA).toEqual(seqB);
  });

  it('produces different sequence for different seeds', () => {
    const a = new SeededRng(1);
    const b = new SeededRng(2);

    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());

    expect(seqA).not.toEqual(seqB);
  });
});
