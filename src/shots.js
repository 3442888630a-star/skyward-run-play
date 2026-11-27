// Deterministic screenshot scenes behind ?shot=start|play|approach|end.
// Each scene stages the real flight world and plane kinematics so every screenshot
// reflects authentic gameplay at golden hour.

import { MISSION_RINGS, MODE_MISSION, RUNWAY, STEP } from './config.js';
import { clamp, wrapAngle } from './math.js';
import { SCREEN_OVER, SCREEN_PLAY, SCREEN_TITLE } from './hud.js';

/** Simple autopilot steering the plane toward a target 3D point. */
function autopilotTo(plane, target, desiredSpeed = 44) {
  const dx = target.x - plane.pos.x;
  const dy = target.y - plane.pos.y;
  const dz = target.z - plane.pos.z;
  const distH = Math.hypot(dx, dz) || 1;
  const targetHeading = Math.atan2(dx, -dz);
  const hdgErr = wrapAngle(targetHeading - plane.heading);
  const targetBank = clamp(hdgErr * 1.4, -0.55, 0.55);
  const rollCmd = clamp((targetBank - plane.roll) * 2.2, -1, 1);

  const targetPitch = clamp(Math.atan2(dy, distH) + 0.04, -0.25, 0.25);
  const pitchCmd = clamp((targetPitch - plane.pitch) * 3.0, -1, 1);
  const yawCmd = clamp(hdgErr * 0.8, -0.5, 0.5);
  const throttleDelta = clamp((desiredSpeed - plane.speed) * 0.15, -1, 1);

  return { pitch: pitchCmd, roll: rollCmd, yaw: yawCmd, throttleDelta, brake: false };
}

export function stageShot(name, world) {
  world.reset(MODE_MISSION);
  const st = world.state;
  const p = st.plane;

  if (name === 'play') {
    // Mid-flight over snow mountain ranges toward sunset with active combo multiplier
    st.camMode = 0;
    st.ringsPassed = 3;
    st.ringScore = 1550;
    st.ringCombo = 3;
    st.maxCombo = 3;
    st.comboMult = 2;
    st.perfectRings = 2;
    st.goodRings = 1;
    st.missionTime = 164.0;
    p.fuel = 64;
    p.pos.x = -1820;
    p.pos.y = 685;
    p.pos.z = -1520;
    p.speed = 46;
    p.throttle = 0.68;
    world.setBasisFromHeadingPitchRoll(-0.88, 0.02, -0.18);
    p.vel.x = p.forward.x * p.speed;
    p.vel.y = p.forward.y * p.speed;
    p.vel.z = p.forward.z * p.speed;
    p.verticalSpeed = p.vel.y;
    for (let i = 0; i < Math.round(1.4 / STEP); i += 1) {
      world.step(STEP, { pitch: 0.06, roll: -0.10, yaw: 0, throttleDelta: 0, brake: false }, false);
    }
    st.toastText = 'West Crags & Wetland Cleared — En route to Mirror Lake';
    st.toastTimer = 2.6;
    return { screen: SCREEN_PLAY, best: st.ringScore };
  }

  if (name === 'approach') {
    // Low pass beside the waterfall / northern lake outlet at golden hour in approach-phase HUD
    st.camMode = 0;
    st.ringsPassed = MISSION_RINGS.length;
    st.ringScore = 5850;
    st.ringCombo = 8;
    st.maxCombo = 8;
    st.comboMult = 3;
    st.perfectRings = 6;
    st.goodRings = 2;
    st.missionTime = 332.4;
    p.fuel = 31;
    p.pos.x = 74;
    p.pos.y = 28;
    p.pos.z = -1010;
    p.speed = 34; // ~66 kts approach speed
    p.throttle = 0.36;
    world.setBasisFromHeadingPitchRoll(0.32, -0.07, -0.15);
    p.vel.x = p.forward.x * p.speed;
    p.vel.y = -1.7;
    p.vel.z = p.forward.z * p.speed;
    p.verticalSpeed = -1.7;
    st.toastText = 'All 8 Rings Cleared! Pass Mirror Lake Falls for RWY 36';
    st.toastTimer = 3.2;
    return { screen: SCREEN_PLAY, best: 5850 };
  }

  if (name === 'end') {
    // Completed mission parked cleanly on Runway 36 at golden hour
    st.camMode = 0;
    st.ringsPassed = MISSION_RINGS.length;
    st.ringScore = 6600;
    st.ringCombo = 8;
    st.maxCombo = 8;
    st.comboMult = 3;
    st.perfectRings = 6;
    st.goodRings = 2;
    st.grazeRings = 0;
    st.missionTime = 368.4;
    p.fuel = 28;
    p.pos.x = 1.5;
    p.pos.y = RUNWAY.elevation + RUNWAY.gearClearance;
    p.pos.z = 72;
    p.speed = 0;
    p.throttle = 0;
    p.vel.x = 0;
    p.vel.y = 0;
    p.vel.z = 0;
    p.verticalSpeed = 0;
    p.onGround = true;
    p.touchdownSink = 0.68;
    p.touchdownOffset = 1.4;
    p.landingGrade = 'BUTTER';
    p.glideslopeGrade = 'ON GLIDESLOPE (A)';
    p.glideslopeDeg = 0.4;
    world.setBasisFromHeadingPitchRoll(0.01, 0.01, 0);
    st.outcome = 'win';
    st.scoreBreakdown.rings = 6600;
    st.scoreBreakdown.time = 394;
    st.scoreBreakdown.fuel = 336;
    st.scoreBreakdown.landing = 1000;
    st.scoreBreakdown.total = 8330;
    return { screen: SCREEN_OVER, best: 8330 };
  }

  // Default: 'start' hero cover shot — cockpit view INSIDE the canyon facing Ring 6 + sunset
  st.camMode = 2;
  st.ringsPassed = 6;
  st.ringScore = 3600;
  st.ringCombo = 6;
  st.maxCombo = 6;
  st.comboMult = 3;
  st.missionTime = 248.5;
  p.fuel = 58;
  p.pos.x = 468;
  p.pos.y = -36;
  p.pos.z = 340;
  p.speed = 46;
  p.throttle = 0.68;
  world.setBasisFromHeadingPitchRoll(-0.11, -0.06, 0.06);
  p.vel.x = p.forward.x * p.speed;
  p.vel.y = p.forward.y * p.speed;
  p.vel.z = p.forward.z * p.speed;
  p.verticalSpeed = p.vel.y;
  st.lastControls = { pitch: -0.08, roll: 0.14, yaw: 0 };
  st.elapsed = 1.2;
  return { screen: SCREEN_TITLE, best: 8330 };
}
