import { BoxGeometry, BufferGeometry, ExtrudeGeometry, Path, Shape } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

function clampWallThickness(pipeOuterSize: number, pipeWallThickness: number): number {
  return Math.max(0.001, Math.min(pipeOuterSize * 0.48, pipeWallThickness));
}

export function createStraightPipeGeometry(pipeOuterSize: number, pipeWallThickness: number): BufferGeometry {
  const size = Math.max(0.01, pipeOuterSize);
  const wall = clampWallThickness(size, pipeWallThickness);
  const innerSpan = Math.max(0, size - wall * 2);

  if (innerSpan <= 0.0005) {
    const solid = new BoxGeometry(size, 1, size);
    solid.computeVertexNormals();
    return solid;
  }

  const leftWall = new BoxGeometry(wall, 1, size);
  leftWall.translate(-(size * 0.5) + wall * 0.5, 0, 0);

  const rightWall = new BoxGeometry(wall, 1, size);
  rightWall.translate(size * 0.5 - wall * 0.5, 0, 0);

  const frontWall = new BoxGeometry(innerSpan, 1, wall);
  frontWall.translate(0, 0, size * 0.5 - wall * 0.5);

  const backWall = new BoxGeometry(innerSpan, 1, wall);
  backWall.translate(0, 0, -(size * 0.5) + wall * 0.5);

  const geometry = mergeGeometries([leftWall, rightWall, frontWall, backWall], false);
  geometry.computeVertexNormals();
  return geometry;
}

export function createMiterCornerGeometry(pipeOuterSize: number, pipeWallThickness: number): BufferGeometry {
  const size = Math.max(0.01, pipeOuterSize);
  const wall = clampWallThickness(size, pipeWallThickness);
  const outerHalf = size * 0.5;
  const innerHalf = Math.max(outerHalf - wall, outerHalf * 0.05);
  const cornerInset = size * 0.5;

  const shape = new Shape();
  shape.moveTo(-outerHalf, -outerHalf);
  shape.lineTo(cornerInset, -outerHalf);
  shape.lineTo(cornerInset, outerHalf);
  shape.lineTo(outerHalf, cornerInset);
  shape.lineTo(-outerHalf, cornerInset);
  shape.closePath();

  const hole = new Path();
  hole.moveTo(-innerHalf, -innerHalf);
  hole.lineTo(-innerHalf, cornerInset);
  hole.lineTo(innerHalf, cornerInset);
  hole.lineTo(cornerInset, innerHalf);
  hole.lineTo(cornerInset, -innerHalf);
  hole.closePath();
  shape.holes.push(hole);

  const geometry = new ExtrudeGeometry(shape, {
    depth: size,
    bevelEnabled: false,
    steps: 1,
    curveSegments: 1,
  });
  geometry.translate(0, 0, -size * 0.5);
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
