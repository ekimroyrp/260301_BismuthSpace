import { Color, InstancedMesh, Matrix4, type BufferGeometry, type Material } from 'three';

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

  setMatrices(matrices: readonly Matrix4[], colors?: readonly Color[]): void {
    const count = Math.min(this.maxInstances, matrices.length);
    for (let i = 0; i < count; i += 1) {
      this.mesh.setMatrixAt(i, matrices[i]);
      if (colors?.[i]) {
        this.mesh.setColorAt(i, colors[i]);
      }
    }
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (colors && this.mesh.instanceColor) {
      this.mesh.instanceColor.needsUpdate = true;
    }
    this.mesh.computeBoundingSphere();
  }

  setColorsByLerp(factors: readonly number[], startColor: Color, endColor: Color): void {
    const count = Math.min(this.mesh.count, factors.length, this.maxInstances);
    if (count <= 0) {
      return;
    }

    const color = new Color();
    for (let i = 0; i < count; i += 1) {
      const t = Math.max(0, Math.min(1, factors[i]));
      color.copy(startColor).lerp(endColor, t);
      this.mesh.setColorAt(i, color);
    }

    if (this.mesh.instanceColor) {
      this.mesh.instanceColor.needsUpdate = true;
    }
  }

  disposeGeometry(): void {
    this.mesh.geometry.dispose();
  }
}
