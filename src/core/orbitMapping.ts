import { MOUSE } from 'three';

export interface OrbitMouseButtons {
  LEFT?: number | null;
  MIDDLE?: number | null;
  RIGHT?: number | null;
}

export function applyOrbitMouseMapping(controls: { mouseButtons: OrbitMouseButtons }): void {
  controls.mouseButtons.LEFT = undefined;
  controls.mouseButtons.MIDDLE = MOUSE.PAN;
  controls.mouseButtons.RIGHT = MOUSE.ROTATE;
}
