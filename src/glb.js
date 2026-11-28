// Minimal generic GLB (glTF 2.0 binary) loader for WebGL1.
// Parses GLB chunks, node hierarchies (matrix / TRS), triangle primitives, PBR base color
// factors/textures, and alphaMode (OPAQUE / MASK), expanding meshes into non-indexed
// Float32Array buffers matching the engine's procedural mesh format.

const GLB_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a; // 'JSON'
const CHUNK_BIN = 0x004e4942; // 'BIN\0'

const TYPE_COMPONENTS = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT4: 16,
};

const COMP_BYTE_SIZE = {
  5120: 1, // BYTE
  5121: 1, // UNSIGNED_BYTE
  5122: 2, // SHORT
  5123: 2, // UNSIGNED_SHORT
  5125: 4, // UNSIGNED_INT
  5126: 4, // FLOAT
};

function mat4Identity() {
  const m = new Float32Array(16);
  m[0] = 1;
  m[5] = 1;
  m[10] = 1;
  m[15] = 1;
  return m;
}

function mat4Mul(a, b) {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col += 1) {
    const b0 = b[col * 4];
    const b1 = b[col * 4 + 1];
    const b2 = b[col * 4 + 2];
    const b3 = b[col * 4 + 3];
    out[col * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    out[col * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    out[col * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    out[col * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  return out;
}

function mat4FromTrs(t, r, s) {
  const tx = t ? t[0] : 0;
  const ty = t ? t[1] : 0;
  const tz = t ? t[2] : 0;
  const qx = r ? r[0] : 0;
  const qy = r ? r[1] : 0;
  const qz = r ? r[2] : 0;
  const qw = r ? r[3] : 1;
  const sx = s ? s[0] : 1;
  const sy = s ? s[1] : 1;
  const sz = s ? s[2] : 1;

  const x2 = qx + qx;
  const y2 = qy + qy;
  const z2 = qz + qz;
  const xx = qx * x2;
  const xy = qx * y2;
  const xz = qx * z2;
  const yy = qy * y2;
  const yz = qy * z2;
  const zz = qz * z2;
  const wx = qw * x2;
  const wy = qw * y2;
  const wz = qw * z2;

  const m = new Float32Array(16);
  m[0] = (1 - (yy + zz)) * sx;
  m[1] = (xy + wz) * sx;
  m[2] = (xz - wy) * sx;
  m[3] = 0;

  m[4] = (xy - wz) * sy;
  m[5] = (1 - (xx + zz)) * sy;
  m[6] = (yz + wx) * sy;
  m[7] = 0;

  m[8] = (xz + wy) * sz;
  m[9] = (yz - wx) * sz;
  m[10] = (1 - (xx + yy)) * sz;
  m[11] = 0;

  m[12] = tx;
  m[13] = ty;
  m[14] = tz;
  m[15] = 1;
  return m;
}

/** Upper-left 3x3 inverse-transpose (normal matrix) of a column-major 4x4 matrix. */
function normalMat3FromMat4(m) {
  const a00 = m[0], a01 = m[4], a02 = m[8];
  const a10 = m[1], a11 = m[5], a12 = m[9];
  const a20 = m[2], a21 = m[6], a22 = m[10];

  const c00 = a11 * a22 - a12 * a21;
  const c01 = -(a10 * a22 - a12 * a20);
  const c02 = a10 * a21 - a11 * a20;

  const c10 = -(a01 * a22 - a02 * a21);
  const c11 = a00 * a22 - a02 * a20;
  const c12 = -(a00 * a21 - a01 * a20);

  const c20 = a01 * a12 - a02 * a11;
  const c21 = -(a00 * a12 - a02 * a10);
  const c22 = a00 * a11 - a01 * a10;

  const det = a00 * c00 + a01 * c01 + a02 * c02;
  if (Math.abs(det) < 1e-10) {
    return new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  }
  const invDet = 1 / det;
  // Transpose of cofactor matrix = adjugate; inverse-transpose = cofactor / det
  // Stored column-major for (nMat * n):
  return new Float32Array([
    c00 * invDet, c10 * invDet, c20 * invDet,
    c01 * invDet, c11 * invDet, c21 * invDet,
    c02 * invDet, c12 * invDet, c22 * invDet,
  ]);
}

function readComponent(view, byteOffset, componentType, normalized) {
  switch (componentType) {
    case 5126: // FLOAT
      return view.getFloat32(byteOffset, true);
    case 5123: { // UNSIGNED_SHORT
      const v = view.getUint16(byteOffset, true);
      return normalized ? v / 65535 : v;
    }
    case 5122: { // SHORT
      const v = view.getInt16(byteOffset, true);
      return normalized ? Math.max(-1, v / 32767) : v;
    }
    case 5121: { // UNSIGNED_BYTE
      const v = view.getUint8(byteOffset);
      return normalized ? v / 255 : v;
    }
    case 5120: { // BYTE
      const v = view.getInt8(byteOffset);
      return normalized ? Math.max(-1, v / 127) : v;
    }
    case 5125: // UNSIGNED_INT
      if (normalized) throw new Error('Normalized UNSIGNED_INT accessor is not supported');
      return view.getUint32(byteOffset, true);
    default:
      throw new Error(`Unsupported glTF componentType: ${componentType}`);
  }
}

function readAccessor(gltf, binView, binByteOffset, accessorIdx) {
  const acc = gltf.accessors?.[accessorIdx];
  if (!acc) throw new Error(`Missing accessor ${accessorIdx}`);
  if (acc.sparse) throw new Error('Sparse glTF accessors are not supported');
  if (acc.bufferView === undefined) throw new Error(`Accessor ${accessorIdx} missing bufferView`);

  const bv = gltf.bufferViews?.[acc.bufferView];
  if (!bv) throw new Error(`Missing bufferView ${acc.bufferView}`);
  if ((bv.buffer ?? 0) !== 0) throw new Error('External glTF buffers are not supported in GLB loader');

  const numComp = TYPE_COMPONENTS[acc.type];
  const compSize = COMP_BYTE_SIZE[acc.componentType];
  if (!numComp || !compSize) {
    throw new Error(`Unsupported accessor type=${acc.type} componentType=${acc.componentType}`);
  }

  const elemSize = numComp * compSize;
  const stride = bv.byteStride || elemSize;
  const baseOffset = binByteOffset + (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const count = acc.count;
  const normalized = Boolean(acc.normalized);

  if (acc.componentType === 5126 && stride === elemSize) {
    // Fast path for tightly packed floats when aligned; copy into Float32Array safely
    const out = new Float32Array(count * numComp);
    for (let i = 0; i < count; i += 1) {
      const off = baseOffset + i * stride;
      for (let c = 0; c < numComp; c += 1) {
        out[i * numComp + c] = binView.getFloat32(off + c * 4, true);
      }
    }
    return out;
  }

  const out = acc.type === 'SCALAR' && !normalized && acc.componentType === 5125
    ? new Uint32Array(count)
    : acc.type === 'SCALAR' && !normalized && (acc.componentType === 5123 || acc.componentType === 5121)
      ? new Uint32Array(count)
      : new Float32Array(count * numComp);

  for (let i = 0; i < count; i += 1) {
    const off = baseOffset + i * stride;
    for (let c = 0; c < numComp; c += 1) {
      out[i * numComp + c] = readComponent(binView, off + c * compSize, acc.componentType, normalized);
    }
  }
  return out;
}

function toPotCanvas(img, maxW = 2048, maxH = 2048) {
  const pow2 = (n, cap) => {
    let p = 1;
    while (p * 2 <= cap && Math.abs(p * 2 - n) <= Math.abs(p - n)) p *= 2;
    return Math.min(cap, Math.max(4, p));
  };
  const srcW = img.naturalWidth || img.width || 512;
  const srcH = img.naturalHeight || img.height || 512;
  const w = pow2(srcW, maxW);
  const h = pow2(srcH, maxH);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  return canvas;
}

async function decodeImageFromBlob(blob) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob);
    } catch {
      // Fallback to HTMLImageElement below when createImageBitmap fails in headless environments
    }
  }
  return new Promise((resolve, reject) => {
    if (typeof Image === 'undefined') {
      reject(new Error('No image decoder available'));
      return;
    }
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Image element decode failed'));
    };
    img.src = url;
  });
}

function mapWrapMode(gl, wrap) {
  if (wrap === 10497) return gl.REPEAT;
  if (wrap === 33648) return gl.MIRRORED_REPEAT;
  return gl.CLAMP_TO_EDGE;
}

function mapMagFilter(gl, filter) {
  return filter === 9728 ? gl.NEAREST : gl.LINEAR;
}

function mapMinFilter(gl, filter) {
  switch (filter) {
    case 9728: return gl.NEAREST;
    case 9729: return gl.LINEAR;
    case 9984: return gl.NEAREST_MIPMAP_NEAREST;
    case 9985: return gl.LINEAR_MIPMAP_NEAREST;
    case 9986: return gl.NEAREST_MIPMAP_LINEAR;
    case 9987:
    default:
      return gl.LINEAR_MIPMAP_LINEAR;
  }
}

/**
 * Compute crease-angle smooth vertex normals when a glTF primitive omits NORMAL.
 * Preserves smooth shading on curved hulls while keeping crisp edges on hard creases (>49 deg).
 */
function computeVertexNormalsForIndexedTris(transformedPos, indices, vertCount) {
  const triCount = Math.floor(indices.length / 3);
  const faceNx = new Float32Array(triCount);
  const faceNy = new Float32Array(triCount);
  const faceNz = new Float32Array(triCount);
  const faceArea = new Float32Array(triCount);
  const vertTris = Array.from({ length: vertCount }, () => []);

  for (let t = 0; t < triCount; t += 1) {
    const i0 = indices[t * 3];
    const i1 = indices[t * 3 + 1];
    const i2 = indices[t * 3 + 2];
    const ax = transformedPos[i0 * 3];
    const ay = transformedPos[i0 * 3 + 1];
    const az = transformedPos[i0 * 3 + 2];
    const ux = transformedPos[i1 * 3] - ax;
    const uy = transformedPos[i1 * 3 + 1] - ay;
    const uz = transformedPos[i1 * 3 + 2] - az;
    const vx = transformedPos[i2 * 3] - ax;
    const vy = transformedPos[i2 * 3 + 1] - ay;
    const vz = transformedPos[i2 * 3 + 2] - az;
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    const area = Math.hypot(cx, cy, cz);
    if (area > 1e-10) {
      faceNx[t] = cx / area;
      faceNy[t] = cy / area;
      faceNz[t] = cz / area;
    } else {
      faceNy[t] = 1;
    }
    faceArea[t] = area;
    vertTris[i0].push(t);
    vertTris[i1].push(t);
    vertTris[i2].push(t);
  }

  const outNormals = new Float32Array(triCount * 9);
  const creaseDot = 0.65; // ~49 degrees
  for (let t = 0; t < triCount; t += 1) {
    const fnx = faceNx[t];
    const fny = faceNy[t];
    const fnz = faceNz[t];
    for (let k = 0; k < 3; k += 1) {
      const vIdx = indices[t * 3 + k];
      const inc = vertTris[vIdx];
      let sx = 0;
      let sy = 0;
      let sz = 0;
      for (let j = 0; j < inc.length; j += 1) {
        const t2 = inc[j];
        const dot = fnx * faceNx[t2] + fny * faceNy[t2] + fnz * faceNz[t2];
        if (dot >= creaseDot) {
          const w = faceArea[t2];
          sx += faceNx[t2] * w;
          sy += faceNy[t2] * w;
          sz += faceNz[t2] * w;
        }
      }
      const len = Math.hypot(sx, sy, sz);
      const outOff = (t * 3 + k) * 3;
      if (len > 1e-10) {
        outNormals[outOff] = sx / len;
        outNormals[outOff + 1] = sy / len;
        outNormals[outOff + 2] = sz / len;
      } else {
        outNormals[outOff] = fnx;
        outNormals[outOff + 1] = fny;
        outNormals[outOff + 2] = fnz;
      }
    }
  }
  return outNormals;
}

/**
 * Load a binary glTF 2.0 (.glb) model and convert all mesh primitives to engine parts.
 * @param {WebGLRenderingContext} gl
 * @param {string} url
 * @param {{ transform?: Float32Array|Array<number>|null, isPropPart?: (name: string) => boolean }} [options]
 * @returns {Promise<{ parts: Array<object>, propParts: Array<object>, propHubCenter: { x: number, y: number, z: number } }>}
 */
export async function loadGlb(gl, url, options = {}) {
  const { transform = null, isPropPart = () => false } = options;

  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Failed to fetch GLB (${resp.status}): ${url}`);
  }
  const buffer = await resp.arrayBuffer();
  if (buffer.byteLength < 20) {
    throw new Error(`Invalid GLB (too small): ${url}`);
  }

  const headerView = new DataView(buffer);
  const magic = headerView.getUint32(0, true);
  const version = headerView.getUint32(4, true);
  const totalLength = headerView.getUint32(8, true);
  if (magic !== GLB_MAGIC || version !== 2 || totalLength > buffer.byteLength) {
    throw new Error(`Invalid GLB header: magic=0x${magic.toString(16)} version=${version}`);
  }

  let offset = 12;
  let gltf = null;
  let binOffset = 0;
  let binLength = 0;
  while (offset + 8 <= totalLength) {
    const chunkLen = headerView.getUint32(offset, true);
    const chunkType = headerView.getUint32(offset + 4, true);
    const chunkStart = offset + 8;
    if (chunkStart + chunkLen > totalLength) {
      throw new Error('GLB chunk exceeds file length');
    }
    if (chunkType === CHUNK_JSON) {
      const jsonBytes = new Uint8Array(buffer, chunkStart, chunkLen);
      gltf = JSON.parse(new TextDecoder('utf-8').decode(jsonBytes));
    } else if (chunkType === CHUNK_BIN) {
      binOffset = chunkStart;
      binLength = chunkLen;
    }
    offset = chunkStart + chunkLen;
  }

  if (!gltf) {
    throw new Error('GLB missing JSON chunk');
  }
  const binView = new DataView(buffer, 0, binOffset + binLength);

  // Build and cache WebGL textures per (imageIndex, samplerIndex)
  const textureCache = new Map();
  async function resolveTexture(texIdx) {
    if (texIdx === undefined || texIdx === null) return null;
    const texDef = gltf.textures?.[texIdx];
    if (!texDef || texDef.source === undefined) return null;
    const imgIdx = texDef.source;
    const samplerIdx = texDef.sampler ?? -1;
    const cacheKey = `${imgIdx}:${samplerIdx}`;
    if (textureCache.has(cacheKey)) return textureCache.get(cacheKey);

    const imgDef = gltf.images?.[imgIdx];
    if (!imgDef) return null;

    let glTex = null;
    try {
      let blob;
      if (imgDef.bufferView !== undefined) {
        const bv = gltf.bufferViews?.[imgDef.bufferView];
        if (!bv) throw new Error(`Missing image bufferView ${imgDef.bufferView}`);
        const bytes = new Uint8Array(buffer, binOffset + (bv.byteOffset || 0), bv.byteLength);
        blob = new Blob([bytes], { type: imgDef.mimeType || 'image/png' });
      } else if (typeof imgDef.uri === 'string' && imgDef.uri.startsWith('data:')) {
        const res = await fetch(imgDef.uri);
        blob = await res.blob();
      } else {
        throw new Error('Unsupported external image URI in GLB');
      }

      const decoded = await decodeImageFromBlob(blob);
      const potCanvas = toPotCanvas(decoded);
      if (typeof decoded.close === 'function') decoded.close();

      const sampler = samplerIdx >= 0 ? gltf.samplers?.[samplerIdx] : null;
      const wrapS = sampler?.wrapS !== undefined ? mapWrapMode(gl, sampler.wrapS) : gl.CLAMP_TO_EDGE;
      const wrapT = sampler?.wrapT !== undefined ? mapWrapMode(gl, sampler.wrapT) : gl.CLAMP_TO_EDGE;
      const magFilter = sampler?.magFilter !== undefined ? mapMagFilter(gl, sampler.magFilter) : gl.LINEAR;
      const minFilter = sampler?.minFilter !== undefined ? mapMinFilter(gl, sampler.minFilter) : gl.LINEAR_MIPMAP_LINEAR;

      glTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, glTex);
      // glTF convention: UV (0,0) corresponds to top-left of image
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, potCanvas);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapS);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrapT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, magFilter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, minFilter);
      if (minFilter >= gl.NEAREST_MIPMAP_NEAREST) {
        gl.generateMipmap(gl.TEXTURE_2D);
      }
      gl.bindTexture(gl.TEXTURE_2D, null);
    } catch (err) {
      // Degrade gracefully: keep null texture so part still renders with baseColorFactor
      console.warn(`GLB texture ${imgIdx} upload failed, falling back to base color:`, err);
      glTex = null;
    }

    textureCache.set(cacheKey, glTex);
    return glTex;
  }

  // Pre-resolve materials (validates alphaMode and uploads baseColorTextures)
  const matInfos = [];
  const materials = gltf.materials || [];
  for (let i = 0; i < materials.length; i += 1) {
    const m = materials[i] || {};
    const alphaMode = m.alphaMode || 'OPAQUE';
    if (alphaMode === 'BLEND') {
      throw new Error(`Unsupported glTF alphaMode "BLEND" on material "${m.name || i}"`);
    }
    const alphaCutoff = alphaMode === 'MASK' ? (m.alphaCutoff ?? 0.5) : -1;
    const pbr = m.pbrMetallicRoughness || {};
    const bcf = pbr.baseColorFactor || [1, 1, 1, 1];
    const metallic = pbr.metallicFactor ?? 1.0;
    const roughness = pbr.roughnessFactor ?? 1.0;
    // Note: metallicRoughnessTexture and normalTexture are not sampled in this pass
    // (solid shader uses scalar vertex materials and lacks tangent vectors for normal maps).
    const ef = m.emissiveFactor;
    const emissive = ef ? Math.max(ef[0] || 0, ef[1] || 0, ef[2] || 0) : 0;
    const texture = pbr.baseColorTexture ? await resolveTexture(pbr.baseColorTexture.index) : null;
    matInfos.push({
      color: [bcf[0] ?? 1, bcf[1] ?? 1, bcf[2] ?? 1],
      spec: 0.12 + 0.55 * metallic,
      rough: roughness,
      emissive,
      alphaCutoff,
      texture,
    });
  }

  const defaultMat = {
    color: [1, 1, 1],
    spec: 0.12,
    rough: 1.0,
    emissive: 0,
    alphaCutoff: -1,
    texture: null,
  };

  const parts = [];
  const propParts = [];
  const hubMin = [Infinity, Infinity, Infinity];
  const hubMax = [-Infinity, -Infinity, -Infinity];
  let hasHubBounds = false;

  const rootMatrix = transform ? new Float32Array(transform) : mat4Identity();
  const nodes = gltf.nodes || [];

  function processNode(nodeIdx, parentWorldMat) {
    const node = nodes[nodeIdx];
    if (!node) return;
    const localMat = node.matrix
      ? new Float32Array(node.matrix)
      : mat4FromTrs(node.translation, node.rotation, node.scale);
    const worldMat = mat4Mul(parentWorldMat, localMat);
    const normMat = normalMat3FromMat4(worldMat);

    if (node.mesh !== undefined) {
      const meshDef = gltf.meshes?.[node.mesh];
      if (!meshDef) throw new Error(`Missing mesh ${node.mesh}`);
      const nodeName = node.name || `node_${nodeIdx}`;
      const isProp = Boolean(isPropPart(nodeName));
      const isHub = nodeName === 'PROP_Hub';

      for (let pi = 0; pi < (meshDef.primitives || []).length; pi += 1) {
        const prim = meshDef.primitives[pi];
        const mode = prim.mode ?? 4;
        if (mode !== 4) {
          throw new Error(`Unsupported primitive mode ${mode} on ${nodeName}`);
        }
        const attrs = prim.attributes || {};
        if (attrs.POSITION === undefined) {
          throw new Error(`Primitive missing POSITION on ${nodeName}`);
        }

        const rawPos = readAccessor(gltf, binView, binOffset, attrs.POSITION);
        const vertCount = Math.floor(rawPos.length / 3);
        const transformedPos = new Float32Array(vertCount * 3);

        for (let v = 0; v < vertCount; v += 1) {
          const x = rawPos[v * 3];
          const y = rawPos[v * 3 + 1];
          const z = rawPos[v * 3 + 2];
          const wx = worldMat[0] * x + worldMat[4] * y + worldMat[8] * z + worldMat[12];
          const wy = worldMat[1] * x + worldMat[5] * y + worldMat[9] * z + worldMat[13];
          const wz = worldMat[2] * x + worldMat[6] * y + worldMat[10] * z + worldMat[14];
          transformedPos[v * 3] = wx;
          transformedPos[v * 3 + 1] = wy;
          transformedPos[v * 3 + 2] = wz;
          if (isHub) {
            hasHubBounds = true;
            if (wx < hubMin[0]) hubMin[0] = wx;
            if (wy < hubMin[1]) hubMin[1] = wy;
            if (wz < hubMin[2]) hubMin[2] = wz;
            if (wx > hubMax[0]) hubMax[0] = wx;
            if (wy > hubMax[1]) hubMax[1] = wy;
            if (wz > hubMax[2]) hubMax[2] = wz;
          }
        }

        let indices;
        if (prim.indices !== undefined) {
          indices = readAccessor(gltf, binView, binOffset, prim.indices);
        } else {
          indices = new Uint32Array(vertCount);
          for (let v = 0; v < vertCount; v += 1) indices[v] = v;
        }

        const triVertCount = Math.floor(indices.length / 3) * 3;
        const positions = new Float32Array(triVertCount * 3);
        const colors = new Float32Array(triVertCount * 3);
        const materialsOut = new Float32Array(triVertCount * 3);
        const uvs = new Float32Array(triVertCount * 2);

        const rawUvs = attrs.TEXCOORD_0 !== undefined
          ? readAccessor(gltf, binView, binOffset, attrs.TEXCOORD_0)
          : null;

        let normals;
        if (attrs.NORMAL !== undefined) {
          const rawNorm = readAccessor(gltf, binView, binOffset, attrs.NORMAL);
          const transformedNorm = new Float32Array(vertCount * 3);
          for (let v = 0; v < vertCount; v += 1) {
            const nx = rawNorm[v * 3];
            const ny = rawNorm[v * 3 + 1];
            const nz = rawNorm[v * 3 + 2];
            const rx = normMat[0] * nx + normMat[3] * ny + normMat[6] * nz;
            const ry = normMat[1] * nx + normMat[4] * ny + normMat[7] * nz;
            const rz = normMat[2] * nx + normMat[5] * ny + normMat[8] * nz;
            const len = Math.hypot(rx, ry, rz) || 1;
            transformedNorm[v * 3] = rx / len;
            transformedNorm[v * 3 + 1] = ry / len;
            transformedNorm[v * 3 + 2] = rz / len;
          }
          normals = new Float32Array(triVertCount * 3);
          for (let i = 0; i < triVertCount; i += 1) {
            const vi = indices[i];
            normals[i * 3] = transformedNorm[vi * 3];
            normals[i * 3 + 1] = transformedNorm[vi * 3 + 1];
            normals[i * 3 + 2] = transformedNorm[vi * 3 + 2];
          }
        } else {
          normals = computeVertexNormalsForIndexedTris(transformedPos, indices, vertCount);
        }

        const matInfo = prim.material !== undefined ? (matInfos[prim.material] || defaultMat) : defaultMat;
        for (let i = 0; i < triVertCount; i += 1) {
          const vi = indices[i];
          positions[i * 3] = transformedPos[vi * 3];
          positions[i * 3 + 1] = transformedPos[vi * 3 + 1];
          positions[i * 3 + 2] = transformedPos[vi * 3 + 2];

          colors[i * 3] = matInfo.color[0];
          colors[i * 3 + 1] = matInfo.color[1];
          colors[i * 3 + 2] = matInfo.color[2];

          materialsOut[i * 3] = matInfo.spec;
          materialsOut[i * 3 + 1] = matInfo.rough;
          materialsOut[i * 3 + 2] = matInfo.emissive;

          if (rawUvs) {
            uvs[i * 2] = rawUvs[vi * 2];
            uvs[i * 2 + 1] = rawUvs[vi * 2 + 1];
          }
        }

        const part = {
          name: nodeName,
          isProp,
          texture: matInfo.texture,
          alphaCutoff: matInfo.alphaCutoff,
          mesh: {
            positions,
            normals,
            colors,
            materials: materialsOut,
            uvs,
            vertexCount: triVertCount,
          },
        };
        if (isProp) propParts.push(part);
        else parts.push(part);
      }
    }

    if (Array.isArray(node.children)) {
      for (let c = 0; c < node.children.length; c += 1) {
        processNode(node.children[c], worldMat);
      }
    }
  }

  const sceneIdx = gltf.scene ?? 0;
  const rootNodes = gltf.scenes?.[sceneIdx]?.nodes || nodes.map((_, i) => i);
  for (let i = 0; i < rootNodes.length; i += 1) {
    processNode(rootNodes[i], rootMatrix);
  }

  const propHubCenter = hasHubBounds
    ? {
        x: (hubMin[0] + hubMax[0]) * 0.5,
        y: (hubMin[1] + hubMax[1]) * 0.5,
        z: (hubMin[2] + hubMax[2]) * 0.5,
      }
    : { x: 0, y: 0, z: 0 };

  // Re-center propeller parts around propHubCenter so propMat rotation spins around the hub axis
  if (hasHubBounds && propParts.length > 0) {
    for (let i = 0; i < propParts.length; i += 1) {
      const pos = propParts[i].mesh.positions;
      for (let v = 0; v < pos.length; v += 3) {
        pos[v] -= propHubCenter.x;
        pos[v + 1] -= propHubCenter.y;
        pos[v + 2] -= propHubCenter.z;
      }
    }
  }

  return { parts, propParts, propHubCenter };
}

function parsePartTrailingIndex(name) {
  const m = /(\d+)(?:_[A-Za-z]+)?$/.exec(name || '');
  return m ? Number.parseInt(m[1], 10) : -1;
}

function classifyTreePart(name) {
  if (!name) return 'keep';
  if (name.startsWith('Needle_Card_') || name.startsWith('Leaf_Cluster_')) return 'leaf';
  if (name.startsWith('Branch_') || name.startsWith('Main_Branch_') || name.startsWith('Secondary_Branch_')) return 'branch';
  return 'keep';
}

/**
 * Build alpha-weighted RGB + coverage-preserving mipmaps for alpha-masked foliage textures.
 * Prevents thin needle/leaf cards from darkening (black transparent RGB bleed) or disappearing
 * below alphaCutoff at flight distances where mip levels >= 2 are sampled.
 */
async function upgradeFoliageMipmaps(gl, url, groups) {
  const leafGroups = groups.filter((g) => g.alphaCutoff >= 0 && g.texture);
  if (!leafGroups.length) return;

  const resp = await fetch(url);
  if (!resp.ok) return;
  const buffer = await resp.arrayBuffer();
  const headerView = new DataView(buffer);
  const totalLength = headerView.getUint32(8, true);
  let offset = 12;
  let gltf = null;
  let binOffset = 0;
  while (offset + 8 <= totalLength) {
    const chunkLen = headerView.getUint32(offset, true);
    const chunkType = headerView.getUint32(offset + 4, true);
    const chunkStart = offset + 8;
    if (chunkType === CHUNK_JSON) {
      gltf = JSON.parse(new TextDecoder('utf-8').decode(new Uint8Array(buffer, chunkStart, chunkLen)));
    } else if (chunkType === CHUNK_BIN) {
      binOffset = chunkStart;
    }
    offset = chunkStart + chunkLen;
  }
  if (!gltf) return;

  const maskMat = (gltf.materials || []).find((m) => m?.alphaMode === 'MASK' && m.pbrMetallicRoughness?.baseColorTexture);
  if (!maskMat) return;
  const texDef = gltf.textures?.[maskMat.pbrMetallicRoughness.baseColorTexture.index];
  const imgDef = texDef && gltf.images?.[texDef.source];
  if (!imgDef || imgDef.bufferView === undefined) return;

  const bv = gltf.bufferViews?.[imgDef.bufferView];
  if (!bv) return;
  const bytes = new Uint8Array(buffer, binOffset + (bv.byteOffset || 0), bv.byteLength);
  const blob = new Blob([bytes], { type: imgDef.mimeType || 'image/png' });
  const decoded = await decodeImageFromBlob(blob);
  const potCanvas = toPotCanvas(decoded);
  if (typeof decoded.close === 'function') decoded.close();

  const ctx = potCanvas.getContext('2d');
  let w = potCanvas.width;
  let h = potCanvas.height;
  let cur = new Uint8Array(ctx.getImageData(0, 0, w, h).data);

  for (let gi = 0; gi < leafGroups.length; gi += 1) {
    gl.bindTexture(gl.TEXTURE_2D, leafGroups[gi].texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, cur);

    let lw = w;
    let lh = h;
    let src = cur;
    let level = 1;
    while (lw > 1 || lh > 1) {
      const nw = Math.max(1, lw >> 1);
      const nh = Math.max(1, lh >> 1);
      const dst = new Uint8Array(nw * nh * 4);
      for (let y = 0; y < nh; y += 1) {
        const sy0 = Math.min(lh - 1, y * 2);
        const sy1 = Math.min(lh - 1, y * 2 + 1);
        for (let x = 0; x < nw; x += 1) {
          const sx0 = Math.min(lw - 1, x * 2);
          const sx1 = Math.min(lw - 1, x * 2 + 1);
          const i00 = (sy0 * lw + sx0) * 4;
          const i10 = (sy0 * lw + sx1) * 4;
          const i01 = (sy1 * lw + sx0) * 4;
          const i11 = (sy1 * lw + sx1) * 4;
          const a00 = src[i00 + 3];
          const a10 = src[i10 + 3];
          const a01 = src[i01 + 3];
          const a11 = src[i11 + 3];
          const aSum = a00 + a10 + a01 + a11;
          const dIdx = (y * nw + x) * 4;
          if (aSum > 0) {
            dst[dIdx] = Math.round((src[i00] * a00 + src[i10] * a10 + src[i01] * a01 + src[i11] * a11) / aSum);
            dst[dIdx + 1] = Math.round((src[i00 + 1] * a00 + src[i10 + 1] * a10 + src[i01 + 1] * a01 + src[i11 + 1] * a11) / aSum);
            dst[dIdx + 2] = Math.round((src[i00 + 2] * a00 + src[i10 + 2] * a10 + src[i01 + 2] * a01 + src[i11 + 2] * a11) / aSum);
            const avgA = aSum * 0.25;
            const maxA = Math.max(a00, a10, a01, a11);
            dst[dIdx + 3] = Math.min(255, Math.round(avgA + (maxA - avgA) * 0.76));
          }
        }
      }
      gl.texImage2D(gl.TEXTURE_2D, level, gl.RGBA, nw, nh, 0, gl.RGBA, gl.UNSIGNED_BYTE, dst);
      lw = nw;
      lh = nh;
      src = dst;
      level += 1;
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
  }
}

/**
 * Load a GLB and merge its parts by (texture, alphaCutoff) after deterministic
 * part-level decimation for tree models (foliage cards 1/leafKeep, branches 1/branchKeep, trunk/roots kept).
 * Rejects on load/parse failure so callers can fall back cleanly.
 * @param {WebGLRenderingContext} gl
 * @param {string} url
 * @param {{ leafKeep?: number, branchKeep?: number }} [options]
 * @returns {Promise<Array<{ mesh: object, texture: WebGLTexture|null, alphaCutoff: number, kind: 'bark'|'leaf' }>>}
 */
export async function loadGlbMergedParts(gl, url, { leafKeep = 3, branchKeep = 2 } = {}) {
  const { parts } = await loadGlb(gl, url);
  if (!parts.length) {
    throw new Error(`GLB contained no mesh parts: ${url}`);
  }

  // Sort by name before fallback indexing so decimation is independent of GLB node storage order
  const sorted = parts.slice().sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  let leafCounter = 0;
  let branchCounter = 0;
  const groups = [];

  for (let i = 0; i < sorted.length; i += 1) {
    const part = sorted[i];
    const role = classifyTreePart(part.name);
    if (role === 'leaf') {
      const idx = parsePartTrailingIndex(part.name);
      const sel = idx >= 0 ? idx : leafCounter;
      leafCounter += 1;
      if (leafKeep > 1 && sel % leafKeep !== 0) continue;
    } else if (role === 'branch') {
      const idx = parsePartTrailingIndex(part.name);
      const sel = idx >= 0 ? idx : branchCounter;
      branchCounter += 1;
      if (branchKeep > 1 && sel % branchKeep !== 0) continue;
    }

    let group = null;
    for (let g = 0; g < groups.length; g += 1) {
      if (groups[g].texture === part.texture && groups[g].alphaCutoff === part.alphaCutoff) {
        group = groups[g];
        break;
      }
    }
    if (!group) {
      group = {
        texture: part.texture,
        alphaCutoff: part.alphaCutoff,
        kind: part.alphaCutoff < 0 ? 'bark' : 'leaf',
        parts: [],
        vertexCount: 0,
      };
      groups.push(group);
    }
    group.parts.push(part.mesh);
    group.vertexCount += part.mesh.vertexCount;
  }

  const merged = groups.map((group) => {
    const total = group.vertexCount;
    const positions = new Float32Array(total * 3);
    const normals = new Float32Array(total * 3);
    const colors = new Float32Array(total * 3);
    const materials = new Float32Array(total * 3);
    const uvs = new Float32Array(total * 2);

    let vOff = 0;
    for (let p = 0; p < group.parts.length; p += 1) {
      const m = group.parts[p];
      const vc = m.vertexCount;
      if (vc <= 0) continue;
      positions.set(m.positions, vOff * 3);
      normals.set(m.normals, vOff * 3);
      colors.set(m.colors, vOff * 3);
      materials.set(m.materials, vOff * 3);
      uvs.set(m.uvs, vOff * 2);
      vOff += vc;
    }

    return {
      mesh: { positions, normals, colors, materials, uvs, vertexCount: total },
      texture: group.texture,
      alphaCutoff: group.alphaCutoff,
      kind: group.kind,
    };
  });

  await upgradeFoliageMipmaps(gl, url, merged);
  return merged;
}
