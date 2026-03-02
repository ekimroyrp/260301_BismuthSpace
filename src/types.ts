export interface SimulationParams {
  seed: number;
  maxSegments: number;
  segmentsPerStep: number;
  branchChance: number;
  upwardTurnChance: number;
  newSegmentChance: number;
  deathChance: number;
  groupSpawnChanceScale: number;
  segmentGrowthBias: number;
  segmentGrowthScale: number;
  maxSegmentsPerFront: number;
  frontCollisionStreakLimit: number;
  maxActiveFronts: number;
  initialLoopSize: number;
  boundsRadius: number;
}

export interface PipeParams {
  pipeOuterSize: number;
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
  setPipeParams(partial: Partial<Pick<PipeParams, 'pipeOuterSize'>>): void;
  setMaterialParams(partial: Partial<MaterialParams>): void;
  isRunning(): boolean;
  dispose(): void;
}
