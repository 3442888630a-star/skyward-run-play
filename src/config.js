// Tuning constants, world layout, mission course, aircraft physics, and palette for Skyward Run.

export const FIELD = { width: 1280, height: 720 };

/** Fixed simulation step in seconds (60 Hz). */
export const STEP = 1 / 60;

/** World extent: terrain spans [-HALF, +HALF] in X and Z (in meters). */
export const WORLD = {
  size: 10400,
  half: 5200,
  gridSteps: 130,
  waterY: 0,
  airfieldY: 14,
  cloudCeiling: 580,
};

/**
 * Runway 36 layout: centered at X = 0, running North (-Z) from threshold Z = +320 to Z = -280.
 * Approaching from the South flying North (heading 360 / 000) aligns directly with "36".
 */
export const RUNWAY = {
  x: 0,
  zStart: 320, // South threshold (36 end)
  zEnd: -280, // North end (18 end)
  length: 600,
  width: 44,
  halfWidth: 22,
  apronWidth: 160,
  apronPaddingZ: 120,
  elevation: WORLD.airfieldY,
  gearClearance: 1.55,
};

/** Golden-hour lighting & atmospheric palette. */
export const PALETTE = {
  // Sky gradient stops (zenith -> mid -> warm horizon)
  skyZenith: [0.09, 0.14, 0.32],
  skyMid: [0.54, 0.28, 0.42],
  skyHorizon: [0.98, 0.57, 0.29],
  sunDir: [-0.82, 0.28, -0.50], // Low golden sun in the WNW sky
  sunColor: [1.0, 0.82, 0.52],
  ambientSky: [0.34, 0.42, 0.60],
  ambientGround: [0.22, 0.20, 0.16],
  fogColor: [0.88, 0.58, 0.40],
  fogDensity: 0.00024,
  waterDeep: [0.05, 0.15, 0.25],
  waterShallow: [0.16, 0.34, 0.38],
  // HUD & UI colors
  hudBg: 'rgba(11, 17, 26, 0.78)',
  hudBezel: 'rgba(255, 200, 120, 0.32)',
  hudText: '#f4f1ea',
  hudAmber: '#ffbe55',
  hudCyan: '#58e2c7',
  hudGreen: '#6ae67b',
  hudRed: '#ff5d55',
  hudMuted: '#9aa8ba',
  hudSky: '#3b6ea5',
  hudGround: '#7a4f2d',
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
export const MONO_FONT = 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace';

/** Aerodynamic & flight model parameters (SI-like meters/seconds internally, displayed in kts/ft). */
export const PLANE = {
  startX: 0,
  startY: 165,
  startZ: 1550,
  startHeading: 0, // North (-Z) toward Ring 1
  startSpeed: 42, // m/s (~82 kts)
  startThrottle: 0.65,
  minSpeed: 12,
  stallSpeed: 23, // ~45 kts
  maxThrustAccel: 18, // m/s^2 at full throttle
  dragBase: 0.0049,
  inducedDrag: 0.014,
  liftSlope: 0.0172,
  baseLift: 0.26,
  gravity: 9.81,
  pitchRate: 1.35, // rad/s max command
  rollRate: 2.15, // rad/s max command
  yawRate: 0.72, // rad/s max command
  turnCoord: 0.58, // natural heading turn from bank angle
  rollRestore: 0.32, // gentle wing-leveling stability when roll input is 0
  fuelCapacity: 100,
  fuelIdleDrain: 0.05, // % per second at 0% throttle
  fuelMaxDrain: 0.33, // % per second at 100% throttle
  safeSinkSpeed: 4.8, // m/s vertical impact limit on runway
  firmSinkSpeed: 2.6,
  butterSinkSpeed: 1.15,
  maxLandingRoll: 0.32, // ~18 deg
  maxLandingPitch: 0.38, // ~22 deg
  ringRadius: 24, // visual & capture outer radius
  ringPassMargin: 28, // generous hitbox radius for crisp playability
};

/**
 * 8-ring mission course forming a scenic golden-hour loop across all world zones:
 * farmland, western mountains, wetland shore, northern lake, dense forest, town,
 * river bend, and back onto final approach for Runway 36.
 */
export const MISSION_RINGS = [
  { x: 0, y: 155, z: 1020, heading: 0, label: 'Farmland Plain' },
  { x: -2100, y: 295, z: -250, heading: -0.65, label: 'West Crags' },
  { x: -1150, y: 165, z: -2550, heading: 0.75, label: 'Wetland Shore' },
  { x: 1150, y: 170, z: -2650, heading: 1.65, label: 'Mirror Lake' },
  { x: 2450, y: 215, z: -750, heading: 2.75, label: 'Emerald Forest' },
  { x: 1380, y: 175, z: 1220, heading: -2.65, label: 'Oakwood Town' },
  { x: 420, y: 145, z: 1920, heading: -1.95, label: 'River Bend' },
  { x: 0, y: 92, z: 1080, heading: 0, label: 'Final 36' },
];

export const SCORING = {
  ringBase: 250,
  ringCenterBonus: 150,
  timeTarget: 330,
  timeBonusMax: 1000,
  fuelBonusPerPct: 12,
  landingButter: 1000,
  landingSmooth: 750,
  landingFirm: 450,
};

export const MODE_MISSION = 'mission';
export const MODE_FREE = 'free';

export const BEST_KEY = 'skyward-run.best';
