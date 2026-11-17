// 动捕载入页：BVH/EMG 文件载入、静止站立帧标零展示、会话管理
import { store, type LoadedSession } from './store';
import { toast } from './patientView';
import { parseEmgCsv } from '../bvh/emg';
import { detectReferenceFrame } from '../bvh/angles';
import { evaluateAll } from '../bvh/skeleton';
import { parseBvh } from '../bvh/parser';
import type { EmgChannel } from '../core/types';

export function renderCaptureView(root: HTMLElement): () => void {
  root.innerHTML = `
  <div class="view">
    <div id="needPatient" class="empty card hidden"><div class="ico">👈</div>请先在“患者”页选择一位患者</div>

    <div id="captureBody">
      <div class="card">
        <h3>载入动捕数据（BVH）</h3>
        <div class="dropzone" id="bvhDrop">
          <div class="big">📂</div>
          <div>点击或拖拽 BVH 文件到此处</div>
          <div class="small-text">支持任意关节层级与通道欧拉序；载入后自动按静止站立帧重新标零</div>
          <input type="file" id="bvhFile" accept=".bvh" hidden>
        </div>
        <div id="bvhInfo"></div>
      </div>

      <div class="card">
        <h3>同步肌电（EMG，可选 CSV）</h3>
        <div class="dropzone" id="emgDrop">
          <div class="big">📈</div>
          <div>点击或拖拽 EMG CSV（首行表头，首列时间戳，其余列为各肌肉通道）</div>
          <input type="file" id="emgFile" accept=".csv" hidden>
        </div>
        <div id="emgInfo" class="small-text" style="margin-top:8px"></div>
      </div>

      <div class="card">
        <h3>会话信息并保存</h3>
        <div class="row">
          <div class="col"><label>复诊标签</label>
            <select id="sessLabel">
              <option>初诊</option><option>第2次复诊</option><option>第3次复诊</option>
              <option>出院评估</option><option>随访</option>
            </select></div>
          <div class="col"><label>采集日期</label><input type="date" id="sessDate"></div>
          <div class="col" style="flex:2"><label>备注</label><input id="sessNote" placeholder="本次采集状态/用药/辅具等"></div>
        </div>
        <button class="btn" id="saveSess" disabled>保存为复诊会话</button>
        <span id="saveHint" class="small-text" style="margin-left:10px"></span>
      </div>

      <div class="card">
        <h3>该患者已保存的会话</h3>
        <div id="storedSessions"></div>
      </div>
    </div>
  </div>`;

  let bvhText: string | null = null;
  let bvhName = '';
  let emgChannels: EmgChannel[] = [];

  const needPatient = root.querySelector('#needPatient') as HTMLElement;
  const body = root.querySelector('#captureBody') as HTMLElement;
  const dateInput = root.querySelector<HTMLInputElement>('#sessDate')!;
  dateInput.value = new Date().toISOString().slice(0, 10);

  function guardPatient() {
    const has = !!store.state.currentPatient;
    needPatient.classList.toggle('hidden', has);
    body.classList.toggle('hidden', !has);
    return has;
  }

  // ---- BVH 载入 ----
  const drop = root.querySelector<HTMLElement>('#bvhDrop')!;
  const fileInput = root.querySelector<HTMLInputElement>('#bvhFile')!;
  drop.addEventListener('click', () => fileInput.click());
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault(); drop.classList.remove('over');
    const f = e.dataTransfer?.files[0];
    if (f) readBvh(f);
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files?.[0]) readBvh(fileInput.files[0]);
  });

  async function readBvh(f: File) {
    bvhText = await f.text();
    bvhName = f.name;
    try {
      // 预解析 + 标零信息预览
      const bvh = parseBvh(bvhText, bvhName);
      const poses = evaluateAll(bvh);
      const ref = detectReferenceFrame(bvh, poses);
      root.querySelector('#bvhInfo')!.innerHTML = `
        <div class="file-tag">📄 ${bvhName}
          <span class="pill">${bvh.joints.length} 关节</span>
          <span class="pill">${bvh.frameCount} 帧</span>
          <span class="pill">${(1 / bvh.frameTime).toFixed(0)} Hz</span>
          <span class="pill">时长 ${(bvh.frameCount * bvh.frameTime).toFixed(2)}s</span>
        </div>
        <div class="small-text" style="margin-top:6px">
          自动识别静止站立参考帧：第 <b style="color:var(--accent2)">${ref}</b> 帧
          （${(ref * bvh.frameTime).toFixed(2)}s），髋/膝/踝角度将以该帧为零位。
        </div>`;
      root.querySelector<HTMLButtonElement>('#saveSess')!.disabled = false;
      root.querySelector('#saveHint')!.textContent = '';
      toast('BVH 解析成功');
    } catch (err) {
      bvhText = null;
      root.querySelector('#bvhInfo')!.innerHTML =
        `<div class="file-tag" style="border-color:var(--danger)">❌ 解析失败：${(err as Error).message}</div>`;
    }
  }

  // ---- EMG 载入 ----
  const emgDrop = root.querySelector<HTMLElement>('#emgDrop')!;
  const emgInput = root.querySelector<HTMLInputElement>('#emgFile')!;
  emgDrop.addEventListener('click', () => emgInput.click());
  emgDrop.addEventListener('dragover', (e) => { e.preventDefault(); emgDrop.classList.add('over'); });
  emgDrop.addEventListener('dragleave', () => emgDrop.classList.remove('over'));
  emgDrop.addEventListener('drop', (e) => {
    e.preventDefault(); emgDrop.classList.remove('over');
    const f = e.dataTransfer?.files[0];
    if (f) readEmg(f);
  });
  emgInput.addEventListener('change', () => {
    if (emgInput.files?.[0]) readEmg(emgInput.files[0]);
  });

  async function readEmg(f: File) {
    if (!bvhText) {
      toast('请先载入 BVH，EMG 需要按其帧数重采样');
      return;
    }
    const text = await f.text();
    try {
      const bvh = parseBvh(bvhText, bvhName);
      emgChannels = parseEmgCsv(text, bvh.frameCount, bvh.frameTime);
      root.querySelector('#emgInfo')!.innerHTML = emgChannels
        .map((c) => `<span class="pill">${c.label}（${c.side === 'L' ? '左' : c.side === 'R' ? '右' : '双侧'}）</span>`)
        .join('') + `<div class="small-text" style="margin-top:6px">已整流+RMS+低通生成包络，并按峰值归一化、重采样到 ${bvh.frameCount} 帧。</div>`;
      toast(`EMG 载入成功：${emgChannels.length} 通道`);
    } catch (err) {
      emgChannels = [];
      root.querySelector('#emgInfo')!.textContent = 'EMG 解析失败：' + (err as Error).message;
    }
  }

  // ---- 保存会话 ----
  root.querySelector('#saveSess')!.addEventListener('click', async () => {
    if (!bvhText || !guardPatient()) return;
    const label = (root.querySelector<HTMLSelectElement>('#sessLabel')!).value;
    const capturedAt = new Date(dateInput.value).toISOString();
    const note = (root.querySelector<HTMLInputElement>('#sessNote')!).value;
    const loaded = await store.importSession(label, bvhText, bvhName, emgChannels, capturedAt, note);
    toast(`会话「${label}」已保存`);
    bvhText = null; emgChannels = [];
    root.querySelector('#bvhInfo')!.innerHTML = '';
    root.querySelector('#emgInfo')!.innerHTML = '';
    root.querySelector<HTMLButtonElement>('#saveSess')!.disabled = true;
    drawStored(loaded);
  });

  // ---- 已存会话列表 ----
  async function drawStored(_preset?: LoadedSession) {
    const box = root.querySelector('#storedSessions')!;
    if (!store.state.currentPatient) { box.innerHTML = ''; return; }
    const stored = await store.loadStoredSessions();
    if (!stored.length) {
      box.innerHTML = '<div class="empty"><div class="ico">🗂️</div>暂无会话</div>';
      return;
    }
    box.innerHTML = '';
    for (const s of stored) {
      const item = document.createElement('div');
      item.className = 'session-item';
      const isPrimary = store.state.primary?.session.id === s.id;
      const isCompare = store.state.compare?.session.id === s.id;
      if (isPrimary) item.classList.add('primary');
      if (isCompare) item.classList.add('compare');
      item.innerHTML = `
        <div class="grow">
          <b>${s.label}</b>
          <span class="pill">${s.capturedAt.slice(0, 10)}</span>
          ${isPrimary ? '<span class="pill" style="color:var(--accent)">主会话</span>' : ''}
          ${isCompare ? '<span class="pill" style="color:var(--accent2)">对比会话</span>' : ''}
          <div class="small-text">${s.bvhFileName} ｜ ${s.emg.length} 路 EMG ｜ ${s.note || ''}</div>
        </div>
        <button class="btn small" data-role="primary">${isPrimary ? '✓ 主会话' : '设为主'}</button>
        <button class="btn small ghost" data-role="compare">${isCompare ? '✓ 对比' : '设为对比'}</button>
        <button class="btn small danger" data-role="del">删除</button>`;
      item.querySelector('[data-role=primary]')!.addEventListener('click', () => {
        const loaded = store.hydrate(s);
        store.setPrimary(loaded);
        toast(`已将「${s.label}」设为动画主会话`);
        drawStored();
      });
      item.querySelector('[data-role=compare]')!.addEventListener('click', () => {
        if (isCompare) { store.setCompare(null); drawStored(); return; }
        const loaded = store.hydrate(s);
        store.setCompare(loaded);
        toast(`已将「${s.label}」设为对比会话`);
        drawStored();
      });
      item.querySelector('[data-role=del]')!.addEventListener('click', async () => {
        if (confirm('删除该会话？')) {
          await store.removeSession(s.id);
          toast('会话已删除');
          drawStored();
        }
      });
      box.appendChild(item);
    }
  }

  const unsub = store.subscribe(() => { guardPatient(); drawStored(); });
  guardPatient();
  drawStored();
  return unsub;
}
