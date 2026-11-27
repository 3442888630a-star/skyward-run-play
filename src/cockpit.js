// First-person cockpit 3D geometry (nose cowl, windshield pillars, glareshield, charcoal panel,
// twin-grip yoke) and crisp 1024x512 live Canvas instrument cluster (6-pack + auxiliary fuel).

import { MODE_FREE, MISSION_RINGS, PLANE } from './config.js';
import { clamp, lerp } from './math.js';

export const COCKPIT_EYE = { x: 0, y: 0.66, z: -1.10 };
export const COCKPIT_LOOK_PITCH = -0.098;

// Textured instrument face bounds in aircraft-local coordinates (2:1 aspect matching 1024x512)
const PANEL_Z = -1.72;
const FACE_HALF_W = 0.36;
const FACE_Y_MIN = 0.12;
const FACE_Y_MAX = 0.48;

const MAT_TRIM = [0.16, 0.64, 0.0];
const MAT_CHARCOAL = [0.14, 0.72, 0.0];
const MAT_LEATHER = [0.22, 0.58, 0.0];
const MAT_COWL = [0.46, 0.24, 0.0];
const MAT_ANTIGLARE = [0.08, 0.78, 0.0];
const MAT_YOKE = [0.22, 0.55, 0.0];
const MAT_METAL = [0.80, 0.18, 0.0];

const COL_PILLAR = [0.82, 0.78, 0.72];
const COL_PANEL = [0.13, 0.13, 0.15];
const COL_GLARESHIELD = [0.09, 0.09, 0.11];
const COL_COWL = [0.95, 0.91, 0.82];
const COL_ANTIGLARE = [0.11, 0.12, 0.14];
const COL_RED = [0.68, 0.12, 0.11];
const COL_YOKE = [0.06, 0.06, 0.075];
const COL_YOKE_ACCENT = [0.18, 0.19, 0.22];

function createCockpitBuilder() {
  const pos = [];
  const norm = [];
  const col = [];
  const uv = [];
  const mat = [];

  function pushVert(x, y, z, nx, ny, nz, c, m, u = 0, v = 0) {
    pos.push(x, y, z);
    norm.push(nx, ny, nz);
    col.push(c[0], c[1], c[2]);
    uv.push(u, v);
    mat.push(m[0], m[1], m[2]);
  }

  function triFlat(ax, ay, az, bx, by, bz, cx, cy, cz, c, m) {
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
    pushVert(ax, ay, az, nx, ny, nz, c, m);
    pushVert(bx, by, bz, nx, ny, nz, c, m);
    pushVert(cx, cy, cz, nx, ny, nz, c, m);
  }

  function quadFlat(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, c, m) {
    triFlat(ax, ay, az, bx, by, bz, cx, cy, cz, c, m);
    triFlat(ax, ay, az, cx, cy, cz, dx, dy, dz, c, m);
  }

  function addBox(x0, y0, z0, x1, y1, z1, c, m) {
    // +Z (toward pilot), -Z (forward), +X, -X, +Y, -Y
    quadFlat(x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1, c, m);
    quadFlat(x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0, c, m);
    quadFlat(x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y1, z1, c, m);
    quadFlat(x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0, c, m);
    quadFlat(x0, y1, z1, x1, y1, z1, x1, y1, z0, x0, y1, z0, c, m);
    quadFlat(x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1, c, m);
  }

  function addTube(p0, p1, rx, ry, segs, c, m) {
    const dx = p1[0] - p0[0];
    const dy = p1[1] - p0[1];
    const dz = p1[2] - p0[2];
    const len = Math.hypot(dx, dy, dz) || 1;
    const dir = [dx / len, dy / len, dz / len];
    const ref = Math.abs(dir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let ux = dir[1] * ref[2] - dir[2] * ref[1];
    let uy = dir[2] * ref[0] - dir[0] * ref[2];
    let uz = dir[0] * ref[1] - dir[1] * ref[0];
    const ulen = Math.hypot(ux, uy, uz) || 1;
    ux /= ulen;
    uy /= ulen;
    uz /= ulen;
    const vx = dir[1] * uz - dir[2] * uy;
    const vy = dir[2] * ux - dir[0] * uz;
    const vz = dir[0] * uy - dir[1] * ux;

    const ring0 = [];
    const ring1 = [];
    for (let i = 0; i <= segs; i += 1) {
      const a = (i / segs) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const nx = ux * ca + vx * sa;
      const ny = uy * ca + vy * sa;
      const nz = uz * ca + vz * sa;
      const nLen = Math.hypot(nx, ny, nz) || 1;
      const ox = ux * ca * rx + vx * sa * ry;
      const oy = uy * ca * rx + vy * sa * ry;
      const oz = uz * ca * rx + vz * sa * ry;
      ring0.push({ x: p0[0] + ox, y: p0[1] + oy, z: p0[2] + oz, nx: nx / nLen, ny: ny / nLen, nz: nz / nLen });
      ring1.push({ x: p1[0] + ox, y: p1[1] + oy, z: p1[2] + oz, nx: nx / nLen, ny: ny / nLen, nz: nz / nLen });
    }
    for (let i = 0; i < segs; i += 1) {
      const a = ring0[i];
      const b = ring1[i];
      const c1 = ring1[i + 1];
      const d = ring0[i + 1];
      pushVert(a.x, a.y, a.z, a.nx, a.ny, a.nz, c, m);
      pushVert(b.x, b.y, b.z, b.nx, b.ny, b.nz, c, m);
      pushVert(c1.x, c1.y, c1.z, c1.nx, c1.ny, c1.nz, c, m);
      pushVert(a.x, a.y, a.z, a.nx, a.ny, a.nz, c, m);
      pushVert(c1.x, c1.y, c1.z, c1.nx, c1.ny, c1.nz, c, m);
      pushVert(d.x, d.y, d.z, d.nx, d.ny, d.nz, c, m);
    }
  }

  function toMesh() {
    return {
      positions: new Float32Array(pos),
      normals: new Float32Array(norm),
      colors: new Float32Array(col),
      uvs: new Float32Array(uv),
      materials: new Float32Array(mat),
      vertexCount: pos.length / 3,
    };
  }

  return { pushVert, triFlat, quadFlat, addBox, addTube, toMesh };
}

/** Build the exterior nose cowling visible out the bottom of the windshield (main depth pass). */
export function buildCockpitCowlMesh() {
  const b = createCockpitBuilder();
  const cowlStations = [
    { z: -3.14, rx: 0.26, ryTop: 0.29, yc: 0.04 },
    { z: -3.02, rx: 0.44, ryTop: 0.39, yc: 0.02 },
    { z: -2.65, rx: 0.58, ryTop: 0.46, yc: 0.00 },
    { z: -2.06, rx: 0.64, ryTop: 0.49, yc: -0.01 },
    { z: -1.88, rx: 0.66, ryTop: 0.51, yc: 0.00 },
  ];
  const radSteps = 28;
  const grid = [];
  for (let s = 0; s < cowlStations.length; s += 1) {
    const st = cowlStations[s];
    const row = [];
    for (let i = 0; i <= radSteps; i += 1) {
      const theta = ((i / radSteps) * 2 - 1) * (Math.PI * 0.62);
      const x = Math.sin(theta) * st.rx;
      const y = st.yc + Math.cos(theta) * st.ryTop;
      const nx = Math.sin(theta) / st.rx;
      const ny = Math.cos(theta) / st.ryTop;
      const nLen = Math.hypot(nx, ny) || 1;
      row.push({ x, y, z: st.z, nx: nx / nLen, ny: ny / nLen, nz: -0.08, theta });
    }
    grid.push(row);
  }
  for (let s = 0; s < cowlStations.length - 1; s += 1) {
    for (let i = 0; i < radSteps; i += 1) {
      const a = grid[s][i];
      const d = grid[s][i + 1];
      const c1 = grid[s + 1][i + 1];
      const b1 = grid[s + 1][i];
      const thMid = Math.abs(a.theta + d.theta) * 0.5;
      const isAntiGlare = thMid < 0.44;
      const isStripe = thMid >= 0.85 && thMid < 1.05;
      const c = isAntiGlare ? COL_ANTIGLARE : isStripe ? COL_RED : COL_COWL;
      const m = isAntiGlare ? MAT_ANTIGLARE : MAT_COWL;
      b.pushVert(a.x, a.y, a.z, a.nx, a.ny, a.nz, c, m);
      b.pushVert(b1.x, b1.y, b1.z, b1.nx, b1.ny, b1.nz, c, m);
      b.pushVert(c1.x, c1.y, c1.z, c1.nx, c1.ny, c1.nz, c, m);
      b.pushVert(a.x, a.y, a.z, a.nx, a.ny, a.nz, c, m);
      b.pushVert(c1.x, c1.y, c1.z, c1.nx, c1.ny, c1.nz, c, m);
      b.pushVert(d.x, d.y, d.z, d.nx, d.ny, d.nz, c, m);
    }
  }
  return b.toMesh();
}

/** Build the cockpit interior structure (panel surround, glareshield, windshield pillars). */
export function buildCockpitFrameMesh() {
  const b = createCockpitBuilder();

  // 1. Dark charcoal lower/outer instrument panel surround (covers wide FOV safely)
  b.addBox(-0.88, -0.05, -1.78, 0.88, 0.468, PANEL_Z - 0.006, COL_PANEL, MAT_CHARCOAL);

  // Side bolsters & lower kick panels
  b.addBox(-0.88, -0.05, -1.76, -0.68, 0.50, -1.05, [0.16, 0.16, 0.18], MAT_TRIM);
  b.addBox(0.68, -0.05, -1.76, 0.88, 0.50, -1.05, [0.16, 0.16, 0.18], MAT_TRIM);

  // 2. Curved padded glareshield overhanging the panel top
  const gsSegs = 20;
  for (let i = 0; i < gsSegs; i += 1) {
    const t0 = (i / gsSegs) * 2 - 1;
    const t1 = ((i + 1) / gsSegs) * 2 - 1;
    const x0 = t0 * 0.72;
    const x1 = t1 * 0.72;
    const y0 = 0.486 - t0 * t0 * 0.042;
    const y1 = 0.486 - t1 * t1 * 0.042;
    b.quadFlat(x0, y0 - 0.015, -1.66, x1, y1 - 0.015, -1.66, x1, y1, -1.69, x0, y0, -1.69, COL_GLARESHIELD, MAT_LEATHER);
    b.quadFlat(x0, y0, -1.69, x1, y1, -1.69, x1, y1 - 0.008, -1.88, x0, y0 - 0.008, -1.88, COL_GLARESHIELD, MAT_LEATHER);
    b.quadFlat(x0, y0 - 0.025, -1.72, x1, y1 - 0.025, -1.72, x1, y1 - 0.015, -1.66, x0, y0 - 0.015, -1.66, [0.06, 0.06, 0.07], MAT_CHARCOAL);
  }

  // 3. Windshield frame: Left A-pillar, Right A-pillar, off-center divider strut, and upper roof brow
  b.addTube([-0.49, 0.43, -1.76], [-0.41, 0.90, -1.48], 0.036, 0.044, 10, COL_PILLAR, MAT_TRIM);
  b.addTube([0.49, 0.43, -1.76], [0.41, 0.90, -1.48], 0.036, 0.044, 10, COL_PILLAR, MAT_TRIM);
  b.addTube([0.165, 0.46, -1.78], [0.215, 0.89, -1.50], 0.014, 0.018, 8, [0.24, 0.24, 0.26], MAT_TRIM);
  b.addBox(-0.62, 0.85, -1.56, 0.62, 0.95, -1.24, [0.26, 0.25, 0.24], MAT_TRIM);

  return b.toMesh();
}

/** Build the textured instrument panel quad that displays the live 6-pack + fuel gauge. */
export function buildCockpitFaceMesh() {
  const b = createCockpitBuilder();
  const z = PANEL_Z;
  const x0 = -FACE_HALF_W;
  const x1 = FACE_HALF_W;
  const y0 = FACE_Y_MIN;
  const y1 = FACE_Y_MAX;
  const c = [1, 1, 1];
  const m = [0.18, 0.60, 0.25];
  // V=1 at bottom, V=0 at top for standard canvas texture orientation in WebGL
  b.pushVert(x0, y0, z, 0, 0, 1, c, m, 0, 1);
  b.pushVert(x1, y0, z, 0, 0, 1, c, m, 1, 1);
  b.pushVert(x1, y1, z, 0, 0, 1, c, m, 1, 0);

  b.pushVert(x0, y0, z, 0, 0, 1, c, m, 0, 1);
  b.pushVert(x1, y1, z, 0, 0, 1, c, m, 1, 0);
  b.pushVert(x0, y1, z, 0, 0, 1, c, m, 0, 0);
  return b.toMesh();
}

/** Build the twin-grip Cessna-style control yoke centered around origin (mounted in front of panel). */
export function buildYokeMesh() {
  const b = createCockpitBuilder();
  // Steering shaft extending forward into panel
  b.addTube([0, 0, 0.02], [0, -0.02, -0.26], 0.022, 0.022, 12, COL_YOKE_ACCENT, MAT_METAL);
  // Center hub housing
  b.addBox(-0.044, -0.036, -0.015, 0.044, 0.034, 0.032, COL_YOKE, MAT_YOKE);
  // Subtle emblem plate on hub
  b.addBox(-0.024, -0.012, 0.032, 0.024, 0.016, 0.036, [0.22, 0.21, 0.20], MAT_METAL);

  // Sweeping lower crossbar + twin left/right upright grips
  for (const side of [-1, 1]) {
    b.addTube([side * 0.036, -0.015, 0.008], [side * 0.105, -0.005, 0.010], 0.015, 0.015, 10, COL_YOKE, MAT_YOKE);
    b.addTube([side * 0.105, -0.005, 0.010], [side * 0.118, 0.055, 0.016], 0.016, 0.016, 10, COL_YOKE, MAT_YOKE);
    b.addTube([side * 0.118, 0.055, 0.016], [side * 0.110, 0.095, 0.014], 0.014, 0.014, 10, COL_YOKE, MAT_YOKE);
  }
  return b.toMesh();
}

/** Create the 1024x512 live Canvas instrument texture updater. */
export function createCockpitGaugeRenderer() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  // Pre-build static charcoal panel background with warm sunset top gradient & subtle noise grain
  const bgCanvas = document.createElement('canvas');
  bgCanvas.width = 1024;
  bgCanvas.height = 512;
  const bctx = bgCanvas.getContext('2d');

  const panelGrad = bctx.createLinearGradient(0, 0, 0, 512);
  panelGrad.addColorStop(0.0, '#3a2e28'); // Warm sunlit top edge under glareshield
  panelGrad.addColorStop(0.24, '#272426');
  panelGrad.addColorStop(0.65, '#1d1e22');
  panelGrad.addColorStop(1.0, '#141519');
  bctx.fillStyle = panelGrad;
  bctx.fillRect(0, 0, 1024, 512);

  // Subtle warm sunset key light wash from upper-left (sun direction)
  const sunWash = bctx.createRadialGradient(220, 40, 20, 280, 90, 540);
  sunWash.addColorStop(0, 'rgba(255, 178, 96, 0.20)');
  sunWash.addColorStop(0.55, 'rgba(235, 130, 62, 0.07)');
  sunWash.addColorStop(1, 'rgba(0, 0, 0, 0)');
  bctx.fillStyle = sunWash;
  bctx.fillRect(0, 0, 1024, 512);

  // Subtle panel bevel lines & decorative avionics stack on right side
  bctx.strokeStyle = 'rgba(255, 220, 175, 0.08)';
  bctx.lineWidth = 2;
  bctx.strokeRect(210, 16, 590, 354);

  // Right-side radio/nav stack aesthetic (matching ref-cockpit layout)
  bctx.fillStyle = '#121317';
  bctx.fillRect(816, 26, 188, 336);
  bctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
  bctx.lineWidth = 2;
  bctx.strokeRect(816, 26, 188, 336);
  for (let r = 0; r < 3; r += 1) {
    const ry = 40 + r * 106;
    bctx.fillStyle = '#0b0c10';
    bctx.fillRect(828, ry, 164, 92);
    bctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
    bctx.strokeRect(828, ry, 164, 92);
    bctx.fillStyle = '#17221c';
    bctx.fillRect(840, ry + 14, 108, 30);
    bctx.font = '700 16px ui-monospace, monospace';
    bctx.fillStyle = r === 0 ? '#ffae48' : '#64e29a';
    bctx.textAlign = 'left';
    bctx.textBaseline = 'middle';
    bctx.fillText(r === 0 ? 'COM 121.50' : r === 1 ? 'NAV 114.80' : 'XPDR 1200', 846, ry + 29);
    // Small knobs
    for (let k = 0; k < 4; k += 1) {
      bctx.beginPath();
      bctx.arc(848 + k * 34, ry + 68, 7, 0, Math.PI * 2);
      bctx.fillStyle = '#25272d';
      bctx.fill();
      bctx.strokeStyle = 'rgba(255,255,255,0.22)';
      bctx.stroke();
    }
  }

  function drawBezel(cx, cy, r) {
    // Outer machined mounting plate + corner screws
    bctx.save();
    bctx.fillStyle = '#15161a';
    const sq = r + 10;
    bctx.beginPath();
    bctx.roundRect(cx - sq, cy - sq, sq * 2, sq * 2, 16);
    bctx.fill();
    bctx.strokeStyle = 'rgba(255, 214, 168, 0.14)';
    bctx.lineWidth = 1.5;
    bctx.stroke();
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        bctx.beginPath();
        bctx.arc(cx + sx * (r - 2), cy + sy * (r - 2), 3.2, 0, Math.PI * 2);
        bctx.fillStyle = '#3a3c42';
        bctx.fill();
      }
    }
    bctx.restore();
  }

  // Layout matching ref-cockpit:
  // Top row: Airspeed (305, 106), Attitude (505, 106), Altimeter (705, 106)
  // Bottom row: RPM/Throttle (305, 282), Heading (505, 282), Vertical Speed (705, 282)
  // Left aux: Fuel gauge (116, 126)
  const R = 80;
  const R_AUX = 52;
  const centers = [
    [305, 106, R],
    [505, 106, R],
    [705, 106, R],
    [305, 282, R],
    [505, 282, R],
    [705, 282, R],
    [116, 126, R_AUX],
  ];
  for (const [cx, cy, rad] of centers) drawBezel(cx, cy, rad);

  function beginDial(cx, cy, r) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = '#0d0f13';
    ctx.fill();
    ctx.clip();
  }

  function finishDial(cx, cy, r) {
    ctx.restore();
    // Subtle diagonal glass reflection streak (keeps ticks/needles crisp)
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r - 1, 0, Math.PI * 2);
    ctx.clip();
    const gloss = ctx.createLinearGradient(cx - r, cy - r, cx + r * 0.6, cy + r * 0.6);
    gloss.addColorStop(0.0, 'rgba(255, 240, 210, 0.14)');
    gloss.addColorStop(0.34, 'rgba(255, 240, 210, 0.05)');
    gloss.addColorStop(0.36, 'rgba(255, 245, 225, 0.15)');
    gloss.addColorStop(0.46, 'rgba(255, 245, 225, 0.02)');
    gloss.addColorStop(1.0, 'rgba(0, 0, 0, 0.16)');
    ctx.fillStyle = gloss;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.restore();

    // Inner bezel lip
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 214, 168, 0.34)';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  function drawNeedle(cx, cy, angleRad, len, backLen = 16, width = 3.2, color = '#f8f6f0') {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angleRad);
    ctx.shadowColor = 'rgba(0,0,0,0.7)';
    ctx.shadowBlur = 4;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-backLen, -width * 0.6);
    ctx.lineTo(len - 8, -width * 0.35);
    ctx.lineTo(len, 0);
    ctx.lineTo(len - 8, width * 0.35);
    ctx.lineTo(-backLen, width * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, 7.5, 0, Math.PI * 2);
    ctx.fillStyle = '#252830';
    ctx.fill();
    ctx.strokeStyle = '#9aa2ad';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  function drawAirspeed(cx, cy, r, kts, isStalling) {
    beginDial(cx, cy, r);
    const minK = 20;
    const maxK = 160;
    const startA = -Math.PI * 0.5 + 0.35;
    const spanA = Math.PI * 2 - 0.70;
    const kToA = (k) => startA + clamp((k - minK) / (maxK - minK), 0, 1) * spanA;

    // Color operating arcs
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#d9443c';
    ctx.beginPath();
    ctx.arc(cx, cy, r - 9, kToA(20), kToA(45));
    ctx.stroke();
    ctx.strokeStyle = '#4ad278';
    ctx.beginPath();
    ctx.arc(cx, cy, r - 9, kToA(45), kToA(130));
    ctx.stroke();
    ctx.strokeStyle = '#f6be44';
    ctx.beginPath();
    ctx.arc(cx, cy, r - 9, kToA(130), kToA(155));
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 13px ui-monospace, monospace';
    for (let k = 20; k <= 160; k += 10) {
      const a = kToA(k);
      const major = k % 20 === 0;
      ctx.strokeStyle = major ? '#f4f1ea' : 'rgba(244,241,234,0.45)';
      ctx.lineWidth = major ? 2 : 1.2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (r - (major ? 16 : 11)), cy + Math.sin(a) * (r - (major ? 16 : 11)));
      ctx.lineTo(cx + Math.cos(a) * (r - 4), cy + Math.sin(a) * (r - 4));
      ctx.stroke();
      if (major) {
        ctx.fillStyle = '#f4f1ea';
        ctx.fillText(String(k), cx + Math.cos(a) * (r - 27), cy + Math.sin(a) * (r - 27));
      }
    }
    ctx.font = '700 10px system-ui, sans-serif';
    ctx.fillStyle = '#a8b3c2';
    ctx.fillText('AIRSPEED', cx, cy - 22);
    ctx.fillText('KNOTS', cx, cy + 28);
    ctx.font = '700 12px ui-monospace, monospace';
    ctx.fillStyle = isStalling ? '#ff5d55' : '#ffbe55';
    ctx.fillText(`${Math.round(kts)} KT`, cx, cy + 43);

    drawNeedle(cx, cy, kToA(kts), r - 14, 15, 3.4, isStalling ? '#ff5d55' : '#f8f6f0');
    finishDial(cx, cy, r);
  }

  function drawAttitude(cx, cy, r, pitchRad, rollRad) {
    beginDial(cx, cy, r);
    const pitchPx = clamp((pitchRad * 180) / Math.PI, -40, 40) * 1.9;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-rollRad);

    const skyGrad = ctx.createLinearGradient(0, -r * 2 + pitchPx, 0, pitchPx);
    skyGrad.addColorStop(0, '#1e4a7a');
    skyGrad.addColorStop(1, '#5897cb');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(-r * 2, -r * 3 + pitchPx, r * 4, r * 3);

    const gndGrad = ctx.createLinearGradient(0, pitchPx, 0, r * 2 + pitchPx);
    gndGrad.addColorStop(0, '#8d5932');
    gndGrad.addColorStop(1, '#3d2210');
    ctx.fillStyle = gndGrad;
    ctx.fillRect(-r * 2, pitchPx, r * 4, r * 3);

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(-r * 1.6, pitchPx);
    ctx.lineTo(r * 1.6, pitchPx);
    ctx.stroke();

    for (const deg of [-20, -10, 10, 20]) {
      const py = pitchPx - deg * 1.9;
      const hw = Math.abs(deg) === 20 ? 22 : 14;
      ctx.strokeStyle = 'rgba(255,255,255,0.88)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(-hw, py);
      ctx.lineTo(-4, py);
      ctx.moveTo(4, py);
      ctx.lineTo(hw, py);
      ctx.stroke();
    }

    // Dynamic bank pointer
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -r + 12);
    ctx.lineTo(-5, -r + 20);
    ctx.lineTo(5, -r + 20);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Fixed roll bezel ticks
    ctx.save();
    ctx.translate(cx, cy);
    for (const deg of [-45, -30, -15, 0, 15, 30, 45]) {
      const a = (deg * Math.PI) / 180 - Math.PI * 0.5;
      ctx.strokeStyle = deg === 0 ? '#ffbe55' : 'rgba(255,255,255,0.8)';
      ctx.lineWidth = deg === 0 ? 2.2 : 1.4;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * (r - 10), Math.sin(a) * (r - 10));
      ctx.lineTo(Math.cos(a) * (r - 2), Math.sin(a) * (r - 2));
      ctx.stroke();
    }
    // Fixed orange/amber aircraft reference symbol
    ctx.strokeStyle = '#ffbe55';
    ctx.lineWidth = 3.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-26, 0);
    ctx.lineTo(-9, 0);
    ctx.lineTo(-4, 6);
    ctx.moveTo(26, 0);
    ctx.lineTo(9, 0);
    ctx.lineTo(4, 6);
    ctx.stroke();
    ctx.fillStyle = '#ffbe55';
    ctx.beginPath();
    ctx.arc(0, 0, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    finishDial(cx, cy, r);
  }

  function drawAltimeter(cx, cy, r, altFt) {
    beginDial(cx, cy, r);
    const safeAlt = Math.max(0, altFt);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < 50; i += 1) {
      const a = (i / 50) * Math.PI * 2 - Math.PI * 0.5;
      const major = i % 5 === 0;
      ctx.strokeStyle = major ? '#f4f1ea' : 'rgba(244,241,234,0.45)';
      ctx.lineWidth = major ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (r - (major ? 14 : 9)), cy + Math.sin(a) * (r - (major ? 14 : 9)));
      ctx.lineTo(cx + Math.cos(a) * (r - 4), cy + Math.sin(a) * (r - 4));
      ctx.stroke();
      if (major) {
        ctx.font = '700 15px ui-monospace, monospace';
        ctx.fillStyle = '#f4f1ea';
        ctx.fillText(String(i / 5), cx + Math.cos(a) * (r - 25), cy + Math.sin(a) * (r - 25));
      }
    }
    ctx.font = '700 10px system-ui, sans-serif';
    ctx.fillStyle = '#a8b3c2';
    ctx.fillText('ALT', cx, cy - 22);
    ctx.fillText('100 FT', cx, cy + 22);
    ctx.fillStyle = '#181c24';
    ctx.fillRect(cx - 28, cy + 31, 56, 17);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1;
    ctx.strokeRect(cx - 28, cy + 31, 56, 17);
    ctx.font = '700 11px ui-monospace, monospace';
    ctx.fillStyle = '#ffbe55';
    ctx.fillText(`${Math.round(altFt)}`, cx, cy + 40);

    // 1000-ft short broad hand & 100-ft long hand
    const thousandsA = ((safeAlt / 10000) % 1) * Math.PI * 2 - Math.PI * 0.5;
    const hundredsA = ((safeAlt / 1000) % 1) * Math.PI * 2 - Math.PI * 0.5;
    drawNeedle(cx, cy, thousandsA, r * 0.56, 10, 5.2, '#d8dde6');
    drawNeedle(cx, cy, hundredsA, r - 12, 16, 3.0, '#ffffff');
    finishDial(cx, cy, r);
  }

  function drawRpmGauge(cx, cy, r, rpmVal, throttle) {
    beginDial(cx, cy, r);
    const startA = Math.PI * 0.75;
    const spanA = Math.PI * 1.5;
    const rToA = (v) => startA + clamp(v / 30, 0, 1) * spanA;

    ctx.lineWidth = 6;
    ctx.strokeStyle = '#4ad278';
    ctx.beginPath();
    ctx.arc(cx, cy, r - 9, rToA(18), rToA(26));
    ctx.stroke();
    ctx.strokeStyle = '#ff5d55';
    ctx.beginPath();
    ctx.arc(cx, cy, r - 9, rToA(27), rToA(30));
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let v = 0; v <= 30; v += 2.5) {
      const a = rToA(v);
      const major = v % 5 === 0;
      ctx.strokeStyle = major ? '#f4f1ea' : 'rgba(244,241,234,0.45)';
      ctx.lineWidth = major ? 2 : 1.2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (r - (major ? 15 : 10)), cy + Math.sin(a) * (r - (major ? 15 : 10)));
      ctx.lineTo(cx + Math.cos(a) * (r - 4), cy + Math.sin(a) * (r - 4));
      ctx.stroke();
      if (major) {
        ctx.font = '700 13px ui-monospace, monospace';
        ctx.fillStyle = '#f4f1ea';
        ctx.fillText(String(v), cx + Math.cos(a) * (r - 26), cy + Math.sin(a) * (r - 26));
      }
    }
    ctx.font = '700 10px system-ui, sans-serif';
    ctx.fillStyle = '#a8b3c2';
    ctx.fillText('RPM ×100', cx, cy - 20);
    ctx.font = '700 12px ui-monospace, monospace';
    ctx.fillStyle = '#ffbe55';
    ctx.fillText(`THR ${Math.round(throttle * 100)}%`, cx, cy + 38);

    drawNeedle(cx, cy, rToA(rpmVal / 100), r - 14, 14, 3.2, '#ffffff');
    finishDial(cx, cy, r);
  }

  function drawHeadingIndicator(cx, cy, r, headingRad, targetBrgRad) {
    beginDial(cx, cy, r);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-headingRad);

    const cardLabels = new Map([
      [0, 'N'],
      [30, '3'],
      [60, '6'],
      [90, 'E'],
      [120, '12'],
      [150, '15'],
      [180, 'S'],
      [210, '21'],
      [240, '24'],
      [270, 'W'],
      [300, '30'],
      [330, '33'],
    ]);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let deg = 0; deg < 360; deg += 10) {
      const a = (deg * Math.PI) / 180 - Math.PI * 0.5;
      const major = deg % 30 === 0;
      ctx.strokeStyle = deg === 0 ? '#6ae67b' : major ? '#f4f1ea' : 'rgba(244,241,234,0.45)';
      ctx.lineWidth = major ? 2 : 1.1;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * (r - (major ? 14 : 9)), Math.sin(a) * (r - (major ? 14 : 9)));
      ctx.lineTo(Math.cos(a) * (r - 4), Math.sin(a) * (r - 4));
      ctx.stroke();
      if (major) {
        ctx.save();
        ctx.translate(Math.cos(a) * (r - 25), Math.sin(a) * (r - 25));
        ctx.rotate(a + Math.PI * 0.5);
        ctx.font = '700 13px ui-monospace, monospace';
        ctx.fillStyle = deg === 0 ? '#6ae67b' : '#f4f1ea';
        ctx.fillText(cardLabels.get(deg) || '', 0, 0);
        ctx.restore();
      }
    }

    // Target bearing bug on rotating card
    if (Number.isFinite(targetBrgRad)) {
      const ba = targetBrgRad - Math.PI * 0.5;
      ctx.save();
      ctx.translate(Math.cos(ba) * (r - 7), Math.sin(ba) * (r - 7));
      ctx.rotate(ba + Math.PI * 0.5);
      ctx.fillStyle = '#58e2c7';
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(-6, 5);
      ctx.lineTo(6, 5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();

    // Fixed center aircraft silhouette + top orange lubber line (matching ref-cockpit)
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = '#ffbe55';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(0, -r + 4);
    ctx.lineTo(0, -18);
    ctx.stroke();
    ctx.fillStyle = '#ffbe55';
    ctx.beginPath();
    ctx.moveTo(0, -r + 14);
    ctx.lineTo(-5, -r + 5);
    ctx.lineTo(5, -r + 5);
    ctx.closePath();
    ctx.fill();

    // Airplane top-down outline
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -18);
    ctx.lineTo(3, -6);
    ctx.lineTo(22, 3);
    ctx.lineTo(22, 8);
    ctx.lineTo(3, 5);
    ctx.lineTo(2, 16);
    ctx.lineTo(9, 21);
    ctx.lineTo(9, 24);
    ctx.lineTo(0, 22);
    ctx.lineTo(-9, 24);
    ctx.lineTo(-9, 21);
    ctx.lineTo(-2, 16);
    ctx.lineTo(-3, 5);
    ctx.lineTo(-22, 8);
    ctx.lineTo(-22, 3);
    ctx.lineTo(-3, -6);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
    finishDial(cx, cy, r);
  }

  function drawVsi(cx, cy, r, fpm) {
    beginDial(cx, cy, r);
    // 0 at 9 o'clock (Math.PI), +2000 FPM clockwise near 3 o'clock, -2000 counter-clockwise
    const vToA = (v) => Math.PI + clamp(v / 2000, -1, 1) * (Math.PI * 0.85);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let v = -2000; v <= 2000; v += 250) {
      const a = vToA(v);
      const major = v % 500 === 0;
      ctx.strokeStyle = major ? '#f4f1ea' : 'rgba(244,241,234,0.45)';
      ctx.lineWidth = major ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (r - (major ? 15 : 10)), cy + Math.sin(a) * (r - (major ? 15 : 10)));
      ctx.lineTo(cx + Math.cos(a) * (r - 4), cy + Math.sin(a) * (r - 4));
      ctx.stroke();
      if (major && Math.abs(v) !== 2000) {
        ctx.font = '700 13px ui-monospace, monospace';
        ctx.fillStyle = '#f4f1ea';
        ctx.fillText(String(Math.abs(v) / 100), cx + Math.cos(a) * (r - 26), cy + Math.sin(a) * (r - 26));
      }
    }
    ctx.font = '700 10px system-ui, sans-serif';
    ctx.fillStyle = '#a8b3c2';
    ctx.fillText('VERT SPD', cx + 10, cy - 18);
    ctx.fillText('UP', cx - 18, cy - 26);
    ctx.fillText('DN', cx - 18, cy + 26);
    ctx.font = '700 12px ui-monospace, monospace';
    ctx.fillStyle = fpm < -850 ? '#ff5d55' : fpm <= -80 && fpm >= -600 ? '#6ae67b' : '#58e2c7';
    ctx.fillText(`${fpm >= 0 ? '+' : ''}${Math.round(fpm)}`, cx + 16, cy + 16);

    drawNeedle(cx, cy, vToA(fpm), r - 14, 14, 3.2, '#ffffff');
    finishDial(cx, cy, r);
  }

  function drawFuelAux(cx, cy, r, fuelPct, isFree) {
    beginDial(cx, cy, r);
    const startA = Math.PI * 0.8;
    const spanA = Math.PI * 1.4;
    const fToA = (pct) => startA + clamp(pct / 100, 0, 1) * spanA;

    ctx.lineWidth = 5;
    ctx.strokeStyle = '#ff5d55';
    ctx.beginPath();
    ctx.arc(cx, cy, r - 7, fToA(0), fToA(20));
    ctx.stroke();
    ctx.strokeStyle = '#4ad278';
    ctx.beginPath();
    ctx.arc(cx, cy, r - 7, fToA(20), fToA(100));
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 10px ui-monospace, monospace';
    ctx.fillStyle = '#f4f1ea';
    ctx.fillText('E', cx - 22, cy + 22);
    ctx.fillText('F', cx + 22, cy + 22);
    ctx.fillStyle = '#a8b3c2';
    ctx.fillText('FUEL', cx, cy - 16);
    ctx.font = '700 11px ui-monospace, monospace';
    ctx.fillStyle = isFree ? '#58e2c7' : fuelPct <= 20 ? '#ff5d55' : '#6ae67b';
    ctx.fillText(isFree ? 'UNL' : `${Math.round(fuelPct)}%`, cx, cy + 24);

    drawNeedle(cx, cy, fToA(isFree ? 100 : fuelPct), r - 11, 10, 2.5, '#ffbe55');
    finishDial(cx, cy, r);
  }

  function update(state, isTitle) {
    ctx.drawImage(bgCanvas, 0, 0);
    const p = state.plane;
    const kts = p.speed * 1.94384;
    const altFt = p.pos.y * 3.28084;
    const fpm = p.verticalSpeed * 196.85;
    const hasFuel = p.fuel > 0 || state.mode === MODE_FREE || isTitle;
    const rpmVal = hasFuel ? 700 + p.throttle * 2000 + p.speed * 2.8 : 300 + p.speed * 4.5;

    let targetBrg = NaN;
    if (state.mode === MODE_FREE || state.ringsPassed >= MISSION_RINGS.length) {
      targetBrg = Math.atan2(0 - p.pos.x, -(320 - p.pos.z));
    } else {
      const r = MISSION_RINGS[state.ringsPassed];
      targetBrg = Math.atan2(r.x - p.pos.x, -(r.z - p.pos.z));
    }

    drawAirspeed(305, 106, R, kts, p.isStalling);
    drawAttitude(505, 106, R, p.pitch, p.roll);
    drawAltimeter(705, 106, R, altFt);
    drawRpmGauge(305, 282, R, rpmVal, p.throttle);
    drawHeadingIndicator(505, 282, R, p.heading, targetBrg);
    drawVsi(705, 282, R, fpm);
    drawFuelAux(116, 126, R_AUX, p.fuel, state.mode === MODE_FREE);

    return canvas;
  }

  return { canvas, update };
}
