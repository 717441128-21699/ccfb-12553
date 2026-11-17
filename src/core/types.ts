// 领域类型定义

export type Side = 'L' | 'R';
export type JointName =
  | 'Hips'
  | 'Spine' | 'Spine1' | 'Neck' | 'Head'
  | 'LeftUpLeg' | 'LeftLeg' | 'LeftFoot' | 'LeftToeBase'
  | 'RightUpLeg' | 'RightLeg' | 'RightFoot' | 'RightToeBase'
  | 'LeftArm' | 'LeftForeArm' | 'LeftHand'
  | 'RightArm' | 'RightForeArm' | 'RightHand';

export type Channel = 'Xposition' | 'Yposition' | 'Zposition' | 'Xrotation' | 'Yrotation' | 'Zrotation';

export interface BvhJoint {
  name: string;
  index: number;                 // 在骨架中的编号
  parent: number;                // -1 表示根
  offset: [number, number, number];
  children: number[];
  channels: Channel[];           // 通道声明顺序，决定欧拉序
  channelOffset: number;         // 在每帧数据中的起始下标
}

export interface BvhData {
  joints: BvhJoint[];
  nameToIndex: Map<string, number>;
  frameTime: number;             // 秒
  frames: Float32Array[];        // 每帧一整块通道值
  frameCount: number;
  channelCount: number;
  rawText: string;
  fileName: string;
}

/** 单帧上每个关节的世界变换与世界坐标 */
export interface Pose {
  /** 每个关节的世界矩阵（含偏移） */
  world: Float32Array[];
  /** 每个关节的世界坐标 */
  positions: [number, number, number][];
}

/** 解算出来的单帧关节角度（度，已重新标零） */
export interface JointAngles {
  hipFlexL: number; hipFlexR: number;
  kneeFlexL: number; kneeFlexR: number;
  ankleDorsiL: number; ankleDorsiR: number;
  /** 骨盆倾斜（绕矢状面法线），用于报告参考 */
  pelvisTilt: number;
}

/** 步态事件 */
export interface GaitEvent {
  side: Side;
  type: 'HS' | 'TO';             // 足跟着地 / 足趾离地
  frame: number;
  time: number;
}

/** 单侧一个完整步态周期（同侧连续两次足跟触地） */
export interface GaitCycle {
  side: Side;
  startFrame: number;
  endFrame: number;
  duration: number;              // 秒
  stanceFrames: number;          // 支撑相帧数（HS -> 同侧 TO）
  stancePct: number;             // 支撑相占比 %
  /** 周期内逐帧的周期百分比 0..100 */
  phasePct: number[];
}

/** EMG 通道（原始电压 -> 包络） */
export interface EmgChannel {
  label: string;                 // 如 左股直肌 / Left Rectus Femoris
  side: Side | 'B';
  raw: Float32Array;             // 与动画等长（已按帧重采样）
  envelope: Float32Array;        // 整流 + 低通后的包络，归一化 0..1
}

/** 一次复诊（一次动捕采集） */
export interface Session {
  id: string;
  patientId: string;
  label: string;                 // 如 初诊 / 第2次复诊
  capturedAt: string;            // ISO 日期
  bvh: BvhData;
  emg: EmgChannel[];
  note?: string;
}

export interface Patient {
  id: string;
  name: string;
  gender: '男' | '女' | '其他';
  birthYear: number;
  heightCm: number;
  weightKg: number;
  diagnosis: string;
  createdAt: string;
}

/** 对比汇总指标 */
export interface GaitMetrics {
  symmetryIndex: number;         // 左右步态对称指数 %（0 完全对称）
  stancePctL: number;
  stancePctR: number;
  cadence: number;               // 步/分钟（双侧 HS 计数）
  cycleDurationL: number;
  cycleDurationR: number;
  avgRoML: { hip: number; knee: number; ankle: number };
  avgRoMR: { hip: number; knee: number; ankle: number };
  ageGroup: string;
  normStancePct: number;
  normSymmetry: number;
}
