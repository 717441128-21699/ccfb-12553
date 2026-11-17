// 应用中央状态：当前患者、载入的复诊会话、播放时间轴。
// 纯发布订阅模式，UI 各页签订阅变更；不依赖框架。
import type { Patient, Session, BvhData, Pose, JointAngles, EmgChannel } from '../core/types';
import { parseBvh } from '../bvh/parser';
import { evaluateAll } from '../bvh/skeleton';
import { computeAngleSeries, type AngleSeries } from '../bvh/angles';
import { analyzeGait, type GaitAnalysis } from '../bvh/gait';
import {
  listPatients, savePatient, deletePatient,
  listSessions, saveSession, deleteSession, hydrateSession,
  type StoredSession,
} from '../data/storage';

export interface LoadedSession {
  session: Session;
  poses: Pose[];
  angles: AngleSeries;
  analysis: GaitAnalysis;
}

interface AppState {
  patients: Patient[];
  currentPatient: Patient | null;
  /** 主会话（初诊）与对比会话（复诊） */
  primary: LoadedSession | null;
  compare: LoadedSession | null;
  /** 播放头（秒，作用于主会话时间轴） */
  playTime: number;
  playing: boolean;
  playbackRate: number;
  overlayAlign: 'time' | 'cycle';   // 叠加对齐方式
  overlayAlpha: number;
}

type Listener = () => void;

class Store {
  state: AppState = {
    patients: [],
    currentPatient: null,
    primary: null,
    compare: null,
    playTime: 0,
    playing: false,
    playbackRate: 1,
    overlayAlign: 'cycle',
    overlayAlpha: 0.45,
  };
  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    this.listeners.forEach((fn) => fn());
  }
  set(patch: Partial<AppState>) {
    Object.assign(this.state, patch);
    this.emit();
  }

  async refreshPatients() {
    this.set({ patients: await listPatients() });
  }

  async addPatient(p: Omit<Patient, 'id' | 'createdAt'>) {
    const patient: Patient = {
      ...p,
      id: 'P' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      createdAt: new Date().toISOString(),
    };
    await savePatient(patient);
    await this.refreshPatients();
    this.set({ currentPatient: patient });
    return patient;
  }

  async removePatient(id: string) {
    await deletePatient(id);
    if (this.state.currentPatient?.id === id) {
      this.set({ currentPatient: null, primary: null, compare: null });
    }
    await this.refreshPatients();
  }

  selectPatient(p: Patient | null) {
    this.set({ currentPatient: p, primary: null, compare: null, playTime: 0 });
  }

  /** 解析并计算一个会话的全部派生数据（姿势/角度/步态指标） */
  buildLoaded(session: Session): LoadedSession {
    const poses = evaluateAll(session.bvh);
    const angles = computeAngleSeries(session.bvh, poses);
    const birthYear = this.state.currentPatient?.birthYear ?? new Date().getFullYear() - 40;
    const analysis = analyzeGait(session.bvh, poses, angles.frames, birthYear);
    return { session, poses, angles, analysis };
  }

  /** 从 BVH 文本创建会话并持久化 */
  async importSession(
    label: string,
    bvhText: string,
    fileName: string,
    emg: EmgChannel[],
    capturedAt: string,
    note?: string,
  ): Promise<LoadedSession> {
    const patient = this.state.currentPatient;
    if (!patient) throw new Error('请先选择患者');
    const bvh: BvhData = parseBvh(bvhText, fileName);
    const session: Session = {
      id: 'S' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      patientId: patient.id,
      label,
      capturedAt,
      bvh,
      emg,
      note,
    };
    await saveSession(session);
    return this.buildLoaded(session);
  }

  setPrimary(loaded: LoadedSession | null) {
    this.set({ primary: loaded, playTime: 0 });
  }
  setCompare(loaded: LoadedSession | null) {
    this.set({ compare: loaded });
  }

  async loadStoredSessions(): Promise<StoredSession[]> {
    if (!this.state.currentPatient) return [];
    return listSessions(this.state.currentPatient.id);
  }

  hydrate(stored: StoredSession): LoadedSession {
    const session = hydrateSession(stored, parseBvh);
    return this.buildLoaded(session);
  }

  async removeSession(id: string) {
    await deleteSession(id);
    if (this.state.primary?.session.id === id) this.set({ primary: null });
    if (this.state.compare?.session.id === id) this.set({ compare: null });
  }

  get duration(): number {
    return this.state.primary
      ? this.state.primary.session.bvh.frameCount * this.state.primary.session.bvh.frameTime
      : 0;
  }
}

export const store = new Store();
export type { JointAngles };
