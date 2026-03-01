export interface SimulationParams {
  seed: number;
  maxSegments: number;
  segmentsPerStep: number;
  branchChance: number;
  maxActiveFronts: number;
  initialLoopSize: number;
  risePerSide: number;
  boundsRadius: number;
}

export interface PipeParams {
  pipeOuterSize: number;
  pipeWallThickness: number;
  cornerInset: number;
}

export interface MaterialParams {
  iridescenceStrength: number;
  hueBandFrequency: number;
  huePhaseSpeed: number;
}

export interface BismuthFormsApp {
  start(): void;
  stop(): void;
  reset(): void;
  setSeed(seed: number): void;
  setSimulationParams(partial: Partial<SimulationParams>): void;
  setPipeParams(partial: Partial<Omit<PipeParams, 'cornerInset'>>): void;
  setMaterialParams(partial: Partial<MaterialParams>): void;
  isRunning(): boolean;
  dispose(): void;
}
