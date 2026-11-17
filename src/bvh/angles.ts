// 关节角度解算 + 静止站立帧重新标零。
// 设计要点：各家 BVH 的髋关节零位姿势不统一，直接读欧拉角没有可比性。
// 因此一律从世界坐标重建骨段向量，投影到矢状面求有符号夹角，
// 再减去“静止站立帧”的基线，得到解剖学意义上、零位统一的角度。
import type { BvhData, Pose, JointAngles } from '../core/types';
import {
  sub, normalize, cross, projectPlane, signedAngleDeg, transformDir, scale,
  type Vec3,
} from '../core/math';

export interface JointMap {
  pelvis: number;
  upLegL: number; legL: number; footL: number; toeL: number;
  upLegR: number; legR: number; footR: number; toeR: number;
}

/** 兼容常见命名（含中文动捕软件的导出），找不到的关节为 -1 */
export function mapJoints(bvh: BvhData): JointMap {
  const n = bvh.nameToIndex;
  const pick = (...names: string[]): number => {
    for (const name of names) {
      if (n.has(name)) return n.get(name)!;
    }
    return -1;
  };
  return {
    pelvis: pick('Hips', 'Pelvis', '骨盆', 'Hip'),
    upLegL: pick('LeftUpLeg', 'LeftHip', 'LUpLeg', '左大腿', 'LeftUpperLeg'),
    legL: pick('LeftLeg', 'LeftKnee', 'LLeg', '左小腿', 'LeftLowerLeg'),
    footL: pick('LeftFoot', 'LFoot', '左脚', 'LeftAnkle'),
    toeL: pick('LeftToeBase', 'LeftToe', 'LToeBase', '左脚趾'),
    upLegR: pick('RightUpLeg', 'RightHip', 'RUpLeg', '右大腿', 'RightUpperLeg'),
    legR: pick('RightLeg', 'RightKnee', 'RLeg', '右小腿', 'RightLowerLeg'),
    footR: pick('RightFoot', 'RFoot', '右脚', 'RightAnkle'),
    toeR: pick('RightToeBase', 'RightToe', 'RToeBase', '右脚趾'),
  };
}

/**
 * 计算整条剪辑共用的矢状面法线（内外侧轴 / 冠状轴）。
 * 必须全片共用一个轴，静止参考帧与行走帧才在同一坐标系下、标零才有意义。
 * 优先用骨盆首尾主导位移求行进方向；原地踏步（无净位移）时用最大瞬时速度方向；
 * 都不可用时退化为两髋连线，再退化为世界 Z。
 */
export function clipSagittalAxis(poses: Pose[], map: JointMap): Vec3 {
  const pelvis = map.pelvis;
  const start = poses[0].positions[pelvis];
  const end = poses[poses.length - 1].positions[pelvis];
  const net = sub(end, start);
  net[1] = 0;
  let fwd: Vec3 | null = null;
  if (Math.hypot(net[0], net[2]) > 1e-4) {
    fwd = normalize(net);
  } else {
    // 原地走：找水平瞬时速度最大的方向
    let best = 0;
    for (let f = 1; f < poses.length; f++) {
      const d = sub(poses[f].positions[pelvis], poses[f - 1].positions[pelvis]);
      d[1] = 0;
      const mag = Math.hypot(d[0], d[2]);
      if (mag > best) {
        best = mag;
        fwd = normalize(d);
      }
    }
  }
  if (fwd) {
    // down × fwd：fwd=+X、down=-Y 时得 +Z，与屈曲正转（绕 +Z）同向
    const axis = cross([0, -1, 0], fwd);
    const al = Math.hypot(axis[0], axis[1], axis[2]);
    if (al > 1e-6) return scale(axis, 1 / al);
  }
  if (map.upLegL >= 0 && map.upLegR >= 0) {
    const lr = normalize(sub(poses[0].positions[map.upLegL], poses[0].positions[map.upLegR]));
    if (Math.hypot(lr[0], lr[1], lr[2]) > 1e-6) return lr[2] >= 0 ? lr : scale(lr, -1);
  }
  return [0, 0, 1];
}

function boneDir(pose: Pose, proximal: number, distal: number): Vec3 {
  return normalize(sub(pose.positions[distal], pose.positions[proximal]));
}

/** 站立向下方向：头部/脊柱指向骨盆的方向（站立时与大腿骨同向，近似世界 -Y） */
function standingDown(bvh: BvhData, pose: Pose): Vec3 {
  const n = bvh.nameToIndex;
  const pelvis = n.get('Hips') ?? n.get('Pelvis') ?? 0;
  const top =
    n.get('Head') ?? n.get('Neck') ?? n.get('Spine1') ?? n.get('Spine') ?? pelvis;
  const d = sub(pose.positions[pelvis], pose.positions[top]);
  const l = Math.hypot(d[0], d[1], d[2]);
  return l > 1e-6 ? normalize(d) : ([0, -1, 0] as Vec3);
}

export interface RawFrameAngles {
  hipFlexL: number; hipFlexR: number;
  kneeFlexL: number; kneeFlexR: number;
  ankleDorsiL: number; ankleDorsiR: number;
  pelvisTilt: number;
}

/**
 * 单帧“原始”矢状面角度（未标零）。
 * 屈曲定义为绕剪辑共用矢状面法线的有符号角；对下肢，大腿向前摆为屈。
 */
export function rawAngles(bvh: BvhData, pose: Pose, map: JointMap, axis: Vec3): RawFrameAngles {
  const down = standingDown(bvh, pose);

  const side = (prefix: 'L' | 'R'): Omit<RawFrameAngles, 'pelvisTilt'> => {
    const upLeg = prefix === 'L' ? map.upLegL : map.upLegR;
    const leg = prefix === 'L' ? map.legL : map.legR;
    const foot = prefix === 'L' ? map.footL : map.footR;
    const toe = prefix === 'L' ? map.toeL : map.toeR;

    const thigh = boneDir(pose, upLeg, leg);
    const shin = boneDir(pose, leg, foot);
    const thighProj = normalize(projectPlane(thigh, axis));
    const shinProj = normalize(projectPlane(shin, axis));
    const downProj = normalize(projectPlane(down, axis));

    // 髋屈曲：站立时大腿与向下方向重合 -> 0；绕内外侧轴正转（向前摆）为正。
    const hipFlex = signedAngleDeg(downProj, thighProj, axis);

    // 膝屈曲：站立时大腿、小腿都指向下 -> 0；屈膝时小腿相对大腿绕内外侧轴正转为正。
    const kneeFlex = signedAngleDeg(thighProj, shinProj, axis);

    // 踝背屈/跖屈：足长轴相对小腿长轴在矢状面内的有符号夹角。
    // 直接用两骨段方向求夹角，静止时为骨架几何常量，外部减参考帧归零；
    // 这样解算值随踝通道旋转量线性变化，背屈（足尖向小腿前侧上抬）为正。
    let ankle = 0;
    if (toe >= 0) {
      const footVec = boneDir(pose, foot, toe);
      const footProj = normalize(projectPlane(footVec, axis));
      ankle = signedAngleDeg(shinProj, footProj, axis);
    }
    return prefix === 'L'
      ? { hipFlexL: hipFlex, kneeFlexL: kneeFlex, ankleDorsiL: ankle, hipFlexR: 0, kneeFlexR: 0, ankleDorsiR: 0 }
      : { hipFlexR: hipFlex, kneeFlexR: kneeFlex, ankleDorsiR: ankle, hipFlexL: 0, kneeFlexL: 0, ankleDorsiL: 0 };
  };

  const l = side('L');
  const r = side('R');

  // 骨盆倾斜：骨盆局部 Y 轴在矢状面相对世界向上的夹角
  let pelvisTilt = 0;
  if (map.pelvis >= 0) {
    const pelvisUp = normalize(transformDir(pose.world[map.pelvis], [0, 1, 0]));
    pelvisTilt = signedAngleDeg(
      normalize(projectPlane([0, 1, 0], axis)),
      normalize(projectPlane(pelvisUp, axis)),
      axis,
    );
  }

  return {
    hipFlexL: l.hipFlexL, hipFlexR: r.hipFlexR,
    kneeFlexL: l.kneeFlexL, kneeFlexR: r.kneeFlexR,
    ankleDorsiL: l.ankleDorsiL, ankleDorsiR: r.ankleDorsiR,
    pelvisTilt,
  };
}

export interface AngleSeries {
  frames: JointAngles[];
  /** 标零所用的静止帧下标 */
  referenceFrame: number;
  baseline: JointAngles;
}

/**
 * 自动选择静止站立参考帧：骨盆速度最小且高度接近中位数的帧。
 * 临床采集通常在开头保留 1~2 秒 T-Pose/A-Pose 站立。
 */
export function detectReferenceFrame(bvh: BvhData, poses: Pose[]): number {
  const map = mapJoints(bvh);
  const pelvis = map.pelvis;
  const speed: number[] = [];
  for (let f = 0; f < bvh.frameCount; f++) {
    if (f === 0) { speed.push(0); continue; }
    const a = poses[f].positions[pelvis];
    const b = poses[f - 1].positions[pelvis];
    speed.push(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / bvh.frameTime);
  }
  // 只在序列前 1/3 找站立帧（避免走路中途的瞬时低速）
  const searchEnd = Math.max(1, Math.floor(bvh.frameCount / 3));
  let best = 0;
  let bestScore = Infinity;
  for (let f = 0; f < searchEnd; f++) {
    if (speed[f] < bestScore) {
      bestScore = speed[f];
      best = f;
    }
  }
  return best;
}

/** 全序列角度解算并按静止站立帧重新标零 */
export function computeAngleSeries(
  bvh: BvhData,
  poses: Pose[],
  referenceFrame?: number,
): AngleSeries {
  const map = mapJoints(bvh);
  const axis = clipSagittalAxis(poses, map);
  const ref = referenceFrame ?? detectReferenceFrame(bvh, poses);
  const baselineRaw = rawAngles(bvh, poses[ref], map, axis);

  const frames: JointAngles[] = [];
  for (let f = 0; f < bvh.frameCount; f++) {
    const raw = rawAngles(bvh, poses[f], map, axis);
    frames.push({
      hipFlexL: raw.hipFlexL - baselineRaw.hipFlexL,
      hipFlexR: raw.hipFlexR - baselineRaw.hipFlexR,
      kneeFlexL: raw.kneeFlexL - baselineRaw.kneeFlexL,
      kneeFlexR: raw.kneeFlexR - baselineRaw.kneeFlexR,
      ankleDorsiL: raw.ankleDorsiL - baselineRaw.ankleDorsiL,
      ankleDorsiR: raw.ankleDorsiR - baselineRaw.ankleDorsiR,
      pelvisTilt: raw.pelvisTilt - baselineRaw.pelvisTilt,
    });
  }
  const baseline: JointAngles = {
    hipFlexL: 0, hipFlexR: 0, kneeFlexL: 0, kneeFlexR: 0,
    ankleDorsiL: 0, ankleDorsiR: 0, pelvisTilt: 0,
  };
  return { frames, referenceFrame: ref, baseline };
}
