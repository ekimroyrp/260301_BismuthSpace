import {
  ACESFilmicToneMapping,
  AmbientLight,
  BoxGeometry,
  Clock,
  Color,
  DirectionalLight,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
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
  maxFronts: HTMLInputElement;
  maxFrontsValue: HTMLSpanElement;
  initialLoop: HTMLInputElement;
  initialLoopValue: HTMLSpanElement;
  risePerSide: HTMLInputElement;
  risePerSideValue: HTMLSpanElement;
  pipeOuterSize: HTMLInputElement;
  pipeOuterSizeValue: HTMLSpanElement;
  pipeWallThickness: HTMLInputElement;
  pipeWallThicknessValue: HTMLSpanElement;
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
  maxActiveFronts: 24,
  initialLoopSize: 5,
  risePerSide: 1,
  boundsRadius: 80,
};

const DEFAULT_PIPE_PARAMS: PipeParams = {
  pipeOuterSize: 0.22,
  pipeWallThickness: 0.06,
  cornerInset: 0.11,
};

const DEFAULT_MATERIAL_PARAMS: MaterialParams = {
  iridescenceStrength: 0.75,
  hueBandFrequency: 0.9,
  huePhaseSpeed: 0,
};

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
  private running = false;
  private animationFrame = 0;

  private simulationParams: SimulationParams = { ...DEFAULT_SIMULATION_PARAMS };
  private pipeParams: PipeParams = { ...DEFAULT_PIPE_PARAMS };
  private materialParams: MaterialParams = { ...DEFAULT_MATERIAL_PARAMS };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.scene = new Scene();
    this.scene.background = new Color('#050709');

    this.renderer = new WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.shadowMap.enabled = true;

    this.camera = new PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 600);
    this.camera.position.set(24, 18, 24);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
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

  setPipeParams(partial: Partial<Omit<PipeParams, 'cornerInset'>>): void {
    const nextOuter = MathUtils.clamp(partial.pipeOuterSize ?? this.pipeParams.pipeOuterSize, 0.05, 1);
    const nextWall = MathUtils.clamp(partial.pipeWallThickness ?? this.pipeParams.pipeWallThickness, 0.005, nextOuter * 0.48);
    this.pipeParams = {
      pipeOuterSize: nextOuter,
      pipeWallThickness: nextWall,
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
    const ambient = new AmbientLight(0xffffff, 0.25);
    this.scene.add(ambient);

    const key = new DirectionalLight(0xffffff, 1.15);
    key.position.set(18, 32, 10);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 220;
    key.shadow.camera.left = -45;
    key.shadow.camera.right = 45;
    key.shadow.camera.top = 45;
    key.shadow.camera.bottom = -45;
    key.shadow.bias = -0.00008;
    this.scene.add(key);

    const rimA = new DirectionalLight(new Color('#79d5ff'), 0.45);
    rimA.position.set(-20, 12, -10);
    this.scene.add(rimA);

    const rimB = new DirectionalLight(new Color('#ff87d7'), 0.35);
    rimB.position.set(14, 8, -20);
    this.scene.add(rimB);

    const floor = new Mesh(
      new PlaneGeometry(240, 240),
      new MeshStandardMaterial({
        color: '#0f1216',
        roughness: 0.9,
        metalness: 0.1,
      }),
    );
    floor.rotation.x = -Math.PI * 0.5;
    floor.position.y = -0.02;
    floor.receiveShadow = true;
    floor.castShadow = false;
    this.scene.add(floor);

    const pedestal = new Mesh(
      new BoxGeometry(30, 1.4, 30),
      new MeshStandardMaterial({
        color: '#11151a',
        roughness: 0.85,
        metalness: 0.2,
      }),
    );
    pedestal.position.y = -0.72;
    pedestal.receiveShadow = true;
    pedestal.castShadow = true;
    this.scene.add(pedestal);
  }

  private setupEnvironment(): void {
    const pmrem = new PMREMGenerator(this.renderer);
    const env = new RoomEnvironment();
    this.environmentTarget = pmrem.fromScene(env, 0.6);
    env.dispose();
    pmrem.dispose();

    this.scene.environment = this.environmentTarget.texture;
  }

  private rebuildInstancers(): void {
    this.disposeInstancers();

    const material = this.materialController.material;
    const maxInstances = this.simulationParams.maxSegments;

    this.straightInstancer = new StraightPipeInstancer(
      createStraightPipeGeometry(this.pipeParams.pipeOuterSize, this.pipeParams.pipeWallThickness),
      material,
      maxInstances,
    );
    this.cornerInstancer = new MiterCornerInstancer(
      createMiterCornerGeometry(this.pipeParams.pipeOuterSize, this.pipeParams.pipeWallThickness),
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
    });

    this.straightInstancer.setMatrices(meshData.straightMatrices);
    this.cornerInstancer.setMatrices(meshData.cornerMatrices);
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
    const maxFronts = document.getElementById('max-fronts');
    const maxFrontsValue = document.getElementById('max-fronts-value');
    const initialLoop = document.getElementById('initial-loop');
    const initialLoopValue = document.getElementById('initial-loop-value');
    const risePerSide = document.getElementById('rise-per-side');
    const risePerSideValue = document.getElementById('rise-per-side-value');
    const pipeOuterSize = document.getElementById('pipe-outer-size');
    const pipeOuterSizeValue = document.getElementById('pipe-outer-size-value');
    const pipeWallThickness = document.getElementById('pipe-wall-thickness');
    const pipeWallThicknessValue = document.getElementById('pipe-wall-thickness-value');
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
      !(maxFronts instanceof HTMLInputElement) ||
      !(maxFrontsValue instanceof HTMLSpanElement) ||
      !(initialLoop instanceof HTMLInputElement) ||
      !(initialLoopValue instanceof HTMLSpanElement) ||
      !(risePerSide instanceof HTMLInputElement) ||
      !(risePerSideValue instanceof HTMLSpanElement) ||
      !(pipeOuterSize instanceof HTMLInputElement) ||
      !(pipeOuterSizeValue instanceof HTMLSpanElement) ||
      !(pipeWallThickness instanceof HTMLInputElement) ||
      !(pipeWallThicknessValue instanceof HTMLSpanElement) ||
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
      maxFronts,
      maxFrontsValue,
      initialLoop,
      initialLoopValue,
      risePerSide,
      risePerSideValue,
      pipeOuterSize,
      pipeOuterSizeValue,
      pipeWallThickness,
      pipeWallThicknessValue,
      iridescenceStrength,
      iridescenceStrengthValue,
      hueBandFrequency,
      hueBandFrequencyValue,
    };
  }

  private setupUi(): void {
    this.ui.seed.value = String(this.simulationParams.seed);

    this.bindRange(this.ui.growthRate, this.ui.growthRateValue, (value) => `${Math.round(value)}`, (value) => {
      this.setSimulationParams({ segmentsPerStep: Math.round(value) });
    });

    this.bindRange(this.ui.branchChance, this.ui.branchChanceValue, (value) => value.toFixed(2), (value) => {
      this.setSimulationParams({ branchChance: value });
      this.reset();
    });

    this.bindRange(this.ui.maxFronts, this.ui.maxFrontsValue, (value) => `${Math.round(value)}`, (value) => {
      this.setSimulationParams({ maxActiveFronts: Math.round(value) });
      this.reset();
    });

    this.bindRange(this.ui.initialLoop, this.ui.initialLoopValue, (value) => `${Math.round(value)}`, (value) => {
      this.setSimulationParams({ initialLoopSize: Math.round(value) });
      this.reset();
    });

    this.bindRange(this.ui.risePerSide, this.ui.risePerSideValue, (value) => `${Math.round(value)}`, (value) => {
      this.setSimulationParams({ risePerSide: Math.round(value) });
      this.reset();
    });

    this.bindRange(this.ui.pipeOuterSize, this.ui.pipeOuterSizeValue, (value) => value.toFixed(2), (value) => {
      this.setPipeParams({ pipeOuterSize: value });
    });

    this.bindRange(this.ui.pipeWallThickness, this.ui.pipeWallThicknessValue, (value) => value.toFixed(2), (value) => {
      this.setPipeParams({ pipeWallThickness: value });
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
      maxActiveFronts: MathUtils.clamp(Math.round(params.maxActiveFronts), 1, 512),
      initialLoopSize: MathUtils.clamp(Math.round(params.initialLoopSize), 2, 256),
      risePerSide: MathUtils.clamp(Math.round(params.risePerSide), 0, 16),
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
