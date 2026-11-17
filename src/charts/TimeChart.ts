// Canvas 2D 时间轴曲线：多条角度/EMG 序列共享同一时间轴，
// 播放游标与 3D 动画同步，支持点击/拖动 seek。
export interface SeriesSpec {
  label: string;
  color: string;
  values: ArrayLike<number>;
  /** 独立量程（如 EMG 0..1），不填则用全局自动量程 */
  range?: [number, number];
  dashed?: boolean;
  fill?: boolean;
}

export interface TimeChartOptions {
  frameTime: number;
  series: SeriesSpec[];
  /** 当前播放帧（双精度，允许插值位置） */
  cursor: number;
  onSeek?: (frame: number) => void;
  /** 事件竖线（步态 HS/TO） */
  markers?: { frame: number; color: string; label: string }[];
  yLabel?: string;
  height?: number;
}

export class TimeChart {
  private canvas: HTMLCanvasElement;
  private opts: TimeChartOptions;
  private padding = { left: 48, right: 14, top: 26, bottom: 28 };

  constructor(canvas: HTMLCanvasElement, opts: TimeChartOptions) {
    this.canvas = canvas;
    this.opts = opts;
    canvas.addEventListener('pointerdown', (e) => this.seek(e));
    canvas.addEventListener('pointermove', (e) => {
      if (e.buttons === 1) this.seek(e);
    });
  }

  update(opts: Partial<TimeChartOptions>) {
    Object.assign(this.opts, opts);
    this.draw();
  }

  private seek(e: PointerEvent) {
    if (!this.opts.onSeek) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const { left, right } = this.padding;
    const plotW = this.canvas.width / (window.devicePixelRatio || 1) - left - right;
    const ratio = Math.max(0, Math.min(1, (x - left) / plotW));
    this.opts.onSeek(ratio * (this.opts.series[0]?.values.length ?? 1 - 1));
  }

  draw() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = this.canvas.clientWidth || 600;
    const cssH = this.opts.height ?? 200;
    this.canvas.width = cssW * dpr;
    this.canvas.height = cssH * dpr;
    const ctx = this.canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);
    const W = cssW, H = cssH;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#12151a';
    ctx.fillRect(0, 0, W, H);

    const { left, right, top, bottom } = this.padding;
    const plotW = W - left - right;
    const plotH = H - top - bottom;
    const n = Math.max(2, ...this.opts.series.map((s) => s.values.length));

    // 网格 + 时间刻度（秒）
    ctx.strokeStyle = '#262b33';
    ctx.fillStyle = '#8a93a0';
    ctx.font = '11px system-ui';
    ctx.lineWidth = 1;
    const ticks = 10;
    for (let i = 0; i <= ticks; i++) {
      const x = left + (plotW * i) / ticks;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, top + plotH);
      ctx.stroke();
      const t = ((n - 1) * (i / ticks)) * this.opts.frameTime;
      ctx.fillText(`${t.toFixed(1)}s`, x - 12, H - 8);
    }
    ctx.save();
    ctx.translate(14, top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(this.opts.yLabel ?? '', 0, 0);
    ctx.restore();

    // 事件标记
    for (const m of this.opts.markers ?? []) {
      const x = left + (m.frame / (n - 1)) * plotW;
      ctx.strokeStyle = m.color;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, top + plotH);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = m.color;
      ctx.fillText(m.label, x + 2, top + 10);
    }

    // 曲线（EMG 与角度可在同一时间轴；各自量程做归一化映射）
    for (const s of this.opts.series) {
      let lo: number, hi: number;
      if (s.range) [lo, hi] = s.range;
      else {
        lo = Infinity; hi = -Infinity;
        for (let i = 0; i < s.values.length; i++) {
          const v = s.values[i];
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
        if (!isFinite(lo)) { lo = 0; hi = 1; }
        if (hi - lo < 1e-6) { hi = lo + 1; }
      }
      const yOf = (v: number) =>
        top + plotH - ((v - lo) / (hi - lo)) * plotH;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 1.8;
      ctx.setLineDash(s.dashed ? [5, 4] : []);
      ctx.beginPath();
      for (let i = 0; i < s.values.length; i++) {
        const x = left + (i / (n - 1)) * plotW;
        const y = yOf(s.values[i]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      if (s.fill) {
        ctx.lineTo(left + plotW, top + plotH);
        ctx.lineTo(left, top + plotH);
        ctx.closePath();
        ctx.fillStyle = s.color + '22';
        ctx.fill();
      }
    }

    // 图例
    let lx = left + 6;
    ctx.font = '11px system-ui';
    for (const s of this.opts.series) {
      ctx.fillStyle = s.color;
      ctx.fillRect(lx, 8, 12, 3);
      ctx.fillStyle = '#c6cdd8';
      ctx.fillText(s.label, lx + 16, 12);
      lx += ctx.measureText(s.label).width + 34;
    }

    // 播放游标
    const cx = left + (this.opts.cursor / (n - 1)) * plotW;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, top);
    ctx.lineTo(cx, top + plotH);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx, top, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}
