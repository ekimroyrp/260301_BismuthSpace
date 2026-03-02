import {
  ACESFilmicToneMapping,
  AmbientLight,
  Clock,
  Color,
  DirectionalLight,
  MathUtils,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  WebGLRenderTarget,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { createBismuthMaterial, type BismuthMaterialController } from '../core/material/bismuthMaterial';
import { applyOrbitMouseMapping } from '../core/orbitMapping';
import { buildPipeInstanceMatrices } from '../core/render/pathMesher';
import { createMiterCornerGeometry, createStraightPipeGeometry } from '../core/render/pipeGeometry';
import { MiterCornerInstancer } from '../core/render/miterCornerInstancer';
import { StraightPipeInstancer } from '../core/render/straightPipeInstancer';
import { BismuthSimulator } from '../core/sim/bismuthSimulator';
import type { BismuthFormsApp, MaterialParams, PipeParams, SimulationParams } from '../types';

interface UiElements {
  panel: HTMLDivElement;
  handleTop: HTMLDivElement;
  handleBottom: HTMLDivElement;
  collapseToggle: HTMLButtonElement;
  start: HTMLButtonElement;
  stop: HTMLButtonElement;
  reset: HTMLButtonElement;
  seed: HTMLInputElement;
  randomSeed: HTMLButtonElement;
  growthRate: HTMLInputElement;
  growthRateValue: HTMLSpanElement;
  branchChance: HTMLInputElement;
  branchChanceValue: HTMLSpanElement;
  upwardTurnChance: HTMLInputElement;
  upwardTurnChanceValue: HTMLSpanElement;
  maxFronts: HTMLInputElement;
  maxFrontsValue: HTMLSpanElement;
  initialLoop: HTMLInputElement;
  initialLoopValue: HTMLSpanElement;
  newSegmentChance: HTMLInputElement;
  newSegmentChanceValue: HTMLSpanElement;
  deathChance: HTMLInputElement;
  deathChanceValue: HTMLSpanElement;
  groupSpawnScale: HTMLInputElement;
  groupSpawnScaleValue: HTMLSpanElement;
  segmentGrowthBias: HTMLInputElement;
  segmentGrowthBiasValue: HTMLSpanElement;
  segmentGrowthScale: HTMLInputElement;
  segmentGrowthScaleValue: HTMLSpanElement;
  maxSegmentsFront: HTMLInputElement;
  maxSegmentsFrontValue: HTMLSpanElement;
  frontCollisionLimit: HTMLInputElement;
  frontCollisionLimitValue: HTMLSpanElement;
  pipeOuterSize: HTMLInputElement;
  pipeOuterSizeValue: HTMLSpanElement;
  gradientStartColor: HTMLInputElement;
  gradientEndColor: HTMLInputElement;
  iridescenceStrength: HTMLInputElement;
  iridescenceStrengthValue: HTMLSpanElement;
  hueBandFrequency: HTMLInputElement;
  hueBandFrequencyValue: HTMLSpanElement;
}

const DEFAULT_SIMULATION_PARAMS: SimulationParams = {
  seed: 260301,
  maxSegments: 80000,
  segmentsPerStep: 8,
  branchChance: 0.18,
  upwardTurnChance: 0.08,
  newSegmentChance: 0.1,
  deathChance: 0.01,
  groupSpawnChanceScale: 0.083,
  segmentGrowthBias: 0,
  segmentGrowthScale: 3,
  maxSegmentsPerFront: 6,
  frontCollisionStreakLimit: 18,
  maxActiveFronts: 40,
  initialLoopSize: 4,
  boundsRadius: 80,
};

const DEFAULT_PIPE_PARAMS: PipeParams = {
  pipeOuterSize: 0.22,
  cornerInset: 0.11,
};

const DEFAULT_MATERIAL_PARAMS: MaterialParams = {
  iridescenceStrength: 1.05,
  hueBandFrequency: 1.25,
  huePhaseSpeed: 0,
};

const DEFAULT_BRANCH_GRADIENT_START = '#5de9ff';
const DEFAULT_BRANCH_GRADIENT_END = '#ff5ac0';

class BismuthFormsAppImpl implements BismuthFormsApp {
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: WebGLRenderer;
  private readonly scene: Scene;
  private readonly camera: PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly simulator: BismuthSimulator;
  private readonly materialController: BismuthMaterialController;
  private readonly clock = new Clock();
  private readonly ui: UiElements;
  private readonly uiCleanup: Array<() => void> = [];

  private environmentTarget: WebGLRenderTarget | null = null;
  private straightInstancer: StraightPipeInstancer | null = null;
  private cornerInstancer: MiterCornerInstancer | null = null;
  private straightColorFactors: number[] = [];
  private cornerColorFactors: number[] = [];
  private running = false;
  private animationFrame = 0;

  private simulationParams: SimulationParams = { ...DEFAULT_SIMULATION_PARAMS };
  private pipeParams: PipeParams = { ...DEFAULT_PIPE_PARAMS };
  private materialParams: MaterialParams = { ...DEFAULT_MATERIAL_PARAMS };
  private readonly branchGradientStart = new Color(DEFAULT_BRANCH_GRADIENT_START);
  private readonly branchGradientEnd = new Color(DEFAULT_BRANCH_GRADIENT_END);

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.scene = new Scene();
    this.scene.background = new Color('#000000');

    this.renderer = new WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.24;
    this.renderer.shadowMap.enabled = true;

    this.camera = new PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 12000);
    this.camera.position.set(24, 18, 24);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxDistance = 10000;
    this.controls.target.set(0, 6, 0);
    applyOrbitMouseMapping(this.controls);

    this.setupStage();
    this.setupEnvironment();

    this.materialController = createBismuthMaterial(this.materialParams, this.simulationParams.seed);
    this.simulator = new BismuthSimulator(this.simulationParams);
    this.ui = this.resolveUiElements();

    this.rebuildInstancers();
    this.rebuildAllMeshInstances();
    this.setupUi();
    this.setupPanelInteractions();
    this.updateRunButtons();

    this.addDomListener(window, 'resize', () => this.handleResize());
    this.addDomListener(this.canvas, 'contextmenu', (event) => event.preventDefault());
    const onControlsChange = () => {
      this.renderFrame();
    };
    this.controls.addEventListener('change', onControlsChange);
    this.uiCleanup.push(() => this.controls.removeEventListener('change', onControlsChange));

    this.animationLoop();
  }

  start(): void {
    this.running = true;
    this.updateRunButtons();
  }

  stop(): void {
    this.running = false;
    this.updateRunButtons();
  }

  reset(): void {
    this.simulator.reset(this.simulationParams.seed);
    this.materialController.setSeed(this.simulationParams.seed);
    this.rebuildAllMeshInstances();
    this.renderFrame();
  }

  setSeed(seed: number): void {
    this.simulationParams.seed = Math.round(seed);
    this.ui.seed.value = String(this.simulationParams.seed);
    this.materialController.setSeed(this.simulationParams.seed);
    this.reset();
  }

  setSimulationParams(partial: Partial<SimulationParams>): void {
    this.simulationParams = this.sanitizeSimulationParams({
      ...this.simulationParams,
      ...partial,
    });
    this.simulator.setParams(this.simulationParams);
  }

  setPipeParams(partial: Partial<Pick<PipeParams, 'pipeOuterSize'>>): void {
    const nextOuter = MathUtils.clamp(partial.pipeOuterSize ?? this.pipeParams.pipeOuterSize, 0.05, 3);
    this.pipeParams = {
      pipeOuterSize: nextOuter,
      cornerInset: nextOuter * 0.5,
    };

    this.rebuildInstancers();
    this.reset();
  }

  setMaterialParams(partial: Partial<MaterialParams>): void {
    this.materialParams = {
      ...this.materialParams,
      ...partial,
    };
    this.materialController.setParams(this.materialParams);
  }

  isRunning(): boolean {
    return this.running;
  }

  dispose(): void {
    cancelAnimationFrame(this.animationFrame);

    for (const cleanup of this.uiCleanup) {
      cleanup();
    }
    this.uiCleanup.length = 0;

    this.controls.dispose();
    this.disposeInstancers();

    if (this.environmentTarget) {
      this.environmentTarget.dispose();
      this.environmentTarget = null;
    }

    this.materialController.dispose();
    this.renderer.dispose();
  }

  private setupStage(): void {
    const ambient = new AmbientLight(0xffffff, 0.36);
    this.scene.add(ambient);

    const key = new DirectionalLight(0xffffff, 1.7);
    key.position.set(20, 30, 16);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 260;
    key.shadow.camera.left = -45;
    key.shadow.camera.right = 45;
    key.shadow.camera.top = 45;
    key.shadow.camera.bottom = -45;
    key.shadow.bias = -0.00008;
    this.scene.add(key);

    const fill = new DirectionalLight(new Color('#fff4e4'), 0.95);
    fill.position.set(-22, 14, 10);
    this.scene.add(fill);

    const coolRim = new DirectionalLight(new Color('#d6e7ff'), 0.78);
    coolRim.position.set(12, 12, -24);
    this.scene.add(coolRim);

    const top = new DirectionalLight(0xffffff, 0.48);
    top.position.set(0, 42, 0);
    this.scene.add(top);
  }

  private setupEnvironment(): void {
    const pmrem = new PMREMGenerator(this.renderer);
    const env = new RoomEnvironment();
    this.environmentTarget = pmrem.fromScene(env, 1);
    env.dispose();
    pmrem.dispose();

    this.scene.environment = this.environmentTarget.texture;
  }

  private rebuildInstancers(): void {
    this.disposeInstancers();

    const material = this.materialController.material;
    const maxInstances = this.simulationParams.maxSegments;

    this.straightInstancer = new StraightPipeInstancer(
      createStraightPipeGeometry(this.pipeParams.pipeOuterSize),
      material,
      maxInstances,
    );
    this.cornerInstancer = new MiterCornerInstancer(
      createMiterCornerGeometry(this.pipeParams.pipeOuterSize),
      material,
      maxInstances,
    );

    this.scene.add(this.straightInstancer.mesh);
    this.scene.add(this.cornerInstancer.mesh);
  }

  private disposeInstancers(): void {
    if (this.straightInstancer) {
      this.scene.remove(this.straightInstancer.mesh);
      this.straightInstancer.disposeGeometry();
      this.straightInstancer = null;
    }
    if (this.cornerInstancer) {
      this.scene.remove(this.cornerInstancer.mesh);
      this.cornerInstancer.disposeGeometry();
      this.cornerInstancer = null;
    }
  }

  private rebuildAllMeshInstances(): void {
    if (!this.straightInstancer || !this.cornerInstancer) {
      return;
    }

    const meshData = buildPipeInstanceMatrices(this.simulator.getEdges(), {
      cornerInset: this.pipeParams.cornerInset,
      layerStepHeight: this.pipeParams.pipeOuterSize,
      planarStepSize: this.pipeParams.pipeOuterSize,
      branchColorStart: this.branchGradientStart,
      branchColorEnd: this.branchGradientEnd,
    });

    this.straightInstancer.setMatrices(meshData.straightMatrices, meshData.straightColors);
    this.cornerInstancer.setMatrices(meshData.cornerMatrices, meshData.cornerColors);
    this.straightColorFactors = meshData.straightColorFactors;
    this.cornerColorFactors = meshData.cornerColorFactors;
  }

  private refreshGradientColorsOnly(): void {
    if (!this.straightInstancer || !this.cornerInstancer) {
      return;
    }
    this.straightInstancer.setColorsByLerp(
      this.straightColorFactors,
      this.branchGradientStart,
      this.branchGradientEnd,
    );
    this.cornerInstancer.setColorsByLerp(this.cornerColorFactors, this.branchGradientStart, this.branchGradientEnd);
  }

  private animationLoop = (): void => {
    this.animationFrame = requestAnimationFrame(this.animationLoop);
    this.controls.update();
    this.materialController.setTime(this.clock.getElapsedTime());

    if (this.running) {
      const step = this.simulator.step(this.simulationParams.segmentsPerStep);
      if (step.addedEdges.length > 0) {
        this.rebuildAllMeshInstances();
      }
      if (step.isFinished) {
        this.running = false;
        this.updateRunButtons();
      }
    }

    this.renderFrame();
  };

  private renderFrame(): void {
    this.renderer.render(this.scene, this.camera);
  }

  private handleResize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;

    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.clampPanelToViewport();
    this.refreshAllRangeProgress();
    this.renderFrame();
  }

  private resolveUiElements(): UiElements {
    const panel = document.getElementById('ui-panel');
    const handleTop = document.getElementById('ui-handle');
    const handleBottom = document.getElementById('ui-handle-bottom');
    const collapseToggle = document.getElementById('collapse-toggle');
    const start = document.getElementById('start-sim');
    const stop = document.getElementById('stop-sim');
    const reset = document.getElementById('reset-sim');
    const seed = document.getElementById('seed-value');
    const randomSeed = document.getElementById('random-seed');

    const growthRate = document.getElementById('growth-rate');
    const growthRateValue = document.getElementById('growth-rate-value');
    const branchChance = document.getElementById('branch-chance');
    const branchChanceValue = document.getElementById('branch-chance-value');
    const upwardTurnChance = document.getElementById('upward-turn-chance');
    const upwardTurnChanceValue = document.getElementById('upward-turn-chance-value');
    const maxFronts = document.getElementById('max-fronts');
    const maxFrontsValue = document.getElementById('max-fronts-value');
    const initialLoop = document.getElementById('initial-loop');
    const initialLoopValue = document.getElementById('initial-loop-value');
    const newSegmentChance = document.getElementById('new-segment-chance');
    const newSegmentChanceValue = document.getElementById('new-segment-chance-value');
    const deathChance = document.getElementById('death-chance');
    const deathChanceValue = document.getElementById('death-chance-value');
    const groupSpawnScale = document.getElementById('group-spawn-scale');
    const groupSpawnScaleValue = document.getElementById('group-spawn-scale-value');
    const segmentGrowthBias = document.getElementById('segment-growth-bias');
    const segmentGrowthBiasValue = document.getElementById('segment-growth-bias-value');
    const segmentGrowthScale = document.getElementById('segment-growth-scale');
    const segmentGrowthScaleValue = document.getElementById('segment-growth-scale-value');
    const maxSegmentsFront = document.getElementById('max-segments-front');
    const maxSegmentsFrontValue = document.getElementById('max-segments-front-value');
    const frontCollisionLimit = document.getElementById('front-collision-limit');
    const frontCollisionLimitValue = document.getElementById('front-collision-limit-value');
    const pipeOuterSize = document.getElementById('pipe-outer-size');
    const pipeOuterSizeValue = document.getElementById('pipe-outer-size-value');
    const gradientStartColor = document.getElementById('gradient-start-color');
    const gradientEndColor = document.getElementById('gradient-end-color');
    const iridescenceStrength = document.getElementById('iridescence-strength');
    const iridescenceStrengthValue = document.getElementById('iridescence-strength-value');
    const hueBandFrequency = document.getElementById('hue-band-frequency');
    const hueBandFrequencyValue = document.getElementById('hue-band-frequency-value');

    if (
      !(panel instanceof HTMLDivElement) ||
      !(handleTop instanceof HTMLDivElement) ||
      !(handleBottom instanceof HTMLDivElement) ||
      !(collapseToggle instanceof HTMLButtonElement) ||
      !(start instanceof HTMLButtonElement) ||
      !(stop instanceof HTMLButtonElement) ||
      !(reset instanceof HTMLButtonElement) ||
      !(seed instanceof HTMLInputElement) ||
      !(randomSeed instanceof HTMLButtonElement) ||
      !(growthRate instanceof HTMLInputElement) ||
      !(growthRateValue instanceof HTMLSpanElement) ||
      !(branchChance instanceof HTMLInputElement) ||
      !(branchChanceValue instanceof HTMLSpanElement) ||
      !(upwardTurnChance instanceof HTMLInputElement) ||
      !(upwardTurnChanceValue instanceof HTMLSpanElement) ||
      !(maxFronts instanceof HTMLInputElement) ||
      !(maxFrontsValue instanceof HTMLSpanElement) ||
      !(initialLoop instanceof HTMLInputElement) ||
      !(initialLoopValue instanceof HTMLSpanElement) ||
      !(newSegmentChance instanceof HTMLInputElement) ||
      !(newSegmentChanceValue instanceof HTMLSpanElement) ||
      !(deathChance instanceof HTMLInputElement) ||
      !(deathChanceValue instanceof HTMLSpanElement) ||
      !(groupSpawnScale instanceof HTMLInputElement) ||
      !(groupSpawnScaleValue instanceof HTMLSpanElement) ||
      !(segmentGrowthBias instanceof HTMLInputElement) ||
      !(segmentGrowthBiasValue instanceof HTMLSpanElement) ||
      !(segmentGrowthScale instanceof HTMLInputElement) ||
      !(segmentGrowthScaleValue instanceof HTMLSpanElement) ||
      !(maxSegmentsFront instanceof HTMLInputElement) ||
      !(maxSegmentsFrontValue instanceof HTMLSpanElement) ||
      !(frontCollisionLimit instanceof HTMLInputElement) ||
      !(frontCollisionLimitValue instanceof HTMLSpanElement) ||
      !(pipeOuterSize instanceof HTMLInputElement) ||
      !(pipeOuterSizeValue instanceof HTMLSpanElement) ||
      !(gradientStartColor instanceof HTMLInputElement) ||
      !(gradientEndColor instanceof HTMLInputElement) ||
      !(iridescenceStrength instanceof HTMLInputElement) ||
      !(iridescenceStrengthValue instanceof HTMLSpanElement) ||
      !(hueBandFrequency instanceof HTMLInputElement) ||
      !(hueBandFrequencyValue instanceof HTMLSpanElement)
    ) {
      throw new Error('UI elements missing or invalid in index.html.');
    }

    return {
      panel,
      handleTop,
      handleBottom,
      collapseToggle,
      start,
      stop,
      reset,
      seed,
      randomSeed,
      growthRate,
      growthRateValue,
      branchChance,
      branchChanceValue,
      upwardTurnChance,
      upwardTurnChanceValue,
      maxFronts,
      maxFrontsValue,
      initialLoop,
      initialLoopValue,
      newSegmentChance,
      newSegmentChanceValue,
      deathChance,
      deathChanceValue,
      groupSpawnScale,
      groupSpawnScaleValue,
      segmentGrowthBias,
      segmentGrowthBiasValue,
      segmentGrowthScale,
      segmentGrowthScaleValue,
      maxSegmentsFront,
      maxSegmentsFrontValue,
      frontCollisionLimit,
      frontCollisionLimitValue,
      pipeOuterSize,
      pipeOuterSizeValue,
      gradientStartColor,
      gradientEndColor,
      iridescenceStrength,
      iridescenceStrengthValue,
      hueBandFrequency,
      hueBandFrequencyValue,
    };
  }

  private setupUi(): void {
    this.ui.seed.value = String(this.simulationParams.seed);
    this.ui.gradientStartColor.value = DEFAULT_BRANCH_GRADIENT_START;
    this.ui.gradientEndColor.value = DEFAULT_BRANCH_GRADIENT_END;

    this.bindRange(this.ui.growthRate, this.ui.growthRateValue, (value) => `${Math.round(value)}`, (value) => {
      this.setSimulationParams({ segmentsPerStep: Math.round(value) });
    });

    this.bindRange(this.ui.branchChance, this.ui.branchChanceValue, (value) => value.toFixed(2), (value) => {
      this.setSimulationParams({ branchChance: value });
      this.reset();
    });

    this.bindRange(
      this.ui.upwardTurnChance,
      this.ui.upwardTurnChanceValue,
      (value) => value.toFixed(3),
      (value) => {
        this.setSimulationParams({ upwardTurnChance: value });
        this.reset();
      },
    );

    this.bindRange(this.ui.maxFronts, this.ui.maxFrontsValue, (value) => `${Math.round(value)}`, (value) => {
      this.setSimulationParams({ maxActiveFronts: Math.round(value) });
      this.reset();
    });

    this.bindRange(this.ui.initialLoop, this.ui.initialLoopValue, (value) => `${Math.round(value)}`, (value) => {
      this.setSimulationParams({ initialLoopSize: Math.round(value) });
      this.reset();
    });

    this.bindRange(
      this.ui.newSegmentChance,
      this.ui.newSegmentChanceValue,
      (value) => value.toFixed(3),
      (value) => {
        this.setSimulationParams({ newSegmentChance: value });
      },
    );

    this.bindRange(this.ui.deathChance, this.ui.deathChanceValue, (value) => value.toFixed(3), (value) => {
      this.setSimulationParams({ deathChance: value });
    });

    this.bindRange(
      this.ui.groupSpawnScale,
      this.ui.groupSpawnScaleValue,
      (value) => value.toFixed(3),
      (value) => {
        this.setSimulationParams({ groupSpawnChanceScale: value });
      },
    );

    this.bindRange(
      this.ui.segmentGrowthBias,
      this.ui.segmentGrowthBiasValue,
      (value) => value.toFixed(2),
      (value) => {
        this.setSimulationParams({ segmentGrowthBias: value });
      },
    );

    this.bindRange(
      this.ui.segmentGrowthScale,
      this.ui.segmentGrowthScaleValue,
      (value) => value.toFixed(2),
      (value) => {
        this.setSimulationParams({ segmentGrowthScale: value });
      },
    );

    this.bindRange(
      this.ui.maxSegmentsFront,
      this.ui.maxSegmentsFrontValue,
      (value) => `${Math.round(value)}`,
      (value) => {
        this.setSimulationParams({ maxSegmentsPerFront: Math.round(value) });
      },
    );

    this.bindRange(
      this.ui.frontCollisionLimit,
      this.ui.frontCollisionLimitValue,
      (value) => `${Math.round(value)}`,
      (value) => {
        this.setSimulationParams({ frontCollisionStreakLimit: Math.round(value) });
      },
    );

    this.bindRange(this.ui.pipeOuterSize, this.ui.pipeOuterSizeValue, (value) => value.toFixed(2), (value) => {
      this.setPipeParams({ pipeOuterSize: value });
    });

    this.addDomListener(this.ui.gradientStartColor, 'input', () => {
      this.branchGradientStart.set(this.ui.gradientStartColor.value);
      this.refreshGradientColorsOnly();
      this.renderFrame();
    });
    this.addDomListener(this.ui.gradientEndColor, 'input', () => {
      this.branchGradientEnd.set(this.ui.gradientEndColor.value);
      this.refreshGradientColorsOnly();
      this.renderFrame();
    });

    this.bindRange(
      this.ui.iridescenceStrength,
      this.ui.iridescenceStrengthValue,
      (value) => value.toFixed(2),
      (value) => {
        this.setMaterialParams({ iridescenceStrength: value });
      },
    );

    this.bindRange(this.ui.hueBandFrequency, this.ui.hueBandFrequencyValue, (value) => value.toFixed(2), (value) => {
      this.setMaterialParams({ hueBandFrequency: value });
    });

    this.addDomListener(this.ui.start, 'click', () => this.start());
    this.addDomListener(this.ui.stop, 'click', () => this.stop());
    this.addDomListener(this.ui.reset, 'click', () => this.reset());
    this.addDomListener(this.ui.randomSeed, 'click', () => {
      const nextSeed = Math.floor(Math.random() * 1000000);
      this.setSeed(nextSeed);
    });
    this.addDomListener(this.ui.seed, 'change', () => {
      this.setSeed(Number.parseInt(this.ui.seed.value, 10));
    });
    this.addDomListener(this.ui.seed, 'keydown', (event) => {
      const keyboardEvent = event as KeyboardEvent;
      if (keyboardEvent.key !== 'Enter') {
        return;
      }
      this.setSeed(Number.parseInt(this.ui.seed.value, 10));
      this.ui.seed.blur();
    });

    this.refreshAllRangeProgress();
  }

  private setupPanelInteractions(): void {
    const { panel, handleTop, handleBottom, collapseToggle } = this.ui;
    let dragOffset: { x: number; y: number } | null = null;

    this.addDomListener(collapseToggle, 'pointerdown', (event) => {
      event.stopPropagation();
    });

    this.addDomListener(collapseToggle, 'click', () => {
      const collapsed = panel.classList.toggle('is-collapsed');
      collapseToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      this.clampPanelToViewport();
    });

    const startDrag = (event: Event): void => {
      const pointer = event as PointerEvent;
      if (!pointer.isPrimary) {
        return;
      }
      dragOffset = {
        x: pointer.clientX - panel.offsetLeft,
        y: pointer.clientY - panel.offsetTop,
      };
      (event.currentTarget as HTMLElement).setPointerCapture(pointer.pointerId);
    };

    const moveDrag = (event: Event): void => {
      if (!dragOffset) {
        return;
      }
      const pointer = event as PointerEvent;
      const margin = 8;
      const nextX = Math.max(
        margin,
        Math.min(window.innerWidth - panel.offsetWidth - margin, pointer.clientX - dragOffset.x),
      );
      const nextY = Math.max(margin, pointer.clientY - dragOffset.y);
      panel.style.left = `${nextX}px`;
      panel.style.top = `${nextY}px`;
      panel.style.right = 'auto';
      this.clampPanelToViewport();
    };

    const endDrag = (event: Event): void => {
      dragOffset = null;
      const pointer = event as PointerEvent;
      const target = event.currentTarget as HTMLElement;
      if (target.hasPointerCapture(pointer.pointerId)) {
        target.releasePointerCapture(pointer.pointerId);
      }
    };

    for (const dragTarget of [handleTop, handleBottom]) {
      this.addDomListener(dragTarget, 'pointerdown', startDrag);
      this.addDomListener(dragTarget, 'pointermove', moveDrag);
      this.addDomListener(dragTarget, 'pointerup', endDrag);
      this.addDomListener(dragTarget, 'pointercancel', endDrag);
    }

    this.clampPanelToViewport();
  }

  private clampPanelToViewport(): void {
    const { panel, handleTop, handleBottom } = this.ui;
    const margin = 8;
    const minHeight = handleTop.offsetHeight + handleBottom.offsetHeight + 160;
    const availableHeight = window.innerHeight - margin * 2;

    panel.style.maxHeight = `${Math.max(minHeight, availableHeight)}px`;

    const maxTop = Math.max(margin, window.innerHeight - panel.offsetHeight - margin);
    const clampedTop = Math.min(Math.max(panel.offsetTop, margin), maxTop);
    if (clampedTop !== panel.offsetTop) {
      panel.style.top = `${clampedTop}px`;
    }

    const maxLeft = Math.max(margin, window.innerWidth - panel.offsetWidth - margin);
    const clampedLeft = Math.min(Math.max(panel.offsetLeft, margin), maxLeft);
    if (clampedLeft !== panel.offsetLeft) {
      panel.style.left = `${clampedLeft}px`;
    }
  }

  private bindRange(
    input: HTMLInputElement,
    output: HTMLSpanElement,
    formatter: (value: number) => string,
    onInput: (value: number) => void,
  ): void {
    const setValueLabel = (): void => {
      const value = Number.parseFloat(input.value);
      output.textContent = formatter(value);
      this.updateRangeProgress(input);
    };

    setValueLabel();

    this.addDomListener(input, 'input', () => {
      const value = Number.parseFloat(input.value);
      setValueLabel();
      onInput(value);
    });
  }

  private updateRunButtons(): void {
    this.ui.start.disabled = this.running;
    this.ui.stop.disabled = !this.running;
  }

  private updateRangeProgress(input: HTMLInputElement): void {
    const min = Number.parseFloat(input.min);
    const max = Number.parseFloat(input.max);
    const value = Number.parseFloat(input.value);

    const denominator = Math.max(1e-6, max - min);
    const progress = Math.max(0, Math.min(100, ((value - min) / denominator) * 100));
    input.style.setProperty('--range-progress', `${progress}%`);
  }

  private refreshAllRangeProgress(): void {
    const ranges = this.ui.panel.querySelectorAll<HTMLInputElement>('input[type="range"]');
    for (const range of ranges) {
      this.updateRangeProgress(range);
    }
  }

  private sanitizeSimulationParams(params: SimulationParams): SimulationParams {
    return {
      seed: Math.round(Number.isFinite(params.seed) ? params.seed : DEFAULT_SIMULATION_PARAMS.seed),
      maxSegments: MathUtils.clamp(Math.round(params.maxSegments), 1, 500000),
      segmentsPerStep: MathUtils.clamp(Math.round(params.segmentsPerStep), 1, 256),
      branchChance: MathUtils.clamp(params.branchChance, 0, 1),
      upwardTurnChance: MathUtils.clamp(params.upwardTurnChance, 0, 1),
      newSegmentChance: MathUtils.clamp(params.newSegmentChance, 0, 1),
      deathChance: MathUtils.clamp(params.deathChance, 0, 1),
      groupSpawnChanceScale: MathUtils.clamp(params.groupSpawnChanceScale, 0, 1),
      segmentGrowthBias: MathUtils.clamp(params.segmentGrowthBias, 0, 8),
      segmentGrowthScale: MathUtils.clamp(params.segmentGrowthScale, 0, 8),
      maxSegmentsPerFront: MathUtils.clamp(Math.round(params.maxSegmentsPerFront), 1, 64),
      frontCollisionStreakLimit: MathUtils.clamp(Math.round(params.frontCollisionStreakLimit), 1, 200),
      maxActiveFronts: MathUtils.clamp(Math.round(params.maxActiveFronts), 1, 512),
      initialLoopSize: MathUtils.clamp(Math.round(params.initialLoopSize), 2, 256),
      boundsRadius: MathUtils.clamp(Math.round(params.boundsRadius), 4, 4096),
    };
  }

  private addDomListener<T extends EventTarget>(
    target: T,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions | boolean,
  ): void {
    target.addEventListener(type, listener, options);
    this.uiCleanup.push(() => target.removeEventListener(type, listener, options));
  }
}

export function createBismuthFormsApp(canvas: HTMLCanvasElement): BismuthFormsApp {
  return new BismuthFormsAppImpl(canvas);
}
