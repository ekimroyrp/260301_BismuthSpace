import type { BufferGeometry, Material } from 'three';
import { MatrixInstancer } from './matrixInstancer';

export class StraightPipeInstancer extends MatrixInstancer {
  constructor(geometry: BufferGeometry, material: Material | Material[], maxInstances: number) {
    super(geometry, material, maxInstances);
  }
}
