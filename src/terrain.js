// Procedural golden-hour terrain heightmap (10,400m warped smooth mesh), blended biome zones,
// zone-tint & detail Canvas textures, animated water normal map, textured Runway 36 + decals,
// airfield + village + SE town, dense/sparse zoned trees, clouds, and far mountain band.

import { MISSION_RINGS, PLANE, RUNWAY, WORLD } from './config.js';
import { clamp, lerp, smooth01 } from './math.js';
import { createRandom, fbm2D, valueNoise2D } from './random.js';

const TERRAIN_STEPS = 320;
const TERRAIN_STEP_SIZE = WORLD.size / TERRAIN_STEPS;

const FIELD_ANGLE = 0.24;
const FIELD_COS = Math.cos(FIELD_ANGLE);
const FIELD_SIN = Math.sin(FIELD_ANGLE);
const FIELD_W = 185;
const FIELD_H = 140;

const VILLAGE_CENTER = { x: -212, z: 65 };
const TOWN_CENTER = { x: 1380, z: 1220 };

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

/** Northern lake coastline Z coordinate at a given X. */
function lakeCoastZ(x) {
  const westShelf = smooth01((-1050 - x) / 1100) * 1450;
  return -1520 + 260 * Math.sin(x * 0.00085 + 0.5) + 130 * Math.cos(x * 0.0019) - westShelf;
}

/** Distance factor inside the northern lake (positive = underwater basin). */
function lakeMask(x, z) {
  const coastZ = lakeCoastZ(x);
  return smooth01((coastZ - z) / 340);
}

/** Distance outside the flat airfield plateau (0 inside plateau, 1 outside). */
function airfieldFlatten(x, z) {
  const dx = Math.max(0, Math.abs(x - RUNWAY.x) - RUNWAY.apronWidth * 0.55);
  const zMin = RUNWAY.zEnd - RUNWAY.apronPaddingZ;
  const zMax = RUNWAY.zStart + RUNWAY.apronPaddingZ;
  const dz = z < zMin ? zMin - z : z > zMax ? z - zMax : 0;
  const dist = Math.hypot(dx, dz);
  return smooth01(dist / 140);
}

/** Distance outside the Southeast town plateau (0 inside plateau, 1 outside). */
function townFlatten(x, z) {
  const dist = Math.hypot(x - TOWN_CENTER.x, z - TOWN_CENTER.z);
  return smooth01((dist - 270) / 210);
}

/** Smoothly blended biome zone weights at world (x, z). */
export function sampleZoneWeights(x, z) {
  const warpX = (fbm2D(x * 0.00032, z * 0.00032, 3, 101) - 0.5) * 440;
  const warpZ = (fbm2D(x * 0.00032 + 11.7, z * 0.00032 - 5.3, 3, 202) - 0.5) * 440;
  const nx = x + warpX;
  const nz = z + warpZ;

  const coastZ = lakeCoastZ(x);
  const lake = lakeMask(x, z);
  const wetland = smooth01((coastZ + 620 - nz) / 480) * smooth01((nz - (coastZ - 260)) / 320) * smooth01((nx + 1950) / 700) * (1 - lake * 0.85);
  const mountain = smooth01((-920 - nx) / 950);
  const forest = smooth01((nx - 760) / 850) * smooth01((980 - nz) / 850) * (1 - lake);
  const town = 1 - townFlatten(x, z);
  const airport = 1 - airfieldFlatten(x, z);
  const used = clamp(lake + wetland * 0.8 + mountain + forest + town + airport, 0, 1);
  const farmland = clamp(1 - used * 0.82, 0, 1);
  return { farmland, forest, lake, wetland, mountain, town, airport };
}

/** Deterministic terrain height in meters at world (x, z). Values <= 0 are underwater. */
export function terrainHeight(x, z) {
  const nBroad = fbm2D(x * 0.00048 + 12.3, z * 0.00048 - 7.1, 4, 17);
  const nDetail = fbm2D(x * 0.0022 - 4.2, z * 0.0022 + 9.4, 3, 53);
  const zones = sampleZoneWeights(x, z);

  // Rolling central valley + distant world-edge hills
  const valleyDist = Math.abs(x) / 2600;
  const edgeDist = Math.max(Math.abs(x), Math.abs(z)) / WORLD.half;
  const ridgeNoise = 1 - Math.abs(fbm2D(x * 0.00075 + 3.7, z * 0.00075 - 5.2, 4, 79) * 2 - 1);
  const outerRim = Math.pow(clamp(edgeDist - 0.62, 0, 1) * 2.6, 1.7) * (145 + ridgeNoise * 110);
  const hillShape = Math.pow(clamp(valleyDist, 0, 1.5), 1.4) * 52 + outerRim;

  // Approach corridor south of Runway 36 stays gently low
  const approachCorridor = 1 - smooth01(Math.hypot(x * 0.75, Math.max(0, 420 - z) * 0.32 + Math.max(0, z - 2100) * 0.35) / 420);

  let h = 11 + nBroad * 36 + nDetail * 12 + hillShape * (0.45 + 0.65 * nBroad);
  h = lerp(h, 14 + nDetail * 4, approachCorridor * 0.74);

  // Zone 2: East/NE dense forest rolling hills
  h += zones.forest * (18 + nBroad * 42 + ridgeNoise * 22);

  // Zone 4: West/NW rugged mountains (snow-free ridges)
  if (zones.mountain > 0.001) {
    const mRidge = 1 - Math.abs(fbm2D(x * 0.0009 + 2.1, z * 0.0009 - 4.3, 4, 89) * 2 - 1);
    const mHeight = 48 + Math.pow(mRidge, 1.3) * 168 + nDetail * 18;
    h += zones.mountain * mHeight;
  }

  // Zone 3: Low flat marsh/wetland shores + marshy peninsula near (-1150, -2450)
  if (zones.wetland > 0.001) {
    h = lerp(h, 2.2 + nDetail * 3.8, zones.wetland * 0.85);
  }
  const marshPeninsula = 1 - smooth01((Math.hypot(x - (-1150), z - (-2450)) - 220) / 340);

  // Carve continuous winding river from northern lake down through entire valley
  const rDist = Math.abs(x - riverCenterX(z));
  const rHalf = riverHalfWidth(z);
  const riverCarve = 1 - smooth01((rDist - rHalf * 0.72) / (rHalf * 2.2 + 52));
  if (z > -1850) {
    h = lerp(h, -5.5, riverCarve);
  }

  // Carve large northern lake (preserving marshy peninsula around Ring 3 shore)
  const lMask = lakeMask(x, z) * (1 - marshPeninsula * 0.92);
  if (lMask > 0) {
    h = lerp(h, -14, lMask);
  }
  if (marshPeninsula > 0.01) {
    h = lerp(h, 2.4 + nDetail * 2.2, marshPeninsula * 0.88);
  }

  // Level Southeast Town plateau gently at 24m
  const tf = townFlatten(x, z);
  h = lerp(24, h, tf);

  // Flatten airfield plateau cleanly at RUNWAY.elevation (14m)
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
function sampleMeshHeight(x, z) {
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

/** Smoothly shaded terrain AO & subtle slope/valley tint to multiply with 2048² ground texture. */
function terrainVertexAO(h, ny, hAvgNeighbors) {
  // Darken concave valleys, riverbanks, and steep rock crevices gently (fake AO)
  const concavity = Math.max(0, hAvgNeighbors - h);
  const valleyAo = clamp(1.0 - concavity * 0.085, 0.74, 1.0);
  const slopeAo = lerp(0.84, 1.0, smooth01((ny - 0.65) / 0.30));
  const ao = valleyAo * slopeAo;
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
      const [r, g, bl] = terrainVertexAO(h, ny, hAvg);
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

      // Zone 4: West hills & mountains (rocky slate/granite & dry alpine turf)
      if (zones.mountain > 0.001) {
        const rock = smooth01((y - 72) / 65);
        const mR = lerp(0.68, 0.72, rock);
        const mG = lerp(0.66, 0.65, rock);
        const mB = lerp(0.46, 0.58, rock);
        r = lerp(r, mR, zones.mountain * 0.84);
        g = lerp(g, mG, zones.mountain * 0.84);
        b = lerp(b, mB, zones.mountain * 0.84);
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

      // Warm sand & wet silt along riverbanks and lake shorelines
      const sandMix = 1 - smooth01((y - 0.35) / 3.2);
      if (sandMix > 0.001) {
        const wet = 1 - smooth01((y + 0.3) / 1.2);
        r = lerp(r, lerp(0.84, 0.50, wet), sandMix * 0.88);
        g = lerp(g, lerp(0.76, 0.44, wet), sandMix * 0.88);
        b = lerp(b, lerp(0.56, 0.34, wet), sandMix * 0.88);
      }

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
 * 512x512 seamlessly tileable fine ground detail texture (grass blades, soil grain, rock grit).
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
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 1600; i += 1) {
    const x = rand() * SIZE;
    const y = rand() * SIZE;
    const ang = rand() * Math.PI * 2;
    const len = 2.0 + rand() * 3.5;
    const light = rand() > 0.5;
    ctx.strokeStyle = light ? 'rgba(215, 220, 200, 0.16)' : 'rgba(38, 42, 30, 0.18)';
    for (let ox = -1; ox <= 1; ox += 1) {
      for (let oy = -1; oy <= 1; oy += 1) {
        const px = x + ox * SIZE;
        const py = y + oy * SIZE;
        if (px < -8 || px > SIZE + 8 || py < -8 || py > SIZE + 8) continue;
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

// --- Water Mesh (Depth-tagged for Realistic Shore & Reflection) ---

export function buildWaterMesh() {
  const b = createBuilder();
  const steps = 112;
  const stepSize = WORLD.size / steps;
  const y = WORLD.waterY;

  const emitWaterVert = (x, z) => {
    const h = sampleMeshHeight(x, z);
    const depth = clamp((y - h) / 4.8, 0, 1);
    b.pushVert(x, y, z, 0, 1, 0, depth, 0.32, 0.44);
  };

  for (let iz = 0; iz < steps; iz += 1) {
    const z0 = -WORLD.half + iz * stepSize;
    const z1 = z0 + stepSize;
    for (let ix = 0; ix < steps; ix += 1) {
      const x0 = -WORLD.half + ix * stepSize;
      const x1 = x0 + stepSize;
      const cx = (x0 + x1) * 0.5;
      const cz = (z0 + z1) * 0.5;
      if (
        sampleMeshHeight(cx, cz) < 5.5 ||
        sampleMeshHeight(x0, z0) < 3.5 ||
        sampleMeshHeight(x1, z0) < 3.5 ||
        sampleMeshHeight(x0, z1) < 3.5 ||
        sampleMeshHeight(x1, z1) < 3.5
      ) {
        emitWaterVert(x0, z0);
        emitWaterVert(x0, z1);
        emitWaterVert(x1, z1);
        emitWaterVert(x0, z0);
        emitWaterVert(x1, z1);
        emitWaterVert(x1, z0);
      }
    }
  }
  return b.toMesh();
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

function addHangar(b, cx, y0, cz) {
  const w = 28;
  const d = 34;
  const wallH = 8.4;
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
  b.box(cx + hw - 0.35, y0 + wallH * 0.5, cz - 13.0, 0.7, wallH, 8.0, 0.46, 0.48, 0.50);
  b.box(cx + hw - 0.35, y0 + wallH * 0.5, cz + 13.0, 0.7, wallH, 8.0, 0.46, 0.48, 0.50);
  b.box(cx + hw - 0.35, y0 + wallH - 0.9, cz, 0.7, 1.8, 18.0, 0.34, 0.38, 0.44);
  // Partially slid door leaves
  b.box(cx + hw + 0.15, y0 + 3.6, cz - 9.2, 0.35, 7.2, 5.2, 0.30, 0.35, 0.42);
  b.box(cx + hw + 0.15, y0 + 3.6, cz + 9.2, 0.35, 7.2, 5.2, 0.30, 0.35, 0.42);

  // Vertical exterior structural wall ribs
  for (let z = -hd + 3; z <= hd - 3; z += 5.5) {
    b.box(cx - hw - 0.1, y0 + wallH * 0.5, cz + z, 0.35, wallH, 0.45, 0.44, 0.46, 0.49);
  }

  // Curved barrel-vault roof (smooth arched corrugated metal in muted slate-blue/charcoal)
  const archSegs = 10;
  const archR = hw + 1.2;
  const archH = 4.4;
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
  b.box(cx, y0 + wallH + 0.15, z1 + 0.1, w + 2.4, 0.55, 0.25, 0.54, 0.27, 0.22);
  b.box(cx, y0 + wallH + 0.15, z0 - 0.1, w + 2.4, 0.55, 0.25, 0.54, 0.27, 0.22);

  // Small office annex on north side of hangar
  b.box(cx - 2, y0 + 2.4, cz - hd - 4.2, 14, 4.8, 7.6, 0.74, 0.72, 0.67);
  b.box(cx - 2, y0 + 5.0, cz - hd - 4.2, 14.8, 0.5, 8.4, 0.34, 0.37, 0.41);
  b.box(cx + 5.1, y0 + 2.5, cz - hd - 4.2, 0.15, 1.5, 4.2, 0.18, 0.25, 0.32);
}

function addControlTower(b, cx, y0, cz) {
  // Concrete base & tapered tower shaft
  b.box(cx, y0 + 0.3, cz, 11.5, 0.6, 11.5, 0.45, 0.45, 0.43);
  b.box(cx, y0 + 8.5, cz, 7.8, 16.4, 7.8, 0.72, 0.70, 0.66);
  // Subtle architectural corner pilasters
  for (const sx of [-3.9, 3.9]) {
    for (const sz of [-3.9, 3.9]) {
      b.box(cx + sx, y0 + 8.5, cz + sz, 0.85, 16.4, 0.85, 0.58, 0.57, 0.54);
    }
  }

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

export function buildAirfieldMesh() {
  const b = createBuilder();
  const y0 = RUNWAY.elevation;
  const yApron = y0 + 0.06;

  // Taxiway & concrete parking apron on west side
  flatRect(b, -76, -RUNWAY.halfWidth + 0.2, 36, 194, yApron, 0.32, 0.33, 0.35);
  // Taxiway connector bands
  flatRect(b, -74, -RUNWAY.halfWidth, 114, 136, yApron + 0.01, 0.26, 0.27, 0.30);
  flatRect(b, -74, -RUNWAY.halfWidth, 152, 174, yApron + 0.01, 0.26, 0.27, 0.30);
  // Subtle yellow apron taxi guideline
  flatRect(b, -62, -61.3, 44, 186, yApron + 0.03, 0.78, 0.60, 0.20);
  flatRect(b, -62, -22, 124.5, 125.2, yApron + 0.03, 0.78, 0.60, 0.20);
  flatRect(b, -62, -22, 162.5, 163.2, yApron + 0.03, 0.78, 0.60, 0.20);

  // Realistic Hangar & Control Tower
  addHangar(b, -86, y0, 130);
  addControlTower(b, -74, y0, 24);

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

  b.quad(...rF, ...eRF, ...eRB, ...rB, roof[0], roof[1], roof[2]);
  b.quad(...rB, ...eLB, ...eLF, ...rF, roof[0] * 0.90, roof[1] * 0.90, roof[2] * 0.90);
  b.quad(...rB, ...eRB, ...eRF, ...rF, roof[0] * 0.55, roof[1] * 0.55, roof[2] * 0.55);
  b.quad(...rF, ...eLF, ...eLB, ...rB, roof[0] * 0.55, roof[1] * 0.55, roof[2] * 0.55);

  // Brick chimney
  const [chX, , chZ] = pt(hw * 0.45, 0, -hd * 0.25);
  b.box(chX, baseY + wallH + roofH * 0.72, chZ, 1.1, 2.2, 1.1, 0.50, 0.27, 0.22, rotY);

  // Front door & muted dusk-lit/glass windows
  const [doorX, , doorZ] = pt(0, 0, hd + 0.08);
  b.box(doorX, baseY + 1.15, doorZ, 1.4, 2.3, 0.16, 0.30, 0.20, 0.14, rotY);

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
    const isLit = (i % 3 === 0);
    const wr = isLit ? 0.88 : 0.20;
    const wg = isLit ? 0.68 : 0.25;
    const wb = isLit ? 0.38 : 0.31;
    b.box(wx, baseY + wly, wz, wsx, wsy, wsz, wr, wg, wb, rotY);
  }
}

function addTownChurch(b, x, z, rotY) {
  const baseY = sampleMeshHeight(x, z);
  const w = 13;
  const d = 24;
  const wallH = 8.2;
  const roofH = 5.4;
  addHouse(b, { x, z, rotY, w, d, wallH, roofH, wall: [0.80, 0.77, 0.72], roof: [0.27, 0.29, 0.34] });
  const c = Math.cos(rotY);
  const s = Math.sin(rotY);
  const tx = x + (d * 0.42) * s;
  const tz = z + (d * 0.42) * c;
  // Bell tower + steep spire
  b.box(tx, baseY + 9.0, tz, 5.2, 18.0, 5.2, 0.79, 0.76, 0.70, rotY);
  addSmoothCone(b, tx, baseY + 18.0, tz, 9.5, 3.4, 4, 0.24, 0.27, 0.32, rotY + Math.PI * 0.25);
  // Warm arched nave windows
  for (let i = -1; i <= 1; i += 1) {
    const wx = x + (w * 0.5 + 0.08) * c + (i * 6.0) * s;
    const wz = z - (w * 0.5 + 0.08) * s + (i * 6.0) * c;
    b.box(wx, baseY + 4.4, wz, 0.14, 3.2, 1.6, 0.94, 0.74, 0.38, rotY);
  }
}

function addTownSchool(b, x, z, rotY) {
  // Larger two-wing civic/school building with clock cupola
  addHouse(b, { x, z, rotY, w: 15, d: 30, wallH: 6.8, roofH: 4.2, wall: [0.74, 0.44, 0.34], roof: [0.28, 0.31, 0.36] });
  const baseY = sampleMeshHeight(x, z);
  b.box(x, baseY + 11.8, z, 3.6, 3.2, 3.6, 0.84, 0.81, 0.75, rotY);
  addSmoothCone(b, x, baseY + 13.4, z, 3.2, 2.5, 4, 0.28, 0.31, 0.36, rotY + Math.PI * 0.25);
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
  // 4x3 street grid blocks around TOWN_CENTER (1380, 1220)
  const cols = [-190, -105, -20, 65, 150];
  const rows = [-165, -75, 15, 105, 195];
  for (let r = 0; r < rows.length; r += 1) {
    for (let c = 0; c < cols.length; c += 1) {
      // Reserve center square for Church + School
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
  return houses;
}

const TOWN_HOUSES = buildTownHousesList();

export function buildVillageMesh() {
  const b = createBuilder();
  for (let i = 0; i < VILLAGE_HOUSES.length; i += 1) {
    addHouse(b, VILLAGE_HOUSES[i]);
  }
  // Oakwood Town (SE of airfield): street grid, 44 pitched-roof houses, church & school
  const streetX = [-225, -140, -55, 30, 115, 195];
  const streetZ = [-205, -115, -25, 65, 150, 235];
  for (let i = 0; i < streetZ.length; i += 1) {
    const gz = TOWN_CENTER.z + streetZ[i];
    addRoadRibbon(
      b,
      [{ x: TOWN_CENTER.x - 245, z: gz }, { x: TOWN_CENTER.x, z: gz }, { x: TOWN_CENTER.x + 225, z: gz }],
      3.4,
      1.0,
      0.28,
      0.27,
      0.26,
    );
  }
  for (let i = 0; i < streetX.length; i += 1) {
    const gx = TOWN_CENTER.x + streetX[i];
    addRoadRibbon(
      b,
      [{ x: gx, z: TOWN_CENTER.z - 220 }, { x: gx, z: TOWN_CENTER.z }, { x: gx, z: TOWN_CENTER.z + 250 }],
      3.4,
      1.0,
      0.28,
      0.27,
      0.26,
    );
  }
  for (let i = 0; i < TOWN_HOUSES.length; i += 1) {
    addHouse(b, TOWN_HOUSES[i]);
  }
  addTownChurch(b, TOWN_CENTER.x - 16, TOWN_CENTER.z - 68, 0.08);
  addTownSchool(b, TOWN_CENTER.x + 18, TOWN_CENTER.z + 24, 1.57);
  return b.toMesh();
}

// --- Smooth-Shaded Trees (3 Types) & Field-Edge Hedgerows ---

/** Smooth-shaded cone foliage tier with radial+upward smooth normals and bottom AO shading. */
function addSmoothCone(b, cx, botY, cz, h, radius, sides, r, g, bl, angleOffset = 0) {
  const topY = botY + h;
  const slopeLen = Math.hypot(radius, h) || 1;
  const nHoriz = h / slopeLen;
  const nVert = radius / slopeLen;

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

    // Smooth side face (darkened slightly at rim/underside for natural foliage depth)
    b.pushVert(cx, topY, cz, cm * 0.35, 0.94, sm * 0.35, r * 1.12, g * 1.12, bl * 1.10);
    b.pushVert(x1, botY, z1, c1 * nHoriz, nVert, s1 * nHoriz, r * 0.78, g * 0.78, bl * 0.80);
    b.pushVert(x0, botY, z0, c0 * nHoriz, nVert, s0 * nHoriz, r * 0.78, g * 0.78, bl * 0.80);

    // Underside cap
    b.pushVert(cx, botY, cz, 0, -1, 0, r * 0.45, g * 0.45, bl * 0.48);
    b.pushVert(x0, botY, z0, 0, -1, 0, r * 0.58, g * 0.58, bl * 0.60);
    b.pushVert(x1, botY, z1, 0, -1, 0, r * 0.58, g * 0.58, bl * 0.60);
  }
}

/** Smooth-shaded organic rounded canopy cluster with vertex-AO & subtle leaf-clump ripples. */
function addSmoothCanopy(b, cx, cy, cz, rx, ry, rz, r, g, bl, lonSegs = 9, latSegs = 4, phase = 0) {
  const vert = (lat, lon) => {
    const phi = (lat / latSegs) * Math.PI;
    const theta = (lon / lonSegs) * Math.PI * 2;
    const sp = Math.sin(phi);
    const ux = sp * Math.cos(theta);
    const uy = Math.cos(phi);
    const uz = sp * Math.sin(theta);

    // Subtle organic foliage bumpiness so canopies read as leafy clusters, not geometric spheres
    const lump = 1.0 + 0.085 * Math.sin(theta * 3.0 + phase) * Math.sin(phi * 2.0 + 0.7) + 0.05 * Math.cos(theta * 5.0 - phase);
    const nLen = Math.hypot(ux, uy * 1.05, uz) || 1;
    // Soft upward foliage normal bias mimics diffuse sky scattering in leaf crowns
    const nx = ux / nLen;
    const ny = (uy + 0.22) / Math.hypot(ux, uy + 0.22, uz);
    const nz = uz / nLen;
    // Bottom-to-top ambient occlusion shading inside canopy
    const ao = lerp(0.64, 1.12, smooth01((uy + 1.0) * 0.5));
    return {
      x: cx + ux * rx * lump,
      y: cy + uy * ry * lump,
      z: cz + uz * rz * lump,
      nx,
      ny,
      nz,
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

/** Type 1: Smooth-shaded conifer with cylindrical trunk + 3 layered smooth foliage cones. */
function addConiferTree(b, x, y, z, scale, shade, rot = 0) {
  addSmoothCylinder(b, x, y, z, 0.55 * scale, 0.24 * scale, 4.2 * scale, 6, 0.29, 0.20, 0.13);
  addSmoothCone(b, x, y + 2.5 * scale, z, 5.4 * scale, 3.8 * scale, 8, 0.13 * shade, 0.29 * shade, 0.15 * shade, rot);
  addSmoothCone(b, x, y + 5.1 * scale, z, 4.9 * scale, 3.0 * scale, 8, 0.16 * shade, 0.34 * shade, 0.17 * shade, rot + 0.42);
  addSmoothCone(b, x, y + 7.7 * scale, z, 4.4 * scale, 2.0 * scale, 8, 0.19 * shade, 0.39 * shade, 0.19 * shade, rot + 0.85);
}

/** Type 2: Broadleaf oak/deciduous with tapered cylindrical trunk + multi-lobe smooth canopy. */
function addBroadleafTree(b, x, y, z, scale, shade, rot = 0) {
  addSmoothCylinder(b, x, y, z, 0.56 * scale, 0.34 * scale, 4.6 * scale, 6, 0.31, 0.22, 0.14);
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const warmShift = (shade - 0.95) * 0.08;
  const cr = clamp((0.22 + warmShift) * shade, 0, 1);
  const cg = clamp(0.41 * shade, 0, 1);
  const cb = clamp(0.16 * shade, 0, 1);
  const cy = y + 6.0 * scale;
  addSmoothCanopy(b, x, cy, z, 3.6 * scale, 3.0 * scale, 3.5 * scale, cr, cg, cb, 9, 4, rot);
  addSmoothCanopy(
    b,
    x + c * 1.5 * scale,
    cy + 1.0 * scale,
    z - s * 1.5 * scale,
    2.6 * scale,
    2.2 * scale,
    2.5 * scale,
    cr * 1.06,
    cg * 1.06,
    cb * 1.04,
    8,
    4,
    rot + 1.1,
  );
  addSmoothCanopy(
    b,
    x - c * 1.3 * scale + s * 1.0 * scale,
    cy - 0.2 * scale,
    z + s * 1.3 * scale + c * 1.0 * scale,
    2.4 * scale,
    2.0 * scale,
    2.4 * scale,
    cr * 0.92,
    cg * 0.94,
    cb * 0.95,
    8,
    4,
    rot + 2.3,
  );
}

/** Type 3: Tall slender poplar / cypress with smooth oval crown. */
function addPoplarTree(b, x, y, z, scale, shade, rot = 0) {
  addSmoothCylinder(b, x, y, z, 0.44 * scale, 0.24 * scale, 3.8 * scale, 6, 0.30, 0.22, 0.15);
  const cr = 0.19 * shade;
  const cg = 0.38 * shade;
  const cb = 0.17 * shade;
  addSmoothCanopy(b, x, y + 5.4 * scale, z, 2.3 * scale, 3.6 * scale, 2.3 * scale, cr, cg, cb, 8, 4, rot);
  addSmoothCanopy(b, x, y + 8.6 * scale, z, 1.7 * scale, 3.2 * scale, 1.7 * scale, cr * 1.06, cg * 1.06, cb * 1.04, 8, 4, rot + 1.5);
}

function isTreeForbidden(x, z) {
  // Airfield plateau (runway, apron, hangar, tower)
  if (Math.abs(x) < 116 && z > -355 && z < 390) return true;
  // Runway 36 final-approach clearway
  if (Math.abs(x) < 44 && z >= 320 && z < 1150) return true;
  // River channel & immediate banks
  if (z > -1850 && Math.abs(x - riverCenterX(z)) < riverHalfWidth(z) + 26) return true;
  // Village roads & farm tracks
  if (isNearRoad(x, z, 9.5)) return true;
  // Town street grid
  if (Math.abs(x - TOWN_CENTER.x) < 250 && Math.abs(z - TOWN_CENTER.z) < 255) {
    for (let i = 0; i < TOWN_HOUSES.length; i += 1) {
      const th = TOWN_HOUSES[i];
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

function addHedgerowSegment(b, ax, az, bx, bz, random) {
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz);
  if (len < 10) return;
  const shrubs = Math.max(4, Math.floor(len / 14));
  for (let i = 0; i <= shrubs; i += 1) {
    if (i === Math.floor(shrubs * 0.5) && random() < 0.55) continue;
    const t = i / shrubs;
    const jx = (random() - 0.5) * 2.4;
    const jz = (random() - 0.5) * 2.4;
    const x = ax + dx * t + jx;
    const z = az + dz * t + jz;
    if (isTreeForbidden(x, z)) continue;
    const h = sampleMeshHeight(x, z);
    const ny = terrainNormalY(x, z);
    if (h < 2.6 || h > 52 || ny < 0.82) continue;

    const shade = 0.85 + random() * 0.25;
    const rx = 2.6 + random() * 1.4;
    const ry = 1.6 + random() * 0.9;
    const rz = 2.6 + random() * 1.4;
    addSmoothCanopy(b, x, h + ry * 0.45, z, rx, ry, rz, 0.15 * shade, 0.34 * shade, 0.14 * shade, 7, 3, random() * 6);

    if (random() < 0.18) {
      const scale = 0.8 + random() * 0.45;
      if (random() < 0.65) addBroadleafTree(b, x, h - 0.2, z, scale, shade, random() * Math.PI * 2);
      else addPoplarTree(b, x, h - 0.2, z, scale, shade, random() * Math.PI * 2);
    }
  }
}

export function buildTreesMesh(random) {
  const b = createBuilder();

  // 1. Field-edge hedgerows across the agricultural valley & river bend
  const cellMinX = -9;
  const cellMaxX = 9;
  const cellMinZ = -8;
  const cellMaxZ = 11;
  for (let cz = cellMinZ; cz <= cellMaxZ; cz += 1) {
    for (let cx = cellMinX; cx <= cellMaxX; cx += 1) {
      const worldApproxZ = cz * FIELD_H;
      const prob = worldApproxZ > 240 ? 0.56 : 0.46;
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

  // 2. Zoned woodland placement across the 10,400m world (~620 general + ~420 dense forest + ~125 town/wetland)
  let placed = 0;
  let attempts = 0;
  while (placed < 620 && attempts < 8400) {
    attempts += 1;
    const x = (random() * 2 - 1) * (WORLD.half - 240);
    const z = (random() * 2 - 1) * (WORLD.half - 240);
    if (isTreeForbidden(x, z)) continue;
    const h = sampleMeshHeight(x, z);
    const ny = terrainNormalY(x, z);
    if (h < 2.8 || h > 155 || ny < 0.74) continue;
    const zones = sampleZoneWeights(x, z);
    const cluster = valueNoise2D(x * 0.0022, z * 0.0022, 404);
    const threshold = lerp(0.46, 0.24, zones.forest) + zones.mountain * 0.16;
    if (cluster < threshold) continue;

    const scale = 0.85 + random() * 0.80;
    const shade = (0.86 + random() * 0.26) * lerp(1.0, 0.82, zones.forest);
    const rot = random() * Math.PI * 2;
    const typeRoll = random();
    if (zones.wetland > 0.45 && h < 8) {
      addSmoothCanopy(b, x, h + 1.4, z, 2.8 * scale, 1.9 * scale, 2.8 * scale, 0.17 * shade, 0.34 * shade, 0.16 * shade, 7, 3, rot);
    } else if (h > 50 || zones.mountain > 0.4 || typeRoll < lerp(0.45, 0.72, zones.forest)) {
      addConiferTree(b, x, h - 0.25, z, scale, shade, rot);
    } else if (typeRoll < 0.84) {
      addBroadleafTree(b, x, h - 0.25, z, scale, shade, rot);
    } else {
      addPoplarTree(b, x, h - 0.25, z, scale, shade, rot);
    }
    placed += 1;
  }

  // 2b. Dense Emerald Forest zone (East & Northeast, ~420 darker clustered trees)
  let forestPlaced = 0;
  let forestAttempts = 0;
  while (forestPlaced < 420 && forestAttempts < 4200) {
    forestAttempts += 1;
    const x = 820 + random() * 3400;
    const z = -1950 + random() * 2900;
    if (isTreeForbidden(x, z)) continue;
    const h = sampleMeshHeight(x, z);
    const ny = terrainNormalY(x, z);
    if (h < 4.0 || h > 135 || ny < 0.72) continue;
    const zones = sampleZoneWeights(x, z);
    if (zones.forest < 0.25) continue;

    const scale = 0.90 + random() * 0.85;
    const shade = 0.72 + random() * 0.24;
    const rot = random() * Math.PI * 2;
    if (random() < 0.74) addConiferTree(b, x, h - 0.25, z, scale, shade, rot);
    else addBroadleafTree(b, x, h - 0.25, z, scale, shade, rot);
    forestPlaced += 1;
  }

  // 3. Extra groves flanking the final-approach corridor & title-screen backdrop (~190)
  let corridorPlaced = 0;
  let corridorAttempts = 0;
  while (corridorPlaced < 190 && corridorAttempts < 2400) {
    corridorAttempts += 1;
    const side = random() < 0.5 ? -1 : 1;
    const x = side * (46 + random() * 480);
    const z = 340 + random() * 1400;
    if (isTreeForbidden(x, z)) continue;
    const h = sampleMeshHeight(x, z);
    const ny = terrainNormalY(x, z);
    if (h < 3.5 || h > 60 || ny < 0.84) continue;
    if (valueNoise2D(x * 0.004, z * 0.004, 515) < 0.34) continue;

    const scale = 0.85 + random() * 0.65;
    const shade = 0.88 + random() * 0.24;
    const rot = random() * Math.PI * 2;
    const typeRoll = random();
    if (typeRoll < 0.36) addConiferTree(b, x, h - 0.25, z, scale, shade, rot);
    else if (typeRoll < 0.78) addBroadleafTree(b, x, h - 0.25, z, scale, shade, rot);
    else addPoplarTree(b, x, h - 0.25, z, scale, shade, rot);
    corridorPlaced += 1;
  }

  // 4. Village & Oakwood Town garden/avenue trees (~135)
  let villagePlaced = 0;
  let villageAttempts = 0;
  while (villagePlaced < 135 && villageAttempts < 1800) {
    villageAttempts += 1;
    const inTown = villagePlaced >= 60;
    const x = inTown ? TOWN_CENTER.x + (random() * 2 - 1) * 260 : -325 + random() * 195;
    const z = inTown ? TOWN_CENTER.z + (random() * 2 - 1) * 260 : -85 + random() * 290;
    if (isTreeForbidden(x, z)) continue;
    const h = sampleMeshHeight(x, z);
    if (h < 4 || h > 45) continue;

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
    const cy = 420 + random() * 230;
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
