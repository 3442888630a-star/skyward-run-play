// Procedural golden-hour terrain heightmap (10,400m warped smooth mesh), blended biome zones,
// zone-tint & detail Canvas textures, animated water normal map, textured Runway 36 + decals,
// airfield + village + SE town, dense/sparse zoned trees, clouds, and far mountain band.

import { MISSION_RINGS, PLANE, RUNWAY, WIND, WORLD } from './config.js';
import { clamp, lerp, smooth01 } from './math.js';
import { createRandom, fbm2D, valueNoise2D } from './random.js';

const TERRAIN_STEPS = 320;
const TERRAIN_STEP_SIZE = WORLD.size / TERRAIN_STEPS;

export const CANYON_WATER_Y = -124;
const CANYON_FLOOR_Y = -119;
const CANYON_BED_Y = -129.5;
const WATERFALL_Z_TOP = -1352;
const WATERFALL_Z_BOT = -1302;
const GLACIER_TARN = { x: -2320, z: -1720, y: 195, rx: 420, rz: 360 };
const HIGHLAND_TARN = { x: 2880, z: -1050, y: 148, rx: 380, rz: 320 };

const FIELD_ANGLE = 0.24;
const FIELD_COS = Math.cos(FIELD_ANGLE);
const FIELD_SIN = Math.sin(FIELD_ANGLE);
const FIELD_W = 185;
const FIELD_H = 140;

const VILLAGE_CENTER = { x: -212, z: 65 };
const TOWN_CENTER = { x: 1380, z: 1220 };
const RIVER_HAMLET_CENTER = { x: 375, z: 2245 };
const LAKE_VILLAGE_CENTER = { x: -1215, z: -1965 };
const FARMLAND_HAMLET_CENTER = { x: -700, z: 2550 };

/** Monotone cubic coordinate warp: ~18m cells near center, ~61m at 5200m edge. */
function warpCoord(t) {
  return WORLD.half * (0.56 * t + 0.44 * t * t * t);
}

/** Invert warpCoord(t) = w via 4 Newton steps. */
function unwarpCoord(w) {
  const y = clamp(w / WORLD.half, -1, 1);
  let t = y;
  for (let k = 0; k < 4; k += 1) {
    const f = 0.56 * t + 0.44 * t * t * t - y;
    const df = 0.56 + 1.32 * t * t;
    t -= f / df;
  }
  return clamp(t, -1, 1);
}

/** Winding river centerline X as a function of Z (continuous from northern lake through south valley). */
export function riverCenterX(z) {
  return 320 + 210 * Math.sin(z * 0.0017) + 95 * Math.cos(z * 0.0039);
}

/** Half-width of the river at a given Z (widens smoothly into the northern lake). */
export function riverHalfWidth(z) {
  const widen = smooth01((-900 - z) / 700);
  return 30 + 16 * Math.sin(z * 0.0029 + 1.1) + widen * 185;
}

/** Winding Eagle Gorge centerline X in the eastern high plateau (z in [-860, +780]). */
export function eagleGorgeCenterX(z) {
  return 2360 - 0.56 * z + 85 * Math.sin(z * 0.0042);
}

/** Northern lake coastline Z coordinates (south and north shores) at a given X. */
function lakeCoastZ(x) {
  const westShelf = smooth01((-1050 - x) / 1100) * 950;
  return -1510 + 220 * Math.sin(x * 0.0009 + 0.5) + 110 * Math.cos(x * 0.0020) - westShelf;
}

function lakeNorthCoastZ(x) {
  return -2740 + 180 * Math.sin(x * 0.0010 + 1.1) + 95 * Math.cos(x * 0.0022);
}

/** Distance factor inside the compacted Mirror Lake basin (x in ~[-1150..+1550]). */
function lakeMask(x, z) {
  const coastZ = lakeCoastZ(x);
  const northZ = lakeNorthCoastZ(x);
  const southFactor = smooth01((coastZ - z) / 300);
  const northFactor = smooth01((z - northZ) / 340);
  const eastFade = 1 - smooth01((x - 1120) / 420);
  const westFade = 1 - smooth01((-1080 - x) / 420);
  return southFactor * northFactor * eastFade * westFade;
}

/** Organic circular/elliptical basin mask for elevated alpine/highland tarns. */
function tarnMask(x, z, spec, phase) {
  const dx = (x - spec.x) / spec.rx;
  const dz = (z - spec.z) / spec.rz;
  const ang = Math.atan2(dz, dx);
  const rimWarp = 1.0 + 0.14 * Math.sin(ang * 3.0 + phase) + 0.08 * Math.cos(ang * 5.0 - phase * 0.7);
  const d = Math.hypot(dx, dz) / rimWarp;
  return 1 - smooth01((d - 0.68) / 0.56);
}

/** Water surface elevation at world (x, z): Glacier Tarn (195m), Highland Tarn (148m), Mirror Lake (0m), Canyon (-124m). */
export function waterLevelAt(x, z) {
  if (Math.hypot(x - GLACIER_TARN.x, z - GLACIER_TARN.z) < 460 && tarnMask(x, z, GLACIER_TARN, 0.6) > 0.02) {
    return GLACIER_TARN.y;
  }
  if (Math.hypot(x - HIGHLAND_TARN.x, z - HIGHLAND_TARN.z) < 480 && tarnMask(x, z, HIGHLAND_TARN, -0.8) > 0.02) {
    return HIGHLAND_TARN.y;
  }
  if (z <= WATERFALL_Z_TOP) return WORLD.waterY;
  if (z >= WATERFALL_Z_BOT) return CANYON_WATER_Y;
  return lerp(WORLD.waterY, CANYON_WATER_Y, smooth01((z - WATERFALL_Z_TOP) / (WATERFALL_Z_BOT - WATERFALL_Z_TOP)));
}

/** Sharp ridged multifractal noise in [0, 1] for jagged alpine crests. */
function ridged2D(x, z, octaves = 4, seed = 89) {
  let sum = 0;
  let amp = 0.55;
  let freq = 1;
  let weight = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i += 1) {
    const rv = valueNoise2D(x * freq, z * freq, seed + i * 37) * 2 - 1;
    let n = clamp(1.06 - Math.sqrt(rv * rv + 0.014), 0, 1);
    n = n * n * weight;
    weight = clamp(n * 1.65, 0.22, 1.0);
    sum += n * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.12;
  }
  return sum / norm;
}

/** Distance from point (x, z) to 2D segment (ax, az)-(bx, bz). */
function distToSeg2D(x, z, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const lenSq = dx * dx + dz * dz || 1;
  const t = clamp(((x - ax) * dx + (z - az) * dz) / lenSq, 0, 1);
  return Math.hypot(x - (ax + dx * t), z - (az + dz * t));
}

/** Distance outside the flat airfield plateau (0 inside plateau, 1 outside). */
function airfieldFlatten(x, z) {
  const dx = x > RUNWAY.x
    ? Math.max(0, x - 34)
    : Math.max(0, -x - RUNWAY.apronWidth * 0.58);
  const zMin = RUNWAY.zEnd - RUNWAY.apronPaddingZ;
  const zMax = RUNWAY.zStart + RUNWAY.apronPaddingZ;
  const dz = z < zMin ? zMin - z : z > zMax ? z - zMax : 0;
  const blend = x > RUNWAY.x && dz < 40 ? 78 : 140;
  const dist = Math.hypot(dx, dz);
  return smooth01(dist / blend);
}

/** Distance outside a circular settlement pad (0 inside flatRadius, 1 outside blend). */
function padFlatten(x, z, cx, cz, flatR, blendR) {
  const dist = Math.hypot(x - cx, z - cz);
  return smooth01((dist - flatR) / blendR);
}

/** Distance outside the Southeast town plateau (0 inside plateau, 1 outside). */
function townFlatten(x, z) {
  const dist = Math.hypot(x - TOWN_CENTER.x, z - TOWN_CENTER.z);
  return smooth01((dist - 360) / 210);
}

/** Smoothly blended biome zone weights at world (x, z) across the multi-landform world. */
export function sampleZoneWeights(x, z) {
  const warpX = (fbm2D(x * 0.00032, z * 0.00032, 3, 101) - 0.5) * 420;
  const warpZ = (fbm2D(x * 0.00032 + 11.7, z * 0.00032 - 5.3, 3, 202) - 0.5) * 420;
  const nx = x + warpX;
  const nz = z + warpZ;

  const coastZ = lakeCoastZ(x);
  const lake = lakeMask(x, z);
  const wetland = smooth01((coastZ + 520 - nz) / 420) * smooth01((nz - (coastZ - 240)) / 300) * smooth01((nx + 1350) / 520) * (1 - smooth01((nx - 250) / 520)) * (1 - lake * 0.85);
  // Continuous C-shaped Alpine Cordillera (West + North behind Mirror Lake + NE Spur)
  const lakeCoveShift = smooth01((-1400 - nz) / 600) * (1 - smooth01((-2700 - nz) / 500)) * 520;
  const westMountain = smooth01((-740 - lakeCoveShift - nx) / 860);
  const northMountain = smooth01((-2380 - nz) / 760) * smooth01((4200 - nx) / 1400);
  const neSpur = smooth01((nx - 1580) / 880) * smooth01((-1340 - nz) / 880);
  const mountain = clamp(Math.max(westMountain, northMountain, neSpur), 0, 1);

  // East High Sandstone Plateau & Forested Ridges
  const mesaW = smooth01((nx - 1580) / 360);
  const mesaN = smooth01((nz - (-720)) / 360);
  const mesaS = 1 - smooth01((nz - 2550) / 520);
  const plateau = clamp(mesaW * mesaN * mesaS, 0, 1);
  const forest = smooth01((nx - 620) / 720) * smooth01((1650 - nz) / 850) * (1 - lake) * (1 - northMountain * 0.65);

  // Rolling southern/outer hills shrink the flat valley strictly to the Runway-Village-Oakwood core
  const hillOutX = smooth01((Math.abs(x) - 540) / 420);
  const hillSouthZ = smooth01((z - 1900) / 480);
  const hills = clamp(Math.max(hillOutX * smooth01((z - 320) / 520), hillSouthZ), 0, 1) * (1 - mountain) * (1 - plateau * 0.7);

  const town = 1 - townFlatten(x, z);
  const airport = 1 - airfieldFlatten(x, z);
  const used = clamp(lake + wetland * 0.8 + mountain + plateau + hills * 0.85 + forest * 0.75 + town * 0.4 + airport * 0.4, 0, 1);
  const farmland = clamp(1 - used * 0.92, 0, 1);
  return { farmland, forest, lake, wetland, mountain, plateau, hills, town, airport };
}

/** Deterministic terrain height in meters at world (x, z). */
export function terrainHeight(x, z) {
  const nBroad = fbm2D(x * 0.00048 + 12.3, z * 0.00048 - 7.1, 4, 17);
  const nDetail = fbm2D(x * 0.0022 - 4.2, z * 0.0022 + 9.4, 3, 53);
  const zones = sampleZoneWeights(x, z);

  // Compact central farm valley + rolling world-edge & outer hills
  const valleyDist = Math.abs(x) / 2200;
  const edgeDist = Math.max(Math.abs(x), Math.abs(z)) / WORLD.half;
  const ridgeNoise = 1 - Math.abs(fbm2D(x * 0.00075 + 3.7, z * 0.00075 - 5.2, 4, 79) * 2 - 1);
  const hillRidge = ridged2D(x * 0.00095 - 3.1, z * 0.00095 + 4.4, 3, 193);
  const outerRim = Math.pow(clamp(edgeDist - 0.60, 0, 1) * 2.5, 1.65) * (155 + ridgeNoise * 120);
  const hillShape = Math.pow(clamp(valleyDist, 0, 1.5), 1.45) * 64 + outerRim;

  // Approach corridor south of Runway 36 stays gently flat & open
  const approachCorridor = 1 - smooth01(Math.hypot(x * 0.88, Math.max(0, 420 - z) * 0.35 + Math.max(0, z - 1950) * 0.42) / 360);

  let h = 11 + nBroad * 30 + nDetail * 11 + hillShape * (0.45 + 0.65 * nBroad);

  // Rolling Hill Country across South, SW, and SE foothills (replaces endless flat southern plain)
  if (zones.hills > 0.001) {
    const rollH = 42 + hillRidge * 155 + nBroad * 58 + ridgeNoise * 38;
    h += zones.hills * rollH;
  }

  // East High Sandstone Plateau with steep stepped cliff rim (~255-315m)
  if (zones.plateau > 0.001) {
    const stepped = clamp(zones.plateau + 0.045 * Math.sin(zones.plateau * Math.PI * 3.0) * zones.plateau * (1 - zones.plateau) * 4.0, 0, 1);
    const mesaTop = 248 + nBroad * 42 + ridgeNoise * 28 + nDetail * 10;
    h = lerp(h, mesaTop, stepped);
  }

  // East/NE forested foothills
  h += zones.forest * (22 + nBroad * 46 + ridgeNoise * 26) * (1 - zones.plateau * 0.7);

  // Continuous Joined Alpine Mountain System (West + North + NE snow-capped ranges, ~950-1280m)
  if (zones.mountain > 0.001) {
    const mRidge = ridged2D(x * 0.00068 + 2.1, z * 0.00068 - 4.3, 4, 89);
    const mCrest = ridged2D(x * 0.00165 - 1.4, z * 0.00165 + 3.2, 3, 137);
    const mBase = fbm2D(x * 0.00038 + 5.4, z * 0.00038 - 1.9, 3, 43);
    const farRangeBoost = 1.0 + 0.28 * smooth01((-2350 - x) / 1800) + 0.28 * smooth01((-3300 - z) / 1400);
    const mHeight = (78 + Math.pow(mRidge, 1.08) * 655 + mCrest * 225 + mBase * 145) * farRangeBoost + nDetail * 14;
    h += zones.mountain * mHeight;

    // Carve broad U-shaped glacial valleys around Ring 2 (-1950, 425, -200) & flight legs 1->2 / 2->3 / 3->4
    const dRing2 = Math.hypot(x - (-1950), z - (-200));
    const dPass12 = distToSeg2D(x, z, -1950, -200, 0, 1020);
    const dPass23 = distToSeg2D(x, z, -1950, -200, -2320, -1720);
    const dPass34 = distToSeg2D(x, z, -2320, -1720, -1050, -1980);
    const pass2 = 1 - smooth01((dRing2 - 260) / 520);
    const pass12 = 1 - smooth01((dPass12 - 220) / 480);
    const pass23 = 1 - smooth01((dPass23 - 240) / 520);
    const pass34 = 1 - smooth01((dPass34 - 240) / 500);
    const passFactor = Math.max(pass2, pass12 * 0.90, pass23 * 0.90, pass34 * 0.94);
    if (passFactor > 0.001) {
      const passFloor = 225 + nDetail * 14 - smooth01((x + 1450) / 650) * 165 - smooth01((-1100 - z) / 700) * 55;
      const k = 50;
      const diff = clamp(0.5 + 0.5 * (passFloor - h) / k, 0, 1);
      const sMinFloor = lerp(passFloor, h, diff) - k * diff * (1 - diff);
      h = lerp(h, sMinFloor, passFactor * 0.90);
    }
  }

  // Keep Runway 36 Final Approach corridor gently flat
  h = lerp(h, 14 + nDetail * 3.5, approachCorridor * 0.85);

  // Carve West Glacier Tarn (y=195m cirque lake) & East Highland Tarn (y=148m mesa lake)
  const gTarn = tarnMask(x, z, GLACIER_TARN, 0.6);
  if (gTarn > 0.001) {
    const cirqueFloor = 176 + nDetail * 4;
    const cirqueRim = 248 + ridgeNoise * 42;
    const rimT = smooth01(gTarn / 0.55);
    const bowlH = lerp(h, Math.min(h, cirqueRim), rimT * 0.65);
    h = lerp(bowlH, cirqueFloor, gTarn);
  }
  const hTarn = tarnMask(x, z, HIGHLAND_TARN, -0.8);
  if (hTarn > 0.001) {
    const tarnFloor = 130 + nDetail * 4;
    const tarnRim = 172 + ridgeNoise * 38;
    h = lerp(Math.min(h, tarnRim), tarnFloor, hTarn);
  }

  // Carve Second Canyon Segment: Eagle Gorge slicing across East High Plateau (z in [-860, +1050])
  const gorgeBand = smooth01((z - (-880)) / 240) * (1 - smooth01((z - 760) / 300));
  if (gorgeBand > 0.001) {
    const gDist = Math.abs(x - eagleGorgeCenterX(z));
    const gFloorHalfW = 46;
    const gRimHalfW = 158 + 14 * Math.sin(z * 0.005);
    const rawGT = smooth01((gDist - gFloorHalfW) / (gRimHalfW - gFloorHalfW));
    const strataGT = clamp(rawGT + 0.042 * Math.sin(rawGT * Math.PI * 4.0), 0, 1);
    const gorgeFloorY = 34 + (nDetail - 0.5) * 4.5;
    h = lerp(h, lerp(gorgeFloorY, h, strataGT), gorgeBand);
  }

  // Zone 3: Low flat marsh/wetland shores + marshy peninsula near (-1150, -2250)
  if (zones.wetland > 0.001) {
    h = lerp(h, 2.2 + nDetail * 3.8, zones.wetland * 0.85);
  }
  const marshPeninsula = 1 - smooth01((Math.hypot(x - (-1050), z - (-2200)) - 200) / 300);

  // Carve continuous winding river + center-north Grand Canyon along riverCenterX(z)
  const rCenter = riverCenterX(z);
  const rDist = Math.abs(x - rCenter);
  const rHalf = riverHalfWidth(z);
  const canyonBlend = smooth01((z - (WATERFALL_Z_TOP - 45)) / 45);
  let hRiver = h;
  if (canyonBlend < 1) {
    const outletCarve = 1 - smooth01((rDist - rHalf * 0.72) / (rHalf * 2.0 + 48));
    if (z > -1850) {
      hRiver = lerp(hRiver, -5.5, outletCarve);
    }
  }
  let hCanyon = h;
  if (canyonBlend > 0) {
    // Center-north Grand Canyon (-1340..+420) tapering into narrower southern gorge (+420..+860+)
    const canyonBand = 1 - smooth01((z - 420) / 440);
    const waterHalfW = lerp(24, 34, canyonBand) + 5 * Math.sin(z * 0.0041);
    const floorHalfW = lerp(34, 74, canyonBand) + 10 * Math.sin(z * 0.0055 + 0.4);
    const rimHalfW = lerp(86, 168, canyonBand) + 16 * Math.sin(z * 0.0037 + 0.8);

    // Stratified red-rock stepped wall profile from floor to plain-level rim
    const rawWallT = smooth01((rDist - floorHalfW) / Math.max(12, rimHalfW - floorHalfW));
    const strataWallT = clamp(rawWallT + 0.042 * Math.sin(rawWallT * Math.PI * 4.0) * canyonBand, 0, 1);

    // Waterfall cliff drop at canyon head (z in -1352..-1302)
    const dropT = smooth01((z - WATERFALL_Z_TOP) / (WATERFALL_Z_BOT - WATERFALL_Z_TOP));
    const targetBedY = lerp(-6.0, CANYON_BED_Y, dropT);
    const targetFloorY = lerp(-3.0, CANYON_FLOOR_Y, dropT) + (nDetail - 0.5) * 3.8;
    const channelT = smooth01((rDist - waterHalfW) / Math.max(8, floorHalfW - waterHalfW));
    const innerY = lerp(targetBedY, targetFloorY, channelT);

    hCanyon = lerp(h, innerY, 1 - strataWallT);
  }
  h = lerp(hRiver, hCanyon, canyonBlend);

  // Carve compacted Mirror Lake (preserving marshy peninsula & rocky waterfall outlet chutes)
  const outletShield = smooth01((z - (WATERFALL_Z_TOP - 95)) / 70) * smooth01((rDist - 46) / 36);
  const lMask = lakeMask(x, z) * (1 - marshPeninsula * 0.92) * (1 - outletShield);
  if (lMask > 0) {
    h = lerp(h, -14, lMask);
  }
  // Natural canyon-lip rock shoulders flanking the waterfall mouth so lake water laps solid shore instead of ending in mid-air
  const lipZMask = smooth01((z - (-1425)) / 52) * (1 - smooth01((z - (-1352)) / 24));
  const shoulderXMask = smooth01((rDist - 46) / 22) * (1 - smooth01((rDist - 135) / 45));
  const lipShoulder = lipZMask * shoulderXMask;
  if (lipShoulder > 0.001) {
    const sillH = 3.2 + nDetail * 3.8 + Math.sin(x * 0.08) * 1.4;
    h = Math.max(h, lerp(h, sillH, lipShoulder));
  }
  if (marshPeninsula > 0.01) {
    h = lerp(h, 2.4 + nDetail * 2.2, marshPeninsula * 0.88);
  }

  // Level settlement & farmstead pads gently so all buildings sit flush
  h = lerp(26, h, padFlatten(x, z, RIVER_HAMLET_CENTER.x, RIVER_HAMLET_CENTER.z, 98, 110));
  const lakePad = padFlatten(x, z, LAKE_VILLAGE_CENTER.x, LAKE_VILLAGE_CENTER.z, 88, 90);
  const lakeDryMask = smooth01((h - 0.8) / 2.4);
  h = lerp(7.5, h, 1 - (1 - lakePad) * lakeDryMask);
  h = lerp(52.5, h, padFlatten(x, z, FARMLAND_HAMLET_CENTER.x, FARMLAND_HAMLET_CENTER.z, 115, 115));
  h = lerp(34, h, padFlatten(x, z, 575, 560, 28, 36));
  h = lerp(42, h, padFlatten(x, z, 245, 2860, 28, 32));

  // Level Southeast Oakwood Town plateau gently at 24m (protected from plateau cliffs)
  const tf = townFlatten(x, z);
  h = lerp(24, h, tf);

  // Flatten airfield plateau & west terminal pad cleanly at RUNWAY.elevation (14m)
  const af = airfieldFlatten(x, z);
  h = lerp(RUNWAY.elevation, h, af);
  h = lerp(RUNWAY.elevation, h, padFlatten(x, z, -132, 206, 38, 45));

  return h;
}

export function isOnRunway(x, z) {
  return (
    Math.abs(x - RUNWAY.x) <= RUNWAY.halfWidth &&
    z <= RUNWAY.zStart &&
    z >= RUNWAY.zEnd
  );
}

export function isOnApron(x, z) {
  return (
    Math.abs(x - RUNWAY.x) <= RUNWAY.apronWidth * 0.65 &&
    z <= RUNWAY.zStart + RUNWAY.apronPaddingZ * 0.8 &&
    z >= RUNWAY.zEnd - RUNWAY.apronPaddingZ * 0.8
  );
}

// --- Cached Warped Terrain Grid for Exact Surface Grounding ---

let cachedHGrid = null;
let cachedAxisCoords = null;

function getAxisCoords() {
  if (cachedAxisCoords) return cachedAxisCoords;
  const coords = new Float32Array(TERRAIN_STEPS + 1);
  for (let i = 0; i <= TERRAIN_STEPS; i += 1) {
    const t = (i / TERRAIN_STEPS) * 2 - 1;
    coords[i] = warpCoord(t);
  }
  cachedAxisCoords = coords;
  return coords;
}

function getTerrainHeightGrid() {
  if (cachedHGrid) return cachedHGrid;
  const coords = getAxisCoords();
  const stride = TERRAIN_STEPS + 1;
  const grid = new Float32Array(stride * stride);
  for (let iz = 0; iz <= TERRAIN_STEPS; iz += 1) {
    const z = coords[iz];
    for (let ix = 0; ix <= TERRAIN_STEPS; ix += 1) {
      const x = coords[ix];
      grid[iz * stride + ix] = terrainHeight(x, z);
    }
  }
  cachedHGrid = grid;
  return grid;
}

/** Sample the exact barycentric Y height of the rendered terrain mesh at (x, z). */
export function sampleMeshHeight(x, z) {
  const grid = getTerrainHeightGrid();
  const stride = TERRAIN_STEPS + 1;
  const fx = clamp((unwarpCoord(x) + 1) * 0.5 * TERRAIN_STEPS, 0, TERRAIN_STEPS - 1e-4);
  const fz = clamp((unwarpCoord(z) + 1) * 0.5 * TERRAIN_STEPS, 0, TERRAIN_STEPS - 1e-4);
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const u = fx - ix;
  const v = fz - iz;
  const i00 = iz * stride + ix;
  const h00 = grid[i00];
  const h10 = grid[i00 + 1];
  const h01 = grid[i00 + stride];
  const h11 = grid[i00 + stride + 1];

  if ((ix + iz) % 2 === 0) {
    if (v >= u) {
      return h00 + (h01 - h00) * v + (h11 - h01) * u;
    }
    return h00 + (h11 - h10) * v + (h10 - h00) * u;
  }
  if (u + v <= 1) {
    return h00 + (h10 - h00) * u + (h01 - h00) * v;
  }
  return h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
}

/** Fast normal Y approximation using cached height grid. */
function terrainNormalY(x, z) {
  const eps = 24;
  const dhdx = (sampleMeshHeight(x + eps, z) - sampleMeshHeight(x - eps, z)) / (eps * 2);
  const dhdz = (sampleMeshHeight(x, z + eps) - sampleMeshHeight(x, z - eps)) / (eps * 2);
  return 1 / Math.hypot(dhdx, 1, dhdz);
}

// --- Mesh Builder Helpers ---

function createBuilder(withUv = false) {
  const pos = [];
  const norm = [];
  const col = [];
  const uv = withUv ? [] : null;
  return {
    pos,
    norm,
    col,
    uv,
    pushVert(x, y, z, nx, ny, nz, r, g, b, u = 0, v = 0) {
      pos.push(x, y, z);
      norm.push(nx, ny, nz);
      col.push(r, g, b);
      if (uv) uv.push(u, v);
    },
    tri(ax, ay, az, bx, by, bz, cx, cy, cz, r, g, b) {
      const ux = bx - ax;
      const uy = by - ay;
      const uz = bz - az;
      const vx = cx - ax;
      const vy = cy - ay;
      const vz = cz - az;
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
      pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
      norm.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
      col.push(r, g, b, r, g, b, r, g, b);
      if (uv) uv.push(0, 0, 0, 0, 0, 0);
    },
    quad(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, r, g, b) {
      this.tri(ax, ay, az, bx, by, bz, cx, cy, cz, r, g, b);
      this.tri(ax, ay, az, cx, cy, cz, dx, dy, dz, r, g, b);
    },
    box(cx, cy, cz, sx, sy, sz, r, g, b, rotY = 0) {
      const hx = sx * 0.5;
      const hy = sy * 0.5;
      const hz = sz * 0.5;
      const c = Math.cos(rotY);
      const s = Math.sin(rotY);
      const pt = (lx, ly, lz) => [cx + lx * c + lz * s, cy + ly, cz - lx * s + lz * c];
      const p000 = pt(-hx, -hy, -hz);
      const p100 = pt(hx, -hy, -hz);
      const p110 = pt(hx, hy, -hz);
      const p010 = pt(-hx, hy, -hz);
      const p001 = pt(-hx, -hy, hz);
      const p101 = pt(hx, -hy, hz);
      const p111 = pt(hx, hy, hz);
      const p011 = pt(-hx, hy, hz);
      // Top, bottom, front(+z), back(-z), right(+x), left(-x)
      this.quad(...p011, ...p111, ...p110, ...p010, r, g, b);
      this.quad(...p000, ...p100, ...p101, ...p001, r * 0.72, g * 0.72, b * 0.72);
      this.quad(...p001, ...p101, ...p111, ...p011, r * 0.94, g * 0.94, b * 0.94);
      this.quad(...p100, ...p000, ...p010, ...p110, r * 0.87, g * 0.87, b * 0.87);
      this.quad(...p101, ...p100, ...p110, ...p111, r * 0.91, g * 0.91, b * 0.91);
      this.quad(...p000, ...p001, ...p011, ...p010, r * 0.89, g * 0.89, b * 0.89);
    },
    toMesh() {
      const out = {
        positions: new Float32Array(pos),
        normals: new Float32Array(norm),
        colors: new Float32Array(col),
        vertexCount: pos.length / 3,
      };
      if (uv) out.uvs = new Float32Array(uv);
      return out;
    },
  };
}

/** Uniform deterministic hash in [0, 1) for integer agricultural plot coordinates. */
function cellHash(ix, iz, seed = 101) {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 1442695041);
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Realistic muted countryside field palette color for a given integer plot cell. */
function plotPaletteColor(cellX, cellZ) {
  const patch = cellHash(cellX, cellZ, 101);
  const tint = 0.90 + cellHash(cellX, cellZ, 303) * 0.18;
  let r;
  let g;
  let b;
  if (patch < 0.16) {
    r = 0.16; g = 0.33; b = 0.14; // Deep clover pasture
  } else if (patch < 0.32) {
    r = 0.25; g = 0.44; b = 0.18; // Lush spring meadow
  } else if (patch < 0.46) {
    r = 0.34; g = 0.43; b = 0.20; // Olive grass / orchard
  } else if (patch < 0.64) {
    r = 0.62; g = 0.52; b = 0.25; // Ripening golden wheat
  } else if (patch < 0.78) {
    r = 0.70; g = 0.59; b = 0.30; // Sunlit straw / barley
  } else if (patch < 0.90) {
    r = 0.46; g = 0.36; b = 0.23; // Warm plowed loam / tilled earth
  } else {
    r = 0.54; g = 0.51; b = 0.25; // Pale hayfield
  }
  return [r * tint, g * tint, b * tint];
}

/** Baked valley & canyon ambient occlusion + subtle sun-facing high-slope lift. */
function terrainVertexAO(h, nx, ny, nz, hAvgNeighbors, hRimAvg, hRimMax) {
  const concavity = Math.max(0, hAvgNeighbors - h);
  const valleyAo = clamp(1.0 - concavity * 0.075, 0.72, 1.0);
  const rimDepth = Math.max(0, hRimAvg - h);
  const wallDepth = Math.max(0, hRimMax - h);
  const canyonAo = clamp(1.0 - rimDepth * 0.0048 - wallDepth * 0.0018, 0.56, 1.0);
  const slopeAo = lerp(0.84, 1.0, smooth01((ny - 0.58) / 0.34));
  const sunDot = Math.max(0, nx * -0.80 + ny * 0.27 + nz * -0.49);
  const highLift = smooth01((h - 150) / 160) * sunDot * 0.09;
  const ao = clamp(valleyAo * canyonAo * slopeAo + highLift, 0.50, 1.08);
  return [ao, ao * 0.995, ao * 0.985];
}

export function buildTerrainMesh() {
  const steps = TERRAIN_STEPS;
  const coords = getAxisCoords();
  const stride = steps + 1;
  const hGrid = getTerrainHeightGrid();

  const vCount = stride * stride;
  const vx = new Float32Array(vCount);
  const vy = new Float32Array(vCount);
  const vz = new Float32Array(vCount);
  const vnx = new Float32Array(vCount);
  const vny = new Float32Array(vCount);
  const vnz = new Float32Array(vCount);
  const vcr = new Float32Array(vCount);
  const vcg = new Float32Array(vCount);
  const vcb = new Float32Array(vCount);
  const vu = new Float32Array(vCount);
  const vv = new Float32Array(vCount);

  for (let iz = 0; iz <= steps; iz += 1) {
    const z = coords[iz];
    const vCoord = (z + WORLD.half) / WORLD.size;
    const izPrev = Math.max(0, iz - 1);
    const izNext = Math.min(steps, iz + 1);
    const spanZ = Math.max(1, coords[izNext] - coords[izPrev]);
    for (let ix = 0; ix <= steps; ix += 1) {
      const x = coords[ix];
      const uCoord = (x + WORLD.half) / WORLD.size;
      const ixPrev = Math.max(0, ix - 1);
      const ixNext = Math.min(steps, ix + 1);
      const spanX = Math.max(1, coords[ixNext] - coords[ixPrev]);

      const idx = iz * stride + ix;
      const h = hGrid[idx];
      const hL = hGrid[iz * stride + ixPrev];
      const hR = hGrid[iz * stride + ixNext];
      const hD = hGrid[izPrev * stride + ix];
      const hU = hGrid[izNext * stride + ix];

      let nx = -(hR - hL) / spanX;
      let ny = 1;
      let nz = -(hU - hD) / spanZ;
      const invLen = 1 / Math.hypot(nx, ny, nz);
      nx *= invLen;
      ny *= invLen;
      nz *= invLen;

      const hAvg = (hL + hR + hD + hU) * 0.25;
      const ixL2 = Math.max(0, ix - 2);
      const ixR2 = Math.min(steps, ix + 2);
      const izD2 = Math.max(0, iz - 2);
      const izU2 = Math.min(steps, iz + 2);
      const ixL5 = Math.max(0, ix - 5);
      const ixR5 = Math.min(steps, ix + 5);
      const izD5 = Math.max(0, iz - 5);
      const izU5 = Math.min(steps, iz + 5);
      const h2L = hGrid[iz * stride + ixL2];
      const h2R = hGrid[iz * stride + ixR2];
      const h2D = hGrid[izD2 * stride + ix];
      const h2U = hGrid[izU2 * stride + ix];
      const h5L = hGrid[iz * stride + ixL5];
      const h5R = hGrid[iz * stride + ixR5];
      const h5D = hGrid[izD5 * stride + ix];
      const h5U = hGrid[izU5 * stride + ix];
      const hRimAvg = (h2L + h2R + h2D + h2U + h5L + h5R + h5D + h5U) * 0.125;
      const hRimMax = Math.max(h2L, h2R, h2D, h2U, h5L, h5R, h5D, h5U);
      const [r, g, bl] = terrainVertexAO(h, nx, ny, nz, hAvg, hRimAvg, hRimMax);
      vx[idx] = x;
      vy[idx] = h;
      vz[idx] = z;
      vnx[idx] = nx;
      vny[idx] = ny;
      vnz[idx] = nz;
      vcr[idx] = r;
      vcg[idx] = g;
      vcb[idx] = bl;
      vu[idx] = uCoord;
      vv[idx] = vCoord;
    }
  }

  const triCount = steps * steps * 2;
  const vertexCount = triCount * 3;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  let ptr = 0;
  let uvPtr = 0;

  const emitVert = (idx) => {
    positions[ptr] = vx[idx];
    positions[ptr + 1] = vy[idx];
    positions[ptr + 2] = vz[idx];
    normals[ptr] = vnx[idx];
    normals[ptr + 1] = vny[idx];
    normals[ptr + 2] = vnz[idx];
    colors[ptr] = vcr[idx];
    colors[ptr + 1] = vcg[idx];
    colors[ptr + 2] = vcb[idx];
    uvs[uvPtr] = vu[idx];
    uvs[uvPtr + 1] = vv[idx];
    ptr += 3;
    uvPtr += 2;
  };

  for (let iz = 0; iz < steps; iz += 1) {
    for (let ix = 0; ix < steps; ix += 1) {
      const i00 = iz * stride + ix;
      const i10 = i00 + 1;
      const i01 = i00 + stride;
      const i11 = i01 + 1;

      if ((ix + iz) % 2 === 0) {
        emitVert(i00); emitVert(i01); emitVert(i11);
        emitVert(i00); emitVert(i11); emitVert(i10);
      } else {
        emitVert(i00); emitVert(i01); emitVert(i10);
        emitVert(i10); emitVert(i01); emitVert(i11);
      }
    }
  }

  return { positions, normals, colors, uvs, vertexCount };
}

// --- Road Paths (Shared between Texture Painting, Road Ribbon, and Scenery) ---

const MAIN_ROAD_CTRL = [
  { x: -72, z: 152 },
  { x: -104, z: 144 },
  { x: -145, z: 122 },
  { x: -184, z: 94 },
  { x: -222, z: 70 },
  { x: -272, z: 38 },
];

const VILLAGE_LANE_CTRL = [
  { x: -194, z: 162 },
  { x: -206, z: 90 },
  { x: -220, z: 18 },
  { x: -234, z: -52 },
];

const COUNTRY_TRACK_EAST = [
  { x: 52, z: 360 },
  { x: 118, z: 280 },
  { x: 162, z: 145 },
  { x: 185, z: -30 },
  { x: 245, z: -185 },
  { x: 350, z: -340 },
  { x: 465, z: -510 },
];

const COUNTRY_TRACK_RIVER = [
  { x: 64, z: 980 },
  { x: 120, z: 760 },
  { x: 165, z: 540 },
  { x: 150, z: 350 },
  { x: 162, z: 145 },
];

const COUNTRY_TRACK_VALLEY_EAST = [
  { x: 420, z: 860 },
  { x: 480, z: 620 },
  { x: 515, z: 360 },
  { x: 495, z: 110 },
  { x: 545, z: -140 },
  { x: 640, z: -360 },
];

const COUNTRY_TRACK_CROSS = [
  { x: -130, z: 540 },
  { x: 30, z: 515 },
  { x: 165, z: 540 },
  { x: 310, z: 590 },
  { x: 480, z: 620 },
  { x: 690, z: 640 },
];

const COUNTRY_TRACK_WEST = [
  { x: -268, z: 40 },
  { x: -410, z: -45 },
  { x: -570, z: -165 },
  { x: -720, z: -340 },
  { x: -860, z: -520 },
];

const COUNTRY_TRACK_SOUTH = [
  { x: -194, z: 162 },
  { x: -175, z: 340 },
  { x: -130, z: 540 },
  { x: -210, z: 780 },
  { x: -340, z: 1020 },
];

function sampleCatmullRom(pts, spacing = 6) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const segLen = Math.hypot(p2.x - p1.x, p2.z - p1.z);
    const steps = Math.max(2, Math.ceil(segLen / spacing));
    for (let s = 0; s < steps; s += 1) {
      if (i > 0 && s === 0) continue;
      const t = s / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      const x = 0.5 * (
        (2 * p1.x) +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
      );
      const z = 0.5 * (
        (2 * p1.z) +
        (-p0.z + p2.z) * t +
        (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 +
        (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3
      );
      out.push({ x, z });
    }
  }
  out.push({ ...pts[pts.length - 1] });
  return out;
}

const ROAD_SAMPLES_MAIN = sampleCatmullRom(MAIN_ROAD_CTRL, 5);
const ROAD_SAMPLES_LANE = sampleCatmullRom(VILLAGE_LANE_CTRL, 5);
const TRACK_SAMPLES_EAST = sampleCatmullRom(COUNTRY_TRACK_EAST, 8);
const TRACK_SAMPLES_RIVER = sampleCatmullRom(COUNTRY_TRACK_RIVER, 8);
const TRACK_SAMPLES_VALLEY_EAST = sampleCatmullRom(COUNTRY_TRACK_VALLEY_EAST, 8);
const TRACK_SAMPLES_CROSS = sampleCatmullRom(COUNTRY_TRACK_CROSS, 8);
const TRACK_SAMPLES_WEST = sampleCatmullRom(COUNTRY_TRACK_WEST, 8);
const TRACK_SAMPLES_SOUTH = sampleCatmullRom(COUNTRY_TRACK_SOUTH, 8);

function distToPolylineSq(x, z, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const ax = pts[i].x;
    const az = pts[i].z;
    const bx = pts[i + 1].x;
    const bz = pts[i + 1].z;
    const dx = bx - ax;
    const dz = bz - az;
    const lenSq = dx * dx + dz * dz || 1;
    const t = clamp(((x - ax) * dx + (z - az) * dz) / lenSq, 0, 1);
    const px = ax + dx * t;
    const pz = az + dz * t;
    const dSq = (x - px) * (x - px) + (z - pz) * (z - pz);
    if (dSq < best) best = dSq;
  }
  return best;
}

function isNearRoad(x, z, margin = 8) {
  const mSq = margin * margin;
  return (
    distToPolylineSq(x, z, ROAD_SAMPLES_MAIN) < mSq ||
    distToPolylineSq(x, z, ROAD_SAMPLES_LANE) < mSq ||
    distToPolylineSq(x, z, TRACK_SAMPLES_EAST) < mSq * 0.7 ||
    distToPolylineSq(x, z, TRACK_SAMPLES_RIVER) < mSq * 0.7 ||
    distToPolylineSq(x, z, TRACK_SAMPLES_VALLEY_EAST) < mSq * 0.7 ||
    distToPolylineSq(x, z, TRACK_SAMPLES_CROSS) < mSq * 0.7 ||
    distToPolylineSq(x, z, TRACK_SAMPLES_WEST) < mSq * 0.7 ||
    distToPolylineSq(x, z, TRACK_SAMPLES_SOUTH) < mSq * 0.7
  );
}

// --- Procedural High-Res Canvas Textures ---

function makeCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

/**
 * 1024x1024 blended zone-tint & road/shoreline map covering the 10,400m world.
 * Multiplied with the aerial photo tex-ground.jpg in SOLID_FS so each biome reads distinctly.
 */
export function buildGroundTextureCanvas() {
  const SIZE = 1024;
  const BASE = 512;

  const baseCanvas = makeCanvas(BASE, BASE);
  const bCtx = baseCanvas.getContext('2d');
  const img = bCtx.createImageData(BASE, BASE);
  const data = img.data;

  for (let py = 0; py < BASE; py += 1) {
    const z = (py / (BASE - 1) - 0.5) * WORLD.size;
    for (let px = 0; px < BASE; px += 1) {
      const x = (px / (BASE - 1) - 0.5) * WORLD.size;
      const y = sampleMeshHeight(x, z);
      const ny = terrainNormalY(x, z);
      const zones = sampleZoneWeights(x, z);

      const nBio = fbm2D(x * 0.0014 + 5.1, z * 0.0014 - 3.7, 3, 91);
      const nMicro = fbm2D(x * 0.007 - 2.3, z * 0.007 + 6.4, 2, 202);
      const shade = 0.90 + nMicro * 0.20;

      // Zone 1: Farmland neutral warm tint so tex-ground.jpg patchwork shines naturally
      let r = lerp(0.92, 1.04, nBio);
      let g = lerp(0.92, 1.00, nBio);
      let b = lerp(0.84, 0.92, nBio);

      // Zone 2: Dense forest (deeper dark pine/moss green)
      if (zones.forest > 0.001) {
        const fTint = 0.85 + 0.25 * nBio;
        r = lerp(r, 0.36 * fTint, zones.forest * 0.88);
        g = lerp(g, 0.56 * fTint, zones.forest * 0.88);
        b = lerp(b, 0.32 * fTint, zones.forest * 0.88);
      }

      // Zone 3: Wetland / marsh (olive-ochre reeds & waterlogged dark mud)
      if (zones.wetland > 0.001) {
        const mud = smooth01((3.2 - y) / 2.8);
        const wR = lerp(0.64, 0.44, mud);
        const wG = lerp(0.66, 0.48, mud);
        const wB = lerp(0.42, 0.34, mud);
        r = lerp(r, wR, zones.wetland * 0.85);
        g = lerp(g, wG, zones.wetland * 0.85);
        b = lerp(b, wB, zones.wetland * 0.85);
      }

      // Zone 4: West/North mountains & alpine ridges (grass-green -> dry brown earth)
      if (zones.mountain > 0.001) {
        const dry = smooth01((y - 55) / 85);
        const mR = lerp(0.46, 0.66, dry);
        const mG = lerp(0.58, 0.56, dry);
        const mB = lerp(0.32, 0.44, dry);
        r = lerp(r, mR, zones.mountain * 0.86);
        g = lerp(g, mG, zones.mountain * 0.86);
        b = lerp(b, mB, zones.mountain * 0.86);
      }

      // Zone 5: East High Sandstone Plateau (warm sage-ochre mesa top) & Rolling Foothills
      if (zones.plateau > 0.001) {
        const pR = lerp(0.56, 0.72, nBio);
        const pG = lerp(0.58, 0.60, nBio);
        const pB = lerp(0.34, 0.40, nBio);
        r = lerp(r, pR, zones.plateau * 0.82);
        g = lerp(g, pG, zones.plateau * 0.82);
        b = lerp(b, pB, zones.plateau * 0.82);
      }
      if (zones.hills > 0.001) {
        const hDry = smooth01((y - 75) / 110);
        const hR = lerp(0.48, 0.68, hDry);
        const hG = lerp(0.62, 0.58, hDry);
        const hB = lerp(0.32, 0.38, hDry);
        r = lerp(r, hR, zones.hills * 0.78);
        g = lerp(g, hG, zones.hills * 0.78);
        b = lerp(b, hB, zones.hills * 0.78);
      }

      // Zone 6 & 7: Town & Airfield neat mowed green turf
      const civicTurf = clamp(zones.airport + zones.town * 0.78, 0, 1);
      if (civicTurf > 0.001) {
        r = lerp(r, 0.58, civicTurf * 0.72);
        g = lerp(g, 0.74, civicTurf * 0.72);
        b = lerp(b, 0.48, civicTurf * 0.72);
      }

      // Steep rocky cliff faces & high ridges anywhere
      const slopeRock = smooth01((0.85 - ny) / 0.16);
      const highRock = smooth01((y - 110) / 70);
      const rockMix = clamp(Math.max(slopeRock, highRock * 0.88), 0, 1);
      if (rockMix > 0.001) {
        const strata = 0.90 + 0.10 * Math.sin(y * 0.28 + nBio * 7.0);
        r = lerp(r, 0.66 * strata, rockMix * 0.82);
        g = lerp(g, 0.62 * strata, rockMix * 0.82);
        b = lerp(b, 0.56 * strata, rockMix * 0.82);
      }

      // Warm sand & wet silt along riverbanks and lake shorelines (relative to local water elevation)
      const relY = y - waterLevelAt(x, z);
      const sandMix = 1 - smooth01((relY - 0.35) / 3.2);
      if (sandMix > 0.001) {
        const wet = 1 - smooth01((relY + 0.3) / 1.2);
        r = lerp(r, lerp(0.84, 0.64, wet), sandMix * 0.86);
        g = lerp(g, lerp(0.76, 0.58, wet), sandMix * 0.86);
        b = lerp(b, lerp(0.56, 0.48, wet), sandMix * 0.86);
      }

      // Keep high alpine slopes & steep canyon cliffs neutral so photo rock/snowrock/snow read cleanly
      const alpineNeutral = smooth01((y - 210) / 80);
      const cliffNeutral = smooth01((0.76 - ny) / 0.14);
      const keepNeutral = clamp(Math.max(alpineNeutral, cliffNeutral), 0, 1);
      if (keepNeutral > 0.001) {
        r = lerp(r, 0.96, keepNeutral * 0.88);
        g = lerp(g, 0.96, keepNeutral * 0.88);
        b = lerp(b, 0.96, keepNeutral * 0.88);
      }

      // Encode flat lowland farmland mask into alpha? NO: 2D canvas drawImage premultiplies RGB by alpha,
      // which would zero RGB wherever alpha=0! Keep groundTex alpha=255 and expose buildFarmMaskCanvas() separately.
      const idx = (py * BASE + px) * 4;
      data[idx] = Math.round(clamp(r * shade, 0, 1) * 255);
      data[idx + 1] = Math.round(clamp(g * shade, 0, 1) * 255);
      data[idx + 2] = Math.round(clamp(b * shade, 0, 1) * 255);
      data[idx + 3] = 255;
    }
  }
  bCtx.putImageData(img, 0, 0);

  const canvas = makeCanvas(SIZE, SIZE);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(baseCanvas, 0, 0, SIZE, SIZE);

  const worldToPx = (wx, wz) => [
    (wx / WORLD.size + 0.5) * SIZE,
    (wz / WORLD.size + 0.5) * SIZE,
  ];
  const pxPerMeter = SIZE / WORLD.size;

  // Airfield mowed grass striping & compacted dirt pad
  ctx.save();
  const [afX0, afZ0] = worldToPx(-98, -335);
  const [afX1, afZ1] = worldToPx(98, 375);
  ctx.beginPath();
  ctx.rect(afX0, afZ0, afX1 - afX0, afZ1 - afZ0);
  ctx.clip();
  for (let sx = -96; sx <= 96; sx += 8) {
    const [lx0] = worldToPx(sx, 0);
    const [lx1] = worldToPx(sx + 4, 0);
    ctx.fillStyle = ((sx / 8) | 0) % 2 === 0 ? 'rgba(255, 255, 220, 0.08)' : 'rgba(24, 48, 18, 0.10)';
    ctx.fillRect(lx0, afZ0, Math.max(1, lx1 - lx0), afZ1 - afZ0);
  }
  ctx.restore();

  // Dirt tracks & town approach road painted softly into zone map
  const paintDirtTrack = (pts, widthM, alpha) => {
    const pxPts = pts.map((p) => worldToPx(p.x, p.z));
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pxPts[0][0], pxPts[0][1]);
    for (let i = 1; i < pxPts.length; i += 1) ctx.lineTo(pxPts[i][0], pxPts[i][1]);
    ctx.strokeStyle = `rgba(148, 128, 98, ${alpha})`;
    ctx.lineWidth = Math.max(1.5, widthM * pxPerMeter);
    ctx.stroke();
    ctx.restore();
  };

  paintDirtTrack(TRACK_SAMPLES_EAST, 7.0, 0.72);
  paintDirtTrack(TRACK_SAMPLES_RIVER, 7.0, 0.72);
  paintDirtTrack(TRACK_SAMPLES_VALLEY_EAST, 7.0, 0.68);
  paintDirtTrack(TRACK_SAMPLES_CROSS, 7.0, 0.72);
  paintDirtTrack(TRACK_SAMPLES_WEST, 6.8, 0.65);
  paintDirtTrack(TRACK_SAMPLES_SOUTH, 6.8, 0.65);
  paintDirtTrack(ROAD_SAMPLES_MAIN, 8.2, 0.55);
  paintDirtTrack(ROAD_SAMPLES_LANE, 7.0, 0.52);

  return canvas;
}

/**
 * 512x512 farmland valley zone mask (RGB = 1 on flat valley plains, 0 on hills/mountains/forest/north).
 * Kept separate from groundTex so 2D canvas alpha premultiplication never darkens groundTex RGB.
 */
export function buildFarmMaskCanvas() {
  const SIZE = 512;
  const canvas = makeCanvas(SIZE, SIZE);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(SIZE, SIZE);
  const data = img.data;

  for (let py = 0; py < SIZE; py += 1) {
    const z = (py / (SIZE - 1) - 0.5) * WORLD.size;
    for (let px = 0; px < SIZE; px += 1) {
      const x = (px / (SIZE - 1) - 0.5) * WORLD.size;
      const y = sampleMeshHeight(x, z);
      const ny = terrainNormalY(x, z);
      const zones = sampleZoneWeights(x, z);

      const northExclude = smooth01((z - (-900)) / 420);
      const southExclude = 1 - smooth01((z - 1950) / 450);
      const farmZone =
        smooth01((zones.farmland - 0.34) / 0.42) *
        (1 - smooth01((zones.mountain - 0.04) / 0.14)) *
        (1 - smooth01((zones.plateau - 0.06) / 0.16)) *
        (1 - smooth01((zones.hills - 0.12) / 0.24)) *
        (1 - smooth01((zones.forest - 0.22) / 0.34)) *
        (1 - smooth01((zones.wetland - 0.22) / 0.34)) *
        (1 - smooth01((zones.lake - 0.02) / 0.12)) *
        northExclude *
        southExclude;
      const flatGentle = smooth01((ny - 0.935) / 0.05);
      const lowAlt = 1 - smooth01((y - 36) / 24);
      const v = Math.round(clamp(farmZone * flatGentle * lowAlt, 0, 1) * 255);

      const idx = (py * SIZE + px) * 4;
      data[idx] = v;
      data[idx + 1] = v;
      data[idx + 2] = v;
      data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/**
 * 1024x1024 seamlessly tileable fine ground detail texture (grass blades, soil grain, rock grit).
 * Neutral gray (~0.5) so shader can multiply cleanly across terrain & asphalt.
 */
export function buildDetailTextureCanvas() {
  const SIZE = 512;
  const canvas = makeCanvas(SIZE, SIZE);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(SIZE, SIZE);
  const data = img.data;

  // Periodic multi-octave toroidal noise
  const periodicNoise = (x, y, period, seed) => {
    const gx = (x / SIZE) * period;
    const gy = (y / SIZE) * period;
    const ix0 = Math.floor(gx) % period;
    const iy0 = Math.floor(gy) % period;
    const ix1 = (ix0 + 1) % period;
    const iy1 = (iy0 + 1) % period;
    const fx = gx - Math.floor(gx);
    const fy = gy - Math.floor(gy);
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = cellHash(ix0, iy0, seed);
    const b = cellHash(ix1, iy0, seed);
    const c = cellHash(ix0, iy1, seed);
    const d = cellHash(ix1, iy1, seed);
    return lerp(lerp(a, b, sx), lerp(c, d, sx), sy);
  };

  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const n1 = periodicNoise(x, y, 8, 11);
      const n2 = periodicNoise(x, y, 24, 37);
      const n3 = periodicNoise(x, y, 64, 73);
      const n4 = periodicNoise(x, y, 128, 131);
      const v = n1 * 0.34 + n2 * 0.30 + n3 * 0.22 + n4 * 0.14;
      const lum = Math.round(clamp(v, 0, 1) * 255);
      const idx = (y * SIZE + x) * 4;
      data[idx] = lum;
      data[idx + 1] = lum;
      data[idx + 2] = lum;
      data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // Add subtle wrapped grass-blade / pebble strokes for crisp low-altitude detail
  const rand = createRandom(77331);
  ctx.lineWidth = 1.4;
  for (let i = 0; i < 3200; i += 1) {
    const x = rand() * SIZE;
    const y = rand() * SIZE;
    const ang = rand() * Math.PI * 2;
    const len = 3.0 + rand() * 5.0;
    const light = rand() > 0.5;
    ctx.strokeStyle = light ? 'rgba(215, 220, 200, 0.16)' : 'rgba(38, 42, 30, 0.18)';
    for (let ox = -1; ox <= 1; ox += 1) {
      for (let oy = -1; oy <= 1; oy += 1) {
        const px = x + ox * SIZE;
        const py = y + oy * SIZE;
        if (px < -10 || px > SIZE + 10 || py < -10 || py > SIZE + 10) continue;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + Math.cos(ang) * len, py + Math.sin(ang) * len);
        ctx.stroke();
      }
    }
  }

  return canvas;
}

/**
 * 512x2048 high-res procedural Runway 36 asphalt texture with aggregate grain,
 * tar cracks, tire rubber skid marks, threshold piano keys, aiming bars, "36"/"18",
 * and centerline/edge stripes.
 */
export function buildRunwayTextureCanvas() {
  const W = 512;
  const H = 2048;
  const canvas = makeCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const rand = createRandom(3618);

  // 1. Weathered dark slate asphalt base
  ctx.fillStyle = '#2b2e34';
  ctx.fillRect(0, 0, W, H);

  // Subtle longitudinal paving machine lanes
  for (let lane = 0; lane < 6; lane += 1) {
    const lx = (lane / 6) * W;
    const lw = W / 6;
    ctx.fillStyle = lane % 2 === 0 ? 'rgba(255,255,255,0.018)' : 'rgba(0,0,0,0.024)';
    ctx.fillRect(lx, 0, lw, H);
  }

  // Softly worn brighter/grittier asphalt center & shoulder weathering
  const edgeGrad = ctx.createLinearGradient(0, 0, W, 0);
  edgeGrad.addColorStop(0, 'rgba(62, 60, 54, 0.45)');
  edgeGrad.addColorStop(0.06, 'rgba(42, 44, 48, 0.0)');
  edgeGrad.addColorStop(0.94, 'rgba(42, 44, 48, 0.0)');
  edgeGrad.addColorStop(1, 'rgba(62, 60, 54, 0.45)');
  ctx.fillStyle = edgeGrad;
  ctx.fillRect(0, 0, W, H);

  // Tiled fine asphalt aggregate noise
  const grain = makeCanvas(256, 256);
  const gCtx = grain.getContext('2d');
  const gImg = gCtx.createImageData(256, 256);
  for (let i = 0; i < 256 * 256; i += 1) {
    const v = 96 + Math.floor(rand() * 68);
    const idx = i * 4;
    gImg.data[idx] = v;
    gImg.data[idx + 1] = v + 1;
    gImg.data[idx + 2] = v + 4;
    gImg.data[idx + 3] = 42;
  }
  gCtx.putImageData(gImg, 0, 0);
  ctx.fillStyle = ctx.createPattern(grain, 'repeat');
  ctx.fillRect(0, 0, W, H);

  // Subtle meandering tar-sealed cracks
  ctx.strokeStyle = 'rgba(18, 19, 22, 0.42)';
  ctx.lineWidth = 1.3;
  for (let c = 0; c < 36; c += 1) {
    let cx = 24 + rand() * (W - 48);
    let cy = 30 + rand() * (H - 60);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    for (let s = 0; s < 7; s += 1) {
      cx += (rand() - 0.5) * 26;
      cy += (rand() - 0.5) * 44;
      ctx.lineTo(cx, cy);
    }
    ctx.stroke();
  }

  // Helper converting world runway coords (x in [-22,22], z in [-280,320]) to canvas px
  const rwX = (x) => ((x + RUNWAY.halfWidth) / RUNWAY.width) * W;
  const rwZ = (z) => ((z - RUNWAY.zEnd) / RUNWAY.length) * H;
  const rwRect = (x0, x1, z0, z1, fill) => {
    const px0 = rwX(x0);
    const px1 = rwX(x1);
    const py0 = rwZ(z0);
    const py1 = rwZ(z1);
    ctx.fillStyle = fill;
    ctx.fillRect(Math.min(px0, px1), Math.min(py0, py1), Math.abs(px1 - px0), Math.abs(py1 - py0));
  };

  const paintWhite = '#e8e4da';

  // Side edge solid white stripes
  rwRect(-RUNWAY.halfWidth + 0.9, -RUNWAY.halfWidth + 1.85, RUNWAY.zEnd + 3, RUNWAY.zStart - 3, paintWhite);
  rwRect(RUNWAY.halfWidth - 1.85, RUNWAY.halfWidth - 0.9, RUNWAY.zEnd + 3, RUNWAY.zStart - 3, paintWhite);

  // Threshold bars
  rwRect(-RUNWAY.halfWidth + 1.8, RUNWAY.halfWidth - 1.8, RUNWAY.zStart - 3.5, RUNWAY.zStart - 2.0, paintWhite);
  rwRect(-RUNWAY.halfWidth + 1.8, RUNWAY.halfWidth - 1.8, RUNWAY.zEnd + 2.0, RUNWAY.zEnd + 3.5, paintWhite);

  // Threshold piano keys at both ends
  for (let i = -3; i <= 3; i += 1) {
    if (i === 0) continue;
    const x = i * 5.2;
    rwRect(x - 1.3, x + 1.3, RUNWAY.zStart - 25, RUNWAY.zStart - 6, paintWhite);
    rwRect(x - 1.3, x + 1.3, RUNWAY.zEnd + 6, RUNWAY.zEnd + 25, paintWhite);
  }

  // Aiming point bars (thick 1000ft-style markers)
  rwRect(-10.5, -5.5, RUNWAY.zStart - 132, RUNWAY.zStart - 102, paintWhite);
  rwRect(5.5, 10.5, RUNWAY.zStart - 132, RUNWAY.zStart - 102, paintWhite);
  rwRect(-10.5, -5.5, RUNWAY.zEnd + 102, RUNWAY.zEnd + 132, paintWhite);
  rwRect(5.5, 10.5, RUNWAY.zEnd + 102, RUNWAY.zEnd + 132, paintWhite);

  // Touchdown zone bars
  for (const offset of [78, 158]) {
    rwRect(-9.2, -7.2, RUNWAY.zStart - offset - 14, RUNWAY.zStart - offset, paintWhite);
    rwRect(7.2, 9.2, RUNWAY.zStart - offset - 14, RUNWAY.zStart - offset, paintWhite);
    rwRect(-9.2, -7.2, RUNWAY.zEnd + offset, RUNWAY.zEnd + offset + 14, paintWhite);
    rwRect(7.2, 9.2, RUNWAY.zEnd + offset, RUNWAY.zEnd + offset + 14, paintWhite);
  }

  // Crisp painted runway designator numbers ("36" at south threshold, "18" at north end)
  const drawRunwayNumber = (label, zCenter, flip180) => {
    ctx.save();
    ctx.translate(rwX(0), rwZ(zCenter));
    if (flip180) ctx.rotate(Math.PI);
    // Runway aspect ratio on canvas is compressed horizontally relative to world meters
    // World width = 44m -> 512px (11.64 px/m), world length = 600m -> 2048px (3.41 px/m)
    // Scale Y down so numbers look properly elongated on the ground in world meters
    ctx.scale(1.0, (2048 / 600) / (512 / 44) * 2.1);
    ctx.fillStyle = paintWhite;
    ctx.font = 'bold 148px "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 0, 0);
    ctx.restore();
  };
  drawRunwayNumber('36', RUNWAY.zStart - 48, false);
  drawRunwayNumber('18', RUNWAY.zEnd + 48, true);

  // Dashed centerline
  for (let z = RUNWAY.zEnd + 74; z <= RUNWAY.zStart - 90; z += 34) {
    rwRect(-0.85, 0.85, z, z + 18, paintWhite);
  }

  // Yellow taxiway lead-off curve on west edge toward apron (z ~ 70..170)
  ctx.save();
  ctx.strokeStyle = '#d4a638';
  ctx.lineWidth = 4.5;
  ctx.beginPath();
  ctx.moveTo(rwX(-1.5), rwZ(115));
  ctx.quadraticCurveTo(rwX(-12), rwZ(115), rwX(-RUNWAY.halfWidth), rwZ(132));
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(rwX(-1.5), rwZ(165));
  ctx.quadraticCurveTo(rwX(-12), rwZ(165), rwX(-RUNWAY.halfWidth), rwZ(150));
  ctx.stroke();
  ctx.restore();

  // Rubber tire skid marks concentrated in both touchdown zones (layered over paint!)
  for (const tdZ of [RUNWAY.zStart - 105, RUNWAY.zEnd + 105]) {
    for (let s = 0; s < 48; s += 1) {
      const side = s % 2 === 0 ? -1 : 1;
      const sx = side * (1.2 + rand() * 3.8) + (rand() - 0.5) * 1.4;
      const sz = tdZ + (rand() - 0.5) * 75;
      const len = 14 + rand() * 32;
      const px = rwX(sx);
      const py0 = rwZ(sz - len * 0.5);
      const py1 = rwZ(sz + len * 0.5);
      const g = ctx.createLinearGradient(px, py0, px, py1);
      g.addColorStop(0, 'rgba(12, 13, 15, 0)');
      g.addColorStop(0.25, 'rgba(12, 13, 15, 0.18)');
      g.addColorStop(0.75, 'rgba(12, 13, 15, 0.18)');
      g.addColorStop(1, 'rgba(12, 13, 15, 0)');
      ctx.strokeStyle = g;
      ctx.lineWidth = 1.6 + rand() * 2.2;
      ctx.beginPath();
      ctx.moveTo(px, py0);
      ctx.lineTo(px + (rand() - 0.5) * 3, py1);
      ctx.stroke();
    }
  }

  // Subtle asphalt wear speckle across painted markings so paint isn't sterile white
  ctx.fillStyle = 'rgba(43, 46, 52, 0.22)';
  for (let i = 0; i < 1800; i += 1) {
    const sx = rand() * W;
    const sy = rand() * H;
    ctx.fillRect(sx, sy, 1.5, 2.5);
  }

  return canvas;
}

/**
 * 512x512 seamless periodic water ripple normal map for animated golden-hour water reflection & sun glint.
 */
export function buildWaterNormalCanvas() {
  const SIZE = 512;
  const canvas = makeCanvas(SIZE, SIZE);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(SIZE, SIZE);
  const data = img.data;

  // Periodic wave components (integer cycles over SIZE so tile edges match seamlessly)
  const waves = [
    { fx: 2, fy: 3, amp: 0.42, phase: 0.4 },
    { fx: -4, fy: 2, amp: 0.30, phase: 1.7 },
    { fx: 5, fy: -5, amp: 0.24, phase: 2.9 },
    { fx: 9, fy: 4, amp: 0.16, phase: 0.8 },
    { fx: -7, fy: 10, amp: 0.12, phase: 4.1 },
    { fx: 14, fy: -11, amp: 0.09, phase: 1.3 },
    { fx: -17, fy: -15, amp: 0.06, phase: 5.0 },
  ];

  const twoPi = Math.PI * 2;
  for (let y = 0; y < SIZE; y += 1) {
    const v = y / SIZE;
    for (let x = 0; x < SIZE; x += 1) {
      const u = x / SIZE;
      let dhdx = 0;
      let dhdy = 0;
      for (let w = 0; w < waves.length; w += 1) {
        const wv = waves[w];
        const arg = twoPi * (wv.fx * u + wv.fy * v) + wv.phase;
        const c = Math.cos(arg);
        dhdx += wv.amp * wv.fx * c;
        dhdy += wv.amp * wv.fy * c;
      }
      // Scale slope softly for realistic water normal perturbation
      const scale = 0.048;
      let nx = -dhdx * scale;
      let ny = -dhdy * scale;
      let nz = 1.0;
      const invLen = 1 / Math.hypot(nx, ny, nz);
      nx *= invLen;
      ny *= invLen;
      nz *= invLen;

      const idx = (y * SIZE + x) * 4;
      data[idx] = Math.round((nx * 0.5 + 0.5) * 255);
      data[idx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      data[idx + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// --- Water Mesh (Lake at 0m + Canyon/River at -124m, Depth-tagged) ---

export function buildWaterMesh() {
  const b = createBuilder();
  const steps = 112;
  const stepSize = WORLD.size / steps;

  const emitWaterVert = (x, z, waterY, flowMode = 'river') => {
    const h = sampleMeshHeight(x, z);
    const depth = clamp((waterY - h) / 4.8, 0, 1);
    let fx = 0.0;
    let fz = 0.0;
    if (flowMode === 'river') {
      const rc = riverCenterX(z);
      const slopeX = (riverCenterX(z + 20) - riverCenterX(z - 20)) / 40;
      const len = Math.hypot(slopeX, 1) || 1;
      const inChannel = 1 - smooth01((Math.abs(x - rc) - 65) / 85);
      const rushSpeed = lerp(0.46, 0.96, inChannel);
      fx = (slopeX / len) * rushSpeed;
      fz = (1 / len) * rushSpeed;
    } else if (flowMode === 'mirror') {
      const dx = riverCenterX(WATERFALL_Z_TOP) - x;
      const dz = (WATERFALL_Z_TOP + 120) - z;
      const d = Math.hypot(dx, dz) || 1;
      const pull = lerp(0.14, 0.36, 1 - smooth01((d - 120) / 650));
      fx = (dx / d) * pull;
      fz = (dz / d) * pull;
    } else {
      fx = 0.14;
      fz = 0.10;
    }
    b.pushVert(x, waterY, z, 0, 1, 0, depth, fx * 0.5 + 0.5, fz * 0.5 + 0.5);
  };

  const emitCell = (x0, x1, z0, z1, waterY, flowMode = 'river', maxTerrainClear = 5.5) => {
    const cx = (x0 + x1) * 0.5;
    const cz = (z0 + z1) * 0.5;
    const cornerClear = Math.min(maxTerrainClear, 3.5);
    if (
      sampleMeshHeight(cx, cz) < waterY + maxTerrainClear ||
      sampleMeshHeight(x0, z0) < waterY + cornerClear ||
      sampleMeshHeight(x1, z0) < waterY + cornerClear ||
      sampleMeshHeight(x0, z1) < waterY + cornerClear ||
      sampleMeshHeight(x1, z1) < waterY + cornerClear
    ) {
      emitWaterVert(x0, z0, waterY, flowMode);
      emitWaterVert(x0, z1, waterY, flowMode);
      emitWaterVert(x1, z1, waterY, flowMode);
      emitWaterVert(x0, z0, waterY, flowMode);
      emitWaterVert(x1, z1, waterY, flowMode);
      emitWaterVert(x1, z0, waterY, flowMode);
    }
  };

  // Curved organic lake-outlet lip boundary so Mirror Lake never terminates in a straight ruler line
  const wfCenterTop = riverCenterX(WATERFALL_Z_TOP);
  const lakeOutletLipZ = (x) => {
    const dx = x - wfCenterTop;
    const mainChute = Math.exp(-Math.pow((dx + 1) / 30, 2));
    const westChute = Math.exp(-Math.pow((dx + 39) / 16, 2)) * 0.85;
    const eastChute = Math.exp(-Math.pow((dx - 34) / 14, 2)) * 0.80;
    const chute = Math.max(mainChute, westChute, eastChute);
    const wave = 5.5 * Math.sin(x * 0.11 + 0.4) + 3.2 * Math.cos(x * 0.24 - 0.8);
    return WATERFALL_Z_TOP - 32 + chute * 35 + wave;
  };

  const emitClippedLakeCell = (x0, x1, z0, z1) => {
    const clipZ0 = lakeOutletLipZ(x0);
    const clipZ1 = lakeOutletLipZ(x1);
    const cz0a = Math.min(z0, clipZ0);
    const cz1a = Math.min(z1, clipZ0);
    const cz0b = Math.min(z0, clipZ1);
    const cz1b = Math.min(z1, clipZ1);
    if (cz1a - cz0a < 0.25 && cz1b - cz0b < 0.25) return;
    const cx = (x0 + x1) * 0.5;
    const cz = ((cz0a + cz1a + cz0b + cz1b) * 0.25);
    if (
      sampleMeshHeight(cx, cz) < WORLD.waterY + 1.8 ||
      sampleMeshHeight(x0, cz0a) < WORLD.waterY + 1.4 ||
      sampleMeshHeight(x1, cz0b) < WORLD.waterY + 1.4 ||
      sampleMeshHeight(x0, cz1a) < WORLD.waterY + 1.4 ||
      sampleMeshHeight(x1, cz1b) < WORLD.waterY + 1.4
    ) {
      emitWaterVert(x0, cz0a, WORLD.waterY, 'mirror');
      emitWaterVert(x0, cz1a, WORLD.waterY, 'mirror');
      emitWaterVert(x1, cz1b, WORLD.waterY, 'mirror');
      emitWaterVert(x0, cz0a, WORLD.waterY, 'mirror');
      emitWaterVert(x1, cz1b, WORLD.waterY, 'mirror');
      emitWaterVert(x1, cz0b, WORLD.waterY, 'mirror');
    }
  };

  for (let iz = 0; iz < steps; iz += 1) {
    const z0 = -WORLD.half + iz * stepSize;
    const z1 = z0 + stepSize;
    const zMid = (z0 + z1) * 0.5;
    const inLake = z1 <= WATERFALL_Z_TOP - 45;
    const inRiver = z0 >= WATERFALL_Z_BOT - 12;
    if (!inLake && !inRiver) {
      // Finely subdivide lake-to-waterfall transition band with curved organic lip clipping
      const sub = 8;
      for (let sz = 0; sz < sub; sz += 1) {
        const az0 = lerp(z0, z1, sz / sub);
        const az1 = lerp(z0, z1, (sz + 1) / sub);
        const azMid = (az0 + az1) * 0.5;
        for (let ix = 0; ix < steps; ix += 1) {
          const x0 = -WORLD.half + ix * stepSize;
          const x1 = x0 + stepSize;
          const xMid = (x0 + x1) * 0.5;
          const nearOutlet = Math.abs(xMid - wfCenterTop) < 260;
          if (nearOutlet) {
            for (let sx = 0; sx < sub; sx += 1) {
              const ax0 = lerp(x0, x1, sx / sub);
              const ax1 = lerp(x0, x1, (sx + 1) / sub);
              const axMid = (ax0 + ax1) * 0.5;
              const lipZ = lakeOutletLipZ(axMid);
              if (az0 < lipZ) {
                emitClippedLakeCell(ax0, ax1, az0, az1);
              } else if (azMid >= WATERFALL_Z_BOT - 2) {
                emitCell(ax0, ax1, az0, az1, CANYON_WATER_Y, 'river');
              }
            }
          } else if (azMid <= WATERFALL_Z_TOP - 2) {
            emitCell(x0, x1, az0, az1, WORLD.waterY, 'mirror', 2.4);
          } else if (azMid >= WATERFALL_Z_BOT) {
            emitCell(x0, x1, az0, az1, CANYON_WATER_Y, 'river');
          }
        }
      }
      continue;
    }

      const waterY = inLake ? WORLD.waterY : CANYON_WATER_Y;
      const flowMode = inLake ? 'mirror' : 'river';
      const rCenter = riverCenterX(zMid);
      for (let ix = 0; ix < steps; ix += 1) {
        const x0 = -WORLD.half + ix * stepSize;
        const x1 = x0 + stepSize;
        if (inRiver && Math.abs((x0 + x1) * 0.5 - rCenter) < 240) {
          // Subdivide river corridor cells (6x6 near plunge pool, 3x3 downstream) so water sits cleanly inside canyon walls
          const sub = zMid < WATERFALL_Z_BOT + 65 ? 6 : 3;
          const maxClear = zMid < WATERFALL_Z_BOT + 65 ? 2.2 : 5.5;
          for (let sz = 0; sz < sub; sz += 1) {
            const az0 = lerp(z0, z1, sz / sub);
            const az1 = lerp(z0, z1, (sz + 1) / sub);
            for (let sx = 0; sx < sub; sx += 1) {
              emitCell(lerp(x0, x1, sx / sub), lerp(x0, x1, (sx + 1) / sub), az0, az1, waterY, 'river', maxClear);
            }
          }
        } else {
          emitCell(x0, x1, z0, z1, waterY, flowMode);
        }
      }
  }

  // Fine water meshes for West Glacier Tarn (y=195m) & East Highland Tarn (y=148m)
  const emitAlpineTarn = (spec, phase) => {
    const tSteps = 30;
    const xMin = spec.x - spec.rx * 1.25;
    const xMax = spec.x + spec.rx * 1.25;
    const zMin = spec.z - spec.rz * 1.25;
    const zMax = spec.z + spec.rz * 1.25;
    for (let iz = 0; iz < tSteps; iz += 1) {
      const z0 = lerp(zMin, zMax, iz / tSteps);
      const z1 = lerp(zMin, zMax, (iz + 1) / tSteps);
      const zm = (z0 + z1) * 0.5;
      for (let ix = 0; ix < tSteps; ix += 1) {
        const x0 = lerp(xMin, xMax, ix / tSteps);
        const x1 = lerp(xMin, xMax, (ix + 1) / tSteps);
        const xm = (x0 + x1) * 0.5;
        if (tarnMask(xm, zm, spec, phase) > 0.02) {
          emitCell(x0, x1, z0, z1, spec.y, 'tarn');
        }
      }
    }
  };
  emitAlpineTarn(GLACIER_TARN, 0.6);
  emitAlpineTarn(HIGHLAND_TARN, -0.8);

  return b.toMesh();
}

/** Multi-stream segmented waterfall cascades (7 staggered sub-streams in 3 unequal groups), ragged edges, and curved lake-lip glide. */
export function buildWaterfallMesh() {
  const b = createBuilder(true);
  const cols = 12;
  const rows = 30;

  // 3 asymmetric cascade groups split into 7 staggered sub-streams (1.5-3m wet-rock gaps, staggered bottom elevations & unequal widths)
  const streams = [
    // Main central cascade (3 sub-streams, widest overall ~11 -> 26m halfW span)
    { xOffTop: -10.5, xOffBot: -19.0, halfWTop: 3.4, halfWBot: 7.8, zLip: WATERFALL_Z_TOP - 20, zBot: WATERFALL_Z_BOT + 10, yBotOff: 2.2, ledge1: 0.31, ledge2: 0.67, weight: 0.96, seed: 0.14 },
    { xOffTop: -0.5,  xOffBot: -1.5,  halfWTop: 4.3, halfWBot: 9.5, zLip: WATERFALL_Z_TOP - 23, zBot: WATERFALL_Z_BOT + 12, yBotOff: -1.6, ledge1: 0.39, ledge2: 0.74, weight: 1.00, seed: 0.31 },
    { xOffTop: 9.0,   xOffBot: 16.5,  halfWTop: 3.1, halfWBot: 7.0, zLip: WATERFALL_Z_TOP - 19, zBot: WATERFALL_Z_BOT + 8,  yBotOff: 1.4, ledge1: 0.27, ledge2: 0.62, weight: 0.94, seed: 0.59 },
    // West cascade (2 sub-streams, medium width ~8.5 -> 13.5m halfW span, ends higher on ledge spray)
    { xOffTop: -43.5, xOffBot: -57.0, halfWTop: 3.6, halfWBot: 6.2, zLip: WATERFALL_Z_TOP - 15, zBot: WATERFALL_Z_BOT + 4,  yBotOff: 4.8, ledge1: 0.29, ledge2: 0.61, weight: 0.90, seed: 0.48 },
    { xOffTop: -33.5, xOffBot: -43.5, halfWTop: 3.8, halfWBot: 6.5, zLip: WATERFALL_Z_TOP - 17, zBot: WATERFALL_Z_BOT + 7,  yBotOff: 3.2, ledge1: 0.36, ledge2: 0.70, weight: 0.92, seed: 0.71 },
    // East cascade (2 sub-streams, narrowest ~6.5 -> 10.5m halfW span)
    { xOffTop: 29.0,  xOffBot: 39.0,  halfWTop: 3.0, halfWBot: 5.0, zLip: WATERFALL_Z_TOP - 15, zBot: WATERFALL_Z_BOT + 6,  yBotOff: -2.4, ledge1: 0.42, ledge2: 0.77, weight: 0.88, seed: 0.83 },
    { xOffTop: 37.5,  xOffBot: 50.5,  halfWTop: 2.5, halfWBot: 4.4, zLip: WATERFALL_Z_TOP - 13, zBot: WATERFALL_Z_BOT + 3,  yBotOff: 0.8,  ledge1: 0.34, ledge2: 0.68, weight: 0.85, seed: 0.95 },
  ];

  for (let si = 0; si < streams.length; si += 1) {
    const st = streams[si];
    const samplePt = (u, t) => {
      const s = u * 2 - 1;
      // Lengthened rounded lake-mouth glide (t=0..0.24) with curved upstream arc so lip blends smoothly into lake
      const lipT = smooth01(t / 0.24);
      const fallT = smooth01((t - 0.19) / 0.81);
      const zLipOut = WATERFALL_Z_TOP + 5;
      const lipArc = (1 - s * s) * 3.6;
      const zBase = t < 0.24
        ? lerp(st.zLip - lipArc, zLipOut, lipT)
        : lerp(zLipOut, st.zBot, Math.pow(fallT, 0.86));
      const cx = riverCenterX(zBase)
        + lerp(st.xOffTop, st.xOffBot, Math.pow(t, 0.88))
        + Math.sin(t * 4.8 + st.seed * 8.0) * 2.8
        + Math.cos(t * 9.6 - st.seed * 5.0) * 1.2;
      // Independent low-frequency left/right wobble (>=25% half-width) for ragged broken edges
      const leftWobble = 1.0 + 0.28 * Math.sin(t * 5.2 + st.seed * 7.3) + 0.14 * Math.cos(t * 11.4 + st.seed * 3.1);
      const rightWobble = 1.0 + 0.28 * Math.cos(t * 4.7 - st.seed * 9.1) + 0.14 * Math.sin(t * 10.8 - st.seed * 4.2);
      const wobble = lerp(leftWobble, rightWobble, u);
      const halfW = lerp(st.halfWTop, st.halfWBot, Math.pow(t, 0.78)) * wobble;
      const archBulge = (1 - s * s) * (2.6 + 6.2 * Math.sin(fallT * Math.PI * 0.74));
      const ledge1Kick = Math.exp(-Math.pow((t - st.ledge1) / 0.075, 2)) * 3.8;
      const ledge2Kick = Math.exp(-Math.pow((t - st.ledge2) / 0.075, 2)) * 3.1;
      const x = cx + s * halfW;
      const y = t < 0.24
        ? lerp(WORLD.waterY + 0.12, -3.2, Math.pow(lipT, 1.65))
        : lerp(-3.2, CANYON_WATER_Y - 1.2 + st.yBotOff, Math.pow(fallT, 1.08));
      const z = zBase + archBulge + ledge1Kick + ledge2Kick;
      const ledgeFoam = clamp((ledge1Kick + ledge2Kick) / 2.6 + (1 - Math.abs(t - 0.26) * 5.2) * 0.45, 0, 1);
      return {
        x,
        y,
        z,
        nx: s * 0.30,
        ny: lerp(0.86, 0.16, smooth01(t * 1.35)),
        nz: lerp(0.44, 0.94, smooth01(t * 1.35)),
        ledgeFoam,
      };
    };

    for (let r = 0; r < rows; r += 1) {
      const t0 = r / rows;
      const t1 = (r + 1) / rows;
      const v0 = t0 * 2.2;
      const v1 = t1 * 2.2;
      for (let c = 0; c < cols; c += 1) {
        const u0 = c / cols;
        const u1 = (c + 1) / cols;
        const p00 = samplePt(u0, t0);
        const p10 = samplePt(u1, t0);
        const p01 = samplePt(u0, t1);
        const p11 = samplePt(u1, t1);
        b.pushVert(p00.x, p00.y, p00.z, p00.nx, p00.ny, p00.nz, st.weight, st.seed, p00.ledgeFoam, u0, v0);
        b.pushVert(p01.x, p01.y, p01.z, p01.nx, p01.ny, p01.nz, st.weight, st.seed, p01.ledgeFoam, u0, v1);
        b.pushVert(p11.x, p11.y, p11.z, p11.nx, p11.ny, p11.nz, st.weight, st.seed, p11.ledgeFoam, u1, v1);

        b.pushVert(p00.x, p00.y, p00.z, p00.nx, p00.ny, p00.nz, st.weight, st.seed, p00.ledgeFoam, u0, v0);
        b.pushVert(p11.x, p11.y, p11.z, p11.nx, p11.ny, p11.nz, st.weight, st.seed, p11.ledgeFoam, u1, v1);
        b.pushVert(p10.x, p10.y, p10.z, p10.nx, p10.ny, p10.nz, st.weight, st.seed, p10.ledgeFoam, u1, v0);
      }
    }
  }
  return b.toMesh();
}

/** Craggy dark wet-rock ribs and sub-stream rock spines separating and flanking the waterfall cascades. */
export function buildWaterfallRocksMesh() {
  const b = createBuilder(true);
  const ribs = [
    // Primary wet rock buttresses separating West / Main / East cascades
    { xOffTop: -22.5, xOffBot: -30.0, halfWTop: 7.5, halfWBot: 11.5, protrude: 7.6, yTopOff: 0.4, seed: 1.2 },
    { xOffTop: 19.0,  xOffBot: 25.5,  halfWTop: 7.0, halfWBot: 10.5, protrude: 7.2, yTopOff: 0.4, seed: 2.7 },
    // Dark wet rock spines recessed behind sub-stream seams so narrow gaps reveal dark wet stone
    { xOffTop: -5.5,  xOffBot: -10.5, halfWTop: 3.4, halfWBot: 5.2,  protrude: 3.6, yTopOff: -2.0, seed: 3.3 },
    { xOffTop: 4.5,   xOffBot: 7.5,   halfWTop: 3.2, halfWBot: 4.8,  protrude: 3.4, yTopOff: -2.0, seed: 3.9 },
    { xOffTop: -38.5, xOffBot: -50.5, halfWTop: 3.2, halfWBot: 4.6,  protrude: 3.2, yTopOff: -2.0, seed: 4.6 },
    { xOffTop: 33.5,  xOffBot: 44.5,  halfWTop: 2.8, halfWBot: 4.2,  protrude: 3.0, yTopOff: -2.0, seed: 5.1 },
    // Outer wet flanking cliff spurs tucked smoothly into the rocky canyon-lip shoulders
    { xOffTop: -54.0, xOffBot: -71.0, halfWTop: 10.0, halfWBot: 14.0, protrude: 5.8, yTopOff: -0.8, seed: 4.1 },
    { xOffTop: 46.5,  xOffBot: 62.0,  halfWTop: 9.5,  halfWBot: 13.5, protrude: 5.8, yTopOff: -0.8, seed: 5.6 },
  ];

  const rows = 22;
  const cols = 7;
  for (let ri = 0; ri < ribs.length; ri += 1) {
    const rb = ribs[ri];
    const pt = (u, t) => {
      const s = u * 2 - 1;
      const zWall = lerp(WATERFALL_Z_TOP + 2, WATERFALL_Z_BOT + 4, Math.pow(t, 0.90));
      const strata = 1.0 + 0.34 * Math.sin(t * 24.0 + rb.seed) + 0.20 * Math.cos(t * 41.0 - rb.seed * 1.7 + s * 2.4);
      const ridgeProfile = Math.pow(Math.max(0, 1 - s * s), 1.15);
      const topTaper = smooth01(t / 0.16);
      const cx = riverCenterX(zWall) + lerp(rb.xOffTop, rb.xOffBot, t) + Math.sin(t * 8.5 + rb.seed) * 2.4;
      const hw = lerp(rb.halfWTop, rb.halfWBot, t) * (0.86 + 0.24 * Math.sin(t * 13.0 + rb.seed * 2.1));
      const x = cx + s * hw;
      const y = lerp(WORLD.waterY + rb.yTopOff, CANYON_WATER_Y - 3.5, Math.pow(t, 1.05));
      const z = zWall - 3.5 + ridgeProfile * rb.protrude * strata * topTaper * (0.35 + 0.65 * Math.sin(t * Math.PI * 0.92));
      const nx = s * 0.78;
      const ny = 0.22 + 0.18 * Math.cos(t * 24.0 + rb.seed);
      const nz = 0.58;
      const nLen = Math.hypot(nx, ny, nz) || 1;
      const wetDark = 0.34 + 0.14 * (1 - ridgeProfile) + 0.10 * Math.sin(t * 17.0 + s * 4.0 + rb.seed);
      return {
        x,
        y,
        z,
        nx: nx / nLen,
        ny: ny / nLen,
        nz: nz / nLen,
        cr: wetDark * 1.04,
        cg: wetDark * 0.74,
        cb: wetDark * 0.67,
        u: x / 56,
        v: -y / 38,
      };
    };

    for (let r = 0; r < rows; r += 1) {
      const t0 = r / rows;
      const t1 = (r + 1) / rows;
      for (let c = 0; c < cols; c += 1) {
        const u0 = c / cols;
        const u1 = (c + 1) / cols;
        const p00 = pt(u0, t0);
        const p10 = pt(u1, t0);
        const p01 = pt(u0, t1);
        const p11 = pt(u1, t1);
        b.pushVert(p00.x, p00.y, p00.z, p00.nx, p00.ny, p00.nz, p00.cr, p00.cg, p00.cb, p00.u, p00.v);
        b.pushVert(p01.x, p01.y, p01.z, p01.nx, p01.ny, p01.nz, p01.cr, p01.cg, p01.cb, p01.u, p01.v);
        b.pushVert(p11.x, p11.y, p11.z, p11.nx, p11.ny, p11.nz, p11.cr, p11.cg, p11.cb, p11.u, p11.v);

        b.pushVert(p00.x, p00.y, p00.z, p00.nx, p00.ny, p00.nz, p00.cr, p00.cg, p00.cb, p00.u, p00.v);
        b.pushVert(p11.x, p11.y, p11.z, p11.nx, p11.ny, p11.nz, p11.cr, p11.cg, p11.cb, p11.u, p11.v);
        b.pushVert(p10.x, p10.y, p10.z, p10.nx, p10.ny, p10.nz, p10.cr, p10.cg, p10.cb, p10.u, p10.v);
      }
    }
  }
  return b.toMesh();
}

/** Layered plunge-pool foam rings aligned to the 3 stream impacts + lake-lip whitewater transition + downstream wake. */
export function buildWaterfallFoamMesh() {
  const b = createBuilder(true);
  const segs = 28;
  const rings = 5;
  const emitFoamDisc = (cx, cz, y, rx, rz) => {
    for (let ring = 0; ring < rings; ring += 1) {
      const r0 = ring / rings;
      const r1 = (ring + 1) / rings;
      for (let s = 0; s < segs; s += 1) {
        const a0 = (s / segs) * Math.PI * 2;
        const a1 = ((s + 1) / segs) * Math.PI * 2;
        const c0 = Math.cos(a0);
        const s0 = Math.sin(a0);
        const c1 = Math.cos(a1);
        const s1 = Math.sin(a1);

        const u00 = c0 * r0;
        const v00 = s0 * r0;
        const u10 = c1 * r0;
        const v10 = s1 * r0;
        const u01 = c0 * r1;
        const v01 = s0 * r1;
        const u11 = c1 * r1;
        const v11 = s1 * r1;

        b.pushVert(cx + u00 * rx, y, cz + v00 * rz, 0, 1, 0, 1, 1, 1, u00, v00);
        b.pushVert(cx + u01 * rx, y, cz + v01 * rz, 0, 1, 0, 1, 1, 1, u01, v01);
        b.pushVert(cx + u11 * rx, y, cz + v11 * rz, 0, 1, 0, 1, 1, 1, u11, v11);

        b.pushVert(cx + u00 * rx, y, cz + v00 * rz, 0, 1, 0, 1, 1, 1, u00, v00);
        b.pushVert(cx + u11 * rx, y, cz + v11 * rz, 0, 1, 0, 1, 1, 1, u11, v11);
        b.pushVert(cx + u10 * rx, y, cz + v10 * rz, 0, 1, 0, 1, 1, 1, u10, v10);
      }
    }
  };
  // Plunge-pool impact foam discs (+25-30% radius, aligned to 3 cascade groups)
  const czMain = WATERFALL_Z_BOT + 18;
  emitFoamDisc(riverCenterX(czMain) - 1.5, czMain, CANYON_WATER_Y + 0.38, 44, 34);
  const czWest = WATERFALL_Z_BOT + 13;
  emitFoamDisc(riverCenterX(czWest) - 50, czWest, CANYON_WATER_Y + 0.34, 28, 23);
  const czEast = WATERFALL_Z_BOT + 14;
  emitFoamDisc(riverCenterX(czEast) + 44, czEast, CANYON_WATER_Y + 0.32, 26, 22);
  const czWake = WATERFALL_Z_BOT + 54;
  emitFoamDisc(riverCenterX(czWake), czWake, CANYON_WATER_Y + 0.24, 44, 66);

  // Irregular whitewater lip foam collars at lake-outlet entry so lake water transitions naturally into cascades
  const czLip = WATERFALL_Z_TOP - 8;
  const cxLip = riverCenterX(czLip);
  emitFoamDisc(cxLip - 1, czLip - 2, WORLD.waterY + 0.14, 24, 13);
  emitFoamDisc(cxLip - 38, czLip - 5, WORLD.waterY + 0.14, 15, 10);
  emitFoamDisc(cxLip + 33, czLip - 5, WORLD.waterY + 0.14, 13, 9);
  return b.toMesh();
}

/** Rising plunge-pool spray & mist plumes climbing up to the lower half of the 3 waterfall groups. */
export function buildWaterfallMistMesh() {
  const b = createBuilder();
  const centers = [];
  const rand = createRandom(4409);
  const baseZ = WATERFALL_Z_BOT + 16;
  const baseX = riverCenterX(baseZ);
  for (let i = 0; i < 42; i += 1) {
    // 18 puffs on main, 12 on west, 12 on east
    const streamBias = i < 18 ? -1.5 : i < 30 ? -50 : 44;
    const spreadX = i < 18 ? 36 : 22;
    const colT = (i % 7) / 6;
    const mx = baseX + streamBias + (rand() - 0.5) * spreadX;
    const mz = baseZ + 2 + colT * 30 + (rand() - 0.5) * 18;
    const my = CANYON_WATER_Y + 4.5 + Math.pow(colT, 0.88) * 58.0 + (rand() - 0.5) * 7.0;
    const rx = 7.0 + rand() * 5.8 + (1 - colT) * 3.0;
    const ry = 9.5 + rand() * 7.5 + colT * 3.5;
    const rz = 7.0 + rand() * 5.8 + (1 - colT) * 3.0;
    addCloudBlob(b, centers, mx, mz, mx, my, mz, rx, ry, rz, 0.88, 0.92, 0.96, i * 1.37);
  }
  const mesh = b.toMesh();
  mesh.centers = new Float32Array(centers);
  return mesh;
}

// --- Textured Runway Mesh & Airfield Facilities ---

function addRoadRibbon(b, pts, halfWidth, shoulderWidth, rCol, gCol, bCol) {
  const leftInner = [];
  const rightInner = [];
  const leftOuter = [];
  const rightOuter = [];

  for (let i = 0; i < pts.length; i += 1) {
    const pPrev = pts[Math.max(0, i - 1)];
    const pNext = pts[Math.min(pts.length - 1, i + 1)];
    let tx = pNext.x - pPrev.x;
    let tz = pNext.z - pPrev.z;
    const len = Math.hypot(tx, tz) || 1;
    tx /= len;
    tz /= len;
    const rx = -tz;
    const rz = tx;
    const cx = pts[i].x;
    const cz = pts[i].z;

    const lix = cx - rx * halfWidth;
    const liz = cz - rz * halfWidth;
    const rix = cx + rx * halfWidth;
    const riz = cz + rz * halfWidth;
    const lox = cx - rx * (halfWidth + shoulderWidth);
    const loz = cz - rz * (halfWidth + shoulderWidth);
    const rox = cx + rx * (halfWidth + shoulderWidth);
    const roz = cz + rz * (halfWidth + shoulderWidth);

    const yc = sampleMeshHeight(cx, cz) + 0.09;
    const yL = sampleMeshHeight(lix, liz) + 0.08;
    const yR = sampleMeshHeight(rix, riz) + 0.08;
    const yLO = sampleMeshHeight(lox, loz) + 0.01;
    const yRO = sampleMeshHeight(rox, roz) + 0.01;

    leftInner.push([lix, Math.max(yL, yc - 0.04), liz]);
    rightInner.push([rix, Math.max(yR, yc - 0.04), riz]);
    leftOuter.push([lox, yLO, loz]);
    rightOuter.push([rox, yRO, roz]);
  }

  const sr = 0.36;
  const sg = 0.33;
  const sb = 0.27;

  for (let i = 0; i < pts.length - 1; i += 1) {
    b.quad(...leftInner[i], ...leftInner[i + 1], ...rightInner[i + 1], ...rightInner[i], rCol, gCol, bCol);
    b.quad(...leftOuter[i], ...leftOuter[i + 1], ...leftInner[i + 1], ...leftInner[i], sr, sg, sb);
    b.quad(...rightInner[i], ...rightInner[i + 1], ...rightOuter[i + 1], ...rightOuter[i], sr, sg, sb);
  }
}

/** Paint flat 2D ground strip/rectangle in XZ plane at elevation `y`. */
function flatRect(b, x0, x1, z0, z1, y, r, g, bl) {
  b.quad(x0, y, z0, x0, y, z1, x1, y, z1, x1, y, z0, r, g, bl);
}

/** Smooth-shaded tapered cylinder (e.g. poles, tree trunks). */
function addSmoothCylinder(b, cx, botY, cz, rBot, rTop, h, sides, rCol, gCol, bCol, topTint = 1.0) {
  const topY = botY + h;
  for (let i = 0; i < sides; i += 1) {
    const a0 = (i / sides) * Math.PI * 2;
    const a1 = ((i + 1) / sides) * Math.PI * 2;
    const c0 = Math.cos(a0);
    const s0 = Math.sin(a0);
    const c1 = Math.cos(a1);
    const s1 = Math.sin(a1);

    const x0b = cx + c0 * rBot;
    const z0b = cz + s0 * rBot;
    const x1b = cx + c1 * rBot;
    const z1b = cz + s1 * rBot;
    const x0t = cx + c0 * rTop;
    const z0t = cz + s0 * rTop;
    const x1t = cx + c1 * rTop;
    const z1t = cz + s1 * rTop;

    const rT = rCol * topTint;
    const gT = gCol * topTint;
    const bT = bCol * topTint;

    // Outward CCW winding
    b.pushVert(x0b, botY, z0b, c0, 0.1, s0, rCol * 0.85, gCol * 0.85, bCol * 0.85);
    b.pushVert(x0t, topY, z0t, c0, 0.1, s0, rT, gT, bT);
    b.pushVert(x1t, topY, z1t, c1, 0.1, s1, rT, gT, bT);

    b.pushVert(x0b, botY, z0b, c0, 0.1, s0, rCol * 0.85, gCol * 0.85, bCol * 0.85);
    b.pushVert(x1t, topY, z1t, c1, 0.1, s1, rT, gT, bT);
    b.pushVert(x1b, botY, z1b, c1, 0.1, s1, rCol * 0.85, gCol * 0.85, bCol * 0.85);
  }
}

/** Dedicated UV-mapped Runway 36 quad mapping tex-runway.jpg symmetrically to both ends. */
export function buildRunwayMesh() {
  const b = createBuilder(true);
  const y = RUNWAY.elevation + 0.08;
  const x0 = -RUNWAY.halfWidth;
  const x1 = RUNWAY.halfWidth;
  const zMid = (RUNWAY.zEnd + RUNWAY.zStart) * 0.5; // +20

  const emitStrip = (za, zb, va, vb) => {
    b.pushVert(x0, y, za, 0, 1, 0, 1, 1, 1, 0, va);
    b.pushVert(x0, y, zb, 0, 1, 0, 1, 1, 1, 0, vb);
    b.pushVert(x1, y, zb, 0, 1, 0, 1, 1, 1, 1, vb);

    b.pushVert(x0, y, za, 0, 1, 0, 1, 1, 1, 0, va);
    b.pushVert(x1, y, zb, 0, 1, 0, 1, 1, 1, 1, vb);
    b.pushVert(x1, y, za, 0, 1, 0, 1, 1, 1, 1, va);
  };

  // North half: zEnd (-280, v=1 threshold bars) -> zMid (+20, v=0 centerline)
  const segs = 6;
  for (let i = 0; i < segs; i += 1) {
    const t0 = i / segs;
    const t1 = (i + 1) / segs;
    emitStrip(lerp(RUNWAY.zEnd, zMid, t0), lerp(RUNWAY.zEnd, zMid, t1), 1 - t0, 1 - t1);
  }
  // South half: zMid (+20, v=0 centerline) -> zStart (+320, v=1 threshold bars)
  for (let i = 0; i < segs; i += 1) {
    const t0 = i / segs;
    const t1 = (i + 1) / segs;
    emitStrip(lerp(zMid, RUNWAY.zStart, t0), lerp(zMid, RUNWAY.zStart, t1), t0, t1);
  }
  return b.toMesh();
}

/** Transparent 512x256 decal atlas containing painted weathered "36" (left) and "18" (right). */
export function buildRunwayDecalCanvas() {
  const canvas = makeCanvas(512, 256);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 512, 256);
  const rand = createRandom(36180);

  const drawLabel = (text, cx) => {
    ctx.save();
    ctx.translate(cx, 128);
    ctx.scale(0.85, 1.45);
    ctx.fillStyle = 'rgba(235, 231, 220, 0.90)';
    ctx.font = 'bold 138px "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 0, 0);
    ctx.restore();
  };

  drawLabel('36', 128);
  drawLabel('18', 384);

  // Subtle asphalt wear speckles punched out so decals blend organically into tex-runway.jpg
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 900; i += 1) {
    const x = rand() * 512;
    const y = rand() * 256;
    ctx.fillStyle = `rgba(0,0,0,${0.18 + rand() * 0.25})`;
    ctx.fillRect(x, y, 1.5, 2.5);
  }
  ctx.globalCompositeOperation = 'source-over';
  return canvas;
}

/** Two transparent threshold number decal quads ("36" at south, "18" at north). */
export function buildRunwayDecalsMesh() {
  const b = createBuilder(true);
  const y = RUNWAY.elevation + 0.12;
  const hw = 10.5;
  const hh = 11.5;

  // South "36" upright facing North (-Z)
  const cz36 = RUNWAY.zStart - 48;
  b.pushVert(-hw, y, cz36 - hh, 0, 1, 0, 1, 1, 1, 0.0, 0.0);
  b.pushVert(-hw, y, cz36 + hh, 0, 1, 0, 1, 1, 1, 0.0, 1.0);
  b.pushVert(hw, y, cz36 + hh, 0, 1, 0, 1, 1, 1, 0.5, 1.0);
  b.pushVert(-hw, y, cz36 - hh, 0, 1, 0, 1, 1, 1, 0.0, 0.0);
  b.pushVert(hw, y, cz36 + hh, 0, 1, 0, 1, 1, 1, 0.5, 1.0);
  b.pushVert(hw, y, cz36 - hh, 0, 1, 0, 1, 1, 1, 0.5, 0.0);

  // North "18" rotated 180° (facing South +Z)
  const cz18 = RUNWAY.zEnd + 48;
  b.pushVert(-hw, y, cz18 - hh, 0, 1, 0, 1, 1, 1, 1.0, 1.0);
  b.pushVert(-hw, y, cz18 + hh, 0, 1, 0, 1, 1, 1, 1.0, 0.0);
  b.pushVert(hw, y, cz18 + hh, 0, 1, 0, 1, 1, 1, 0.5, 0.0);
  b.pushVert(-hw, y, cz18 - hh, 0, 1, 0, 1, 1, 1, 1.0, 1.0);
  b.pushVert(hw, y, cz18 + hh, 0, 1, 0, 1, 1, 1, 0.5, 0.0);
  b.pushVert(hw, y, cz18 - hh, 0, 1, 0, 1, 1, 1, 0.5, 1.0);

  return b.toMesh();
}

/** Far horizon mountain ridge cylinder band just outside world perimeter, textured with tex-mountains.jpg. */
export function buildMountainBandMesh() {
  const b = createBuilder(true);
  const segs = 72;
  const radius = 5320;
  const yBot = -160;
  const yTop = 1040;
  const repeats = 4;

  for (let i = 0; i < segs; i += 1) {
    const a0 = (i / segs) * Math.PI * 2;
    const a1 = ((i + 1) / segs) * Math.PI * 2;
    const u0 = (i / segs) * repeats;
    const u1 = ((i + 1) / segs) * repeats;
    const x0 = Math.cos(a0) * radius;
    const z0 = Math.sin(a0) * radius;
    const x1 = Math.cos(a1) * radius;
    const z1 = Math.sin(a1) * radius;
    const nx0 = -Math.cos(a0);
    const nz0 = -Math.sin(a0);
    const nx1 = -Math.cos(a1);
    const nz1 = -Math.sin(a1);

    // Sample only mountain band v in [0.30..0.69] (avoids top clouds and bottom wingtip artifact)
    // Store normalized vertical band factor t in vColor.r (0=bottom, 1=top) for alpha fade
    b.pushVert(x0, yBot, z0, nx0, 0, nz0, 0, 1, 1, u0, 0.69);
    b.pushVert(x0, yTop, z0, nx0, 0, nz0, 1, 1, 1, u0, 0.30);
    b.pushVert(x1, yTop, z1, nx1, 0, nz1, 1, 1, 1, u1, 0.30);

    b.pushVert(x0, yBot, z0, nx0, 0, nz0, 0, 1, 1, u0, 0.69);
    b.pushVert(x1, yTop, z1, nx1, 0, nz1, 1, 1, 1, u1, 0.30);
    b.pushVert(x1, yBot, z1, nx1, 0, nz1, 0, 1, 1, u1, 0.69);
  }
  return b.toMesh();
}

const NOOP_BUILDER = {
  pushVert() {},
  tri() {},
  quad() {},
  box() {},
};

function windowHash(x, z, idx) {
  let h = Math.imul(Math.round(x * 10), 374761393) + Math.imul(Math.round(z * 10), 668265263) + Math.imul(idx + 1, 1442695041);
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function emissiveAmber(x, z, idx) {
  const h1 = windowHash(x, z, idx * 7 + 3);
  const h2 = windowHash(x, z, idx * 13 + 9);
  const v = 0.88 + h1 * 0.28;
  return [1.0 * v, (0.58 + h2 * 0.08) * v, (0.24 + (1 - h2) * 0.08) * v];
}

function addEmissiveWindowQuad(ew, cx, baseY, cz, rotY, lx, ly, lz, w, h, faceDir, r, g, b) {
  const c = Math.cos(rotY);
  const s = Math.sin(rotY);
  const pt = (x0, y0, z0) => [cx + x0 * c + z0 * s, baseY + y0, cz - x0 * s + z0 * c];
  const hw = w * 0.5;
  const hh = h * 0.5;
  if (faceDir === '+z') {
    ew.quad(...pt(lx - hw, ly - hh, lz), ...pt(lx + hw, ly - hh, lz), ...pt(lx + hw, ly + hh, lz), ...pt(lx - hw, ly + hh, lz), r, g, b);
  } else if (faceDir === '-z') {
    ew.quad(...pt(lx + hw, ly - hh, lz), ...pt(lx - hw, ly - hh, lz), ...pt(lx - hw, ly + hh, lz), ...pt(lx + hw, ly + hh, lz), r, g, b);
  } else if (faceDir === '+x') {
    ew.quad(...pt(lx, ly - hh, lz + hw), ...pt(lx, ly - hh, lz - hw), ...pt(lx, ly + hh, lz - hw), ...pt(lx, ly + hh, lz + hw), r, g, b);
  } else {
    ew.quad(...pt(lx, ly - hh, lz - hw), ...pt(lx, ly - hh, lz + hw), ...pt(lx, ly + hh, lz + hw), ...pt(lx, ly + hh, lz - hw), r, g, b);
  }
}

function addHorizontalCylinderX(b, cx, cy, cz, radius, length, sides, rCol, gCol, bCol) {
  const x0 = cx - length * 0.5;
  const x1 = cx + length * 0.5;
  for (let i = 0; i < sides; i += 1) {
    const a0 = (i / sides) * Math.PI * 2;
    const a1 = ((i + 1) / sides) * Math.PI * 2;
    const ny0 = Math.cos(a0);
    const nz0 = Math.sin(a0);
    const ny1 = Math.cos(a1);
    const nz1 = Math.sin(a1);
    const y0 = cy + ny0 * radius;
    const z0 = cz + nz0 * radius;
    const y1 = cy + ny1 * radius;
    const z1 = cz + nz1 * radius;
    const shade0 = 0.84 + 0.16 * ny0;
    const shade1 = 0.84 + 0.16 * ny1;

    b.pushVert(x0, y0, z0, 0, ny0, nz0, rCol * shade0, gCol * shade0, bCol * shade0);
    b.pushVert(x1, y0, z0, 0, ny0, nz0, rCol * shade0, gCol * shade0, bCol * shade0);
    b.pushVert(x1, y1, z1, 0, ny1, nz1, rCol * shade1, gCol * shade1, bCol * shade1);

    b.pushVert(x0, y0, z0, 0, ny0, nz0, rCol * shade0, gCol * shade0, bCol * shade0);
    b.pushVert(x1, y1, z1, 0, ny1, nz1, rCol * shade1, gCol * shade1, bCol * shade1);
    b.pushVert(x0, y1, z1, 0, ny1, nz1, rCol * shade1, gCol * shade1, bCol * shade1);

    // End caps
    b.pushVert(x0, cy, cz, -1, 0, 0, rCol * 0.88, gCol * 0.88, bCol * 0.88);
    b.pushVert(x0, y1, z1, -1, 0, 0, rCol * 0.88, gCol * 0.88, bCol * 0.88);
    b.pushVert(x0, y0, z0, -1, 0, 0, rCol * 0.88, gCol * 0.88, bCol * 0.88);

    b.pushVert(x1, cy, cz, 1, 0, 0, rCol * 0.92, gCol * 0.92, bCol * 0.92);
    b.pushVert(x1, y0, z0, 1, 0, 0, rCol * 0.92, gCol * 0.92, bCol * 0.92);
    b.pushVert(x1, y1, z1, 1, 0, 0, rCol * 0.92, gCol * 0.92, bCol * 0.92);
  }
}

function addHangar(b, ew, cx, y0, cz, scale = 1.0) {
  const w = 28 * scale;
  const d = 34 * scale;
  const wallH = 8.4 * scale;
  const hw = w * 0.5;
  const hd = d * 0.5;

  // Concrete foundation slab
  b.box(cx, y0 + 0.14, cz, w + 3.0, 0.28, d + 3.0, 0.44, 0.44, 0.42);

  // Side walls (muted warm light gray-beige steel cladding)
  b.box(cx - hw + 0.4, y0 + wallH * 0.5, cz, 0.8, wallH, d, 0.68, 0.67, 0.64);
  b.box(cx - 0.5, y0 + wallH * 0.5, cz - hd + 0.4, w - 1.0, wallH, 0.8, 0.66, 0.65, 0.62);
  b.box(cx - 0.5, y0 + wallH * 0.5, cz + hd - 0.4, w - 1.0, wallH, 0.8, 0.66, 0.65, 0.62);

  // Dark hangar interior floor & rear wall + open sliding bay doors facing apron (+X)
  b.box(cx, y0 + 0.16, cz, w - 1.2, 0.10, d - 1.2, 0.22, 0.23, 0.25);
  const doorSideD = 8.0 * scale;
  const doorSideOffset = 13.0 * scale;
  b.box(cx + hw - 0.35, y0 + wallH * 0.5, cz - doorSideOffset, 0.7, wallH, doorSideD, 0.46, 0.48, 0.50);
  b.box(cx + hw - 0.35, y0 + wallH * 0.5, cz + doorSideOffset, 0.7, wallH, doorSideD, 0.46, 0.48, 0.50);
  b.box(cx + hw - 0.35, y0 + wallH - 0.9 * scale, cz, 0.7, 1.8 * scale, 18.0 * scale, 0.34, 0.38, 0.44);
  // Partially slid door leaves
  b.box(cx + hw + 0.15, y0 + 3.6 * scale, cz - 9.2 * scale, 0.35, 7.2 * scale, 5.2 * scale, 0.30, 0.35, 0.42);
  b.box(cx + hw + 0.15, y0 + 3.6 * scale, cz + 9.2 * scale, 0.35, 7.2 * scale, 5.2 * scale, 0.30, 0.35, 0.42);

  // Warm interior hangar light visible through open bay
  addEmissiveWindowQuad(ew, cx + hw - 0.8, y0, cz, 0, 0, wallH * 0.46, 0, 10.0 * scale, 3.6 * scale, '+x', 1.05, 0.68, 0.32);

  // Vertical exterior structural wall ribs
  for (let z = -hd + 3; z <= hd - 3; z += 5.5) {
    b.box(cx - hw - 0.1, y0 + wallH * 0.5, cz + z, 0.35, wallH, 0.45, 0.44, 0.46, 0.49);
  }

  // Curved barrel-vault roof (smooth arched corrugated metal in muted slate-blue/charcoal)
  const archSegs = 10;
  const archR = hw + 1.2 * scale;
  const archH = 4.4 * scale;
  const z0 = cz - hd - 0.8;
  const z1 = cz + hd + 0.8;
  for (let i = 0; i < archSegs; i += 1) {
    const t0 = (i / archSegs) * Math.PI;
    const t1 = ((i + 1) / archSegs) * Math.PI;
    const x0 = cx - Math.cos(t0) * archR;
    const yA = y0 + wallH + Math.sin(t0) * archH;
    const x1 = cx - Math.cos(t1) * archR;
    const yB = y0 + wallH + Math.sin(t1) * archH;
    const shade = 0.92 + 0.08 * Math.sin((t0 + t1) * 0.5);
    // Outer roof arch
    b.quad(x0, yA, z1, x1, yB, z1, x1, yB, z0, x0, yA, z0, 0.32 * shade, 0.36 * shade, 0.41 * shade);
    // Underside arch
    b.quad(x0, yA - 0.2, z0, x1, yB - 0.2, z0, x1, yB - 0.2, z1, x0, yA - 0.2, z1, 0.20, 0.22, 0.25);
    // Gable arch end-caps
    b.tri(cx, y0 + wallH, z1, x0, yA, z1, x1, yB, z1, 0.54, 0.55, 0.56);
    b.tri(cx, y0 + wallH, z0, x1, yB, z0, x0, yA, z0, 0.50, 0.51, 0.52);
  }

  // Muted dark terracotta fascia band along front/back eaves
  b.box(cx, y0 + wallH + 0.15, z1 + 0.1, w + 2.4 * scale, 0.55, 0.25, 0.54, 0.27, 0.22);
  b.box(cx, y0 + wallH + 0.15, z0 - 0.1, w + 2.4 * scale, 0.55, 0.25, 0.54, 0.27, 0.22);

  // Small office annex on north side of main hangar
  if (scale > 0.85) {
    b.box(cx - 2, y0 + 2.4, cz - hd - 4.2, 14, 4.8, 7.6, 0.74, 0.72, 0.67);
    b.box(cx - 2, y0 + 5.0, cz - hd - 4.2, 14.8, 0.5, 8.4, 0.34, 0.37, 0.41);
    addEmissiveWindowQuad(ew, cx + 5.08, y0, cz - hd - 4.2, 0, 0, 2.5, 0, 4.2, 1.5, '+x', 1.06, 0.66, 0.30);
  }
}

function addControlTower(b, ew, cx, y0, cz) {
  // Concrete base & tapered tower shaft
  b.box(cx, y0 + 0.3, cz, 11.5, 0.6, 11.5, 0.45, 0.45, 0.43);
  b.box(cx, y0 + 8.5, cz, 7.8, 16.4, 7.8, 0.72, 0.70, 0.66);
  // Subtle architectural corner pilasters
  for (const sx of [-3.9, 3.9]) {
    for (const sz of [-3.9, 3.9]) {
      b.box(cx + sx, y0 + 8.5, cz + sz, 0.85, 16.4, 0.85, 0.58, 0.57, 0.54);
    }
  }
  // Shaft stairwell emissive slit windows
  addEmissiveWindowQuad(ew, cx, y0, cz, 0, 3.98, 7.5, 0, 1.2, 2.2, '+x', 0.96, 0.60, 0.26);
  addEmissiveWindowQuad(ew, cx, y0, cz, 0, 3.98, 12.2, 0, 1.2, 2.2, '+x', 1.02, 0.64, 0.28);

  // Catwalk / observation gallery floor & railing collar
  b.box(cx, y0 + 17.1, cz, 13.6, 0.8, 13.6, 0.46, 0.47, 0.49);
  // Railing posts & top bar
  b.box(cx, y0 + 18.1, cz + 6.6, 13.6, 0.18, 0.18, 0.28, 0.30, 0.33);
  b.box(cx, y0 + 18.1, cz - 6.6, 13.6, 0.18, 0.18, 0.28, 0.30, 0.33);
  b.box(cx + 6.6, y0 + 18.1, cz, 0.18, 0.18, 13.4, 0.28, 0.30, 0.33);
  b.box(cx - 6.6, y0 + 18.1, cz, 0.18, 0.18, 13.4, 0.28, 0.30, 0.33);

  // Outward-canted tinted glass control cab (wider at top than bottom, real ATC style)
  const cabBot = y0 + 17.5;
  const cabTop = y0 + 21.8;
  const bHalf = 4.6;
  const tHalf = 5.8;
  const glassCol = [0.16, 0.25, 0.33];
  b.quad(cx - bHalf, cabBot, cz + bHalf, cx + bHalf, cabBot, cz + bHalf, cx + tHalf, cabTop, cz + tHalf, cx - tHalf, cabTop, cz + tHalf, ...glassCol);
  b.quad(cx + bHalf, cabBot, cz - bHalf, cx - bHalf, cabBot, cz - bHalf, cx - tHalf, cabTop, cz - tHalf, cx + tHalf, cabTop, cz - tHalf, ...glassCol);
  b.quad(cx + bHalf, cabBot, cz + bHalf, cx + bHalf, cabBot, cz - bHalf, cx + tHalf, cabTop, cz - tHalf, cx + tHalf, cabTop, cz + tHalf, ...glassCol);
  b.quad(cx - bHalf, cabBot, cz - bHalf, cx - bHalf, cabBot, cz + bHalf, cx - tHalf, cabTop, cz + tHalf, cx - tHalf, cabTop, cz - tHalf, ...glassCol);

  // Warm interior instrument/console glow band slightly proud on cab panes
  const gBot = y0 + 18.0;
  const gTop = y0 + 20.6;
  const gbH = 4.82;
  const gtH = 5.55;
  ew.quad(cx - gbH, gBot, cz + gbH, cx + gbH, gBot, cz + gbH, cx + gtH, gTop, cz + gtH, cx - gtH, gTop, cz + gtH, 1.05, 0.66, 0.30);
  ew.quad(cx + gbH, gBot, cz + gbH, cx + gbH, gBot, cz - gbH, cx + gtH, gTop, cz - gtH, cx + gtH, gTop, cz + gtH, 1.08, 0.68, 0.32);

  // Window mullions on cab corners
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.box(cx + sx * 5.2, (cabBot + cabTop) * 0.5, cz + sz * 5.2, 0.42, 4.3, 0.42, 0.25, 0.27, 0.30);
    }
  }

  // Overhanging flat cab roof + radar dome / antenna mast
  b.box(cx, cabTop + 0.6, cz, 13.4, 1.2, 13.4, 0.32, 0.35, 0.39);
  b.box(cx, cabTop + 1.4, cz, 12.6, 0.5, 12.6, 0.64, 0.30, 0.24);
  addSmoothCylinder(b, cx + 1.5, cabTop + 1.6, cz - 1.2, 0.16, 0.08, 4.5, 6, 0.58, 0.60, 0.64);
  b.box(cx - 1.8, cabTop + 2.3, cz + 1.5, 2.2, 0.9, 1.2, 0.78, 0.78, 0.76);
}

function addAirfieldTerminal(b, ew, cx, cz) {
  const baseY = sampleMeshHeight(cx, cz);
  const w = 18;
  const d = 34;
  const wallH = 6.8;
  const hw = w * 0.5;
  const hd = d * 0.5;

  // Foundation slab sunk 1.4m for flush grounding
  b.box(cx, baseY + (wallH - 1.4) * 0.5, cz, w, wallH + 1.4, d, 0.76, 0.74, 0.69);
  b.box(cx, baseY + 0.16, cz, w + 3.2, 0.32, d + 3.2, 0.44, 0.45, 0.44);

  // Mid-floor architectural band & overhanging flat roof + apron canopy
  b.box(cx, baseY + 3.4, cz, w + 0.4, 0.45, d + 0.4, 0.52, 0.52, 0.50);
  b.box(cx, baseY + wallH + 0.45, cz, w + 2.8, 0.9, d + 2.8, 0.30, 0.33, 0.38);
  b.box(cx + 0.6, baseY + wallH + 1.0, cz, w + 1.2, 0.4, d + 1.2, 0.24, 0.26, 0.30);
  // Apron-side covered walkway canopy (+X)
  b.box(cx + hw + 1.8, baseY + 3.2, cz, 3.6, 0.32, d - 6.0, 0.34, 0.36, 0.40);
  for (let z = -12; z <= 12; z += 6) {
    b.box(cx + hw + 3.3, baseY + 1.6, cz + z, 0.26, 3.2, 0.26, 0.42, 0.44, 0.47);
  }

  // Long apron-side (+X) window strip across 2 floors (joins emissive pass)
  for (let floor = 0; floor < 2; floor += 1) {
    const wy = floor === 0 ? 1.85 : 5.05;
    for (let i = -3; i <= 3; i += 1) {
      const wz = i * 4.2;
      const isLit = windowHash(cx + floor * 3, cz + wz, i + 10) < 0.72;
      if (isLit) {
        const [er, eg, eb] = emissiveAmber(cx + floor * 3, cz + wz, i + 10);
        addEmissiveWindowQuad(ew, cx, baseY, cz, 0, hw + 0.08, wy, wz, 3.2, 1.75, '+x', er, eg, eb);
      } else {
        b.box(cx + hw + 0.06, baseY + wy, cz + wz, 0.12, 1.75, 3.2, 0.18, 0.24, 0.31);
      }
    }
  }
  // Landside (-X) & end windows
  for (let i = -2; i <= 2; i += 1) {
    const wz = i * 5.6;
    if (windowHash(cx - 5, cz + wz, i) < 0.45) {
      const [er, eg, eb] = emissiveAmber(cx - 5, cz + wz, i);
      addEmissiveWindowQuad(ew, cx, baseY, cz, 0, -hw - 0.08, 4.9, wz, 3.0, 1.5, '-x', er, eg, eb);
    } else {
      b.box(cx - hw - 0.06, baseY + 4.9, cz + wz, 0.12, 1.5, 3.0, 0.18, 0.24, 0.31);
    }
  }
  for (const sz of [-1, 1]) {
    const [er, eg, eb] = emissiveAmber(cx, cz + sz * 20, 4);
    addEmissiveWindowQuad(ew, cx, baseY, cz, 0, 0, 4.9, sz * (hd + 0.08), 8.0, 1.5, sz > 0 ? '+z' : '-z', er, eg, eb);
  }
}

function addFuelFarm(b, cx, cz) {
  const baseY = sampleMeshHeight(cx, cz);
  // Concrete containment pad sunk 0.6m
  b.box(cx, baseY - 0.1, cz, 12.5, 0.8, 18.0, 0.42, 0.42, 0.40);
  // Low concrete containment bund curb
  b.box(cx, baseY + 0.42, cz - 8.7, 12.5, 0.4, 0.5, 0.52, 0.52, 0.50);
  b.box(cx, baseY + 0.42, cz + 8.7, 12.5, 0.4, 0.5, 0.52, 0.52, 0.50);

  for (const dz of [-4.2, 4.2]) {
    const tz = cz + dz;
    // Two concrete cradles/saddles
    b.box(cx - 2.3, baseY + 0.75, tz, 0.75, 1.1, 2.7, 0.48, 0.48, 0.46);
    b.box(cx + 2.3, baseY + 0.75, tz, 0.75, 1.1, 2.7, 0.48, 0.48, 0.46);
    // Horizontal cylindrical fuel tank
    addHorizontalCylinderX(b, cx, baseY + 2.25, tz, 1.45, 7.6, 12, 0.84, 0.83, 0.80);
    // Warm hazard/fuel stripe collar
    addHorizontalCylinderX(b, cx + 1.8, baseY + 2.25, tz, 1.48, 0.65, 12, 0.78, 0.36, 0.20);
  }
  // Fuel pump dispenser cabinet & yellow safety bollards
  b.box(cx + 4.8, baseY + 1.15, cz, 1.2, 1.7, 2.2, 0.68, 0.28, 0.22);
  for (const bz of [-7.5, 0, 7.5]) {
    b.box(cx + 6.0, baseY + 0.75, cz + bz, 0.28, 1.0, 0.28, 0.85, 0.68, 0.18);
  }
}

function populateAirfield(b, ew) {
  const y0 = RUNWAY.elevation;
  const yApron = y0 + 0.06;

  // Taxiway & concrete parking apron on west side (extended south for terminal frontage)
  flatRect(b, -76, -RUNWAY.halfWidth + 0.2, 36, 194, yApron, 0.32, 0.33, 0.35);
  flatRect(b, -124, -40, 186, 228, yApron, 0.32, 0.33, 0.35);
  // Taxiway connector bands
  flatRect(b, -74, -RUNWAY.halfWidth, 114, 136, yApron + 0.01, 0.26, 0.27, 0.30);
  flatRect(b, -74, -RUNWAY.halfWidth, 152, 174, yApron + 0.01, 0.26, 0.27, 0.30);
  flatRect(b, -74, -RUNWAY.halfWidth, 190, 212, yApron + 0.01, 0.26, 0.27, 0.30);
  // Subtle yellow apron taxi guideline
  flatRect(b, -62, -61.3, 44, 212, yApron + 0.03, 0.78, 0.60, 0.20);
  flatRect(b, -62, -22, 124.5, 125.2, yApron + 0.03, 0.78, 0.60, 0.20);
  flatRect(b, -62, -22, 162.5, 163.2, yApron + 0.03, 0.78, 0.60, 0.20);
  flatRect(b, -118, -22, 201.0, 201.7, yApron + 0.03, 0.78, 0.60, 0.20);

  // Realistic Hangars, Control Tower, Terminal & Fuel Farm (all west of runway & clear of approach funnel)
  addHangar(b, ew, -86, y0, 130, 1.0);
  addHangar(b, ew, -88, y0, 72, 0.72);
  addControlTower(b, ew, -74, y0, 24);
  addAirfieldTerminal(b, ew, -134, 208);
  addFuelFarm(b, -114, 98);

  // Tapered windsock mast + striped windsock cone near threshold
  addSmoothCylinder(b, -32, y0, 250, 0.18, 0.10, 9.0, 6, 0.72, 0.74, 0.76);
  addSmoothCylinder(b, -32, y0 + 8.6, 250, 0.55, 0.25, 0.1, 6, 0.85, 0.85, 0.85);
  b.box(-30.3, y0 + 8.5, 250, 1.5, 0.85, 0.85, 0.86, 0.36, 0.18);
  b.box(-29.0, y0 + 8.4, 250, 1.3, 0.72, 0.72, 0.90, 0.88, 0.84);
  b.box(-27.8, y0 + 8.3, 250, 1.2, 0.58, 0.58, 0.86, 0.36, 0.18);

  // Low light fixture pedestals along Runway 36 & approach
  for (let z = RUNWAY.zEnd; z <= RUNWAY.zStart; z += 60) {
    b.box(-RUNWAY.halfWidth - 2.2, y0 + 0.35, z, 0.75, 0.7, 0.75, 0.24, 0.26, 0.30);
    b.box(RUNWAY.halfWidth + 2.2, y0 + 0.35, z, 0.75, 0.7, 0.75, 0.24, 0.26, 0.30);
  }
  for (let i = 1; i <= 6; i += 1) {
    const z = RUNWAY.zStart + i * 38;
    const h = sampleMeshHeight(0, z);
    b.box(-5.5, h + 0.45, z, 0.65, 0.9, 0.65, 0.24, 0.26, 0.30);
    b.box(5.5, h + 0.45, z, 0.65, 0.9, 0.65, 0.24, 0.26, 0.30);
  }
  // 4-unit PAPI housing boxes
  for (let k = 0; k < 4; k += 1) {
    b.box(-29 - k * 4.2, y0 + 0.4, RUNWAY.zStart - 75, 1.7, 0.8, 1.3, 0.17, 0.19, 0.22);
  }

  // Country asphalt/gravel road connecting the village to the airfield service area
  addRoadRibbon(b, ROAD_SAMPLES_MAIN, 3.0, 1.1, 0.28, 0.27, 0.26);
  addRoadRibbon(b, ROAD_SAMPLES_LANE, 2.3, 0.9, 0.34, 0.32, 0.29);
}

export function buildAirfieldMesh() {
  const b = createBuilder();
  populateAirfield(b, NOOP_BUILDER);
  return b.toMesh();
}

// --- Village Houses & Rural Barns (Muted Realistic Colors) ---

const VILLAGE_HOUSES = [
  { x: -162, z: 140, rotY: -2.4, w: 9.5, d: 12.0, wallH: 4.8, roofH: 3.4, wall: [0.80, 0.76, 0.69], roof: [0.56, 0.28, 0.21] },
  { x: -166, z: 90, rotY: 0.65, w: 8.8, d: 11.0, wallH: 4.5, roofH: 3.1, wall: [0.76, 0.70, 0.60], roof: [0.27, 0.30, 0.35] },
  { x: -186, z: 140, rotY: -1.45, w: 9.0, d: 11.5, wallH: 4.6, roofH: 3.2, wall: [0.72, 0.74, 0.69], roof: [0.54, 0.27, 0.20] },
  { x: -222, z: 150, rotY: 1.65, w: 10.0, d: 12.5, wallH: 5.0, roofH: 3.5, wall: [0.78, 0.74, 0.66], roof: [0.46, 0.28, 0.20] },
  { x: -222, z: 112, rotY: 0.35, w: 9.2, d: 11.2, wallH: 4.6, roofH: 3.2, wall: [0.77, 0.68, 0.60], roof: [0.29, 0.32, 0.37] },
  { x: -252, z: 94, rotY: -2.6, w: 8.6, d: 10.6, wallH: 4.4, roofH: 3.0, wall: [0.81, 0.77, 0.70], roof: [0.58, 0.29, 0.22] },
  { x: -282, z: 66, rotY: -0.45, w: 9.4, d: 11.4, wallH: 4.7, roofH: 3.3, wall: [0.75, 0.70, 0.61], roof: [0.45, 0.27, 0.20] },
  { x: -244, z: 34, rotY: 0.5, w: 9.0, d: 11.6, wallH: 4.6, roofH: 3.2, wall: [0.79, 0.75, 0.68], roof: [0.55, 0.28, 0.21] },
  { x: -192, z: 54, rotY: -1.4, w: 8.8, d: 10.8, wallH: 4.5, roofH: 3.1, wall: [0.73, 0.74, 0.69], roof: [0.28, 0.31, 0.36] },
  { x: -242, z: 2, rotY: 1.42, w: 9.6, d: 12.2, wallH: 4.8, roofH: 3.4, wall: [0.78, 0.73, 0.65], roof: [0.53, 0.28, 0.21] },
  { x: -198, z: -8, rotY: -1.7, w: 8.6, d: 10.4, wallH: 4.4, roofH: 3.0, wall: [0.76, 0.68, 0.60], roof: [0.46, 0.29, 0.21] },
  { x: -254, z: -36, rotY: 1.38, w: 9.2, d: 11.4, wallH: 4.7, roofH: 3.3, wall: [0.79, 0.75, 0.68], roof: [0.28, 0.31, 0.36] },
  { x: -206, z: -42, rotY: -1.75, w: 11.0, d: 15.0, wallH: 5.4, roofH: 3.8, wall: [0.77, 0.73, 0.65], roof: [0.52, 0.26, 0.19] },
  // Two rural farmsteads / barns tucked beside countryside lanes
  { x: -148, z: 515, rotY: 0.32, w: 12.0, d: 17.5, wallH: 5.2, roofH: 4.0, wall: [0.56, 0.30, 0.23], roof: [0.26, 0.28, 0.32] },
  { x: 162, z: 182, rotY: -0.55, w: 11.2, d: 16.0, wallH: 5.0, roofH: 3.8, wall: [0.68, 0.65, 0.58], roof: [0.44, 0.27, 0.21] },
];

function addHouse(b, hSpec, ew = NOOP_BUILDER, litProb = 0.42) {
  const { x, z, rotY, w, d, wallH, roofH, wall, roof } = hSpec;
  const baseY = sampleMeshHeight(x, z);
  const hw = w * 0.5;
  const hd = d * 0.5;
  const eaveX = hw + 0.65;
  const eaveZ = hd + 0.65;
  const eaveY = baseY + wallH - 0.18;
  const ridgeY = baseY + wallH + roofH;

  const c = Math.cos(rotY);
  const s = Math.sin(rotY);
  const pt = (lx, wy, lz) => [x + lx * c + lz * s, wy, z - lx * s + lz * c];

  // Main wall block (sunk 1.4m into terrain slope so foundations stay flush)
  b.box(x, baseY + (wallH - 1.4) * 0.5, z, w, wallH + 1.4, d, wall[0], wall[1], wall[2], rotY);

  // Triangular gable end walls (+Z and -Z)
  const gF0 = pt(-hw, baseY + wallH, hd);
  const gF1 = pt(hw, baseY + wallH, hd);
  const gFT = pt(0, ridgeY, hd);
  b.tri(...gFT, ...gF0, ...gF1, wall[0] * 0.94, wall[1] * 0.94, wall[2] * 0.94);

  const gB0 = pt(hw, baseY + wallH, -hd);
  const gB1 = pt(-hw, baseY + wallH, -hd);
  const gBT = pt(0, ridgeY, -hd);
  b.tri(...gBT, ...gB0, ...gB1, wall[0] * 0.87, wall[1] * 0.87, wall[2] * 0.87);

  // Pitched roof slopes + overhanging soffits
  const rF = pt(0, ridgeY, eaveZ);
  const rB = pt(0, ridgeY, -eaveZ);
  const eRF = pt(eaveX, eaveY, eaveZ);
  const eRB = pt(eaveX, eaveY, -eaveZ);
  const eLF = pt(-eaveX, eaveY, eaveZ);
  const eLB = pt(-eaveX, eaveY, -eaveZ);

  b.quad(...rF, ...eRF, ...eRB, ...rB, roof[0], roof[1], roof[2]);
  b.quad(...rB, ...eLB, ...eLF, ...rF, roof[0] * 0.90, roof[1] * 0.90, roof[2] * 0.90);
  b.quad(...rB, ...eRB, ...eRF, ...rF, roof[0] * 0.55, roof[1] * 0.55, roof[2] * 0.55);
  b.quad(...rF, ...eLF, ...eLB, ...rB, roof[0] * 0.55, roof[1] * 0.55, roof[2] * 0.55);

  // Brick chimney
  const [chX, , chZ] = pt(hw * 0.45, 0, -hd * 0.25);
  b.box(chX, baseY + wallH + roofH * 0.72, chZ, 1.1, 2.2, 1.1, 0.50, 0.27, 0.22, rotY);

  // Front door & windows (lit windows go ONLY into emissive mesh to avoid z-fighting)
  const [doorX, , doorZ] = pt(0, 0, hd + 0.08);
  b.box(doorX, baseY + 1.15, doorZ, 1.4, 2.3, 0.16, 0.30, 0.20, 0.14, rotY);

  const winDefs = [
    [-hw * 0.55, 2.6, hd + 0.08, 1.45, 1.25, '+z'],
    [hw * 0.55, 2.6, hd + 0.08, 1.45, 1.25, '+z'],
    [0, 2.6, -hd - 0.08, 1.55, 1.25, '-z'],
    [hw + 0.08, 2.6, -hd * 0.42, 1.45, 1.25, '+x'],
    [hw + 0.08, 2.6, hd * 0.42, 1.45, 1.25, '+x'],
    [-hw - 0.08, 2.6, -hd * 0.42, 1.45, 1.25, '-x'],
    [-hw - 0.08, 2.6, hd * 0.42, 1.45, 1.25, '-x'],
  ];
  for (let i = 0; i < winDefs.length; i += 1) {
    const [wlx, wly, wlz, ww, wh, dir] = winDefs[i];
    const isLit = windowHash(x, z, i) < litProb;
    if (isLit) {
      const [er, eg, eb] = emissiveAmber(x, z, i);
      addEmissiveWindowQuad(ew, x, baseY, z, rotY, wlx, wly, wlz, ww, wh, dir, er, eg, eb);
    } else {
      const [wx, , wz] = pt(wlx, 0, wlz);
      const isX = dir === '+x' || dir === '-x';
      b.box(wx, baseY + wly, wz, isX ? 0.12 : ww, wh, isX ? ww : 0.12, 0.19, 0.24, 0.30, rotY);
    }
  }
}

function addBarn(b, ew, spec, litProb = 0.40) {
  const { x, z, rotY, w = 13.0, d = 18.5, wallH = 5.6, roofH = 4.2, wall = [0.58, 0.29, 0.22], roof = [0.26, 0.28, 0.33] } = spec;
  const baseY = sampleMeshHeight(x, z);
  const hw = w * 0.5;
  const hd = d * 0.5;
  const eaveX = hw + 0.7;
  const eaveZ = hd + 0.7;
  const eaveY = baseY + wallH - 0.15;
  const ridgeY = baseY + wallH + roofH;
  const c = Math.cos(rotY);
  const s = Math.sin(rotY);
  const pt = (lx, wy, lz) => [x + lx * c + lz * s, wy, z - lx * s + lz * c];

  b.box(x, baseY + (wallH - 1.6) * 0.5, z, w, wallH + 1.6, d, wall[0], wall[1], wall[2], rotY);
  b.tri(...pt(0, ridgeY, hd), ...pt(-hw, baseY + wallH, hd), ...pt(hw, baseY + wallH, hd), wall[0] * 0.94, wall[1] * 0.94, wall[2] * 0.94);
  b.tri(...pt(0, ridgeY, -hd), ...pt(hw, baseY + wallH, -hd), ...pt(-hw, baseY + wallH, -hd), wall[0] * 0.87, wall[1] * 0.87, wall[2] * 0.87);

  const rF = pt(0, ridgeY, eaveZ);
  const rB = pt(0, ridgeY, -eaveZ);
  const eRF = pt(eaveX, eaveY, eaveZ);
  const eRB = pt(eaveX, eaveY, -eaveZ);
  const eLF = pt(-eaveX, eaveY, eaveZ);
  const eLB = pt(-eaveX, eaveY, -eaveZ);
  b.quad(...rF, ...eRF, ...eRB, ...rB, roof[0], roof[1], roof[2]);
  b.quad(...rB, ...eLB, ...eLF, ...rF, roof[0] * 0.90, roof[1] * 0.90, roof[2] * 0.90);
  b.quad(...rB, ...eRB, ...eRF, ...rF, roof[0] * 0.55, roof[1] * 0.55, roof[2] * 0.55);
  b.quad(...rF, ...eLF, ...eLB, ...rB, roof[0] * 0.55, roof[1] * 0.55, roof[2] * 0.55);

  // Large framed barn doors (+Z)
  const [bdX, , bdZ] = pt(0, 0, hd + 0.08);
  b.box(bdX, baseY + 2.0, bdZ, 3.8, 3.8, 0.18, 0.82, 0.79, 0.74, rotY);
  b.box(bdX, baseY + 2.0, bdZ + 0.06, 3.3, 3.4, 0.12, wall[0] * 0.78, wall[1] * 0.78, wall[2] * 0.78, rotY);

  // Hayloft & side windows
  const barnWins = [
    [0, wallH + 1.4, hd + 0.08, 1.5, 1.3, '+z'],
    [hw + 0.08, 2.8, -hd * 0.35, 1.4, 1.1, '+x'],
    [hw + 0.08, 2.8, hd * 0.35, 1.4, 1.1, '+x'],
    [-hw - 0.08, 2.8, 0, 1.5, 1.1, '-x'],
  ];
  for (let i = 0; i < barnWins.length; i += 1) {
    const [wlx, wly, wlz, ww, wh, dir] = barnWins[i];
    if (windowHash(x, z, i + 20) < litProb) {
      const [er, eg, eb] = emissiveAmber(x, z, i + 20);
      addEmissiveWindowQuad(ew, x, baseY, z, rotY, wlx, wly, wlz, ww, wh, dir, er, eg, eb);
    } else {
      const [wx, , wz] = pt(wlx, 0, wlz);
      const isX = dir === '+x' || dir === '-x';
      b.box(wx, baseY + wly, wz, isX ? 0.12 : ww, wh, isX ? ww : 0.12, 0.20, 0.23, 0.28, rotY);
    }
  }
}

function addSilo(b, cx, cz, radius = 2.6, h = 11.2) {
  const baseY = sampleMeshHeight(cx, cz);
  addSmoothCylinder(b, cx, baseY - 1.2, cz, radius, radius * 0.98, h + 1.2, 12, 0.72, 0.73, 0.72, 1.04);
  // Subtle galvanized dome cap (3 stepped rings)
  addSmoothCylinder(b, cx, baseY + h, cz, radius * 1.02, radius * 0.78, 1.1, 12, 0.64, 0.67, 0.70, 1.05);
  addSmoothCone(b, cx, baseY + h + 1.1, cz, 1.6, radius * 0.78, 12, 0.68, 0.70, 0.73);
}

function addTownChurch(b, ew, x, z, rotY) {
  const baseY = sampleMeshHeight(x, z);
  const w = 13;
  const d = 24;
  const wallH = 8.2;
  const roofH = 5.4;
  addHouse(b, { x, z, rotY, w, d, wallH, roofH, wall: [0.80, 0.77, 0.72], roof: [0.27, 0.29, 0.34] }, ew, 0.72);
  const c = Math.cos(rotY);
  const s = Math.sin(rotY);
  const tx = x + (d * 0.42) * s;
  const tz = z + (d * 0.42) * c;

  // Raised bell tower (~26.5 m total): lower stone shaft + upper clock/belfry stage + spire
  b.box(tx, baseY + 8.0, tz, 5.4, 16.0, 5.4, 0.79, 0.76, 0.70, rotY);
  b.box(tx, baseY + 18.2, tz, 5.0, 4.4, 5.0, 0.82, 0.79, 0.73, rotY);
  b.box(tx, baseY + 16.1, tz, 5.8, 0.55, 5.8, 0.56, 0.55, 0.52, rotY);
  addSmoothCone(b, tx, baseY + 20.4, tz, 6.1, 3.4, 4, 0.24, 0.27, 0.32, rotY + Math.PI * 0.25);

  // Clock faces (light disc + dark hands) on all 4 faces near top of tower (y = 18.4 m)
  const clockY = baseY + 18.4;
  const faces = [
    { lx: 0, lz: 2.55, rot: rotY },
    { lx: 0, lz: -2.55, rot: rotY + Math.PI },
    { lx: 2.55, lz: 0, rot: rotY + Math.PI * 0.5 },
    { lx: -2.55, lz: 0, rot: rotY - Math.PI * 0.5 },
  ];
  for (let f = 0; f < faces.length; f += 1) {
    const fc = faces[f];
    const fx = tx + fc.lx * c + fc.lz * s;
    const fz = tz - fc.lx * s + fc.lz * c;
    const fCos = Math.cos(fc.rot);
    const fSin = Math.sin(fc.rot);
    // Light clock disc (8-gon) + dark rim backing
    const segs = 8;
    const rad = 1.15;
    for (let k = 0; k < segs; k += 1) {
      const a0 = (k / segs) * Math.PI * 2;
      const a1 = ((k + 1) / segs) * Math.PI * 2;
      const p1x = fx + Math.cos(a0) * rad * fCos;
      const p1y = clockY + Math.sin(a0) * rad;
      const p1z = fz - Math.cos(a0) * rad * fSin;
      const p2x = fx + Math.cos(a1) * rad * fCos;
      const p2y = clockY + Math.sin(a1) * rad;
      const p2z = fz - Math.cos(a1) * rad * fSin;
      b.tri(fx, clockY, fz, p1x, p1y, p1z, p2x, p2y, p2z, 0.94, 0.91, 0.82);
    }
    // Dark hour & minute hands proud of disc
    const hx = fx + 0.05 * fSin;
    const hz = fz + 0.05 * fCos;
    b.box(hx, clockY + 0.38, hz, 0.16, 0.85, 0.08, 0.14, 0.15, 0.18, fc.rot);
    b.box(hx + 0.28 * fCos, clockY + 0.06, hz - 0.28 * fSin, 0.68, 0.14, 0.08, 0.14, 0.15, 0.18, fc.rot);
  }

  // Warm emissive arched nave windows
  for (let i = -1; i <= 1; i += 1) {
    addEmissiveWindowQuad(ew, x, baseY, z, rotY, w * 0.5 + 0.09, 4.4, i * 6.0, 1.6, 3.2, '+x', 1.08, 0.68, 0.30);
    addEmissiveWindowQuad(ew, x, baseY, z, rotY, -w * 0.5 - 0.09, 4.4, i * 6.0, 1.6, 3.2, '-x', 1.08, 0.68, 0.30);
  }
}

function addTownSchool(b, ew, x, z, rotY) {
  // Larger two-wing civic/school building with clock cupola
  addHouse(b, { x, z, rotY, w: 15, d: 30, wallH: 6.8, roofH: 4.2, wall: [0.74, 0.44, 0.34], roof: [0.28, 0.31, 0.36] }, ew, 0.65);
  const baseY = sampleMeshHeight(x, z);
  b.box(x, baseY + 11.8, z, 3.6, 3.2, 3.6, 0.84, 0.81, 0.75, rotY);
  addSmoothCone(b, x, baseY + 13.4, z, 3.2, 2.5, 4, 0.28, 0.31, 0.36, rotY + Math.PI * 0.25);
  // Second-story school classroom windows
  for (let i = -2; i <= 2; i += 1) {
    const isLit = windowHash(x, z, i + 30) < 0.64;
    if (isLit) {
      const [er, eg, eb] = emissiveAmber(x, z, i + 30);
      addEmissiveWindowQuad(ew, x, baseY, z, rotY, 7.58, 5.0, i * 4.8, 1.6, 1.3, '+x', er, eg, eb);
      addEmissiveWindowQuad(ew, x, baseY, z, rotY, -7.58, 5.0, i * 4.8, 1.6, 1.3, '-x', er, eg, eb);
    }
  }
}

function addWaterTower(b, ew, cx, cz) {
  const baseY = sampleMeshHeight(cx, cz);
  const legCol = [0.42, 0.45, 0.49];
  // Concrete footing pad
  b.box(cx, baseY + 0.25, cz, 9.0, 0.5, 9.0, 0.48, 0.48, 0.46);
  // Central riser pipe
  addSmoothCylinder(b, cx, baseY + 0.4, cz, 0.65, 0.55, 13.8, 8, 0.46, 0.49, 0.52);

  // 6 angled support legs from base radius 4.0m up to tank floor radius 3.1m at y = 13.8m
  const legCount = 6;
  const tankBotY = 13.8;
  for (let i = 0; i < legCount; i += 1) {
    const ang = (i / legCount) * Math.PI * 2 + 0.2;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const lx0 = cx + ca * 3.9;
    const lz0 = cz + sa * 3.9;
    const lx1 = cx + ca * 3.0;
    const lz1 = cz + sa * 3.0;
    // Two-segment angled leg approximation via slender tilted columns + horizontal collar
    b.box((lx0 + lx1) * 0.5, baseY + tankBotY * 0.5, (lz0 + lz1) * 0.5, 0.52, tankBotY + 0.4, 0.52, ...legCol, -ang);
    b.box(lx0, baseY + 0.8, lz0, 0.85, 1.6, 0.85, 0.44, 0.44, 0.43);
  }
  // Horizontal brace collars at mid-height & tank base
  addSmoothCylinder(b, cx, baseY + 6.8, cz, 3.55, 3.55, 0.35, 6, 0.38, 0.41, 0.45);
  addSmoothCylinder(b, cx, baseY + tankBotY - 0.35, cz, 4.35, 4.35, 0.48, 12, 0.45, 0.47, 0.50);

  // Cylindrical water tank (y: 13.8..20.2m) + accent band + cone roof (to ~23.5m)
  addSmoothCylinder(b, cx, baseY + tankBotY, cz, 3.9, 3.9, 6.4, 14, 0.78, 0.80, 0.76, 1.03);
  addSmoothCylinder(b, cx, baseY + tankBotY + 2.4, cz, 3.96, 3.96, 1.05, 14, 0.34, 0.44, 0.52, 1.0);
  addSmoothCone(b, cx, baseY + tankBotY + 6.4, cz, 3.3, 4.25, 14, 0.30, 0.35, 0.41);

  // Small red aircraft warning beacon on spire tip
  addEmissiveWindowQuad(ew, cx, baseY, cz, 0, 0, tankBotY + 9.9, 0.25, 0.65, 0.65, '+z', 1.25, 0.28, 0.16);
  addEmissiveWindowQuad(ew, cx, baseY, cz, 0, 0, tankBotY + 9.9, -0.25, 0.65, 0.65, '-z', 1.25, 0.28, 0.16);
}

function addMultiStoryBuilding(b, ew, spec, litProb = 0.64) {
  const { x, z, rotY, w, d, floors, floorH = 3.4, wall, roof } = spec;
  const wallH = floors * floorH;
  const baseY = sampleMeshHeight(x, z);
  const hw = w * 0.5;
  const hd = d * 0.5;

  // Main multi-story mass sunk 1.4m into terrain
  b.box(x, baseY + (wallH - 1.4) * 0.5, z, w, wallH + 1.4, d, wall[0], wall[1], wall[2], rotY);
  // Subtle horizontal cornice & rooftop parapet + tar roof deck + penthouse/HVAC
  b.box(x, baseY + wallH + 0.35, z, w + 0.6, 0.7, d + 0.6, wall[0] * 0.84, wall[1] * 0.84, wall[2] * 0.84, rotY);
  b.box(x, baseY + wallH + 0.72, z, w - 0.8, 0.18, d - 0.8, roof[0], roof[1], roof[2], rotY);
  b.box(x - hw * 0.25, baseY + wallH + 1.35, z + hd * 0.2, w * 0.28, 1.2, d * 0.28, 0.44, 0.45, 0.48, rotY);

  const c = Math.cos(rotY);
  const s = Math.sin(rotY);
  const pt = (lx, wy, lz) => [x + lx * c + lz * s, wy, z - lx * s + lz * c];

  const colsX = Math.max(3, Math.floor((w - 2.0) / 4.2));
  const colsZ = Math.max(3, Math.floor((d - 2.0) / 4.2));
  let winIdx = 0;

  for (let fl = 0; fl < floors; fl += 1) {
    const wy = fl * floorH + floorH * 0.54;
    // Front (+Z) and Back (-Z) facades
    for (let ix = 0; ix < colsX; ix += 1) {
      const lx = -hw + 2.2 + (colsX > 1 ? (ix / (colsX - 1)) * (w - 4.4) : (w - 4.4) * 0.5);
      for (const [lz, dir] of [[hd + 0.08, '+z'], [-hd - 0.08, '-z']]) {
        const isLit = windowHash(x + fl, z + ix, winIdx) < litProb;
        if (isLit) {
          const [er, eg, eb] = emissiveAmber(x + fl, z + ix, winIdx);
          addEmissiveWindowQuad(ew, x, baseY, z, rotY, lx, wy, lz, 1.75, 1.45, dir, er, eg, eb);
        } else {
          const [wx, , wz] = pt(lx, 0, lz);
          b.box(wx, baseY + wy, wz, 1.75, 1.45, 0.12, 0.18, 0.23, 0.29, rotY);
        }
        winIdx += 1;
      }
    }
    // Right (+X) and Left (-X) facades
    for (let iz = 0; iz < colsZ; iz += 1) {
      const lz = -hd + 2.2 + (colsZ > 1 ? (iz / (colsZ - 1)) * (d - 4.4) : (d - 4.4) * 0.5);
      for (const [lx, dir] of [[hw + 0.08, '+x'], [-hw - 0.08, '-x']]) {
        const isLit = windowHash(x + iz, z + fl, winIdx) < litProb;
        if (isLit) {
          const [er, eg, eb] = emissiveAmber(x + iz, z + fl, winIdx);
          addEmissiveWindowQuad(ew, x, baseY, z, rotY, lx, wy, lz, 1.75, 1.45, dir, er, eg, eb);
        } else {
          const [wx, , wz] = pt(lx, 0, lz);
          b.box(wx, baseY + wy, wz, 0.12, 1.45, 1.75, 0.18, 0.23, 0.29, rotY);
        }
        winIdx += 1;
      }
    }
  }
}

function buildTownHousesList() {
  const rand = createRandom(6060);
  const houses = [];
  const wallPalette = [
    [0.82, 0.78, 0.71],
    [0.78, 0.72, 0.63],
    [0.74, 0.76, 0.70],
    [0.80, 0.70, 0.62],
    [0.75, 0.68, 0.58],
  ];
  const roofPalette = [
    [0.56, 0.29, 0.22],
    [0.27, 0.30, 0.36],
    [0.46, 0.28, 0.21],
    [0.32, 0.34, 0.39],
  ];

  // Original 44-house core block (kept first so tree exclusion stays identical)
  const cols = [-190, -105, -20, 65, 150];
  const rows = [-165, -75, 15, 105, 195];
  for (let r = 0; r < rows.length; r += 1) {
    for (let c = 0; c < cols.length; c += 1) {
      if (c === 2 && (r === 1 || r === 2)) continue;
      for (let lot = 0; lot < 2; lot += 1) {
        if (houses.length >= 44) break;
        const jx = (rand() - 0.5) * 16 + (lot === 0 ? -18 : 18);
        const jz = (rand() - 0.5) * 18 + (lot === 0 ? -14 : 14);
        const hx = TOWN_CENTER.x + cols[c] + jx;
        const hz = TOWN_CENTER.z + rows[r] + jz;
        const w = 8.4 + rand() * 3.0;
        const d = 10.4 + rand() * 3.8;
        const wallH = 4.3 + rand() * 1.4;
        const roofH = 2.8 + rand() * 1.1;
        const rotY = (lot === 0 ? 0 : Math.PI * 0.5) + (rand() - 0.5) * 0.22;
        houses.push({
          x: hx,
          z: hz,
          rotY,
          w,
          d,
          wallH,
          roofH,
          wall: wallPalette[Math.floor(rand() * wallPalette.length)],
          roof: roofPalette[Math.floor(rand() * roofPalette.length)],
        });
      }
    }
  }

  // Expanded Oakwood infill + outer grid blocks + 2 angled/curved side streets (~80 more houses -> ~124 total)
  const expCols = [-245, -175, -105, -30, 45, 120, 195];
  const expRows = [-230, -160, -90, -12, 62, 138, 212];
  const isNearExistingOrCivic = (hx, hz) => {
    if (Math.hypot(hx - (TOWN_CENTER.x - 16), hz - (TOWN_CENTER.z - 68)) < 28) return true;
    if (Math.hypot(hx - (TOWN_CENTER.x + 18), hz - (TOWN_CENTER.z + 24)) < 32) return true;
    // Clear of multi-story civic buildings & main street
    if (Math.abs(hz - (TOWN_CENTER.z + 25)) < 15) return true;
    for (const ms of [
      [-48, 62], [54, -20], [-105, -18], [116, 60], [255, -195],
    ]) {
      if (Math.hypot(hx - (TOWN_CENTER.x + ms[0]), hz - (TOWN_CENTER.z + ms[1])) < 24) return true;
    }
    for (let i = 0; i < houses.length; i += 1) {
      if (Math.hypot(hx - houses[i].x, hz - houses[i].z) < 20) return true;
    }
    return false;
  };

  for (let r = 0; r < expRows.length; r += 1) {
    for (let c = 0; c < expCols.length; c += 1) {
      for (let lot = 0; lot < 3; lot += 1) {
        if (houses.length >= 114) break;
        const ox = lot === 0 ? -16 : lot === 1 ? 16 : 0;
        const oz = lot === 2 ? 16 : -12;
        const hx = TOWN_CENTER.x + expCols[c] + ox + (rand() - 0.5) * 10;
        const hz = TOWN_CENTER.z + expRows[r] + oz + (rand() - 0.5) * 10;
        if (isNearExistingOrCivic(hx, hz)) continue;
        houses.push({
          x: hx,
          z: hz,
          rotY: (lot % 2 === 0 ? 0 : Math.PI * 0.5) + (rand() - 0.5) * 0.25,
          w: 8.2 + rand() * 3.2,
          d: 10.0 + rand() * 3.8,
          wallH: 4.3 + rand() * 1.5,
          roofH: 2.7 + rand() * 1.1,
          wall: wallPalette[Math.floor(rand() * wallPalette.length)],
          roof: roofPalette[Math.floor(rand() * roofPalette.length)],
        });
      }
    }
  }

  // Houses lining the 2 curved/angled side streets (NW crescent & SE crescent)
  const crescentLots = [
    [-255, -248, 0.58], [-212, -280, 0.42], [-162, -296, 0.26], [-108, -310, 0.14], [-48, -316, 0.08], [15, -318, 0.04],
    [195, 255, -0.52], [248, 224, -0.82], [288, 178, -1.12], [308, 118, -1.42], [312, 55, -1.55], [305, -8, -1.68],
  ];
  for (let i = 0; i < crescentLots.length; i += 1) {
    const [lx, lz, rot] = crescentLots[i];
    const hx = TOWN_CENTER.x + lx;
    const hz = TOWN_CENTER.z + lz;
    if (isNearExistingOrCivic(hx, hz)) continue;
    houses.push({
      x: hx,
      z: hz,
      rotY: rot + (rand() - 0.5) * 0.14,
      w: 8.6 + rand() * 2.6,
      d: 10.8 + rand() * 3.2,
      wallH: 4.5 + rand() * 1.3,
      roofH: 2.9 + rand() * 1.0,
      wall: wallPalette[Math.floor(rand() * wallPalette.length)],
      roof: roofPalette[Math.floor(rand() * roofPalette.length)],
    });
  }
  return houses;
}

const TOWN_HOUSES = buildTownHousesList();
const ORIGINAL_TOWN_HOUSES = TOWN_HOUSES.slice(0, 44);

const TOWN_MULTI_STORY = [
  { x: TOWN_CENTER.x - 48, z: TOWN_CENTER.z + 62, rotY: 0.02, w: 16.5, d: 21.0, floors: 4, floorH: 3.4, wall: [0.76, 0.69, 0.61], roof: [0.24, 0.26, 0.30] },
  { x: TOWN_CENTER.x + 54, z: TOWN_CENTER.z - 20, rotY: 1.56, w: 18.0, d: 22.0, floors: 5, floorH: 3.35, wall: [0.78, 0.75, 0.70], roof: [0.25, 0.27, 0.31] },
  { x: TOWN_CENTER.x - 105, z: TOWN_CENTER.z - 18, rotY: -0.04, w: 15.5, d: 19.0, floors: 3, floorH: 3.7, wall: [0.71, 0.50, 0.40], roof: [0.26, 0.28, 0.32] },
  { x: TOWN_CENTER.x + 116, z: TOWN_CENTER.z + 60, rotY: 1.59, w: 16.5, d: 20.5, floors: 4, floorH: 3.5, wall: [0.73, 0.74, 0.68], roof: [0.24, 0.26, 0.30] },
];

// River Hamlet: 12 houses + 2 barns in (250..450, 2050..2350), >= 150m from river centerline
const RIVER_HAMLET_HOUSES = [
  { x: 342, z: 2178, rotY: 0.22, w: 9.0, d: 11.4, wallH: 4.6, roofH: 3.2, wall: [0.80, 0.76, 0.68], roof: [0.55, 0.28, 0.21] },
  { x: 378, z: 2182, rotY: 1.64, w: 8.6, d: 10.8, wallH: 4.5, roofH: 3.0, wall: [0.76, 0.71, 0.62], roof: [0.28, 0.31, 0.36] },
  { x: 416, z: 2188, rotY: -0.35, w: 9.4, d: 11.8, wallH: 4.7, roofH: 3.3, wall: [0.74, 0.75, 0.70], roof: [0.46, 0.28, 0.21] },
  { x: 326, z: 2218, rotY: 1.48, w: 8.8, d: 11.0, wallH: 4.5, roofH: 3.1, wall: [0.79, 0.74, 0.66], roof: [0.54, 0.27, 0.20] },
  { x: 364, z: 2224, rotY: -1.62, w: 9.2, d: 11.6, wallH: 4.8, roofH: 3.3, wall: [0.81, 0.77, 0.70], roof: [0.27, 0.30, 0.35] },
  { x: 404, z: 2226, rotY: 0.14, w: 8.8, d: 10.6, wallH: 4.4, roofH: 3.0, wall: [0.77, 0.69, 0.60], roof: [0.56, 0.29, 0.22] },
  { x: 438, z: 2236, rotY: 1.72, w: 9.6, d: 12.0, wallH: 4.8, roofH: 3.4, wall: [0.75, 0.72, 0.64], roof: [0.30, 0.33, 0.38] },
  { x: 318, z: 2264, rotY: -0.22, w: 9.0, d: 11.2, wallH: 4.6, roofH: 3.2, wall: [0.78, 0.73, 0.65], roof: [0.45, 0.27, 0.20] },
  { x: 358, z: 2268, rotY: 1.52, w: 8.8, d: 11.4, wallH: 4.5, roofH: 3.1, wall: [0.80, 0.76, 0.69], roof: [0.54, 0.28, 0.21] },
  { x: 398, z: 2272, rotY: -1.48, w: 9.2, d: 11.8, wallH: 4.7, roofH: 3.3, wall: [0.73, 0.74, 0.69], roof: [0.28, 0.31, 0.36] },
  { x: 332, z: 2308, rotY: 0.32, w: 9.4, d: 11.6, wallH: 4.7, roofH: 3.2, wall: [0.78, 0.71, 0.63], roof: [0.55, 0.29, 0.22] },
  { x: 382, z: 2314, rotY: -1.68, w: 8.8, d: 10.8, wallH: 4.5, roofH: 3.1, wall: [0.76, 0.74, 0.66], roof: [0.46, 0.28, 0.21] },
];
const RIVER_HAMLET_BARNS = [
  { x: 432, z: 2288, rotY: 0.18, w: 12.5, d: 18.0, wallH: 5.4, roofH: 4.0, wall: [0.58, 0.29, 0.22], roof: [0.27, 0.29, 0.34] },
  { x: 298, z: 2292, rotY: 1.45, w: 12.0, d: 17.0, wallH: 5.2, roofH: 3.9, wall: [0.66, 0.58, 0.48], roof: [0.30, 0.32, 0.37] },
];

// Lake-shore village: 11 houses near northern lake's southern/western shore (-1250±200, -1950±200)
const LAKE_VILLAGE_HOUSES = [
  { x: -1272, z: -2028, rotY: 0.45, w: 9.0, d: 11.2, wallH: 4.5, roofH: 3.1, wall: [0.79, 0.75, 0.68], roof: [0.28, 0.31, 0.36] },
  { x: -1228, z: -2022, rotY: 1.52, w: 8.6, d: 10.8, wallH: 4.4, roofH: 3.0, wall: [0.74, 0.75, 0.70], roof: [0.54, 0.28, 0.21] },
  { x: -1178, z: -2016, rotY: -0.25, w: 9.2, d: 11.4, wallH: 4.6, roofH: 3.2, wall: [0.81, 0.77, 0.70], roof: [0.27, 0.30, 0.35] },
  { x: -1282, z: -1984, rotY: 1.64, w: 8.8, d: 11.0, wallH: 4.5, roofH: 3.1, wall: [0.77, 0.71, 0.63], roof: [0.46, 0.28, 0.21] },
  { x: -1236, z: -1978, rotY: -1.48, w: 9.4, d: 11.8, wallH: 4.7, roofH: 3.3, wall: [0.78, 0.74, 0.66], roof: [0.55, 0.28, 0.21] },
  { x: -1188, z: -1972, rotY: 0.12, w: 9.0, d: 11.2, wallH: 4.6, roofH: 3.2, wall: [0.75, 0.72, 0.65], roof: [0.29, 0.32, 0.37] },
  { x: -1146, z: -1968, rotY: 1.58, w: 8.6, d: 10.6, wallH: 4.4, roofH: 3.0, wall: [0.80, 0.76, 0.69], roof: [0.46, 0.27, 0.20] },
  { x: -1266, z: -1936, rotY: -0.35, w: 9.0, d: 11.4, wallH: 4.6, roofH: 3.2, wall: [0.73, 0.74, 0.69], roof: [0.54, 0.27, 0.20] },
  { x: -1218, z: -1928, rotY: 1.44, w: 9.2, d: 11.6, wallH: 4.7, roofH: 3.2, wall: [0.79, 0.73, 0.65], roof: [0.27, 0.30, 0.35] },
  { x: -1168, z: -1920, rotY: -1.62, w: 8.8, d: 10.8, wallH: 4.5, roofH: 3.1, wall: [0.76, 0.69, 0.60], roof: [0.56, 0.29, 0.22] },
  { x: -1212, z: -1886, rotY: 0.22, w: 9.6, d: 12.0, wallH: 4.8, roofH: 3.4, wall: [0.80, 0.76, 0.68], roof: [0.30, 0.33, 0.38] },
];

// Farmland hamlet: 7 farmhouses + 3 barns around (-700±200, 2550±250)
const FARMLAND_HAMLET_HOUSES = [
  { x: -756, z: 2486, rotY: 0.24, w: 9.4, d: 11.8, wallH: 4.7, roofH: 3.2, wall: [0.80, 0.76, 0.69], roof: [0.54, 0.28, 0.21] },
  { x: -698, z: 2492, rotY: 1.62, w: 9.0, d: 11.4, wallH: 4.6, roofH: 3.1, wall: [0.77, 0.71, 0.63], roof: [0.27, 0.30, 0.35] },
  { x: -636, z: 2504, rotY: -0.32, w: 9.2, d: 11.6, wallH: 4.7, roofH: 3.2, wall: [0.75, 0.75, 0.70], roof: [0.46, 0.28, 0.21] },
  { x: -764, z: 2548, rotY: 1.50, w: 8.8, d: 11.0, wallH: 4.5, roofH: 3.1, wall: [0.79, 0.74, 0.66], roof: [0.56, 0.29, 0.22] },
  { x: -708, z: 2556, rotY: -1.58, w: 9.6, d: 12.2, wallH: 4.8, roofH: 3.4, wall: [0.81, 0.77, 0.70], roof: [0.28, 0.31, 0.36] },
  { x: -644, z: 2564, rotY: 0.16, w: 9.0, d: 11.2, wallH: 4.6, roofH: 3.2, wall: [0.76, 0.69, 0.61], roof: [0.54, 0.27, 0.20] },
  { x: -726, z: 2612, rotY: 0.42, w: 9.2, d: 11.6, wallH: 4.7, roofH: 3.2, wall: [0.78, 0.73, 0.65], roof: [0.30, 0.33, 0.38] },
];
const FARMLAND_HAMLET_BARNS = [
  { x: -648, z: 2618, rotY: 0.14, w: 13.0, d: 18.5, wallH: 5.5, roofH: 4.1, wall: [0.58, 0.29, 0.22], roof: [0.26, 0.28, 0.33] },
  { x: -778, z: 2598, rotY: 1.55, w: 12.2, d: 17.5, wallH: 5.3, roofH: 3.9, wall: [0.68, 0.62, 0.52], roof: [0.45, 0.27, 0.21] },
  { x: -616, z: 2542, rotY: -0.22, w: 12.5, d: 17.5, wallH: 5.4, roofH: 4.0, wall: [0.56, 0.30, 0.23], roof: [0.28, 0.30, 0.35] },
];

// 6 scattered lone farmsteads (house + barn + cylindrical silo with dome cap)
const LONE_FARMSTEADS = [
  { x: -435, z: 620, rotY: 0.28 },
  { x: 575, z: 560, rotY: -0.42 },
  { x: -550, z: 1360, rotY: 0.15 },
  { x: 675, z: 1620, rotY: 1.42 },
  { x: -290, z: 1880, rotY: -0.30 },
  { x: 245, z: 2860, rotY: 0.52 },
];

function addWoodenJetty(b, ew, startX, endX, z) {
  const len = Math.abs(endX - startX);
  const midX = (startX + endX) * 0.5;
  const deckY = WORLD.waterY + 0.85;
  // Planked deck & side stringers
  b.box(midX, deckY, z, len, 0.22, 3.2, 0.46, 0.33, 0.22);
  b.box(midX, deckY + 0.14, z - 1.5, len, 0.14, 0.22, 0.38, 0.27, 0.18);
  b.box(midX, deckY + 0.14, z + 1.5, len, 0.14, 0.22, 0.38, 0.27, 0.18);
  // Timber pilings sunk into lake bed
  const steps = Math.floor(len / 9);
  for (let i = 0; i <= steps; i += 1) {
    const px = lerp(startX, endX, i / steps);
    for (const pz of [z - 1.35, z + 1.35]) {
      b.box(px, deckY - 1.8, pz, 0.34, 4.4, 0.34, 0.32, 0.22, 0.14);
    }
  }
  // Small mooring lantern post at jetty tip
  b.box(endX - 0.5, deckY + 1.1, z + 1.3, 0.18, 2.0, 0.18, 0.26, 0.20, 0.14);
  addEmissiveWindowQuad(ew, endX - 0.5, deckY, z + 1.3, 0, 0, 2.15, 0.26, 0.45, 0.45, '+z', 1.05, 0.66, 0.28);
  addEmissiveWindowQuad(ew, endX - 0.5, deckY, z + 1.3, 0, 0, 2.15, -0.26, 0.45, 0.45, '-z', 1.05, 0.66, 0.28);
}

function populateSettlements(b, ew) {
  for (let i = 0; i < VILLAGE_HOUSES.length; i += 1) {
    addHouse(b, VILLAGE_HOUSES[i], ew, 0.42);
  }

  // Oakwood Town (SE of airfield): denser street grid + 2 curved side streets, ~124 houses,
  // raised clock-tower church, school, water tower, 4 multi-story buildings & main-street lights
  const streetX = [-280, -210, -140, -65, 10, 85, 160, 235];
  const streetZ = [-265, -195, -125, -50, 25, 100, 175, 250];
  for (let i = 0; i < streetZ.length; i += 1) {
    const gz = TOWN_CENTER.z + streetZ[i];
    const isMain = streetZ[i] === 25;
    addRoadRibbon(
      b,
      [{ x: TOWN_CENTER.x - 300, z: gz }, { x: TOWN_CENTER.x, z: gz }, { x: TOWN_CENTER.x + 275, z: gz }],
      isMain ? 4.6 : 3.4,
      isMain ? 1.2 : 1.0,
      isMain ? 0.24 : 0.28,
      isMain ? 0.24 : 0.27,
      isMain ? 0.25 : 0.26,
    );
  }
  for (let i = 0; i < streetX.length; i += 1) {
    const gx = TOWN_CENTER.x + streetX[i];
    addRoadRibbon(
      b,
      [{ x: gx, z: TOWN_CENTER.z - 285 }, { x: gx, z: TOWN_CENTER.z }, { x: gx, z: TOWN_CENTER.z + 275 }],
      3.4,
      1.0,
      0.28,
      0.27,
      0.26,
    );
  }

  // 2 curved/angled side streets (NW crescent + SE crescent)
  const nwStreet = sampleCatmullRom([
    { x: TOWN_CENTER.x - 280, z: TOWN_CENTER.z - 195 },
    { x: TOWN_CENTER.x - 210, z: TOWN_CENTER.z - 255 },
    { x: TOWN_CENTER.x - 110, z: TOWN_CENTER.z - 288 },
    { x: TOWN_CENTER.x + 25, z: TOWN_CENTER.z - 298 },
  ], 14);
  const seStreet = sampleCatmullRom([
    { x: TOWN_CENTER.x + 160, z: TOWN_CENTER.z + 250 },
    { x: TOWN_CENTER.x + 245, z: TOWN_CENTER.z + 205 },
    { x: TOWN_CENTER.x + 288, z: TOWN_CENTER.z + 110 },
    { x: TOWN_CENTER.x + 285, z: TOWN_CENTER.z - 20 },
  ], 14);
  addRoadRibbon(b, nwStreet, 3.1, 0.9, 0.29, 0.28, 0.26);
  addRoadRibbon(b, seStreet, 3.1, 0.9, 0.29, 0.28, 0.26);

  for (let i = 0; i < TOWN_HOUSES.length; i += 1) {
    addHouse(b, TOWN_HOUSES[i], ew, 0.62);
  }
  addTownChurch(b, ew, TOWN_CENTER.x - 16, TOWN_CENTER.z - 68, 0.08);
  addTownSchool(b, ew, TOWN_CENTER.x + 18, TOWN_CENTER.z + 24, 1.57);
  addWaterTower(b, ew, TOWN_CENTER.x + 255, TOWN_CENTER.z - 195);
  for (let i = 0; i < TOWN_MULTI_STORY.length; i += 1) {
    addMultiStoryBuilding(b, ew, TOWN_MULTI_STORY[i], 0.64);
  }

  // Main-street street lights every ~35m along z = TOWN_CENTER.z + 25
  const mainZ = TOWN_CENTER.z + 25;
  for (let i = 0; i < 16; i += 1) {
    const lx = TOWN_CENTER.x - 275 + i * 35;
    const side = i % 2 === 0 ? -1 : 1;
    const lz = mainZ + side * 6.0;
    const ly = sampleMeshHeight(lx, lz);
    b.box(lx, ly + 2.6, lz, 0.22, 5.2, 0.22, 0.22, 0.24, 0.27);
    b.box(lx, ly + 5.15, lz - side * 0.45, 0.20, 0.18, 1.0, 0.22, 0.24, 0.27);
    const lHeadZ = lz - side * 0.88;
    const lHeadY = 5.02;
    addEmissiveWindowQuad(ew, lx, ly, lHeadZ, 0, 0, lHeadY, 0.42, 0.85, 0.65, '+z', 1.15, 0.74, 0.34);
    addEmissiveWindowQuad(ew, lx, ly, lHeadZ, 0, 0, lHeadY, -0.42, 0.85, 0.65, '-z', 1.15, 0.74, 0.34);
    addEmissiveWindowQuad(ew, lx, ly, lHeadZ, 0, 0.42, lHeadY, 0, 0.85, 0.65, '+x', 1.15, 0.74, 0.34);
    addEmissiveWindowQuad(ew, lx, ly, lHeadZ, 0, -0.42, lHeadY, 0, 0.85, 0.65, '-x', 1.15, 0.74, 0.34);
  }

  // Settlement 1: River Hamlet
  addRoadRibbon(
    b,
    [{ x: 300, z: 2202 }, { x: 375, z: 2206 }, { x: 446, z: 2212 }],
    2.6,
    0.8,
    0.34,
    0.32,
    0.29,
  );
  addRoadRibbon(
    b,
    [{ x: 315, z: 2288 }, { x: 380, z: 2292 }, { x: 438, z: 2294 }],
    2.6,
    0.8,
    0.34,
    0.32,
    0.29,
  );
  for (let i = 0; i < RIVER_HAMLET_HOUSES.length; i += 1) {
    addHouse(b, RIVER_HAMLET_HOUSES[i], ew, 0.40);
  }
  for (let i = 0; i < RIVER_HAMLET_BARNS.length; i += 1) {
    addBarn(b, ew, RIVER_HAMLET_BARNS[i], 0.40);
  }

  // Settlement 2: Lake-shore Village + wooden jetty
  addRoadRibbon(
    b,
    [{ x: -1290, z: -1956 }, { x: -1215, z: -1952 }, { x: -1135, z: -1958 }],
    2.5,
    0.8,
    0.34,
    0.32,
    0.29,
  );
  for (let i = 0; i < LAKE_VILLAGE_HOUSES.length; i += 1) {
    addHouse(b, LAKE_VILLAGE_HOUSES[i], ew, 0.42);
  }
  addWoodenJetty(b, ew, -1125, -1042, -1962);

  // Settlement 3: Farmland Hamlet
  addRoadRibbon(
    b,
    [{ x: -785, z: 2524 }, { x: -700, z: 2528 }, { x: -618, z: 2530 }],
    2.6,
    0.8,
    0.35,
    0.33,
    0.29,
  );
  for (let i = 0; i < FARMLAND_HAMLET_HOUSES.length; i += 1) {
    addHouse(b, FARMLAND_HAMLET_HOUSES[i], ew, 0.40);
  }
  for (let i = 0; i < FARMLAND_HAMLET_BARNS.length; i += 1) {
    addBarn(b, ew, FARMLAND_HAMLET_BARNS[i], 0.40);
  }
  addSilo(b, -660, 2610, 2.5, 11.2);

  // 6 Scattered Lone Farmsteads (house + barn + cylindrical silo with dome cap)
  for (let i = 0; i < LONE_FARMSTEADS.length; i += 1) {
    const f = LONE_FARMSTEADS[i];
    const c = Math.cos(f.rotY);
    const s = Math.sin(f.rotY);
    addHouse(b, {
      x: f.x,
      z: f.z,
      rotY: f.rotY,
      w: 9.4,
      d: 11.8,
      wallH: 4.7,
      roofH: 3.3,
      wall: [0.80, 0.76, 0.68],
      roof: i % 2 === 0 ? [0.54, 0.28, 0.21] : [0.28, 0.31, 0.36],
    }, ew, 0.42);
    const bx = f.x + 22 * c - 6 * s;
    const bz = f.z - 22 * s - 6 * c;
    addBarn(b, ew, {
      x: bx,
      z: bz,
      rotY: f.rotY + 1.57,
      w: 12.2,
      d: 17.5,
      wallH: 5.4,
      roofH: 4.0,
      wall: [0.58, 0.29, 0.22],
      roof: [0.27, 0.29, 0.34],
    }, 0.38);
    const sx = bx + 10.5 * c + 5 * s;
    const sz = bz - 10.5 * s + 5 * c;
    addSilo(b, sx, sz, 2.45, 11.4);
  }
}

export function buildVillageMesh() {
  const b = createBuilder();
  populateSettlements(b, NOOP_BUILDER);
  return b.toMesh();
}

export function buildEmissiveMesh() {
  const ew = createBuilder();
  populateAirfield(NOOP_BUILDER, ew);
  populateSettlements(NOOP_BUILDER, ew);
  return ew.toMesh();
}

// --- Organic Multi-Cluster Trees (3 Types) & Irregular Wild Hedgerows ---

/** Smooth-shaded cone helper (used by silos, spires & water tower roofs). */
function addSmoothCone(b, cx, botY, cz, h, radius, sides, r, g, bl, angleOffset = 0, snowAmount = 0) {
  const topY = botY + h;
  const slopeLen = Math.hypot(radius, h) || 1;
  const nHoriz = h / slopeLen;
  const nVert = radius / slopeLen;
  const sr = lerp(r * 1.12, 0.94, snowAmount);
  const sg = lerp(g * 1.12, 0.95, snowAmount);
  const sb = lerp(bl * 1.10, 0.97, snowAmount);
  const rimSnow = snowAmount * 0.48;
  const rr = lerp(r * 0.78, 0.88, rimSnow);
  const rg = lerp(g * 0.78, 0.90, rimSnow);
  const rb = lerp(bl * 0.80, 0.93, rimSnow);

  for (let i = 0; i < sides; i += 1) {
    const a0 = angleOffset + (i / sides) * Math.PI * 2;
    const a1 = angleOffset + ((i + 1) / sides) * Math.PI * 2;
    const c0 = Math.cos(a0);
    const s0 = Math.sin(a0);
    const c1 = Math.cos(a1);
    const s1 = Math.sin(a1);
    const cm = Math.cos((a0 + a1) * 0.5);
    const sm = Math.sin((a0 + a1) * 0.5);
    const x0 = cx + c0 * radius;
    const z0 = cz + s0 * radius;
    const x1 = cx + c1 * radius;
    const z1 = cz + s1 * radius;
    b.pushVert(cx, topY, cz, cm * 0.35, 0.94, sm * 0.35, sr, sg, sb);
    b.pushVert(x1, botY, z1, c1 * nHoriz, nVert, s1 * nHoriz, rr, rg, rb);
    b.pushVert(x0, botY, z0, c0 * nHoriz, nVert, s0 * nHoriz, rr, rg, rb);
    b.pushVert(cx, botY, cz, 0, -1, 0, r * 0.45, g * 0.45, bl * 0.48);
    b.pushVert(x0, botY, z0, 0, -1, 0, r * 0.58, g * 0.58, bl * 0.60);
    b.pushVert(x1, botY, z1, 0, -1, 0, r * 0.58, g * 0.58, bl * 0.60);
  }
}

/** Irregular asymmetric bough tier with strongly notched/drooping rims (no cone edge or flat base). */
function addConiferTier(b, cx, botY, cz, h, radius, sides, r, g, bl, angleOffset = 0, snowAmount = 0, droop = 0.34) {
  const leanX = Math.cos(angleOffset * 1.9 + 0.4) * radius * 0.24;
  const leanZ = Math.sin(angleOffset * 1.9 + 0.4) * radius * 0.24;
  const topX = cx + leanX;
  const topY = botY + h * (0.94 + 0.10 * Math.sin(angleOffset * 2.3));
  const topZ = cz + leanZ;

  const sr = lerp(r * 1.15, 0.94, snowAmount);
  const sg = lerp(g * 1.15, 0.95, snowAmount);
  const sb = lerp(bl * 1.12, 0.97, snowAmount);
  const midSnow = snowAmount * 0.80;
  const mr = lerp(r * 1.03, 0.91, midSnow);
  const mg = lerp(g * 1.03, 0.93, midSnow);
  const mb = lerp(bl * 1.03, 0.95, midSnow);
  const tipSnow = snowAmount * 0.34;
  const tr = lerp(r * 0.68, 0.86, tipSnow);
  const tg = lerp(g * 0.68, 0.88, tipSnow);
  const tb = lerp(bl * 0.70, 0.91, tipSnow);

  const midRing = [];
  const tipRing = [];
  for (let i = 0; i < sides; i += 1) {
    const a = angleOffset + (i / sides) * Math.PI * 2 + 0.24 * Math.sin(i * 2.5 + angleOffset * 1.7);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const boughMod = 1.0
      + 0.28 * Math.sin(i * 2.7 + angleOffset * 3.1)
      + 0.16 * Math.cos(i * 4.3 - angleOffset * 1.9);
    const notch = (i % 2 === 0 ? 1.08 : 0.82) + 0.10 * Math.sin(i * 1.7 + angleOffset * 2.9);
    const tipRad = radius * clamp(boughMod * notch, 0.64, 1.32);
    const midRad = tipRad * clamp(0.74 + 0.14 * Math.cos(i * 2.1 - angleOffset), 0.62, 0.92);
    const yMid = botY + h * clamp(0.68 + 0.14 * Math.cos(i * 2.3 + angleOffset * 1.4), 0.52, 0.84);
    const yTip = botY - droop * h * 1.15 * (boughMod - 0.84) + (i % 2 === 0 ? -0.14 : 0.18) * h + 0.12 * h * Math.sin(i * 3.3 + angleOffset);

    midRing.push({
      x: cx + ca * midRad + leanX * 0.45,
      y: yMid,
      z: cz + sa * midRad + leanZ * 0.45,
      nx: ca * 0.64,
      ny: 0.76,
      nz: sa * 0.64,
    });
    tipRing.push({
      x: cx + ca * tipRad,
      y: yTip,
      z: cz + sa * tipRad,
      nx: ca * 0.88,
      ny: 0.34,
      nz: sa * 0.88,
      shade: 0.82 + 0.26 * clamp(boughMod - 0.72, 0, 0.65),
    });
  }

  for (let i = 0; i < sides; i += 1) {
    const i2 = (i + 1) % sides;
    const m0 = midRing[i];
    const m1 = midRing[i2];
    const t0 = tipRing[i];
    const t1 = tipRing[i2];
    const amx = (m0.nx + m1.nx) * 0.5;
    const amz = (m0.nz + m1.nz) * 0.5;

    // Asymmetric upper bough crown
    b.pushVert(topX, topY, topZ, amx * 0.35, 0.94, amz * 0.35, sr, sg, sb);
    b.pushVert(m1.x, m1.y, m1.z, m1.nx, m1.ny, m1.nz, mr, mg, mb);
    b.pushVert(m0.x, m0.y, m0.z, m0.nx, m0.ny, m0.nz, mr, mg, mb);

    // Jagged drooping outer bough skirt
    b.pushVert(m0.x, m0.y, m0.z, m0.nx, m0.ny, m0.nz, mr, mg, mb);
    b.pushVert(m1.x, m1.y, m1.z, m1.nx, m1.ny, m1.nz, mr, mg, mb);
    b.pushVert(t1.x, t1.y, t1.z, t1.nx, t1.ny, t1.nz, tr * t1.shade, tg * t1.shade, tb * t1.shade);

    b.pushVert(m0.x, m0.y, m0.z, m0.nx, m0.ny, m0.nz, mr, mg, mb);
    b.pushVert(t1.x, t1.y, t1.z, t1.nx, t1.ny, t1.nz, tr * t1.shade, tg * t1.shade, tb * t1.shade);
    b.pushVert(t0.x, t0.y, t0.z, t0.nx, t0.ny, t0.nz, tr * t0.shade, tg * t0.shade, tb * t0.shade);
  }
}

/** Organic irregular foliage cluster with multi-harmonic perturbation, uneven underside, and AO. */
function addSmoothCanopy(b, cx, cy, cz, rx, ry, rz, r, g, bl, lonSegs = 6, latSegs = 3, phase = 0) {
  const vert = (lat, lon) => {
    const phi = (lat / latSegs) * Math.PI;
    const theta = (lon / lonSegs) * Math.PI * 2;
    const sp = Math.sin(phi);
    const ux = sp * Math.cos(theta);
    const uy = Math.cos(phi);
    const uz = sp * Math.sin(theta);

    // Strong multi-frequency organic perturbation so crowns never read as geometric spheres
    const nA = Math.sin(theta * 3.0 + phase * 1.3) * Math.cos(phi * 2.0 - phase * 0.6);
    const nB = Math.cos(theta * 5.0 - phase * 2.1) * Math.sin(phi * 3.0 + 0.8);
    const nC = Math.sin(ux * 4.7 + uy * 3.9 - uz * 5.1 + phase * 3.1);
    const lump = 1.0 + 0.22 * nA + 0.14 * nB + 0.11 * nC;
    const yShape = uy < 0 ? uy * (0.64 + 0.14 * nA) : uy * (1.06 + 0.10 * nB);

    const pnx = ux + 0.26 * nB;
    const pny = uy + 0.24 + 0.16 * nA;
    const pnz = uz + 0.26 * nC;
    const nLen = Math.hypot(pnx, pny, pnz) || 1;
    const ao = lerp(0.56, 1.16, smooth01((uy + 1.0) * 0.5)) * (1.0 + nC * 0.10 + nB * 0.06);
    return {
      x: cx + ux * rx * lump,
      y: cy + yShape * ry * (0.94 + 0.14 * nA + 0.10 * nC),
      z: cz + uz * rz * lump,
      nx: pnx / nLen,
      ny: pny / nLen,
      nz: pnz / nLen,
      cr: clamp(r * ao, 0, 1),
      cg: clamp(g * ao, 0, 1),
      cb: clamp(bl * ao, 0, 1),
    };
  };

  const pushS = (v) => {
    b.pushVert(v.x, v.y, v.z, v.nx, v.ny, v.nz, v.cr, v.cg, v.cb);
  };

  for (let lat = 0; lat < latSegs; lat += 1) {
    for (let lon = 0; lon < lonSegs; lon += 1) {
      const v00 = vert(lat, lon);
      const v10 = vert(lat + 1, lon);
      const v11 = vert(lat + 1, lon + 1);
      const v01 = vert(lat, lon + 1);
      if (lat > 0) {
        pushS(v00);
        pushS(v01);
        pushS(v11);
      }
      if (lat < latSegs - 1) {
        pushS(v00);
        pushS(v11);
        pushS(v10);
      }
    }
  }
}

/** Type 1: Irregular alpine conifer with trunk + non-monotonic, heavily off-center bough tiers (+ snow dust). */
function addConiferTree(b, x, y, z, scale, shade, rot = 0, tint = [1, 1, 1], baseCol = [0.11, 0.26, 0.14], snowAmount = 0) {
  const [tr, tg, tb] = tint;
  const [br, bg, bb] = baseCol;
  const windswept = ((rot * 10) % 3) < 1.15;
  addSmoothCylinder(b, x, y, z, 0.72 * scale, 0.24 * scale, (windswept ? 6.4 : 4.8) * scale, 5, 0.28, 0.19, 0.13);

  const nonMono = ((rot * 17.3) % 2.0) < 1.05;
  const tiers = windswept
    ? [
      { yOff: 4.3, h: 2.9, rad: nonMono ? 3.35 : 4.15, ang: rot + 0.4, offFrac: 0.26, colMul: 1.00, snow: 0.45, droop: 0.28 },
      { yOff: 6.7, h: 2.7, rad: nonMono ? 4.05 : 2.95, ang: rot + 2.3, offFrac: 0.29, colMul: 1.18, snow: 0.78, droop: 0.26 },
      { yOff: 9.1, h: 2.5, rad: nonMono ? 2.45 : 3.20, ang: rot + 4.4, offFrac: 0.25, colMul: 1.36, snow: 1.00, droop: 0.24 },
    ]
    : [
      { yOff: 2.9, h: 3.3, rad: nonMono ? 3.55 : 4.25, ang: rot + 0.7, offFrac: 0.25, colMul: 1.00, snow: 0.35, droop: 0.28 },
      { yOff: 5.6, h: 3.1, rad: nonMono ? 4.20 : 3.05, ang: rot + 2.7, offFrac: 0.30, colMul: 1.18, snow: 0.72, droop: 0.26 },
      { yOff: 8.2, h: 2.8, rad: nonMono ? 2.35 : 3.15, ang: rot + 4.7, offFrac: 0.26, colMul: 1.38, snow: 1.00, droop: 0.22 },
    ];

  for (let i = 0; i < tiers.length; i += 1) {
    const trSpec = tiers[i];
    const rad = trSpec.rad * scale;
    const offDist = rad * trSpec.offFrac;
    const ox = Math.cos(trSpec.ang) * offDist;
    const oz = Math.sin(trSpec.ang) * offDist;
    addConiferTier(
      b,
      x + ox,
      y + trSpec.yOff * scale,
      z + oz,
      trSpec.h * scale,
      rad,
      i === 2 ? 5 : 6,
      clamp(br * trSpec.colMul * shade * tr, 0, 1),
      clamp(bg * (0.98 + 0.04 * i) * trSpec.colMul * shade * tg, 0, 1),
      clamp(bb * (0.96 + 0.04 * i) * trSpec.colMul * shade * tb, 0, 1),
      rot + i * 1.15,
      snowAmount * trSpec.snow,
      trSpec.droop,
    );
  }
}

/** Type 2: Broadleaf oak/deciduous with trunk + 4 distinctly separated asymmetric foliage clusters. */
function addBroadleafTree(b, x, y, z, scale, shade, rot = 0, tint = [1, 1, 1], baseCol = [0.21, 0.40, 0.15]) {
  const [tr, tg, tb] = tint;
  const [br, bg, bb] = baseCol;
  addSmoothCylinder(b, x, y, z, 0.74 * scale, 0.40 * scale, 4.4 * scale, 5, 0.30, 0.21, 0.14);
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const warmShift = (shade - 0.95) * 0.07;
  const cr = clamp((br + warmShift) * shade * tr, 0, 1);
  const cg = clamp(bg * shade * tg, 0, 1);
  const cb = clamp(bb * shade * tb, 0, 1);
  const cy = y + 5.6 * scale;
  // Four widely offset clusters with smaller radii so distinct sub-crowns break any spherical outline
  const lobes = [
    [-c * 2.1 + s * 1.2, -0.35, s * 2.1 + c * 1.2, 2.5, 2.0, 2.3, 0.86, 0.90, 0.94, 0.3],
    [c * 2.5 - s * 0.9, 1.35, -s * 2.5 - c * 0.9, 2.4, 2.1, 2.2, 1.16, 1.10, 1.02, 1.7],
    [-c * 0.8 - s * 2.4, 0.95, s * 0.8 - c * 2.4, 2.2, 1.9, 2.4, 0.98, 1.00, 0.98, 3.1],
    [c * 0.6 + s * 1.5, 2.65, -s * 0.6 + c * 1.5, 1.9, 1.8, 1.9, 1.18, 1.14, 1.04, 4.6],
  ];
  for (let i = 0; i < lobes.length; i += 1) {
    const lb = lobes[i];
    addSmoothCanopy(
      b,
      x + lb[0] * scale,
      cy + lb[1] * scale,
      z + lb[2] * scale,
      lb[3] * scale,
      lb[4] * scale,
      lb[5] * scale,
      clamp(cr * lb[6], 0, 1),
      clamp(cg * lb[7], 0, 1),
      clamp(cb * lb[8], 0, 1),
      5,
      3,
      rot + lb[9],
    );
  }
}

/** Type 3: Tall irregular poplar / aspen with trunk + 4 strongly offset asymmetric foliage tufts. */
function addPoplarTree(b, x, y, z, scale, shade, rot = 0, tint = [1, 1, 1], baseCol = [0.19, 0.38, 0.16]) {
  const [tr, tg, tb] = tint;
  const [br, bg, bb] = baseCol;
  addSmoothCylinder(b, x, y, z, 0.56 * scale, 0.26 * scale, 3.8 * scale, 5, 0.29, 0.21, 0.14);
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const cr = clamp(br * shade * tr, 0, 1);
  const cg = clamp(bg * shade * tg, 0, 1);
  const cb = clamp(bb * shade * tb, 0, 1);
  addSmoothCanopy(b, x - c * 1.05 * scale, y + 4.7 * scale, z + s * 1.05 * scale, 2.0 * scale, 2.5 * scale, 1.9 * scale, cr * 0.88, cg * 0.92, cb * 0.94, 5, 3, rot);
  addSmoothCanopy(b, x + c * 1.25 * scale, y + 6.8 * scale, z - s * 1.25 * scale, 1.9 * scale, 2.4 * scale, 1.8 * scale, clamp(cr * 1.02, 0, 1), clamp(cg * 1.03, 0, 1), clamp(cb * 1.01, 0, 1), 5, 3, rot + 1.4);
  addSmoothCanopy(b, x - s * 1.15 * scale, y + 8.9 * scale, z - c * 1.15 * scale, 1.55 * scale, 2.3 * scale, 1.50 * scale, clamp(cr * 1.10, 0, 1), clamp(cg * 1.08, 0, 1), clamp(cb * 1.03, 0, 1), 5, 3, rot + 2.7);
  addSmoothCanopy(b, x + s * 0.70 * scale, y + 11.1 * scale, z + c * 0.70 * scale, 1.15 * scale, 2.0 * scale, 1.10 * scale, clamp(cr * 1.18, 0, 1), clamp(cg * 1.14, 0, 1), clamp(cb * 1.05, 0, 1), 5, 3, rot + 4.1);
}

function isTreeForbidden(x, z) {
  // Airfield plateau (runway, apron, hangar, tower)
  if (Math.abs(x) < 116 && z > -355 && z < 390) return true;
  // Runway 36 final-approach clearway
  if (Math.abs(x) < 44 && z >= 320 && z < 1150) return true;
  // River channel, canyon walls & immediate banks
  if (z > -1850) {
    const canyonClear = z > WATERFALL_Z_TOP ? (z < 850 ? 172 : 95) : riverHalfWidth(z) + 26;
    if (Math.abs(x - riverCenterX(z)) < canyonClear) return true;
  }
  // Eagle Gorge channel & cliff walls
  if (z > -900 && z < 780) {
    if (Math.abs(x - eagleGorgeCenterX(z)) < 130) return true;
  }
  // Alpine tarns
  if (tarnMask(x, z, GLACIER_TARN, 0.6) > 0.02) return true;
  if (tarnMask(x, z, HIGHLAND_TARN, -0.8) > 0.02) return true;
  // Village roads & farm tracks
  if (isNearRoad(x, z, 9.5)) return true;
  // Town street grid (uses original 44 houses so tree mesh vertex count remains invariant)
  if (Math.abs(x - TOWN_CENTER.x) < 250 && Math.abs(z - TOWN_CENTER.z) < 255) {
    for (let i = 0; i < ORIGINAL_TOWN_HOUSES.length; i += 1) {
      const th = ORIGINAL_TOWN_HOUSES[i];
      if (Math.hypot(x - th.x, z - th.z) < 15) return true;
    }
    if (Math.hypot(x - (TOWN_CENTER.x - 16), z - (TOWN_CENTER.z - 68)) < 24) return true;
    if (Math.hypot(x - (TOWN_CENTER.x + 18), z - (TOWN_CENTER.z + 24)) < 28) return true;
  }
  // Village house & barn footprints
  for (let i = 0; i < VILLAGE_HOUSES.length; i += 1) {
    const h = VILLAGE_HOUSES[i];
    if (Math.hypot(x - h.x, z - h.z) < 16) return true;
  }
  // Target rings
  for (let i = 0; i < MISSION_RINGS.length; i += 1) {
    const ring = MISSION_RINGS[i];
    if (Math.hypot(x - ring.x, z - ring.z) < 48) return true;
  }
  return false;
}

function pickBroadleafColor(x, z, random) {
  const autumnPatch = valueNoise2D(x * 0.0020 + 3.1, z * 0.0020 - 4.7, 612);
  const roll = random();
  if (autumnPatch > 0.50 && roll < 0.72) {
    const aRoll = random();
    if (aRoll < 0.38) return [0.76, 0.50, 0.12]; // Bright golden amber
    if (aRoll < 0.74) return [0.72, 0.32, 0.10]; // Rich autumn orange
    return [0.60, 0.18, 0.12];                   // Russet crimson
  }
  if (roll < 0.32) return [0.12, 0.30, 0.13];    // Deep forest green
  if (roll < 0.66) return [0.14, 0.35, 0.27];    // Distinct blue-green / sage
  return [0.33, 0.48, 0.13];                     // Bright yellow-green
}

function pickPoplarColor(x, z, random) {
  const autumnPatch = valueNoise2D(x * 0.0020 + 3.1, z * 0.0020 - 4.7, 612);
  const roll = random();
  if (autumnPatch > 0.50 && roll < 0.65) {
    return roll < 0.40 ? [0.76, 0.54, 0.13] : [0.70, 0.33, 0.10]; // Golden aspen / orange
  }
  return roll < 0.48 ? [0.13, 0.32, 0.25] : [0.30, 0.46, 0.15];   // Cypress blue-green / yellow-green
}

function pickConiferColor(random) {
  const roll = random();
  if (roll < 0.38) return [0.09, 0.23, 0.13];    // Deep alpine spruce
  if (roll < 0.72) return [0.10, 0.27, 0.23];    // Blue spruce
  return [0.16, 0.31, 0.14];                     // Mountain cedar green
}

function addHedgerowSegment(b, ax, az, bx, bz, random) {
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz);
  if (len < 10) return;
  const shrubs = Math.max(4, Math.floor(len / 15));
  const palette = [
    [0.13, 0.31, 0.13], // Deep green
    [0.16, 0.34, 0.22], // Blue-green
    [0.27, 0.42, 0.15], // Yellow-green
    [0.54, 0.34, 0.12], // Autumn russet-gold accent
  ];
  for (let i = 0; i <= shrubs; i += 1) {
    if (i === Math.floor(shrubs * 0.5) && random() < 0.65) continue;
    if (random() < 0.22) continue;
    const t = clamp((i + (random() - 0.5) * 0.78) / shrubs, 0.02, 0.98);
    const jx = (random() - 0.5) * 8.4;
    const jz = (random() - 0.5) * 8.4;
    const x = ax + dx * t + jx;
    const z = az + dz * t + jz;
    if (isTreeForbidden(x, z) || isInHeroCluster(x, z)) continue;
    const h = sampleMeshHeight(x, z);
    const ny = terrainNormalY(x, z);
    if (h < 2.6 || h > 52 || ny < 0.82) continue;

    const shade = 0.80 + random() * 0.34;
    const col = random() < 0.16 ? palette[3] : palette[Math.floor(random() * 3)];
    const rx = 2.0 + random() * 2.5;
    const ry = 1.2 + random() * 1.6;
    const rz = 2.0 + random() * 2.5;
    addSmoothCanopy(b, x, h + ry * 0.42, z, rx, ry, rz, col[0] * shade, col[1] * shade, col[2] * shade, 6, 3, random() * 6);
    if (random() < 0.45) {
      const col2 = palette[Math.floor(random() * 3)];
      addSmoothCanopy(
        b,
        x + (random() - 0.5) * 3.0,
        h + ry * 0.35,
        z + (random() - 0.5) * 3.0,
        rx * 0.78,
        ry * 0.88,
        rz * 0.78,
        col2[0] * shade * 1.08,
        col2[1] * shade * 1.06,
        col2[2] * shade,
        5,
        3,
        random() * 6,
      );
    }

    if (random() < 0.22) {
      const scale = 0.76 + random() * 0.58;
      const tx = x + (random() - 0.5) * 7.0;
      const tz = z + (random() - 0.5) * 7.0;
      const th = sampleMeshHeight(tx, tz);
      const tint = [0.88 + random() * 0.24, 0.90 + random() * 0.20, 0.86 + random() * 0.24];
      if (!isTreeForbidden(tx, tz) && !isInHeroCluster(tx, tz) && th >= 2.6 && th <= 54) {
        if (random() < 0.72) addBroadleafTree(b, tx, th - 0.25, tz, scale, shade, random() * Math.PI * 2, tint, pickBroadleafColor(tx, tz, random));
        else addPoplarTree(b, tx, th - 0.25, tz, scale, shade, random() * Math.PI * 2, tint, pickPoplarColor(tx, tz, random));
      }
    }
  }
}

// 12 clustered hero GLB stands along flight sightlines & screenshot vistas (~90 trees total, >=120m center spacing)
const HERO_CLUSTERS = [
  // ?shot=trees foreground stand (north-east Mirror Lake slope, centered in ?shot=trees sightline)
  { name: 'grove01_fg', x: 1335, z: -2565, r: 54, pine: 0, oak: 6, maple: 3 },
  // ?shot=trees upper hillside stand
  { name: 'grove01_upper', x: 1430, z: -2640, r: 48, pine: 2, oak: 5, maple: 1 },
  // ?shot=pineslope primary conifer stand (also visible on far right of 2-play)
  { name: 'pineslope_main', x: -1645, z: -1905, r: 48, pine: 9, oak: 0, maple: 0 },
  // ?shot=pineslope background ridge
  { name: 'pineslope_west', x: -1800, z: -1950, r: 46, pine: 7, oak: 0, maple: 0 },
  // West Mirror Lake slope (-1380, -2020 pine stand)
  { name: 'pineslope_lake', x: -1385, z: -2025, r: 46, pine: 7, oak: 0, maple: 0 },
  // ?shot=play (2-play) foreground left slope overlooking Glacier Tarn
  { name: 'play_fg_left', x: -2130, z: -1340, r: 52, pine: 7, oak: 0, maple: 0 },
  // ?shot=play (2-play) foreground right slope overlooking Glacier Tarn
  { name: 'play_fg_right', x: -1760, z: -1460, r: 52, pine: 6, oak: 1, maple: 0 },
  // Mirror Lake north-shore corridor (near Ring 4)
  { name: 'mirror_north', x: 420, z: -2520, r: 50, pine: 0, oak: 6, maple: 2 },
  // Mirror Lake south-east shore / approach corridor (visible in ?shot=approach)
  { name: 'mirror_south_east', x: 610, z: -1350, r: 48, pine: 0, oak: 6, maple: 2 },
  // Mirror Lake south-west shore / approach corridor
  { name: 'mirror_corridor_west', x: -160, z: -1380, r: 48, pine: 0, oak: 5, maple: 2 },
  // Emerald Forest ridge (Ring 4 -> Ring 5 leg)
  { name: 'emerald_forest', x: 1420, z: -1200, r: 52, pine: 2, oak: 4, maple: 1 },
  // Oakwood Town NW perimeter
  { name: 'oakwood_town', x: 1110, z: 1030, r: 46, pine: 0, oak: 5, maple: 1 },
];

function isInHeroCluster(x, z) {
  for (let i = 0; i < HERO_CLUSTERS.length; i += 1) {
    const c = HERO_CLUSTERS[i];
    const padR = c.r + 12;
    const dx = x - c.x;
    const dz = z - c.z;
    if (dx * dx + dz * dz <= padR * padR) return true;
  }
  return false;
}

let glbTreePlacements = [];

/** Return a shallow copy of hero GLB tree placements collected during buildTreesMesh. */
export function getGlbTreePlacements() {
  return glbTreePlacements.map((p) => ({ ...p, tint: [...p.tint] }));
}

/**
 * Build procedural fallback geometry at hero tree locations when GLB templates fail to load.
 * @param {Array<{ species: 'pine'|'oak'|'maple', x: number, y: number, z: number, scale: number, rot: number }>} placements
 */
export function buildHeroFallbackMesh(placements) {
  const b = createBuilder();
  if (!placements || !placements.length) return b.toMesh();
  const fallbackRand = createRandom(99);
  for (let i = 0; i < placements.length; i += 1) {
    const p = placements[i];
    if (p.species === 'pine') {
      const zones = sampleZoneWeights(p.x, p.z);
      const snowAmt = zones.plateau > 0.45 ? 0 : smooth01((p.y - 165) / 90);
      addConiferTree(b, p.x, p.y, p.z, p.scale, 1.0, p.rot, [1, 1, 1], pickConiferColor(fallbackRand), snowAmt);
    } else if (p.species === 'maple') {
      const aRoll = fallbackRand();
      const autumnCol = aRoll < 0.38
        ? [0.76, 0.50, 0.12]
        : aRoll < 0.74
          ? [0.72, 0.32, 0.10]
          : [0.60, 0.18, 0.12];
      addBroadleafTree(b, p.x, p.y, p.z, p.scale, 1.0, p.rot, [1, 1, 1], autumnCol);
    } else {
      addBroadleafTree(b, p.x, p.y, p.z, p.scale, 1.0, p.rot, [1, 1, 1], pickBroadleafColor(p.x, p.z, fallbackRand));
    }
  }
  return b.toMesh();
}

export function buildTreesMesh(random) {
  const b = createBuilder();
  glbTreePlacements = [];

  const heroQuota = { pine: 40, oak: 38, maple: 12 };
  const heroCounts = { pine: 0, oak: 0, maple: 0 };

  function hasNearbyHero(x, z, minDist) {
    const minDistSq = minDist * minDist;
    for (let i = 0; i < glbTreePlacements.length; i += 1) {
      const p = glbTreePlacements[i];
      const dx = p.x - x;
      const dz = p.z - z;
      if (dx * dx + dz * dz < minDistSq) return true;
    }
    return false;
  }

  function pickHeroTint(species) {
    if (species === 'pine') {
      return [
        0.90 + random() * 0.15,
        0.92 + random() * 0.16,
        0.90 + random() * 0.15,
      ];
    }
    if (species === 'maple') {
      return [
        0.98 + random() * 0.07,
        0.92 + random() * 0.08,
        0.88 + random() * 0.08,
      ];
    }
    // Oak: follow pickBroadleafColor green-family palette but keep near 1.0 (0.85-1.10) so leaf texture stays vibrant
    const roll = random();
    const base = roll < 0.32
      ? [0.89, 1.00, 0.89]
      : roll < 0.66
        ? [0.89, 1.02, 0.98]
        : [0.98, 1.06, 0.87];
    const jitter = (random() - 0.5) * 0.06;
    return [
      clamp(base[0] + jitter, 0.85, 1.10),
      clamp(base[1] + jitter, 0.85, 1.10),
      clamp(base[2] + jitter, 0.85, 1.10),
    ];
  }

  function trySelectHero(species, x, y, z, rot, poolBudget, minDist = 18) {
    if (!poolBudget[species] || poolBudget[species] <= 0) return false;
    if (heroCounts[species] >= heroQuota[species]) return false;
    if (hasNearbyHero(x, z, minDist)) return false;
    poolBudget[species] -= 1;
    heroCounts[species] += 1;
    glbTreePlacements.push({
      species,
      x,
      y,
      z,
      scale: 0.90 + random() * 0.40,
      rot,
      tint: pickHeroTint(species),
    });
    return true;
  }

  // 0. Populate dense clustered GLB hero stands (5-9 trees per cluster, 8-14m intra-cluster spacing)
  for (let ci = 0; ci < HERO_CLUSTERS.length; ci += 1) {
    const cl = HERO_CLUSTERS[ci];
    const budget = { pine: cl.pine, oak: cl.oak, maple: cl.maple };
    const queue = [];
    for (let k = 0; k < cl.oak; k += 1) queue.push('oak');
    for (let k = 0; k < cl.maple; k += 1) queue.push('maple');
    for (let k = 0; k < cl.pine; k += 1) queue.push('pine');
    for (let qi = 0; qi < queue.length; qi += 1) {
      const sp = queue[qi];
      for (let tries = 0; tries < 80; tries += 1) {
        const ang = random() * Math.PI * 2;
        const rad = Math.sqrt(random()) * cl.r;
        const x = cl.x + Math.cos(ang) * rad;
        const z = cl.z + Math.sin(ang) * rad;
        if (isTreeForbidden(x, z)) continue;
        const h = sampleMeshHeight(x, z);
        const ny = terrainNormalY(x, z);
        if (h < 3.5 || h > 345 || ny < 0.62) continue;
        const minDist = tries < 50 ? 9.0 : 7.5;
        if (trySelectHero(sp, x, h - 0.25, z, random() * Math.PI * 2, budget, minDist)) break;
      }
    }
  }

  // 1. Field-edge hedgerows strictly inside the compact agricultural valley (keep canyon rim & hills wild)
  const cellMinX = -7;
  const cellMaxX = 7;
  const cellMinZ = -3;
  const cellMaxZ = 10;
  for (let cz = cellMinZ; cz <= cellMaxZ; cz += 1) {
    for (let cx = cellMinX; cx <= cellMaxX; cx += 1) {
      const worldApproxZ = cz * FIELD_H;
      const prob = worldApproxZ > 240 ? 0.54 : 0.44;
      if (cellHash(cx, cz, 707) < prob) {
        const rx0 = cx * FIELD_W;
        const rx1 = (cx + 1) * FIELD_W;
        const rz = cz * FIELD_H;
        const ax = rx0 * FIELD_COS + rz * FIELD_SIN;
        const az = -rx0 * FIELD_SIN + rz * FIELD_COS;
        const bx = rx1 * FIELD_COS + rz * FIELD_SIN;
        const bz = -rx1 * FIELD_SIN + rz * FIELD_COS;
        addHedgerowSegment(b, ax, az, bx, bz, random);
      }
      if (cellHash(cx, cz, 808) < prob) {
        const rx = cx * FIELD_W;
        const rz0 = cz * FIELD_H;
        const rz1 = (cz + 1) * FIELD_H;
        const ax = rx * FIELD_COS + rz0 * FIELD_SIN;
        const az = -rx * FIELD_SIN + rz0 * FIELD_COS;
        const bx = rx * FIELD_COS + rz1 * FIELD_SIN;
        const bz = -rx * FIELD_SIN + rz1 * FIELD_COS;
        addHedgerowSegment(b, ax, az, bx, bz, random);
      }
    }
  }

  const treeTint = () => [
    0.78 + random() * 0.42,
    0.82 + random() * 0.36,
    0.76 + random() * 0.40,
  ];

  const placeSpeciesTree = (x, h, ny, z, zones, scale, shade, rot, tint) => {
    const typeRoll = random();
    const snowAmt = zones.plateau > 0.45 ? 0 : smooth01((h - 155) / 90);
    if (zones.wetland > 0.45 && h < 8) {
      addSmoothCanopy(b, x, h + 1.4, z, 2.8 * scale, 1.9 * scale, 2.8 * scale, 0.17 * shade * tint[0], 0.34 * shade * tint[1], 0.16 * shade * tint[2], 6, 3, rot);
    } else if (h > 130 || zones.mountain > 0.35 || (h > 65 && ny < 0.88) || typeRoll < lerp(0.34, 0.68, zones.forest)) {
      addConiferTree(b, x, h - 0.25, z, scale, shade, rot, tint, pickConiferColor(random), snowAmt);
    } else if (typeRoll < 0.82) {
      addBroadleafTree(b, x, h - 0.25, z, scale, shade, rot, tint, pickBroadleafColor(x, z, random));
    } else {
      addPoplarTree(b, x, h - 0.25, z, scale, shade, rot, tint, pickPoplarColor(x, z, random));
    }
  };

  // 2. Zoned woodland placement across the 10,400m world (~780 general + ~480 dense forest + ~220 corridor + ~135 town/village)
  let placed = 0;
  let attempts = 0;
  while (placed < 780 && attempts < 13000) {
    attempts += 1;
    const x = (random() * 2 - 1) * (WORLD.half - 240);
    const z = (random() * 2 - 1) * (WORLD.half - 240);
    if (isTreeForbidden(x, z) || isInHeroCluster(x, z)) continue;
    const h = sampleMeshHeight(x, z);
    const ny = terrainNormalY(x, z);
    if (h < 2.8 || h > 365 || ny < 0.68) continue;
    const zones = sampleZoneWeights(x, z);
    const cluster = valueNoise2D(x * 0.0022, z * 0.0022, 404);
    const threshold = lerp(0.40, 0.20, Math.max(zones.forest, zones.hills * 0.6)) + zones.mountain * 0.12;
    if (cluster < threshold) continue;

    const scale = 0.58 + random() * 1.08;
    const shade = (0.86 + random() * 0.30) * lerp(1.0, 0.86, zones.forest);
    const rot = random() * Math.PI * 2;
    const tint = treeTint();
    placeSpeciesTree(x, h, ny, z, zones, scale, shade, rot, tint);
    placed += 1;
  }

  // 2b. Dense Emerald Forest & Highland Rim zone (East & Northeast, ~480 multi-tone trees)
  let forestPlaced = 0;
  let forestAttempts = 0;
  while (forestPlaced < 480 && forestAttempts < 5200) {
    forestAttempts += 1;
    const x = 750 + random() * 3400;
    const z = -1950 + random() * 3200;
    if (isTreeForbidden(x, z) || isInHeroCluster(x, z)) continue;
    const h = sampleMeshHeight(x, z);
    const ny = terrainNormalY(x, z);
    if (h < 4.0 || h > 325 || ny < 0.68) continue;
    const zones = sampleZoneWeights(x, z);
    if (zones.forest < 0.18 && zones.plateau < 0.25) continue;

    const scale = 0.60 + random() * 1.06;
    const shade = 0.78 + random() * 0.30;
    const tint = treeTint();
    const rot = random() * Math.PI * 2;
    const snowAmt = zones.plateau > 0.45 ? 0 : smooth01((h - 155) / 90);
    if (random() < 0.64) addConiferTree(b, x, h - 0.25, z, scale, shade, rot, tint, pickConiferColor(random), snowAmt);
    else addBroadleafTree(b, x, h - 0.25, z, scale, shade, rot, tint, pickBroadleafColor(x, z, random));
    forestPlaced += 1;
  }

  // 3. Extra colorful groves flanking the approach corridor & Mirror Lake / foothills (~240)
  let corridorPlaced = 0;
  let corridorAttempts = 0;
  while (corridorPlaced < 240 && corridorAttempts < 3000) {
    corridorAttempts += 1;
    const side = random() < 0.5 ? -1 : 1;
    const x = side * (46 + random() * 640);
    const z = -1450 + random() * 3200;
    if (isTreeForbidden(x, z) || isInHeroCluster(x, z)) continue;
    const h = sampleMeshHeight(x, z);
    const ny = terrainNormalY(x, z);
    if (h < 3.5 || h > 160 || ny < 0.76) continue;
    if (valueNoise2D(x * 0.004, z * 0.004, 515) < 0.30) continue;

    const scale = 0.58 + random() * 1.08;
    const shade = 0.86 + random() * 0.28;
    const tint = treeTint();
    const rot = random() * Math.PI * 2;
    const typeRoll = random();
    if (typeRoll < 0.28) addConiferTree(b, x, h - 0.25, z, scale, shade, rot, tint, pickConiferColor(random), 0);
    else if (typeRoll < 0.76) addBroadleafTree(b, x, h - 0.25, z, scale, shade, rot, tint, pickBroadleafColor(x, z, random));
    else addPoplarTree(b, x, h - 0.25, z, scale, shade, rot, tint, pickPoplarColor(x, z, random));
    corridorPlaced += 1;
  }

  // 3b. Alpine foothills & Mirror Lake north-shore woodland belt (~330 trees for visible slope color layering)
  let alpineWoodPlaced = 0;
  let alpineWoodAttempts = 0;
  while (alpineWoodPlaced < 330 && alpineWoodAttempts < 5200) {
    alpineWoodAttempts += 1;
    const inNorthShore = alpineWoodPlaced < 135;
    const x = inNorthShore ? -1100 + random() * 2700 : -2650 + random() * 1450;
    const z = inNorthShore ? -3050 + random() * 750 : -2300 + random() * 1650;
    if (isTreeForbidden(x, z) || isInHeroCluster(x, z)) continue;
    const h = sampleMeshHeight(x, z);
    const ny = terrainNormalY(x, z);
    if (h < 6.0 || h > 345 || ny < 0.62) continue;
    if (valueNoise2D(x * 0.0028, z * 0.0028, 727) < 0.24) continue;

    const scale = 0.64 + random() * 1.12;
    const shade = 0.84 + random() * 0.28;
    const tint = treeTint();
    const rot = random() * Math.PI * 2;
    const snowAmt = smooth01((h - 165) / 90);
    if (h > 225 || random() < 0.48) addConiferTree(b, x, h - 0.25, z, scale, shade, rot, tint, pickConiferColor(random), snowAmt);
    else if (random() < 0.74) addBroadleafTree(b, x, h - 0.25, z, scale, shade, rot, tint, pickBroadleafColor(x, z, random));
    else addPoplarTree(b, x, h - 0.25, z, scale, shade, rot, tint, pickPoplarColor(x, z, random));
    alpineWoodPlaced += 1;
  }

  // 3c. Dense overlapping woodland stand pockets on Emerald Forest & west Mirror Lake outer slopes (~110)
  let grovePlaced = 0;
  let groveAttempts = 0;
  const groveCenters = [
    { x: 1420, z: -1200, r: 175 },
    { x: -1380, z: -2020, r: 145 },
  ];
  while (grovePlaced < 110 && groveAttempts < 1400) {
    groveAttempts += 1;
    const groveIdx = grovePlaced % groveCenters.length;
    const gc = groveCenters[groveIdx];
    const ang = random() * Math.PI * 2;
    const rad = Math.pow(random(), 0.72) * gc.r;
    const x = gc.x + Math.cos(ang) * rad;
    const z = gc.z + Math.sin(ang) * rad;
    if (isTreeForbidden(x, z) || isInHeroCluster(x, z)) continue;
    const h = sampleMeshHeight(x, z);
    const ny = terrainNormalY(x, z);
    if (h < 5.0 || h > 290 || ny < 0.64) continue;
    const scale = 0.86 + random() * 0.88;
    const shade = 0.80 + random() * 0.30;
    const tint = treeTint();
    const rot = random() * Math.PI * 2;
    const snowAmt = smooth01((h - 165) / 90);
    const tr = random();
    if (tr < 0.46) addConiferTree(b, x, h - 0.25, z, scale, shade, rot, tint, pickConiferColor(random), snowAmt);
    else if (tr < 0.84) addBroadleafTree(b, x, h - 0.25, z, scale, shade, rot, tint, pickBroadleafColor(x, z, random));
    else addPoplarTree(b, x, h - 0.25, z, scale, shade, rot, tint, pickPoplarColor(x, z, random));
    grovePlaced += 1;
  }

  // 4. Village & Oakwood Town garden/avenue trees (~135)
  let villagePlaced = 0;
  let villageAttempts = 0;
  while (villagePlaced < 135 && villageAttempts < 1800) {
    villageAttempts += 1;
    const inTown = villagePlaced >= 60;
    const x = inTown ? TOWN_CENTER.x + (random() * 2 - 1) * 260 : -325 + random() * 195;
    const z = inTown ? TOWN_CENTER.z + (random() * 2 - 1) * 260 : -85 + random() * 290;
    if (isTreeForbidden(x, z) || isInHeroCluster(x, z)) continue;
    const h = sampleMeshHeight(x, z);
    if (h < 4 || h > 45) continue;

    const scale = 0.70 + random() * 0.65;
    const shade = 0.88 + random() * 0.24;
    const tint = treeTint();
    const rot = random() * Math.PI * 2;
    const typeRoll = random();
    if (typeRoll < 0.56) addBroadleafTree(b, x, h - 0.2, z, scale, shade, rot, tint, pickBroadleafColor(x, z, random));
    else if (typeRoll < 0.86) addPoplarTree(b, x, h - 0.2, z, scale, shade, rot, tint, pickPoplarColor(x, z, random));
    else addConiferTree(b, x, h - 0.2, z, scale, shade, rot, tint, pickConiferColor(random), 0);
    villagePlaced += 1;
  }

  return b.toMesh();
}

// --- Smooth Soft-Edged Cumulus Clouds ---

function addCloudBlob(b, centers, clusterX, clusterZ, px, py, pz, rx, ry, rz, r, g, bl, seedPhase = 0) {
  const lonSegs = 14;
  const latSegs = 8;
  const vert = (lat, lon) => {
    const phi = (lat / latSegs) * Math.PI;
    const theta = (lon / lonSegs) * Math.PI * 2;
    const sp = Math.sin(phi);
    const nx = sp * Math.cos(theta);
    const ny = Math.cos(phi);
    const nz = sp * Math.sin(theta);
    // Gentle organic billow modulation + flattened cumulus base
    const billow = 1.0 + 0.08 * Math.sin(theta * 3.0 + seedPhase) * sp + 0.05 * Math.cos(phi * 3.0 + seedPhase * 0.7);
    const yScale = ny < 0 ? ny * 0.52 : ny * billow;
    return {
      x: px + nx * rx * billow,
      y: py + yScale * ry,
      z: pz + nz * rz * billow,
      nx,
      ny,
      nz,
    };
  };
  const pushV = (v) => {
    b.pos.push(v.x, v.y, v.z);
    b.norm.push(v.nx, v.ny, v.nz);
    b.col.push(r, g, bl);
    centers.push(clusterX, clusterZ);
  };
  for (let lat = 0; lat < latSegs; lat += 1) {
    for (let lon = 0; lon < lonSegs; lon += 1) {
      const v00 = vert(lat, lon);
      const v10 = vert(lat + 1, lon);
      const v11 = vert(lat + 1, lon + 1);
      const v01 = vert(lat, lon + 1);
      if (lat > 0) {
        pushV(v00);
        pushV(v01);
        pushV(v11);
      }
      if (lat < latSegs - 1) {
        pushV(v00);
        pushV(v11);
        pushV(v10);
      }
    }
  }
}

export function buildCloudsMesh(random) {
  const b = createBuilder();
  const centers = [];
  for (let i = 0; i < 42; i += 1) {
    const cx = (random() * 2 - 1) * (WORLD.half * 0.92);
    const cz = (random() * 2 - 1) * (WORLD.half * 0.92);
    const minCy = Math.max(780, terrainHeight(cx, cz) + 330);
    const cy = minCy + random() * 220;
    const clusterScale = 0.90 + random() * 0.75;

    addCloudBlob(
      b,
      centers,
      cx,
      cz,
      cx,
      cy + 12 * clusterScale,
      cz,
      56 * clusterScale,
      36 * clusterScale,
      48 * clusterScale,
      1.0,
      0.99,
      0.98,
      i * 1.37,
    );

    const puffs = 9 + Math.floor(random() * 5);
    for (let p = 0; p < puffs; p += 1) {
      const ang = (p / puffs) * Math.PI * 2 + random() * 0.65;
      const ring = (p % 2 === 0 ? 1.0 : 0.58);
      const dist = (26 + random() * 52) * clusterScale * ring;
      const px = cx + Math.cos(ang) * dist;
      const pz = cz + Math.sin(ang) * dist * 0.82;
      const py = cy + (random() - 0.32) * 28 * clusterScale;
      const rx = (24 + random() * 32) * clusterScale;
      const ry = (16 + random() * 22) * clusterScale;
      const rz = (22 + random() * 30) * clusterScale;
      const tint = 0.93 + random() * 0.08;
      addCloudBlob(b, centers, cx, cz, px, py, pz, rx, ry, rz, tint, tint * 0.99, tint * 0.98, i * 1.37 + p * 0.91);
    }
  }
  const mesh = b.toMesh();
  mesh.centers = new Float32Array(centers);
  return mesh;
}

/** Build the low-poly propeller airplane mesh (nose pointing -Z, +X right wing, +Y up). */
export function buildPlaneMesh() {
  const b = createBuilder();
  const cream = [0.96, 0.93, 0.86];
  const coral = [0.87, 0.27, 0.22];
  const dark = [0.16, 0.20, 0.27];
  const glass = [0.22, 0.34, 0.48];
  const metal = [0.68, 0.71, 0.75];

  b.box(0, 0, 0, 1.45, 1.35, 4.2, ...cream);
  b.box(0, 0.05, -2.55, 1.1, 1.05, 1.2, ...coral);
  b.box(0, 0.12, 3.1, 0.85, 0.85, 2.3, ...cream);
  b.box(0, 0.46, 0.2, 1.15, 0.22, 3.6, ...coral);

  b.box(0, 0.85, -0.35, 1.05, 0.78, 1.85, ...glass);

  b.box(0, -0.05, -0.45, 9.6, 0.20, 1.65, ...cream);
  b.box(4.65, 0.02, -0.45, 1.2, 0.22, 1.55, ...coral);
  b.box(-4.65, 0.02, -0.45, 1.2, 0.22, 1.55, ...coral);

  b.box(0, 0.22, 3.9, 3.6, 0.16, 0.95, ...cream);
  b.box(0, 1.05, 3.95, 0.18, 1.65, 1.05, ...coral);

  b.box(-0.95, -0.82, -0.8, 0.16, 0.95, 0.18, ...metal);
  b.box(0.95, -0.82, -0.8, 0.16, 0.95, 0.18, ...metal);
  b.box(-1.05, -1.28, -0.8, 0.28, 0.56, 0.56, ...dark);
  b.box(1.05, -1.28, -0.8, 0.28, 0.56, 0.56, ...dark);
  b.box(0, -0.62, 3.8, 0.14, 0.6, 0.14, ...metal);
  b.box(0, -0.92, 3.85, 0.18, 0.34, 0.34, ...dark);

  return b.toMesh();
}

/** Separate propeller mesh centered at origin, spun around Z in local plane nose space. */
export function buildPropellerMesh() {
  const b = createBuilder();
  b.box(0, 0, -0.1, 0.36, 0.36, 0.45, 0.78, 0.80, 0.84);
  b.box(0, 0, 0, 2.75, 0.22, 0.07, 0.18, 0.19, 0.22);
  b.box(1.26, 0, 0, 0.22, 0.22, 0.08, 0.95, 0.75, 0.22);
  b.box(-1.26, 0, 0, 0.22, 0.22, 0.08, 0.95, 0.75, 0.22);
  return b.toMesh();
}

/** Build a smooth-normal torus ring mesh for slim core or soft additive halo shells. */
export function buildRingMesh(radius = PLANE.ringRadius, tube = 0.54, rCol = 1.0, gCol = 0.96, bCol = 0.88) {
  const b = createBuilder();
  const segs = 44;
  const sides = 12;
  const pushVert = (a, t) => {
    const ct = Math.cos(t);
    const st = Math.sin(t);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const rr = radius + tube * ct;
    b.pos.push(rr * ca, rr * sa, tube * st);
    b.norm.push(ct * ca, ct * sa, st);
    b.col.push(rCol, gCol, bCol);
  };
  for (let i = 0; i < segs; i += 1) {
    const a0 = (i / segs) * Math.PI * 2;
    const a1 = ((i + 1) / segs) * Math.PI * 2;
    for (let j = 0; j < sides; j += 1) {
      const t0 = (j / sides) * Math.PI * 2;
      const t1 = ((j + 1) / sides) * Math.PI * 2;
      pushVert(a0, t0);
      pushVert(a1, t0);
      pushVert(a1, t1);
      pushVert(a0, t0);
      pushVert(a1, t1);
      pushVert(a0, t1);
    }
  }
  return b.toMesh();
}

/** Build a small smooth glowing sphere dot for runway approach & PAPI lights. */
export function buildLightDotMesh(radius = 0.95) {
  const b = createBuilder();
  const lonSegs = 10;
  const latSegs = 6;
  const vert = (lat, lon) => {
    const phi = (lat / latSegs) * Math.PI;
    const theta = (lon / lonSegs) * Math.PI * 2;
    const sp = Math.sin(phi);
    const nx = sp * Math.cos(theta);
    const ny = Math.cos(phi);
    const nz = sp * Math.sin(theta);
    return { x: nx * radius, y: ny * radius, z: nz * radius, nx, ny, nz };
  };
  const pushV = (v) => {
    b.pos.push(v.x, v.y, v.z);
    b.norm.push(v.nx, v.ny, v.nz);
    b.col.push(1.0, 1.0, 1.0);
  };
  for (let lat = 0; lat < latSegs; lat += 1) {
    for (let lon = 0; lon < lonSegs; lon += 1) {
      const v00 = vert(lat, lon);
      const v10 = vert(lat + 1, lon);
      const v11 = vert(lat + 1, lon + 1);
      const v01 = vert(lat, lon + 1);
      if (lat > 0) {
        pushV(v00);
        pushV(v01);
        pushV(v11);
      }
      if (lat < latSegs - 1) {
        pushV(v00);
        pushV(v11);
        pushV(v10);
      }
    }
  }
  return b.toMesh();
}

/** Build a translucent vertical light pillar / runway beacon cylinder. */
export function buildBeaconMesh(radius = 2.4, height = 180) {
  const b = createBuilder();
  const sides = 10;
  for (let i = 0; i < sides; i += 1) {
    const a0 = (i / sides) * Math.PI * 2;
    const a1 = ((i + 1) / sides) * Math.PI * 2;
    const x0 = Math.cos(a0) * radius;
    const z0 = Math.sin(a0) * radius;
    const x1 = Math.cos(a1) * radius;
    const z1 = Math.sin(a1) * radius;
    b.quad(x0, 0, z0, x1, 0, z1, x1, height, z1, x0, height, z0, 1.0, 0.84, 0.36);
  }
  return b.toMesh();
}

const KT_TO_MS = 0.514444;

/**
 * Deterministic golden-hour wind field:
 * (a) Canyon channel wind blowing along riverCenterX(z) tangent (~6-12 kt scaled by rim depth).
 * (b) Ridge lift updraft (up to ~+3 m/s) on windward (S/E) slopes of the snow ranges.
 */
export function windAt(x, y, z, out = { x: 0, y: 0, z: 0 }) {
  let wx = 0;
  let wy = 0;
  let wz = 0;

  // (a) Canyon channel wind along canyon axis
  if (z > WATERFALL_Z_TOP - 60 && z < 880) {
    const rCenter = riverCenterX(z);
    const canyonBand = 1 - smooth01((z - 420) / 440);
    const rimHalfW = lerp(86, 168, canyonBand) + 16 * Math.sin(z * 0.0037 + 0.8);
    const radialDist = Math.abs(x - rCenter);
    if (radialDist < rimHalfW * 1.2) {
      const alongIn = smooth01((z - (WATERFALL_Z_TOP - 40)) / 110);
      const alongMask = alongIn * canyonBand;
      const acrossMask = 1 - smooth01(radialDist / (rimHalfW * 1.2));
      const depthT = clamp((WIND.canyonRimY + 20 - y) / (WIND.canyonRimY + 20 - WIND.canyonFloorY), 0, 1);
      if (alongMask > 0.001 && acrossMask > 0.001 && depthT > 0.001) {
        const speedKt = lerp(WIND.canyonMinKt, WIND.canyonMaxKt, depthT);
        const speedMs = speedKt * KT_TO_MS * alongMask * acrossMask;
        const dxdz = 210 * 0.0017 * Math.cos(z * 0.0017) - 95 * 0.0039 * Math.sin(z * 0.0039);
        const tLen = Math.hypot(dxdz, 1) || 1;
        wx += (dxdz / tLen) * speedMs;
        wz += (1 / tLen) * speedMs;
      }
    }
  }

  // (b) Ridge lift on windward (south/east-facing) slopes of snow ranges
  if (x < -900 || z < -2800) {
    const d = 36;
    const h0 = terrainHeight(x, z);
    if (h0 > 125) {
      const hx = terrainHeight(x + d, z);
      const hz = terrainHeight(x, z + d);
      const slopeSE = clamp(((h0 - hx) / d + (h0 - hz) / d) * 0.72, 0, 1);
      const agl = Math.max(0, y - h0);
      const altFade = 1 - smooth01((agl - 35) / 230);
      const rangeWeight = smooth01((h0 - 125) / 180);
      wy += WIND.ridgeMaxUpdraft * slopeSE * rangeWeight * altFade;
    }
  }

  out.x = wx;
  out.y = wy;
  out.z = wz;
  return out;
}
