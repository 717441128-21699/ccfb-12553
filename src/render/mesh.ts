// 程序化生成绑定姿态下的人体蒙皮网格：
// 每条骨段一个胶囊几何，顶点按沿骨段的位置绑定近端/远端两块骨，
// 权重线性过渡，形成平滑的关节弯折。所有几何在骨架“模型空间”生成，
// 与 evaluatePose 给出的世界矩阵同一坐标系（根在原点时两者重合）。
import type { BvhData } from '../core/types';
import { mapJoints } from '../bvh/angles';
import { normalize, sub, cross, type Vec3 } from '../core/math';

export interface SkinMesh {
  positions: Float32Array;
  normals: Float32Array;
  weights: Float32Array;   // 每顶点 2 个权重
  boneIdx: Int32Array;     // 每顶点 2 个骨索引
  colors: Float32Array;
  indexCount: number;
  indices: Uint16Array;
  /** 关节球（rig 叠加层）用的骨索引列表 */
  jointBones: number[];
  /** 骨段中心线（画骨架线用）：[近端骨, 远端骨] 对 */
  bonePairs: [number, number][];
}

interface SegmentSpec {
  proximal: number;
  distal: number;
  radius: number;
  color: Vec3;
}

const SKIN: Record<string, Vec3> = {
  torso: [0.62, 0.66, 0.72],
  limbL: [0.35, 0.55, 0.78],
  limbR: [0.78, 0.45, 0.4],
  head: [0.85, 0.72, 0.62],
};

function buildOrthonormal(dir: Vec3): [Vec3, Vec3] {
  const ref: Vec3 = Math.abs(dir[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = normalize(cross(dir, ref));
  const v = normalize(cross(u, dir));
  return [u, v];
}

/** 生成一个从 p0 到 p1 的胶囊（圆柱+两端半球），写入累积缓冲 */
class MeshBuilder {
  positions: number[] = [];
  normals: number[] = [];
  weights: number[] = [];
  boneIdx: number[] = [];
  colors: number[] = [];
  indices: number[] = [];
  private radial = 14;

  private addVertex(p: Vec3, n: Vec3, w0: number, w1: number, b0: number, b1: number, color: Vec3) {
    this.positions.push(...p);
    this.normals.push(...n);
    this.weights.push(w0, w1);
    this.boneIdx.push(b0, b1);
    this.colors.push(...color);
  }

  capsule(p0: Vec3, p1: Vec3, radius: number, b0: number, b1: number, color: Vec3) {
    const dir = normalize(sub(p1, p0));
    const [u, v] = buildOrthonormal(dir);
    const start = this.positions.length / 3;
    const ring = (center: Vec3, wProx: number, capDir: number) => {
      // capDir: -1 近端半球, 0 圆柱环, 1 远端半球
      for (let i = 0; i <= this.radial; i++) {
        const theta = (i / this.radial) * Math.PI * 2;
        const radial: Vec3 = [
          u[0] * Math.cos(theta) + v[0] * Math.sin(theta),
          u[1] * Math.cos(theta) + v[1] * Math.sin(theta),
          u[2] * Math.cos(theta) + v[2] * Math.sin(theta),
        ];
        let p: Vec3;
        let n: Vec3;
        let w = wProx;
        if (capDir === 0) {
          p = [center[0] + radial[0] * radius, center[1] + radial[1] * radius, center[2] + radial[2] * radius];
          n = radial;
        } else {
          // 半球：沿骨轴偏移 radius，形成球面
          const axial = capDir * radius * 0.85;
          const rr = radius * 0.55;
          p = [
            center[0] + dir[0] * axial + radial[0] * rr,
            center[1] + dir[1] * axial + radial[1] * rr,
            center[2] + dir[2] * axial + radial[2] * rr,
          ];
          n = normalize([dir[0] * capDir * 0.8 + radial[0] * 0.6,
                         dir[1] * capDir * 0.8 + radial[1] * 0.6,
                         dir[2] * capDir * 0.8 + radial[2] * 0.6]);
          // 半球顶点完全归属该侧骨
          w = capDir < 0 ? 1 : 0;
        }
        this.addVertex(p, n, w, 1 - w, b0, b1, color);
      }
    };

    // 4 环：近端球、圆柱起、圆柱止、远端球；权重沿段长从 1->0
    ring(p0, 1, -1);
    ring(p0, 0.85, 0);
    ring(p1, 0.15, 0);
    ring(p1, 0, 1);
    const perRing = this.radial + 1;
    for (let r = 0; r < 3; r++) {
      for (let i = 0; i < this.radial; i++) {
        const a = start + r * perRing + i;
        const b = a + 1;
        const c = a + perRing;
        const d = c + 1;
        this.indices.push(a, c, b, b, c, d);
      }
    }
  }

  /** 躯干用椭球（中心、半径），全部绑到骨盆/脊柱的混合 */
  ellipsoid(center: Vec3, scale: Vec3, b0: number, b1: number, w0: number, color: Vec3) {
    const start = this.positions.length / 3;
    const lat = 10;
    const lon = 14;
    for (let la = 0; la <= lat; la++) {
      const phi = (la / lat) * Math.PI;
      for (let lo = 0; lo <= lon; lo++) {
        const theta = (lo / lon) * Math.PI * 2;
        const nx = Math.sin(phi) * Math.cos(theta);
        const ny = Math.cos(phi);
        const nz = Math.sin(phi) * Math.sin(theta);
        const p: Vec3 = [
          center[0] + nx * scale[0],
          center[1] + ny * scale[1],
          center[2] + nz * scale[2],
        ];
        this.addVertex(p, normalize([nx / scale[0], ny / scale[1], nz / scale[2]]),
          w0, 1 - w0, b0, b1, color);
      }
    }
    const per = lon + 1;
    for (let la = 0; la < lat; la++) {
      for (let lo = 0; lo < lon; lo++) {
        const a = start + la * per + lo;
        const b = a + 1;
        const c = a + per;
        const d = c + 1;
        this.indices.push(a, c, b, b, c, d);
      }
    }
  }

  build(): SkinMesh {
    return {
      positions: Float32Array.from(this.positions),
      normals: Float32Array.from(this.normals),
      weights: Float32Array.from(this.weights),
      boneIdx: Int32Array.from(this.boneIdx),
      colors: Float32Array.from(this.colors),
      indices: Uint16Array.from(this.indices),
      indexCount: this.indices.length,
      jointBones: [],
      bonePairs: [],
    };
  }
}

/** 依据 BVH 静止帧（通常是 T-Pose/站立）的实际骨段长度构建蒙皮 */
export function buildSkinMesh(bvh: BvhData, restPositions: Vec3[]): SkinMesh {
  const map = mapJoints(bvh);
  const mb = new MeshBuilder();
  const segments: SegmentSpec[] = [];
  const bonePairs: [number, number][] = [];

  const seg = (prox: number, dist: number, radius: number, color: Vec3) => {
    if (prox < 0 || dist < 0) return;
    segments.push({ proximal: prox, distal: dist, radius, color });
    bonePairs.push([prox, dist]);
  };

  // 下肢（左右异色，便于对比观察）。半径单位与 BVH 数据一致（典型为 cm）。
  seg(map.upLegL, map.legL, 7.5, SKIN.limbL);
  seg(map.legL, map.footL, 6, SKIN.limbL);
  seg(map.upLegR, map.legR, 7.5, SKIN.limbR);
  seg(map.legR, map.footR, 6, SKIN.limbR);
  // 脚：脚踝到脚趾的扁段
  if (map.toeL >= 0) seg(map.footL, map.toeL, 4.5, SKIN.limbL);
  if (map.toeR >= 0) seg(map.footR, map.toeR, 4.5, SKIN.limbR);
  // 上肢
  const armL = bvh.nameToIndex.get('LeftArm') ?? -1;
  const foreL = bvh.nameToIndex.get('LeftForeArm') ?? -1;
  const armR = bvh.nameToIndex.get('RightArm') ?? -1;
  const foreR = bvh.nameToIndex.get('RightForeArm') ?? -1;
  seg(armL, foreL, 4.5, SKIN.torso);
  seg(armR, foreR, 4.5, SKIN.torso);
  const handL = bvh.nameToIndex.get('LeftHand') ?? -1;
  const handR = bvh.nameToIndex.get('RightHand') ?? -1;
  seg(foreL, handL, 3.5, SKIN.torso);
  seg(foreR, handR, 3.5, SKIN.torso);

  // 骨段长度 -> 胶囊位置直接取静止帧关节世界坐标
  const lenOf = (a: number, b: number) => {
    const d = sub(restPositions[b], restPositions[a]);
    return Math.hypot(d[0], d[1], d[2]);
  };

  for (const s of segments) {
    const len = lenOf(s.proximal, s.distal);
    if (len < 1e-6) continue;
    const p0 = restPositions[s.proximal];
    const p1 = restPositions[s.distal];
    mb.capsule(p0, p1, s.radius, s.proximal, s.distal, s.color);
  }

  // 骨盆/躯干椭球（尺寸随骨架量级自适应）
  const spine = bvh.nameToIndex.get('Spine') ?? map.pelvis;
  const spine1 = bvh.nameToIndex.get('Spine1') ?? spine;
  const neck = bvh.nameToIndex.get('Neck') ?? spine1;
  const head = bvh.nameToIndex.get('Head') ?? neck;
  const pelvisPos = restPositions[map.pelvis];
  // 以大腿长为基准估计整体系数量级（cm 数据约 40，m 数据约 0.4）
  const thighLen = map.upLegL >= 0 && map.legL >= 0
    ? Math.hypot(...sub(restPositions[map.legL], restPositions[map.upLegL]))
    : 40;
  const u = thighLen / 40; // 归一化系数：cm 数据≈1
  const shoulderY = restPositions[neck] ? restPositions[neck][1] : pelvisPos[1] + 20 * u;
  mb.ellipsoid(
    [pelvisPos[0], pelvisPos[1] + 6 * u, pelvisPos[2]],
    [16 * u, 11 * u, 12 * u],
    map.pelvis, spine, 0.7, SKIN.torso,
  );
  mb.ellipsoid(
    [pelvisPos[0], (pelvisPos[1] + shoulderY) / 2, pelvisPos[2]],
    [17 * u, Math.max(12 * u, (shoulderY - pelvisPos[1]) / 2), 11 * u],
    spine, spine1, 0.4, SKIN.torso,
  );
  if (head >= 0 && head !== neck) {
    mb.ellipsoid(restPositions[head], [10 * u, 12 * u, 10 * u],
      neck, head, 0.3, SKIN.head);
  }

  const mesh = mb.build();
  mesh.jointBones = [map.pelvis, map.upLegL, map.legL, map.footL, map.upLegR, map.legR, map.footR]
    .filter((x) => x >= 0);
  mesh.bonePairs = bonePairs;
  return mesh;
}
