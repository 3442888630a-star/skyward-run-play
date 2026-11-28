// Boot and fixed-timestep 60 Hz game loop for Skyward Run.
// Wires 3D WebGL renderer, 2D cockpit HUD, keyboard/mouse input, WebAudio, and ?shot= scenes.

import { BEST_KEY, MISSION_RINGS, MODE_MISSION, RUNWAY, STEP } from './config.js';
import { clamp, wrapAngle } from './math.js';
import { terrainHeight } from './terrain.js';
import { createRandom } from './random.js';
import { createRenderer3D } from './render3d.js';
import { createHudRenderer, SCREEN_HELP, SCREEN_OVER, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE } from './hud.js';
import {
  ACTION_CAM,
  ACTION_COCKPIT,
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
  OUTCOME_NONE,
  OUTCOME_WIN,
} from './world.js';
import { autopilotTo, stageShot } from './shots.js';

const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const verify = params.get('verify');
const shotTimeParam = Number.parseFloat(params.get('t') ?? '');
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
  if (Number.isFinite(shotTimeParam)) {
    world.state.elapsed = shotTimeParam;
  }
  let painted = 0;
  function paint() {
    renderer3D.render(world.state, scene.screen === SCREEN_TITLE, painted === 0);
    hud.draw(world.state, scene.screen, {
      best: scene.best,
      selectedMode: MODE_MISSION,
      muted: false,
      invertPitch: false,
      mouseYoke: false,
      cam: renderer3D.getCamera(),
    });
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  renderer3D.ready.then(() => {
    requestAnimationFrame(paint);
  });
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
      if (world.state.camMode === 2) {
        world.state.camMode = world.state.lastChaseMode || 0;
      } else {
        world.state.camMode = world.state.camMode === 1 ? 0 : 1;
        world.state.lastChaseMode = world.state.camMode;
      }
    }
    if (actions & ACTION_COCKPIT) {
      if (world.state.camMode === 2) {
        world.state.camMode = world.state.lastChaseMode || 0;
      } else {
        world.state.lastChaseMode = world.state.camMode;
        world.state.camMode = 2;
      }
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
      audio.playRing(
        world.state.ringsPassed,
        world.state.comboMult,
        world.state.lastRingGrade === 'PERFECT',
      );
      announce(`Ring ${world.state.ringsPassed} of 8 cleared (${world.state.lastRingGrade}).`);
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
      cam: renderer3D.getCamera(),
    });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      announce('Paused.');
    }
  });

  announce('Skyward Run. Press Space or click Take Off to fly.');
  Promise.race([
    renderer3D.ready,
    new Promise((resolve) => setTimeout(resolve, 6000)),
  ]).then(() => {
    last = performance.now();
    requestAnimationFrame(frame);
  });
}

function runAutopilotVerify() {
  const MAX_SIM_SECONDS = 900;
  const STEPS_PER_FRAME = 2400;
  let wpStage = 0;

  function safeTarget(p, wp, clearance = 35) {
    let maxH = -999;
    for (const d of [60, 140, 240]) {
      maxH = Math.max(maxH, terrainHeight(p.pos.x + p.forward.x * d, p.pos.z + p.forward.z * d));
    }
    return { x: wp.x, y: Math.max(wp.y, maxH + clearance), z: wp.z };
  }

  function computeVerifyControls(st) {
    const p = st.plane;
    if (st.ringsPassed < MISSION_RINGS.length) {
      const ring = MISSION_RINGS[st.ringsPassed];
      if (st.ringsPassed === 5) {
        if (wpStage < 1) {
          const wp = { x: 2410, y: 175, z: -340 };
          if (Math.hypot(p.pos.x - wp.x, p.pos.z - wp.z) < 160) wpStage = 1;
          else return autopilotTo(p, wp, 44);
        }
      } else if (st.ringsPassed === 6) {
        if (wpStage < 2) {
          const wp = { x: 2100, y: 155, z: 600 };
          if (Math.hypot(p.pos.x - wp.x, p.pos.z - wp.z) < 160) wpStage = 2;
          else return autopilotTo(p, wp, 44);
        }
        if (wpStage < 3) {
          const wp = { x: 1900, y: 170, z: 800 };
          if (Math.hypot(p.pos.x - wp.x, p.pos.z - wp.z) < 160) wpStage = 3;
          else return autopilotTo(p, wp, 44);
        }
        if (wpStage < 4) {
          const wp = { x: 1650, y: 185, z: 1050 };
          if (Math.hypot(p.pos.x - wp.x, p.pos.z - wp.z) < 200) wpStage = 4;
          else return autopilotTo(p, safeTarget(p, wp), 44);
        }
        if (wpStage < 5) {
          const wp = { x: 447, y: 160, z: 980 };
          if (Math.hypot(p.pos.x - wp.x, p.pos.z - wp.z) < 220) wpStage = 5;
          else return autopilotTo(p, safeTarget(p, wp), 42);
        }
        if (wpStage < 6) {
          const wp = { x: 447, y: -45, z: 480 };
          if (Math.hypot(p.pos.x - wp.x, p.pos.z - wp.z) < 160) wpStage = 6;
          else return autopilotTo(p, wp, 38);
        }
      } else if (st.ringsPassed === 7) {
        if (wpStage < 7) {
          const wp = { x: 447, y: 120, z: -260 };
          if (Math.hypot(p.pos.x - wp.x, p.pos.z - wp.z) < 160) wpStage = 7;
          else return autopilotTo(p, wp, 44);
        }
        if (wpStage < 8) {
          const wp = { x: 0, y: 130, z: 1520 };
          if (Math.hypot(p.pos.x - wp.x, p.pos.z - wp.z) < 220) wpStage = 8;
          else return autopilotTo(p, safeTarget(p, wp), 44);
        }
      }
      const dist = Math.hypot(ring.x - p.pos.x, ring.z - p.pos.z);
      return autopilotTo(p, ring, dist < 350 ? 40 : 46);
    }

    if (p.onGround) {
      const hdgErr = wrapAngle(0 - p.heading);
      return {
        pitch: 0,
        roll: clamp(-p.roll * 2.0, -1, 1),
        yaw: clamp(hdgErr * 1.2, -0.5, 0.5),
        throttleDelta: -1,
        brake: true,
      };
    }

    const rwySurfaceY = RUNWAY.elevation + RUNWAY.gearClearance;
    const agl = p.pos.y - rwySurfaceY;
    if (p.pos.z > 320 || agl > 5.5) {
      const targetY = rwySurfaceY + Math.max(2.0, (p.pos.z - 220) * 0.09);
      return autopilotTo(p, { x: 0, y: targetY, z: 160 }, 29);
    }

    const hdgErr = wrapAngle(-p.pos.x * 0.015 - p.heading);
    const targetVelY = clamp(-0.62 - agl * 0.14, -1.4, -0.55);
    const velYErr = targetVelY - p.vel.y;
    const desiredPitch = clamp(0.05 + velYErr * 0.07, -0.04, 0.14);
    return {
      pitch: clamp((desiredPitch - p.pitch) * 6.0, -1, 1),
      roll: clamp((-p.roll) * 3.0, -1, 1),
      yaw: clamp(hdgErr * 1.4, -0.5, 0.5),
      throttleDelta: clamp((27 - p.speed) * 0.2, -1, 1),
      brake: false,
    };
  }

  function finishVerify() {
    const st = world.state;
    renderer3D.render(st, false, true);
    hud.draw(st, SCREEN_PLAY, {
      best: st.scoreBreakdown.total,
      selectedMode: MODE_MISSION,
      muted: true,
      invertPitch: false,
      mouseYoke: false,
      cam: renderer3D.getCamera(),
    });
    window.__verifyResult = {
      ringsPassed: st.ringsPassed,
      ringScore: st.ringScore,
      landingGrade: st.plane.landingGrade,
      touchdownSink: st.plane.touchdownSink,
      touchdownOffset: st.plane.touchdownOffset,
      outcome: st.outcome,
      failReason: st.failReason,
      missionTime: Number(st.missionTime.toFixed(2)),
    };
    window.__verifyDone = true;
  }

  Promise.race([
    renderer3D.ready,
    new Promise((resolve) => setTimeout(resolve, 6000)),
  ]).then(() => {
    world.reset(MODE_MISSION);
    renderer3D.resetCamera(world.state.plane);
    const tick = () => {
      const st = world.state;
      for (let i = 0; i < STEPS_PER_FRAME; i += 1) {
        if (st.outcome !== OUTCOME_NONE || st.missionTime >= MAX_SIM_SECONDS) {
          finishVerify();
          return;
        }
        world.step(STEP, computeVerifyControls(st), false);
      }
      renderer3D.render(st, false, false);
      hud.draw(st, SCREEN_PLAY, {
        best: st.ringScore,
        selectedMode: MODE_MISSION,
        muted: true,
        invertPitch: false,
        mouseYoke: false,
        cam: renderer3D.getCamera(),
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

if (verify === 'autopilot') runAutopilotVerify();
else if (shot) runShot(shot);
else runGame();
