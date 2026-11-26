// WebGL1 golden-hour 3D renderer: sunset sky dome with sun glare, 2048 PCF shadow mapping,
// directional + mauve/warm-brown hemisphere + Blinn-Phong specular lighting, animated shimmering
// water, drifting clouds, glowing target rings, ACES tone mapping & grading, and chase camera.

import { MISSION_RINGS, MODE_MISSION, PALETTE, PLANE, RUNWAY, WORLD } from './config.js';
import {
  clamp,
  cross3,
  dot3,
  lerp,
  mat4Create,
  mat4FromBasis,
  mat4LookAt,
  mat4Multiply,
  mat4Ortho,
  mat4Perspective,
  normalize3,
  vec3,
} from './math.js';
import {
  buildAirfieldMesh,
  buildCloudsMesh,
  buildLightDotMesh,
  buildPlaneMesh,
  buildPropellerMesh,
  buildRingMesh,
  buildTerrainMesh,
  buildTreesMesh,
  buildWaterMesh,
  terrainHeight,
} from './terrain.js';

const SHADOW_SIZE = 2048;
const SHADOW_HALF = 185;
const SHADOW_TEXEL = (SHADOW_HALF * 2) / SHADOW_SIZE;
const AMBIENT_SKY_MAUVE = new Float32Array([0.33, 0.23, 0.35]);
const AMBIENT_GROUND_WARM = new Float32Array([0.23, 0.15, 0.10]);

const TONEMAP_GLSL = `
  vec3 acesFilm(vec3 x) {
    float a = 2.51;
    float b = 0.03;
    float c = 2.43;
    float d = 0.59;
    float e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
  }

  vec3 gradeAndToneMap(vec3 col) {
    vec3 mapped = acesFilm(max(col, vec3(0.0)) * 1.04);
    vec3 sCurve = mapped * mapped * (3.0 - 2.0 * mapped);
    mapped = mix(mapped, sCurve, 0.14);
    float luma = dot(mapped, vec3(0.2126, 0.7152, 0.0722));
    return clamp(mix(vec3(luma), mapped, 1.12), 0.0, 1.0);
  }
`;

const SHADOW_VS = `
  attribute vec3 aPosition;
  uniform mat4 uLightProjView;
  uniform mat4 uModel;
  varying float vDepth;
  void main() {
    vec4 clipPos = uLightProjView * (uModel * vec4(aPosition, 1.0));
    vDepth = clipPos.z * 0.5 + 0.5;
    gl_Position = clipPos;
  }
`;

const SHADOW_FS = `
  #ifdef GL_FRAGMENT_PRECISION_HIGH
  precision highp float;
  #else
  precision mediump float;
  #endif
  varying float vDepth;

  vec4 packDepth(float d) {
    d = clamp(d, 0.0, 0.999999);
    float r = floor(d * 255.0);
    float rem1 = d * 255.0 - r;
    float g = floor(rem1 * 255.0);
    float rem2 = rem1 * 255.0 - g;
    float b = floor(rem2 * 255.0);
    return vec4(r, g, b, 255.0) / 255.0;
  }

  void main() {
    gl_FragColor = packDepth(vDepth);
  }
`;

const SKY_VS = `
  attribute vec2 aPos;
  varying vec2 vNdc;
  void main() {
    vNdc = aPos;
    gl_Position = vec4(aPos, 0.9999, 1.0);
  }
`;

const SKY_FS = `
  precision mediump float;
  varying vec2 vNdc;
  uniform vec3 uCamRight;
  uniform vec3 uCamUp;
  uniform vec3 uCamForward;
  uniform float uTanHalfFov;
  uniform float uAspect;
  uniform vec3 uSunDir;
  uniform vec3 uSkyZenith;
  uniform vec3 uSkyMid;
  uniform vec3 uSkyHorizon;
  uniform vec3 uSunColor;
  ${TONEMAP_GLSL}

  void main() {
    vec3 dir = normalize(
      uCamForward +
      uCamRight * (vNdc.x * uAspect * uTanHalfFov) +
      uCamUp * (vNdc.y * uTanHalfFov)
    );
    float h = clamp(dir.y, -0.1, 1.0);
    float t1 = smoothstep(0.0, 0.24, max(h, 0.0));
    float t2 = smoothstep(0.20, 0.78, max(h, 0.0));
    vec3 col = mix(uSkyHorizon, uSkyMid, t1);
    col = mix(col, uSkyZenith, t2);

    // Horizon warm band
    float horizGlow = pow(1.0 - clamp(abs(dir.y), 0.0, 1.0), 5.0);
    col += vec3(0.30, 0.14, 0.03) * horizGlow;

    // Sun disc + warm golden glare halo (HDR rolled off by ACES)
    float sunDot = max(dot(dir, normalize(uSunDir)), 0.0);
    float halo = pow(sunDot, 7.0) * 0.48 + pow(sunDot, 48.0) * 0.85;
    float disc = smoothstep(0.9978, 0.9992, sunDot);
    col += uSunColor * halo;
    col = mix(col, vec3(2.1, 1.9, 1.5), disc);

    gl_FragColor = vec4(gradeAndToneMap(col), 1.0);
  }
`;

const SOLID_VS = `
  attribute vec3 aPosition;
  attribute vec3 aNormal;
  attribute vec3 aColor;
  uniform mat4 uProjView;
  uniform mat4 uLightProjView;
  uniform mat4 uModel;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying vec3 vColor;
  varying vec4 vLightPos;
  void main() {
    vec4 wp = uModel * vec4(aPosition, 1.0);
    vec3 wn = normalize(mat3(uModel) * aNormal);
    vWorldPos = wp.xyz;
    vNormal = wn;
    vColor = aColor;
    vLightPos = uLightProjView * vec4(wp.xyz + wn * 0.18, 1.0);
    gl_Position = uProjView * wp;
  }
`;

const SOLID_FS = `
  #ifdef GL_FRAGMENT_PRECISION_HIGH
  precision highp float;
  #else
  precision mediump float;
  #endif
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying vec3 vColor;
  varying vec4 vLightPos;
  uniform vec3 uCamPos;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uAmbientSky;
  uniform vec3 uAmbientGround;
  uniform vec3 uSkyHorizon;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform float uEmissive;
  uniform float uSpecStrength;
  uniform float uShininess;
  uniform float uIsAircraft;
  uniform sampler2D uShadowMap;
  uniform float uShadowEnabled;
  uniform float uShadowTexel;
  ${TONEMAP_GLSL}

  float unpackDepth(vec4 c) {
    return c.r + c.g / 255.0 + c.b / 65025.0;
  }

  float sampleShadow(vec4 lightPos, float ndl) {
    if (uShadowEnabled < 0.5 || ndl <= 0.0) return 0.0;
    vec3 proj = lightPos.xyz / lightPos.w;
    proj = proj * 0.5 + 0.5;
    if (proj.z <= 0.0 || proj.z >= 1.0) return 0.0;
    float edge = max(abs(proj.x - 0.5), abs(proj.y - 0.5));
    if (edge >= 0.5) return 0.0;
    float fade = 1.0 - smoothstep(0.42, 0.50, edge);

    float bias = max(0.00085 * (1.0 - ndl), 0.00022);
    float current = proj.z - bias;
    float stepUv = uShadowTexel * 1.15;
    float sum = 0.0;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 uv = clamp(proj.xy + vec2(float(x), float(y)) * stepUv, 0.0, 1.0);
        float d = unpackDepth(texture2D(uShadowMap, uv));
        if (current > d) sum += 1.0;
      }
    }
    return (sum / 9.0) * fade;
  }

  void main() {
    vec3 n = normalize(vNormal);
    vec3 l = normalize(uSunDir);
    vec3 v = normalize(uCamPos - vWorldPos);
    float ndl = max(dot(n, l), 0.0);

    // Hemisphere ambient: sky mauve above, warm brown bounce below
    float hemi = n.y * 0.5 + 0.5;
    vec3 amb = mix(uAmbientGround, uAmbientSky, hemi);

    // Real-time 3x3 PCF shadow attenuation on direct sun contribution
    float shadow = sampleShadow(vLightPos, ndl);
    float sunVis = 1.0 - shadow * 0.86;

    // Detect aircraft canopy glass by its slate-blue vertex tint
    bool isCanopy = uIsAircraft > 0.5 && (vColor.b - vColor.r) > 0.18;
    float specStr = isCanopy ? 1.45 : uSpecStrength;
    float shininess = isCanopy ? 180.0 : uShininess;

    // Blinn-Phong specular highlight
    vec3 h = normalize(l + v);
    float ndh = max(dot(n, h), 0.0);
    float spec = pow(ndh, shininess) * specStr;

    float fresnel = pow(1.0 - max(dot(n, v), 0.0), 3.0);
    vec3 albedo = vColor;
    if (isCanopy) {
      vec3 reflDir = reflect(-v, n);
      vec3 reflCol = mix(uSkyHorizon, uAmbientSky * 1.35, clamp(reflDir.y * 0.5 + 0.5, 0.0, 1.0));
      albedo = mix(albedo, reflCol, 0.26 + fresnel * 0.48);
    }

    vec3 directSun = uSunColor * (ndl * 1.38 * albedo + vec3(spec)) * sunVis;
    vec3 lit = albedo * (amb + uEmissive) + directSun;

    // Subtle sunset rim on sunlit surfaces
    float rim = fresnel * max(dot(-v, l) * 0.5 + 0.5, 0.0);
    lit += uSunColor * rim * (0.14 * sunVis);

    float dist = length(uCamPos - vWorldPos);
    float fog = 1.0 - exp(-pow(dist * uFogDensity, 1.65));
    // Warm sun-scatter tint in fog looking toward sun
    vec3 viewDir = normalize(vWorldPos - uCamPos);
    float sunAmt = pow(max(dot(viewDir, l), 0.0), 5.0);
    vec3 fogCol = mix(uFogColor, uSunColor * 0.95, sunAmt * 0.45);
    vec3 finalCol = mix(lit, fogCol, clamp(fog, 0.0, 1.0));
    gl_FragColor = vec4(gradeAndToneMap(finalCol), 1.0);
  }
`;

const WATER_VS = `
  attribute vec3 aPosition;
  uniform mat4 uProjView;
  varying vec3 vWorldPos;
  void main() {
    vWorldPos = aPosition;
    gl_Position = uProjView * vec4(aPosition, 1.0);
  }
`;

const WATER_FS = `
  precision mediump float;
  varying vec3 vWorldPos;
  uniform vec3 uCamPos;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uSkyZenith;
  uniform vec3 uSkyMid;
  uniform vec3 uSkyHorizon;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform float uTime;
  ${TONEMAP_GLSL}

  void main() {
    vec3 l = normalize(uSunDir);
    vec3 v = normalize(uCamPos - vWorldPos);
    float dist = length(uCamPos - vWorldPos);

    // Gentle animated micro-ripples that fade with distance (no tiling/aliasing)
    float w1 = sin(vWorldPos.x * 0.14 + uTime * 1.35) * cos(vWorldPos.z * 0.11 - uTime * 1.05);
    float w2 = sin((vWorldPos.x + vWorldPos.z) * 0.23 - uTime * 1.7);
    float rippleFade = 1.0 - smoothstep(180.0, 950.0, dist);
    vec3 n = normalize(vec3((w1 * 0.022 + w2 * 0.014) * rippleFade, 1.0, (w1 * 0.018 - w2 * 0.016) * rippleFade));
    vec3 r = reflect(-v, n);

    // Smoothly reflect sunset sky gradient
    float rh = clamp(r.y, 0.0, 1.0);
    float t1 = smoothstep(0.0, 0.24, rh);
    float t2 = smoothstep(0.20, 0.78, rh);
    vec3 skyRefl = mix(uSkyHorizon, uSkyMid, t1);
    skyRefl = mix(skyRefl, uSkyZenith, t2);
    float horizGlow = pow(1.0 - clamp(abs(r.y), 0.0, 1.0), 4.5);
    skyRefl += vec3(0.26, 0.12, 0.03) * horizGlow;

    float fresnel = clamp(0.16 + 0.84 * pow(1.0 - max(v.y, 0.0), 3.2), 0.0, 1.0);
    vec3 deep = vec3(0.06, 0.17, 0.28);
    vec3 base = mix(deep, skyRefl, fresnel);

    // Blinn-Phong sun-glint path along sun azimuth (HDR rolled off by ACES)
    vec3 h = normalize(l + v);
    float ndh = max(dot(n, h), 0.0);
    float sunCore = pow(ndh, 210.0) * 1.80;
    float sunBloom = pow(ndh, 22.0) * 0.36;
    vec2 viewXZ = normalize(vec2(-v.x, -v.z) + vec2(1e-5));
    vec2 sunXZ = normalize(vec2(l.x, l.z) + vec2(1e-5));
    float azAlign = max(dot(viewXZ, sunXZ), 0.0);
    float glintPath = pow(azAlign, 20.0) * smoothstep(0.58, 0.02, v.y) * 0.45;
    float gentlePulse = 0.94 + 0.06 * sin(uTime * 1.2);
    vec3 col = base + uSunColor * (sunCore + sunBloom + glintPath) * gentlePulse;

    float fog = 1.0 - exp(-pow(dist * uFogDensity, 1.65));
    float sunAmt = pow(max(dot(-v, l), 0.0), 5.0);
    vec3 fogCol = mix(uFogColor, uSunColor * 0.95, sunAmt * 0.45);
    vec3 finalCol = mix(col, fogCol, clamp(fog, 0.0, 1.0));
    gl_FragColor = vec4(gradeAndToneMap(finalCol), 1.0);
  }
`;

const CLOUD_VS = `
  attribute vec3 aPosition;
  attribute vec3 aNormal;
  attribute vec3 aColor;
  attribute vec2 aCenter;
  uniform mat4 uProjView;
  uniform vec2 uDrift;
  uniform float uWorldSize;
  uniform float uWorldHalf;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying vec3 vColor;
  void main() {
    vec2 wrapped = mod(aCenter + uDrift + uWorldHalf, uWorldSize) - uWorldHalf;
    vec3 pos = aPosition;
    pos.xz += wrapped - aCenter;
    vWorldPos = pos;
    vNormal = aNormal;
    vColor = aColor;
    gl_Position = uProjView * vec4(pos, 1.0);
  }
`;

const CLOUD_FS = `
  precision mediump float;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying vec3 vColor;
  uniform vec3 uCamPos;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  ${TONEMAP_GLSL}

  void main() {
    vec3 n = normalize(vNormal);
    vec3 l = normalize(uSunDir);
    vec3 v = normalize(uCamPos - vWorldPos);
    float ndl = dot(n, l);
    float sunSide = smoothstep(-0.45, 0.78, ndl);
    float topBias = clamp(n.y * 0.5 + 0.5, 0.0, 1.0);

    // Dusk lavender-rose shaded undersides -> warm pink/orange on the sun side
    vec3 shadowCol = mix(vec3(0.55, 0.47, 0.65), vec3(0.77, 0.57, 0.68), topBias);
    vec3 sunLitCol = mix(vec3(1.0, 0.62, 0.46), vec3(1.05, 0.85, 0.66), topBias);
    vec3 col = mix(shadowCol, sunLitCol, sunSide) * vColor;

    float backScatter = pow(max(dot(-v, l), 0.0), 4.0);
    float rim = pow(1.0 - max(dot(n, v), 0.0), 2.0);
    col += vec3(1.0, 0.52, 0.36) * (rim * sunSide * 0.28 + backScatter * 0.22);

    float dist = length(uCamPos - vWorldPos);
    float fog = 1.0 - exp(-pow(dist * uFogDensity * 0.72, 1.65));
    float sunAmt = pow(max(dot(-v, l), 0.0), 5.0);
    vec3 fogCol = mix(uFogColor, uSunColor * 0.95, sunAmt * 0.45);
    vec3 finalCol = mix(col, fogCol, clamp(fog, 0.0, 1.0));
    gl_FragColor = vec4(gradeAndToneMap(finalCol), 1.0);
  }
`;

const GLOW_VS = `
  attribute vec3 aPosition;
  attribute vec3 aNormal;
  attribute vec3 aColor;
  uniform mat4 uProjView;
  uniform mat4 uModel;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying vec3 vColor;
  void main() {
    vec4 wp = uModel * vec4(aPosition, 1.0);
    vWorldPos = wp.xyz;
    vNormal = mat3(uModel) * aNormal;
    vColor = aColor;
    gl_Position = uProjView * wp;
  }
`;

const GLOW_FS = `
  precision mediump float;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying vec3 vColor;
  uniform vec3 uCamPos;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform float uAlpha;
  uniform float uPulse;
  uniform float uEdgeFalloff;
  uniform vec3 uTint;
  ${TONEMAP_GLSL}

  void main() {
    vec3 n = normalize(vNormal);
    vec3 v = normalize(uCamPos - vWorldPos);
    float facing = clamp(abs(dot(n, v)), 0.0, 1.0);
    float falloff = uEdgeFalloff > 0.0 ? pow(facing, uEdgeFalloff) : 1.0;
    vec3 col = vColor * uTint * uPulse;
    float dist = length(uCamPos - vWorldPos);
    float fog = 1.0 - exp(-pow(dist * uFogDensity * 0.65, 1.65));
    col = mix(col, uFogColor, clamp(fog * 0.65, 0.0, 1.0));
    gl_FragColor = vec4(acesFilm(col), uAlpha * falloff);
  }
`;

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) || 'Shader compile error');
  }
  return shader;
}

function createProgram(gl, vsSource, fsSource) {
  const prog = gl.createProgram();
  gl.attachShader(prog, compileShader(gl, gl.VERTEX_SHADER, vsSource));
  gl.attachShader(prog, compileShader(gl, gl.FRAGMENT_SHADER, fsSource));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(prog) || 'Program link error');
  }
  return prog;
}

function uploadMesh(gl, mesh, withNormalAndColor = true) {
  const posBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
  gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STATIC_DRAW);

  let normBuf = null;
  let colBuf = null;
  let centerBuf = null;
  if (withNormalAndColor) {
    normBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normBuf);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.normals, gl.STATIC_DRAW);

    colBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, colBuf);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.colors, gl.STATIC_DRAW);
  }
  if (mesh.centers) {
    centerBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, centerBuf);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.centers, gl.STATIC_DRAW);
  }
  return { posBuf, normBuf, colBuf, centerBuf, vertexCount: mesh.vertexCount };
}

function buildShadowDiscMesh() {
  const segs = 16;
  const pos = [];
  const norm = [];
  const col = [];
  const r = 4.6;
  for (let i = 0; i < segs; i += 1) {
    const a0 = (i / segs) * Math.PI * 2;
    const a1 = ((i + 1) / segs) * Math.PI * 2;
    pos.push(0, 0, 0, Math.cos(a0) * r, 0, Math.sin(a0) * r * 0.75, Math.cos(a1) * r, 0, Math.sin(a1) * r * 0.75);
    norm.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
    col.push(0.08, 0.08, 0.1, 0.08, 0.08, 0.1, 0.08, 0.08, 0.1);
  }
  return {
    positions: new Float32Array(pos),
    normals: new Float32Array(norm),
    colors: new Float32Array(col),
    vertexCount: pos.length / 3,
  };
}

export function createRenderer3D(canvas, random) {
  const gl = canvas.getContext('webgl', { antialias: true, preserveDrawingBuffer: true })
    || canvas.getContext('experimental-webgl', { antialias: true, preserveDrawingBuffer: true });
  if (!gl) {
    throw new Error('WebGL is required to run Skyward Run.');
  }

  const shadowProg = createProgram(gl, SHADOW_VS, SHADOW_FS);
  const skyProg = createProgram(gl, SKY_VS, SKY_FS);
  const solidProg = createProgram(gl, SOLID_VS, SOLID_FS);
  const waterProg = createProgram(gl, WATER_VS, WATER_FS);
  const cloudProg = createProgram(gl, CLOUD_VS, CLOUD_FS);
  const glowProg = createProgram(gl, GLOW_VS, GLOW_FS);

  // 2048x2048 RGBA8 packed-depth shadow map FBO
  const shadowTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, shadowTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, SHADOW_SIZE, SHADOW_SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const shadowDepthRb = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, shadowDepthRb);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, SHADOW_SIZE, SHADOW_SIZE);

  const shadowFbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, shadowTex, 0);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, shadowDepthRb);
  const shadowSupported = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.bindRenderbuffer(gl.RENDERBUFFER, null);

  const skyQuad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, skyQuad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

  const terrainGpu = uploadMesh(gl, buildTerrainMesh());
  const waterGpu = uploadMesh(gl, buildWaterMesh(), false);
  const airfieldGpu = uploadMesh(gl, buildAirfieldMesh());
  const treesGpu = uploadMesh(gl, buildTreesMesh(random));
  const cloudsGpu = uploadMesh(gl, buildCloudsMesh(random));
  const planeGpu = uploadMesh(gl, buildPlaneMesh());
  const propGpu = uploadMesh(gl, buildPropellerMesh());
  const ringCoreGpu = uploadMesh(gl, buildRingMesh(PLANE.ringRadius, 0.52));
  const ringMidGpu = uploadMesh(gl, buildRingMesh(PLANE.ringRadius, 1.25));
  const ringOuterGpu = uploadMesh(gl, buildRingMesh(PLANE.ringRadius, 2.35));
  const lightDotGpu = uploadMesh(gl, buildLightDotMesh(0.9));
  const shadowGpu = uploadMesh(gl, buildShadowDiscMesh());

  // Cache ground elevations for lead-in approach light dots
  const approachDots = [];
  for (let i = 1; i <= 6; i += 1) {
    const z = RUNWAY.zStart + i * 38;
    const h = terrainHeight(0, z);
    approachDots.push({ x: -5.5, y: h + 1.05, z });
    approachDots.push({ x: 5.5, y: h + 1.05, z });
    if (i === 3) {
      const hOuter = terrainHeight(12, z);
      approachDots.push({ x: -12, y: hOuter + 1.05, z });
      approachDots.push({ x: 12, y: hOuter + 1.05, z });
    }
  }

  const shadowLoc = {
    aPosition: gl.getAttribLocation(shadowProg, 'aPosition'),
    uLightProjView: gl.getUniformLocation(shadowProg, 'uLightProjView'),
    uModel: gl.getUniformLocation(shadowProg, 'uModel'),
  };

  const skyLoc = {
    aPos: gl.getAttribLocation(skyProg, 'aPos'),
    uCamRight: gl.getUniformLocation(skyProg, 'uCamRight'),
    uCamUp: gl.getUniformLocation(skyProg, 'uCamUp'),
    uCamForward: gl.getUniformLocation(skyProg, 'uCamForward'),
    uTanHalfFov: gl.getUniformLocation(skyProg, 'uTanHalfFov'),
    uAspect: gl.getUniformLocation(skyProg, 'uAspect'),
    uSunDir: gl.getUniformLocation(skyProg, 'uSunDir'),
    uSkyZenith: gl.getUniformLocation(skyProg, 'uSkyZenith'),
    uSkyMid: gl.getUniformLocation(skyProg, 'uSkyMid'),
    uSkyHorizon: gl.getUniformLocation(skyProg, 'uSkyHorizon'),
    uSunColor: gl.getUniformLocation(skyProg, 'uSunColor'),
  };

  const solidLoc = {
    aPosition: gl.getAttribLocation(solidProg, 'aPosition'),
    aNormal: gl.getAttribLocation(solidProg, 'aNormal'),
    aColor: gl.getAttribLocation(solidProg, 'aColor'),
    uProjView: gl.getUniformLocation(solidProg, 'uProjView'),
    uLightProjView: gl.getUniformLocation(solidProg, 'uLightProjView'),
    uModel: gl.getUniformLocation(solidProg, 'uModel'),
    uCamPos: gl.getUniformLocation(solidProg, 'uCamPos'),
    uSunDir: gl.getUniformLocation(solidProg, 'uSunDir'),
    uSunColor: gl.getUniformLocation(solidProg, 'uSunColor'),
    uAmbientSky: gl.getUniformLocation(solidProg, 'uAmbientSky'),
    uAmbientGround: gl.getUniformLocation(solidProg, 'uAmbientGround'),
    uSkyHorizon: gl.getUniformLocation(solidProg, 'uSkyHorizon'),
    uFogColor: gl.getUniformLocation(solidProg, 'uFogColor'),
    uFogDensity: gl.getUniformLocation(solidProg, 'uFogDensity'),
    uEmissive: gl.getUniformLocation(solidProg, 'uEmissive'),
    uSpecStrength: gl.getUniformLocation(solidProg, 'uSpecStrength'),
    uShininess: gl.getUniformLocation(solidProg, 'uShininess'),
    uIsAircraft: gl.getUniformLocation(solidProg, 'uIsAircraft'),
    uShadowMap: gl.getUniformLocation(solidProg, 'uShadowMap'),
    uShadowEnabled: gl.getUniformLocation(solidProg, 'uShadowEnabled'),
    uShadowTexel: gl.getUniformLocation(solidProg, 'uShadowTexel'),
  };

  const waterLoc = {
    aPosition: gl.getAttribLocation(waterProg, 'aPosition'),
    uProjView: gl.getUniformLocation(waterProg, 'uProjView'),
    uCamPos: gl.getUniformLocation(waterProg, 'uCamPos'),
    uSunDir: gl.getUniformLocation(waterProg, 'uSunDir'),
    uSunColor: gl.getUniformLocation(waterProg, 'uSunColor'),
    uSkyZenith: gl.getUniformLocation(waterProg, 'uSkyZenith'),
    uSkyMid: gl.getUniformLocation(waterProg, 'uSkyMid'),
    uSkyHorizon: gl.getUniformLocation(waterProg, 'uSkyHorizon'),
    uFogColor: gl.getUniformLocation(waterProg, 'uFogColor'),
    uFogDensity: gl.getUniformLocation(waterProg, 'uFogDensity'),
    uTime: gl.getUniformLocation(waterProg, 'uTime'),
  };

  const cloudLoc = {
    aPosition: gl.getAttribLocation(cloudProg, 'aPosition'),
    aNormal: gl.getAttribLocation(cloudProg, 'aNormal'),
    aColor: gl.getAttribLocation(cloudProg, 'aColor'),
    aCenter: gl.getAttribLocation(cloudProg, 'aCenter'),
    uProjView: gl.getUniformLocation(cloudProg, 'uProjView'),
    uCamPos: gl.getUniformLocation(cloudProg, 'uCamPos'),
    uSunDir: gl.getUniformLocation(cloudProg, 'uSunDir'),
    uSunColor: gl.getUniformLocation(cloudProg, 'uSunColor'),
    uFogColor: gl.getUniformLocation(cloudProg, 'uFogColor'),
    uFogDensity: gl.getUniformLocation(cloudProg, 'uFogDensity'),
    uDrift: gl.getUniformLocation(cloudProg, 'uDrift'),
    uWorldSize: gl.getUniformLocation(cloudProg, 'uWorldSize'),
    uWorldHalf: gl.getUniformLocation(cloudProg, 'uWorldHalf'),
  };

  const glowLoc = {
    aPosition: gl.getAttribLocation(glowProg, 'aPosition'),
    aNormal: gl.getAttribLocation(glowProg, 'aNormal'),
    aColor: gl.getAttribLocation(glowProg, 'aColor'),
    uProjView: gl.getUniformLocation(glowProg, 'uProjView'),
    uModel: gl.getUniformLocation(glowProg, 'uModel'),
    uCamPos: gl.getUniformLocation(glowProg, 'uCamPos'),
    uFogColor: gl.getUniformLocation(glowProg, 'uFogColor'),
    uFogDensity: gl.getUniformLocation(glowProg, 'uFogDensity'),
    uAlpha: gl.getUniformLocation(glowProg, 'uAlpha'),
    uPulse: gl.getUniformLocation(glowProg, 'uPulse'),
    uEdgeFalloff: gl.getUniformLocation(glowProg, 'uEdgeFalloff'),
    uTint: gl.getUniformLocation(glowProg, 'uTint'),
  };

  const identityMat = mat4Create();
  const projMat = mat4Create();
  const viewMat = mat4Create();
  const projViewMat = mat4Create();
  const modelMat = mat4Create();
  const propMat = mat4Create();
  const lightOrthoMat = mat4Create();
  const lightViewMat = mat4Create();
  const lightProjViewMat = mat4Create();

  // Precomputed sun light basis for texel-snapped shadow frustum (zero per-frame allocations)
  const sunNorm = normalize3({ x: PALETTE.sunDir[0], y: PALETTE.sunDir[1], z: PALETTE.sunDir[2] });
  const lightUpRef = vec3(0, 1, 0);
  const lBasisX = normalize3(cross3(lightUpRef, sunNorm, vec3()));
  const lBasisY = normalize3(cross3(sunNorm, lBasisX, vec3()));
  const shadowFocus = vec3();
  const shadowTarget = vec3();
  const lightEye = vec3();

  // Pre-allocated scratch vectors for per-frame camera, propeller, and ring transforms
  const camF = vec3();
  const camR = vec3();
  const camU = vec3();
  const desiredPosTmp = vec3();
  const desiredTargetTmp = vec3();
  const desiredUpTmp = vec3();
  const propRightTmp = vec3();
  const propUpTmp = vec3();
  const propPosTmp = vec3();
  const ringFwdTmp = vec3();
  const ringRightTmp = vec3();
  const ringUpTmp = vec3(0, 1, 0);
  const dotPosTmp = vec3();
  const dotRightTmp = vec3(1, 0, 0);
  const dotUpTmp = vec3(0, 1, 0);
  const dotFwdTmp = vec3(0, 0, -1);
  const fallbackDirTmp = vec3();
  const fallbackRightTmp = vec3();
  const fallbackPosTmp = vec3();

  const camState = {
    initialized: false,
    pos: vec3(0, 175, 1600),
    target: vec3(0, 165, 1550),
    up: vec3(0, 1, 0),
  };

  const ringFadeState = {
    prevPassed: 0,
    passTimes: new Array(MISSION_RINGS.length).fill(-1),
  };

  function resetCamera(plane) {
    camState.initialized = false;
    ringFadeState.prevPassed = 0;
    ringFadeState.passTimes.fill(-1);
    camState.pos.x = plane.pos.x - plane.forward.x * 16;
    camState.pos.y = plane.pos.y - plane.forward.y * 16 + 4.5;
    camState.pos.z = plane.pos.z - plane.forward.z * 16;
    camState.target.x = plane.pos.x + plane.forward.x * 18;
    camState.target.y = plane.pos.y + plane.forward.y * 18 + 1.0;
    camState.target.z = plane.pos.z + plane.forward.z * 18;
    camState.up.x = 0;
    camState.up.y = 1;
    camState.up.z = 0;
  }

  function bindPosOnly(gpu, aPosLoc) {
    gl.bindBuffer(gl.ARRAY_BUFFER, gpu.posBuf);
    gl.enableVertexAttribArray(aPosLoc);
    gl.vertexAttribPointer(aPosLoc, 3, gl.FLOAT, false, 0, 0);
  }

  function bindSolidMesh(gpu, loc) {
    gl.bindBuffer(gl.ARRAY_BUFFER, gpu.posBuf);
    gl.enableVertexAttribArray(loc.aPosition);
    gl.vertexAttribPointer(loc.aPosition, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, gpu.normBuf);
    gl.enableVertexAttribArray(loc.aNormal);
    gl.vertexAttribPointer(loc.aNormal, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, gpu.colBuf);
    gl.enableVertexAttribArray(loc.aColor);
    gl.vertexAttribPointer(loc.aColor, 3, gl.FLOAT, false, 0, 0);
  }

  function disableSolidMesh(loc) {
    if (loc.aPosition >= 0) gl.disableVertexAttribArray(loc.aPosition);
    if (loc.aNormal >= 0) gl.disableVertexAttribArray(loc.aNormal);
    if (loc.aColor >= 0) gl.disableVertexAttribArray(loc.aColor);
  }

  function updateShadowMatrix(plane) {
    const groundY = Math.max(WORLD.waterY, terrainHeight(plane.pos.x, plane.pos.z));
    const agl = Math.max(0, plane.pos.y - groundY);
    const fwdBias = clamp(agl * 0.35, 0, 48);
    const hFwdLen = Math.hypot(camF.x, camF.z) || 1;
    shadowFocus.x = plane.pos.x + (camF.x / hFwdLen) * fwdBias;
    shadowFocus.y = groundY + Math.min(agl, 70);
    shadowFocus.z = plane.pos.z + (camF.z / hFwdLen) * fwdBias;

    // Snap light-space XY center to shadow map texels to prevent edge shimmer
    const projX = dot3(shadowFocus, lBasisX);
    const projY = dot3(shadowFocus, lBasisY);
    const projZ = dot3(shadowFocus, sunNorm);
    const snappedX = Math.round(projX / SHADOW_TEXEL) * SHADOW_TEXEL;
    const snappedY = Math.round(projY / SHADOW_TEXEL) * SHADOW_TEXEL;

    shadowTarget.x = lBasisX.x * snappedX + lBasisY.x * snappedY + sunNorm.x * projZ;
    shadowTarget.y = lBasisX.y * snappedX + lBasisY.y * snappedY + sunNorm.y * projZ;
    shadowTarget.z = lBasisX.z * snappedX + lBasisY.z * snappedY + sunNorm.z * projZ;

    const lightDist = 420;
    lightEye.x = shadowTarget.x + sunNorm.x * lightDist;
    lightEye.y = shadowTarget.y + sunNorm.y * lightDist;
    lightEye.z = shadowTarget.z + sunNorm.z * lightDist;

    mat4LookAt(lightViewMat, lightEye, shadowTarget, lightUpRef);
    mat4Ortho(lightOrthoMat, -SHADOW_HALF, SHADOW_HALF, -SHADOW_HALF, SHADOW_HALF, 20, 920);
    mat4Multiply(lightProjViewMat, lightOrthoMat, lightViewMat);
  }

  function updateCamera(state, isTitle, snapImmediate) {
    const p = state.plane;
    let dist = 13.0;
    let height = 3.4;
    let lookAhead = 22;
    let sideOffset = 0;
    let targetYOffset = 0.9;

    if (isTitle) {
      // Hero golden-hour framing: camera on port quarter looking slightly left so plane sits on right half
      dist = 15.0;
      height = 3.2;
      sideOffset = -6.2;
      lookAhead = 24;
      targetYOffset = 1.2;
    } else if (state.camMode === 1) {
      // Wide scenic chase
      dist = 20.5;
      height = 5.8;
      targetYOffset = 1.1;
    }

    const targetSideOffset = isTitle ? -4.8 : 0;
    desiredPosTmp.x = p.pos.x - p.forward.x * dist + p.right.x * sideOffset;
    desiredPosTmp.y = Math.max(
      terrainHeight(p.pos.x - p.forward.x * dist, p.pos.z - p.forward.z * dist) + 3.0,
      p.pos.y - p.forward.y * dist + height,
    );
    desiredPosTmp.z = p.pos.z - p.forward.z * dist + p.right.z * sideOffset;

    desiredTargetTmp.x = p.pos.x + p.forward.x * lookAhead + p.right.x * targetSideOffset;
    desiredTargetTmp.y = p.pos.y + p.forward.y * lookAhead + targetYOffset;
    desiredTargetTmp.z = p.pos.z + p.forward.z * lookAhead + p.right.z * targetSideOffset;

    const rollFollow = isTitle ? 0.18 : 0.28;
    desiredUpTmp.x = p.up.x * rollFollow;
    desiredUpTmp.y = lerp(1, p.up.y, rollFollow);
    desiredUpTmp.z = p.up.z * rollFollow;
    normalize3(desiredUpTmp, desiredUpTmp);

    if (!camState.initialized || snapImmediate) {
      camState.pos.x = desiredPosTmp.x;
      camState.pos.y = desiredPosTmp.y;
      camState.pos.z = desiredPosTmp.z;
      camState.target.x = desiredTargetTmp.x;
      camState.target.y = desiredTargetTmp.y;
      camState.target.z = desiredTargetTmp.z;
      camState.up.x = desiredUpTmp.x;
      camState.up.y = desiredUpTmp.y;
      camState.up.z = desiredUpTmp.z;
      camState.initialized = true;
    } else {
      const k = 0.14;
      camState.pos.x = lerp(camState.pos.x, desiredPosTmp.x, k);
      camState.pos.y = lerp(camState.pos.y, desiredPosTmp.y, k);
      camState.pos.z = lerp(camState.pos.z, desiredPosTmp.z, k);
      camState.target.x = lerp(camState.target.x, desiredTargetTmp.x, 0.22);
      camState.target.y = lerp(camState.target.y, desiredTargetTmp.y, 0.22);
      camState.target.z = lerp(camState.target.z, desiredTargetTmp.z, 0.22);
      camState.up.x = lerp(camState.up.x, desiredUpTmp.x, 0.14);
      camState.up.y = lerp(camState.up.y, desiredUpTmp.y, 0.14);
      camState.up.z = lerp(camState.up.z, desiredUpTmp.z, 0.14);
      normalize3(camState.up, camState.up);
    }
  }

  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(window.innerWidth * ratio));
    const h = Math.max(1, Math.round(window.innerHeight * ratio));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  function render(state, isTitle, snapCamera = false) {
    resize();
    updateCamera(state, isTitle, snapCamera);

    // Sync passed-ring fade timers cleanly from state.ringsPassed
    if (state.ringsPassed < ringFadeState.prevPassed) {
      ringFadeState.passTimes.fill(-1);
    } else if (state.ringsPassed > ringFadeState.prevPassed && !snapCamera) {
      for (let i = ringFadeState.prevPassed; i < state.ringsPassed && i < MISSION_RINGS.length; i += 1) {
        ringFadeState.passTimes[i] = state.elapsed;
      }
    }
    ringFadeState.prevPassed = state.ringsPassed;

    const aspect = canvas.width / Math.max(1, canvas.height);
    const speedRatio = clamp((state.plane.speed - 25) / 45, 0, 1);
    const fovy = (54 + speedRatio * 10) * (Math.PI / 180);
    mat4Perspective(projMat, fovy, aspect, 1.0, 5600);
    mat4LookAt(viewMat, camState.pos, camState.target, camState.up);
    mat4Multiply(projViewMat, projMat, viewMat);

    // Derive camera basis for sky shader & shadow focus
    camF.x = camState.target.x - camState.pos.x;
    camF.y = camState.target.y - camState.pos.y;
    camF.z = camState.target.z - camState.pos.z;
    normalize3(camF, camF);
    cross3(camF, camState.up, camR);
    normalize3(camR, camR);
    cross3(camR, camF, camU);
    normalize3(camU, camU);

    // Compute plane & propeller model matrices once for both shadow and main passes
    const p = state.plane;
    mat4FromBasis(modelMat, p.pos, p.right, p.up, p.forward, 1.0);
    const propAngle = state.propPhase;
    const cp = Math.cos(propAngle);
    const sp = Math.sin(propAngle);
    propRightTmp.x = p.right.x * cp + p.up.x * sp;
    propRightTmp.y = p.right.y * cp + p.up.y * sp;
    propRightTmp.z = p.right.z * cp + p.up.z * sp;
    propUpTmp.x = -p.right.x * sp + p.up.x * cp;
    propUpTmp.y = -p.right.y * sp + p.up.y * cp;
    propUpTmp.z = -p.right.z * sp + p.up.z * cp;
    propPosTmp.x = p.pos.x + p.forward.x * 3.28;
    propPosTmp.y = p.pos.y + p.forward.y * 3.28;
    propPosTmp.z = p.pos.z + p.forward.z * 3.28;
    mat4FromBasis(propMat, propPosTmp, propRightTmp, propUpTmp, p.forward, 1.0);

    // 0. Real-time 2048 shadow map pass from the low warm sun
    if (shadowSupported) {
      updateShadowMatrix(p);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFbo);
      gl.viewport(0, 0, SHADOW_SIZE, SHADOW_SIZE);
      gl.clearColor(1, 1, 1, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(1.5, 2.0);

      gl.useProgram(shadowProg);
      gl.uniformMatrix4fv(shadowLoc.uLightProjView, false, lightProjViewMat);

      gl.uniformMatrix4fv(shadowLoc.uModel, false, identityMat);
      bindPosOnly(terrainGpu, shadowLoc.aPosition);
      gl.drawArrays(gl.TRIANGLES, 0, terrainGpu.vertexCount);

      bindPosOnly(airfieldGpu, shadowLoc.aPosition);
      gl.drawArrays(gl.TRIANGLES, 0, airfieldGpu.vertexCount);

      bindPosOnly(treesGpu, shadowLoc.aPosition);
      gl.drawArrays(gl.TRIANGLES, 0, treesGpu.vertexCount);

      gl.uniformMatrix4fv(shadowLoc.uModel, false, modelMat);
      bindPosOnly(planeGpu, shadowLoc.aPosition);
      gl.drawArrays(gl.TRIANGLES, 0, planeGpu.vertexCount);

      gl.uniformMatrix4fv(shadowLoc.uModel, false, propMat);
      bindPosOnly(propGpu, shadowLoc.aPosition);
      gl.drawArrays(gl.TRIANGLES, 0, propGpu.vertexCount);

      if (shadowLoc.aPosition >= 0) gl.disableVertexAttribArray(shadowLoc.aPosition);
      gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
    }

    gl.clearColor(PALETTE.fogColor[0], PALETTE.fogColor[1], PALETTE.fogColor[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // 1. Sky dome pass (no depth write)
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.useProgram(skyProg);
    gl.bindBuffer(gl.ARRAY_BUFFER, skyQuad);
    gl.enableVertexAttribArray(skyLoc.aPos);
    gl.vertexAttribPointer(skyLoc.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.uniform3f(skyLoc.uCamRight, camR.x, camR.y, camR.z);
    gl.uniform3f(skyLoc.uCamUp, camU.x, camU.y, camU.z);
    gl.uniform3f(skyLoc.uCamForward, camF.x, camF.y, camF.z);
    gl.uniform1f(skyLoc.uTanHalfFov, Math.tan(fovy * 0.5));
    gl.uniform1f(skyLoc.uAspect, aspect);
    gl.uniform3fv(skyLoc.uSunDir, PALETTE.sunDir);
    gl.uniform3fv(skyLoc.uSkyZenith, PALETTE.skyZenith);
    gl.uniform3fv(skyLoc.uSkyMid, PALETTE.skyMid);
    gl.uniform3fv(skyLoc.uSkyHorizon, PALETTE.skyHorizon);
    gl.uniform3fv(skyLoc.uSunColor, PALETTE.sunColor);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (skyLoc.aPos >= 0) gl.disableVertexAttribArray(skyLoc.aPos);

    // 2. Solid opaque geometry with PCF shadows + hemisphere ambient + Blinn-Phong specular
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);

    gl.useProgram(solidProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, shadowTex);
    gl.uniform1i(solidLoc.uShadowMap, 0);
    gl.uniform1f(solidLoc.uShadowEnabled, shadowSupported ? 1.0 : 0.0);
    gl.uniform1f(solidLoc.uShadowTexel, 1.0 / SHADOW_SIZE);
    gl.uniformMatrix4fv(solidLoc.uProjView, false, projViewMat);
    gl.uniformMatrix4fv(solidLoc.uLightProjView, false, lightProjViewMat);
    gl.uniform3f(solidLoc.uCamPos, camState.pos.x, camState.pos.y, camState.pos.z);
    gl.uniform3fv(solidLoc.uSunDir, PALETTE.sunDir);
    gl.uniform3fv(solidLoc.uSunColor, PALETTE.sunColor);
    gl.uniform3fv(solidLoc.uAmbientSky, AMBIENT_SKY_MAUVE);
    gl.uniform3fv(solidLoc.uAmbientGround, AMBIENT_GROUND_WARM);
    gl.uniform3fv(solidLoc.uSkyHorizon, PALETTE.skyHorizon);
    gl.uniform3fv(solidLoc.uFogColor, PALETTE.fogColor);
    gl.uniform1f(solidLoc.uFogDensity, PALETTE.fogDensity);
    gl.uniform1f(solidLoc.uIsAircraft, 0.0);

    // Terrain, Airfield, Trees (identity model)
    gl.uniformMatrix4fv(solidLoc.uModel, false, identityMat);
    gl.uniform1f(solidLoc.uEmissive, 0.0);
    gl.uniform1f(solidLoc.uSpecStrength, 0.04);
    gl.uniform1f(solidLoc.uShininess, 12.0);
    bindSolidMesh(terrainGpu, solidLoc);
    gl.drawArrays(gl.TRIANGLES, 0, terrainGpu.vertexCount);

    gl.uniform1f(solidLoc.uEmissive, 0.02);
    gl.uniform1f(solidLoc.uSpecStrength, 0.14);
    gl.uniform1f(solidLoc.uShininess, 28.0);
    bindSolidMesh(airfieldGpu, solidLoc);
    gl.drawArrays(gl.TRIANGLES, 0, airfieldGpu.vertexCount);

    gl.uniform1f(solidLoc.uEmissive, 0.0);
    gl.uniform1f(solidLoc.uSpecStrength, 0.05);
    gl.uniform1f(solidLoc.uShininess, 14.0);
    bindSolidMesh(treesGpu, solidLoc);
    gl.drawArrays(gl.TRIANGLES, 0, treesGpu.vertexCount);
    disableSolidMesh(solidLoc);

    // 2b. Drifting billowy sunset clouds
    gl.useProgram(cloudProg);
    gl.uniformMatrix4fv(cloudLoc.uProjView, false, projViewMat);
    gl.uniform3f(cloudLoc.uCamPos, camState.pos.x, camState.pos.y, camState.pos.z);
    gl.uniform3fv(cloudLoc.uSunDir, PALETTE.sunDir);
    gl.uniform3fv(cloudLoc.uSunColor, PALETTE.sunColor);
    gl.uniform3fv(cloudLoc.uFogColor, PALETTE.fogColor);
    gl.uniform1f(cloudLoc.uFogDensity, PALETTE.fogDensity);
    gl.uniform2f(cloudLoc.uDrift, state.elapsed * 3.2, state.elapsed * 1.1);
    gl.uniform1f(cloudLoc.uWorldSize, WORLD.size);
    gl.uniform1f(cloudLoc.uWorldHalf, WORLD.half);
    bindSolidMesh(cloudsGpu, cloudLoc);
    gl.bindBuffer(gl.ARRAY_BUFFER, cloudsGpu.centerBuf);
    gl.enableVertexAttribArray(cloudLoc.aCenter);
    gl.vertexAttribPointer(cloudLoc.aCenter, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, cloudsGpu.vertexCount);
    gl.disableVertexAttribArray(cloudLoc.aCenter);
    disableSolidMesh(cloudLoc);

    // 3. Smooth sunset water pass with shimmer ripples & sun glint
    gl.useProgram(waterProg);
    gl.uniformMatrix4fv(waterLoc.uProjView, false, projViewMat);
    gl.uniform3f(waterLoc.uCamPos, camState.pos.x, camState.pos.y, camState.pos.z);
    gl.uniform3fv(waterLoc.uSunDir, PALETTE.sunDir);
    gl.uniform3fv(waterLoc.uSunColor, PALETTE.sunColor);
    gl.uniform3fv(waterLoc.uSkyZenith, PALETTE.skyZenith);
    gl.uniform3fv(waterLoc.uSkyMid, PALETTE.skyMid);
    gl.uniform3fv(waterLoc.uSkyHorizon, PALETTE.skyHorizon);
    gl.uniform3fv(waterLoc.uFogColor, PALETTE.fogColor);
    gl.uniform1f(waterLoc.uFogDensity, PALETTE.fogDensity);
    gl.uniform1f(waterLoc.uTime, state.elapsed);
    bindPosOnly(waterGpu, waterLoc.aPosition);
    gl.drawArrays(gl.TRIANGLES, 0, waterGpu.vertexCount);
    if (waterLoc.aPosition >= 0) gl.disableVertexAttribArray(waterLoc.aPosition);

    // 4. Player aircraft + propeller (paint + canopy specular glint)
    gl.useProgram(solidProg);
    gl.uniformMatrix4fv(solidLoc.uProjView, false, projViewMat);
    gl.uniformMatrix4fv(solidLoc.uModel, false, modelMat);
    gl.uniform1f(solidLoc.uEmissive, 0.02);
    gl.uniform1f(solidLoc.uSpecStrength, 0.48);
    gl.uniform1f(solidLoc.uShininess, 56.0);
    gl.uniform1f(solidLoc.uIsAircraft, 1.0);
    bindSolidMesh(planeGpu, solidLoc);
    gl.drawArrays(gl.TRIANGLES, 0, planeGpu.vertexCount);

    gl.uniformMatrix4fv(solidLoc.uModel, false, propMat);
    gl.uniform1f(solidLoc.uIsAircraft, 0.0);
    gl.uniform1f(solidLoc.uSpecStrength, 0.55);
    gl.uniform1f(solidLoc.uShininess, 64.0);
    bindSolidMesh(propGpu, solidLoc);
    gl.drawArrays(gl.TRIANGLES, 0, propGpu.vertexCount);

    // Fallback ground disc only if shadow map FBO is unavailable
    if (!shadowSupported) {
      const groundY = Math.max(WORLD.waterY, terrainHeight(p.pos.x, p.pos.z));
      const agl = p.pos.y - groundY;
      if (agl < 120) {
        const sScale = clamp(1.15 - agl / 150, 0.35, 1.15);
        fallbackDirTmp.x = p.forward.x;
        fallbackDirTmp.y = 0;
        fallbackDirTmp.z = p.forward.z;
        normalize3(fallbackDirTmp, fallbackDirTmp);
        fallbackRightTmp.x = -fallbackDirTmp.z;
        fallbackRightTmp.y = 0;
        fallbackRightTmp.z = fallbackDirTmp.x;
        fallbackPosTmp.x = p.pos.x;
        fallbackPosTmp.y = groundY + 0.28;
        fallbackPosTmp.z = p.pos.z;
        mat4FromBasis(modelMat, fallbackPosTmp, fallbackRightTmp, dotUpTmp, fallbackDirTmp, sScale);
        gl.uniformMatrix4fv(solidLoc.uModel, false, modelMat);
        gl.uniform1f(solidLoc.uEmissive, -0.15);
        gl.uniform1f(solidLoc.uSpecStrength, 0.0);
        bindSolidMesh(shadowGpu, solidLoc);
        gl.drawArrays(gl.TRIANGLES, 0, shadowGpu.vertexCount);
      }
    }
    disableSolidMesh(solidLoc);

    // 5. Glowing target rings & runway approach / PAPI lights (blended pass, no depth write)
    gl.enable(gl.BLEND);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.useProgram(glowProg);
    gl.uniformMatrix4fv(glowLoc.uProjView, false, projViewMat);
    gl.uniform3f(glowLoc.uCamPos, camState.pos.x, camState.pos.y, camState.pos.z);
    gl.uniform3fv(glowLoc.uFogColor, PALETTE.fogColor);
    gl.uniform1f(glowLoc.uFogDensity, PALETTE.fogDensity);

    // Runway approach dots, threshold/edge lights, and 4-unit PAPI glidepath lights
    drawRunwayLights(state);

    if (state.mode === MODE_MISSION) {
      // Fade out recently passed rings gracefully
      for (let i = 0; i < state.ringsPassed && i < MISSION_RINGS.length; i += 1) {
        const pt = ringFadeState.passTimes[i];
        if (pt >= 0) {
          const dt = state.elapsed - pt;
          if (dt >= 0 && dt < 1.35) {
            const t = dt / 1.35;
            const fadeAlpha = (1 - t) * (1 - t);
            drawLayeredRing(MISSION_RINGS[i], 1.0 + t * 0.18, fadeAlpha, 1.15, true);
          }
        }
      }

      const idx = state.ringsPassed;
      if (idx < MISSION_RINGS.length) {
        // Active target ring: slim warm amber glowing core + soft additive halo shells
        const pulse = 1.05 + 0.12 * Math.sin(state.elapsed * 4.5);
        drawLayeredRing(MISSION_RINGS[idx], 1.0, 1.0, pulse, true);

        // Next-ring preview: dimmer and smaller
        if (idx + 1 < MISSION_RINGS.length) {
          drawLayeredRing(MISSION_RINGS[idx + 1], 0.72, 0.30, 0.85, false);
        }
      }
    }

    disableSolidMesh(glowLoc);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.enable(gl.CULL_FACE);
  }

  function drawRingShell(gpu, ring, scale, tint, alpha, pulse, falloff) {
    ringFwdTmp.x = Math.sin(ring.heading);
    ringFwdTmp.y = 0;
    ringFwdTmp.z = -Math.cos(ring.heading);
    ringRightTmp.x = Math.cos(ring.heading);
    ringRightTmp.y = 0;
    ringRightTmp.z = Math.sin(ring.heading);
    mat4FromBasis(modelMat, ring, ringRightTmp, ringUpTmp, ringFwdTmp, scale);
    gl.uniformMatrix4fv(glowLoc.uModel, false, modelMat);
    gl.uniform3fv(glowLoc.uTint, tint);
    gl.uniform1f(glowLoc.uAlpha, alpha);
    gl.uniform1f(glowLoc.uPulse, pulse);
    gl.uniform1f(glowLoc.uEdgeFalloff, falloff);
    bindSolidMesh(gpu, glowLoc);
    gl.drawArrays(gl.TRIANGLES, 0, gpu.vertexCount);
  }

  function drawLayeredRing(ring, scale, alphaMul, pulse, isActive) {
    // Crisp slim warm-amber core
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    drawRingShell(
      ringCoreGpu,
      ring,
      scale,
      isActive ? [1.0, 0.76, 0.28] : [0.95, 0.62, 0.22],
      (isActive ? 0.92 : 0.62) * alphaMul,
      pulse,
      0.45,
    );

    // Soft additive amber falloff shells
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    drawRingShell(
      ringMidGpu,
      ring,
      scale,
      [1.0, 0.58, 0.14],
      (isActive ? 0.42 : 0.22) * alphaMul,
      pulse,
      1.85,
    );
    if (isActive) {
      drawRingShell(
        ringOuterGpu,
        ring,
        scale,
        [1.0, 0.44, 0.08],
        0.20 * alphaMul,
        pulse,
        2.4,
      );
    }
  }

  function drawLightDot(x, y, z, scale, tint, alpha) {
    dotPosTmp.x = x;
    dotPosTmp.y = y;
    dotPosTmp.z = z;
    mat4FromBasis(modelMat, dotPosTmp, dotRightTmp, dotUpTmp, dotFwdTmp, scale);
    gl.uniformMatrix4fv(glowLoc.uModel, false, modelMat);
    gl.uniform3fv(glowLoc.uTint, tint);
    gl.uniform1f(glowLoc.uAlpha, alpha);
    gl.uniform1f(glowLoc.uPulse, 1.0);
    gl.uniform1f(glowLoc.uEdgeFalloff, 1.35);
    gl.drawArrays(gl.TRIANGLES, 0, lightDotGpu.vertexCount);
  }

  function drawRunwayLights(state) {
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    bindSolidMesh(lightDotGpu, glowLoc);

    const onFinal = state.mode !== MODE_MISSION || state.ringsPassed >= MISSION_RINGS.length;
    const boost = onFinal ? 1.0 + 0.18 * Math.sin(state.elapsed * 4.5) : 0.72;

    // Runway 36 green threshold dots
    for (let x = -20; x <= 20; x += 10) {
      drawLightDot(x, RUNWAY.elevation + 0.85, RUNWAY.zStart, 0.95, [0.35, 1.0, 0.56], 0.85 * boost);
      drawLightDot(x, RUNWAY.elevation + 0.85, RUNWAY.zStart, 2.0, [0.25, 0.95, 0.50], 0.28 * boost);
    }

    // Runway edge & far-end dots
    for (let z = RUNWAY.zEnd; z < RUNWAY.zStart; z += 60) {
      const isFarEnd = z === RUNWAY.zEnd;
      const col = isFarEnd ? [1.0, 0.25, 0.18] : [1.0, 0.82, 0.42];
      drawLightDot(-RUNWAY.halfWidth - 2.2, RUNWAY.elevation + 0.85, z, 0.8, col, 0.75);
      drawLightDot(RUNWAY.halfWidth + 2.2, RUNWAY.elevation + 0.85, z, 0.8, col, 0.75);
    }

    // Lead-in approach light dots south of threshold 36
    for (let i = 0; i < approachDots.length; i += 1) {
      const d = approachDots[i];
      drawLightDot(d.x, d.y, d.z, 0.9, [1.0, 0.78, 0.34], 0.82 * boost);
      drawLightDot(d.x, d.y, d.z, 2.1, [1.0, 0.65, 0.22], 0.24 * boost);
    }

    // PAPI-style 4-unit glidepath lights on left side of Runway 36 touchdown zone
    const dz = Math.max(10, state.plane.pos.z - (RUNWAY.zStart - 75));
    const dy = Math.max(0, state.plane.pos.y - RUNWAY.elevation);
    const angleDeg = (Math.atan2(dy, dz) * 180) / Math.PI;
    const thresholds = [4.4, 5.5, 6.8, 8.0];
    for (let k = 0; k < 4; k += 1) {
      const lx = -29 - k * 4.2;
      const ly = RUNWAY.elevation + 1.05;
      const lz = RUNWAY.zStart - 75;
      const isWhite = angleDeg >= thresholds[k];
      const col = isWhite ? [1.0, 0.96, 0.88] : [1.0, 0.22, 0.16];
      drawLightDot(lx, ly, lz, 1.05, col, 0.95);
      drawLightDot(lx, ly, lz, 2.3, col, 0.34);
    }
  }

  return { render, resetCamera };
}
