import type { SimulationParams } from '../../types';
import { SeededRng } from '../rng/seededRng';
import type { FrontState, Int3, LatticeEdge, StepResult } from './types';

const HORIZONTAL_DIRECTIONS: readonly Int3[] = [
  { x: 1, y: 0, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 0, z: -1 },
];

const DEFAULT_NEW_SEGMENT_CHANCE = 0.1;
const DEFAULT_UPWARD_TURN_CHANCE = 0.08;
const DEFAULT_DEATH_CHANCE = 0.01;
const DEFAULT_GROUP_SPAWN_CHANCE_SCALE = 0.085;
const DEFAULT_SEGMENT_GROWTH_BIAS = 0.12;
const DEFAULT_SEGMENT_GROWTH_SCALE = 1.18;
const DEFAULT_MAX_SEGMENTS_PER_FRONT = 6;
const DEFAULT_FRONT_COLLISION_STREAK_LIMIT = 14;
const LAYER_RISE_PER_LOOP = 1;

interface EmitPathResult {
  addedEdges: LatticeEdge[];
  head: Int3;
  endDirectionIndex: number;
  upwardStepCount: number;
  hitBounds: boolean;
}

interface EdgeBounds {
  min: Int3;
  max: Int3;
}

function clonePoint(point: Int3): Int3 {
  return { x: point.x, y: point.y, z: point.z };
}

function pointKey(point: Int3): string {
  return `${point.x},${point.y},${point.z}`;
}

function normalizeEdgeKey(a: Int3, b: Int3): string {
  const keyA = pointKey(a);
  const keyB = pointKey(b);
  return keyA < keyB ? `${keyA}|${keyB}` : `${keyB}|${keyA}`;
}

function parsePointKey(key: string): Int3 {
  const [x, y, z] = key.split(',').map((value) => Number.parseInt(value, 10));
  return { x, y, z };
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}

function rotateDirectionIndex(directionIndex: number, clockwise: boolean): number {
  return (directionIndex + (clockwise ? 1 : 3)) % HORIZONTAL_DIRECTIONS.length;
}

function sanitizeSimulationParams(params: SimulationParams): SimulationParams {
  return {
    seed: clampInt(params.seed, -2147483648, 2147483647),
    maxSegments: clampInt(params.maxSegments, 1, 500000),
    segmentsPerStep: clampInt(params.segmentsPerStep, 1, 256),
    branchChance: clampNumber(params.branchChance, 0, 1),
    upwardTurnChance: clampNumber(
      Number.isFinite(params.upwardTurnChance) ? params.upwardTurnChance : DEFAULT_UPWARD_TURN_CHANCE,
      0,
      1,
    ),
    newSegmentChance: clampNumber(
      Number.isFinite(params.newSegmentChance) ? params.newSegmentChance : DEFAULT_NEW_SEGMENT_CHANCE,
      0,
      1,
    ),
    deathChance: clampNumber(Number.isFinite(params.deathChance) ? params.deathChance : DEFAULT_DEATH_CHANCE, 0, 1),
    groupSpawnChanceScale: clampNumber(
      Number.isFinite(params.groupSpawnChanceScale) ? params.groupSpawnChanceScale : DEFAULT_GROUP_SPAWN_CHANCE_SCALE,
      0,
      1,
    ),
    segmentGrowthBias: clampNumber(
      Number.isFinite(params.segmentGrowthBias) ? params.segmentGrowthBias : DEFAULT_SEGMENT_GROWTH_BIAS,
      0,
      8,
    ),
    segmentGrowthScale: clampNumber(
      Number.isFinite(params.segmentGrowthScale) ? params.segmentGrowthScale : DEFAULT_SEGMENT_GROWTH_SCALE,
      0,
      8,
    ),
    maxSegmentsPerFront: clampInt(
      Number.isFinite(params.maxSegmentsPerFront) ? params.maxSegmentsPerFront : DEFAULT_MAX_SEGMENTS_PER_FRONT,
      1,
      64,
    ),
    frontCollisionStreakLimit: clampInt(
      Number.isFinite(params.frontCollisionStreakLimit)
        ? params.frontCollisionStreakLimit
        : DEFAULT_FRONT_COLLISION_STREAK_LIMIT,
      1,
      200,
    ),
    maxActiveFronts: clampInt(params.maxActiveFronts, 1, 512),
    initialLoopSize: clampInt(params.initialLoopSize, 2, 256),
    boundsRadius: clampInt(params.boundsRadius, 4, 4096),
  };
}

export class BismuthSimulator {
  private params: SimulationParams;
  private readonly edges: LatticeEdge[] = [];
  private readonly edgeSet = new Set<string>();
  private readonly adjacency = new Map<string, Set<string>>();
  private readonly boundsMin: Int3 = { x: 0, y: 0, z: 0 };
  private readonly boundsMax: Int3 = { x: 0, y: 0, z: 0 };
  private hasEdgeBounds = false;
  private readonly fronts: FrontState[] = [];
  private frontCursor = 0;
  private nextFrontId = 1;
  private rng: SeededRng;

  constructor(params: SimulationParams) {
    this.params = sanitizeSimulationParams(params);
    this.rng = new SeededRng(this.params.seed);
    this.reset(this.params.seed);
  }

  setParams(partial: Partial<SimulationParams>): void {
    this.params = sanitizeSimulationParams({
      ...this.params,
      ...partial,
    });
  }

  reset(seed = this.params.seed): void {
    this.params = sanitizeSimulationParams({
      ...this.params,
      seed,
    });
    this.rng = new SeededRng(this.params.seed);
    this.edges.length = 0;
    this.edgeSet.clear();
    this.adjacency.clear();
    this.hasEdgeBounds = false;
    this.fronts.length = 0;
    this.frontCursor = 0;
    this.nextFrontId = 1;

    this.spawnInitialFronts();
  }

  getEdges(): readonly LatticeEdge[] {
    return this.edges;
  }

  getEdgeBounds(): EdgeBounds | null {
    if (!this.hasEdgeBounds) {
      return null;
    }
    return {
      min: clonePoint(this.boundsMin),
      max: clonePoint(this.boundsMax),
    };
  }

  getSignatureSample(sampleCount = 64): string {
    const cap = Math.max(0, Math.min(sampleCount, this.edges.length));
    const parts: string[] = [];
    for (let i = 0; i < cap; i += 1) {
      const edge = this.edges[i];
      parts.push(`${pointKey(edge.a)}>${pointKey(edge.b)}`);
    }
    return parts.join(';');
  }

  step(count = this.params.segmentsPerStep): StepResult {
    const maxOps = clampInt(count, 1, 4096);
    const addedEdges: LatticeEdge[] = [];

    for (let op = 0; op < maxOps; op += 1) {
      if (this.edges.length >= this.params.maxSegments || this.fronts.length === 0) {
        break;
      }

      const maxAttempts = Math.max(4, this.fronts.length * 2);
      let addedInOp = false;

      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        if (this.fronts.length === 0) {
          break;
        }
        const frontIndex = this.frontCursor % this.fronts.length;
        this.frontCursor = (frontIndex + 1) % Math.max(1, this.fronts.length);
        const front = this.fronts[frontIndex];

        const frontEdges = this.advanceFront(front);
        if (!front.alive) {
          this.removeFrontAt(frontIndex);
        }

        if (frontEdges.length > 0) {
          addedEdges.push(...frontEdges);
          addedInOp = true;
          break;
        }
      }

      if (!addedInOp) {
        break;
      }
    }

    return {
      addedEdges,
      totalEdges: this.edges.length,
      isFinished: this.isFinished(),
    };
  }

  isFinished(): boolean {
    return this.edges.length >= this.params.maxSegments || this.fronts.length === 0;
  }

  private spawnInitialFronts(): void {
    const seeds: Int3[] = [
      { x: 0, y: 0, z: 0 },
      { x: 3, y: 0, z: -2 },
      { x: -4, y: 1, z: 3 },
    ];

    for (const position of seeds) {
      if (this.fronts.length >= this.params.maxActiveFronts) {
        break;
      }
      if (!this.withinBounds(position)) {
        continue;
      }
      this.fronts.push(this.createFront(position, this.params.initialLoopSize));
    }

    if (this.fronts.length === 0) {
      this.fronts.push(this.createFront({ x: 0, y: 0, z: 0 }, this.params.initialLoopSize));
    }
  }

  private createFront(position: Int3, initialSegmentLength: number): FrontState {
    const startDirectionIndex = this.rng.nextInt(0, HORIZONTAL_DIRECTIONS.length - 1);
    const baseInitialLength = Math.max(1, Math.round(initialSegmentLength));
    const seededLength = Math.max(0.45, baseInitialLength * (0.9 + this.rng.next() * 0.25));

    return {
      id: this.nextFrontId++,
      basePosition: clonePoint(position),
      layerY: position.y,
      baseDirectionIndex: startDirectionIndex,
      clockwise: this.rng.next() > 0.5,
      segments: [{ length: seededLength, axis: 'horizontal' }],
      initialSegmentLength: baseInitialLength,
      latestHead: clonePoint(position),
      latestEndDirectionIndex: startDirectionIndex,
      collisionStreak: 0,
      alive: true,
    };
  }

  private advanceFront(front: FrontState): LatticeEdge[] {
    if (!front.alive) {
      return [];
    }

    if (front.segments.length === 0 || this.rng.next() < this.params.newSegmentChance) {
      const hasUpSegment = front.segments.some((segment) => segment.axis === 'up');
      const axis = this.rng.next() < this.params.upwardTurnChance && !hasUpSegment ? 'up' : 'horizontal';
      front.segments.push({
        length: 0,
        axis,
      });
    }

    const growthDeltaRaw = this.params.segmentGrowthBias + this.rng.next() * this.params.segmentGrowthScale;
    const growthDelta = clampNumber(growthDeltaRaw, 0, 1);
    for (const segment of front.segments) {
      segment.length += growthDelta;
    }

    const trimmedUpSteps = this.trimSegmentHistory(front);
    if (!front.alive) {
      return [];
    }

    const emitResult = this.emitFrontPath(front);
    front.latestHead = clonePoint(emitResult.head);
    front.latestEndDirectionIndex = emitResult.endDirectionIndex;

    if (emitResult.hitBounds) {
      front.collisionStreak += 2;
    } else if (emitResult.addedEdges.length === 0) {
      front.collisionStreak += 1;
    } else {
      front.collisionStreak = 0;
    }

    if (front.collisionStreak >= this.params.frontCollisionStreakLimit) {
      front.alive = false;
    }

    this.maybeSpawnBranch(front, emitResult.head);
    this.maybeKillFront(front);

    // Keep top-of-upturn horizontal returns flush: any vertical participation suppresses extra loop rise.
    const hasUpAxisSegment = front.segments.some((segment) => segment.axis === 'up');
    const hasVerticalProgress = hasUpAxisSegment || emitResult.upwardStepCount > 0 || trimmedUpSteps > 0;
    const additionalLoopRise = hasVerticalProgress ? 0 : LAYER_RISE_PER_LOOP;
    front.layerY += additionalLoopRise;
    front.basePosition.y += additionalLoopRise;
    front.layerY = front.basePosition.y;
    if (!this.withinBounds(front.basePosition)) {
      front.alive = false;
    }

    this.edges.push(...emitResult.addedEdges);
    return emitResult.addedEdges;
  }

  private trimSegmentHistory(front: FrontState): number {
    let trimmedUpSteps = 0;
    while (front.segments.length > this.params.maxSegmentsPerFront) {
      const removed = front.segments.shift();
      if (!removed) {
        return trimmedUpSteps;
      }

      if (removed.axis === 'up') {
        const removedSteps = Math.min(1, Math.max(0, Math.floor(removed.length)));
        front.basePosition.y += removedSteps;
        trimmedUpSteps += removedSteps;
      } else {
        // Keep planar stepping quantized to one lattice unit so render spacing tracks pipe thickness exactly.
        const removedSteps = Math.min(1, Math.max(0, Math.floor(removed.length)));
        const forward = HORIZONTAL_DIRECTIONS[front.baseDirectionIndex];
        front.basePosition = {
          x: front.basePosition.x + forward.x * removedSteps,
          y: front.basePosition.y,
          z: front.basePosition.z + forward.z * removedSteps,
        };
        front.baseDirectionIndex = rotateDirectionIndex(front.baseDirectionIndex, front.clockwise);
      }

      front.layerY = front.basePosition.y;

      if (!this.withinBounds(front.basePosition)) {
        front.alive = false;
        return trimmedUpSteps;
      }
    }

    return trimmedUpSteps;
  }

  private emitFrontPath(front: FrontState): EmitPathResult {
    let cursorX = front.basePosition.x;
    let cursorY = front.basePosition.y;
    let cursorZ = front.basePosition.z;
    let directionIndex = front.baseDirectionIndex;
    let upwardStepCount = 0;
    let hitBounds = false;
    const addedEdges: LatticeEdge[] = [];

    for (const segment of front.segments) {
      const rawSteps = Math.max(0, Math.floor(segment.length));
      const steps = rawSteps;
      if (segment.axis === 'up') {
        for (let step = 0; step < steps; step += 1) {
          const a: Int3 = { x: cursorX, y: cursorY, z: cursorZ };
          const b: Int3 = { x: cursorX, y: cursorY + 1, z: cursorZ };
          if (!this.withinBounds(b)) {
            hitBounds = true;
            break;
          }
          this.tryAddEdge(a, b, addedEdges, front.id);
          cursorY = b.y;
          upwardStepCount += 1;
        }
      } else {
        const direction = HORIZONTAL_DIRECTIONS[directionIndex];
        for (let step = 0; step < steps; step += 1) {
          const a: Int3 = { x: cursorX, y: cursorY, z: cursorZ };
          const b: Int3 = {
            x: cursorX + direction.x,
            y: cursorY,
            z: cursorZ + direction.z,
          };

          if (!this.withinBounds(b)) {
            hitBounds = true;
            break;
          }

          this.tryAddEdge(a, b, addedEdges, front.id);
          cursorX = b.x;
          cursorZ = b.z;
        }

        directionIndex = rotateDirectionIndex(directionIndex, front.clockwise);
      }

      if (hitBounds) {
        break;
      }
    }

    return {
      addedEdges,
      head: { x: cursorX, y: cursorY, z: cursorZ },
      endDirectionIndex: directionIndex,
      upwardStepCount,
      hitBounds,
    };
  }

  private maybeSpawnBranch(parent: FrontState, head: Int3): void {
    if (!parent.alive) {
      return;
    }
    if (this.fronts.length >= this.params.maxActiveFronts) {
      return;
    }

    const groupSpawnChance = clampNumber(this.params.branchChance * this.params.groupSpawnChanceScale, 0, 0.35);
    if (this.rng.next() > groupSpawnChance) {
      return;
    }

    const spawn: Int3 = {
      x: head.x,
      y: Math.max(0, head.y + this.rng.nextInt(0, 1)),
      z: head.z,
    };
    if (!this.withinBounds(spawn)) {
      return;
    }

    const childLength = Math.max(
      2,
      Math.floor(parent.initialSegmentLength * (0.7 + this.rng.next() * 0.55)),
    );
    this.fronts.push(this.createFront(spawn, childLength));

    if (parent.segments.length > 0) {
      parent.segments.pop();
    }
  }

  private maybeKillFront(front: FrontState): void {
    if (this.fronts.length <= 3) {
      return;
    }
    if (this.rng.next() < this.params.deathChance) {
      front.alive = false;
    }
  }

  private tryAddEdge(a: Int3, b: Int3, addedEdges: LatticeEdge[], branchId: number): void {
    if (!this.withinBounds(a) || !this.withinBounds(b)) {
      return;
    }

    const key = normalizeEdgeKey(a, b);
    if (this.edgeSet.has(key)) {
      return;
    }

    const keyA = pointKey(a);
    const keyB = pointKey(b);

    this.edgeSet.add(key);

    if (!this.adjacency.has(keyA)) {
      this.adjacency.set(keyA, new Set<string>());
    }
    if (!this.adjacency.has(keyB)) {
      this.adjacency.set(keyB, new Set<string>());
    }

    this.adjacency.get(keyA)?.add(keyB);
    this.adjacency.get(keyB)?.add(keyA);

    addedEdges.push({
      a: clonePoint(a),
      b: clonePoint(b),
      branchId,
    });
    this.includeBoundsPoint(a);
    this.includeBoundsPoint(b);
  }

  private includeBoundsPoint(point: Int3): void {
    if (!this.hasEdgeBounds) {
      this.boundsMin.x = point.x;
      this.boundsMin.y = point.y;
      this.boundsMin.z = point.z;
      this.boundsMax.x = point.x;
      this.boundsMax.y = point.y;
      this.boundsMax.z = point.z;
      this.hasEdgeBounds = true;
      return;
    }

    this.boundsMin.x = Math.min(this.boundsMin.x, point.x);
    this.boundsMin.y = Math.min(this.boundsMin.y, point.y);
    this.boundsMin.z = Math.min(this.boundsMin.z, point.z);
    this.boundsMax.x = Math.max(this.boundsMax.x, point.x);
    this.boundsMax.y = Math.max(this.boundsMax.y, point.y);
    this.boundsMax.z = Math.max(this.boundsMax.z, point.z);
  }

  private removeFrontAt(index: number): void {
    if (index < 0 || index >= this.fronts.length) {
      return;
    }

    this.fronts.splice(index, 1);

    if (this.fronts.length === 0) {
      this.frontCursor = 0;
      return;
    }

    if (index <= this.frontCursor) {
      this.frontCursor = Math.max(0, this.frontCursor - 1);
    }
    this.frontCursor %= this.fronts.length;
  }

  private withinBounds(point: Int3): boolean {
    const horizontalInBounds =
      Math.abs(point.x) <= this.params.boundsRadius && Math.abs(point.z) <= this.params.boundsRadius;
    if (!horizontalInBounds) {
      return false;
    }

    return point.y >= 0 && point.y <= this.params.boundsRadius * 2;
  }

  getAdjacencySnapshot(): ReadonlyMap<string, readonly Int3[]> {
    const snapshot = new Map<string, readonly Int3[]>();
    for (const [key, neighbors] of this.adjacency) {
      const points = Array.from(neighbors, (neighborKey) => parsePointKey(neighborKey));
      snapshot.set(key, points);
    }
    return snapshot;
  }
}
