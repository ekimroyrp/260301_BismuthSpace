import { describe, expect, it } from 'vitest';
import { BismuthSimulator } from '../src/core/sim/bismuthSimulator';
import type { SimulationParams } from '../src/types';

const BASE_PARAMS: SimulationParams = {
  seed: 260301,
  maxSegments: 500,
  segmentsPerStep: 8,
  branchChance: 0.2,
  newSegmentChance: 0.1,
  deathChance: 0.01,
  groupSpawnChanceScale: 0.085,
  segmentGrowthBias: 0.12,
  segmentGrowthScale: 1.18,
  maxSegmentsPerFront: 6,
  frontCollisionStreakLimit: 14,
  maxActiveFronts: 16,
  initialLoopSize: 12,
  boundsRadius: 40,
};

describe('BismuthSimulator', () => {
  it('is deterministic for same seed and params', () => {
    const a = new BismuthSimulator(BASE_PARAMS);
    const b = new BismuthSimulator(BASE_PARAMS);

    for (let i = 0; i < 25; i += 1) {
      a.step();
      b.step();
    }

    expect(a.getSignatureSample(100)).toEqual(b.getSignatureSample(100));
  });

  it('changes topology with different seeds', () => {
    const a = new BismuthSimulator(BASE_PARAMS);
    const b = new BismuthSimulator({ ...BASE_PARAMS, seed: BASE_PARAMS.seed + 1 });

    for (let i = 0; i < 20; i += 1) {
      a.step();
      b.step();
    }

    expect(a.getSignatureSample(80)).not.toEqual(b.getSignatureSample(80));
  });

  it('reset reproduces deterministic initial run for same seed', () => {
    const simulator = new BismuthSimulator(BASE_PARAMS);

    for (let i = 0; i < 15; i += 1) {
      simulator.step();
    }
    const signatureA = simulator.getSignatureSample(80);

    simulator.reset(BASE_PARAMS.seed);
    for (let i = 0; i < 15; i += 1) {
      simulator.step();
    }
    const signatureB = simulator.getSignatureSample(80);

    expect(signatureA).toEqual(signatureB);
  });

  it('emits only horizontal path edges per layer (no vertical connector segments)', () => {
    const simulator = new BismuthSimulator({
      ...BASE_PARAMS,
      maxSegments: 2000,
      segmentsPerStep: 24,
      branchChance: 0.25,
    });

    while (!simulator.isFinished()) {
      simulator.step();
    }

    for (const edge of simulator.getEdges()) {
      const dy = edge.b.y - edge.a.y;
      expect(dy).toBe(0);
    }
  });
});
