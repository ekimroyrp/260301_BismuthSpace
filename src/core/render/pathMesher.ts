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

export function computeTrimmedSegmentLength(rawLength: number, startType: VertexType, endType: VertexType, cornerInset: number): number {
  const startTrim = startType === 'turn' ? cornerInset : 0;
  const endTrim = endType === 'turn' ? cornerInset : 0;
  return Math.max(0, rawLength - startTrim - endTrim);
}

export interface PipeInstanceBuildResult {
  straightMatrices: Matrix4[];
  cornerMatrices: Matrix4[];
  capMatrices: Matrix4[];
}

export interface PipeBuildOptions {
  cornerInset: number;
  capThickness: number;
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
  const capMatrices: Matrix4[] = [];

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

    const neighbors = adjacency.get(key);
    const center = vertices.get(key) ?? parsePointKey(key);
    if (!neighbors || neighbors.size !== 2) {
      continue;
    }

    const [neighborAKey, neighborBKey] = Array.from(neighbors);
    const neighborA = vertices.get(neighborAKey) ?? parsePointKey(neighborAKey);
    const neighborB = vertices.get(neighborBKey) ?? parsePointKey(neighborBKey);

    const dirA = toVector3(subtract(neighborA, center)).normalize();
    const dirB = toVector3(subtract(neighborB, center)).normalize();
    if (Math.abs(dirA.dot(dirB)) > 0.99) {
      continue;
    }

    const normal = new Vector3().crossVectors(dirA, dirB);
    if (normal.lengthSq() <= 1e-8) {
      continue;
    }
    normal.normalize();

    const basis = new Matrix4().makeBasis(dirA, dirB, normal);
    basis.setPosition(center.x, center.y, center.z);
    cornerMatrices.push(basis);
  }

  const capThickness = Math.max(0.0005, options.capThickness);
  for (const [key, type] of vertexTypes) {
    if (type !== 'endpoint') {
      continue;
    }

    const neighbors = adjacency.get(key);
    const center = vertices.get(key) ?? parsePointKey(key);
    if (!neighbors || neighbors.size !== 1) {
      continue;
    }

    const [neighborKey] = Array.from(neighbors);
    const neighbor = vertices.get(neighborKey) ?? parsePointKey(neighborKey);
    const outward = toVector3(subtract(center, neighbor)).normalize();
    const capPosition = toVector3(center).addScaledVector(outward, capThickness * 0.5);

    quaternion.setFromUnitVectors(UP, outward);
    scale.set(1, 1, 1);
    matrix.compose(capPosition, quaternion, scale);
    capMatrices.push(matrix.clone());
  }

  return {
    straightMatrices,
    cornerMatrices,
    capMatrices,
  };
}
