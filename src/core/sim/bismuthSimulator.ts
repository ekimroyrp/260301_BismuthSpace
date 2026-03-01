import type { SimulationParams } from '../../types';
import { SeededRng } from '../rng/seededRng';
import type { FrontState, Int3, LatticeEdge, StepResult } from './types';

const HORIZONTAL_DIRECTIONS: readonly Int3[] = [
  { x: 1, y: 0, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 0, z: -1 },
];

const LOOP_GROW_PER_CYCLE = 1;
const SIDES_PER_LOOP = 4;

function clonePoint(point: Int3): Int3 {
  return { x: point.x, y: point.y, z: point.z };
}

function addPoint(a: Int3, b: Int3): Int3 {
  return {
    x: a.x + b.x,
    y: a.y + b.y,
    z: a.z + b.z,
  };
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

function sanitizeSimulationParams(params: SimulationParams): SimulationParams {
  return {
    seed: clampInt(params.seed, -2147483648, 2147483647),
    maxSegments: clampInt(params.maxSegments, 1, 500000),
    segmentsPerStep: clampInt(params.segmentsPerStep, 1, 256),
    branchChance: clampNumber(params.branchChance, 0, 1),
    maxActiveFronts: clampInt(params.maxActiveFronts, 1, 512),
    initialLoopSize: clampInt(params.initialLoopSize, 2, 256),
    risePerSide: clampInt(params.risePerSide, 0, 16),
    boundsRadius: clampInt(params.boundsRadius, 4, 4096),
  };
}

export class BismuthSimulator {
  private params: SimulationParams;
  private readonly edges: LatticeEdge[] = [];
  private readonly edgeSet = new Set<string>();
  private readonly adjacency = new Map<string, Set<string>>();
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
    this.fronts.length = 0;
    this.frontCursor = 0;
    this.nextFrontId = 1;

    this.spawnInitialFronts();
  }

  getEdges(): readonly LatticeEdge[] {
    return this.edges;
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

      const maxAttempts = Math.max(4, this.fronts.length * 3);
      let addedInOp = false;

      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        if (this.fronts.length === 0) {
          break;
        }
        const frontIndex = this.frontCursor % this.fronts.length;
        this.frontCursor = (frontIndex + 1) % Math.max(1, this.fronts.length);
        const front = this.fronts[frontIndex];

        const edge = this.advanceFront(front);
        if (!front.alive) {
          this.removeFrontAt(frontIndex);
        }

        if (edge) {
          addedEdges.push(edge);
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

  private createFront(position: Int3, sideLength: number): FrontState {
    return {
      id: this.nextFrontId++,
      position: clonePoint(position),
      currentDirectionIndex: this.rng.nextInt(0, HORIZONTAL_DIRECTIONS.length - 1),
      clockwise: this.rng.next() > 0.5,
      sideLength: Math.max(2, sideLength),
      sideStepsRemaining: 0,
      sidesCompleted: 0,
      collisionStreak: 0,
      completedSideOnLastMove: false,
      alive: true,
    };
  }

  private advanceFront(front: FrontState): LatticeEdge | null {
    const direction = this.nextDirection(front);
    if (!direction || !front.alive) {
      front.alive = false;
      return null;
    }

    const nextPosition = addPoint(front.position, direction);
    if (!this.withinBounds(nextPosition)) {
      front.collisionStreak += 1;
      if (front.collisionStreak >= 3) {
        front.alive = false;
      }
      return null;
    }

    const edge: LatticeEdge = {
      a: clonePoint(front.position),
      b: clonePoint(nextPosition),
    };

    if (!this.tryAddEdge(edge.a, edge.b)) {
      front.collisionStreak += 1;
      if (front.collisionStreak >= 4) {
        front.alive = false;
      }
      return null;
    }

    front.position = nextPosition;
    front.collisionStreak = 0;

    if (front.completedSideOnLastMove) {
      front.completedSideOnLastMove = false;
      this.maybeSpawnBranch(front);
    }

    this.edges.push(edge);
    return edge;
  }

  private nextDirection(front: FrontState): Int3 | null {
    if (front.sideLength <= 0) {
      front.alive = false;
      return null;
    }

    if (front.sideStepsRemaining <= 0) {
      front.sideStepsRemaining = Math.max(1, front.sideLength);
    }

    const direction = HORIZONTAL_DIRECTIONS[front.currentDirectionIndex];
    front.sideStepsRemaining -= 1;

    if (front.sideStepsRemaining === 0) {
      front.completedSideOnLastMove = true;
      front.currentDirectionIndex = (front.currentDirectionIndex + (front.clockwise ? 1 : 3)) % HORIZONTAL_DIRECTIONS.length;
      front.sidesCompleted += 1;

      if (front.sidesCompleted % SIDES_PER_LOOP === 0) {
        const maxSideLength = Math.max(2, this.params.boundsRadius * 2);
        front.sideLength = Math.min(maxSideLength, front.sideLength + LOOP_GROW_PER_CYCLE);
        if (this.params.risePerSide > 0) {
          front.position = {
            ...front.position,
            y: front.position.y + this.params.risePerSide,
          };
          if (!this.withinBounds(front.position)) {
            front.alive = false;
            return null;
          }
        }
      }
    } else {
      front.completedSideOnLastMove = false;
    }

    return direction;
  }

  private maybeSpawnBranch(parent: FrontState): void {
    if (this.fronts.length >= this.params.maxActiveFronts) {
      return;
    }
    if (this.rng.next() > this.params.branchChance) {
      return;
    }

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const offsetDirection = this.rng.pickOne(HORIZONTAL_DIRECTIONS);
      const offsetDistance = this.rng.nextInt(2, 4);
      const lift = this.rng.nextInt(0, 2);
      const startPosition: Int3 = {
        x: parent.position.x + offsetDirection.x * offsetDistance,
        y: parent.position.y + lift,
        z: parent.position.z + offsetDirection.z * offsetDistance,
      };

      if (!this.withinBounds(startPosition)) {
        continue;
      }
      if (this.adjacency.has(pointKey(startPosition))) {
        continue;
      }

      const childSideLength = Math.max(3, Math.floor(parent.sideLength * (0.55 + this.rng.next() * 0.4)));
      this.fronts.push(this.createFront(startPosition, childSideLength));
      return;
    }
  }

  private tryAddEdge(a: Int3, b: Int3): boolean {
    if (!this.withinBounds(a) || !this.withinBounds(b)) {
      return false;
    }

    const key = normalizeEdgeKey(a, b);
    if (this.edgeSet.has(key)) {
      return false;
    }

    const keyA = pointKey(a);
    const keyB = pointKey(b);
    const degreeA = this.adjacency.get(keyA)?.size ?? 0;
    const degreeB = this.adjacency.get(keyB)?.size ?? 0;
    if (degreeA >= 2 || degreeB >= 2) {
      return false;
    }

    this.edgeSet.add(key);

    if (!this.adjacency.has(keyA)) {
      this.adjacency.set(keyA, new Set<string>());
    }
    if (!this.adjacency.has(keyB)) {
      this.adjacency.set(keyB, new Set<string>());
    }

    this.adjacency.get(keyA)?.add(keyB);
    this.adjacency.get(keyB)?.add(keyA);
    return true;
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
