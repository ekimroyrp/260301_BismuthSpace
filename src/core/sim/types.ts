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

export interface FrontSegmentState {
  length: number;
}

export interface FrontState {
  id: number;
  basePosition: Int3;
  layerY: number;
  baseDirectionIndex: number;
  clockwise: boolean;
  segments: FrontSegmentState[];
  initialSegmentLength: number;
  latestHead: Int3;
  latestEndDirectionIndex: number;
  collisionStreak: number;
  alive: boolean;
}
