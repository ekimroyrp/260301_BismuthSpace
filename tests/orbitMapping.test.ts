import { MOUSE } from 'three';
import { describe, expect, it } from 'vitest';
import { applyOrbitMouseMapping } from '../src/core/orbitMapping';

describe('applyOrbitMouseMapping', () => {
  it('maps MMB to pan and RMB to rotate', () => {
    const controls = {
      mouseButtons: {
        LEFT: MOUSE.ROTATE,
        MIDDLE: MOUSE.DOLLY,
        RIGHT: MOUSE.PAN,
      },
    };

    applyOrbitMouseMapping(controls);

    expect(controls.mouseButtons.LEFT).toBeUndefined();
    expect(controls.mouseButtons.MIDDLE).toBe(MOUSE.PAN);
    expect(controls.mouseButtons.RIGHT).toBe(MOUSE.ROTATE);
  });
});
