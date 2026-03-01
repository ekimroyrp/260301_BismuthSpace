import { BoxGeometry, type BufferGeometry } from 'three';

export function createStraightPipeGeometry(pipeOuterSize: number): BufferGeometry {
  const size = Math.max(0.01, pipeOuterSize);
  const geometry = new BoxGeometry(size, 1, size);
  geometry.computeVertexNormals();
  return geometry;
}

export function createMiterCornerGeometry(pipeOuterSize: number): BufferGeometry {
  const size = Math.max(0.01, pipeOuterSize);
  const geometry = new BoxGeometry(size, size, size);
  geometry.computeVertexNormals();
  return geometry;
}
