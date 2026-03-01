export interface Int3 {
  x: number;
  y: number;
  z: number;
}

export interface LatticeEdge {
  a: Int3;
  b: Int3;
}

export interface StepResult {
  addedEdges: LatticeEdge[];
  totalEdges: number;
  isFinished: boolean;
}

export interface SimulatorSnapshot {
  edges: LatticeEdge[];
}

export interface FrontState {
  id: number;
  position: Int3;
  currentDirectionIndex: number;
  clockwise: boolean;
  sideLength: number;
  sideStepsRemaining: number;
  sidesCompleted: number;
  collisionStreak: number;
  completedSideOnLastMove: boolean;
  alive: boolean;
}
