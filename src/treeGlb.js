// GLB tree template loader and world-space instance batching for hero trees (pine, oak, maple).
// Combines multiple tree placements into 6 static meshes (3 species x bark/leaf) so all 64 hero trees
// render in <= 6 draw calls while keeping alpha-masked leaf cards and bark textures separate.

import { loadGlbMergedParts } from './glb.js';

const TREE_SPECIES = ['pine', 'oak', 'maple'];
const TREE_URLS = {
  pine: './assets/models/pine.glb',
  oak: './assets/models/oak.glb',
  maple: './assets/models/maple.glb',
};

/**
 * Load slimmed GLB templates for pine, oak, and maple in parallel.
 * @param {WebGLRenderingContext} gl
 * @returns {Promise<{ pine: Array<object>, oak: Array<object>, maple: Array<object> }>}
 */
export async function loadTreeGlbTemplates(gl) {
  // Pine needles are thin single cards: keep 1/2 (1/3 reads as a bare pole at flight distance).
  // Oak/maple leaf clusters are broad, 1/3 stays full. Branches 1/2 for all species.
  const [pine, oak, maple] = await Promise.all([
    loadGlbMergedParts(gl, TREE_URLS.pine, { leafKeep: 2, branchKeep: 2 }),
    loadGlbMergedParts(gl, TREE_URLS.oak, { leafKeep: 3, branchKeep: 2 }),
    loadGlbMergedParts(gl, TREE_URLS.maple, { leafKeep: 3, branchKeep: 2 }),
  ]);
  if (!pine.length || !oak.length || !maple.length) {
    throw new Error('Tree GLB templates returned empty part list');
  }
  return { pine, oak, maple };
}

/**
 * Bake hero tree placements into 6 merged meshes keyed by (species, part/material kind).
 * Transform per placement: rotate around +Y by `rot`, uniform scale by `scale`, translate to `(x, y, z)`.
 * Template origin is at root base y=0, so `y` is used as-is without additional offset.
 * @param {{ pine: Array<object>, oak: Array<object>, maple: Array<object> }} templates
 * @param {Array<{ species: 'pine'|'oak'|'maple', x: number, y: number, z: number, scale: number, rot: number, tint: number[] }>} placements
 * @returns {Array<{ mesh: object, texture: WebGLTexture|null, alphaCutoff: number, species: string, kind: string }>}
 */
export function buildGlbTreeMeshes(templates, placements) {
  const bySpecies = { pine: [], oak: [], maple: [] };
  for (let i = 0; i < placements.length; i += 1) {
    const p = placements[i];
    if (bySpecies[p.species]) {
      bySpecies[p.species].push(p);
    }
  }

  const out = [];
  for (let si = 0; si < TREE_SPECIES.length; si += 1) {
    const species = TREE_SPECIES[si];
    const parts = templates[species] || [];
    const list = bySpecies[species];

    for (let pi = 0; pi < parts.length; pi += 1) {
      const tpl = parts[pi];
      const tplMesh = tpl.mesh;
      const tplVerts = tplMesh.vertexCount;
      const totalVerts = list.length * tplVerts;

      const positions = new Float32Array(totalVerts * 3);
      const normals = new Float32Array(totalVerts * 3);
      const colors = new Float32Array(totalVerts * 3);
      const materials = new Float32Array(totalVerts * 3);
      const uvs = new Float32Array(totalVerts * 2);

      const srcPos = tplMesh.positions;
      const srcNorm = tplMesh.normals;
      const srcCol = tplMesh.colors;
      const srcMat = tplMesh.materials;
      const srcUv = tplMesh.uvs;

      for (let ti = 0; ti < list.length; ti += 1) {
        const inst = list[ti];
        const vBase = ti * tplVerts;
        const c = Math.cos(inst.rot);
        const s = Math.sin(inst.rot);
        const sc = inst.scale;
        const tx = inst.x;
        const ty = inst.y;
        const tz = inst.z;
        const tr = inst.tint[0];
        const tg = inst.tint[1];
        const tb = inst.tint[2];

        for (let v = 0; v < tplVerts; v += 1) {
          const i3 = v * 3;
          const d3 = (vBase + v) * 3;

          // Y-axis rotation: x' = c*x + s*z, y' = y, z' = -s*x + c*z
          const vx = srcPos[i3];
          const vy = srcPos[i3 + 1];
          const vz = srcPos[i3 + 2];
          positions[d3] = tx + sc * (c * vx + s * vz);
          positions[d3 + 1] = ty + sc * vy;
          positions[d3 + 2] = tz + sc * (-s * vx + c * vz);

          // Uniform scale preserves normal direction; rotate around Y and re-normalize
          const nx = srcNorm[i3];
          const ny = srcNorm[i3 + 1];
          const nz = srcNorm[i3 + 2];
          const rnx = c * nx + s * nz;
          const rny = ny;
          const rnz = -s * nx + c * nz;
          const len = Math.hypot(rnx, rny, rnz) || 1;
          normals[d3] = rnx / len;
          normals[d3 + 1] = rny / len;
          normals[d3 + 2] = rnz / len;

          colors[d3] = srcCol[i3] * tr;
          colors[d3 + 1] = srcCol[i3 + 1] * tg;
          colors[d3 + 2] = srcCol[i3 + 2] * tb;

          materials[d3] = srcMat[i3];
          materials[d3 + 1] = srcMat[i3 + 1];
          materials[d3 + 2] = srcMat[i3 + 2];

          const i2 = v * 2;
          const d2 = (vBase + v) * 2;
          uvs[d2] = srcUv[i2];
          uvs[d2 + 1] = srcUv[i2 + 1];
        }
      }

      out.push({
        mesh: { positions, normals, colors, materials, uvs, vertexCount: totalVerts },
        texture: tpl.texture,
        alphaCutoff: tpl.alphaCutoff,
        species,
        kind: tpl.kind,
      });
    }
  }

  return out;
}
