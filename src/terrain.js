// Procedural golden-hour terrain heightmap, smooth-normal high-res mesh, patchwork fields,
// river, lake/coast, Runway 36 airfield, village, road, hedgerows, multi-type trees, clouds,
// aircraft, and target rings.

import { MISSION_RINGS, PLANE, RUNWAY, WORLD } from './config.js';
import { clamp, lerp, smooth01 } from './math.js';
import { fbm2D, valueNoise2D } from './random.js';

const TERRAIN_STEPS = 256;
const TERRAIN_STEP_SIZE = WORLD.size / TERRAIN_STEPS;

const FIELD_ANGLE = 0.24;
const FIELD_COS = Math.cos(FIELD_ANGLE);
const FIELD_SIN = Math.sin(FIELD_ANGLE);
const FIELD_W = 185;
const FIELD_H = 140;

const VILLAGE_CENTER = { x: -212, z: 65 };

/** Winding river centerline X as a function of Z. */
export function riverCenterX(z) {
  return 260 + 185 * Math.sin(z * 0.0021) + 75 * Math.cos(z * 0.0046);
}

/** Half-width of the river at a given Z (widens as it meets the northern lake). */
export function riverHalfWidth(z) {
  const widen = smooth01((-550 - z) / 500);
  return 28 + 16 * Math.sin(z * 0.0033 + 1.2) + widen * 140;
}

/** Distance factor inside the northern coastal lake/bay (positive = underwater basin). */
function lakeMask(x, z) {
  const coastZ = -840 + 210 * Math.sin(x * 0.0016 + 0.5) + 95 * Math.cos(x * 0.0034);
  return smooth01((coastZ - z) / 260);
}

/** Distance outside the flat airfield plateau (0 inside plateau, 1 outside). */
function airfieldFlatten(x, z) {
  const dx = Math.max(0, Math.abs(x - RUNWAY.x) - RUNWAY.apronWidth * 0.55);
  const zMin = RUNWAY.zEnd - RUNWAY.apronPaddingZ;
  const zMax = RUNWAY.zStart + RUNWAY.apronPaddingZ;
  const dz = z < zMin ? zMin - z : z > zMax ? z - zMax : 0;
  const dist = Math.hypot(dx, dz);
  return smooth01(dist / 130);
}

/** Deterministic terrain height in meters at world (x, z). Values <= 0 are underwater. */
export function terrainHeight(x, z) {
  // Rolling valley + outer ridge hills
  const nBroad = fbm2D(x * 0.00075 + 12.3, z * 0.00075 - 7.1, 4, 17);
  const nDetail = fbm2D(x * 0.0028 - 4.2, z * 0.0028 + 9.4, 3, 53);

  // Valley floor gently rises east and west into low foothills, and higher outer mountain rim
  const valleyDist = Math.abs(x) / 1400;
  const edgeDist = Math.max(Math.abs(x), Math.abs(z)) / WORLD.half;
  const hillShape = Math.pow(clamp(valleyDist, 0, 1.5), 1.45) * 65 + Math.pow(clamp(edgeDist - 0.55, 0, 1) * 2.2, 1.7) * 140;

  // Keep approach corridor (south of runway) gently low
  const approachCorridor = 1 - smooth01(Math.hypot(x * 0.8, Math.max(0, 420 - z) * 0.35 + Math.max(0, z - 1700) * 0.4) / 360);

  let h = 10 + nBroad * 42 + nDetail * 14 + hillShape * (0.45 + 0.7 * nBroad);
  h = lerp(h, 14 + nDetail * 5, approachCorridor * 0.72);

  // Carve winding river valley
  const rDist = Math.abs(x - riverCenterX(z));
  const rHalf = riverHalfWidth(z);
  const riverCarve = 1 - smooth01((rDist - rHalf * 0.7) / (rHalf * 2.4 + 45));
  if (z > -1150) {
    h = lerp(h, -5.5, riverCarve);
  }

  // Carve northern coastal lake
  const lMask = lakeMask(x, z);
  if (lMask > 0) {
    h = lerp(h, -12, lMask);
  }

  // Flatten airfield plateau cleanly at RUNWAY.elevation
  const af = airfieldFlatten(x, z);
  h = lerp(RUNWAY.elevation, h, af);

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

// --- Cached Terrain Grid for Exact Surface Grounding ---

let cachedHGrid = null;

function getTerrainHeightGrid() {
  if (cachedHGrid) return cachedHGrid;
  const stride = TERRAIN_STEPS + 1;
  const grid = new Float32Array(stride * stride);
  for (let iz = 0; iz <= TERRAIN_STEPS; iz += 1) {
    const z = -WORLD.half + iz * TERRAIN_STEP_SIZE;
    for (let ix = 0; ix <= TERRAIN_STEPS; ix += 1) {
      const x = -WORLD.half + ix * TERRAIN_STEP_SIZE;
      grid[iz * stride + ix] = terrainHeight(x, z);
    }
  }
  cachedHGrid = grid;
  return grid;
}

/** Sample the exact barycentric Y height of the rendered terrain mesh at (x, z). */
function sampleMeshHeight(x, z) {
  const grid = getTerrainHeightGrid();
  const stride = TERRAIN_STEPS + 1;
  const fx = clamp((x + WORLD.half) / TERRAIN_STEP_SIZE, 0, TERRAIN_STEPS - 1e-4);
  const fz = clamp((z + WORLD.half) / TERRAIN_STEP_SIZE, 0, TERRAIN_STEPS - 1e-4);
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

/** Approximate smooth surface normal Y at (x, z) from terrainHeight. */
function terrainNormalY(x, z) {
  const eps = TERRAIN_STEP_SIZE * 0.75;
  const dhdx = (terrainHeight(x + eps, z) - terrainHeight(x - eps, z)) / (eps * 2);
  const dhdz = (terrainHeight(x, z + eps) - terrainHeight(x, z - eps)) / (eps * 2);
  return 1 / Math.hypot(dhdx, 1, dhdz);
}

// --- Mesh Builder Helpers ---

function createBuilder() {
  const pos = [];
  const norm = [];
  const col = [];
  return {
    pos,
    norm,
    col,
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
      this.quad(...p000, ...p100, ...p101, ...p001, r * 0.7, g * 0.7, b * 0.7);
      this.quad(...p001, ...p101, ...p111, ...p011, r * 0.92, g * 0.92, b * 0.92);
      this.quad(...p100, ...p000, ...p010, ...p110, r * 0.85, g * 0.85, b * 0.85);
      this.quad(...p101, ...p100, ...p110, ...p111, r * 0.9, g * 0.9, b * 0.9);
      this.quad(...p000, ...p001, ...p011, ...p010, r * 0.88, g * 0.88, b * 0.88);
    },
    toMesh() {
      return {
        positions: new Float32Array(pos),
        normals: new Float32Array(norm),
        colors: new Float32Array(col),
        vertexCount: pos.length / 3,
      };
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

/** Base green/meadow/crop palette color for a given integer plot cell (no bare brown flats). */
function plotPaletteColor(cellX, cellZ) {
  const patch = cellHash(cellX, cellZ, 101);
  const tint = 0.92 + cellHash(cellX, cellZ, 303) * 0.14;
  let r;
  let g;
  let b;
  if (patch < 0.22) {
    r = 0.14; g = 0.45; b = 0.16; // Deep lush clover
  } else if (patch < 0.44) {
    r = 0.22; g = 0.54; b = 0.19; // Vibrant spring meadow
  } else if (patch < 0.64) {
    r = 0.17; g = 0.49; b = 0.22; // Emerald pasture
  } else if (patch < 0.80) {
    r = 0.29; g = 0.49; b = 0.19; // Olive orchard
  } else if (patch < 0.92) {
    r = 0.42; g = 0.53; b = 0.20; // Young barley / green-gold crop
  } else {
    r = 0.54; g = 0.54; b = 0.21; // Sunlit hayfield
  }
  return [r * tint, g * tint, b * tint];
}

/** Softly blended field plot color at world (x, z). */
function sampleFieldPlotColor(x, z) {
  const rx = x * FIELD_COS - z * FIELD_SIN;
  const rz = x * FIELD_SIN + z * FIELD_COS;
  const warp = (valueNoise2D(x * 0.0018, z * 0.0018, 77) - 0.5) * 12;
  const fx = (rx + warp) / FIELD_W;
  const fz = (rz - warp) / FIELD_H;
  const cx = Math.floor(fx);
  const cz = Math.floor(fz);
  const u = fx - cx;
  const v = fz - cz;

  const base = plotPaletteColor(cx, cz);
  const edgeW = 0.08;
  let r = base[0];
  let g = base[1];
  let b = base[2];

  if (u < edgeW) {
    const n = plotPaletteColor(cx - 1, cz);
    const t = 0.5 * (1 - smooth01(u / edgeW));
    r = lerp(r, n[0], t);
    g = lerp(g, n[1], t);
    b = lerp(b, n[2], t);
  } else if (u > 1 - edgeW) {
    const n = plotPaletteColor(cx + 1, cz);
    const t = 0.5 * (1 - smooth01((1 - u) / edgeW));
    r = lerp(r, n[0], t);
    g = lerp(g, n[1], t);
    b = lerp(b, n[2], t);
  }

  if (v < edgeW) {
    const n = plotPaletteColor(cx, cz - 1);
    const t = 0.5 * (1 - smooth01(v / edgeW));
    r = lerp(r, n[0], t);
    g = lerp(g, n[1], t);
    b = lerp(b, n[2], t);
  } else if (v > 1 - edgeW) {
    const n = plotPaletteColor(cx, cz + 1);
    const t = 0.5 * (1 - smooth01((1 - v) / edgeW));
    r = lerp(r, n[0], t);
    g = lerp(g, n[1], t);
    b = lerp(b, n[2], t);
  }

  return [r, g, b];
}

/**
 * Smooth height/slope/biome terrain vertex coloring:
 * shoreline sand -> grass lowland -> meadow -> dry grass -> rock on steeps,
 * with soft green field plots in the valley and green airfield turf right up to the runway.
 */
function terrainVertexColor(x, y, z, ny) {
  const nBio = fbm2D(x * 0.0024 + 5.1, z * 0.0024 - 3.7, 3, 91);
  const nMicro = fbm2D(x * 0.015 - 2.3, z * 0.015 + 6.4, 3, 202);
  const shade = 0.90 + nMicro * 0.20;

  // 1. Natural elevation biome progression: lowland grass -> meadow -> dry grass
  const meadowMix = smooth01((y - 16 + (nBio - 0.5) * 12) / 24);
  const dryMix = smooth01((y - 42 + (nBio - 0.5) * 16) / 30);

  let r = lerp(0.18, 0.25, meadowMix);
  let g = lerp(0.47, 0.52, meadowMix);
  let b = lerp(0.17, 0.20, meadowMix);

  r = lerp(r, 0.45, dryMix);
  g = lerp(g, 0.46, dryMix);
  b = lerp(b, 0.21, dryMix);

  // 2. Patchwork green agricultural field plots in gentle valley lowlands
  const fieldHeightMask = smooth01((y - 2.2) / 3.2) * (1 - smooth01((y - 34) / 22));
  const fieldSlopeMask = smooth01((ny - 0.86) / 0.08);
  const vilDist = Math.hypot(x - VILLAGE_CENTER.x, z - VILLAGE_CENTER.z);
  const vilExcl = smooth01((vilDist - 85) / 35);
  const dxAf = Math.max(0, Math.abs(x - RUNWAY.x) - 102);
  const dzAf = z < -345 ? -345 - z : z > 385 ? z - 385 : 0;
  const afDist = Math.hypot(dxAf, dzAf);
  const afMask = 1 - smooth01(afDist / 32);

  const fieldWeight = fieldHeightMask * fieldSlopeMask * vilExcl * (1 - afMask);
  if (fieldWeight > 0.001) {
    const fc = sampleFieldPlotColor(x, z);
    r = lerp(r, fc[0], fieldWeight);
    g = lerp(g, fc[1], fieldWeight);
    b = lerp(b, fc[2], fieldWeight);
  }

  // 3. Airfield mowed green grass right up to the runway edges
  if (afMask > 0.001) {
    const turfNoise = 0.94 + valueNoise2D(x * 0.025, z * 0.025, 11) * 0.12;
    r = lerp(r, 0.19 * turfNoise, afMask);
    g = lerp(g, 0.48 * turfNoise, afMask);
    b = lerp(b, 0.18 * turfNoise, afMask);
  }

  // 4. Village green turf
  if (vilExcl < 0.999) {
    const vNoise = 0.95 + valueNoise2D(x * 0.03, z * 0.03, 19) * 0.10;
    const vw = (1 - vilExcl) * 0.85;
    r = lerp(r, 0.20 * vNoise, vw);
    g = lerp(g, 0.48 * vNoise, vw);
    b = lerp(b, 0.18 * vNoise, vw);
  }

  // 5. Steep slopes & high ridges blend softly to weathered rock
  const slopeRock = smooth01((0.86 - ny) / 0.16);
  const highRock = smooth01((y - 76) / 46);
  const rockMix = clamp(Math.max(slopeRock, highRock * 0.88), 0, 1);
  if (rockMix > 0.001) {
    const rockVar = 0.90 + valueNoise2D(x * 0.022, z * 0.022, 313) * 0.22;
    const rockR = lerp(0.41, 0.49, nBio) * rockVar;
    const rockG = lerp(0.38, 0.43, nBio) * rockVar;
    const rockB = lerp(0.35, 0.36, nBio) * rockVar;
    r = lerp(r, rockR, rockMix);
    g = lerp(g, rockG, rockMix);
    b = lerp(b, rockB, rockMix);
  }

  // 6. Sand & pebble shorelines near river and coastal lake
  const sandMix = 1 - smooth01((y - 0.15) / 2.4);
  if (sandMix > 0.001) {
    const wet = 1 - smooth01((y + 0.3) / 0.9);
    const sandR = lerp(0.65, 0.45, wet);
    const sandG = lerp(0.58, 0.40, wet);
    const sandB = lerp(0.42, 0.30, wet);
    r = lerp(r, sandR, sandMix);
    g = lerp(g, sandG, sandMix);
    b = lerp(b, sandB, sandMix);
  }

  return [
    clamp(r * shade, 0, 1),
    clamp(g * shade, 0, 1),
    clamp(b * shade, 0, 1),
  ];
}

export function buildTerrainMesh() {
  const steps = TERRAIN_STEPS;
  const stepSize = TERRAIN_STEP_SIZE;
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

  for (let iz = 0; iz <= steps; iz += 1) {
    const z = -WORLD.half + iz * stepSize;
    const izPrev = Math.max(0, iz - 1);
    const izNext = Math.min(steps, iz + 1);
    const spanZ = (iz === 0 || iz === steps) ? stepSize : stepSize * 2;
    for (let ix = 0; ix <= steps; ix += 1) {
      const x = -WORLD.half + ix * stepSize;
      const ixPrev = Math.max(0, ix - 1);
      const ixNext = Math.min(steps, ix + 1);
      const spanX = (ix === 0 || ix === steps) ? stepSize : stepSize * 2;

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

      const [r, g, bl] = terrainVertexColor(x, h, z, ny);
      vx[idx] = x;
      vy[idx] = h;
      vz[idx] = z;
      vnx[idx] = nx;
      vny[idx] = ny;
      vnz[idx] = nz;
      vcr[idx] = r;
      vcg[idx] = g;
      vcb[idx] = bl;
    }
  }

  const triCount = steps * steps * 2;
  const vertexCount = triCount * 3;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  let ptr = 0;

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
    ptr += 3;
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

  return { positions, normals, colors, vertexCount };
}

export function buildWaterMesh() {
  const b = createBuilder();
  const steps = 64;
  const stepSize = WORLD.size / steps;
  const y = WORLD.waterY;
  for (let iz = 0; iz < steps; iz += 1) {
    const z0 = -WORLD.half + iz * stepSize;
    const z1 = z0 + stepSize;
    for (let ix = 0; ix < steps; ix += 1) {
      const x0 = -WORLD.half + ix * stepSize;
      const x1 = x0 + stepSize;
      const cx = (x0 + x1) * 0.5;
      const cz = (z0 + z1) * 0.5;
      if (terrainHeight(cx, cz) < 4.5 || terrainHeight(x0, z0) < 3 || terrainHeight(x1, z1) < 3) {
        b.quad(x0, y, z0, x0, y, z1, x1, y, z1, x1, y, z0, 0.14, 0.34, 0.44);
      }
    }
  }
  return b.toMesh();
}

// --- Road Paths (Shared between Airfield/Road Mesh and Scenery Placement) ---

const MAIN_ROAD_CTRL = [
  { x: -75, z: 152 },
  { x: -104, z: 144 },
  { x: -145, z: 122 },
  { x: -184, z: 94 },
  { x: -222, z: 70 },
  { x: -268, z: 40 },
];

const VILLAGE_LANE_CTRL = [
  { x: -194, z: 162 },
  { x: -206, z: 90 },
  { x: -220, z: 18 },
  { x: -234, z: -52 },
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
  return distToPolylineSq(x, z, ROAD_SAMPLES_MAIN) < mSq || distToPolylineSq(x, z, ROAD_SAMPLES_LANE) < mSq;
}

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
    // Right perpendicular in XZ
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

  const sr = 0.40;
  const sg = 0.36;
  const sb = 0.28;

  for (let i = 0; i < pts.length - 1; i += 1) {
    // Center road surface (CCW looking down from +Y)
    b.quad(...leftInner[i], ...leftInner[i + 1], ...rightInner[i + 1], ...rightInner[i], rCol, gCol, bCol);
    // Left & right gravel shoulders tucked smoothly into terrain
    b.quad(...leftOuter[i], ...leftOuter[i + 1], ...leftInner[i + 1], ...leftInner[i], sr, sg, sb);
    b.quad(...rightInner[i], ...rightInner[i + 1], ...rightOuter[i + 1], ...rightOuter[i], sr, sg, sb);
  }
}

/** Paint crisp 2D ground strip/rectangle in XZ plane at elevation `y`. */
function flatRect(b, x0, x1, z0, z1, y, r, g, bl) {
  b.quad(x0, y, z0, x0, y, z1, x1, y, z1, x1, y, z0, r, g, bl);
}

/** Build crisp block digits for runway numbers ("36" at south threshold, "18" at north). */
function paintDigit(b, digit, cx, cz, w, h, y, flip180 = false) {
  const s = flip180 ? -1 : 1;
  const t = w * 0.24;
  const rect = (lx0, lx1, lz0, lz1) => {
    const ax = cx + lx0 * s;
    const bx = cx + lx1 * s;
    const az = cz + lz0 * s;
    const bz = cz + lz1 * s;
    flatRect(b, Math.min(ax, bx), Math.max(ax, bx), Math.min(az, bz), Math.max(az, bz), y, 0.96, 0.95, 0.91);
  };
  const hw = w * 0.5;
  const hh = h * 0.5;
  if (digit === '3') {
    rect(-hw, hw, -hh, -hh + t);
    rect(-hw * 0.5, hw, -t * 0.5, t * 0.5);
    rect(-hw, hw, hh - t, hh);
    rect(hw - t, hw, -hh, hh);
  } else if (digit === '6') {
    rect(-hw, hw, -hh, -hh + t);
    rect(-hw, hw, -t * 0.5, t * 0.5);
    rect(-hw, hw, hh - t, hh);
    rect(-hw, -hw + t, -hh, hh);
    rect(hw - t, hw, -t * 0.5, hh);
  } else if (digit === '1') {
    rect(-t * 0.5, t * 0.5, -hh, hh);
    rect(-hw * 0.5, t * 0.5, -hh, -hh + t);
    rect(-hw * 0.6, hw * 0.6, hh - t, hh);
  } else if (digit === '8') {
    rect(-hw, hw, -hh, -hh + t);
    rect(-hw, hw, -t * 0.5, t * 0.5);
    rect(-hw, hw, hh - t, hh);
    rect(-hw, -hw + t, -hh, hh);
    rect(hw - t, hw, -hh, hh);
  }
}

export function buildAirfieldMesh() {
  const b = createBuilder();
  const yDirt = RUNWAY.elevation + 0.04;
  const yBase = RUNWAY.elevation + 0.08;
  const yMark = RUNWAY.elevation + 0.16;

  // Narrow compacted-dirt service strip beside the hangar & control tower only
  // (leaving mowed green grass right up to all runway edges)
  flatRect(b, -101, -72, 16, 156, yDirt, 0.42, 0.34, 0.24);
  flatRect(b, -72, -66, 16, 39, yDirt, 0.42, 0.34, 0.24);

  // Main asphalt runway
  flatRect(b, -RUNWAY.halfWidth, RUNWAY.halfWidth, RUNWAY.zEnd, RUNWAY.zStart, yBase, 0.17, 0.19, 0.22);

  // Taxiway & parking apron on west side
  flatRect(b, -72, -RUNWAY.halfWidth, 40, 190, yBase, 0.21, 0.23, 0.26);

  // Side edge white lines
  flatRect(b, -RUNWAY.halfWidth + 0.8, -RUNWAY.halfWidth + 1.8, RUNWAY.zEnd + 4, RUNWAY.zStart - 4, yMark, 0.94, 0.93, 0.88);
  flatRect(b, RUNWAY.halfWidth - 1.8, RUNWAY.halfWidth - 0.8, RUNWAY.zEnd + 4, RUNWAY.zStart - 4, yMark, 0.94, 0.93, 0.88);

  // Threshold piano keys at both ends
  for (let i = -3; i <= 3; i += 1) {
    if (i === 0) continue;
    const x = i * 5.4;
    flatRect(b, x - 1.4, x + 1.4, RUNWAY.zStart - 24, RUNWAY.zStart - 5, yMark, 0.95, 0.94, 0.9);
    flatRect(b, x - 1.4, x + 1.4, RUNWAY.zEnd + 5, RUNWAY.zEnd + 24, yMark, 0.95, 0.94, 0.9);
  }

  // Big bold "36" at south threshold (facing North -Z, readable from approach!)
  paintDigit(b, '3', -6.8, RUNWAY.zStart - 48, 8.2, 18, yMark, false);
  paintDigit(b, '6', 6.8, RUNWAY.zStart - 48, 8.2, 18, yMark, false);

  // "18" at north end
  paintDigit(b, '1', 6.8, RUNWAY.zEnd + 48, 8.2, 18, yMark, true);
  paintDigit(b, '8', -6.8, RUNWAY.zEnd + 48, 8.2, 18, yMark, true);

  // Dashed centerline
  for (let z = RUNWAY.zEnd + 76; z <= RUNWAY.zStart - 92; z += 34) {
    flatRect(b, -0.9, 0.9, z, z + 18, yMark, 0.95, 0.93, 0.86);
  }

  // Hangar (west of apron)
  const y0 = RUNWAY.elevation;
  b.box(-84, y0 + 5, 130, 28, 10, 34, 0.84, 0.80, 0.74);
  b.box(-84, y0 + 11.2, 130, 30, 2.5, 36, 0.78, 0.28, 0.22);
  b.box(-70, y0 + 4.2, 130, 0.8, 8.4, 22, 0.24, 0.28, 0.34);

  // Control Tower
  b.box(-74, y0 + 9, 24, 9, 18, 9, 0.88, 0.85, 0.79);
  b.box(-74, y0 + 20, 24, 13, 4.5, 13, 0.98, 0.74, 0.32);
  b.box(-74, y0 + 23.2, 24, 14.5, 1.8, 14.5, 0.30, 0.33, 0.38);

  // Windsock pole near threshold
  b.box(-32, y0 + 4.5, 250, 0.5, 9, 0.5, 0.85, 0.85, 0.85);
  b.box(-30, y0 + 8.6, 250, 4.2, 1.1, 1.1, 0.96, 0.42, 0.16);

  // Low fixture posts along Runway 36 & approach
  for (let z = RUNWAY.zEnd; z <= RUNWAY.zStart; z += 60) {
    b.box(-RUNWAY.halfWidth - 2.2, y0 + 0.35, z, 0.9, 0.7, 0.9, 0.24, 0.26, 0.30);
    b.box(RUNWAY.halfWidth + 2.2, y0 + 0.35, z, 0.9, 0.7, 0.9, 0.24, 0.26, 0.30);
  }
  for (let i = 1; i <= 6; i += 1) {
    const z = RUNWAY.zStart + i * 38;
    const h = sampleMeshHeight(0, z);
    b.box(-5.5, h + 0.45, z, 0.7, 0.9, 0.7, 0.24, 0.26, 0.30);
    b.box(5.5, h + 0.45, z, 0.7, 0.9, 0.7, 0.24, 0.26, 0.30);
  }
  for (let k = 0; k < 4; k += 1) {
    b.box(-29 - k * 4.2, y0 + 0.4, RUNWAY.zStart - 75, 1.8, 0.8, 1.4, 0.16, 0.18, 0.21);
  }

  // Country road connecting the village to the airfield service area
  addRoadRibbon(b, ROAD_SAMPLES_MAIN, 3.0, 1.0, 0.27, 0.26, 0.25);
  addRoadRibbon(b, ROAD_SAMPLES_LANE, 2.3, 0.8, 0.33, 0.31, 0.28);

  return b.toMesh();
}

// --- Village Houses (Pitched Roof Cottages & Village Hall) ---

const VILLAGE_HOUSES = [
  { x: -162, z: 140, rotY: -2.4, w: 9.5, d: 12.0, wallH: 4.8, roofH: 3.4, wall: [0.91, 0.86, 0.78], roof: [0.73, 0.31, 0.20] },
  { x: -166, z: 90, rotY: 0.65, w: 8.8, d: 11.0, wallH: 4.5, roofH: 3.1, wall: [0.88, 0.79, 0.64], roof: [0.30, 0.34, 0.40] },
  { x: -186, z: 140, rotY: -1.45, w: 9.0, d: 11.5, wallH: 4.6, roofH: 3.2, wall: [0.80, 0.83, 0.77], roof: [0.70, 0.30, 0.19] },
  { x: -222, z: 150, rotY: 1.65, w: 10.0, d: 12.5, wallH: 5.0, roofH: 3.5, wall: [0.90, 0.85, 0.76], roof: [0.54, 0.31, 0.20] },
  { x: -222, z: 112, rotY: 0.35, w: 9.2, d: 11.2, wallH: 4.6, roofH: 3.2, wall: [0.89, 0.77, 0.68], roof: [0.32, 0.35, 0.41] },
  { x: -252, z: 94, rotY: -2.6, w: 8.6, d: 10.6, wallH: 4.4, roofH: 3.0, wall: [0.92, 0.88, 0.80], roof: [0.74, 0.32, 0.21] },
  { x: -282, z: 66, rotY: -0.45, w: 9.4, d: 11.4, wallH: 4.7, roofH: 3.3, wall: [0.87, 0.80, 0.67], roof: [0.52, 0.29, 0.19] },
  { x: -244, z: 34, rotY: 0.5, w: 9.0, d: 11.6, wallH: 4.6, roofH: 3.2, wall: [0.90, 0.86, 0.78], roof: [0.72, 0.30, 0.20] },
  { x: -192, z: 54, rotY: -1.4, w: 8.8, d: 10.8, wallH: 4.5, roofH: 3.1, wall: [0.82, 0.84, 0.78], roof: [0.29, 0.33, 0.39] },
  { x: -242, z: 2, rotY: 1.42, w: 9.6, d: 12.2, wallH: 4.8, roofH: 3.4, wall: [0.91, 0.84, 0.74], roof: [0.71, 0.31, 0.20] },
  { x: -198, z: -8, rotY: -1.7, w: 8.6, d: 10.4, wallH: 4.4, roofH: 3.0, wall: [0.88, 0.76, 0.67], roof: [0.55, 0.32, 0.21] },
  { x: -254, z: -36, rotY: 1.38, w: 9.2, d: 11.4, wallH: 4.7, roofH: 3.3, wall: [0.90, 0.86, 0.77], roof: [0.30, 0.34, 0.40] },
  { x: -206, z: -42, rotY: -1.75, w: 11.0, d: 15.0, wallH: 5.4, roofH: 3.8, wall: [0.89, 0.84, 0.74], roof: [0.68, 0.28, 0.18] },
];

function addHouse(b, hSpec) {
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

  // Top roof planes
  b.quad(...rF, ...eRF, ...eRB, ...rB, roof[0], roof[1], roof[2]);
  b.quad(...rB, ...eLB, ...eLF, ...rF, roof[0] * 0.90, roof[1] * 0.90, roof[2] * 0.90);
  // Roof soffit undersides (for upward views)
  b.quad(...rB, ...eRB, ...eRF, ...rF, roof[0] * 0.55, roof[1] * 0.55, roof[2] * 0.55);
  b.quad(...rF, ...eLF, ...eLB, ...rB, roof[0] * 0.55, roof[1] * 0.55, roof[2] * 0.55);

  // Brick chimney on right roof slope
  const [chX, , chZ] = pt(hw * 0.45, 0, -hd * 0.25);
  b.box(chX, baseY + wallH + roofH * 0.72, chZ, 1.1, 2.2, 1.1, 0.58, 0.28, 0.22, rotY);

  // Front door (+Z face) & warm dusk-lit windows on front and sides
  const [doorX, , doorZ] = pt(0, 0, hd + 0.08);
  b.box(doorX, baseY + 1.15, doorZ, 1.4, 2.3, 0.16, 0.34, 0.22, 0.14, rotY);

  const winOffsets = [
    [-hw * 0.55, 2.6, hd + 0.07, 1.3, 1.1, 0.12],
    [hw * 0.55, 2.6, hd + 0.07, 1.3, 1.1, 0.12],
    [0, 2.6, -hd - 0.07, 1.4, 1.1, 0.12],
    [hw + 0.07, 2.6, -hd * 0.42, 0.12, 1.1, 1.3],
    [hw + 0.07, 2.6, hd * 0.42, 0.12, 1.1, 1.3],
    [-hw - 0.07, 2.6, -hd * 0.42, 0.12, 1.1, 1.3],
    [-hw - 0.07, 2.6, hd * 0.42, 0.12, 1.1, 1.3],
  ];
  for (let i = 0; i < winOffsets.length; i += 1) {
    const [wlx, wly, wlz, wsx, wsy, wsz] = winOffsets[i];
    const [wx, , wz] = pt(wlx, 0, wlz);
    const isLit = (i % 2 === 0);
    const wr = isLit ? 0.96 : 0.24;
    const wg = isLit ? 0.76 : 0.30;
    const wb = isLit ? 0.40 : 0.38;
    b.box(wx, baseY + wly, wz, wsx, wsy, wsz, wr, wg, wb, rotY);
  }
}

export function buildVillageMesh() {
  const b = createBuilder();
  for (let i = 0; i < VILLAGE_HOUSES.length; i += 1) {
    addHouse(b, VILLAGE_HOUSES[i]);
  }
  return b.toMesh();
}

// --- Trees (3 Types) & Field-Edge Hedgerows ---

function addConeTier(b, x, botY, h, radius, sides, r, g, bl, angleOffset = 0) {
  const topY = botY + h;
  const pts = [];
  for (let i = 0; i < sides; i += 1) {
    const a = angleOffset + (i / sides) * Math.PI * 2;
    pts.push([x + Math.cos(a) * radius, botY, Math.sin(a) * radius]);
  }
  for (let i = 0; i < sides; i += 1) {
    const p0 = pts[i];
    const p1 = pts[(i + 1) % sides];
    b.tri(x, topY, pts[0][2] - Math.sin(angleOffset) * radius, p1[0], p1[1], p1[2], p0[0], p0[1], p0[2], r, g, bl);
  }
}

/** Add a 6-sided cone centered at (x, botY, z). */
function addCenteredCone(b, x, botY, z, h, radius, sides, r, g, bl, angleOffset = 0) {
  const topY = botY + h;
  const pts = [];
  for (let i = 0; i < sides; i += 1) {
    const a = angleOffset + (i / sides) * Math.PI * 2;
    pts.push([x + Math.cos(a) * radius, botY, z + Math.sin(a) * radius]);
  }
  for (let i = 0; i < sides; i += 1) {
    const p0 = pts[i];
    const p1 = pts[(i + 1) % sides];
    b.tri(x, topY, z, p1[0], p1[1], p1[2], p0[0], p0[1], p0[2], r, g, bl);
    b.tri(x, botY, z, p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], r * 0.68, g * 0.68, bl * 0.68);
  }
}

/** Add a low-poly rounded ellipsoid canopy/shrub cluster with outward CCW winding. */
function addRoundedCanopy(b, cx, cy, cz, rx, ry, rz, r, g, bl, lonSegs = 7, latSegs = 3) {
  const vert = (lat, lon) => {
    const phi = (lat / latSegs) * Math.PI;
    const theta = (lon / lonSegs) * Math.PI * 2;
    const sp = Math.sin(phi);
    return [
      cx + sp * Math.cos(theta) * rx,
      cy + Math.cos(phi) * ry,
      cz + sp * Math.sin(theta) * rz,
    ];
  };
  for (let lat = 0; lat < latSegs; lat += 1) {
    for (let lon = 0; lon < lonSegs; lon += 1) {
      const v00 = vert(lat, lon);
      const v10 = vert(lat + 1, lon);
      const v11 = vert(lat + 1, lon + 1);
      const v01 = vert(lat, lon + 1);
      if (lat > 0) {
        b.tri(...v00, ...v01, ...v11, r, g, bl);
      }
      if (lat < latSegs - 1) {
        b.tri(...v00, ...v11, ...v10, r * 0.95, g * 0.96, bl * 0.95);
      }
    }
  }
}

/** Type 1: Conifer with sturdy trunk + 3 layered 6-sided foliage tiers. */
function addConiferTree(b, x, y, z, scale, shade, rot = 0) {
  b.box(x, y + 1.9 * scale, z, 1.0 * scale, 4.0 * scale, 1.0 * scale, 0.34, 0.22, 0.13, rot);
  addCenteredCone(b, x, y + 2.6 * scale, z, 5.4 * scale, 3.8 * scale, 6, 0.14 * shade, 0.33 * shade, 0.17 * shade, rot);
  addCenteredCone(b, x, y + 5.2 * scale, z, 4.8 * scale, 3.0 * scale, 6, 0.17 * shade, 0.38 * shade, 0.19 * shade, rot + 0.52);
  addCenteredCone(b, x, y + 7.8 * scale, z, 4.2 * scale, 2.1 * scale, 6, 0.21 * shade, 0.44 * shade, 0.22 * shade, rot + 0.26);
}

/** Type 2: Broadleaf oak/deciduous with trunk + multi-lobe rounded canopy. */
function addBroadleafTree(b, x, y, z, scale, shade, rot = 0) {
  b.box(x, y + 2.2 * scale, z, 1.05 * scale, 4.4 * scale, 1.05 * scale, 0.36, 0.24, 0.14, rot);
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const cr = (0.24 + 0.06 * (shade - 0.9)) * shade;
  const cg = 0.48 * shade;
  const cb = 0.18 * shade;
  const cy = y + 6.0 * scale;
  addRoundedCanopy(b, x, cy, z, 3.6 * scale, 3.0 * scale, 3.5 * scale, cr, cg, cb, 7, 3);
  addRoundedCanopy(
    b,
    x + c * 1.4 * scale,
    cy + 1.1 * scale,
    z - s * 1.4 * scale,
    2.5 * scale,
    2.2 * scale,
    2.4 * scale,
    cr * 1.08,
    cg * 1.08,
    cb * 1.04,
    6,
    3,
  );
  addRoundedCanopy(
    b,
    x - c * 1.2 * scale + s * 0.9 * scale,
    cy - 0.3 * scale,
    z + s * 1.2 * scale + c * 0.9 * scale,
    2.3 * scale,
    2.0 * scale,
    2.3 * scale,
    cr * 0.92,
    cg * 0.94,
    cb * 0.95,
    6,
    3,
  );
}

/** Type 3: Tall slender poplar / cypress with oval rounded crown. */
function addPoplarTree(b, x, y, z, scale, shade, rot = 0) {
  b.box(x, y + 1.8 * scale, z, 0.85 * scale, 3.6 * scale, 0.85 * scale, 0.35, 0.24, 0.15, rot);
  const cr = 0.21 * shade;
  const cg = 0.45 * shade;
  const cb = 0.19 * shade;
  addRoundedCanopy(b, x, y + 5.4 * scale, z, 2.3 * scale, 3.6 * scale, 2.3 * scale, cr, cg, cb, 6, 3);
  addRoundedCanopy(b, x, y + 8.6 * scale, z, 1.7 * scale, 3.2 * scale, 1.7 * scale, cr * 1.08, cg * 1.08, cb * 1.05, 6, 3);
}

function isTreeForbidden(x, z) {
  // Airfield plateau (runway, apron, hangar, tower)
  if (Math.abs(x) < 112 && z > -350 && z < 385) return true;
  // Runway 36 final-approach clearway (keep short final & glidepath centerline open)
  if (Math.abs(x) < 42 && z >= 320 && z < 1150) return true;
  // River channel & immediate banks
  if (Math.abs(x - riverCenterX(z)) < riverHalfWidth(z) + 24) return true;
  // Village roads
  if (isNearRoad(x, z, 9.5)) return true;
  // Village house footprints
  for (let i = 0; i < VILLAGE_HOUSES.length; i += 1) {
    const h = VILLAGE_HOUSES[i];
    if (Math.hypot(x - h.x, z - h.z) < 15) return true;
  }
  // Target rings
  for (let i = 0; i < MISSION_RINGS.length; i += 1) {
    const ring = MISSION_RINGS[i];
    if (Math.hypot(x - ring.x, z - ring.z) < 44) return true;
  }
  return false;
}

function addHedgerowSegment(b, ax, az, bx, bz, random) {
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz);
  if (len < 10) return;
  const shrubs = Math.max(4, Math.floor(len / 14));
  for (let i = 0; i <= shrubs; i += 1) {
    // Occasional gate gap in hedgerow
    if (i === Math.floor(shrubs * 0.5) && random() < 0.55) continue;
    const t = i / shrubs;
    const jx = (random() - 0.5) * 2.4;
    const jz = (random() - 0.5) * 2.4;
    const x = ax + dx * t + jx;
    const z = az + dz * t + jz;
    if (isTreeForbidden(x, z)) continue;
    const h = sampleMeshHeight(x, z);
    const ny = terrainNormalY(x, z);
    if (h < 3.2 || h > 44 || ny < 0.87) continue;

    const shade = 0.85 + random() * 0.25;
    const rx = 2.6 + random() * 1.4;
    const ry = 1.6 + random() * 0.9;
    const rz = 2.6 + random() * 1.4;
    addRoundedCanopy(b, x, h + ry * 0.45, z, rx, ry, rz, 0.16 * shade, 0.40 * shade, 0.15 * shade, 6, 3);

    // Occasional hedgerow tree along the line
    if (random() < 0.16) {
      const scale = 0.8 + random() * 0.45;
      if (random() < 0.65) addBroadleafTree(b, x, h - 0.2, z, scale, shade, random() * Math.PI * 2);
      else addPoplarTree(b, x, h - 0.2, z, scale, shade, random() * Math.PI * 2);
    }
  }
}

export function buildTreesMesh(random) {
  const b = createBuilder();

  // 1. Field-edge hedgerows across the agricultural valley (including approach & title backdrop)
  const cellMinX = -7;
  const cellMaxX = 7;
  const cellMinZ = -7;
  const cellMaxZ = 10;
  for (let cz = cellMinZ; cz <= cellMaxZ; cz += 1) {
    for (let cx = cellMinX; cx <= cellMaxX; cx += 1) {
      const worldApproxZ = cz * FIELD_H;
      const prob = worldApproxZ > 320 ? 0.46 : 0.34;
      // Edge along constant Z (from cx to cx+1)
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
      // Edge along constant X (from cz to cz+1)
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

  // 2. Valley & hillside woodland trees (~560)
  let placed = 0;
  let attempts = 0;
  while (placed < 560 && attempts < 6000) {
    attempts += 1;
    const x = (random() * 2 - 1) * (WORLD.half - 180);
    const z = (random() * 2 - 1) * (WORLD.half - 180);
    if (isTreeForbidden(x, z)) continue;
    const h = sampleMeshHeight(x, z);
    const ny = terrainNormalY(x, z);
    if (h < 3.2 || h > 106 || ny < 0.74) continue;
    if (valueNoise2D(x * 0.003, z * 0.003, 404) < 0.38) continue;

    const scale = 0.85 + random() * 0.75;
    const shade = 0.86 + random() * 0.28;
    const rot = random() * Math.PI * 2;
    const typeRoll = random();
    if (h > 36 || typeRoll < 0.48) addConiferTree(b, x, h - 0.25, z, scale, shade, rot);
    else if (typeRoll < 0.82) addBroadleafTree(b, x, h - 0.25, z, scale, shade, rot);
    else addPoplarTree(b, x, h - 0.25, z, scale, shade, rot);
    placed += 1;
  }

  // 3. Extra groves flanking the final-approach corridor & title-screen backdrop (~190)
  let corridorPlaced = 0;
  let corridorAttempts = 0;
  while (corridorPlaced < 190 && corridorAttempts < 2400) {
    corridorAttempts += 1;
    const side = random() < 0.5 ? -1 : 1;
    const x = side * (46 + random() * 480);
    const z = 340 + random() * 1300;
    if (isTreeForbidden(x, z)) continue;
    const h = sampleMeshHeight(x, z);
    const ny = terrainNormalY(x, z);
    if (h < 3.5 || h > 60 || ny < 0.84) continue;
    if (valueNoise2D(x * 0.004, z * 0.004, 515) < 0.32) continue;

    const scale = 0.85 + random() * 0.65;
    const shade = 0.88 + random() * 0.24;
    const rot = random() * Math.PI * 2;
    const typeRoll = random();
    if (typeRoll < 0.36) addConiferTree(b, x, h - 0.25, z, scale, shade, rot);
    else if (typeRoll < 0.78) addBroadleafTree(b, x, h - 0.25, z, scale, shade, rot);
    else addPoplarTree(b, x, h - 0.25, z, scale, shade, rot);
    corridorPlaced += 1;
  }

  // 4. Village garden & roadside trees (~65)
  let villagePlaced = 0;
  let villageAttempts = 0;
  while (villagePlaced < 65 && villageAttempts < 1000) {
    villageAttempts += 1;
    const x = -325 + random() * 195;
    const z = -85 + random() * 290;
    if (isTreeForbidden(x, z)) continue;
    const h = sampleMeshHeight(x, z);
    if (h < 4 || h > 40) continue;

    const scale = 0.75 + random() * 0.55;
    const shade = 0.88 + random() * 0.24;
    const rot = random() * Math.PI * 2;
    const typeRoll = random();
    if (typeRoll < 0.55) addBroadleafTree(b, x, h - 0.2, z, scale, shade, rot);
    else if (typeRoll < 0.85) addPoplarTree(b, x, h - 0.2, z, scale, shade, rot);
    else addConiferTree(b, x, h - 0.2, z, scale, shade, rot);
    villagePlaced += 1;
  }

  return b.toMesh();
}

function addCloudBlob(b, centers, clusterX, clusterZ, px, py, pz, rx, ry, rz, r, g, bl) {
  const lonSegs = 10;
  const latSegs = 5;
  const vert = (lat, lon) => {
    const phi = (lat / latSegs) * Math.PI;
    const theta = (lon / lonSegs) * Math.PI * 2;
    const sp = Math.sin(phi);
    const nx = sp * Math.cos(theta);
    const ny = Math.cos(phi);
    const nz = sp * Math.sin(theta);
    const yScale = ny < 0 ? ny * 0.62 : ny;
    return {
      x: px + nx * rx,
      y: py + yScale * ry,
      z: pz + nz * rz,
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
  for (let i = 0; i < 28; i += 1) {
    const cx = (random() * 2 - 1) * (WORLD.half * 0.9);
    const cz = (random() * 2 - 1) * (WORLD.half * 0.9);
    const cy = 415 + random() * 200;
    const clusterScale = 0.85 + random() * 0.55;

    addCloudBlob(
      b,
      centers,
      cx,
      cz,
      cx,
      cy + 8 * clusterScale,
      cz,
      58 * clusterScale,
      38 * clusterScale,
      50 * clusterScale,
      1.0,
      0.97,
      0.94,
    );

    const puffs = 5 + Math.floor(random() * 3);
    for (let p = 0; p < puffs; p += 1) {
      const ang = (p / puffs) * Math.PI * 2 + random() * 0.5;
      const dist = (38 + random() * 38) * clusterScale;
      const px = cx + Math.cos(ang) * dist;
      const pz = cz + Math.sin(ang) * dist * 0.82;
      const py = cy + (random() - 0.35) * 20 * clusterScale;
      const rx = (34 + random() * 28) * clusterScale;
      const ry = (22 + random() * 18) * clusterScale;
      const rz = (30 + random() * 26) * clusterScale;
      const tint = 0.96 + random() * 0.04;
      addCloudBlob(b, centers, cx, cz, px, py, pz, rx, ry, rz, tint, tint * 0.97, tint * 0.94);
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
