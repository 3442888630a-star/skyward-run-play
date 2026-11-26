// Boot and fixed-timestep 60 Hz game loop for Skyward Run.
// Wires 3D WebGL renderer, 2D cockpit HUD, keyboard/mouse input, WebAudio, and ?shot= scenes.

import { BEST_KEY, MODE_MISSION, STEP } from './config.js';
import { createRandom } from './random.js';
import { createRenderer3D } from './render3d.js';
import { createHudRenderer, SCREEN_HELP, SCREEN_OVER, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE } from './hud.js';
import {
  ACTION_CAM,
  ACTION_CONFIRM,
  ACTION_HELP,
  ACTION_MUTE,
  ACTION_PAUSE,
  createInput,
} from './input.js';
import { createAudio } from './audio.js';
import {
  createWorld,
  EVENT_CRASH,
  EVENT_LOW_FUEL,
  EVENT_OVER,
  EVENT_RING,
  EVENT_STALL,
  EVENT_TOUCHDOWN,
  EVENT_WIN,
  OUTCOME_WIN,
} from './world.js';
import { stageShot } from './shots.js';

const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : 1;

const glCanvas = document.getElementById('game');
const hudCanvas = document.getElementById('hud');
const statusEl = document.getElementById('status');

const random = createRandom(seed);
const world = createWorld();
const renderer3D = createRenderer3D(glCanvas, random);
const hud = createHudRenderer(hudCanvas);

function readBest() {
  try {
    return Number.parseInt(window.localStorage.getItem(BEST_KEY) ?? '0', 10) || 0;
  } catch {
    return 0;
  }
}

function saveBest(value) {
  try {
    window.localStorage.setItem(BEST_KEY, String(value));
  } catch {
    // Ignore when storage is blocked
  }
}

function runShot(name) {
  const scene = stageShot(name, world);
  let painted = 0;
  function paint() {
    renderer3D.render(world.state, scene.screen === SCREEN_TITLE, painted === 0);
    hud.draw(world.state, scene.screen, {
      best: scene.best,
      selectedMode: MODE_MISSION,
      muted: false,
      invertPitch: false,
      mouseYoke: false,
    });
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(hudCanvas);
  const audio = createAudio();
  let screen = SCREEN_TITLE;
  let screenBeforeHelp = SCREEN_TITLE;
  let selectedMode = MODE_MISSION;
  let best = readBest();
  let accumulator = 0;
  let last = performance.now();

  function announce(msg) {
    statusEl.textContent = msg;
  }

  function startFlight(mode = selectedMode) {
    selectedMode = mode;
    world.reset(mode);
    renderer3D.resetCamera(world.state.plane);
    accumulator = 0;
    screen = SCREEN_PLAY;
    announce(mode === MODE_MISSION ? 'Mission started. Fly through Ring 1.' : 'Free flight started.');
  }

  function handleButton(btnId) {
    if (!btnId) return;
    audio.unlock();
    if (btnId === 'mode-mission') {
      selectedMode = 'mission';
    } else if (btnId === 'mode-free') {
      selectedMode = 'free';
    } else if (btnId === 'btn-start') {
      startFlight(selectedMode);
    } else if (btnId === 'btn-pause') {
      if (screen === SCREEN_PLAY) {
        screen = SCREEN_PAUSED;
        announce('Paused.');
      } else if (screen === SCREEN_PAUSED) {
        screen = SCREEN_PLAY;
        announce('Playing.');
      }
    } else if (btnId === 'btn-resume') {
      screen = SCREEN_PLAY;
      announce('Playing.');
    } else if (btnId === 'btn-help') {
      if (screen !== SCREEN_HELP) {
        screenBeforeHelp = screen;
        screen = SCREEN_HELP;
      }
    } else if (btnId === 'btn-close-help') {
      screen = screenBeforeHelp;
    } else if (btnId === 'btn-mute') {
      audio.toggleMute();
    } else if (btnId === 'btn-yoke') {
      input.setMouseYoke(!input.isMouseYoke());
    } else if (btnId === 'btn-invert') {
      input.toggleInvertPitch();
    } else if (btnId === 'btn-restart') {
      startFlight(selectedMode);
    } else if (btnId === 'btn-title') {
      world.reset(selectedMode);
      renderer3D.resetCamera(world.state.plane);
      screen = SCREEN_TITLE;
      announce('Skyward Run title screen.');
    }
  }

  function handleActions() {
    const actions = input.takeActions();
    const click = input.takeClick();
    if (actions || click) audio.unlock();

    if (click) {
      const hit = hud.hitTest(click.x, click.y);
      if (hit) handleButton(hit);
    }

    if (actions & ACTION_MUTE) {
      audio.toggleMute();
    }
    if (actions & ACTION_CAM) {
      world.state.camMode = (world.state.camMode + 1) % 2;
    }
    if (actions & ACTION_HELP) {
      if (screen === SCREEN_HELP) {
        screen = screenBeforeHelp;
      } else {
        screenBeforeHelp = screen;
        screen = SCREEN_HELP;
      }
      return;
    }
    if (actions & ACTION_PAUSE) {
      if (screen === SCREEN_HELP) {
        screen = screenBeforeHelp;
      } else if (screen === SCREEN_PLAY) {
        screen = SCREEN_PAUSED;
        announce('Paused.');
      } else if (screen === SCREEN_PAUSED) {
        screen = SCREEN_PLAY;
        announce('Playing.');
      }
      return;
    }
    if (actions & ACTION_CONFIRM) {
      if (screen === SCREEN_TITLE || screen === SCREEN_OVER) {
        startFlight(selectedMode);
      } else if (screen === SCREEN_PAUSED) {
        screen = SCREEN_PLAY;
      }
    }
  }

  function stepSim() {
    if (screen === SCREEN_TITLE) {
      world.step(STEP, null, true);
      return;
    }
    const events = world.step(STEP, input.flightControls(), false);
    if (events & EVENT_RING) {
      audio.playRing(world.state.ringsPassed);
      announce(`Ring ${world.state.ringsPassed} of 8 cleared.`);
    }
    if (events & EVENT_STALL) audio.playStall();
    if (events & EVENT_LOW_FUEL) audio.playLowFuel();
    if (events & EVENT_TOUCHDOWN) audio.playTouchdown();
    if (events & EVENT_WIN) audio.playWin();
    if (events & EVENT_CRASH) audio.playCrash();

    if (events & EVENT_OVER) {
      screen = SCREEN_OVER;
      if (world.state.outcome === OUTCOME_WIN && world.state.scoreBreakdown.total > best) {
        best = world.state.scoreBreakdown.total;
        saveBest(best);
      }
      announce(
        world.state.outcome === OUTCOME_WIN
          ? `Mission complete! Score ${world.state.scoreBreakdown.total}.`
          : `Flight ended: ${world.state.failReason}.`,
      );
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;

    handleActions();

    if (screen === SCREEN_TITLE || screen === SCREEN_PLAY) {
      while (accumulator >= STEP && (screen === SCREEN_TITLE || screen === SCREEN_PLAY)) {
        stepSim();
        accumulator -= STEP;
      }
    } else {
      accumulator = 0;
    }

    const st = world.state;
    audio.updateFlight(
      screen === SCREEN_PLAY,
      st.plane.throttle,
      st.plane.speed,
      st.plane.fuel > 0 || st.mode === 'free',
      st.plane.isStalling,
    );

    const hoverId = hud.hitTest(input.pointer.x, input.pointer.y);
    renderer3D.render(st, screen === SCREEN_TITLE, false);
    hud.draw(st, screen, {
      best,
      selectedMode,
      hoverId,
      muted: audio.isMuted(),
      invertPitch: input.isInvertPitch(),
      mouseYoke: input.isMouseYoke(),
    });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      announce('Paused.');
    }
  });

  announce('Skyward Run. Press Space or click Take Off to fly.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
