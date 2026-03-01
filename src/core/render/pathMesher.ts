import { Matrix4, Quaternion, Vector3 } from 'three';
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
  return Math.max(0, rawLength - startTrim - endTrim);
}

export interface PipeInstanceBuildResult {
  straightMatrices: Matrix4[];
  cornerMatrices: Matrix4[];
}

export interface PipeBuildOptions {
  cornerInset: number;
  layerStepHeight: number;
  planarStepSize: number;
}

export function buildPipeInstanceMatrices(
  edges: readonly LatticeEdge[],
  options: PipeBuildOptions,
): PipeInstanceBuildResult {
  const adjacency = new Map<string, Set<string>>();
  const vertices = new Map<string, Int3>();

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
  const cornerMatrices: Matrix4[] = [];

  const layerStepHeight = Math.max(1e-4, options.layerStepHeight);
  const planarStepSize = Math.max(1e-4, options.planarStepSize);

  const direction = new Vector3();
  const start = new Vector3();
  const end = new Vector3();
  const midpoint = new Vector3();
  const quaternion = new Quaternion();
  const scale = new Vector3();
  const matrix = new Matrix4();

  for (const edge of edges) {
    const keyA = pointKey(edge.a);
    const keyB = pointKey(edge.b);
    const typeA = vertexTypes.get(keyA) ?? 'isolated';
    const typeB = vertexTypes.get(keyB) ?? 'isolated';

    start.copy(toVector3(edge.a));
    end.copy(toVector3(edge.b));
    start.x *= planarStepSize;
    start.y *= layerStepHeight;
    start.z *= planarStepSize;
    end.x *= planarStepSize;
    end.y *= layerStepHeight;
    end.z *= planarStepSize;
    direction.subVectors(end, start);
    const rawLength = direction.length();
    if (rawLength <= 1e-6) {
      continue;
    }

    direction.multiplyScalar(1 / rawLength);
    const trimmedLength = computeTrimmedSegmentLength(rawLength, typeA, typeB, options.cornerInset);
    if (trimmedLength <= 1e-6) {
      continue;
    }

    const startTrim = typeA === 'turn' ? options.cornerInset : 0;
    const endTrim = typeB === 'turn' ? options.cornerInset : 0;

    const trimmedStart = start.clone().addScaledVector(direction, startTrim);
    const trimmedEnd = end.clone().addScaledVector(direction, -endTrim);
    midpoint.addVectors(trimmedStart, trimmedEnd).multiplyScalar(0.5);

    quaternion.setFromUnitVectors(UP, direction);
    scale.set(1, trimmedLength, 1);
    matrix.compose(midpoint, quaternion, scale);
    straightMatrices.push(matrix.clone());
  }

  for (const [key, type] of vertexTypes) {
    if (type !== 'turn') {
      continue;
    }

    const center = vertices.get(key) ?? parsePointKey(key);
    cornerMatrices.push(
      new Matrix4().makeTranslation(center.x * planarStepSize, center.y * layerStepHeight, center.z * planarStepSize),
    );
  }

  return {
    straightMatrices,
    cornerMatrices,
  };
}
