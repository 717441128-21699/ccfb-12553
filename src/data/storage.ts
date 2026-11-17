// IndexedDB 持久化：患者档案与复诊记录（含 BVH 原文、EMG 数据）。
// BVH 原文可能较大，不用 localStorage。
import type { Patient, Session, BvhData, EmgChannel } from '../core/types';

const DB_NAME = 'gaitlab';
const DB_VERSION = 1;
const STORE_PATIENT = 'patients';
const STORE_SESSION = 'sessions';

interface StoredSession {
  id: string;
  patientId: string;
  label: string;
  capturedAt: string;
  bvhText: string;
  bvhFileName: string;
  emg: { label: string; side: EmgChannel['side']; raw: number[]; envelope: number[] }[];
  note?: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PATIENT)) {
        db.createObjectStore(STORE_PATIENT, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_SESSION)) {
        const s = db.createObjectStore(STORE_SESSION, { keyPath: 'id' });
        s.createIndex('patientId', 'patientId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(db: IDBDatabase, store: string, mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function savePatient(p: Patient): Promise<void> {
  const db = await openDb();
  await tx(db, STORE_PATIENT, 'readwrite', (s) => s.put(p));
  db.close();
}

export async function listPatients(): Promise<Patient[]> {
  const db = await openDb();
  const all = await tx<Patient[]>(db, STORE_PATIENT, 'readonly', (s) => s.getAll() as IDBRequest<Patient[]>);
  db.close();
  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function deletePatient(id: string): Promise<void> {
  const db = await openDb();
  await tx(db, STORE_PATIENT, 'readwrite', (s) => s.delete(id));
  const t = db.transaction(STORE_SESSION, 'readwrite');
  const idx = t.objectStore(STORE_SESSION).index('patientId');
  await new Promise<void>((resolve, reject) => {
    const cursorReq = idx.openCursor(IDBKeyRange.only(id));
    cursorReq.onsuccess = () => {
      const cur = cursorReq.result;
      if (cur) { cur.delete(); cur.continue(); } else resolve();
    };
    cursorReq.onerror = () => reject(cursorReq.error);
  });
  db.close();
}

/** 保存复诊（BVH 以原文保存，读取时重新解析） */
export async function saveSession(session: Session): Promise<void> {
  const stored: StoredSession = {
    id: session.id,
    patientId: session.patientId,
    label: session.label,
    capturedAt: session.capturedAt,
    bvhText: session.bvh.rawText,
    bvhFileName: session.bvh.fileName,
    emg: session.emg.map((e) => ({
      label: e.label, side: e.side,
      raw: Array.from(e.raw), envelope: Array.from(e.envelope),
    })),
    note: session.note,
  };
  const db = await openDb();
  await tx(db, STORE_SESSION, 'readwrite', (s) => s.put(stored));
  db.close();
}

export async function listSessions(patientId: string): Promise<StoredSession[]> {
  const db = await openDb();
  const all = await tx<StoredSession[]>(db, STORE_SESSION, 'readonly',
    (s) => s.index('patientId').getAll(patientId) as IDBRequest<StoredSession[]>);
  db.close();
  return all.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
}

export async function deleteSession(id: string): Promise<void> {
  const db = await openDb();
  await tx(db, STORE_SESSION, 'readwrite', (s) => s.delete(id));
  db.close();
}

/** 把存储记录还原为运行时 Session（BVH 重新解析由调用方注入解析器，避免循环依赖） */
export function hydrateSession(
  stored: StoredSession,
  parse: (text: string, name: string) => BvhData,
): Session {
  return {
    id: stored.id,
    patientId: stored.patientId,
    label: stored.label,
    capturedAt: stored.capturedAt,
    note: stored.note,
    bvh: parse(stored.bvhText, stored.bvhFileName),
    emg: stored.emg.map((e) => ({
      label: e.label, side: e.side,
      raw: Float32Array.from(e.raw),
      envelope: Float32Array.from(e.envelope),
    })),
  };
}

export type { StoredSession };
