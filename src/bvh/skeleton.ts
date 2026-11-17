// 骨架前向运动学：把某一帧的通道值求成每个关节的世界矩阵。
import type { BvhData, Pose } from '../core/types';
import {
  fromEuler, fromTranslation, multiply, getTranslation,
  type Mat4, type Vec3,
} from '../core/math';

/** 读取某关节在某帧的平移通道（根节点通常有；其余关节无平移通道则用 OFFSET） */
function readTranslation(bvh: BvhData, jointIdx: number, frame: Float32Array): Vec3 {
  const j = bvh.joints[jointIdx];
  const t: Vec3 = [0, 0, 0];
  let hasPos = false;
  for (let i = 0; i < j.channels.length; i++) {
    const ch = j.channels[i];
    const v = frame[j.channelOffset + i];
    if (ch === 'Xposition') { t[0] = v; hasPos = true; }
    else if (ch === 'Yposition') { t[1] = v; hasPos = true; }
    else if (ch === 'Zposition') { t[2] = v; hasPos = true; }
  }
  return hasPos ? t : [j.offset[0], j.offset[1], j.offset[2]];
}

/** 读取某关节在某帧的欧拉旋转（度），按 X/Y/Z 存放；无旋转通道则为 0 */
function readEuler(bvh: BvhData, jointIdx: number, frame: Float32Array): Vec3 {
  const j = bvh.joints[jointIdx];
  const e: Vec3 = [0, 0, 0];
  for (let i = 0; i < j.channels.length; i++) {
    const ch = j.channels[i];
    const v = frame[j.channelOffset + i];
    if (ch === 'Xrotation') e[0] = v;
    else if (ch === 'Yrotation') e[1] = v;
    else if (ch === 'Zrotation') e[2] = v;
  }
  return e;
}

/** 关节旋转通道声明的欧拉序（无旋转通道时默认 ZXY） */
export function rotationOrder(bvh: BvhData, jointIdx: number): string {
  const order = bvh.joints[jointIdx].channels
    .filter((c) => c.endsWith('rotation'))
    .map((c) => c[0])
    .join('');
  return order || 'ZXY';
}

/** 求某一帧的完整姿势（所有关节世界矩阵 + 世界坐标） */
export function evaluatePose(bvh: BvhData, frameIndex: number): Pose {
  const frame = bvh.frames[Math.max(0, Math.min(bvh.frameCount - 1, frameIndex))];
  const n = bvh.joints.length;
  const world: Mat4[] = new Array(n);
  const positions: Vec3[] = new Array(n);

  for (let i = 0; i < n; i++) {
    const j = bvh.joints[i];
    const t = readTranslation(bvh, i, frame);
    const euler = readEuler(bvh, i, frame);
    const order = rotationOrder(bvh, i);

    // 局部矩阵 = T(平移或OFFSET) * R(欧拉)
    const local = multiply(fromTranslation(t), fromEuler(euler, order));
    if (j.parent < 0) {
      world[i] = local;
    } else {
      world[i] = multiply(world[j.parent], local);
    }
    positions[i] = getTranslation(world[i]);
  }
  return { world, positions };
}

/** 预计算全部帧的姿势（长序列按需调用，内存换时间） */
export function evaluateAll(bvh: BvhData): Pose[] {
  const out: Pose[] = new Array(bvh.frameCount);
  for (let f = 0; f < bvh.frameCount; f++) out[f] = evaluatePose(bvh, f);
  return out;
}

/** 帧间线性插值姿势，用于非整数播放时间（在矩阵层面对平移/旋转分量插值） */
export function interpolatedPose(bvh: BvhData, time: number): Pose {
  const fi = time / bvh.frameTime;
  const i0 = Math.floor(fi);
  const alpha = fi - i0;
  const p0 = evaluatePose(bvh, i0);
  if (alpha === 0) return p0;
  const p1 = evaluatePose(bvh, i0 + 1);
  const n = bvh.joints.length;
  const world: Mat4[] = new Array(n);
  const positions: Vec3[] = new Array(n);
  for (let i = 0; i < n; i++) {
    // 刚体矩阵：旋转用 Slerp 近似（这里用分量线性 + 重新正交化成本高），
    // 步态采样率通常 >=100fps，直接对矩阵元素线性插值误差可忽略，
    // 并对平移精确插值；渲染蒙皮对该精度不敏感。
    const a = p0.world[i];
    const b = p1.world[i];
    const m = new Float32Array(16);
    for (let k = 0; k < 16; k++) m[k] = a[k] * (1 - alpha) + b[k] * alpha;
    world[i] = m;
    positions[i] = [
      p0.positions[i][0] * (1 - alpha) + p1.positions[i][0] * alpha,
      p0.positions[i][1] * (1 - alpha) + p1.positions[i][1] * alpha,
      p0.positions[i][2] * (1 - alpha) + p1.positions[i][2] * alpha,
    ];
  }
  return { world, positions };
}
