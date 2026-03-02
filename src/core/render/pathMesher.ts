import { Color, type ColorRepresentation, Matrix4, Quaternion, Vector3 } from 'three';
import type { Int3, LatticeEdge } from '../sim/types';

export type VertexType = 'isolated' | 'endpoint' | 'straight' | 'turn' | 'junction';

const UP = new Vector3(0, 1, 0);

function pointKey(point: Int3): string {
  return `${point.x},${point.y},${point.z}`;
}

function parsePointKey(key: string): Int3 {
  const [x, y, z] = key.split(',').map((entry) => Number.parseInt(entry, 10));
  return { x, y, z };
}

function subtract(a: Int3, b: Int3): Int3 {
  return {
    x: a.x - b.x,
    y: a.y - b.y,
    z: a.z - b.z,
  };
}

function isOpposite(a: Int3, b: Int3): boolean {
  return a.x === -b.x && a.y === -b.y && a.z === -b.z;
}

function toVector3(point: Int3): Vector3 {
  return new Vector3(point.x, point.y, point.z);
}

export function classifyVertex(vectorsFromVertexToNeighbors: readonly Int3[]): VertexType {
  const degree = vectorsFromVertexToNeighbors.length;
  if (degree <= 0) {
    return 'isolated';
  }
  if (degree === 1) {
    return 'endpoint';
  }
  if (degree === 2) {
    return isOpposite(vectorsFromVertexToNeighbors[0], vectorsFromVertexToNeighbors[1]) ? 'straight' : 'turn';
  }
  return 'junction';
}

export function computeTrimmedSegmentLength(
  rawLength: number,
  startType: VertexType,
  endType: VertexType,
  cornerInset: number,
): number {
  const startTrim = startType === 'turn' ? cornerInset : 0;
  const endTrim = endType === 'turn' ? cornerInset : 0;
  const totalTrim = startTrim + endTrim;
  if (totalTrim >= rawLength - 1e-6) {
    return rawLength;
  }
  return Math.max(0, rawLength - totalTrim);
}

export interface PipeInstanceBuildResult {
  straightMatrices: Matrix4[];
  straightColors: Color[];
  straightColorFactors: number[];
  cornerMatrices: Matrix4[];
  cornerColors: Color[];
  cornerColorFactors: number[];
}

export interface PipeBuildOptions {
  cornerInset: number;
  layerStepHeight: number;
  planarStepSize: number;
  branchColorStart: ColorRepresentation;
  branchColorEnd: ColorRepresentation;
}

export function buildPipeInstanceMatrices(
  edges: readonly LatticeEdge[],
  options: PipeBuildOptions,
): PipeInstanceBuildResult {
  const adjacency = new Map<string, Set<string>>();
  const vertices = new Map<string, Int3>();
  const edgeBranchIds = new Map<string, number>();
  const branchLayerExtents = new Map<number, { minY: number; maxY: number }>();

  const link = (a: Int3, b: Int3): void => {
    const keyA = pointKey(a);
    const keyB = pointKey(b);
    if (!adjacency.has(keyA)) {
      adjacency.set(keyA, new Set<string>());
      vertices.set(keyA, { ...a });
    }
    if (!adjacency.has(keyB)) {
      adjacency.set(keyB, new Set<string>());
      vertices.set(keyB, { ...b });
    }
    adjacency.get(keyA)?.add(keyB);
    adjacency.get(keyB)?.add(keyA);
  };

  for (const edge of edges) {
    link(edge.a, edge.b);
    const branchId = edge.branchId ?? 0;
    const edgeKey = normalizeEdgeKey(edge.a, edge.b);
    if (!edgeBranchIds.has(edgeKey)) {
      edgeBranchIds.set(edgeKey, branchId);
    }
    const minY = Math.min(edge.a.y, edge.b.y);
    const maxY = Math.max(edge.a.y, edge.b.y);
    const current = branchLayerExtents.get(branchId);
    if (current) {
      current.minY = Math.min(current.minY, minY);
      current.maxY = Math.max(current.maxY, maxY);
    } else {
      branchLayerExtents.set(branchId, { minY, maxY });
    }
  }

  const vertexTypes = new Map<string, VertexType>();
  for (const [key, neighbors] of adjacency) {
    const center = vertices.get(key);
    if (!center) {
      continue;
    }
    const vectors = Array.from(neighbors, (neighborKey) => {
      const neighbor = vertices.get(neighborKey) ?? parsePointKey(neighborKey);
      return subtract(neighbor, center);
    });
    vertexTypes.set(key, classifyVertex(vectors));
  }

  const straightMatrices: Matrix4[] = [];
  const straightColors: Color[] = [];
  const straightColorFactors: number[] = [];
  const cornerMatrices: Matrix4[] = [];
  const cornerColors: Color[] = [];
  const cornerColorFactors: number[] = [];

  const gradientStart = new Color(options.branchColorStart);
  const gradientEnd = new Color(options.branchColorEnd);

  const layerStepHeight = Math.max(1e-4, options.layerStepHeight);
  const planarStepSize = Math.max(1e-4, options.planarStepSize);

  const evaluateLayerFactor = (branchId: number, layerY: number): number => {
    const extents = branchLayerExtents.get(branchId);
    if (!extents || extents.maxY <= extents.minY + 1e-6) {
      return 0;
    }
    const raw = (layerY - extents.minY) / (extents.maxY - extents.minY);
    return Math.max(0, Math.min(1, raw));
  };

  const evaluateLayerColor = (branchId: number, layerY: number): Color => {
    const t = evaluateLayerFactor(branchId, layerY);
    return gradientStart.clone().lerp(gradientEnd, t);
  };

  const direction = new Vector3();
  const start = new Vector3();
  const end = new Vector3();
  const midpoint = new Vector3();
  const quaternion = new Quaternion();
  const scale = new Vector3();
  const matrix = new Matrix4();
  const addStraightMatrix = (pointA: Int3, pointB: Int3, branchId: number): void => {
    const keyA = pointKey(pointA);
    const keyB = pointKey(pointB);
    const typeA = vertexTypes.get(keyA) ?? 'isolated';
    const typeB = vertexTypes.get(keyB) ?? 'isolated';

    start.copy(toVector3(pointA));
    end.copy(toVector3(pointB));
    start.x *= planarStepSize;
    start.y *= layerStepHeight;
    start.z *= planarStepSize;
    end.x *= planarStepSize;
    end.y *= layerStepHeight;
    end.z *= planarStepSize;
    direction.subVectors(end, start);
    const rawLength = direction.length();
    if (rawLength <= 1e-6) {
      return;
    }

    direction.multiplyScalar(1 / rawLength);
    const trimmedLength = computeTrimmedSegmentLength(rawLength, typeA, typeB, options.cornerInset);
    if (trimmedLength <= 1e-6) {
      return;
    }

    let startTrim = typeA === 'turn' ? options.cornerInset : 0;
    let endTrim = typeB === 'turn' ? options.cornerInset : 0;
    if (startTrim + endTrim >= rawLength - 1e-6) {
      startTrim = 0;
      endTrim = 0;
    }

    const trimmedStart = start.clone().addScaledVector(direction, startTrim);
    const trimmedEnd = end.clone().addScaledVector(direction, -endTrim);
    midpoint.addVectors(trimmedStart, trimmedEnd).multiplyScalar(0.5);

    quaternion.setFromUnitVectors(UP, direction);
    scale.set(1, trimmedLength, 1);
    matrix.compose(midpoint, quaternion, scale);
    straightMatrices.push(matrix.clone());
    const layerY = (pointA.y + pointB.y) * 0.5;
    straightColorFactors.push(evaluateLayerFactor(branchId, layerY));
    straightColors.push(evaluateLayerColor(branchId, layerY));
  };

  const xRuns = new Map<string, Map<number, Set<number>>>();
  const yRuns = new Map<string, Map<number, Set<number>>>();
  const zRuns = new Map<string, Map<number, Set<number>>>();

  const addUnit = (
    runs: Map<string, Map<number, Set<number>>>,
    key: string,
    branchId: number,
    start: number,
  ): void => {
    if (!runs.has(key)) {
      runs.set(key, new Map<number, Set<number>>());
    }
    const branchStarts = runs.get(key);
    if (!branchStarts?.has(branchId)) {
      branchStarts?.set(branchId, new Set<number>());
    }
    branchStarts?.get(branchId)?.add(start);
  };

  for (const edge of edges) {
    const branchId = edge.branchId ?? 0;
    const dx = edge.b.x - edge.a.x;
    const dy = edge.b.y - edge.a.y;
    const dz = edge.b.z - edge.a.z;
    const manhattan = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
    if (manhattan !== 1) {
      continue;
    }

    if (dx !== 0) {
      const y = edge.a.y;
      const z = edge.a.z;
      addUnit(xRuns, `${y},${z}`, branchId, Math.min(edge.a.x, edge.b.x));
      continue;
    }
    if (dy !== 0) {
      const x = edge.a.x;
      const z = edge.a.z;
      addUnit(yRuns, `${x},${z}`, branchId, Math.min(edge.a.y, edge.b.y));
      continue;
    }
    const x = edge.a.x;
    const y = edge.a.y;
    addUnit(zRuns, `${x},${y}`, branchId, Math.min(edge.a.z, edge.b.z));
  }

  const emitAxisRuns = (runs: Map<string, Map<number, Set<number>>>, axis: 'x' | 'y' | 'z'): void => {
    for (const [key, branchStarts] of runs) {
      const [fixedA, fixedB] = key.split(',').map((entry) => Number.parseInt(entry, 10));

      for (const [branchId, startsSet] of branchStarts) {
        const starts = Array.from(startsSet).sort((a, b) => a - b);
        if (starts.length === 0) {
          continue;
        }

        let runStart = starts[0];
        let runLast = starts[0];

        const flush = (startValue: number, endExclusive: number): void => {
          if (axis === 'x') {
            addStraightMatrix(
              { x: startValue, y: fixedA, z: fixedB },
              { x: endExclusive, y: fixedA, z: fixedB },
              branchId,
            );
            return;
          }
          if (axis === 'y') {
            addStraightMatrix(
              { x: fixedA, y: startValue, z: fixedB },
              { x: fixedA, y: endExclusive, z: fixedB },
              branchId,
            );
            return;
          }
          addStraightMatrix(
            { x: fixedA, y: fixedB, z: startValue },
            { x: fixedA, y: fixedB, z: endExclusive },
            branchId,
          );
        };

        for (let i = 1; i < starts.length; i += 1) {
          const next = starts[i];
          if (next === runLast + 1) {
            runLast = next;
            continue;
          }
          flush(runStart, runLast + 1);
          runStart = next;
          runLast = next;
        }

        flush(runStart, runLast + 1);
      }
    }
  };

  emitAxisRuns(xRuns, 'x');
  emitAxisRuns(yRuns, 'y');
  emitAxisRuns(zRuns, 'z');

  for (const [key, type] of vertexTypes) {
    if (type !== 'turn') {
      continue;
    }

    const center = vertices.get(key) ?? parsePointKey(key);
    let branchId = 0;
    const neighbors = adjacency.get(key);
    if (neighbors) {
      for (const neighborKey of neighbors) {
        const neighbor = vertices.get(neighborKey) ?? parsePointKey(neighborKey);
        const edgeKey = normalizeEdgeKey(center, neighbor);
        const nextBranchId = edgeBranchIds.get(edgeKey);
        if (nextBranchId !== undefined) {
          branchId = nextBranchId;
          break;
        }
      }
    }
    cornerMatrices.push(
      new Matrix4().makeTranslation(center.x * planarStepSize, center.y * layerStepHeight, center.z * planarStepSize),
    );
    cornerColorFactors.push(evaluateLayerFactor(branchId, center.y));
    cornerColors.push(evaluateLayerColor(branchId, center.y));
  }

  return {
    straightMatrices,
    straightColors,
    straightColorFactors,
    cornerMatrices,
    cornerColors,
    cornerColorFactors,
  };
}

function normalizeEdgeKey(a: Int3, b: Int3): string {
  const keyA = pointKey(a);
  const keyB = pointKey(b);
  return keyA < keyB ? `${keyA}|${keyB}` : `${keyB}|${keyA}`;
}
