// Procedural Cessna-like high-wing GA aircraft geometry with smooth normals,
// material properties (specularity, roughness, emissive), two-tone cream & deep red livery,
// tinted framed canopy, wing struts, aileron/flap seams, faired landing gear, and prop-disc.

// Material presets: [specStrength, roughness, emissive]
const MAT_PAINT = [0.46, 0.24, 0.0];
const MAT_STRIPE = [0.50, 0.22, 0.0];
const MAT_GLASS = [0.96, 0.06, 0.0];
const MAT_FRAME = [0.24, 0.44, 0.0];
const MAT_SEAM = [0.08, 0.68, 0.0];
const MAT_METAL = [0.85, 0.16, 0.0];
const MAT_TIRE = [0.06, 0.86, 0.0];
const MAT_ANTIGLARE = [0.08, 0.78, 0.0];
const MAT_LAMP = [0.90, 0.12, 0.85];

// Two-tone GA livery palette
const COL_CREAM = [0.95, 0.91, 0.82];
const COL_BELLY = [0.86, 0.82, 0.75];
const COL_RED = [0.68, 0.12, 0.11];
const COL_GOLD = [0.84, 0.65, 0.28];
const COL_GLASS = [0.11, 0.20, 0.29];
const COL_FRAME = [0.14, 0.16, 0.20];
const COL_SEAM = [0.16, 0.15, 0.14];
const COL_METAL = [0.76, 0.79, 0.83];
const COL_DARK_METAL = [0.22, 0.23, 0.26];
const COL_TIRE = [0.09, 0.09, 0.11];
const COL_ANTIGLARE = [0.11, 0.12, 0.14];

export const PLANE_NAV_LIGHTS_PROCEDURAL = [
  { x: -5.22, y: 1.15, z: -0.58, color: [1.0, 0.16, 0.12], size: 0.22, pulse: 0 },
  { x: 5.22, y: 1.15, z: -0.58, color: [0.18, 1.0, 0.38], size: 0.22, pulse: 0 },
  { x: 0.0, y: 0.26, z: 4.20, color: [1.0, 0.96, 0.88], size: 0.18, pulse: 0 },
  { x: 0.0, y: 1.90, z: 3.88, color: [1.0, 0.18, 0.10], size: 0.24, pulse: 1 },
  { x: 0.0, y: -0.26, z: -3.09, color: [1.0, 0.94, 0.78], size: 0.28, pulse: 0 },
];

// Nav light positions matching transformed plane.glb bounds (vertical fin peak at glTF x=3.04, y=2.05)
export const PLANE_NAV_LIGHTS = [
  { x: -5.49, y: 1.27, z: -0.14, color: [1.0, 0.16, 0.12], size: 0.22, pulse: 0 },
  { x: 5.49, y: 1.27, z: -0.14, color: [0.18, 1.0, 0.38], size: 0.22, pulse: 0 },
  { x: 0.0, y: 0.55, z: 3.55, color: [1.0, 0.96, 0.88], size: 0.18, pulse: 0 },
  { x: 0.0, y: 2.35, z: 3.04, color: [1.0, 0.18, 0.10], size: 0.24, pulse: 1 },
  { x: 0.0, y: 0.05, z: -3.50, color: [1.0, 0.94, 0.78], size: 0.28, pulse: 0 },
];

/**
 * Column-major 4x4 transform aligning plane.glb (glTF +Y up, nose -X, wingspan +/-Z, gear bottom y=-1.85)
 * to engine local coordinates (nose -Z, +X right wing, +Y up, gear bottom y=-1.55):
 * -90 deg rotation around Y: (x, y, z) -> (-z, y, x), plus +0.30 m Y translation.
 */
export const PLANE_GLB_TRANSFORM = new Float32Array([
  0, 0, 1, 0,
  0, 1, 0, 0,
  -1, 0, 0, 0,
  0, 0.30, 0, 1,
]);

/** Identify propeller nodes in plane.glb (PROP_Hub, PROP_Spinner, PROP_Blade_*, PROP_BladeTip_*). */
export function isPropPart(name) {
  return typeof name === 'string' && name.startsWith('PROP_');
}

function createPlaneBuilder() {
  const pos = [];
  const norm = [];
  const col = [];
  const mat = [];

  function pushVert(x, y, z, nx, ny, nz, c, m) {
    pos.push(x, y, z);
    norm.push(nx, ny, nz);
    col.push(c[0], c[1], c[2]);
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

  function triSmooth(a, b, c, color, material) {
    pushVert(a.x, a.y, a.z, a.nx, a.ny, a.nz, color, material);
    pushVert(b.x, b.y, b.z, b.nx, b.ny, b.nz, color, material);
    pushVert(c.x, c.y, c.z, c.nx, c.ny, c.nz, color, material);
  }

  function quadSmooth(a, b, c, d, color, material) {
    triSmooth(a, b, c, color, material);
    triSmooth(a, c, d, color, material);
  }

  function quadFlat(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, c, m) {
    triFlat(ax, ay, az, bx, by, bz, cx, cy, cz, c, m);
    triFlat(ax, ay, az, cx, cy, cz, dx, dy, dz, c, m);
  }

  /**
   * Add a smooth-shaded tube/strut between two 3D points with elliptical cross-section.
   */
  function addStrut(p0, p1, rx, ry, segs, color, material) {
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
      const ox = (ux * ca * rx + vx * sa * ry);
      const oy = (uy * ca * rx + vy * sa * ry);
      const oz = (uz * ca * rx + vz * sa * ry);
      ring0.push({ x: p0[0] + ox, y: p0[1] + oy, z: p0[2] + oz, nx: nx / nLen, ny: ny / nLen, nz: nz / nLen });
      ring1.push({ x: p1[0] + ox, y: p1[1] + oy, z: p1[2] + oz, nx: nx / nLen, ny: ny / nLen, nz: nz / nLen });
    }
    for (let i = 0; i < segs; i += 1) {
      quadSmooth(ring0[i], ring1[i], ring1[i + 1], ring0[i + 1], color, material);
    }
    // End caps
    const c0 = { x: p0[0], y: p0[1], z: p0[2], nx: -dir[0], ny: -dir[1], nz: -dir[2] };
    const c1 = { x: p1[0], y: p1[1], z: p1[2], nx: dir[0], ny: dir[1], nz: dir[2] };
    for (let i = 0; i < segs; i += 1) {
      triSmooth(c0, ring0[i], ring0[i + 1], color, material);
      triSmooth(c1, ring1[i + 1], ring1[i], color, material);
    }
  }

  /** Add a smooth ellipsoid/pod (used for wheel pants, tires, nav light housings). */
  function addEllipsoid(cx, cy, cz, rx, ry, rz, lonSegs, latSegs, colorFn, matFn) {
    const grid = [];
    for (let lat = 0; lat <= latSegs; lat += 1) {
      const phi = (lat / latSegs) * Math.PI;
      const sp = Math.sin(phi);
      const cp = Math.cos(phi);
      const row = [];
      for (let lon = 0; lon <= lonSegs; lon += 1) {
        const theta = (lon / lonSegs) * Math.PI * 2;
        const ct = Math.cos(theta);
        const st = Math.sin(theta);
        const x = cx + sp * ct * rx;
        const y = cy + cp * ry;
        const z = cz + sp * st * rz;
        let nx = (sp * ct) / Math.max(rx, 0.01);
        let ny = cp / Math.max(ry, 0.01);
        let nz = (sp * st) / Math.max(rz, 0.01);
        const nLen = Math.hypot(nx, ny, nz) || 1;
        nx /= nLen;
        ny /= nLen;
        nz /= nLen;
        row.push({ x, y, z, nx, ny, nz, u: lon / lonSegs, v: lat / latSegs });
      }
      grid.push(row);
    }
    for (let lat = 0; lat < latSegs; lat += 1) {
      for (let lon = 0; lon < lonSegs; lon += 1) {
        const v00 = grid[lat][lon];
        const v10 = grid[lat + 1][lon];
        const v11 = grid[lat + 1][lon + 1];
        const v01 = grid[lat][lon + 1];
        const vMid = (v00.v + v10.v) * 0.5;
        const uMid = (v00.u + v01.u) * 0.5;
        const c = typeof colorFn === 'function' ? colorFn(uMid, vMid, (v00.y + v10.y) * 0.5) : colorFn;
        const m = typeof matFn === 'function' ? matFn(uMid, vMid) : matFn;
        if (lat > 0) triSmooth(v00, v11, v01, c, m);
        if (lat < latSegs - 1) triSmooth(v00, v10, v11, c, m);
      }
    }
  }

  function toMesh() {
    return {
      positions: new Float32Array(pos),
      normals: new Float32Array(norm),
      colors: new Float32Array(col),
      materials: new Float32Array(mat),
      vertexCount: pos.length / 3,
    };
  }

  return { triFlat, triSmooth, quadSmooth, quadFlat, addStrut, addEllipsoid, toMesh };
}

/**
 * Evaluate a rounded-superellipse fuselage cross-section at parameter `theta` in [0, 2*PI].
 * theta = 0 is top center, PI/2 is right (+X), PI is bottom, 3*PI/2 is left (-X).
 */
function fuselageSectionPoint(st, theta) {
  const s = Math.sin(theta);
  const c = Math.cos(theta);
  const ry = c >= 0 ? st.ryTop : st.ryBot;
  const p = st.sq ?? 2.3; // >2 gives subtly flat sides & cabin walls
  const sx = Math.sign(s) * Math.pow(Math.abs(s), 2 / p);
  const cy = Math.sign(c) * Math.pow(Math.abs(c), 2 / p);
  return {
    x: sx * st.rx,
    y: st.yc + cy * ry,
    z: st.z,
  };
}

/** Determine crisp two-tone livery + canopy + panel seam for a fuselage quad. */
function fuselagePatchStyle(zMid, thetaMid, yMid) {
  // thetaMid in [0, 2*PI]: 0 = top, PI/2 = right, PI = bottom, 3*PI/2 = left
  const sideDist = Math.abs(Math.sin(thetaMid)); // 1 on sides, 0 on top/bottom
  const isTop = Math.cos(thetaMid) > 0;

  // Nose air intake grille / cowling front face
  if (zMid < -3.02 && sideDist > 0.25 && sideDist < 0.85 && Math.abs(yMid + 0.05) < 0.18) {
    return { c: COL_FRAME, m: MAT_SEAM };
  }

  // Matte charcoal anti-glare strip on top of engine cowling
  if (zMid >= -2.98 && zMid <= -1.96 && isTop && sideDist < 0.42) {
    return { c: COL_ANTIGLARE, m: MAT_ANTIGLARE };
  }

  // Windshield (-1.96 .. -1.24)
  if (zMid >= -1.96 && zMid <= -1.24 && isTop && sideDist < 0.84) {
    // Center & corner windshield frames
    if (sideDist < 0.08 || sideDist > 0.77 || zMid < -1.91 || zMid > -1.30) {
      return { c: COL_FRAME, m: MAT_FRAME };
    }
    return { c: COL_GLASS, m: MAT_GLASS };
  }

  // Cabin side windows (-1.24 .. +0.62) & rear wrap window (+0.62 .. +1.28)
  if (zMid >= -1.24 && zMid <= 1.28 && isTop && sideDist >= 0.46 && sideDist <= 0.94) {
    // Window frames / B-pillar / C-pillar / sill
    if (
      sideDist < 0.53 ||
      sideDist > 0.88 ||
      Math.abs(zMid - (-0.36)) < 0.055 ||
      Math.abs(zMid - 0.54) < 0.055 ||
      zMid > 1.20
    ) {
      return { c: COL_FRAME, m: MAT_FRAME };
    }
    return { c: COL_GLASS, m: MAT_GLASS };
  }

  // Deep red cheatline running along fuselage sides from cowling to tail
  // Cheatline center height gently rises toward tail
  const tTail = Math.max(0, (zMid - 0.5) / 3.5);
  const lineCenterY = -0.06 + tTail * 0.28;
  const lineHalfH = 0.12 - tTail * 0.04;
  if (zMid > -3.02 && zMid < 3.95 && sideDist > 0.55) {
    const dy = yMid - lineCenterY;
    if (Math.abs(dy) < lineHalfH) {
      return { c: COL_RED, m: MAT_STRIPE };
    }
    if (dy >= lineHalfH && dy < lineHalfH + 0.032) {
      return { c: COL_GOLD, m: MAT_STRIPE };
    }
  }

  // Subtle panel separation lines (firewall, door seams, aft bulkhead)
  if (
    Math.abs(zMid - (-2.04)) < 0.025 ||
    Math.abs(zMid - (-1.18)) < 0.020 ||
    Math.abs(zMid - 0.42) < 0.020 ||
    Math.abs(zMid - 1.32) < 0.022
  ) {
    return { c: COL_SEAM, m: MAT_SEAM };
  }

  // Lower belly slightly warmer/shaded ivory-grey
  if (!isTop && sideDist < 0.55) {
    return { c: COL_BELLY, m: MAT_PAINT };
  }

  return { c: COL_CREAM, m: MAT_PAINT };
}

/** Build the Cessna-like high-wing GA aircraft mesh. */
export function buildPlaneMesh() {
  const b = createPlaneBuilder();

  // --- 1. SMOOTH LOFTED FUSELAGE (Nose -Z to Tail +Z) ---
  const stations = [
    { z: -3.14, rx: 0.26, ryTop: 0.25, ryBot: 0.25, yc: 0.00, sq: 2.0 }, // Spinner backplate
    { z: -3.02, rx: 0.44, ryTop: 0.36, ryBot: 0.38, yc: -0.04, sq: 2.2 }, // Cowl lip
    { z: -2.65, rx: 0.58, ryTop: 0.43, ryBot: 0.48, yc: -0.07, sq: 2.3 }, // Mid cowling
    { z: -2.06, rx: 0.64, ryTop: 0.46, ryBot: 0.52, yc: -0.08, sq: 2.4 }, // Firewall
    { z: -1.96, rx: 0.65, ryTop: 0.50, ryBot: 0.53, yc: -0.07, sq: 2.4 }, // Windshield base
    { z: -1.32, rx: 0.69, ryTop: 0.90, ryBot: 0.56, yc: -0.02, sq: 2.5 }, // Windshield top / A-pillar
    { z: -1.20, rx: 0.70, ryTop: 0.94, ryBot: 0.56, yc: 0.00, sq: 2.5 }, // Front cabin
    { z: -0.36, rx: 0.71, ryTop: 0.95, ryBot: 0.55, yc: 0.01, sq: 2.5 }, // Cabin B-pillar
    { z: 0.44, rx: 0.68, ryTop: 0.90, ryBot: 0.52, yc: 0.02, sq: 2.4 }, // Aft cabin
    { z: 0.62, rx: 0.65, ryTop: 0.84, ryBot: 0.50, yc: 0.03, sq: 2.4 }, // Rear window slope
    { z: 1.28, rx: 0.54, ryTop: 0.56, ryBot: 0.44, yc: 0.06, sq: 2.2 }, // Rear bulkhead
    { z: 2.15, rx: 0.39, ryTop: 0.42, ryBot: 0.34, yc: 0.13, sq: 2.1 }, // Mid tailcone
    { z: 3.15, rx: 0.23, ryTop: 0.28, ryBot: 0.24, yc: 0.20, sq: 2.0 }, // Aft tailcone
    { z: 4.05, rx: 0.10, ryTop: 0.16, ryBot: 0.12, yc: 0.25, sq: 2.0 }, // Tail tip
    { z: 4.18, rx: 0.03, ryTop: 0.05, ryBot: 0.05, yc: 0.26, sq: 2.0 }, // Tail cap
  ];

  // Use fine angular stops so cheatline & window frames align cleanly
  const radSteps = 40;
  const grid = [];
  for (let s = 0; s < stations.length; s += 1) {
    const row = [];
    for (let i = 0; i <= radSteps; i += 1) {
      const theta = (i / radSteps) * Math.PI * 2;
      const pt = fuselageSectionPoint(stations[s], theta);
      row.push({ ...pt, theta });
    }
    grid.push(row);
  }

  // Compute smooth vertex normals across the loft
  for (let s = 0; s < stations.length; s += 1) {
    const sPrev = Math.max(0, s - 1);
    const sNext = Math.min(stations.length - 1, s + 1);
    for (let i = 0; i <= radSteps; i += 1) {
      const iPrev = (i - 1 + radSteps) % radSteps;
      const iNext = (i + 1) % radSteps;
      const pL = grid[sPrev][i];
      const pR = grid[sNext][i];
      const pU = grid[s][iPrev];
      const pD = grid[s][iNext];
      // Tangent along +Z (nose->tail) and tangent along +theta (top->right->bottom)
      const tz = [pR.x - pL.x, pR.y - pL.y, pR.z - pL.z];
      const tt = [pD.x - pU.x, pD.y - pU.y, pD.z - pU.z];
      // Outward normal = tt x tz
      let nx = tt[1] * tz[2] - tt[2] * tz[1];
      let ny = tt[2] * tz[0] - tt[0] * tz[2];
      let nz = tt[0] * tz[1] - tt[1] * tz[0];
      const len = Math.hypot(nx, ny, nz) || 1;
      grid[s][i].nx = nx / len;
      grid[s][i].ny = ny / len;
      grid[s][i].nz = nz / len;
    }
  }

  for (let s = 0; s < stations.length - 1; s += 1) {
    const zMid = (stations[s].z + stations[s + 1].z) * 0.5;
    for (let i = 0; i < radSteps; i += 1) {
      const v00 = grid[s][i];
      const v10 = grid[s + 1][i];
      const v11 = grid[s + 1][i + 1];
      const v01 = grid[s][i + 1];
      const thetaMid = ((i + 0.5) / radSteps) * Math.PI * 2;
      const yMid = (v00.y + v10.y + v11.y + v01.y) * 0.25;
      const style = fuselagePatchStyle(zMid, thetaMid, yMid);
      b.quadSmooth(v00, v01, v11, v10, style.c, style.m);
    }
  }

  // Nose landing lamp lens & tail cap
  b.addEllipsoid(0, -0.25, -3.05, 0.11, 0.08, 0.06, 10, 6, [1.0, 0.95, 0.80], MAT_LAMP);
  // Twin metallic exhaust stubs beneath cowling
  b.addStrut([-0.20, -0.50, -2.18], [-0.24, -0.66, -2.02], 0.045, 0.045, 8, COL_DARK_METAL, MAT_METAL);
  b.addStrut([0.20, -0.50, -2.18], [0.24, -0.66, -2.02], 0.045, 0.045, 8, COL_DARK_METAL, MAT_METAL);

  // --- 2. HIGH WING WITH CAMBERED AIRFOIL, DIHEDRAL, TAPER & ROUNDED TIPS ---
  // Airfoil stations along half-span (mirrored for port -X and starboard +X)
  const wingStations = [
    { x: 0.00, y: 0.90, zLE: -1.24, chord: 1.62, thick: 0.21 },
    { x: 0.68, y: 0.92, zLE: -1.24, chord: 1.62, thick: 0.21 },
    { x: 2.15, y: 0.99, zLE: -1.22, chord: 1.56, thick: 0.19 },
    { x: 2.45, y: 1.005, zLE: -1.20, chord: 1.50, thick: 0.18 },
    { x: 3.65, y: 1.06, zLE: -1.11, chord: 1.28, thick: 0.15 },
    { x: 4.78, y: 1.12, zLE: -1.00, chord: 1.04, thick: 0.12 },
    { x: 5.02, y: 1.135, zLE: -0.92, chord: 0.82, thick: 0.09 },
    { x: 5.17, y: 1.145, zLE: -0.80, chord: 0.54, thick: 0.055 },
    { x: 5.25, y: 1.15, zLE: -0.64, chord: 0.24, thick: 0.025 },
  ];

  // Airfoil loop parameter `u` around upper (0->1) and lower (1->0) surface
  const foilUs = [0.0, 0.04, 0.12, 0.25, 0.42, 0.60, 0.70, 0.73, 0.86, 1.0];
  function buildWingSide(signX) {
    const rings = [];
    for (let s = 0; s < wingStations.length; s += 1) {
      const ws = wingStations[s];
      const ring = [];
      // Upper surface LE -> TE
      for (let k = 0; k < foilUs.length; k += 1) {
        const u = foilUs[k];
        const yt = ws.thick * 2.5 * (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u * u + 0.2843 * u * u * u - 0.1015 * u * u * u * u);
        const yc = 0.03 * ws.chord * 4 * u * (1 - u);
        ring.push({ x: signX * ws.x, y: ws.y + yc + yt, z: ws.zLE + u * ws.chord, u, top: true });
      }
      // Lower surface TE -> LE
      for (let k = foilUs.length - 2; k >= 1; k -= 1) {
        const u = foilUs[k];
        const yt = ws.thick * 2.5 * (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u * u + 0.2843 * u * u * u - 0.1015 * u * u * u * u);
        const yc = 0.03 * ws.chord * 4 * u * (1 - u);
        ring.push({ x: signX * ws.x, y: ws.y + yc - yt * 0.68, z: ws.zLE + u * ws.chord, u, top: false });
      }
      rings.push(ring);
    }

    const rCount = rings[0].length;
    // Compute smooth normals for wing surface
    for (let s = 0; s < rings.length; s += 1) {
      const sPrev = Math.max(0, s - 1);
      const sNext = Math.min(rings.length - 1, s + 1);
      for (let i = 0; i < rCount; i += 1) {
        const iPrev = (i - 1 + rCount) % rCount;
        const iNext = (i + 1) % rCount;
        const pL = rings[sPrev][i];
        const pR = rings[sNext][i];
        const pU = rings[s][iPrev];
        const pD = rings[s][iNext];
        const ts = [pR.x - pL.x, pR.y - pL.y, pR.z - pL.z];
        const tc = [pD.x - pU.x, pD.y - pU.y, pD.z - pU.z];
        let nx = (tc[1] * ts[2] - tc[2] * ts[1]) * signX;
        let ny = (tc[2] * ts[0] - tc[0] * ts[2]) * signX;
        let nz = (tc[0] * ts[1] - tc[1] * ts[0]) * signX;
        const len = Math.hypot(nx, ny, nz) || 1;
        rings[s][i].nx = nx / len;
        rings[s][i].ny = ny / len;
        rings[s][i].nz = nz / len;
      }
    }

    for (let s = 0; s < rings.length - 1; s += 1) {
      const xMid = (wingStations[s].x + wingStations[s + 1].x) * 0.5;
      for (let i = 0; i < rCount; i += 1) {
        const iNext = (i + 1) % rCount;
        const v00 = rings[s][i];
        const v10 = rings[s + 1][i];
        const v11 = rings[s + 1][iNext];
        const v01 = rings[s][iNext];
        const uMid = (v00.u + v01.u) * 0.5;

        // Wing livery & control surface seams
        let c = COL_CREAM;
        let m = MAT_PAINT;
        if (xMid >= 4.78) {
          c = COL_RED;
          m = MAT_STRIPE;
        } else if (xMid >= 2.15 && xMid <= 2.45) {
          // Aileron / flap spanwise separation + accent stripe on outer wing
          if (uMid >= 0.70) {
            c = COL_SEAM;
            m = MAT_SEAM;
          }
        } else if (uMid >= 0.70 && uMid <= 0.73 && xMid > 0.68 && xMid < 4.78) {
          // Hinge separation line for flaps (inboard) and ailerons (outboard)
          c = COL_SEAM;
          m = MAT_SEAM;
        } else if (xMid > 0.68 && xMid < 4.78 && uMid < 0.08) {
          // Crisp deep red leading-edge accent trim on outer wing
          if (xMid > 2.45) {
            c = COL_RED;
            m = MAT_STRIPE;
          }
        }

        if (signX > 0) b.quadSmooth(v00, v10, v11, v01, c, m);
        else b.quadSmooth(v00, v01, v11, v10, c, m);
      }
    }

    // Cap the very tip smoothly
    const lastRing = rings[rings.length - 1];
    const tipCenter = {
      x: signX * 5.28,
      y: 1.15,
      z: -0.52,
      nx: signX,
      ny: 0.05,
      nz: 0,
    };
    for (let i = 0; i < rCount; i += 1) {
      const iNext = (i + 1) % rCount;
      if (signX > 0) b.triSmooth(tipCenter, lastRing[iNext], lastRing[i], COL_RED, MAT_STRIPE);
      else b.triSmooth(tipCenter, lastRing[i], lastRing[iNext], COL_RED, MAT_STRIPE);
    }

    // Streamlined wing lift strut from lower fuselage to wing underside
    b.addStrut([signX * 0.62, -0.30, -0.34], [signX * 2.28, 0.94, -0.40], 0.042, 0.075, 10, COL_CREAM, MAT_PAINT);
  }

  buildWingSide(1);
  buildWingSide(-1);

  // Pitot tube under port (-X) wing
  b.addStrut([-2.32, 0.96, -0.82], [-2.32, 0.80, -0.82], 0.016, 0.024, 6, COL_METAL, MAT_METAL);
  b.addStrut([-2.32, 0.80, -0.80], [-2.32, 0.80, -1.14], 0.015, 0.015, 6, COL_METAL, MAT_METAL);

  // --- 3. ROUNDED TAIL SURFACES (Horizontal Stabilizer + Swept Vertical Fin) ---
  const hStabStations = [
    { x: 0.00, y: 0.28, zLE: 3.22, chord: 0.92, thick: 0.07 },
    { x: 1.48, y: 0.28, zLE: 3.44, chord: 0.70, thick: 0.055 },
    { x: 1.72, y: 0.28, zLE: 3.56, chord: 0.54, thick: 0.04 },
    { x: 1.84, y: 0.28, zLE: 3.70, chord: 0.28, thick: 0.02 },
  ];
  const tailUs = [0.0, 0.12, 0.35, 0.65, 0.70, 0.74, 0.90, 1.0];
  function buildHStabSide(signX) {
    const rings = [];
    for (let s = 0; s < hStabStations.length; s += 1) {
      const ts = hStabStations[s];
      const ring = [];
      for (let k = 0; k < tailUs.length; k += 1) {
        const u = tailUs[k];
        const yt = ts.thick * 2.5 * (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u * u + 0.2843 * u * u * u - 0.1015 * u * u * u * u);
        ring.push({ x: signX * ts.x, y: ts.y + yt, z: ts.zLE + u * ts.chord, u });
      }
      for (let k = tailUs.length - 2; k >= 1; k -= 1) {
        const u = tailUs[k];
        const yt = ts.thick * 2.5 * (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u * u + 0.2843 * u * u * u - 0.1015 * u * u * u * u);
        ring.push({ x: signX * ts.x, y: ts.y - yt, z: ts.zLE + u * ts.chord, u });
      }
      rings.push(ring);
    }
    const rCount = rings[0].length;
    for (let s = 0; s < rings.length; s += 1) {
      const sPrev = Math.max(0, s - 1);
      const sNext = Math.min(rings.length - 1, s + 1);
      for (let i = 0; i < rCount; i += 1) {
        const iPrev = (i - 1 + rCount) % rCount;
        const iNext = (i + 1) % rCount;
        const pL = rings[sPrev][i];
        const pR = rings[sNext][i];
        const pU = rings[s][iPrev];
        const pD = rings[s][iNext];
        const ts = [pR.x - pL.x, pR.y - pL.y, pR.z - pL.z];
        const tc = [pD.x - pU.x, pD.y - pU.y, pD.z - pU.z];
        let nx = (tc[1] * ts[2] - tc[2] * ts[1]) * signX;
        let ny = (tc[2] * ts[0] - tc[0] * ts[2]) * signX;
        let nz = (tc[0] * ts[1] - tc[1] * ts[0]) * signX;
        const len = Math.hypot(nx, ny, nz) || 1;
        rings[s][i].nx = nx / len;
        rings[s][i].ny = ny / len;
        rings[s][i].nz = nz / len;
      }
    }
    for (let s = 0; s < rings.length - 1; s += 1) {
      const xMid = (hStabStations[s].x + hStabStations[s + 1].x) * 0.5;
      for (let i = 0; i < rCount; i += 1) {
        const iNext = (i + 1) % rCount;
        const v00 = rings[s][i];
        const v10 = rings[s + 1][i];
        const v11 = rings[s + 1][iNext];
        const v01 = rings[s][iNext];
        const uMid = (v00.u + v01.u) * 0.5;
        let c = COL_CREAM;
        let m = MAT_PAINT;
        if (xMid >= 1.48) {
          c = COL_RED;
          m = MAT_STRIPE;
        } else if (uMid >= 0.70 && uMid <= 0.74) {
          c = COL_SEAM;
          m = MAT_SEAM;
        }
        if (signX > 0) b.quadSmooth(v00, v10, v11, v01, c, m);
        else b.quadSmooth(v00, v01, v11, v10, c, m);
      }
    }
  }
  buildHStabSide(1);
  buildHStabSide(-1);

  // Vertical Stabilizer & Dorsal Fin + Rudder (lofted vertically from y = 0.24 up to 1.88)
  const vFinStations = [
    { y: 0.24, zLE: 2.15, chord: 2.02, thick: 0.08 }, // Dorsal fin base
    { y: 0.54, zLE: 2.75, chord: 1.42, thick: 0.075 },
    { y: 1.05, zLE: 3.12, chord: 1.06, thick: 0.065 },
    { y: 1.58, zLE: 3.44, chord: 0.74, thick: 0.052 },
    { y: 1.78, zLE: 3.60, chord: 0.54, thick: 0.038 },
    { y: 1.88, zLE: 3.74, chord: 0.28, thick: 0.02 },
  ];
  const vRings = [];
  for (let s = 0; s < vFinStations.length; s += 1) {
    const vs = vFinStations[s];
    const ring = [];
    for (let k = 0; k < tailUs.length; k += 1) {
      const u = tailUs[k];
      const xt = vs.thick * 2.5 * (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u * u + 0.2843 * u * u * u - 0.1015 * u * u * u * u);
      ring.push({ x: xt, y: vs.y, z: vs.zLE + u * vs.chord, u });
    }
    for (let k = tailUs.length - 2; k >= 1; k -= 1) {
      const u = tailUs[k];
      const xt = vs.thick * 2.5 * (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u * u + 0.2843 * u * u * u - 0.1015 * u * u * u * u);
      ring.push({ x: -xt, y: vs.y, z: vs.zLE + u * vs.chord, u });
    }
    vRings.push(ring);
  }
  const vrCount = vRings[0].length;
  for (let s = 0; s < vRings.length; s += 1) {
    const sPrev = Math.max(0, s - 1);
    const sNext = Math.min(vRings.length - 1, s + 1);
    for (let i = 0; i < vrCount; i += 1) {
      const iPrev = (i - 1 + vrCount) % vrCount;
      const iNext = (i + 1) % vrCount;
      const pL = vRings[sPrev][i];
      const pR = vRings[sNext][i];
      const pU = vRings[s][iPrev];
      const pD = vRings[s][iNext];
      const ts = [pR.x - pL.x, pR.y - pL.y, pR.z - pL.z];
      const tc = [pD.x - pU.x, pD.y - pU.y, pD.z - pU.z];
      let nx = ts[1] * tc[2] - ts[2] * tc[1];
      let ny = ts[2] * tc[0] - ts[0] * tc[2];
      let nz = ts[0] * tc[1] - ts[1] * tc[0];
      const len = Math.hypot(nx, ny, nz) || 1;
      vRings[s][i].nx = nx / len;
      vRings[s][i].ny = ny / len;
      vRings[s][i].nz = nz / len;
    }
  }
  for (let s = 0; s < vRings.length - 1; s += 1) {
    const yMid = (vFinStations[s].y + vFinStations[s + 1].y) * 0.5;
    for (let i = 0; i < vrCount; i += 1) {
      const iNext = (i + 1) % vrCount;
      const v00 = vRings[s][i];
      const v10 = vRings[s + 1][i];
      const v11 = vRings[s + 1][iNext];
      const v01 = vRings[s][iNext];
      const uMid = (v00.u + v01.u) * 0.5;
      let c = COL_RED;
      let m = MAT_STRIPE;
      if (uMid >= 0.70 && uMid <= 0.74) {
        c = COL_SEAM;
        m = MAT_SEAM;
      } else if (uMid > 0.74 && yMid < 1.62) {
        c = COL_CREAM;
        m = MAT_PAINT;
      }
      b.quadSmooth(v00, v01, v11, v10, c, m);
    }
  }
  // Top beacon housing on vertical fin
  b.addEllipsoid(0, 1.90, 3.88, 0.05, 0.05, 0.06, 8, 5, [1.0, 0.22, 0.14], MAT_LAMP);

  // Wingtip nav light housings
  b.addEllipsoid(-5.22, 1.15, -0.58, 0.05, 0.04, 0.08, 8, 5, [1.0, 0.2, 0.14], MAT_LAMP);
  b.addEllipsoid(5.22, 1.15, -0.58, 0.05, 0.04, 0.08, 8, 5, [0.2, 1.0, 0.42], MAT_LAMP);

  // --- 4. FIXED TRICYCLE LANDING GEAR WITH FAIRED WHEELS (WHEEL PANTS) ---
  // Main gear legs & wheel fairings (tires rest cleanly at y = -1.55)
  for (const signX of [-1, 1]) {
    b.addStrut([signX * 0.50, -0.44, 0.14], [signX * 1.14, -1.24, 0.20], 0.036, 0.068, 8, COL_CREAM, MAT_PAINT);
    // Streamlined wheel fairing (pant)
    b.addEllipsoid(
      signX * 1.16,
      -1.26,
      0.20,
      0.13,
      0.19,
      0.46,
      14,
      8,
      (_u, _v, y) => (y > -1.24 && y < -1.16 ? COL_RED : COL_CREAM),
      MAT_PAINT,
    );
    // Exposed dark rubber tire bottom reaching y = -1.55
    b.addEllipsoid(signX * 1.16, -1.32, 0.20, 0.085, 0.23, 0.23, 12, 8, COL_TIRE, MAT_TIRE);
  }

  // Nose gear strut & wheel fairing (tire bottom at y = -1.55)
  b.addStrut([0, -0.44, -2.06], [0, -1.26, -2.16], 0.038, 0.042, 8, COL_METAL, MAT_METAL);
  b.addEllipsoid(
    0,
    -1.28,
    -2.16,
    0.11,
    0.17,
    0.40,
    14,
    8,
    (_u, _v, y) => (y > -1.26 && y < -1.19 ? COL_RED : COL_CREAM),
    MAT_PAINT,
  );
  b.addEllipsoid(0, -1.34, -2.16, 0.075, 0.21, 0.21, 12, 8, COL_TIRE, MAT_TIRE);

  return b.toMesh();
}

/**
 * Separate propeller mesh centered at origin (mounted at local plane z = -3.28),
 * featuring a smooth spinner cone and sculpted smooth-shaded twisted blades visible at low RPM.
 */
export function buildPropellerMesh() {
  const b = createPlaneBuilder();

  // Smooth spinner cone from backplate z = +0.14 out to rounded nose tip z = -0.34
  const rings = [];
  const segs = 24;
  const stations = [
    { z: 0.14, r: 0.25 },
    { z: 0.06, r: 0.23 },
    { z: -0.06, r: 0.18 },
    { z: -0.20, r: 0.10 },
    { z: -0.31, r: 0.035 },
    { z: -0.34, r: 0.0 },
  ];
  for (let s = 0; s < stations.length; s += 1) {
    const st = stations[s];
    const sPrev = stations[Math.max(0, s - 1)];
    const sNext = stations[Math.min(stations.length - 1, s + 1)];
    const dz = sNext.z - sPrev.z;
    const dr = sNext.r - sPrev.r;
    const slopeLen = Math.hypot(dz, dr) || 1;
    // Outward normal in radial/Z plane (z decreases toward nose tip)
    const nRad = -dz / slopeLen;
    const nZ = dr / slopeLen;
    const row = [];
    for (let i = 0; i <= segs; i += 1) {
      const a = (i / segs) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      row.push({ x: ca * st.r, y: sa * st.r, z: st.z, nx: ca * nRad, ny: sa * nRad, nz: nZ });
    }
    rings.push(row);
  }
  for (let s = 0; s < stations.length - 1; s += 1) {
    const zMid = (stations[s].z + stations[s + 1].z) * 0.5;
    const isTip = zMid < -0.18;
    const c = isTip ? COL_RED : COL_METAL;
    const m = isTip ? MAT_STRIPE : MAT_METAL;
    for (let i = 0; i < segs; i += 1) {
      b.quadSmooth(rings[s][i], rings[s][i + 1], rings[s + 1][i + 1], rings[s + 1][i], c, m);
    }
  }
  // Backplate disc
  for (let i = 0; i < segs; i += 1) {
    const a0 = (i / segs) * Math.PI * 2;
    const a1 = ((i + 1) / segs) * Math.PI * 2;
    b.triFlat(
      0, 0, 0.14,
      Math.cos(a1) * 0.25, Math.sin(a1) * 0.25, 0.14,
      Math.cos(a0) * 0.25, Math.sin(a0) * 0.25, 0.14,
      COL_DARK_METAL,
      MAT_METAL,
    );
  }

  // Two sculpted smooth-shaded twisted airfoil propeller blades
  const bladeStations = [
    { r: 0.18, w: 0.055, t: 0.032, twist: 0.56 },
    { r: 0.42, w: 0.105, t: 0.024, twist: 0.43 },
    { r: 0.74, w: 0.105, t: 0.017, twist: 0.29 },
    { r: 1.02, w: 0.082, t: 0.013, twist: 0.19 },
    { r: 1.15, w: 0.050, t: 0.009, twist: 0.14 },
  ];
  const profSegs = 8;
  for (const sign of [-1, 1]) {
    const bRings = [];
    for (let s = 0; s < bladeStations.length; s += 1) {
      const bs = bladeStations[s];
      const ct = Math.cos(bs.twist);
      const st = Math.sin(bs.twist);
      const ring = [];
      for (let k = 0; k < profSegs; k += 1) {
        const ang = (k / profSegs) * Math.PI * 2;
        const ly = Math.cos(ang) * bs.w;
        const lz = Math.sin(ang) * bs.t;
        const nyL = Math.cos(ang) / Math.max(bs.w, 0.01);
        const nzL = Math.sin(ang) / Math.max(bs.t, 0.005);
        const nyRot = nyL * ct - nzL * st * sign;
        const nzRot = nyL * st * sign + nzL * ct;
        const nLen = Math.hypot(nyRot, nzRot) || 1;
        ring.push({
          x: sign * bs.r,
          y: ly * ct - lz * st * sign,
          z: ly * st * sign + lz * ct,
          nx: 0,
          ny: nyRot / nLen,
          nz: nzRot / nLen,
        });
      }
      bRings.push(ring);
    }
    for (let s = 0; s < bRings.length - 1; s += 1) {
      const isTip = s === bRings.length - 2;
      const c = isTip ? [0.95, 0.78, 0.22] : [0.16, 0.17, 0.20];
      const m = isTip ? MAT_PAINT : MAT_METAL;
      const r0 = bRings[s];
      const r1 = bRings[s + 1];
      for (let k = 0; k < profSegs; k += 1) {
        const kn = (k + 1) % profSegs;
        if (sign > 0) b.quadSmooth(r0[k], r1[k], r1[kn], r0[kn], c, m);
        else b.quadSmooth(r0[k], r0[kn], r1[kn], r1[k], c, m);
      }
    }
    const tipRing = bRings[bRings.length - 1];
    const tipCenter = { x: sign * 1.17, y: 0, z: 0, nx: sign, ny: 0, nz: 0 };
    for (let k = 0; k < profSegs; k += 1) {
      const kn = (k + 1) % profSegs;
      if (sign > 0) b.triSmooth(tipCenter, tipRing[k], tipRing[kn], [0.95, 0.78, 0.22], MAT_PAINT);
      else b.triSmooth(tipCenter, tipRing[kn], tipRing[k], [0.95, 0.78, 0.22], MAT_PAINT);
    }
  }

  return b.toMesh();
}

/**
 * Translucent motion-blurred propeller disc centered at origin (mounted with propeller).
 * Stores radial fade in uvs.x [0..1] so the renderer blends hub & outer edge seamlessly.
 */
export function buildPropDiscMesh() {
  const pos = [];
  const norm = [];
  const col = [];
  const uv = [];
  const segs = 40;
  const rings = [
    { r: 0.22, a: 0.0, c: [0.22, 0.22, 0.24] },
    { r: 0.42, a: 0.75, c: [0.34, 0.33, 0.36] },
    { r: 0.96, a: 0.65, c: [0.30, 0.30, 0.32] },
    { r: 1.07, a: 0.85, c: [0.88, 0.72, 0.26] },
    { r: 1.18, a: 0.0, c: [0.16, 0.16, 0.18] },
  ];

  for (let s = 0; s < rings.length - 1; s += 1) {
    const r0 = rings[s];
    const r1 = rings[s + 1];
    for (let i = 0; i < segs; i += 1) {
      const a0 = (i / segs) * Math.PI * 2;
      const a1 = ((i + 1) / segs) * Math.PI * 2;
      const streak0 = 0.62 + 0.38 * Math.cos(a0 * 2);
      const streak1 = 0.62 + 0.38 * Math.cos(a1 * 2);
      const c00 = [r0.c[0] * streak0, r0.c[1] * streak0, r0.c[2] * streak0];
      const c01 = [r0.c[0] * streak1, r0.c[1] * streak1, r0.c[2] * streak1];
      const c10 = [r1.c[0] * streak0, r1.c[1] * streak0, r1.c[2] * streak0];
      const c11 = [r1.c[0] * streak1, r1.c[1] * streak1, r1.c[2] * streak1];

      const p00 = [Math.cos(a0) * r0.r, Math.sin(a0) * r0.r, -0.02];
      const p10 = [Math.cos(a0) * r1.r, Math.sin(a0) * r1.r, -0.02];
      const p11 = [Math.cos(a1) * r1.r, Math.sin(a1) * r1.r, -0.02];
      const p01 = [Math.cos(a1) * r0.r, Math.sin(a1) * r0.r, -0.02];

      pos.push(...p00, ...p10, ...p11, ...p00, ...p11, ...p01);
      for (let k = 0; k < 6; k += 1) norm.push(0, 0, -1);
      col.push(...c00, ...c10, ...c11, ...c00, ...c11, ...c01);
      uv.push(
        r0.a * streak0, 0,
        r1.a * streak0, 0,
        r1.a * streak1, 0,
        r0.a * streak0, 0,
        r1.a * streak1, 0,
        r0.a * streak1, 0,
      );
    }
  }

  return {
    positions: new Float32Array(pos),
    normals: new Float32Array(norm),
    colors: new Float32Array(col),
    uvs: new Float32Array(uv),
    vertexCount: pos.length / 3,
  };
}
