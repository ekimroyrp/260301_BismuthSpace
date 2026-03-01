import './style.css';
import { createBismuthFormsApp } from './app/createBismuthFormsApp';

function revealUiWhenStyled(maxWaitMs = 1500): void {
  const start = performance.now();
  const tryReveal = (): void => {
    const styled = getComputedStyle(document.documentElement).getPropertyValue('--ui-size-scale').trim().length > 0;
    if (styled || performance.now() - start >= maxWaitMs) {
      document.documentElement.classList.add('ui-ready');
      return;
    }
    requestAnimationFrame(tryReveal);
  };
  tryReveal();
}

const canvas = document.querySelector<HTMLCanvasElement>('#app-canvas');
if (!canvas) {
  throw new Error('Canvas element #app-canvas was not found.');
}

revealUiWhenStyled();

const app = createBismuthFormsApp(canvas);
Object.assign(window, { bismuthFormsApp: app });
