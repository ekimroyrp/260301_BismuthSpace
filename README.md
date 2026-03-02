# 260301_BismuthSpace

260301_BismuthSpace is a Vite + TypeScript + Three.js interactive simulator for growing clustered, bismuth-like crystal structures in a real 3D scene. Growth is deterministic from a seed value, generated with a segment-chain lattice model (stacked horizontal path loops with optional vertical turns), then rendered with an instanced two-geometry pipeline and an iridescent material treatment inspired by oxidized bismuth.

## Features

- Deterministic crystal growth from a single seed slider (default `351107`) for reproducible runs.
- Segment-chain simulation with branching, growth accumulation, collision handling, capped path history, and probabilistic front retirement.
- Optional `Symmetry` mode that mirrors generated growth across the XY plane.
- Optional `Flip` presentation mode to view growth upside down while keeping simulation logic unchanged.
- Combined `Start`/`Stop` run toggle plus `Reset` for rapid iteration without leaving the current parameter set.
- Draggable, collapsible control panel with reorganized sections: `Simulation`, `Paths`, and `Material`.
- User-friendly Paths labels (`Split Chance`, `Rise Chance`, `Stuck Tolerance`, etc.) for easier non-technical tuning.
- Instanced rendering for speed (straight path segments + corner geometry) with live remeshing during growth.
- Interaction quality mode that temporarily lowers render cost during camera movement only while simulation is actively running.
- Iridescent bismuth-style look via `MeshPhysicalMaterial` shader customization, gradient controls, and reflectiveness tuning.
- Unit tests for determinism and core behavior (RNG, simulator reset/signatures, orbit mapping, path mesher).

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
  - `Start` / `Stop`: single toggle button to run or pause growth
  - `Reset`: clear and regrow from current seed/settings
  - `Speed`: simulation step rate
  - `Seed`: deterministic seed slider
  - `Symmetry`: mirror generated edges across the XY plane
  - `Flip`: upside-down presentation toggle (visual transform only)
- Paths:
  - `Starting Size`
  - `Max Growing Paths`
  - `Split Chance`
  - `Split Boost`
  - `Rise Chance`
  - `Add Section Chance`
  - `Max Sections per Path`
  - `Stuck Tolerance`
  - `Base Growth`
  - `Growth Variation`
  - `Stop Chance`
  - `Path Thickness`
- Material:
  - `Gradient Start`
  - `Gradient End`
  - `Iridescence`
  - `Frequency`
  - `Reflectiveness`

## Deployment

- **Local production preview:** `npm install`, then `npm run build` followed by `npm run preview` to inspect the compiled bundle.
- **Publish to GitHub Pages:** From a clean `main`, run `npm run build -- --base=./`. Checkout (or create) the `gh-pages` branch in a separate worktree/clone, copy everything inside `dist/` plus `.nojekyll`, and keep a minimal branch layout (`assets/`, `env/`, `index.html`, `.gitignore`). Commit with a descriptive message, `git push origin gh-pages`, then switch back to `main`.
- **Live demo:** https://ekimroyrp.github.io/260301_BismuthSpace/
