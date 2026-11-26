// Keyboard & mouse input controller: flight stick/yoke, throttle, brakes, UI buttons,
// pause, help overlay, mute, invert-pitch, and camera toggle.

import { FIELD } from './config.js';
import { clamp } from './math.js';

export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_HELP = 4;
export const ACTION_MUTE = 8;
export const ACTION_INVERT = 16;
export const ACTION_CAM = 32;
export const ACTION_MOUSE_YOKE = 64;

export function createInput(canvas) {
  const held = new Set();
  let actions = 0;
  let wheelThrottle = 0;
  let invertPitch = false;
  let mouseYokeActive = false;
  let mouseDragging = false;

  const pointer = {
    x: FIELD.width * 0.5,
    y: FIELD.height * 0.5,
    nx: 0, // normalized [-1, 1] relative to center
    ny: 0,
    clicked: false,
    clickX: 0,
    clickY: 0,
  };

  function toLogicalCoords(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const scale = Math.min(rect.width / FIELD.width, rect.height / FIELD.height) || 1;
    const ox = (rect.width - FIELD.width * scale) / 2;
    const oy = (rect.height - FIELD.height * scale) / 2;
    const lx = (clientX - rect.left - ox) / scale;
    const ly = (clientY - rect.top - oy) / scale;
    pointer.x = lx;
    pointer.y = ly;
    pointer.nx = clamp((lx - FIELD.width * 0.5) / (FIELD.width * 0.36), -1, 1);
    pointer.ny = clamp((ly - FIELD.height * 0.5) / (FIELD.height * 0.36), -1, 1);
  }

  window.addEventListener('keydown', (e) => {
    const code = e.code;
    if (
      code === 'ArrowUp' ||
      code === 'ArrowDown' ||
      code === 'ArrowLeft' ||
      code === 'ArrowRight' ||
      code === 'Space'
    ) {
      e.preventDefault();
    }
    held.add(code);
    if (!e.repeat) {
      if (code === 'Space' || code === 'Enter') actions |= ACTION_CONFIRM;
      else if (code === 'KeyP' || code === 'Escape') actions |= ACTION_PAUSE;
      else if (code === 'KeyH' || code === 'Slash') actions |= ACTION_HELP;
      else if (code === 'KeyM') actions |= ACTION_MUTE;
      else if (code === 'KeyI') {
        invertPitch = !invertPitch;
        actions |= ACTION_INVERT;
      } else if (code === 'KeyC') actions |= ACTION_CAM;
      else if (code === 'KeyU') {
        mouseYokeActive = !mouseYokeActive;
        actions |= ACTION_MOUSE_YOKE;
      }
    }
  });

  window.addEventListener('keyup', (e) => {
    held.delete(e.code);
  });

  window.addEventListener('blur', () => {
    held.clear();
    mouseDragging = false;
  });

  window.addEventListener('pointermove', (e) => {
    toLogicalCoords(e.clientX, e.clientY);
  });

  window.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    toLogicalCoords(e.clientX, e.clientY);
    mouseDragging = true;
    pointer.clicked = true;
    pointer.clickX = pointer.x;
    pointer.clickY = pointer.y;
  });

  window.addEventListener('pointerup', () => {
    mouseDragging = false;
  });

  window.addEventListener(
    'wheel',
    (e) => {
      wheelThrottle += e.deltaY < 0 ? 0.08 : -0.08;
    },
    { passive: true },
  );

  function flightControls() {
    const pitchUp = held.has('KeyS') || held.has('ArrowDown');
    const pitchDown = held.has('KeyW') || held.has('ArrowUp');
    const rollLeft = held.has('KeyA') || held.has('ArrowLeft');
    const rollRight = held.has('KeyD') || held.has('ArrowRight');
    const yawLeft = held.has('KeyQ');
    const yawRight = held.has('KeyE');
    const thrUp = held.has('ShiftLeft') || held.has('ShiftRight') || held.has('KeyR') || held.has('Equal');
    const thrDown = held.has('KeyX') || held.has('KeyF') || held.has('Minus');
    const brake = held.has('KeyB');

    let pitch = (pitchUp ? 1 : 0) - (pitchDown ? 1 : 0);
    if (invertPitch) pitch = -pitch;

    let roll = (rollRight ? 1 : 0) - (rollLeft ? 1 : 0);
    const yaw = (yawRight ? 1 : 0) - (yawLeft ? 1 : 0);

    if (mouseYokeActive || mouseDragging) {
      const dead = 0.06;
      const mx = Math.abs(pointer.nx) > dead ? pointer.nx : 0;
      const my = Math.abs(pointer.ny) > dead ? pointer.ny : 0;
      if (roll === 0) roll = clamp(mx * 1.15, -1, 1);
      if (pitch === 0) {
        const mPitch = invertPitch ? -my : my;
        pitch = clamp(mPitch * 1.15, -1, 1);
      }
    }

    let throttleDelta = (thrUp ? 1 : 0) - (thrDown ? 1 : 0);
    if (Math.abs(wheelThrottle) > 0.001) {
      throttleDelta += wheelThrottle * 12;
      wheelThrottle = 0;
    }

    return {
      pitch: clamp(pitch, -1, 1),
      roll: clamp(roll, -1, 1),
      yaw: clamp(yaw, -1, 1),
      throttleDelta: clamp(throttleDelta, -3, 3),
      brake,
    };
  }

  function takeActions() {
    const taken = actions;
    actions = 0;
    return taken;
  }

  function takeClick() {
    if (!pointer.clicked) return null;
    pointer.clicked = false;
    return { x: pointer.clickX, y: pointer.clickY };
  }

  return {
    flightControls,
    takeActions,
    takeClick,
    pointer,
    isInvertPitch: () => invertPitch,
    toggleInvertPitch: () => {
      invertPitch = !invertPitch;
      return invertPitch;
    },
    isMouseYoke: () => mouseYokeActive || mouseDragging,
    setMouseYoke: (v) => {
      mouseYokeActive = Boolean(v);
    },
  };
}
