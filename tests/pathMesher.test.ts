import { describe, expect, it } from 'vitest';
import { classifyVertex, computeTrimmedSegmentLength } from '../src/core/render/pathMesher';

describe('pathMesher classifyVertex', () => {
  it('classifies endpoint, straight, and turn correctly', () => {
    expect(classifyVertex([{ x: 1, y: 0, z: 0 }])).toBe('endpoint');
    expect(classifyVertex([{ x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }])).toBe('straight');
    expect(classifyVertex([{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }])).toBe('turn');
  });

  it('trims only at turn vertices', () => {
    expect(computeTrimmedSegmentLength(1, 'turn', 'straight', 0.11)).toBeCloseTo(0.89);
    expect(computeTrimmedSegmentLength(1, 'turn', 'turn', 0.11)).toBeCloseTo(0.78);
    expect(computeTrimmedSegmentLength(1, 'endpoint', 'straight', 0.11)).toBeCloseTo(1);
  });
});
