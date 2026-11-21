/* Supabase 全データ同期（localStorageキャッシュ + 行ストア + オフライン再送） */
const SUPABASE_SYNC_KEY = 'kangen-supabase-sync-v1';
const SUPABASE_TABLES = ['customers', 'submissions', 'products', 'stock_moves', 'reservation_links'];

let sbClient = null;
let sbChannel = null;
let sbSession = null;
let sbApplyingRemote = false;
let sbFlushing = false;
let sbFlushTimer = null;
let sbLastError = '';
let sbRealtimeStarted = false;

let sbSyncMeta = loadSupabaseMeta();
let sbSnapshot = null;

function loadSupabaseMeta() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SUPABASE_SYNC_KEY) || '{}');
    return {
      outbox: Array.isArray(parsed.outbox) ? parsed.outbox : [],
      lastPulledAt: parsed.lastPulledAt || '',
      deviceId: parsed.deviceId || ''
    };
  } catch (err) {
    return { outbox: [], lastPulledAt: '', deviceId: '' };
  }
}

function saveSupabaseMeta() {
  try {
    localStorage.setItem(SUPABASE_SYNC_KEY, JSON.stringify(sbSyncMeta));
  } catch (err) {
    console.error('supabase meta save failed', err);
  }
}

function supabaseConfigured() {
  return !!(state.settings.supabaseUrl && state.settings.supabaseAnonKey && window.supabase);
}

function supabaseStatus() {
  return {
    configured: supabaseConfigured(),
    signedIn: !!sbSession,
    email: sbSession && sbSession.user ? sbSession.user.email : '',
    pending: sbSyncMeta.outbox.length,
    lastPulledAt: sbSyncMeta.lastPulledAt,
    error: sbLastError
  };
}

function supabaseStatusLines() {
  const st = supabaseStatus();
  if (!st.configured) return 'Supabase未設定（URLとanonキーを保存してください）';
  if (!st.signedIn) return 'Supabase設定済み。ログインしてください（未送信 ' + st.pending + '件）';
  return 'ログイン中: ' + (st.email || '') + ' ・ 未送信 ' + st.pending + '件' +
    (st.lastPulledAt ? ' ・ 最終取得 ' + fmtDateTime(st.lastPulledAt) : '') +
    (st.error ? ' ・ エラー: ' + st.error : '');
}

function supabaseRowId(record) {
  if (record && record.__reservationLink) return record.kind + ':' + record.key;
  return record && record.id ? String(record.id) : '';
}

function supabaseRowsFromState() {
  const rows = {};
  rows.customers = (state.customers || []).map(c => ({ row_id: String(c.id), data: c }));
  rows.submissions = (state.submissions || []).map(s => ({ row_id: String(s.id), data: s }));
  rows.products = (state.products || []).map(p => ({ row_id: String(p.id), data: p }));
  rows.stock_moves = (state.stockMoves || []).map(m => ({ row_id: String(m.id), data: m }));
  const links = [];
  const rl = normalizeReservationLinks(state.reservationLinks);
  Object.keys(rl.names).forEach(key => {
    links.push({ row_id: 'name:' + key, data: { kind: 'name', key: key, customerId: rl.names[key] } });
  });
  Object.keys(rl.events).forEach(key => {
    links.push({ row_id: 'event:' + key, data: { kind: 'event', key: key, customerId: rl.events[key] } });
  });
  rows.reservation_links = links;
  return rows;
}

function supabaseBuildSnapshot() {
  const rows = supabaseRowsFromState();
  const snap = {};
  SUPABASE_TABLES.forEach(table => {
    snap[table] = new Map();
    (rows[table] || []).forEach(row => {
      snap[table].set(row.row_id, JSON.stringify(row.data));
    });
  });
  return snap;
}

function supabaseDiffSnapshots(prev, curr) {
  const changes = [];
  SUPABASE_TABLES.forEach(table => {
    const before = prev && prev[table] ? prev[table] : new Map();
    const after = curr && curr[table] ? curr[table] : new Map();
    after.forEach((json, rowId) => {
      if (before.get(rowId) !== json) {
        changes.push({ table: table, row_id: rowId, data: JSON.parse(json), deleted: false });
      }
    });
    before.forEach((json, rowId) => {
      if (!after.has(rowId)) {
        changes.push({ table: table, row_id: rowId, data: null, deleted: true });
      }
    });
  });
  return changes;
}

function supabaseEnqueue(changes) {
  if (!changes || !changes.length) return;
  const map = new Map();
  sbSyncMeta.outbox.forEach(item => map.set(item.table + '|' + item.row_id, item));
  changes.forEach(change => {
    map.set(change.table + '|' + change.row_id, {
      table: change.table,
      row_id: change.row_id,
      data: change.data,
      deleted: !!change.deleted,
      queuedAt: new Date().toISOString()
    });
  });
  sbSyncMeta.outbox = Array.from(map.values());
  saveSupabaseMeta();
}

function onStateSaved() {
  const current = supabaseBuildSnapshot();
  if (!sbSnapshot) {
    sbSnapshot = current;
    return;
  }
  if (sbApplyingRemote) {
    sbSnapshot = current;
    return;
  }
  const changes = supabaseDiffSnapshots(sbSnapshot, current);
  sbSnapshot = current;
  if (!supabaseConfigured()) return;
  if (changes.length) supabaseEnqueue(changes);
  if (state.settings.supabaseAutoSync) scheduleSupabaseFlush();
}

function scheduleSupabaseFlush() {
  if (sbFlushTimer) clearTimeout(sbFlushTimer);
  sbFlushTimer = setTimeout(() => {
    sbFlushTimer = null;
    flushSupabaseOutbox();
  }, 700);
}

function supabaseRefreshUi() {
  if (typeof render === 'function' && typeof view !== 'undefined' && view.screen === 'settings') render();
}

async function initSupabaseSync(force) {
  if (!window.supabase) {
    sbLastError = 'Supabaseライブラリを読み込めません（オフラインですか？）';
    sbClient = null;
    return;
  }
  const url = String(state.settings.supabaseUrl || '').trim();
  const key = String(state.settings.supabaseAnonKey || '').trim();
  if (!url || !key) {
    sbClient = null;
    sbSession = null;
    sbLastError = '';
    return;
  }
  if (!sbClient || force) {
    if (sbChannel && sbClient) { try { await sbClient.removeChannel(sbChannel); } catch (err) {} }
    sbChannel = null;
    sbRealtimeStarted = false;
    sbClient = window.supabase.createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    });
    sbClient.auth.onAuthStateChange((event, session) => {
      sbSession = session || null;
      sbLastError = '';
      if (sbSession) {
        startSupabaseSync();
      } else {
        stopSupabaseSync();
      }
      supabaseRefreshUi();
    });
  }
  try {
    const res = await sbClient.auth.getSession();
    sbSession = res && res.data ? res.data.session : null;
    if (sbSession) startSupabaseSync();
  } catch (err) {
    sbLastError = err.message || String(err);
  }
  supabaseRefreshUi();
}

async function supabaseSignIn(email, password) {
  if (!sbClient) await initSupabaseSync(true);
  if (!sbClient) throw new Error('先にSupabaseのURLとanonキーを保存してください');
  const res = await sbClient.auth.signInWithPassword({ email: email, password: password });
  if (res.error) throw res.error;
  sbSession = res.data ? res.data.session : null;
  sbLastError = '';
  if (sbSession) startSupabaseSync();
  supabaseRefreshUi();
  return sbSession;
}

async function supabaseSignOut() {
  if (sbClient) {
    try { await sbClient.auth.signOut(); } catch (err) {}
  }
  sbSession = null;
  stopSupabaseSync();
  supabaseRefreshUi();
}

async function startSupabaseSync() {
  if (!sbClient || !sbSession) return;
  subscribeSupabaseRealtime();
  await flushSupabaseOutbox();
  await pullSupabaseRows();
  supabaseRefreshUi();
}

function stopSupabaseSync() {
  if (sbChannel && sbClient) {
    try { sbClient.removeChannel(sbChannel); } catch (err) {}
  }
  sbChannel = null;
  sbRealtimeStarted = false;
}

function subscribeSupabaseRealtime() {
  if (!sbClient || !sbSession || sbRealtimeStarted) return;
  sbRealtimeStarted = true;
  sbChannel = sbClient.channel('app_rows_' + (sbSyncMeta.deviceId || 'device'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'app_rows' }, payload => {
      if (payload && payload.new) applySupabaseRows([payload.new]);
    })
    .subscribe();
}

async function pullSupabaseRows() {
  if (!sbClient || !sbSession) return;
  const pageSize = 1000;
  let from = 0;
  const rows = [];
  try {
    while (true) {
      let query = sbClient.from('app_rows').select('*').order('updated_at', { ascending: true }).range(from, from + pageSize - 1);
      if (sbSyncMeta.lastPulledAt) query = query.gt('updated_at', sbSyncMeta.lastPulledAt);
      const res = await query;
      if (res.error) throw res.error;
      const data = res.data || [];
      rows.push.apply(rows, data);
      if (data.length < pageSize) break;
      from += pageSize;
    }
    if (rows.length) {
      const latest = rows.reduce((max, row) => (row.updated_at > max ? row.updated_at : max), sbSyncMeta.lastPulledAt || '');
      sbSyncMeta.lastPulledAt = latest;
      saveSupabaseMeta();
    }
    sbLastError = '';
    applySupabaseRows(rows);
  } catch (err) {
    sbLastError = err.message || String(err);
    supabaseRefreshUi();
  }
}

function applySupabaseRows(rows) {
  if (!rows || !rows.length || !sbClient) return;
  const pending = new Set(sbSyncMeta.outbox.map(item => item.table + '|' + item.row_id));
  const usable = rows.filter(row => row && row.table_name && row.row_id && !pending.has(row.table_name + '|' + row.row_id));
  if (!usable.length) return;
  sbApplyingRemote = true;
  let changed = false;
  usable.forEach(row => {
    const table = row.table_name;
    const id = String(row.row_id);
    const deleted = !!row.deleted_at;
    if (table === 'customers' || table === 'submissions' || table === 'products' || table === 'stock_moves') {
      const key = table === 'stock_moves' ? 'stockMoves' : table;
      const list = state[key];
      const idx = list.findIndex(item => String(item.id) === id);
      if (deleted) {
        if (idx >= 0) { list.splice(idx, 1); changed = true; }
      } else if (row.data && row.data.id) {
        if (idx >= 0) { list[idx] = row.data; changed = true; }
        else { list.push(row.data); changed = true; }
      }
    } else if (table === 'reservation_links') {
      const d = row.data || {};
      if (!d.kind || !d.key) return;
      state.reservationLinks = normalizeReservationLinks(state.reservationLinks);
      const map = d.kind === 'name' ? state.reservationLinks.names : state.reservationLinks.events;
      if (deleted) {
        if (map[d.key] !== undefined) { delete map[d.key]; changed = true; }
      } else if (d.customerId) {
        if (map[d.key] !== d.customerId) { map[d.key] = d.customerId; changed = true; }
      }
    }
  });
  if (changed) {
    saveState();
    sbSnapshot = supabaseBuildSnapshot();
    if (typeof render === 'function') render();
  }
  sbApplyingRemote = false;
}

async function flushSupabaseOutbox() {
  if (!sbClient || !sbSession || sbFlushing) return;
  if (!navigator.onLine) { sbLastError = 'オフラインのため未送信を保持しています'; supabaseRefreshUi(); return; }
  if (!sbSyncMeta.outbox.length) {
    await pullSupabaseRows();
    return;
  }
  sbFlushing = true;
  const batch = sbSyncMeta.outbox.slice(0, 40);
  const rows = batch.map(item => ({
    table_name: item.table,
    row_id: item.row_id,
    data: item.deleted ? {} : (item.data || {}),
    deleted_at: item.deleted ? new Date().toISOString() : null,
    device_id: sbSyncMeta.deviceId || ''
  }));
  try {
    const res = await sbClient.from('app_rows').upsert(rows, { onConflict: 'table_name,row_id' });
    if (res.error) throw res.error;
    const done = new Set(batch.map(item => item.table + '|' + item.row_id));
    sbSyncMeta.outbox = sbSyncMeta.outbox.filter(item => !done.has(item.table + '|' + item.row_id));
    sbLastError = '';
    saveSupabaseMeta();
  } catch (err) {
    sbLastError = err.message || String(err);
  } finally {
    sbFlushing = false;
  }
  supabaseRefreshUi();
  if (sbSyncMeta.outbox.length) {
    if (state.settings.supabaseAutoSync) scheduleSupabaseFlush();
  } else {
    await pullSupabaseRows();
    supabaseRefreshUi();
  }
}

async function supabaseSyncNow() {
  if (!sbSession) await initSupabaseSync(false);
  if (!sbSession) { sbLastError = 'ログインしてください'; supabaseRefreshUi(); throw new Error('ログインしてください'); }
  await flushSupabaseOutbox();
  await pullSupabaseRows();
  supabaseRefreshUi();
}

async function supabaseUploadLocal() {
  if (!sbSession) await initSupabaseSync(false);
  if (!sbSession) { sbLastError = 'ログインしてください'; supabaseRefreshUi(); throw new Error('ログインしてください'); }
  const rows = supabaseRowsFromState();
  const changes = [];
  SUPABASE_TABLES.forEach(table => {
    (rows[table] || []).forEach(row => changes.push({ table: table, row_id: row.row_id, data: row.data, deleted: false }));
  });
  supabaseEnqueue(changes);
  await flushSupabaseOutbox();
  supabaseRefreshUi();
}

if (!sbSyncMeta.deviceId) {
  sbSyncMeta.deviceId = uid('dev');
  saveSupabaseMeta();
}

sbSnapshot = supabaseBuildSnapshot();

window.addEventListener('online', () => {
  if (supabaseConfigured() && state.settings.supabaseAutoSync) supabaseSyncNow();
});

setInterval(() => {
  if (sbSession && supabaseConfigured() && state.settings.supabaseAutoSync) {
    pullSupabaseRows();
  }
}, 60000);
