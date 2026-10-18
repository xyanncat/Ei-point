// Bone map for the Kafka character GLB (D:/3d/star_rail_-_kafka.glb,
// Sketchfab export, SHA-256 880BE2BA…). Every name below was read from the
// actual hierarchy (scripts/inspect-kafka-glb.mjs) and is verified against
// world positions; roles that could not be verified from data alone
// (eyelids, expressions) are absent on purpose.
import type { Object3D } from "three";

export interface BoneMap {
  hips: Object3D;
  spine: Object3D;
  chest: Object3D;
  neck: Object3D;
  head: Object3D;
  shoulderL: Object3D;
  shoulderR: Object3D;
  eyeL: Object3D | null;
  eyeR: Object3D | null;
  /** Flat secondary chains, ordered root → tip. Motion is applied per bone
   *  relative to each bone's rest quaternion; children inherit motion through
   *  the transform hierarchy (no double-driving). */
  hairChains: Object3D[][];
  coatChains: Object3D[][];
  sleeveChains: Object3D[][];
  all: Map<string, Object3D>;
}

const AXIAL = {
  hips: "Hips_04",
  spine: "Spine_05",
  chest: "Chest_06",
  neck: "Neck_07",
  head: "Head_08",
  shoulderL: "Left shoulder_0113",
  shoulderR: "Right shoulder_060",
  eyeL: "Eye_L_010",
  eyeR: "Eye_R_09",
};

// Hair chains (names verified; HairB* is the large back mass, A–Z are strands).
const HAIR_CHAINS: string[][] = [
  ["HairB1_JNT_014", "HairB2_JNT_015", "HairB3_JNT_016", "HairB4_JNT_017"],
  ["HairRB_1_JNT_021", "HairRB_2_JNT_022", "HairRB_3_JNT_023"],
  ["HairLB_1_JNT_018", "HairLB_2_JNT_019", "HairLB_3_JNT_020"],
  ["HairJ1_JNT_038", "HairJ2_JNT_039", "HairJ3_JNT_040"],
  ["HairJ5_JNT_043", "HairJ6_JNT_044"],
  ["HairA1_JNT_012", "HairA2_JNT_013"],
  ["HairC1_JNT_024", "HairC2_JNT_025", "HairC3_JNT_026"],
  ["HairH1_JNT_033", "HairH2_JNT_034", "HairH3_JNT_035"],
  ["HairI1_JNT_036", "HairI2_JNT_037"],
  ["HairE1_JNT_029", "HairE2_JNT_030"],
  ["HairG1_JNT_031", "HairG2_JNT_032"],
  ["HairD1_JNT_027", "HairD2_JNT_028"],
  ["HairK1_JNT_041"],
  ["HairW1_JNT_042"],
  ["HairVR_1_JNT_046"],
  ["HairVL_1_JNT_045"],
  ["HairZ_1_JNT_047"],
  ["Yb_1_048", "Yb_2_049", "Yb_3_050", "Yb_4_051", "Yb_5_052", "Yb_6_053"],
  ["Zb_0_1_054", "Zb_1_1_055", "Zb_2_1_056", "Zb_3_1_057", "Zb_4_1_058", "Zb_5_1_059"],
];

export function resolveBoneMap(root: Object3D): BoneMap {
  const all = new Map<string, Object3D>();
  root.traverse((object) => {
    if (object.name) all.set(object.name, object);
  });
  // three's GLTFLoader sanitizes whitespace in node names for animation
  // property binding ("Left shoulder_0113" → "Left_shoulder_0113"); look up
  // raw, underscore-normalized and space-insensitive spellings so the map
  // works against raw and loaded trees alike.
  const spaced = new Map<string, Object3D>();
  for (const [name, object] of all) spaced.set(name.replace(/\s+/g, ""), object);
  const lookup = (name: string): Object3D | undefined =>
    all.get(name) ??
    all.get(name.replace(/\s+/g, "_")) ??
    spaced.get(name.replace(/\s+/g, ""));
  const need = (name: string): Object3D => {
    const bone = lookup(name);
    if (!bone) throw new Error(`Kafka rig changed: joint "${name}" is missing`);
    return bone;
  };
  const chain = (names: string[]): Object3D[] => names.map(need).filter(Boolean);

  // Coat train: Wt_{depth}_{chain}_{uid}. The rig fans 17 chains around the
  // chest (x ±, z −); the center-back and its neighbours carry the big drape.
  const wtChains = new Map<number, { depth: number; bone: Object3D }[]>();
  for (const [name, bone] of all) {
    const match = name.match(/^Wt_(\d+)_(\d+)_/);
    if (!match) continue;
    const chainId = Number(match[2]);
    if (!wtChains.has(chainId)) wtChains.set(chainId, []);
    wtChains.get(chainId)!.push({ depth: Number(match[1]), bone });
  }
  const coatChains = [8, 7, 9, 6, 10, 4, 12]
    .map((id) => (wtChains.get(id) ?? []).sort((a, b) => a.depth - b.depth).map((entry) => entry.bone))
    .filter((bones) => bones.length > 0);

  // Sleeves: Zxz/Yxz = upper arm chains from the shoulders; Xj = front coat
  // flap anchored on the spine; shoulder cuffs (Xk/Zxk) intentionally left
  // static (eight sibling bones per cuff would jitter for no visual gain).
  const byPrefix = (prefix: RegExp): Object3D[] =>
    [...all.entries()]
      .filter(([name]) => prefix.test(name))
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, bone]) => bone);
  const sleeveChains = [
    byPrefix(/^Zxz_\d+_1_/),
    byPrefix(/^Yxz_\d+_1?/),
    byPrefix(/^Xj_\d+_1_/),
  ].filter((bones) => bones.length > 0);

  return {
    hips: need(AXIAL.hips),
    spine: need(AXIAL.spine),
    chest: need(AXIAL.chest),
    neck: need(AXIAL.neck),
    head: need(AXIAL.head),
    shoulderL: need(AXIAL.shoulderL),
    shoulderR: need(AXIAL.shoulderR),
    eyeL: lookup(AXIAL.eyeL) ?? null,
    eyeR: lookup(AXIAL.eyeR) ?? null,
    hairChains: HAIR_CHAINS.map(chain),
    coatChains,
    sleeveChains,
    all,
  };
}
