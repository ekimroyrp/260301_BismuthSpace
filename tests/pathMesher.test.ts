import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import {
  buildPipeInstanceMatrices,
  classifyVertex,
  computeTrimmedSegmentLength,
} from '../src/core/render/pathMesher';
import type { LatticeEdge } from '../src/core/sim/types';

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

  it('collapses collinear edges into one stretched straight instance', () => {
    const edges: LatticeEdge[] = [
      { a: { x: 0, y: 0, z: 0 }, b: { x: 1, y: 0, z: 0 } },
      { a: { x: 1, y: 0, z: 0 }, b: { x: 2, y: 0, z: 0 } },
      { a: { x: 2, y: 0, z: 0 }, b: { x: 3, y: 0, z: 0 } },
    ];

    const result = buildPipeInstanceMatrices(edges, {
      cornerInset: 0.11,
      layerStepHeight: 1,
      planarStepSize: 1,
    });

    expect(result.straightMatrices.length).toBe(1);

    const position = new Vector3();
    const rotation = new Quaternion();
    const scale = new Vector3();
    result.straightMatrices[0].decompose(position, rotation, scale);
    expect(scale.y).toBeCloseTo(3);
  });
});
