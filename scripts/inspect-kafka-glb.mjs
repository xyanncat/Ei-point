// Structural inspector for the Kafka character GLB (read-only, zero dependencies).
// Verifies prior inspection claims against the actual file bytes:
// header/chunks, extensions, meshes, materials, textures (PNG dimensions read
// from the binary chunk), skins/joints, node hierarchy with world positions,
// animations, morph targets, and heuristic joint-role candidates.
//
// Usage: node scripts/inspect-kafka-glb.mjs <path-to.glb> [out.json]
import { readFileSync, writeFileSync } from "node:fs";

const src = process.argv[2] ?? "D:/3d/star_rail_-_kafka.glb";
const out = process.argv[3] ?? null;
const buf = readFileSync(src);

// ---------- container ----------
const magic = buf.readUInt32LE(0);
const version = buf.readUInt32LE(4);
const declared = buf.readUInt32LE(8);
const report = { file: src, bytes: buf.length, magic: magic === 0x46546c67 ? "glTF" : magic.toString(16), version, declaredLength: declared };
if (report.magic !== "glTF" || version !== 2) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(1);
}

let offset = 12;
let json = null;
let binStart = 0;
let binLength = 0;
while (offset + 8 <= buf.length) {
  const chunkLength = buf.readUInt32LE(offset);
  const chunkType = buf.readUInt32LE(offset + 4);
  const data = buf.subarray(offset + 8, offset + 8 + chunkLength);
  if (chunkType === 0x4e4f534a) json = JSON.parse(data.toString("utf8"));
  else if (chunkType === 0x004e4942) { binStart = offset + 8; binLength = chunkLength; }
  offset += 8 + chunkLength;
}
const g = json;
report.binChunkBytes = binLength;
report.asset = g.asset;
report.extensionsUsed = g.extensionsUsed ?? [];
report.extensionsRequired = g.extensionsRequired ?? [];
report.scenes = (g.scenes ?? []).length;
report.counts = {
  nodes: (g.nodes ?? []).length,
  meshes: (g.meshes ?? []).length,
  materials: (g.materials ?? []).length,
  textures: (g.textures ?? []).length,
  images: (g.images ?? []).length,
  skins: (g.skins ?? []).length,
  animations: (g.animations ?? []).length,
  accessors: (g.accessors ?? []).length,
  cameras: (g.cameras ?? []).length,
};

// ---------- textures / images ----------
const pngDims = (fileOffset) => {
  const sigOk = buf[binStart + fileOffset] === 0x89 && buf[binStart + fileOffset + 1] === 0x50;
  if (!sigOk) return null;
  return {
    width: buf.readUInt32BE(binStart + fileOffset + 16),
    height: buf.readUInt32BE(binStart + fileOffset + 20),
    colorType: buf[binStart + fileOffset + 25],
    bitDepth: buf[binStart + fileOffset + 24],
  };
};
report.images = (g.images ?? []).map((img, i) => {
  const view = img.bufferView != null ? g.bufferViews[img.bufferView] : null;
  const dims = view ? pngDims(view.byteOffset ?? 0) : null;
  return {
    index: i,
    name: img.name ?? null,
    mimeType: img.mimeType ?? null,
    byteLength: view?.byteLength ?? null,
    dimensions: dims ? `${dims.width}x${dims.height}` : "unknown",
    alpha: dims ? dims.colorType === 6 : null,
  };
});
report.textures = (g.textures ?? []).map((t, i) => ({ index: i, source: t.source, sampler: t.sampler ?? null }));

// ---------- materials ----------
report.materials = (g.materials ?? []).map((m, i) => ({
  index: i,
  name: m.name ?? null,
  unlit: Boolean(m.extensions?.KHR_materials_unlit),
  alphaMode: m.alphaMode ?? "OPAQUE",
  doubleSided: Boolean(m.doubleSided),
  baseColorTexture: m.pbrMetallicRoughness?.baseColorTexture?.index ?? null,
  baseColorFactor: m.pbrMetallicRoughness?.baseColorFactor ?? null,
  normalTexture: m.normalTexture?.index ?? null,
  emissive: m.emissiveTexture?.index ?? null,
  extensions: Object.keys(m.extensions ?? {}),
}));

// ---------- node tree + world transforms ----------
const nodes = g.nodes ?? [];
const parentOf = new Array(nodes.length).fill(-1);
for (let i = 0; i < nodes.length; i++) for (const c of nodes[i].children ?? []) parentOf[c] = i;

// 4x4 column-major multiply
const mul = (a, b) => {
  const r = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let rr = 0; rr < 4; rr++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + rr] * b[c * 4 + k];
    r[c * 4 + rr] = s;
  }
  return r;
};
const fromTRS = (node) => {
  if (node.matrix) return node.matrix.slice();
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
};
const world = new Array(nodes.length).fill(null);
const computeWorld = (i) => {
  if (world[i]) return world[i];
  const local = fromTRS(nodes[i]);
  const p = parentOf[i];
  world[i] = p === -1 ? local : mul(computeWorld(p), local);
  return world[i];
};
const worldPos = (i) => {
  const m = computeWorld(i);
  return [Math.round(m[12] * 1000) / 1000, Math.round(m[13] * 1000) / 1000, Math.round(m[14] * 1000) / 1000];
};
const cleanName = (name) => (name ?? "(unnamed)").replace(/[\u0000-\u001f]/g, "?");
const isReadable = (name) => /^[\x20-\x7e]+$/.test(name ?? "");

// ---------- meshes ----------
report.meshes = (g.meshes ?? []).map((mesh, i) => ({
  index: i,
  name: cleanName(mesh.name),
  readable: isReadable(mesh.name),
  primitives: mesh.primitives.map((p) => ({
    attributes: Object.keys(p.attributes),
    vertexCount: g.accessors[p.attributes.POSITION]?.count ?? null,
    indexCount: p.indices != null ? g.accessors[p.indices]?.count ?? null : null,
    material: p.material ?? null,
    targets: (p.targets ?? []).length,
    hasSkinAttrs: Boolean(p.attributes.JOINTS_0 && p.attributes.WEIGHTS_0),
  })),
  nodeInstances: nodes.map((n, ni) => (n.mesh === i ? ni : -1)).filter((ni) => ni >= 0),
  bboxLocal: mesh.primitives.map((p) => g.accessors[p.attributes.POSITION]?.min && g.accessors[p.attributes.POSITION]?.max
    ? [g.accessors[p.attributes.POSITION].min.map((v) => Math.round(v * 1000) / 1000), g.accessors[p.attributes.POSITION].max.map((v) => Math.round(v * 1000) / 1000)]
    : null),
}));

// ---------- skins ----------
report.skins = (g.skins ?? []).map((skin, i) => ({
  index: i,
  name: skin.name ?? null,
  joints: skin.joints.length,
  skeletonRoot: skin.skeleton ?? null,
  skeletonRootName: skin.skeleton != null ? cleanName(nodes[skin.skeleton].name) : null,
  ibm: skin.inverseBindMatrices ?? null,
}));

const skin = (g.skins ?? [])[0];
if (skin) {
  const jointSet = new Set(skin.joints);
  const jointInfo = skin.joints.map((ji) => {
    const p = worldPos(ji);
    return {
      node: ji,
      name: cleanName(nodes[ji].name),
      readable: isReadable(nodes[ji].name),
      parent: parentOf[ji] >= 0 ? cleanName(nodes[parentOf[ji]].name) : null,
      p,
      children: (nodes[ji].children ?? []).length,
    };
  });
  const byY = [...jointInfo].sort((a, b) => b.p[1] - a.p[1]);
  const minY = byY[byY.length - 1].p[1], maxY = byY[0].p[1];
  const h = maxY - minY;
  report.skinScale = { minY, maxY, height: Math.round(h * 1000) / 1000 };

  // chain from top joint up through parents
  const chainTo = (ji) => { const c = []; let cur = ji; while (cur >= 0) { c.unshift({ node: cur, name: cleanName(nodes[cur].name), p: worldPos(cur) }); cur = parentOf[cur]; } return c; };
  report.topJoint = { name: byY[0].name, p: byY[0].p };
  report.topJointChain = chainTo(byY[0].node).slice(-22);

  report.highest12 = byY.slice(0, 12).map((j) => ({ name: j.name, p: j.p, children: j.children }));
  report.lowest6 = byY.slice(-6).map((j) => ({ name: j.name, p: j.p }));
  const byAbsX = [...jointInfo].sort((a, b) => Math.abs(b.p[0]) - Math.abs(a.p[0]));
  report.widest8 = byAbsX.slice(0, 8).map((j) => ({ name: j.name, p: j.p }));

  // head region: joints within 12% of body height from the top joint position
  const headTop = byY[0].p;
  const r = h * 0.12;
  const headRegion = jointInfo.filter((j) => {
    const dx = j.p[0] - headTop[0], dy = j.p[1] - headTop[1], dz = j.p[2] - headTop[2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz) < r;
  });
  report.headRegionJoints = headRegion
    .map((j) => ({ name: j.name, p: j.p, children: j.children }))
    .slice(0, 80);

  // name vocabulary: which joint names contain letters that hint at roles
  const words = {};
  for (const j of jointInfo) for (const w of j.name.toLowerCase().split(/[^a-z0-9]+/)) if (w) words[w] = (words[w] ?? 0) + 1;
  report.nameVocabularyTop = Object.entries(words).sort((a, b) => b[1] - a[1]).slice(0, 50);

  // longest simple chains among joints (hair/cloth candidates): joints whose subtree is deep
  const depthBelow = (i) => { let d = 0; for (const c of nodes[i].children ?? []) d = Math.max(d, 1 + depthBelow(c)); return d; };
  report.deepestJointChains = jointInfo
    .map((j) => ({ name: j.name, depth: depthBelow(j.node), root: parentOf[j.node] === -1 || !jointSet.has(parentOf[j.node]) }))
    .sort((a, b) => b.depth - a.depth)
    .slice(0, 24);
}

// ---------- animation / morph ----------
report.animations = (g.animations ?? []).map((a) => ({ name: a.name ?? null, channels: a.channels.length, samplers: a.samplers.length }));
report.morphTargetsPresent = (g.meshes ?? []).some((m) => m.primitives.some((p) => (p.targets ?? []).length > 0));

// ---------- garbled names survey ----------
const allNames = nodes.map((n) => n.name ?? "");
report.names = {
  total: allNames.length,
  readable: allNames.filter((n) => isReadable(n)).length,
  garbled: allNames.filter((n) => !isReadable(n)).length,
  garbledSample: allNames.filter((n) => !isReadable(n)).slice(0, 12),
};

console.log(JSON.stringify(report, null, 2));
if (out) writeFileSync(out, JSON.stringify(report, null, 2));
