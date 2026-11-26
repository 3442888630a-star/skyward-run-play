// Flight simulation & game rules: 3D orientation, aerodynamics, stall, fuel burn,
// 8-ring course progression, terrain/water collisions, and Runway 36 landing grading.

import { MISSION_RINGS, MODE_FREE, MODE_MISSION, PLANE, RUNWAY, SCORING, WORLD } from './config.js';
import { clamp, cross3, dot3, lerp, normalize3, rotateAroundAxis, vec3, wrapAngle } from './math.js';
import { isOnApron, isOnRunway, terrainHeight } from './terrain.js';

export const EVENT_RING = 1;
export const EVENT_STALL = 2;
export const EVENT_LOW_FUEL = 4;
export const EVENT_FUEL_OUT = 8;
export const EVENT_TOUCHDOWN = 16;
export const EVENT_CRASH = 32;
export const EVENT_WIN = 64;
export const EVENT_OVER = 128;

export const OUTCOME_NONE = 'none';
export const OUTCOME_WIN = 'win';
export const OUTCOME_CRASH = 'crash';
export const OUTCOME_FUEL = 'fuel';

export function createWorld() {
  const plane = {
    pos: vec3(PLANE.startX, PLANE.startY, PLANE.startZ),
    prevPos: vec3(PLANE.startX, PLANE.startY, PLANE.startZ),
    vel: vec3(0, 0, -PLANE.startSpeed),
    right: vec3(1, 0, 0),
    up: vec3(0, 1, 0),
    forward: vec3(0, 0, -1),
    speed: PLANE.startSpeed,
    verticalSpeed: 0,
    pitch: 0,
    roll: 0,
    heading: 0,
    throttle: PLANE.startThrottle,
    fuel: PLANE.fuelCapacity,
    isStalling: false,
    onGround: false,
    groundRollTime: 0,
    touchdownSink: 0,
    touchdownOffset: 0,
    landingGrade: '',
  };

  const state = {
    mode: MODE_MISSION,
    plane,
    ringsPassed: 0,
    ringScore: 0,
    elapsed: 0,
    missionTime: 0,
    propPhase: 0,
    camMode: 0,
    outcome: OUTCOME_NONE,
    failReason: '',
    scoreBreakdown: {
      rings: 0,
      time: 0,
      fuel: 0,
      landing: 0,
      total: 0,
    },
    toastText: '',
    toastTimer: 0,
    lowFuelAlerted: false,
    fuelOutAlerted: false,
    stallCooldown: 0,
  };

  const tmpA = vec3();
  const tmpB = vec3();

  function setBasisFromHeadingPitchRoll(heading, pitch, roll) {
    const ch = Math.cos(heading);
    const sh = Math.sin(heading);
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);

    plane.forward.x = sh * cp;
    plane.forward.y = sp;
    plane.forward.z = -ch * cp;
    normalize3(plane.forward, plane.forward);

    const hRight = normalize3({ x: ch, y: 0, z: sh });
    const hUp = cross3(hRight, plane.forward, vec3());
    normalize3(hUp, hUp);

    const cr = Math.cos(roll);
    const sr = Math.sin(roll);
    plane.right.x = hRight.x * cr - hUp.x * sr;
    plane.right.y = hRight.y * cr - hUp.y * sr;
    plane.right.z = hRight.z * cr - hUp.z * sr;
    normalize3(plane.right, plane.right);

    cross3(plane.right, plane.forward, plane.up);
    normalize3(plane.up, plane.up);

    plane.pitch = pitch;
    plane.roll = roll;
    plane.heading = ((heading % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  }

  function extractAttitude() {
    plane.pitch = Math.asin(clamp(plane.forward.y, -1, 1));
    const h = Math.atan2(plane.forward.x, -plane.forward.z);
    plane.heading = ((h % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

    const horizLen = Math.hypot(plane.forward.x, plane.forward.z);
    if (horizLen > 0.04) {
      const hRight = normalize3({ x: -plane.forward.z, y: 0, z: plane.forward.x }, tmpA);
      const hUp = cross3(hRight, plane.forward, tmpB);
      normalize3(hUp, hUp);
      plane.roll = Math.atan2(-dot3(plane.right, hUp), dot3(plane.right, hRight));
    }
  }

  function reset(mode = state.mode) {
    state.mode = mode;
    plane.pos.x = PLANE.startX;
    plane.pos.y = PLANE.startY;
    plane.pos.z = PLANE.startZ;
    plane.prevPos.x = PLANE.startX;
    plane.prevPos.y = PLANE.startY;
    plane.prevPos.z = PLANE.startZ;
    setBasisFromHeadingPitchRoll(PLANE.startHeading, -0.02, 0);
    plane.speed = PLANE.startSpeed;
    plane.vel.x = plane.forward.x * plane.speed;
    plane.vel.y = plane.forward.y * plane.speed;
    plane.vel.z = plane.forward.z * plane.speed;
    plane.verticalSpeed = plane.vel.y;
    plane.throttle = PLANE.startThrottle;
    plane.fuel = PLANE.fuelCapacity;
    plane.isStalling = false;
    plane.onGround = false;
    plane.groundRollTime = 0;
    plane.touchdownSink = 0;
    plane.touchdownOffset = 0;
    plane.landingGrade = '';

    state.ringsPassed = 0;
    state.ringScore = 0;
    state.elapsed = 0;
    state.missionTime = 0;
    state.propPhase = 0;
    state.outcome = OUTCOME_NONE;
    state.failReason = '';
    state.scoreBreakdown.rings = 0;
    state.scoreBreakdown.time = 0;
    state.scoreBreakdown.fuel = 0;
    state.scoreBreakdown.landing = 0;
    state.scoreBreakdown.total = 0;
    state.toastText = mode === MODE_MISSION ? 'Fly through Ring 1: Valley Gate' : 'Free Flight — Practice flying & Runway 36 landings';
    state.toastTimer = 3.8;
    state.lowFuelAlerted = false;
    state.fuelOutAlerted = false;
    state.stallCooldown = 0;
  }

  function setToast(msg, seconds = 2.6) {
    state.toastText = msg;
    state.toastTimer = seconds;
  }

  /** Check segment-to-ring capture so high-speed flythroughs never miss. */
  function checkRingPass() {
    if (state.mode !== MODE_MISSION || state.ringsPassed >= MISSION_RINGS.length) return false;
    const ring = MISSION_RINGS[state.ringsPassed];
    const rx = Math.sin(ring.heading);
    const rz = -Math.cos(ring.heading);

    const dPrev = (plane.prevPos.x - ring.x) * rx + (plane.prevPos.z - ring.z) * rz;
    const dCurr = (plane.pos.x - ring.x) * rx + (plane.pos.z - ring.z) * rz;

    // Crossed plane or within sphere capture
    let minDist = Math.hypot(plane.pos.x - ring.x, plane.pos.y - ring.y, plane.pos.z - ring.z);
    if ((dPrev <= 0 && dCurr >= 0) || (dPrev >= 0 && dCurr <= 0)) {
      const frac = clamp(Math.abs(dPrev) / (Math.abs(dPrev) + Math.abs(dCurr) + 1e-6), 0, 1);
      const ix = lerp(plane.prevPos.x, plane.pos.x, frac);
      const iy = lerp(plane.prevPos.y, plane.pos.y, frac);
      const iz = lerp(plane.prevPos.z, plane.pos.z, frac);
      minDist = Math.min(minDist, Math.hypot(ix - ring.x, iy - ring.y, iz - ring.z));
    }

    if (minDist <= PLANE.ringPassMargin) {
      const centerFactor = clamp(1 - minDist / PLANE.ringPassMargin, 0, 1);
      const pts = Math.round(SCORING.ringBase + SCORING.ringCenterBonus * centerFactor);
      state.ringScore += pts;
      state.ringsPassed += 1;
      if (state.ringsPassed < MISSION_RINGS.length) {
        setToast(`Ring ${state.ringsPassed}/8 Cleared (+${pts}) — Next: ${MISSION_RINGS[state.ringsPassed].label}`, 2.6);
      } else {
        setToast('All 8 Rings Cleared! Land gently on Runway 36', 4.5);
      }
      return true;
    }
    return false;
  }

  function finishMissionWin() {
    state.outcome = OUTCOME_WIN;
    const timeBonus = Math.round(
      SCORING.timeBonusMax * clamp((SCORING.timeTarget * 1.6 - state.missionTime) / (SCORING.timeTarget * 0.9), 0.1, 1),
    );
    const fuelBonus = Math.round(plane.fuel * SCORING.fuelBonusPerPct);
    const landBonus =
      plane.landingGrade === 'BUTTER'
        ? SCORING.landingButter
        : plane.landingGrade === 'SMOOTH'
          ? SCORING.landingSmooth
          : SCORING.landingFirm;
    state.scoreBreakdown.rings = state.ringScore;
    state.scoreBreakdown.time = timeBonus;
    state.scoreBreakdown.fuel = fuelBonus;
    state.scoreBreakdown.landing = landBonus;
    state.scoreBreakdown.total = state.ringScore + timeBonus + fuelBonus + landBonus;
  }

  function triggerCrash(reason, fuelOut = false) {
    state.outcome = fuelOut ? OUTCOME_FUEL : OUTCOME_CRASH;
    state.failReason = reason;
    plane.speed = 0;
    plane.vel.x = 0;
    plane.vel.y = 0;
    plane.vel.z = 0;
    state.scoreBreakdown.rings = state.ringScore;
    state.scoreBreakdown.time = 0;
    state.scoreBreakdown.fuel = 0;
    state.scoreBreakdown.landing = 0;
    state.scoreBreakdown.total = state.ringScore;
  }

  function rotatePlaneBasis(pitchAngle, rollAngle, yawAngle) {
    if (Math.abs(rollAngle) > 1e-6) {
      rotateAroundAxis(plane.right, plane.forward, rollAngle, tmpA);
      Object.assign(plane.right, tmpA);
      rotateAroundAxis(plane.up, plane.forward, rollAngle, tmpA);
      Object.assign(plane.up, tmpA);
    }
    if (Math.abs(pitchAngle) > 1e-6) {
      rotateAroundAxis(plane.forward, plane.right, pitchAngle, tmpA);
      // Prevent vertical flip
      if (Math.abs(tmpA.y) < 0.94) {
        Object.assign(plane.forward, tmpA);
        cross3(plane.right, plane.forward, plane.up);
      }
    }
    if (Math.abs(yawAngle) > 1e-6) {
      const worldUp = { x: 0, y: 1, z: 0 };
      rotateAroundAxis(plane.forward, worldUp, -yawAngle, tmpA);
      Object.assign(plane.forward, tmpA);
      rotateAroundAxis(plane.right, worldUp, -yawAngle, tmpA);
      Object.assign(plane.right, tmpA);
      cross3(plane.right, plane.forward, plane.up);
    }
    // Re-orthonormalize
    normalize3(plane.forward, plane.forward);
    cross3(plane.right, plane.forward, plane.up);
    normalize3(plane.up, plane.up);
    cross3(plane.forward, plane.up, plane.right);
    normalize3(plane.right, plane.right);
    extractAttitude();
  }

  /**
   * Advance one fixed simulation step.
   * `controls`: { pitch: -1..1, roll: -1..1, yaw: -1..1, throttleDelta: -1..1, brake: bool }
   * `titleDemo`: true for calm scenic auto-cruise on the title screen.
   */
  function step(dt, controls, titleDemo = false) {
    let events = 0;
    state.elapsed += dt;
    if (state.toastTimer > 0) state.toastTimer = Math.max(0, state.toastTimer - dt);
    if (state.stallCooldown > 0) state.stallCooldown = Math.max(0, state.stallCooldown - dt);

    const enginePower = plane.fuel > 0 || state.mode === MODE_FREE || titleDemo ? plane.throttle : 0;
    state.propPhase += dt * (10 + enginePower * 46 + plane.speed * 0.25);

    if (state.outcome !== OUTCOME_NONE) {
      return events;
    }

    if (titleDemo) {
      // Gentle scenic glide around the golden-hour valley for title backdrop
      const t = state.elapsed;
      const heading = Math.sin(t * 0.08) * 0.25;
      const roll = Math.cos(t * 0.08) * 0.14;
      const pitch = Math.sin(t * 0.18) * 0.03;
      setBasisFromHeadingPitchRoll(heading, pitch, roll);
      plane.pos.x = Math.sin(t * 0.08) * 260;
      plane.pos.y = 160 + Math.sin(t * 0.22) * 8;
      plane.pos.z = 1480 - (t * 28) % 900;
      plane.speed = 40;
      plane.verticalSpeed = Math.cos(t * 0.22) * 1.7;
      return events;
    }

    state.missionTime += dt;
    plane.prevPos.x = plane.pos.x;
    plane.prevPos.y = plane.pos.y;
    plane.prevPos.z = plane.pos.z;

    // Throttle & fuel
    plane.throttle = clamp(plane.throttle + controls.throttleDelta * 0.65 * dt, 0, 1);
    if (state.mode === MODE_MISSION && plane.fuel > 0) {
      const drain = lerp(PLANE.fuelIdleDrain, PLANE.fuelMaxDrain, plane.throttle);
      plane.fuel = Math.max(0, plane.fuel - drain * dt);
      if (plane.fuel <= 20 && !state.lowFuelAlerted) {
        state.lowFuelAlerted = true;
        events |= EVENT_LOW_FUEL;
        setToast('LOW FUEL (20%) — Conserve throttle!', 3.0);
      }
      if (plane.fuel <= 0 && !state.fuelOutAlerted) {
        state.fuelOutAlerted = true;
        events |= EVENT_FUEL_OUT;
        setToast('FUEL EMPTY — Engine out! Glide to Runway 36!', 4.2);
      }
    }

    if (plane.onGround) {
      // Runway ground roll physics
      const steer = (controls.yaw + controls.roll * 0.45) * 0.65 * dt;
      const pitchCmd = controls.pitch > 0.2 && plane.speed > 26 ? controls.pitch * 0.85 * dt : 0;
      rotatePlaneBasis(pitchCmd, -plane.roll * 4 * dt, steer);
      if (plane.pitch < 0) setBasisFromHeadingPitchRoll(plane.heading, 0, 0);

      const thrust = enginePower * PLANE.maxThrustAccel * 0.72;
      const rollDrag = 1.6 + (controls.brake ? 9.5 : 0) + plane.speed * 0.035;
      plane.speed = Math.max(0, plane.speed + (thrust - rollDrag) * dt);
      plane.vel.x = plane.forward.x * plane.speed;
      plane.vel.y = plane.forward.y * plane.speed;
      plane.vel.z = plane.forward.z * plane.speed;
      plane.pos.x += plane.vel.x * dt;
      plane.pos.z += plane.vel.z * dt;
      plane.groundRollTime += dt;

      // Takeoff again if speed & pitch up
      if (plane.speed > 29 && controls.pitch > 0.25 && plane.pitch > 0.07) {
        plane.onGround = false;
        plane.pos.y += 0.4;
      } else {
        plane.pos.y = RUNWAY.elevation + RUNWAY.gearClearance;
        plane.verticalSpeed = 0;

        // Check mission completion on Runway 36
        if (state.mode === MODE_MISSION && state.ringsPassed >= MISSION_RINGS.length) {
          if (isOnRunway(plane.pos.x, plane.pos.z) && (plane.speed < 14 || (plane.groundRollTime > 1.2 && plane.throttle < 0.25))) {
            finishMissionWin();
            events |= EVENT_WIN | EVENT_OVER;
            return events;
          }
        }

        // Check rolling off runway at speed or stopping with no fuel
        if (!isOnRunway(plane.pos.x, plane.pos.z)) {
          if (plane.speed > 13) {
            triggerCrash('Runway Excursion', plane.fuel <= 0);
            events |= EVENT_CRASH | EVENT_OVER;
            return events;
          }
          if (!isOnApron(plane.pos.x, plane.pos.z)) {
            triggerCrash('Off-Runway Landing', plane.fuel <= 0);
            events |= EVENT_CRASH | EVENT_OVER;
            return events;
          }
        }
        if (plane.fuel <= 0 && plane.speed < 2 && state.mode === MODE_MISSION && state.ringsPassed < MISSION_RINGS.length) {
          triggerCrash('Out of Fuel before completing course', true);
          events |= EVENT_CRASH | EVENT_OVER;
          return events;
        }
      }
      return events;
    }

    // --- Airborne 6-DOF Flight Physics ---
    const airAuthority = clamp(plane.speed / PLANE.stallSpeed, 0.28, 1.15);
    const pitchInput = controls.pitch * PLANE.pitchRate * airAuthority;
    const rollInput = controls.roll * PLANE.rollRate * airAuthority;
    const autoLevel = Math.abs(controls.roll) < 0.05 ? -wrapAngle(plane.roll) * PLANE.rollRestore : 0;
    const yawFromBank = Math.sin(plane.roll) * PLANE.turnCoord * clamp(plane.speed / 35, 0.4, 1.3);
    const yawInput = controls.yaw * PLANE.yawRate + yawFromBank;

    rotatePlaneBasis(pitchInput * dt, (rollInput + autoLevel) * dt, yawInput * dt);

    // Compute speed & Angle of Attack
    plane.speed = Math.hypot(plane.vel.x, plane.vel.y, plane.vel.z);
    const velDir = plane.speed > 0.5 ? normalize3(plane.vel, tmpA) : plane.forward;
    // AoA: angle between forward vector and velocity vector along plane's up axis
    const aoa = clamp(Math.asin(clamp(-dot3(velDir, plane.up), -0.95, 0.95)), -0.6, 0.6);

    // Stall check
    const stallingNow = plane.speed < PLANE.stallSpeed || Math.abs(aoa) > 0.31;
    plane.isStalling = stallingNow;
    if (stallingNow) {
      // Nose naturally drops and wings wobble gently in stall
      rotatePlaneBasis(-0.42 * dt, Math.sin(state.elapsed * 19) * 0.25 * dt, 0);
      if (state.stallCooldown <= 0) {
        state.stallCooldown = 0.75;
        events |= EVENT_STALL;
      }
    }

    // Lift, Thrust, Drag, Gravity
    const groundY = Math.max(WORLD.waterY, terrainHeight(plane.pos.x, plane.pos.z));
    const agl = Math.max(0, plane.pos.y - groundY);
    const groundEffect = 1 + 0.22 * clamp(1 - agl / 12, 0, 1);

    const stallFactor = stallingNow ? 0.42 : 1.0;
    const cl = (PLANE.baseLift + aoa * 2.2) * stallFactor * groundEffect;
    const liftAccel = clamp(cl * plane.speed * plane.speed * PLANE.liftSlope, 0, 34);
    const thrustAccel = enginePower * PLANE.maxThrustAccel;
    const dragAccel = (PLANE.dragBase + PLANE.inducedDrag * cl * cl) * plane.speed * plane.speed + (controls.brake ? 8.5 : 0);

    // Align velocity gently toward nose (weathervane stability) reduced in stall
    const alignRate = (stallingNow ? 1.1 : 3.2) * dt;
    const dirVel = plane.speed > 1 ? velDir : plane.forward;

    const ax =
      plane.forward.x * thrustAccel +
      plane.up.x * liftAccel -
      dirVel.x * dragAccel;
    const ay =
      plane.forward.y * thrustAccel +
      plane.up.y * liftAccel -
      dirVel.y * dragAccel -
      PLANE.gravity;
    const az =
      plane.forward.z * thrustAccel +
      plane.up.z * liftAccel -
      dirVel.z * dragAccel;

    plane.vel.x += ax * dt;
    plane.vel.y += ay * dt;
    plane.vel.z += az * dt;

    // Weathervane alignment: blend velocity direction slightly toward aircraft nose
    const newSpeed = clamp(Math.hypot(plane.vel.x, plane.vel.y, plane.vel.z), PLANE.minSpeed * 0.5, 92);
    const blend = clamp(alignRate, 0, 0.35);
    const nx = lerp(plane.vel.x / (newSpeed || 1), plane.forward.x, blend);
    const ny = lerp(plane.vel.y / (newSpeed || 1), plane.forward.y, blend * 0.65);
    const nz = lerp(plane.vel.z / (newSpeed || 1), plane.forward.z, blend);
    const nLen = Math.hypot(nx, ny, nz) || 1;
    plane.vel.x = (nx / nLen) * newSpeed;
    plane.vel.y = (ny / nLen) * newSpeed;
    plane.vel.z = (nz / nLen) * newSpeed;
    plane.speed = newSpeed;
    plane.verticalSpeed = plane.vel.y;

    plane.pos.x += plane.vel.x * dt;
    plane.pos.y += plane.vel.y * dt;
    plane.pos.z += plane.vel.z * dt;

    // Soft world boundary turn-back cushion
    const bound = WORLD.half - 160;
    if (Math.abs(plane.pos.x) > bound || Math.abs(plane.pos.z) > bound) {
      const toCenter = Math.atan2(-plane.pos.x, plane.pos.z);
      const diff = wrapAngle(toCenter - plane.heading);
      rotatePlaneBasis(0, 0, clamp(diff, -1, 1) * 1.4 * dt);
      plane.pos.x = clamp(plane.pos.x, -bound - 40, bound + 40);
      plane.pos.z = clamp(plane.pos.z, -bound - 40, bound + 40);
      setToast('Valley Perimeter — Turning back', 1.5);
    }

    // Check target ring capture
    if (checkRingPass()) {
      events |= EVENT_RING;
    }

    // Airfield building collision check (hangar & tower)
    const inHangar = Math.abs(plane.pos.x - (-84)) < 17 && Math.abs(plane.pos.z - 130) < 20 && plane.pos.y < RUNWAY.elevation + 14;
    const inTower = Math.abs(plane.pos.x - (-74)) < 9 && Math.abs(plane.pos.z - 24) < 9 && plane.pos.y < RUNWAY.elevation + 26;
    if (inHangar || inTower) {
      triggerCrash('Airfield Structure Impact', plane.fuel <= 0);
      events |= EVENT_CRASH | EVENT_OVER;
      return events;
    }

    // Ground / Water / Runway Touchdown Check
    const terrainY = terrainHeight(plane.pos.x, plane.pos.z);
    if (terrainY <= WORLD.waterY && plane.pos.y <= WORLD.waterY + 1.1) {
      triggerCrash('Water Ditching', plane.fuel <= 0);
      events |= EVENT_CRASH | EVENT_OVER;
      return events;
    }

    if (plane.pos.y <= terrainY + RUNWAY.gearClearance) {
      const sinkSpeed = -plane.vel.y;
      const onRwy = isOnRunway(plane.pos.x, plane.pos.z);

      if (onRwy) {
        const goodAttitude =
          Math.abs(plane.roll) <= PLANE.maxLandingRoll &&
          plane.pitch >= -0.20 &&
          plane.pitch <= PLANE.maxLandingPitch;
        if (sinkSpeed <= PLANE.safeSinkSpeed && goodAttitude) {
          plane.onGround = true;
          plane.groundRollTime = 0;
          plane.pos.y = RUNWAY.elevation + RUNWAY.gearClearance;
          plane.vel.y = 0;
          plane.touchdownSink = Math.max(0, sinkSpeed);
          plane.touchdownOffset = Math.abs(plane.pos.x - RUNWAY.x);
          plane.landingGrade =
            plane.touchdownSink <= PLANE.butterSinkSpeed && plane.touchdownOffset <= 8
              ? 'BUTTER'
              : plane.touchdownSink <= PLANE.firmSinkSpeed
                ? 'SMOOTH'
                : 'FIRM';
          setBasisFromHeadingPitchRoll(plane.heading, Math.max(0, plane.pitch), 0);
          events |= EVENT_TOUCHDOWN;
          if (state.mode === MODE_MISSION && state.ringsPassed < MISSION_RINGS.length) {
            setToast(`Touchdown (${plane.landingGrade}) — Pass all 8 rings to complete mission!`, 3.5);
          } else if (state.mode === MODE_FREE) {
            setToast(`Clean Touchdown on RWY 36 (${plane.landingGrade})! Throttle up or Brake (B)`, 3.5);
          } else {
            setToast(`Touchdown (${plane.landingGrade})! Hold Brakes (B) to stop`, 3.0);
          }
        } else {
          const why = !goodAttitude ? 'Unstable Attitude Landing' : 'Hard Landing on Runway 36';
          triggerCrash(why, plane.fuel <= 0);
          events |= EVENT_CRASH | EVENT_OVER;
        }
      } else if (isOnApron(plane.pos.x, plane.pos.z) && sinkSpeed <= 2.4 && Math.abs(plane.roll) < 0.25) {
        triggerCrash('Poor Landing — Missed Runway 36', plane.fuel <= 0);
        events |= EVENT_CRASH | EVENT_OVER;
      } else {
        triggerCrash(plane.fuel <= 0 ? 'Out of Fuel — Forced Landing' : 'Terrain Impact', plane.fuel <= 0);
        events |= EVENT_CRASH | EVENT_OVER;
      }
    }

    return events;
  }

  reset(MODE_MISSION);
  return { state, reset, step, setBasisFromHeadingPitchRoll };
}
