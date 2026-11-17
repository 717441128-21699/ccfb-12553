// 肌电（EMG）处理：整流 -> 移动 RMS -> 低通平滑得到包络，
// 并把任意采样率的信号重采样到与 BVH 帧数等长，便于共用时间轴。
import type { EmgChannel, Side } from '../core/types';

/** 全波整流 + 移动窗 RMS（窗长以采样点数计） */
function movingRms(sig: Float32Array, win: number): Float32Array {
  const out = new Float32Array(sig.length);
  const half = Math.floor(win / 2);
  let acc = 0;
  // 平方滑窗
  for (let i = 0; i < sig.length; i++) {
    acc += sig[i] * sig[i];
    if (i >= win) acc -= sig[i - win] * sig[i - win];
    const n = Math.min(i + 1, win);
    out[Math.min(i + half, sig.length - 1)] = Math.sqrt(acc / Math.max(1, n));
  }
  return out;
}

/** 一阶 IIR 低通（截止约 6~10Hz，临床 EMG 包络常用） */
function lowPass(sig: Float32Array, alpha: number): Float32Array {
  const out = new Float32Array(sig.length);
  out[0] = sig[0];
  for (let i = 1; i < sig.length; i++) {
    out[i] = alpha * sig[i] + (1 - alpha) * out[i - 1];
  }
  return out;
}

/** 线性重采样到目标长度 */
export function resample(sig: Float32Array, targetLen: number): Float32Array {
  if (sig.length === targetLen) return sig.slice();
  const out = new Float32Array(targetLen);
  for (let i = 0; i < targetLen; i++) {
    const src = (i / Math.max(1, targetLen - 1)) * (sig.length - 1);
    const i0 = Math.floor(src);
    const i1 = Math.min(sig.length - 1, i0 + 1);
    const a = src - i0;
    out[i] = sig[i0] * (1 - a) + sig[i1] * a;
  }
  return out;
}

/**
 * 从原始 EMG 信号生成包络通道。
 * @param sampleRate 原始采样率 Hz；targetFrames/frameTime 决定重采样目标
 */
export function buildEnvelope(
  label: string,
  side: Side | 'B',
  raw: Float32Array,
  sampleRate: number,
  targetFrames: number,
  frameTime: number,
): EmgChannel {
  const win = Math.max(3, Math.round(sampleRate * 0.05)); // 50ms RMS 窗
  const rectified = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) rectified[i] = Math.abs(raw[i]);
  const rms = movingRms(rectified, win);
  const alpha = (2 * Math.PI * 8 / sampleRate) / (1 + 2 * Math.PI * 8 / sampleRate);
  const smoothed = lowPass(rms, alpha);

  const rawRs = resample(raw, targetFrames);
  let env = resample(smoothed, targetFrames);
  // 归一化到该通道自身峰值（MVC 数据缺失时的临床常用替代）
  let peak = 0;
  for (const v of env) peak = Math.max(peak, v);
  if (peak > 1e-9) {
    const norm = new Float32Array(env.length);
    for (let i = 0; i < env.length; i++) norm[i] = env[i] / peak;
    env = norm;
  }
  void frameTime;
  return { label, side, raw: rawRs, envelope: env };
}

/**
 * 解析 EMG CSV：首行表头（时间, 通道1, 通道2...），其余为数值。
 * 第一列可为时间戳（秒），否则按给定采样率解释。
 */
export function parseEmgCsv(
  text: string,
  targetFrames: number,
  frameTime: number,
  sideHints?: Record<string, Side | 'B'>,
): EmgChannel[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) throw new Error('EMG CSV 至少需要表头和一行数据');
  const headers = lines[0].split(',').map((s) => s.trim());
  const cols = headers.length - 1; // 第一列时间
  const columnData: Float32Array[] = Array.from({ length: cols }, () => new Float32Array(lines.length - 1));
  let inferredRate = 1000;

  const firstTimes: number[] = [];
  for (let r = 1; r < lines.length; r++) {
    const parts = lines[r].split(',');
    const t = Number(parts[0]);
    if (r <= 3) firstTimes.push(t);
    for (let c = 0; c < cols; c++) {
      columnData[c][r - 1] = Number(parts[c + 1]) || 0;
    }
  }
  if (firstTimes.length >= 2 && firstTimes[1] > firstTimes[0]) {
    inferredRate = Math.round(1 / (firstTimes[1] - firstTimes[0]));
  }

  return headers.slice(1).map((label, idx) => {
    const side = sideHints?.[label] ?? inferSide(label);
    return buildEnvelope(label, side, columnData[idx], inferredRate, targetFrames, frameTime);
  });
}

function inferSide(label: string): Side | 'B' {
  if (/左|[Ll](eft)?[\s_]/.test(label) || /^L/i.test(label)) return 'L';
  if (/右|[Rr](ight)?[\s_]/.test(label) || /^R/i.test(label)) return 'R';
  return 'B';
}
