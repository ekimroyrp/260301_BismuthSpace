# 260301_BismuthForms

260301_BismuthForms is a Vite + TypeScript + Three.js interactive simulator for growing clustered bismuth-like crystal forms in a real 3D scene. Growth is generated from deterministic seeded lattice paths and rendered with a fast two-geometry instancing setup: cube instances at turn corners and non-uniformly scaled rectangular box instances along path segments, plus an iridescent shader treatment inspired by real bismuth oxidation colors.

## Features

- True 3D crystal growth simulation with deterministic random seed behavior.
- Clustered aggregate growth fronts with branching and occupancy constraints.
- Two-geometry instanced rendering model for speed: corner cubes + scaled path boxes.
- Segment trimming logic keeps path boxes fitted between corner cubes at turns.
- Iridescent bismuth-style material using `MeshPhysicalMaterial` + shader customization.
- Draggable, collapsible control panel reused/adapted from `260222_CrystalGrowth`.
- Runtime controls for simulation flow, seed, growth, branching, pipe dimensions, and material response.
- Unit tests for RNG determinism, simulator determinism/reset, orbit mouse mapping, and path mesher trim/classification.

## Getting Started

1. `npm install`
2. `npm run dev`
3. Open the local Vite URL shown in the terminal.
4. Optional checks:
   - `npm run test`
   - `npm run build`
   - `npm run preview`

## Controls

- Camera:
  - Mouse wheel: zoom
  - Middle mouse button: pan
  - Right mouse button: orbit
- Simulation:
  - `Start`: begin growth stepping
  - `Stop`: pause growth stepping
  - `Reset`: clear and regrow from current seed/settings
  - `Seed`: deterministic seed value
  - `Randomize Seed`: assign a random seed and reset
- Growth/shape tuning:
  - `Growth Rate`
  - `Branch Chance`
  - `Max Active Fronts`
  - `Initial Loop Size`
  - `Rise Per Side`
  - `Pipe Outer Size`
  - `Pipe Wall Thickness`
- Material:
  - `Iridescence Strength`
  - `Hue Band Frequency`
