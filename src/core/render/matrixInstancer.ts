import { InstancedMesh, Matrix4, type BufferGeometry, type Material } from 'three';

export class MatrixInstancer {
  readonly mesh: InstancedMesh;
  private readonly maxInstances: number;

  constructor(geometry: BufferGeometry, material: Material | Material[], maxInstances: number) {
    this.maxInstances = Math.max(1, maxInstances);
    this.mesh = new InstancedMesh(geometry, material, this.maxInstances);
    this.mesh.count = 0;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
  }

  setMatrices(matrices: readonly Matrix4[]): void {
    const count = Math.min(this.maxInstances, matrices.length);
    for (let i = 0; i < count; i += 1) {
      this.mesh.setMatrixAt(i, matrices[i]);
    }
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.computeBoundingSphere();
  }

  disposeGeometry(): void {
    this.mesh.geometry.dispose();
  }
}
