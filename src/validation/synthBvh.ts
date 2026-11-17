// 生成“已知关节角度真值”的合成 BVH，用于验证角度解算管线精度。
// 设计：矢状面单轴运动，髋/膝/踝各自由给定角度函数驱动（度），
// 骨盆沿 X 轴匀速行进，左右腿相位差半个周期；
// 可注入静止零位偏置（模拟各家 BVH 零位不统一）。
// 因为所有运动都绕冠状轴（Z 轴，BVH 常见约定），输入角度与
// 本系统解算的矢状面屈曲角可直接对比。

export interface SynthOptions {
  frameTime?: number;
  duration?: number;          // 秒
  cycles?: number;            // 完整步态周期数
  /** 厂家零位偏置（度），加在对应通道上，验证重新标零能否消除 */
  zeroBias?: {
    hipL?: number; hipR?: number;
    kneeL?: number; kneeR?: number;
    ankleL?: number; ankleR?: number;
  };
  /** 通道旋转顺序，默认 ZXY（最常见），可改 XYZ 验证顺序无关性 */
  rotationOrder?: 'ZXY' | 'XYZ' | 'YXZ';
}

export interface SynthResult {
  bvh: string;
  /** 每帧真值角度（未加零位偏置的“解剖学真值”），已按屈曲正号约定 */
  truth: {
    frame: number;
    time: number;
    hipFlexL: number; hipFlexR: number;
    kneeFlexL: number; kneeFlexR: number;
    ankleDorsiL: number; ankleDorsiR: number;
  }[];
  /** 实际写入 BVH 通道的角度（含零位偏置） */
  channelAngles: { hipL: number[]; hipR: number[]; kneeL: number[]; kneeR: number[]; ankleL: number[]; ankleR: number[] };
  frameTime: number;
  frameCount: number;
}

// 标准 19 关节骨架的静止偏移（cm），沿 -Y 向下生长，T-Pose 手臂沿 X
const HIERARCHY = `HIERARCHY
ROOT Hips
{
  OFFSET 0.00 0.00 0.00
  CHANNELS 6 Xposition Yposition Zposition {rot}
  JOINT Spine
  {
    OFFSET 0.00 12.00 0.00
    CHANNELS 3 {rot}
    JOINT Spine1
    {
      OFFSET 0.00 12.00 0.00
      CHANNELS 3 {rot}
      JOINT Neck
      {
        OFFSET 0.00 10.00 0.00
        CHANNELS 3 {rot}
        JOINT Head
        {
          OFFSET 0.00 9.00 0.00
          CHANNELS 3 {rot}
          End Site { OFFSET 0.00 9.00 0.00 }
        }
      }
      JOINT LeftArm
      {
        OFFSET 6.00 3.00 0.00
        CHANNELS 3 {rot}
        JOINT LeftForeArm
        {
          OFFSET 22.00 0.00 0.00
          CHANNELS 3 {rot}
          JOINT LeftHand
          {
            OFFSET 20.00 0.00 0.00
            CHANNELS 3 {rot}
            End Site { OFFSET 16.00 0.00 0.00 }
          }
        }
      }
      JOINT RightArm
      {
        OFFSET -6.00 3.00 0.00
        CHANNELS 3 {rot}
        JOINT RightForeArm
        {
          OFFSET -22.00 0.00 0.00
        CHANNELS 3 {rot}
          JOINT RightHand
          {
            OFFSET -20.00 0.00 0.00
            CHANNELS 3 {rot}
            End Site { OFFSET -16.00 0.00 0.00 }
          }
        }
      }
    }
  }
  JOINT LeftUpLeg
  {
    OFFSET 4.50 -3.00 0.00
    CHANNELS 3 {rot}
    JOINT LeftLeg
    {
      OFFSET 0.00 -42.00 0.00
      CHANNELS 3 {rot}
      JOINT LeftFoot
      {
        OFFSET 0.00 -40.00 0.00
        CHANNELS 3 {rot}
        JOINT LeftToeBase
        {
          OFFSET 0.00 -2.00 12.00
          CHANNELS 3 {rot}
          End Site { OFFSET 0.00 0.00 8.00 }
        }
      }
    }
  }
  JOINT RightUpLeg
  {
    OFFSET -4.50 -3.00 0.00
    CHANNELS 3 {rot}
    JOINT RightLeg
    {
      OFFSET 0.00 -42.00 0.00
      CHANNELS 3 {rot}
      JOINT RightFoot
      {
        OFFSET 0.00 -40.00 0.00
        CHANNELS 3 {rot}
        JOINT RightToeBase
        {
          OFFSET 0.00 -2.00 12.00
          CHANNELS 3 {rot}
          End Site { OFFSET 0.00 0.00 8.00 }
        }
      }
    }
  }
}`;

/**
 * 真值角度轨迹（度）。用多频率正弦叠加，模拟真实步态波形而非单一正弦。
 * phase: 0 或 PI（左右腿反相）。
 */
function gaitTrajectories(phase: number, t: number, omega: number) {
  const w = omega * t + phase;
  // 髋屈曲：均值 10°、幅值 20°
  const hip = 10 + 20 * Math.sin(w) + 4 * Math.sin(2 * w + 0.6);
  // 膝屈曲：0~60° 之间的非负波形
  const knee = Math.max(0, 28 + 28 * Math.sin(w - 1.2) + 8 * Math.sin(2 * w));
  // 踝背屈：-15~10°
  const ankle = -2 + 9 * Math.sin(w + 1.8) + 4 * Math.sin(2 * w - 0.5);
  return { hip, knee, ankle };
}

export function generateSyntheticBvh(opts: SynthOptions = {}): SynthResult {
  const frameTime = opts.frameTime ?? 0.01; // 100Hz
  const cycles = opts.cycles ?? 4;
  const cycleDuration = 1.1;                 // 每周期 1.1s
  const duration = opts.duration ?? cycles * cycleDuration;
  const frameCount = Math.round(duration / frameTime);
  const omega = (2 * Math.PI) / cycleDuration;
  const bias = opts.zeroBias ?? {};
  const order = opts.rotationOrder ?? 'ZXY';
  const rotChannels = `${order[0]}rotation ${order[1]}rotation ${order[2]}rotation`;

  // 前 0.5 秒静止站立（给自动标零检测用）：真值角度为 0，但通道带厂家偏置
  const standFrames = Math.round(0.5 / frameTime);
  const walkSpeed = 90; // cm/s

  const truth: SynthResult['truth'] = [];
  const ch = {
    hipL: [] as number[], hipR: [] as number[],
    kneeL: [] as number[], kneeR: [] as number[],
    ankleL: [] as number[], ankleR: [] as number[],
  };

  const rows: string[] = [];
  for (let f = 0; f < frameCount; f++) {
    const t = f * frameTime;
    const walking = f >= standFrames;
    const wt = walking ? t - standFrames * frameTime : 0;

    const L = walking ? gaitTrajectories(0, wt, omega) : { hip: 0, knee: 0, ankle: 0 };
    const R = walking ? gaitTrajectories(Math.PI, wt, omega) : { hip: 0, knee: 0, ankle: 0 };

    truth.push({
      frame: f, time: t,
      hipFlexL: L.hip, hipFlexR: R.hip,
      kneeFlexL: L.knee, kneeFlexR: R.knee,
      ankleDorsiL: L.ankle, ankleDorsiR: R.ankle,
    });

    // 通道值 = 真值 + 厂家零位偏置。矢状面运动只写 Z 分量（Z 旋转即冠状轴屈曲）
    const hipLz = L.hip + (bias.hipL ?? 0);
    const hipRz = R.hip + (bias.hipR ?? 0);
    const kneeLz = L.knee + (bias.kneeL ?? 0);
    const kneeRz = R.knee + (bias.kneeR ?? 0);
    const ankleLz = L.ankle + (bias.ankleL ?? 0);
    const ankleRz = R.ankle + (bias.ankleR ?? 0);
    ch.hipL.push(hipLz); ch.hipR.push(hipRz);
    ch.kneeL.push(kneeLz); ch.kneeR.push(kneeRz);
    ch.ankleL.push(ankleLz); ch.ankleR.push(ankleRz);

    // 根：沿 X 行进，高度固定 95cm（Hips 离地），无旋转
    const rootX = walking ? walkSpeed * wt : 0;
    const root: Record<string, number> = { X: 0, Y: 0, Z: 0 };
    const rot: Record<string, number> = { X: 0, Y: 0, Z: 0 };
    const vec3 = (zVal: number) => {
      const r = { X: 0, Y: 0, Z: zVal };
      return `${r[order[0] as 'X'].toFixed(4)} ${r[order[1] as 'X'].toFixed(4)} ${r[order[2] as 'X'].toFixed(4)}`;
    };
    void root; void rot;

    // 19 关节通道顺序展开：根 6 + 其余 18 关节 * 3 = 60 通道
    const zero3 = vec3(0);
    const row = [
      rootX.toFixed(4), '95.0000', '0.0000', vec3(0),       // Hips
      zero3,                                                  // Spine
      zero3,                                                  // Spine1
      zero3,                                                  // Neck
      zero3,                                                  // Head
      zero3,                                                  // LeftArm
      zero3,                                                  // LeftForeArm
      zero3,                                                  // LeftHand
      zero3,                                                  // RightArm
      zero3,                                                  // RightForeArm
      zero3,                                                  // RightHand
      vec3(hipLz),                                            // LeftUpLeg
      vec3(kneeLz),                                           // LeftLeg
      vec3(ankleLz),                                          // LeftFoot
      vec3(0),                                                // LeftToeBase
      vec3(hipRz),                                            // RightUpLeg
      vec3(kneeRz),                                           // RightLeg
      vec3(ankleRz),                                          // RightFoot
      vec3(0),                                                // RightToeBase
    ];
    rows.push(row.join(' '));
  }

  const header = HIERARCHY.replaceAll('{rot}', rotChannels);
  const bvh =
    `${header}\nMOTION\nFrames: ${frameCount}\nFrame Time: ${frameTime}\n${rows.join('\n')}\n`;

  return { bvh, truth, channelAngles: ch, frameTime, frameCount };
}
