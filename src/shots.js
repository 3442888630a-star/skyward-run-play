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
    // Mid-flight shot banking over Mirror Lake & Emerald Forest approaching Ring 5
    st.ringsPassed = 4;
    st.ringScore = 1380;
    st.missionTime = 148.0;
    p.fuel = 66;
    p.pos.x = 1280;
    p.pos.y = 185;
    p.pos.z = -2420;
    p.speed = 46;
    p.throttle = 0.68;
    world.setBasisFromHeadingPitchRoll(2.55, 0.02, 0.24);
    p.vel.x = p.forward.x * p.speed;
    p.vel.y = p.forward.y * p.speed;
    p.vel.z = p.forward.z * p.speed;
    p.verticalSpeed = p.vel.y;
    for (let i = 0; i < Math.round(6.5 / STEP); i += 1) {
      world.step(STEP, autopilotTo(p, MISSION_RINGS[4], 46), false);
      const r5 = MISSION_RINGS[4];
      if (Math.hypot(p.pos.x - r5.x, p.pos.y - r5.y, p.pos.z - r5.z) < 95) break;
    }
    st.toastText = 'Mirror Lake Cleared — Approaching Emerald Forest';
    st.toastTimer = 2.4;
    return { screen: SCREEN_PLAY, best: st.ringScore };
  }

  if (name === 'approach') {
    // Final approach lined up with Runway 36 after clearing all 8 rings
    st.ringsPassed = MISSION_RINGS.length;
    st.ringScore = 2940;
    st.missionTime = 98.4;
    p.fuel = 44;
    p.pos.x = 4;
    p.pos.y = 52;
    p.pos.z = 590;
    p.speed = 32; // ~62 kts approach speed
    p.throttle = 0.35;
    world.setBasisFromHeadingPitchRoll(-0.02, -0.05, -0.03);
    p.vel.x = p.forward.x * p.speed;
    p.vel.y = -1.9;
    p.vel.z = p.forward.z * p.speed;
    p.verticalSpeed = -1.9;
    st.toastText = 'All 8 Rings Cleared! Land gently on Runway 36';
    st.toastTimer = 3.0;
    return { screen: SCREEN_PLAY, best: 2940 };
  }

  if (name === 'end') {
    // Completed mission parked cleanly on Runway 36 at golden hour
    st.ringsPassed = MISSION_RINGS.length;
    st.ringScore = 2980;
    st.missionTime = 114.2;
    p.fuel = 42;
    p.pos.x = 1.5;
    p.pos.y = RUNWAY.elevation + RUNWAY.gearClearance;
    p.pos.z = 72;
    p.speed = 0;
    p.throttle = 0;
    p.onGround = true;
    p.landingGrade = 'BUTTER';
    world.setBasisFromHeadingPitchRoll(0.01, 0.01, 0);
    st.outcome = 'win';
    st.scoreBreakdown.rings = 2980;
    st.scoreBreakdown.time = 740;
    st.scoreBreakdown.fuel = 504;
    st.scoreBreakdown.landing = 1000;
    st.scoreBreakdown.total = 5224;
    return { screen: SCREEN_OVER, best: 5224 };
  }

  // Default: 'start' title screen scenic golden-hour cruise
  for (let i = 0; i < Math.round(3.5 / STEP); i += 1) {
    world.step(STEP, null, true);
  }
  return { screen: SCREEN_TITLE, best: 5224 };
}
