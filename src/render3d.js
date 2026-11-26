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
  PLANE_NAV_LIGHTS,
  buildPlaneMesh,
  buildPropDiscMesh,
  buildPropellerMesh,
} from './aircraft.js';
import {
  buildAirfieldMesh,
  buildCloudsMesh,
  buildDetailTextureCanvas,
  buildGroundTextureCanvas,
  buildLightDotMesh,
  buildMountainBandMesh,
  buildRingMesh,
  buildRunwayDecalCanvas,
  buildRunwayDecalsMesh,
  buildRunwayMesh,
  buildRunwayTextureCanvas,
  buildTerrainMesh,
  buildTreesMesh,
  buildVillageMesh,
  buildWaterMesh,
  buildWaterNormalCanvas,
  terrainHeight,
} from './terrain.js';

const SHADOW_SIZE = 2048;
const SHADOW_HALF = 185;
const SHADOW_TEXEL = (SHADOW_HALF * 2) / SHADOW_SIZE;
const AMBIENT_SKY_MAUVE = new Float32Array([0.34, 0.30, 0.43]);
const AMBIENT_GROUND_WARM = new Float32Array([0.23, 0.17, 0.12]);

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
    vec3 mapped = acesFilm(max(col, vec3(0.0)) * 1.08);
    vec3 sCurve = mapped * mapped * (3.0 - 2.0 * mapped);
    mapped = mix(mapped, sCurve, 0.14);
    float luma = dot(mapped, vec3(0.2126, 0.7152, 0.0722));
    return clamp(mix(vec3(luma), mapped, 1.08), 0.0, 1.0);
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
  uniform sampler2D uSkyTex;
  uniform float uHasSkyTex;
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
    vec3 gradCol = mix(uSkyHorizon, uSkyMid, t1);
    gradCol = mix(gradCol, uSkyZenith, t2);

    vec3 col = gradCol;
    if (uHasSkyTex > 0.5) {
      float az = atan(dir.z, dir.x) / 6.2831853 + 0.5;
      float u = az * 2.0;
      float v = clamp(1.0 - pow(clamp(dir.y, 0.0, 1.0), 0.72), 0.03, 0.96);
      vec3 skyPhoto = pow(texture2D(uSkyTex, vec2(u, v)).rgb, vec3(1.38)) * 1.24;
      float aboveHoriz = smoothstep(-0.04, 0.08, dir.y);
      col = mix(uSkyHorizon * 0.95, skyPhoto, aboveHoriz);
    }

    // Horizon warm atmospheric band
    float horizGlow = pow(1.0 - clamp(abs(dir.y), 0.0, 1.0), 5.5);
    col += vec3(0.24, 0.11, 0.03) * horizGlow;

    // Sun disc + warm golden Mie atmospheric aureole (HDR rolled off by ACES)
    float sunDot = max(dot(dir, normalize(uSunDir)), 0.0);
    float halo = pow(sunDot, 3.0) * 0.14 + pow(sunDot, 14.0) * 0.38 + pow(sunDot, 96.0) * 0.90;
    float disc = smoothstep(0.9984, 0.9994, sunDot);
    col += uSunColor * halo;
    col = mix(col, vec3(2.3, 2.0, 1.55), disc);

    gl_FragColor = vec4(gradeAndToneMap(col), 1.0);
  }
`;

const MOUNTAIN_VS = `
  attribute vec3 aPosition;
  attribute vec3 aColor;
  attribute vec2 aUv;
  uniform mat4 uProjView;
  varying vec3 vWorldPos;
  varying vec2 vUv;
  varying float vBandT;
  void main() {
    vWorldPos = aPosition;
    vUv = aUv;
    vBandT = aColor.r;
    gl_Position = uProjView * vec4(aPosition, 1.0);
  }
`;

const MOUNTAIN_FS = `
  precision mediump float;
  varying vec3 vWorldPos;
  varying vec2 vUv;
  varying float vBandT;
  uniform vec3 uCamPos;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform sampler2D uMountainTex;
  ${TONEMAP_GLSL}

  void main() {
    vec3 texCol = pow(texture2D(uMountainTex, vUv).rgb, vec3(1.22)) * 1.12;
    float dist = length(uCamPos - vWorldPos);
    float fog = 1.0 - exp(-pow(dist * uFogDensity * 0.56, 1.65));
    vec3 viewDir = normalize(vWorldPos - uCamPos);
    float sunAmt = pow(max(dot(viewDir, normalize(uSunDir)), 0.0), 5.0);
    vec3 fogCol = mix(uFogColor, uSunColor * 0.96, sunAmt * 0.45);
    vec3 col = mix(texCol, fogCol, clamp(fog * 0.78, 0.0, 0.84));
    // Fade top edge smoothly into the sky dome
    float alpha = 1.0 - smoothstep(0.44, 0.97, vBandT);
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(gradeAndToneMap(col), alpha);
  }
`;

const SOLID_VS = `
  attribute vec3 aPosition;
  attribute vec3 aNormal;
  attribute vec3 aColor;
  attribute vec2 aUv;
  attribute vec3 aMaterial;
  uniform mat4 uProjView;
  uniform mat4 uLightProjView;
  uniform mat4 uModel;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying vec3 vColor;
  varying vec2 vUv;
  varying vec3 vMaterial;
  varying vec4 vLightPos;
  void main() {
    vec4 wp = uModel * vec4(aPosition, 1.0);
    vec3 wn = normalize(mat3(uModel) * aNormal);
    vWorldPos = wp.xyz;
    vNormal = wn;
    vColor = aColor;
    vUv = aUv;
    vMaterial = aMaterial;
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
  varying vec2 vUv;
  varying vec3 vMaterial;
  varying vec4 vLightPos;
  uniform vec3 uCamPos;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uAmbientSky;
  uniform vec3 uAmbientGround;
  uniform vec3 uSkyZenith;
  uniform vec3 uSkyHorizon;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform float uEmissive;
  uniform float uSpecStrength;
  uniform float uShininess;
  uniform float uIsAircraft;
  uniform float uUseVertexMat;
  uniform sampler2D uShadowMap;
  uniform float uShadowEnabled;
  uniform float uShadowTexel;
  uniform sampler2D uAlbedoTex;
  uniform sampler2D uDetailTex;
  uniform sampler2D uPhotoGroundTex;
  uniform float uUseAlbedoTex;
  uniform float uUseDetailTex;
  uniform float uUsePhotoGround;
  uniform float uIsDecal;
  uniform float uDetailScale;
  uniform float uDetailStrength;
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

    float bias = max(0.00095 * (1.0 - ndl), 0.00024);
    float current = proj.z - bias;
    float stepUv = uShadowTexel * 1.65;
    float sum = 0.0;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        float w = (x == 0 && y == 0) ? 4.0 : ((x == 0 || y == 0) ? 2.0 : 1.0);
        vec2 uv = clamp(proj.xy + vec2(float(x), float(y)) * stepUv, 0.0, 1.0);
        float d = unpackDepth(texture2D(uShadowMap, uv));
        if (current > d) sum += w;
      }
    }
    return (sum / 16.0) * fade;
  }

  void main() {
    vec3 n = normalize(vNormal);
    vec3 l = normalize(uSunDir);
    vec3 v = normalize(uCamPos - vWorldPos);
    float ndl = max(dot(n, l), 0.0);

    // Hemisphere ambient: twilight sky fill above, warm ground bounce below
    float hemi = n.y * 0.5 + 0.5;
    vec3 amb = mix(uAmbientGround, uAmbientSky, hemi);

    // Soft 3x3 tent-weighted PCF shadow attenuation on direct sun contribution
    float shadow = sampleShadow(vLightPos, ndl);
    float sunVis = 1.0 - shadow * 0.86;

    // Per-vertex material properties (specStrength, roughness, emissive) when supplied
    float specStr = uSpecStrength;
    float shininess = uShininess;
    float roughness = 0.5;
    float matEmissive = 0.0;
    bool isCanopy = false;
    if (uUseVertexMat > 0.5) {
      specStr = vMaterial.x;
      roughness = clamp(vMaterial.y, 0.02, 0.98);
      shininess = clamp(pow(2.0, (1.0 - roughness) * 7.6), 4.0, 220.0);
      matEmissive = vMaterial.z;
      isCanopy = uIsAircraft > 0.5 && specStr > 0.90 && roughness < 0.12;
    } else if (uIsAircraft > 0.5 && (vColor.b - vColor.r) > 0.18) {
      isCanopy = true;
      specStr = 1.45;
      shininess = 180.0;
      roughness = 0.06;
    }

    // Blinn-Phong specular highlight + dual-lobe clearcoat sheen for glossy aircraft metal
    vec3 h = normalize(l + v);
    float ndh = max(dot(n, h), 0.0);
    float spec = pow(ndh, shininess) * specStr;
    if (uIsAircraft > 0.5 && roughness < 0.35 && !isCanopy) {
      spec += pow(ndh, 160.0) * 0.34;
    }

    float fresnel = pow(1.0 - max(dot(n, v), 0.0), 3.2);
    vec3 albedo = vColor;
    float texAlpha = 1.0;
    if (uUseAlbedoTex > 0.5) {
      vec4 texSample = texture2D(uAlbedoTex, vUv);
      albedo *= texSample.rgb;
      texAlpha = texSample.a;
      if (uIsDecal > 0.5 && texAlpha < 0.04) discard;
    }
    if (uUsePhotoGround > 0.5) {
      vec3 photoGround = pow(texture2D(uPhotoGroundTex, vWorldPos.xz / 680.0).rgb, vec3(1.12)) * 1.32;
      float rockMask = max(1.0 - smoothstep(0.72, 0.87, n.y), smoothstep(95.0, 165.0, vWorldPos.y));
      float shoreMask = 1.0 - smoothstep(0.2, 3.4, vWorldPos.y);
      photoGround = mix(photoGround, vec3(0.68, 0.67, 0.65), clamp(max(rockMask * 0.82, shoreMask * 0.72), 0.0, 0.85));
      albedo *= photoGround;
    }
    float dist = length(uCamPos - vWorldPos);
    if (uUseDetailTex > 0.5) {
      float dFade = 1.0 - smoothstep(260.0, 1650.0, dist);
      float d1 = texture2D(uDetailTex, vWorldPos.xz * uDetailScale).r;
      float d2 = texture2D(uDetailTex, vWorldPos.xz * (uDetailScale * 0.24)).r;
      float dMix = (d1 * 0.62 + d2 * 0.38) * 2.0 - 1.0;
      albedo *= (1.0 + dMix * uDetailStrength * dFade);
    }

    vec3 envRefl = vec3(0.0);
    if (uIsAircraft > 0.5) {
      vec3 reflDir = reflect(-v, n);
      float reflUp = clamp(reflDir.y * 0.5 + 0.5, 0.0, 1.0);
      vec3 skyRefl = mix(uSkyHorizon, uSkyZenith, smoothstep(0.45, 0.92, reflUp));
      envRefl = mix(uAmbientGround * 1.35, skyRefl, smoothstep(0.32, 0.62, reflUp));
      if (isCanopy) {
        albedo = mix(albedo, envRefl, 0.32 + fresnel * 0.56);
      } else if (roughness < 0.35) {
        albedo = mix(albedo, envRefl, fresnel * (1.0 - roughness) * 0.26);
      }
    }

    vec3 directSun = uSunColor * (ndl * 1.40 * albedo + vec3(spec)) * sunVis;
    vec3 lit = albedo * (amb + uEmissive + matEmissive) + directSun;
    if (isCanopy) {
      lit += envRefl * (0.14 + fresnel * 0.22);
    }

    // Subtle sunset rim on sunlit surfaces
    float rim = fresnel * max(dot(-v, l) * 0.5 + 0.5, 0.0);
    lit += uSunColor * rim * (0.15 * sunVis);

    float heightHaze = mix(0.80, 1.12, exp(-max(vWorldPos.y, 0.0) * 0.0022));
    float fog = 1.0 - exp(-pow(dist * uFogDensity * heightHaze, 1.65));
    // Warm sun-scatter tint in fog looking toward sun
    vec3 viewDir = normalize(vWorldPos - uCamPos);
    float sunAmt = pow(max(dot(viewDir, l), 0.0), 5.0);
    vec3 fogCol = mix(uFogColor, uSunColor * 0.96, sunAmt * 0.48);
    vec3 finalCol = mix(lit, fogCol, clamp(fog, 0.0, 1.0));
    gl_FragColor = vec4(gradeAndToneMap(finalCol), uIsDecal > 0.5 ? texAlpha : 1.0);
  }
`;

const WATER_VS = `
  attribute vec3 aPosition;
  attribute vec3 aColor;
  uniform mat4 uProjView;
  varying vec3 vWorldPos;
  varying float vDepth;
  void main() {
    vWorldPos = aPosition;
    vDepth = aColor.r;
    gl_Position = uProjView * vec4(aPosition, 1.0);
  }
`;

const WATER_FS = `
  precision mediump float;
  varying vec3 vWorldPos;
  varying float vDepth;
  uniform vec3 uCamPos;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uSkyZenith;
  uniform vec3 uSkyMid;
  uniform vec3 uSkyHorizon;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform float uTime;
  uniform sampler2D uWaterNormalTex;
  uniform sampler2D uWaterPhotoTex;
  uniform float uHasWaterPhoto;
  uniform vec3 uWaterDeep;
  uniform vec3 uWaterShallow;
  ${TONEMAP_GLSL}

  void main() {
    vec3 l = normalize(uSunDir);
    vec3 v = normalize(uCamPos - vWorldPos);
    float dist = length(uCamPos - vWorldPos);

    // Dual-layer animated procedural normal map ripples (faded cleanly at far distance)
    vec2 uv1 = vWorldPos.xz * 0.014 + vec2(uTime * 0.015, uTime * 0.010);
    vec2 uv2 = vWorldPos.xz * 0.029 + vec2(-uTime * 0.012, uTime * 0.018);
    vec3 n1 = texture2D(uWaterNormalTex, uv1).xzy * 2.0 - 1.0;
    vec3 n2 = texture2D(uWaterNormalTex, uv2).xzy * 2.0 - 1.0;
    float rippleFade = 1.0 - smoothstep(220.0, 1500.0, dist);
    vec3 n = normalize(vec3(
      (n1.x + n2.x * 0.75) * 0.24 * rippleFade,
      1.0,
      (n1.z + n2.z * 0.75) * 0.24 * rippleFade
    ));
    vec3 r = reflect(-v, n);

    // Smoothly reflect sunset sky gradient + warm horizon bounce
    float rh = clamp(r.y, 0.0, 1.0);
    float t1 = smoothstep(0.0, 0.24, rh);
    float t2 = smoothstep(0.20, 0.78, rh);
    vec3 skyRefl = mix(uSkyHorizon, uSkyMid, t1);
    skyRefl = mix(skyRefl, uSkyZenith, t2);
    float horizGlow = pow(1.0 - clamp(abs(r.y), 0.0, 1.0), 4.5);
    skyRefl += vec3(0.26, 0.12, 0.03) * horizGlow;

    float fresnel = clamp(0.14 + 0.86 * pow(1.0 - max(v.y, 0.0), 3.4), 0.0, 1.0);
    vec3 waterBody = mix(uWaterShallow, uWaterDeep, smoothstep(0.0, 0.55, vDepth));
    if (uHasWaterPhoto > 0.5) {
      vec3 w1 = texture2D(uWaterPhotoTex, vWorldPos.xz * 0.0028 + vec2(uTime * 0.007, uTime * 0.005)).rgb;
      vec3 w2 = texture2D(uWaterPhotoTex, vWorldPos.xz * 0.0046 + vec2(-uTime * 0.005, uTime * 0.008)).rgb;
      vec3 photoWater = pow(mix(w1, w2, 0.45), vec3(1.22)) * 1.15;
      waterBody = mix(uWaterShallow, photoWater, smoothstep(0.04, 0.45, vDepth));
    }
    vec3 base = mix(waterBody, skyRefl, fresnel * 0.82);

    // Blinn-Phong sun-glint core + animated micro-wave sparkle streak
    vec3 h = normalize(l + v);
    float ndh = max(dot(n, h), 0.0);
    float sunCore = pow(ndh, 260.0) * 2.10;
    float sunBloom = pow(ndh, 26.0) * 0.40;
    vec2 viewXZ = normalize(vec2(-v.x, -v.z) + vec2(1e-5));
    vec2 sunXZ = normalize(vec2(l.x, l.z) + vec2(1e-5));
    float azAlign = max(dot(viewXZ, sunXZ), 0.0);
    float sparkle = 0.65 + 1.65 * pow(ndh, 36.0);
    float glintPath = pow(azAlign, 18.0) * smoothstep(0.62, 0.02, v.y) * 0.48 * sparkle;
    vec3 col = base + uSunColor * (sunCore + sunBloom + glintPath);

    float fog = 1.0 - exp(-pow(dist * uFogDensity, 1.65));
    float sunAmt = pow(max(dot(-v, l), 0.0), 5.0);
    vec3 fogCol = mix(uFogColor, uSunColor * 0.95, sunAmt * 0.45);
    vec3 finalCol = mix(col, fogCol, clamp(fog, 0.0, 1.0));
    float shoreAlpha = clamp(smoothstep(0.0, 0.15, vDepth) * 0.94 + fresnel * 0.18, 0.0, 1.0);
    gl_FragColor = vec4(gradeAndToneMap(finalCol), shoreAlpha);
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
  uniform sampler2D uDetailTex;
  uniform float uDepthOnly;
  ${TONEMAP_GLSL}

  void main() {
    vec3 n = normalize(vNormal);
    vec3 l = normalize(uSunDir);
    vec3 v = normalize(uCamPos - vWorldPos);
    float ndv = max(dot(n, v), 0.0);

    // Two-octave internal vapor detail for soft photographic puff breakup
    float n1 = texture2D(uDetailTex, vWorldPos.xz * 0.0055 + vec2(vWorldPos.y * 0.004)).r;
    float n2 = texture2D(uDetailTex, vWorldPos.xz * 0.0155 - vec2(vWorldPos.y * 0.008)).r;
    float puffNoise = n1 * 0.65 + n2 * 0.35;

    // Gentle wide Fresnel feathering and natural cloud translucency (no opaque blob / cutoff)
    float fresnelFade = pow(ndv, 1.65);
    float alpha = clamp(fresnelFade * (0.56 + 0.50 * puffNoise) * 0.84, 0.0, 0.86);
    if (uDepthOnly > 0.5) {
      if (alpha < 0.04) discard;
      gl_FragColor = vec4(1.0);
      return;
    }

    // Soft wrap-lit cumulus shading: low contrast between warm-lit crown and luminous base
    float ndl = dot(n, l);
    float sunSide = smoothstep(-0.75, 0.85, ndl * 0.78 + (puffNoise - 0.5) * 0.35);
    float topBias = clamp(n.y * 0.45 + 0.55, 0.0, 1.0);

    vec3 shadowCol = mix(vec3(0.75, 0.73, 0.80), vec3(0.90, 0.87, 0.90), topBias);
    vec3 sunLitCol = mix(vec3(1.02, 0.91, 0.80), vec3(1.08, 1.01, 0.92), topBias);
    vec3 col = mix(shadowCol, sunLitCol, sunSide) * vColor;

    col *= 0.94 + 0.12 * puffNoise;
    float backScatter = pow(max(dot(-v, l), 0.0), 4.0);
    col += uSunColor * (backScatter * (0.20 + 0.18 * (1.0 - ndv)));

    // Thin outer vapor edges brighten via multiple scattering so no dark rim/outline ever forms
    vec3 edgeScatter = mix(vec3(0.92, 0.86, 0.86), sunLitCol, 0.45 + 0.45 * sunSide);
    col = mix(edgeScatter, col, smoothstep(0.05, 0.65, ndv));

    float dist = length(uCamPos - vWorldPos);
    float fog = 1.0 - exp(-pow(dist * uFogDensity * 0.72, 1.65));
    float sunAmt = pow(max(dot(-v, l), 0.0), 5.0);
    vec3 fogCol = mix(uFogColor, uSunColor * 0.95, sunAmt * 0.45);
    vec3 finalCol = mix(col, fogCol, clamp(fog, 0.0, 1.0));
    gl_FragColor = vec4(gradeAndToneMap(finalCol), alpha);
  }
`;

const GLOW_VS = `
  attribute vec3 aPosition;
  attribute vec3 aNormal;
  attribute vec3 aColor;
  attribute vec2 aUv;
  uniform mat4 uProjView;
  uniform mat4 uModel;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying vec3 vColor;
  varying vec2 vUv;
  void main() {
    vec4 wp = uModel * vec4(aPosition, 1.0);
    vWorldPos = wp.xyz;
    vNormal = mat3(uModel) * aNormal;
    vColor = aColor;
    vUv = aUv;
    gl_Position = uProjView * wp;
  }
`;

const GLOW_FS = `
  precision mediump float;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying vec3 vColor;
  varying vec2 vUv;
  uniform vec3 uCamPos;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform float uAlpha;
  uniform float uPulse;
  uniform float uEdgeFalloff;
  uniform float uUseRadialAlpha;
  uniform vec3 uTint;
  ${TONEMAP_GLSL}

  void main() {
    vec3 n = normalize(vNormal);
    vec3 v = normalize(uCamPos - vWorldPos);
    float facing = clamp(abs(dot(n, v)), 0.0, 1.0);
    float falloff = uEdgeFalloff > 0.0 ? pow(facing, uEdgeFalloff) : 1.0;
    float radial = uUseRadialAlpha > 0.5 ? vUv.x : 1.0;
    vec3 col = vColor * uTint * uPulse;
    float dist = length(uCamPos - vWorldPos);
    float fog = 1.0 - exp(-pow(dist * uFogDensity * 0.65, 1.65));
    col = mix(col, uFogColor, clamp(fog * 0.65, 0.0, 1.0));
    gl_FragColor = vec4(acesFilm(col), uAlpha * falloff * radial);
  }
`;

const PARTICLE_VS = `
  attribute vec3 aPosition;
  attribute vec3 aNormal;
  attribute vec4 aColor;
  uniform mat4 uProjView;
  uniform vec3 uCamRight;
  uniform vec3 uCamUp;
  varying vec2 vCorner;
  varying vec4 vColor;
  varying vec3 vWorldPos;
  void main() {
    vec3 wp = aPosition + (uCamRight * aNormal.x + uCamUp * aNormal.y) * aNormal.z;
    vCorner = aNormal.xy;
    vColor = aColor;
    vWorldPos = wp;
    gl_Position = uProjView * vec4(wp, 1.0);
  }
`;

const PARTICLE_FS = `
  precision mediump float;
  varying vec2 vCorner;
  varying vec4 vColor;
  varying vec3 vWorldPos;
  uniform vec3 uCamPos;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  ${TONEMAP_GLSL}

  void main() {
    float r2 = dot(vCorner, vCorner);
    float soft = exp(-r2 * 3.8) * smoothstep(1.0, 0.25, r2);
    float a = vColor.a * soft;
    if (a < 0.005) discard;
    float dist = length(uCamPos - vWorldPos);
    float fog = 1.0 - exp(-pow(dist * uFogDensity * 0.7, 1.65));
    vec3 col = mix(vColor.rgb, uFogColor, clamp(fog * 0.6, 0.0, 1.0));
    gl_FragColor = vec4(gradeAndToneMap(col), a);
  }
`;

const TRAIL_VS = `
  attribute vec3 aPosition;
  attribute vec4 aColor;
  uniform mat4 uProjView;
  varying vec4 vColor;
  varying vec3 vWorldPos;
  void main() {
    vColor = aColor;
    vWorldPos = aPosition;
    gl_Position = uProjView * vec4(aPosition, 1.0);
  }
`;

const TRAIL_FS = `
  precision mediump float;
  varying vec4 vColor;
  varying vec3 vWorldPos;
  uniform vec3 uCamPos;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  ${TONEMAP_GLSL}

  void main() {
    if (vColor.a < 0.004) discard;
    float dist = length(uCamPos - vWorldPos);
    float fog = 1.0 - exp(-pow(dist * uFogDensity * 0.7, 1.65));
    vec3 col = mix(vColor.rgb, uFogColor, clamp(fog * 0.65, 0.0, 1.0));
    gl_FragColor = vec4(gradeAndToneMap(col), vColor.a);
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
  let uvBuf = null;
  let matBuf = null;
  let centerBuf = null;
  if (withNormalAndColor) {
    normBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normBuf);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.normals, gl.STATIC_DRAW);

    colBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, colBuf);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.colors, gl.STATIC_DRAW);
  }
  if (mesh.uvs) {
    uvBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.uvs, gl.STATIC_DRAW);
  }
  if (mesh.materials) {
    matBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, matBuf);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.materials, gl.STATIC_DRAW);
  }
  if (mesh.centers) {
    centerBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, centerBuf);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.centers, gl.STATIC_DRAW);
  }
  return { posBuf, normBuf, colBuf, uvBuf, matBuf, centerBuf, vertexCount: mesh.vertexCount };
}

function buildShadowDiscMesh() {
  const segs = 24;
  const pos = [];
  const norm = [];
  const col = [];
  const uv = [];
  const rx = 5.4;
  const rz = 4.1;
  for (let i = 0; i < segs; i += 1) {
    const a0 = (i / segs) * Math.PI * 2;
    const a1 = ((i + 1) / segs) * Math.PI * 2;
    pos.push(0, 0, 0, Math.cos(a0) * rx, 0, Math.sin(a0) * rz, Math.cos(a1) * rx, 0, Math.sin(a1) * rz);
    norm.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
    col.push(0, 0, 0, 0, 0, 0, 0, 0, 0);
    uv.push(1, 0, 0, 0, 0, 0);
  }
  return {
    positions: new Float32Array(pos),
    normals: new Float32Array(norm),
    colors: new Float32Array(col),
    uvs: new Float32Array(uv),
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
  const mountainProg = createProgram(gl, MOUNTAIN_VS, MOUNTAIN_FS);
  const solidProg = createProgram(gl, SOLID_VS, SOLID_FS);
  const waterProg = createProgram(gl, WATER_VS, WATER_FS);
  const cloudProg = createProgram(gl, CLOUD_VS, CLOUD_FS);
  const glowProg = createProgram(gl, GLOW_VS, GLOW_FS);
  const particleProg = createProgram(gl, PARTICLE_VS, PARTICLE_FS);
  const trailProg = createProgram(gl, TRAIL_VS, TRAIL_FS);

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

  const anisoExt = gl.getExtension('EXT_texture_filter_anisotropic')
    || gl.getExtension('MOZ_EXT_texture_filter_anisotropic')
    || gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
  const maxAniso = anisoExt ? Math.min(8, gl.getParameter(anisoExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT) || 1) : 1;

  function createCanvasTexture(sourceCanvas, wrapS, wrapT = wrapS, useAniso = true) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sourceCanvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapS);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrapT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
    if (useAniso && anisoExt && maxAniso > 1) {
      gl.texParameterf(gl.TEXTURE_2D, anisoExt.TEXTURE_MAX_ANISOTROPY_EXT, maxAniso);
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
    return tex;
  }

  function makeSolidColorCanvas(r, g, b, a = 255) {
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 4;
    const cx = c.getContext('2d');
    cx.fillStyle = `rgba(${r},${g},${b},${a / 255})`;
    cx.fillRect(0, 0, 4, 4);
    return c;
  }

  function toPotCanvas(img, maxW = 2048, maxH = 2048) {
    const pow2 = (n, cap) => {
      let p = 1;
      while (p * 2 <= cap && Math.abs(p * 2 - n) <= Math.abs(p - n)) p *= 2;
      return Math.min(cap, Math.max(4, p));
    };
    const w = pow2(img.naturalWidth || img.width || 1024, maxW);
    const h = pow2(img.naturalHeight || img.height || 1024, maxH);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const cx = c.getContext('2d');
    cx.imageSmoothingEnabled = true;
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(img, 0, 0, w, h);
    return c;
  }

  function loadPhotoTexture(url, fallbackCanvas, wrapS, wrapT, maxW = 2048, maxH = 2048) {
    const stateObj = {
      tex: createCanvasTexture(fallbackCanvas, wrapS, wrapT),
      loaded: false,
    };
    const promise = new Promise((resolve) => {
      if (typeof Image === 'undefined') {
        resolve(stateObj);
        return;
      }
      const img = new Image();
      img.onload = () => {
        const pot = toPotCanvas(img, maxW, maxH);
        gl.bindTexture(gl.TEXTURE_2D, stateObj.tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, pot);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapS);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrapT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.generateMipmap(gl.TEXTURE_2D);
        if (anisoExt && maxAniso > 1) {
          gl.texParameterf(gl.TEXTURE_2D, anisoExt.TEXTURE_MAX_ANISOTROPY_EXT, maxAniso);
        }
        gl.bindTexture(gl.TEXTURE_2D, null);
        stateObj.loaded = true;
        resolve(stateObj);
      };
      img.onerror = () => {
        resolve(stateObj);
      };
      img.src = url;
    });
    return { stateObj, promise };
  }

  const dummyWhiteTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, dummyWhiteTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, null);

  const groundTex = createCanvasTexture(buildGroundTextureCanvas(), gl.CLAMP_TO_EDGE, gl.CLAMP_TO_EDGE);
  const detailTex = createCanvasTexture(buildDetailTextureCanvas(), gl.REPEAT, gl.REPEAT);
  const runwayFallbackCanvas = buildRunwayTextureCanvas();
  const runwayDecalTex = createCanvasTexture(buildRunwayDecalCanvas(), gl.CLAMP_TO_EDGE, gl.CLAMP_TO_EDGE);
  const waterNormalTex = createCanvasTexture(buildWaterNormalCanvas(), gl.REPEAT, gl.REPEAT);

  const skyPhoto = loadPhotoTexture('./assets/tex-sky.jpg', makeSolidColorCanvas(160, 110, 100), gl.MIRRORED_REPEAT, gl.CLAMP_TO_EDGE, 2048, 1024);
  const groundPhoto = loadPhotoTexture('./assets/tex-ground.jpg', makeSolidColorCanvas(180, 185, 160), gl.MIRRORED_REPEAT, gl.MIRRORED_REPEAT, 1024, 1024);
  const waterPhoto = loadPhotoTexture('./assets/tex-water.jpg', makeSolidColorCanvas(32, 74, 88), gl.MIRRORED_REPEAT, gl.MIRRORED_REPEAT, 1024, 1024);
  const mountainPhoto = loadPhotoTexture('./assets/tex-mountains.jpg', makeSolidColorCanvas(115, 100, 96), gl.MIRRORED_REPEAT, gl.CLAMP_TO_EDGE, 2048, 1024);
  const runwayPhoto = loadPhotoTexture('./assets/tex-runway.jpg', runwayFallbackCanvas, gl.CLAMP_TO_EDGE, gl.MIRRORED_REPEAT, 1024, 1024);
  const ready = Promise.all([
    skyPhoto.promise,
    groundPhoto.promise,
    waterPhoto.promise,
    mountainPhoto.promise,
    runwayPhoto.promise,
  ]);

  const terrainGpu = uploadMesh(gl, buildTerrainMesh());
  const waterGpu = uploadMesh(gl, buildWaterMesh(), true);
  const mountainBandGpu = uploadMesh(gl, buildMountainBandMesh());
  const runwayGpu = uploadMesh(gl, buildRunwayMesh());
  const runwayDecalsGpu = uploadMesh(gl, buildRunwayDecalsMesh());
  const airfieldGpu = uploadMesh(gl, buildAirfieldMesh());
  const villageGpu = uploadMesh(gl, buildVillageMesh());
  const treesGpu = uploadMesh(gl, buildTreesMesh(random));
  const cloudsGpu = uploadMesh(gl, buildCloudsMesh(random));
  const planeGpu = uploadMesh(gl, buildPlaneMesh());
  const propGpu = uploadMesh(gl, buildPropellerMesh());
  const propDiscGpu = uploadMesh(gl, buildPropDiscMesh());
  const ringCoreGpu = uploadMesh(gl, buildRingMesh(PLANE.ringRadius, 0.52));
  const ringMidGpu = uploadMesh(gl, buildRingMesh(PLANE.ringRadius, 1.25));
  const ringOuterGpu = uploadMesh(gl, buildRingMesh(PLANE.ringRadius, 2.35));
  const lightDotGpu = uploadMesh(gl, buildLightDotMesh(0.9));
  const shadowGpu = uploadMesh(gl, buildShadowDiscMesh());

  // Dynamic VBOs for wingtip condensation trails & soft particles (ring bursts, touchdown dust)
  const MAX_TRAIL_VERTS = 42 * 2 * 6;
  const trailPosData = new Float32Array(MAX_TRAIL_VERTS * 3);
  const trailColData = new Float32Array(MAX_TRAIL_VERTS * 4);
  const trailPosBuf = gl.createBuffer();
  const trailColBuf = gl.createBuffer();

  const MAX_PARTICLES = 200;
  const MAX_PARTICLE_VERTS = MAX_PARTICLES * 6;
  const partPosData = new Float32Array(MAX_PARTICLE_VERTS * 3);
  const partNormData = new Float32Array(MAX_PARTICLE_VERTS * 3);
  const partColData = new Float32Array(MAX_PARTICLE_VERTS * 4);
  const partPosBuf = gl.createBuffer();
  const partNormBuf = gl.createBuffer();
  const partColBuf = gl.createBuffer();

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
    uSkyTex: gl.getUniformLocation(skyProg, 'uSkyTex'),
    uHasSkyTex: gl.getUniformLocation(skyProg, 'uHasSkyTex'),
  };

  const mountainLoc = {
    aPosition: gl.getAttribLocation(mountainProg, 'aPosition'),
    aColor: gl.getAttribLocation(mountainProg, 'aColor'),
    aUv: gl.getAttribLocation(mountainProg, 'aUv'),
    uProjView: gl.getUniformLocation(mountainProg, 'uProjView'),
    uCamPos: gl.getUniformLocation(mountainProg, 'uCamPos'),
    uSunDir: gl.getUniformLocation(mountainProg, 'uSunDir'),
    uSunColor: gl.getUniformLocation(mountainProg, 'uSunColor'),
    uFogColor: gl.getUniformLocation(mountainProg, 'uFogColor'),
    uFogDensity: gl.getUniformLocation(mountainProg, 'uFogDensity'),
    uMountainTex: gl.getUniformLocation(mountainProg, 'uMountainTex'),
  };

  const solidLoc = {
    aPosition: gl.getAttribLocation(solidProg, 'aPosition'),
    aNormal: gl.getAttribLocation(solidProg, 'aNormal'),
    aColor: gl.getAttribLocation(solidProg, 'aColor'),
    aUv: gl.getAttribLocation(solidProg, 'aUv'),
    aMaterial: gl.getAttribLocation(solidProg, 'aMaterial'),
    uProjView: gl.getUniformLocation(solidProg, 'uProjView'),
    uLightProjView: gl.getUniformLocation(solidProg, 'uLightProjView'),
    uModel: gl.getUniformLocation(solidProg, 'uModel'),
    uCamPos: gl.getUniformLocation(solidProg, 'uCamPos'),
    uSunDir: gl.getUniformLocation(solidProg, 'uSunDir'),
    uSunColor: gl.getUniformLocation(solidProg, 'uSunColor'),
    uAmbientSky: gl.getUniformLocation(solidProg, 'uAmbientSky'),
    uAmbientGround: gl.getUniformLocation(solidProg, 'uAmbientGround'),
    uSkyZenith: gl.getUniformLocation(solidProg, 'uSkyZenith'),
    uSkyHorizon: gl.getUniformLocation(solidProg, 'uSkyHorizon'),
    uFogColor: gl.getUniformLocation(solidProg, 'uFogColor'),
    uFogDensity: gl.getUniformLocation(solidProg, 'uFogDensity'),
    uEmissive: gl.getUniformLocation(solidProg, 'uEmissive'),
    uSpecStrength: gl.getUniformLocation(solidProg, 'uSpecStrength'),
    uShininess: gl.getUniformLocation(solidProg, 'uShininess'),
    uIsAircraft: gl.getUniformLocation(solidProg, 'uIsAircraft'),
    uUseVertexMat: gl.getUniformLocation(solidProg, 'uUseVertexMat'),
    uShadowMap: gl.getUniformLocation(solidProg, 'uShadowMap'),
    uShadowEnabled: gl.getUniformLocation(solidProg, 'uShadowEnabled'),
    uShadowTexel: gl.getUniformLocation(solidProg, 'uShadowTexel'),
    uAlbedoTex: gl.getUniformLocation(solidProg, 'uAlbedoTex'),
    uDetailTex: gl.getUniformLocation(solidProg, 'uDetailTex'),
    uPhotoGroundTex: gl.getUniformLocation(solidProg, 'uPhotoGroundTex'),
    uUseAlbedoTex: gl.getUniformLocation(solidProg, 'uUseAlbedoTex'),
    uUseDetailTex: gl.getUniformLocation(solidProg, 'uUseDetailTex'),
    uUsePhotoGround: gl.getUniformLocation(solidProg, 'uUsePhotoGround'),
    uIsDecal: gl.getUniformLocation(solidProg, 'uIsDecal'),
    uDetailScale: gl.getUniformLocation(solidProg, 'uDetailScale'),
    uDetailStrength: gl.getUniformLocation(solidProg, 'uDetailStrength'),
  };

  const waterLoc = {
    aPosition: gl.getAttribLocation(waterProg, 'aPosition'),
    aColor: gl.getAttribLocation(waterProg, 'aColor'),
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
    uWaterNormalTex: gl.getUniformLocation(waterProg, 'uWaterNormalTex'),
    uWaterPhotoTex: gl.getUniformLocation(waterProg, 'uWaterPhotoTex'),
    uHasWaterPhoto: gl.getUniformLocation(waterProg, 'uHasWaterPhoto'),
    uWaterDeep: gl.getUniformLocation(waterProg, 'uWaterDeep'),
    uWaterShallow: gl.getUniformLocation(waterProg, 'uWaterShallow'),
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
    uDetailTex: gl.getUniformLocation(cloudProg, 'uDetailTex'),
    uDepthOnly: gl.getUniformLocation(cloudProg, 'uDepthOnly'),
  };

  const glowLoc = {
    aPosition: gl.getAttribLocation(glowProg, 'aPosition'),
    aNormal: gl.getAttribLocation(glowProg, 'aNormal'),
    aColor: gl.getAttribLocation(glowProg, 'aColor'),
    aUv: gl.getAttribLocation(glowProg, 'aUv'),
    uProjView: gl.getUniformLocation(glowProg, 'uProjView'),
    uModel: gl.getUniformLocation(glowProg, 'uModel'),
    uCamPos: gl.getUniformLocation(glowProg, 'uCamPos'),
    uFogColor: gl.getUniformLocation(glowProg, 'uFogColor'),
    uFogDensity: gl.getUniformLocation(glowProg, 'uFogDensity'),
    uAlpha: gl.getUniformLocation(glowProg, 'uAlpha'),
    uPulse: gl.getUniformLocation(glowProg, 'uPulse'),
    uEdgeFalloff: gl.getUniformLocation(glowProg, 'uEdgeFalloff'),
    uUseRadialAlpha: gl.getUniformLocation(glowProg, 'uUseRadialAlpha'),
    uTint: gl.getUniformLocation(glowProg, 'uTint'),
  };

  const particleLoc = {
    aPosition: gl.getAttribLocation(particleProg, 'aPosition'),
    aNormal: gl.getAttribLocation(particleProg, 'aNormal'),
    aColor: gl.getAttribLocation(particleProg, 'aColor'),
    uProjView: gl.getUniformLocation(particleProg, 'uProjView'),
    uCamRight: gl.getUniformLocation(particleProg, 'uCamRight'),
    uCamUp: gl.getUniformLocation(particleProg, 'uCamUp'),
    uCamPos: gl.getUniformLocation(particleProg, 'uCamPos'),
    uFogColor: gl.getUniformLocation(particleProg, 'uFogColor'),
    uFogDensity: gl.getUniformLocation(particleProg, 'uFogDensity'),
  };

  const trailLoc = {
    aPosition: gl.getAttribLocation(trailProg, 'aPosition'),
    aColor: gl.getAttribLocation(trailProg, 'aColor'),
    uProjView: gl.getUniformLocation(trailProg, 'uProjView'),
    uCamPos: gl.getUniformLocation(trailProg, 'uCamPos'),
    uFogColor: gl.getUniformLocation(trailProg, 'uFogColor'),
    uFogDensity: gl.getUniformLocation(trailProg, 'uFogDensity'),
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

    if (loc.aUv !== undefined && loc.aUv >= 0) {
      if (gpu.uvBuf) {
        gl.bindBuffer(gl.ARRAY_BUFFER, gpu.uvBuf);
        gl.enableVertexAttribArray(loc.aUv);
        gl.vertexAttribPointer(loc.aUv, 2, gl.FLOAT, false, 0, 0);
      } else {
        gl.disableVertexAttribArray(loc.aUv);
        gl.vertexAttrib2f(loc.aUv, 0, 0);
      }
    }

    if (loc.aMaterial !== undefined && loc.aMaterial >= 0) {
      if (gpu.matBuf) {
        gl.bindBuffer(gl.ARRAY_BUFFER, gpu.matBuf);
        gl.enableVertexAttribArray(loc.aMaterial);
        gl.vertexAttribPointer(loc.aMaterial, 3, gl.FLOAT, false, 0, 0);
      } else {
        gl.disableVertexAttribArray(loc.aMaterial);
        gl.vertexAttrib3f(loc.aMaterial, 0, 0, 0);
      }
    }
  }

  function disableSolidMesh(loc) {
    if (loc.aPosition >= 0) gl.disableVertexAttribArray(loc.aPosition);
    if (loc.aNormal >= 0) gl.disableVertexAttribArray(loc.aNormal);
    if (loc.aColor >= 0) gl.disableVertexAttribArray(loc.aColor);
    if (loc.aUv !== undefined && loc.aUv >= 0) gl.disableVertexAttribArray(loc.aUv);
    if (loc.aMaterial !== undefined && loc.aMaterial >= 0) gl.disableVertexAttribArray(loc.aMaterial);
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
    mat4Perspective(projMat, fovy, aspect, 1.0, 13500);
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

      bindPosOnly(villageGpu, shadowLoc.aPosition);
      gl.drawArrays(gl.TRIANGLES, 0, villageGpu.vertexCount);

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

    // 1. Sky dome pass (photo tex-sky.jpg + sun glare & disc, no depth write)
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.useProgram(skyProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, skyPhoto.stateObj.tex);
    gl.uniform1i(skyLoc.uSkyTex, 0);
    gl.uniform1f(skyLoc.uHasSkyTex, skyPhoto.stateObj.loaded ? 1.0 : 0.0);
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

    // 1b. Distant horizon mountain ring (tex-mountains.jpg, top-edge alpha fade into sky)
    if (mountainPhoto.stateObj.loaded) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(mountainProg);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, mountainPhoto.stateObj.tex);
      gl.uniform1i(mountainLoc.uMountainTex, 0);
      gl.uniformMatrix4fv(mountainLoc.uProjView, false, projViewMat);
      gl.uniform3f(mountainLoc.uCamPos, camState.pos.x, camState.pos.y, camState.pos.z);
      gl.uniform3fv(mountainLoc.uSunDir, PALETTE.sunDir);
      gl.uniform3fv(mountainLoc.uSunColor, PALETTE.sunColor);
      gl.uniform3fv(mountainLoc.uFogColor, PALETTE.fogColor);
      gl.uniform1f(mountainLoc.uFogDensity, PALETTE.fogDensity);
      bindPosOnly(mountainBandGpu, mountainLoc.aPosition);
      gl.bindBuffer(gl.ARRAY_BUFFER, mountainBandGpu.colBuf);
      gl.enableVertexAttribArray(mountainLoc.aColor);
      gl.vertexAttribPointer(mountainLoc.aColor, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, mountainBandGpu.uvBuf);
      gl.enableVertexAttribArray(mountainLoc.aUv);
      gl.vertexAttribPointer(mountainLoc.aUv, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, mountainBandGpu.vertexCount);
      if (mountainLoc.aPosition >= 0) gl.disableVertexAttribArray(mountainLoc.aPosition);
      if (mountainLoc.aColor >= 0) gl.disableVertexAttribArray(mountainLoc.aColor);
      if (mountainLoc.aUv >= 0) gl.disableVertexAttribArray(mountainLoc.aUv);
      gl.disable(gl.BLEND);
    }

    // 2. Solid opaque geometry with PCF shadows + hemisphere ambient + Blinn-Phong specular
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);

    gl.useProgram(solidProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, shadowTex);
    gl.uniform1i(solidLoc.uShadowMap, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, groundTex);
    gl.uniform1i(solidLoc.uAlbedoTex, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, detailTex);
    gl.uniform1i(solidLoc.uDetailTex, 2);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, groundPhoto.stateObj.tex);
    gl.uniform1i(solidLoc.uPhotoGroundTex, 3);

    gl.uniform1f(solidLoc.uShadowEnabled, shadowSupported ? 1.0 : 0.0);
    gl.uniform1f(solidLoc.uShadowTexel, 1.0 / SHADOW_SIZE);
    gl.uniformMatrix4fv(solidLoc.uProjView, false, projViewMat);
    gl.uniformMatrix4fv(solidLoc.uLightProjView, false, lightProjViewMat);
    gl.uniform3f(solidLoc.uCamPos, camState.pos.x, camState.pos.y, camState.pos.z);
    gl.uniform3fv(solidLoc.uSunDir, PALETTE.sunDir);
    gl.uniform3fv(solidLoc.uSunColor, PALETTE.sunColor);
    gl.uniform3fv(solidLoc.uAmbientSky, AMBIENT_SKY_MAUVE);
    gl.uniform3fv(solidLoc.uAmbientGround, AMBIENT_GROUND_WARM);
    gl.uniform3fv(solidLoc.uSkyZenith, PALETTE.skyZenith);
    gl.uniform3fv(solidLoc.uSkyHorizon, PALETTE.skyHorizon);
    gl.uniform3fv(solidLoc.uFogColor, PALETTE.fogColor);
    gl.uniform1f(solidLoc.uFogDensity, PALETTE.fogDensity);
    gl.uniform1f(solidLoc.uIsAircraft, 0.0);
    gl.uniform1f(solidLoc.uUseVertexMat, 0.0);
    gl.uniform1f(solidLoc.uIsDecal, 0.0);

    // Terrain (tex-ground.jpg photo base * zone-tint canvas * repeating fine detail texture)
    gl.uniformMatrix4fv(solidLoc.uModel, false, identityMat);
    gl.uniform1f(solidLoc.uEmissive, 0.0);
    gl.uniform1f(solidLoc.uSpecStrength, 0.04);
    gl.uniform1f(solidLoc.uShininess, 12.0);
    gl.uniform1f(solidLoc.uUseAlbedoTex, 1.0);
    gl.uniform1f(solidLoc.uUseDetailTex, 1.0);
    gl.uniform1f(solidLoc.uUsePhotoGround, groundPhoto.stateObj.loaded ? 1.0 : 0.0);
    gl.uniform1f(solidLoc.uDetailScale, 0.055);
    gl.uniform1f(solidLoc.uDetailStrength, 0.28);
    bindSolidMesh(terrainGpu, solidLoc);
    gl.drawArrays(gl.TRIANGLES, 0, terrainGpu.vertexCount);

    // Textured Runway 36 (tex-runway.jpg asphalt + markings + micro-detail)
    gl.uniform1f(solidLoc.uUsePhotoGround, 0.0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, runwayPhoto.stateObj.tex);
    gl.uniform1f(solidLoc.uEmissive, 0.01);
    gl.uniform1f(solidLoc.uSpecStrength, 0.16);
    gl.uniform1f(solidLoc.uShininess, 30.0);
    gl.uniform1f(solidLoc.uUseAlbedoTex, 1.0);
    gl.uniform1f(solidLoc.uUseDetailTex, 1.0);
    gl.uniform1f(solidLoc.uDetailScale, 0.16);
    gl.uniform1f(solidLoc.uDetailStrength, 0.16);
    bindSolidMesh(runwayGpu, solidLoc);
    gl.drawArrays(gl.TRIANGLES, 0, runwayGpu.vertexCount);

    // Transparent Runway 36 & 18 threshold number decals
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, runwayDecalTex);
    gl.uniform1f(solidLoc.uIsDecal, 1.0);
    gl.uniform1f(solidLoc.uUseDetailTex, 0.0);
    bindSolidMesh(runwayDecalsGpu, solidLoc);
    gl.drawArrays(gl.TRIANGLES, 0, runwayDecalsGpu.vertexCount);
    gl.uniform1f(solidLoc.uIsDecal, 0.0);
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    // Airfield buildings, apron, Village & Trees
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, dummyWhiteTex);
    gl.uniform1f(solidLoc.uUseAlbedoTex, 0.0);
    gl.uniform1f(solidLoc.uUseDetailTex, 0.0);

    gl.uniform1f(solidLoc.uEmissive, 0.02);
    gl.uniform1f(solidLoc.uSpecStrength, 0.14);
    gl.uniform1f(solidLoc.uShininess, 28.0);
    bindSolidMesh(airfieldGpu, solidLoc);
    gl.drawArrays(gl.TRIANGLES, 0, airfieldGpu.vertexCount);

    gl.uniform1f(solidLoc.uEmissive, 0.01);
    gl.uniform1f(solidLoc.uSpecStrength, 0.09);
    gl.uniform1f(solidLoc.uShininess, 20.0);
    bindSolidMesh(villageGpu, solidLoc);
    gl.drawArrays(gl.TRIANGLES, 0, villageGpu.vertexCount);

    gl.uniform1f(solidLoc.uEmissive, 0.0);
    gl.uniform1f(solidLoc.uSpecStrength, 0.05);
    gl.uniform1f(solidLoc.uShininess, 14.0);
    bindSolidMesh(treesGpu, solidLoc);
    gl.drawArrays(gl.TRIANGLES, 0, treesGpu.vertexCount);
    disableSolidMesh(solidLoc);

    // 2b. Drifting soft-edged cumulus clouds (depth pre-pass + alpha-blended outer envelope)
    gl.useProgram(cloudProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, detailTex);
    gl.uniform1i(cloudLoc.uDetailTex, 0);
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

    gl.colorMask(false, false, false, false);
    gl.depthMask(true);
    gl.depthFunc(gl.LESS);
    gl.uniform1f(cloudLoc.uDepthOnly, 1.0);
    gl.drawArrays(gl.TRIANGLES, 0, cloudsGpu.vertexCount);

    gl.colorMask(true, true, true, true);
    gl.depthMask(false);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform1f(cloudLoc.uDepthOnly, 0.0);
    gl.drawArrays(gl.TRIANGLES, 0, cloudsGpu.vertexCount);

    gl.depthMask(true);
    gl.depthFunc(gl.LESS);
    gl.disable(gl.BLEND);
    gl.disableVertexAttribArray(cloudLoc.aCenter);
    disableSolidMesh(cloudLoc);

    // 3. Smooth reflective water pass with tex-water.jpg scrolling layers, normal ripples & sun glint
    gl.useProgram(waterProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, waterNormalTex);
    gl.uniform1i(waterLoc.uWaterNormalTex, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, waterPhoto.stateObj.tex);
    gl.uniform1i(waterLoc.uWaterPhotoTex, 1);
    gl.uniform1f(waterLoc.uHasWaterPhoto, waterPhoto.stateObj.loaded ? 1.0 : 0.0);
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
    gl.uniform3fv(waterLoc.uWaterDeep, PALETTE.waterDeep);
    gl.uniform3fv(waterLoc.uWaterShallow, PALETTE.waterShallow);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    bindPosOnly(waterGpu, waterLoc.aPosition);
    gl.bindBuffer(gl.ARRAY_BUFFER, waterGpu.colBuf);
    gl.enableVertexAttribArray(waterLoc.aColor);
    gl.vertexAttribPointer(waterLoc.aColor, 3, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, waterGpu.vertexCount);
    if (waterLoc.aPosition >= 0) gl.disableVertexAttribArray(waterLoc.aPosition);
    if (waterLoc.aColor >= 0) gl.disableVertexAttribArray(waterLoc.aColor);
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    // 4. Player aircraft + propeller (glossy painted metal, Fresnel clearcoat, glass canopy, matte tires)
    gl.useProgram(solidProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, shadowTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, dummyWhiteTex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, dummyWhiteTex);
    gl.uniform1f(solidLoc.uUseAlbedoTex, 0.0);
    gl.uniform1f(solidLoc.uUseDetailTex, 0.0);
    gl.uniform1f(solidLoc.uUseVertexMat, 1.0);
    gl.uniformMatrix4fv(solidLoc.uProjView, false, projViewMat);
    gl.uniformMatrix4fv(solidLoc.uModel, false, modelMat);
    gl.uniform1f(solidLoc.uEmissive, 0.01);
    gl.uniform1f(solidLoc.uSpecStrength, 0.48);
    gl.uniform1f(solidLoc.uShininess, 56.0);
    gl.uniform1f(solidLoc.uIsAircraft, 1.0);
    bindSolidMesh(planeGpu, solidLoc);
    gl.drawArrays(gl.TRIANGLES, 0, planeGpu.vertexCount);

    gl.uniformMatrix4fv(solidLoc.uModel, false, propMat);
    gl.uniform1f(solidLoc.uIsAircraft, 1.0);
    bindSolidMesh(propGpu, solidLoc);
    gl.drawArrays(gl.TRIANGLES, 0, propGpu.vertexCount);
    gl.uniform1f(solidLoc.uUseVertexMat, 0.0);
    disableSolidMesh(solidLoc);

    // 5. Contact shadow, blurred prop disc, nav lights, wingtip trails, particles, rings & runway lights
    gl.enable(gl.BLEND);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.useProgram(glowProg);
    gl.uniformMatrix4fv(glowLoc.uProjView, false, projViewMat);
    gl.uniform3f(glowLoc.uCamPos, camState.pos.x, camState.pos.y, camState.pos.z);
    gl.uniform3fv(glowLoc.uFogColor, PALETTE.fogColor);
    gl.uniform1f(glowLoc.uFogDensity, PALETTE.fogDensity);
    gl.uniform1f(glowLoc.uUseRadialAlpha, 0.0);

    // Soft radial contact shadow / ground AO blob beneath plane when near ground
    const groundY = Math.max(WORLD.waterY, terrainHeight(p.pos.x, p.pos.z));
    const agl = p.pos.y - groundY;
    if (agl < 42) {
      const sScale = clamp(1.05 - agl / 65, 0.45, 1.05);
      const contactAlpha = clamp(1.0 - agl / 42, 0, 1) * (shadowSupported ? 0.34 : 0.46);
      fallbackDirTmp.x = p.forward.x;
      fallbackDirTmp.y = 0;
      fallbackDirTmp.z = p.forward.z;
      normalize3(fallbackDirTmp, fallbackDirTmp);
      fallbackRightTmp.x = -fallbackDirTmp.z;
      fallbackRightTmp.y = 0;
      fallbackRightTmp.z = fallbackDirTmp.x;
      fallbackPosTmp.x = p.pos.x;
      fallbackPosTmp.y = groundY + 0.12;
      fallbackPosTmp.z = p.pos.z;
      mat4FromBasis(modelMat, fallbackPosTmp, fallbackRightTmp, dotUpTmp, fallbackDirTmp, sScale);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniformMatrix4fv(glowLoc.uModel, false, modelMat);
      gl.uniform3f(glowLoc.uTint, 0.0, 0.0, 0.0);
      gl.uniform1f(glowLoc.uAlpha, contactAlpha);
      gl.uniform1f(glowLoc.uPulse, 1.0);
      gl.uniform1f(glowLoc.uEdgeFalloff, 0.0);
      gl.uniform1f(glowLoc.uUseRadialAlpha, 1.0);
      bindSolidMesh(shadowGpu, glowLoc);
      gl.drawArrays(gl.TRIANGLES, 0, shadowGpu.vertexCount);
      gl.uniform1f(glowLoc.uUseRadialAlpha, 0.0);
    }

    // Translucent motion-blurred propeller disc at high RPM
    const enginePower = p.fuel > 0 || state.mode === 'free' || isTitle ? p.throttle : 0;
    const rpmRatio = clamp(enginePower * 0.85 + p.speed * 0.007, 0, 1);
    if (rpmRatio > 0.12) {
      const discAng = propAngle * 0.37;
      const cd = Math.cos(discAng);
      const sd = Math.sin(discAng);
      propRightTmp.x = p.right.x * cd + p.up.x * sd;
      propRightTmp.y = p.right.y * cd + p.up.y * sd;
      propRightTmp.z = p.right.z * cd + p.up.z * sd;
      propUpTmp.x = -p.right.x * sd + p.up.x * cd;
      propUpTmp.y = -p.right.y * sd + p.up.y * cd;
      propUpTmp.z = -p.right.z * sd + p.up.z * cd;
      mat4FromBasis(propMat, propPosTmp, propRightTmp, propUpTmp, p.forward, 1.0);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniformMatrix4fv(glowLoc.uModel, false, propMat);
      gl.uniform3f(glowLoc.uTint, 1.15, 1.10, 1.04);
      gl.uniform1f(glowLoc.uAlpha, lerp(0.06, 0.46, rpmRatio));
      gl.uniform1f(glowLoc.uPulse, 1.0);
      gl.uniform1f(glowLoc.uEdgeFalloff, 0.25);
      gl.uniform1f(glowLoc.uUseRadialAlpha, 1.0);
      bindSolidMesh(propDiscGpu, glowLoc);
      gl.drawArrays(gl.TRIANGLES, 0, propDiscGpu.vertexCount);
      gl.uniform1f(glowLoc.uUseRadialAlpha, 0.0);
    }

    // Aircraft navigation lights, strobe beacon, and landing lamp glow
    drawAircraftLights(state);

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

    // 5b. Wingtip condensation trails & soft particles (ring-pass golden burst, touchdown dust)
    drawWingTrails(state);
    drawParticles(state);

    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.enable(gl.CULL_FACE);
  }

  function drawAircraftLights(state) {
    const p = state.plane;
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    bindSolidMesh(lightDotGpu, glowLoc);
    const beaconPulse = 0.25 + 0.75 * Math.pow(Math.max(0, Math.sin(state.elapsed * 5.2)), 4.0);
    for (let i = 0; i < PLANE_NAV_LIGHTS.length; i += 1) {
      const nl = PLANE_NAV_LIGHTS[i];
      const wx = p.pos.x + p.right.x * nl.x + p.up.x * nl.y - p.forward.x * nl.z;
      const wy = p.pos.y + p.right.y * nl.x + p.up.y * nl.y - p.forward.y * nl.z;
      const wz = p.pos.z + p.right.z * nl.x + p.up.z * nl.y - p.forward.z * nl.z;
      const mul = nl.pulse ? beaconPulse : 1.0;
      drawLightDot(wx, wy, wz, nl.size * 1.15, nl.color, 0.85 * mul);
      drawLightDot(wx, wy, wz, nl.size * 2.6, nl.color, 0.22 * mul);
    }
  }

  function drawWingTrails(state) {
    const samples = state.wingTrail;
    if (!samples || samples.length < 2) return;
    let vCount = 0;
    const now = state.elapsed;

    const pushRibbonVert = (x, y, z, a) => {
      const pPtr = vCount * 3;
      const cPtr = vCount * 4;
      trailPosData[pPtr] = x;
      trailPosData[pPtr + 1] = y;
      trailPosData[pPtr + 2] = z;
      trailColData[cPtr] = 0.96;
      trailColData[cPtr + 1] = 0.94;
      trailColData[cPtr + 2] = 0.90;
      trailColData[cPtr + 3] = a;
      vCount += 1;
    };

    for (const side of [0, 1]) {
      for (let i = 0; i < samples.length - 1; i += 1) {
        const s0 = samples[i];
        const s1 = samples[i + 1];
        if (s0.intensity <= 0.03 && s1.intensity <= 0.03) continue;
        const age0 = clamp((now - s0.t) / 1.45, 0, 1);
        const age1 = clamp((now - s1.t) / 1.45, 0, 1);
        const a0 = (1 - age0) * (1 - age0) * s0.intensity * 0.28;
        const a1 = (1 - age1) * (1 - age1) * s1.intensity * 0.28;
        if (a0 <= 0.004 && a1 <= 0.004) continue;

        const w0 = lerp(0.05, 0.34, age0);
        const w1 = lerp(0.05, 0.34, age1);
        const x0 = side === 0 ? s0.lx : s0.rx;
        const y0 = side === 0 ? s0.ly : s0.ry;
        const z0 = side === 0 ? s0.lz : s0.rz;
        const x1 = side === 0 ? s1.lx : s1.rx;
        const y1 = side === 0 ? s1.ly : s1.ry;
        const z1 = side === 0 ? s1.lz : s1.rz;

        // Horizontal ribbon width perpendicular to segment direction
        let dx = x1 - x0;
        let dz = z1 - z0;
        const dLen = Math.hypot(dx, dz) || 1;
        const px = -dz / dLen;
        const pz = dx / dLen;

        if (vCount + 6 > MAX_TRAIL_VERTS) break;
        pushRibbonVert(x0 - px * w0, y0, z0 - pz * w0, a0);
        pushRibbonVert(x0 + px * w0, y0, z0 + pz * w0, a0);
        pushRibbonVert(x1 + px * w1, y1, z1 + pz * w1, a1);

        pushRibbonVert(x0 - px * w0, y0, z0 - pz * w0, a0);
        pushRibbonVert(x1 + px * w1, y1, z1 + pz * w1, a1);
        pushRibbonVert(x1 - px * w1, y1, z1 - pz * w1, a1);
      }
    }

    if (vCount === 0) return;
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(trailProg);
    gl.uniformMatrix4fv(trailLoc.uProjView, false, projViewMat);
    gl.uniform3f(trailLoc.uCamPos, camState.pos.x, camState.pos.y, camState.pos.z);
    gl.uniform3fv(trailLoc.uFogColor, PALETTE.fogColor);
    gl.uniform1f(trailLoc.uFogDensity, PALETTE.fogDensity);

    gl.bindBuffer(gl.ARRAY_BUFFER, trailPosBuf);
    gl.bufferData(gl.ARRAY_BUFFER, trailPosData.subarray(0, vCount * 3), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(trailLoc.aPosition);
    gl.vertexAttribPointer(trailLoc.aPosition, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, trailColBuf);
    gl.bufferData(gl.ARRAY_BUFFER, trailColData.subarray(0, vCount * 4), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(trailLoc.aColor);
    gl.vertexAttribPointer(trailLoc.aColor, 4, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLES, 0, vCount);
    if (trailLoc.aPosition >= 0) gl.disableVertexAttribArray(trailLoc.aPosition);
    if (trailLoc.aColor >= 0) gl.disableVertexAttribArray(trailLoc.aColor);
  }

  function drawParticles(state) {
    const now = state.elapsed;
    let pCount = 0;

    const emitQuad = (cx, cy, cz, size, r, g, b, a) => {
      if (pCount >= MAX_PARTICLES || a <= 0.004) return;
      const baseV = pCount * 6;
      const corners = [
        [-1, -1], [1, -1], [1, 1],
        [-1, -1], [1, 1], [-1, 1],
      ];
      for (let k = 0; k < 6; k += 1) {
        const vIdx = baseV + k;
        const p3 = vIdx * 3;
        const p4 = vIdx * 4;
        partPosData[p3] = cx;
        partPosData[p3 + 1] = cy;
        partPosData[p3 + 2] = cz;
        partNormData[p3] = corners[k][0];
        partNormData[p3 + 1] = corners[k][1];
        partNormData[p3 + 2] = size;
        partColData[p4] = r;
        partColData[p4 + 1] = g;
        partColData[p4 + 2] = b;
        partColData[p4 + 3] = a;
      }
      pCount += 1;
    };

    // 1. Touchdown & rollout dust puffs (soft translucent alpha blend)
    const dust = state.dustPuffs;
    if (dust && dust.length > 0) {
      for (let i = 0; i < dust.length; i += 1) {
        const d = dust[i];
        const age = now - d.t;
        if (age < 0 || age >= d.life) continue;
        const frac = age / d.life;
        const px = d.x + d.vx * age * (1 - frac * 0.35);
        const py = d.y + d.vy * age * (1 - frac * 0.25);
        const pz = d.z + d.vz * age * (1 - frac * 0.35);
        const sz = d.size * (0.75 + frac * 1.85);
        const fadeIn = frac < 0.14 ? frac / 0.14 : 1.0;
        const alpha = fadeIn * (1 - frac) * (1 - frac) * 0.34;
        emitQuad(px, py, pz, sz, 0.80, 0.70, 0.56, alpha);
      }
      if (pCount > 0) {
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        flushParticles(pCount);
        pCount = 0;
      }
    }

    // 2. Ring-pass golden ember bursts (subtle additive golden shimmer)
    const bursts = state.ringBursts;
    if (bursts && bursts.length > 0) {
      for (let i = 0; i < bursts.length; i += 1) {
        const b = bursts[i];
        const age = now - b.t;
        if (age < 0 || age >= 1.5) continue;
        const frac = age / 1.5;
        const fwdX = Math.sin(b.heading);
        const fwdZ = -Math.cos(b.heading);
        const rightX = Math.cos(b.heading);
        const rightZ = Math.sin(b.heading);
        const motes = 26;
        for (let m = 0; m < motes; m += 1) {
          const ang = (m / motes) * Math.PI * 2 + (m % 3) * 0.19;
          const speed = 10 + (m % 5) * 3.8;
          const rad = PLANE.ringRadius * (0.95 + frac * 0.55) + speed * age * 0.45;
          const ca = Math.cos(ang);
          const sa = Math.sin(ang);
          const drift = (m % 2 === 0 ? 1 : -1) * (4.0 + (m % 4) * 2.5) * age;
          const mx = b.x + rightX * ca * rad + fwdX * drift;
          const my = b.y + sa * rad + age * 1.8;
          const mz = b.z + rightZ * ca * rad + fwdZ * drift;
          const alpha = (1 - frac) * (1 - frac) * 0.85;
          const sz = (1.35 + (m % 3) * 0.55) * (1.0 - frac * 0.35);
          emitQuad(mx, my, mz, sz, 1.30, 0.92, 0.38, alpha);
        }
      }
      if (pCount > 0) {
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
        flushParticles(pCount);
      }
    }
  }

  function flushParticles(pCount) {
    const vCount = pCount * 6;
    gl.useProgram(particleProg);
    gl.uniformMatrix4fv(particleLoc.uProjView, false, projViewMat);
    gl.uniform3f(particleLoc.uCamRight, camR.x, camR.y, camR.z);
    gl.uniform3f(particleLoc.uCamUp, camU.x, camU.y, camU.z);
    gl.uniform3f(particleLoc.uCamPos, camState.pos.x, camState.pos.y, camState.pos.z);
    gl.uniform3fv(particleLoc.uFogColor, PALETTE.fogColor);
    gl.uniform1f(particleLoc.uFogDensity, PALETTE.fogDensity);

    gl.bindBuffer(gl.ARRAY_BUFFER, partPosBuf);
    gl.bufferData(gl.ARRAY_BUFFER, partPosData.subarray(0, vCount * 3), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(particleLoc.aPosition);
    gl.vertexAttribPointer(particleLoc.aPosition, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, partNormBuf);
    gl.bufferData(gl.ARRAY_BUFFER, partNormData.subarray(0, vCount * 3), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(particleLoc.aNormal);
    gl.vertexAttribPointer(particleLoc.aNormal, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, partColBuf);
    gl.bufferData(gl.ARRAY_BUFFER, partColData.subarray(0, vCount * 4), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(particleLoc.aColor);
    gl.vertexAttribPointer(particleLoc.aColor, 4, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLES, 0, vCount);
    if (particleLoc.aPosition >= 0) gl.disableVertexAttribArray(particleLoc.aPosition);
    if (particleLoc.aNormal >= 0) gl.disableVertexAttribArray(particleLoc.aNormal);
    if (particleLoc.aColor >= 0) gl.disableVertexAttribArray(particleLoc.aColor);
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

  return { render, resetCamera, ready };
}
