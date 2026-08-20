import { supabase } from '../supabase-client.js';

const SERVER_TIMESTAMP = Symbol('serverTimestamp');

class CompatTimestamp {
  constructor(value) {
    this.value = value;
  }
  toMillis() {
    const value = Date.parse(this.value);
    return Number.isFinite(value) ? value : 0;
  }
  toDate() {
    return new Date(this.value);
  }
  toJSON() {
    return this.value;
  }
}

function tableName(name) {
  if (['transactions','positions','monthlyGoals','recurring','scheduled','wallets','cards'].includes(name)) return name;
  if (name === 'config') return 'planning';
  throw new Error(`Coleção não suportada: ${name}`);
}

function makeRef(kind, path) {
  if (path[0] !== 'users' || !path[1]) throw new Error('Caminho de dados inválido.');
  const userId = path[1];
  if (path.length === 2) return { kind: 'userRoot', userId };

  const collectionName = path[2];
  if (collectionName === 'config' && path[3] === 'planning') {
    return { kind: 'doc', table: 'planning', userId, id: null, singleton: true };
  }

  const table = tableName(collectionName);
  if (kind === 'collection') return { kind, table, userId };
  return { kind, table, userId, id: path[3] };
}

function isTimestampField(key) {
  return key === 'createdAt' || key === 'updatedAt';
}

function fromRow(row) {
  if (!row) return null;
  const data = {};
  Object.entries(row).forEach(([key, value]) => {
    if (key === 'user_id' || key === 'id') return;
    data[key] = isTimestampField(key) && typeof value === 'string'
      ? new CompatTimestamp(value)
      : value;
  });
  return data;
}

function normalizeValue(value) {
  if (value === SERVER_TIMESTAMP) return new Date().toISOString();
  if (value instanceof CompatTimestamp) return value.value;
  return value;
}

function normalizeWrite(data = {}) {
  const result = {};
  Object.entries(data).forEach(([key, value]) => {
    if (typeof value === 'undefined') return;
    result[key] = normalizeValue(value);
  });
  return result;
}

function snapshot(id, row) {
  const exists = !!row;
  return {
    id,
    exists: () => exists,
    data: () => exists ? fromRow(row) : undefined
  };
}

function generatedId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

async function requireSingleMutation(query, ref, operation) {
  const key = ref.singleton ? 'user_id' : 'id';
  const { data, error } = await query.select(key);
  if (error) throw error;
  if (!Array.isArray(data) || data.length !== 1) {
    throw new Error(`${operation} não alterou o registro solicitado.`);
  }
}

export function getFirestore() {
  return { provider: 'supabase' };
}

export function collection(_db, ...path) {
  return makeRef('collection', path);
}

export function doc(_db, ...path) {
  return makeRef('doc', path);
}

export function serverTimestamp() {
  return SERVER_TIMESTAMP;
}

export async function getDocs(ref) {
  const { data, error } = await supabase
    .from(ref.table)
    .select('*')
    .eq('user_id', ref.userId);
  if (error) throw error;
  return {
    docs: (data || []).map(row => snapshot(row.id, row))
  };
}

export async function getDoc(ref) {
  if (ref.kind === 'userRoot') {
    const { data } = await supabase.auth.getUser();
    const own = data?.user?.id === ref.userId;
    return snapshot(ref.userId, own ? {
      id: ref.userId,
      email: data.user.email || '',
      createdAt: data.user.created_at
    } : null);
  }

  let query = supabase.from(ref.table).select('*').eq('user_id', ref.userId);
  if (!ref.singleton) query = query.eq('id', ref.id);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return snapshot(ref.id || ref.userId, data);
}

export async function addDoc(ref, data) {
  const id = generatedId();
  const payload = { user_id: ref.userId, id, ...normalizeWrite(data) };
  const { error } = await supabase.from(ref.table).insert(payload);
  if (error) throw error;
  return { id };
}

export async function setDoc(ref, data) {
  if (ref.kind === 'userRoot') return;
  const payload = ref.singleton
    ? { user_id: ref.userId, ...normalizeWrite(data) }
    : { user_id: ref.userId, id: ref.id, ...normalizeWrite(data) };
  const onConflict = ref.singleton ? 'user_id' : 'user_id,id';
  const { error } = await supabase.from(ref.table).upsert(payload, { onConflict });
  if (error) throw error;
}

export async function updateDoc(ref, data) {
  if (ref.kind === 'userRoot') return;
  let query = supabase
    .from(ref.table)
    .update(normalizeWrite(data))
    .eq('user_id', ref.userId);
  if (!ref.singleton) query = query.eq('id', ref.id);
  await requireSingleMutation(query, ref, 'Atualização');
}

export async function deleteDoc(ref) {
  if (ref.kind === 'userRoot') return;
  let query = supabase.from(ref.table).delete().eq('user_id', ref.userId);
  if (!ref.singleton) query = query.eq('id', ref.id);
  await requireSingleMutation(query, ref, 'Exclusão');
}

export function writeBatch() {
  const operations = [];
  return {
    delete(ref) {
      operations.push(() => deleteDoc(ref));
    },
    async commit() {
      for (const operation of operations) await operation();
    }
  };
}
