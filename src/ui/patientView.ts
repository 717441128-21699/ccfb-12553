// 患者页：患者档案增删、选择
import { store } from './store';
import type { Patient } from '../core/types';

export function renderPatientView(root: HTMLElement): () => void {
  root.innerHTML = `
  <div class="view">
    <div class="card">
      <h3>新建患者档案</h3>
      <form id="patientForm" class="row">
        <div class="col"><label>姓名 *</label><input name="name" required placeholder="患者姓名"></div>
        <div class="col"><label>性别</label>
          <select name="gender"><option>男</option><option>女</option><option>其他</option></select></div>
        <div class="col"><label>出生年份</label><input name="birthYear" type="number" value="1980" min="1900" max="2030"></div>
        <div class="col"><label>身高 (cm)</label><input name="heightCm" type="number" value="170"></div>
        <div class="col"><label>体重 (kg)</label><input name="weightKg" type="number" value="65"></div>
        <div class="col" style="flex:2"><label>诊断/备注</label><input name="diagnosis" placeholder="如：脑卒中后偏瘫 / 膝关节置换术后"></div>
        <div class="col" style="flex:0 0 auto;display:flex;align-items:flex-end">
          <button class="btn" type="submit">＋ 建立档案</button>
        </div>
      </form>
    </div>
    <div class="card">
      <h3>患者列表（<span id="pCount">0</span>）</h3>
      <div class="patient-list" id="patientList"></div>
    </div>
  </div>`;

  const form = root.querySelector<HTMLFormElement>('#patientForm')!;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    await store.addPatient({
      name: String(fd.get('name')),
      gender: String(fd.get('gender')) as Patient['gender'],
      birthYear: Number(fd.get('birthYear')),
      heightCm: Number(fd.get('heightCm')),
      weightKg: Number(fd.get('weightKg')),
      diagnosis: String(fd.get('diagnosis') || ''),
    });
    form.reset();
    toast('患者档案已建立');
  });

  function draw() {
    const list = root.querySelector('#patientList')!;
    root.querySelector('#pCount')!.textContent = String(store.state.patients.length);
    const cur = store.state.currentPatient?.id;
    if (!store.state.patients.length) {
      list.innerHTML = '<div class="empty" style="grid-column:1/-1"><div class="ico">🧑‍⚕️</div>暂无患者，请先建立档案</div>';
      return;
    }
    list.innerHTML = '';
    for (const p of store.state.patients) {
      const age = new Date().getFullYear() - p.birthYear;
      const card = document.createElement('div');
      card.className = 'patient-card' + (p.id === cur ? ' selected' : '');
      card.innerHTML = `
        <div class="name">${p.name}</div>
        <div class="meta">${p.gender} ｜ ${age} 岁 ｜ ${p.heightCm}cm ｜ ${p.weightKg}kg</div>
        <div class="meta">${p.diagnosis || '无诊断备注'}</div>
        <div style="margin-top:8px">
          <span class="pill">建档 ${p.createdAt.slice(0, 10)}</span>
        </div>
        <div style="margin-top:10px;display:flex;gap:8px">
          <button class="btn small" data-act="select">${p.id === cur ? '✓ 当前患者' : '选择'}</button>
          <button class="btn small ghost" data-act="del">删除</button>
        </div>`;
      card.querySelector('[data-act=select]')!.addEventListener('click', (ev) => {
        ev.stopPropagation();
        store.selectPatient(p);
        toast(`已选择患者：${p.name}`);
      });
      card.querySelector('[data-act=del]')!.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        if (confirm(`确认删除患者 ${p.name} 及其全部复诊记录？`)) {
          await store.removePatient(p.id);
          toast('已删除');
        }
      });
      list.appendChild(card);
    }
  }

  const unsub = store.subscribe(draw);
  store.refreshPatients();
  draw();
  return unsub;
}

export function toast(msg: string) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2400);
}
