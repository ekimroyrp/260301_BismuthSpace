import { BoxGeometry, type BufferGeometry } from 'three';

function clampWallThickness(pipeOuterSize: number, pipeWallThickness: number): number {
  return Math.max(0.001, Math.min(pipeOuterSize * 0.48, pipeWallThickness));
}

export function createStraightPipeGeometry(pipeOuterSize: number, pipeWallThickness: number): BufferGeometry {
  const size = Math.max(0.01, pipeOuterSize);
  // Keep thickness clamping in the API path so UI constraints stay validated.
  clampWallThickness(size, pipeWallThickness);
  const geometry = new BoxGeometry(size, 1, size);
  geometry.computeVertexNormals();
  return geometry;
}

export function createMiterCornerGeometry(pipeOuterSize: number, pipeWallThickness: number): BufferGeometry {
  const size = Math.max(0.01, pipeOuterSize);
  clampWallThickness(size, pipeWallThickness);
  const geometry = new BoxGeometry(size, size, size);
  geometry.computeVertexNormals();
  return geometry;
}

export function createPipeCapGeometry(pipeOuterSize: number, pipeWallThickness: number): BufferGeometry {
  const size = Math.max(0.01, pipeOuterSize);
  const capThickness = Math.max(0.001, Math.min(pipeWallThickness, size * 0.5));
  const geometry = new BoxGeometry(size, capThickness, size);
  geometry.computeVertexNormals();
  return geometry;
}
