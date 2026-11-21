/* 保存・集計用データ管理 */
const STORE_KEY = 'kangen-survey-v1';
const APP_VERSION = '1.2.0';

const SHEET_COLUMNS = [
  { key: 'id', label: '送信ID' },
  { key: 'date', label: '回答日時' },
  { key: 'customerName', label: '顧客名' },
  { key: 'roomLabel', label: '部屋' },
  { qid: 'shower' },
  { qid: 'pack' },
  { qid: 'drink' },
  { qid: 'wear' },
  { qid: 'temp' },
  { qid: 'stay' },
  { qid: 'hydrogen' },
  { qid: 'healingWear' },
  { qid: 'option' },
  { qid: 'condition' },
  { key: 'conditionScore', label: '体調スコア' },
  { qid: 'memo' },
  { key: 'customerId', label: '顧客ID' },
  { key: 'tablet', label: '端末' }
];

function sheetHeader() {
  return SHEET_COLUMNS.map(c => c.label || (questionById(c.qid) ? questionById(c.qid).short : c.qid));
}

function defaultState() {
  return {
    version: 1,
    customers: [],
    submissions: [],
    products: [],
    stockMoves: [],
    settings: {
      sheetUrl: '',
      token: '',
      autoSync: true,
      weekStart: 6,
      tabletName: ''
    },
    draft: null
  };
}

let state = loadState();

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    const base = defaultState();
    return {
      version: base.version,
      customers: Array.isArray(parsed.customers) ? parsed.customers : [],
      submissions: Array.isArray(parsed.submissions) ? parsed.submissions : [],
      products: Array.isArray(parsed.products) ? parsed.products : [],
      stockMoves: Array.isArray(parsed.stockMoves) ? parsed.stockMoves : [],
      settings: Object.assign(base.settings, parsed.settings || {}),
      draft: parsed.draft || null
    };
  } catch (err) {
    console.error('load failed', err);
    return defaultState();
  }
}

function saveState() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
    return true;
  } catch (err) {
    console.error('save failed', err);
    toast('保存に失敗しました。空き容量を確認してください。');
    return false;
  }
}

function uid(prefix) {
  const s = (prefix || 'id') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  return s;
}

function normName(name) {
  return String(name || '').replace(/\s+/g, ' ').trim();
}

function findCustomerByName(name) {
  const n = normName(name);
  return state.customers.find(c => normName(c.name) === n) || null;
}

function createCustomer(name, room, id) {
  const customer = {
    id: id || uid('cus'),
    name: normName(name),
    room: room || 'std',
    visits: 0,
    lastVisitAt: null,
    lastAnswers: {},
    createdAt: new Date().toISOString(),
    note: ''
  };
  state.customers.push(customer);
  saveState();
  return customer;
}

function updateCustomer(customer) {
  const idx = state.customers.findIndex(c => c.id === customer.id);
  if (idx >= 0) state.customers[idx] = customer;
  else state.customers.push(customer);
  saveState();
}

function getCustomer(id) {
  return state.customers.find(c => c.id === id) || null;
}

function previousAnswers(customerId, room) {
  const c = getCustomer(customerId);
  if (!c || !c.lastAnswers) return null;
  const a = c.lastAnswers[room];
  return a && Object.keys(a).length ? a : null;
}

function addSubmission(input) {
  const now = new Date().toISOString();
  const customer = getCustomer(input.customerId) || createCustomer(input.customerName, input.room);
  const submission = {
    id: uid('sub'),
    customerId: customer.id,
    customerName: customer.name,
    room: input.room,
    date: now,
    answers: input.answers || {},
    tablet: state.settings.tabletName || '',
    synced: false,
    source: 'local'
  };
  state.submissions.push(submission);

  customer.visits = (customer.visits || 0) + 1;
  customer.lastVisitAt = now;
  customer.room = input.room;
  customer.lastAnswers = customer.lastAnswers || {};
  customer.lastAnswers[input.room] = cloneAnswers(input.answers);
  updateCustomer(customer);
  saveState();
  return submission;
}

function cloneAnswers(answers) {
  const out = {};
  Object.keys(answers || {}).forEach(k => {
    out[k] = Array.isArray(answers[k]) ? answers[k].slice() : answers[k];
  });
  return out;
}

function submissionsForCustomer(customerId) {
  return state.submissions
    .filter(s => s.customerId === customerId)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

function deleteSubmission(id) {
  state.submissions = state.submissions.filter(s => s.id !== id);
  saveState();
}

function deleteCustomer(id) {
  state.customers = state.customers.filter(c => c.id !== id);
  state.submissions = state.submissions.filter(s => s.customerId !== id);
  saveState();
}

function getProduct(id) {
  return state.products.find(p => p.id === id) || null;
}

function nextProductSort() {
  if (!state.products.length) return 0;
  return Math.max.apply(null, state.products.map(p => p.sort || 0)) + 1;
}

function addProduct(input) {
  const product = {
    id: uid('prd'),
    name: normName(input.name),
    category: input.category || '野菜',
    unit: normName(input.unit) || '袋',
    sort: nextProductSort(),
    active: true,
    createdAt: new Date().toISOString()
  };
  state.products.push(product);
  saveState();
  const initial = Number(input.initial) || 0;
  if (initial > 0) {
    addStockMove({ date: dateKey(new Date()), type: 'in', productId: product.id, qty: initial, memo: '初期在庫' });
  }
  return product;
}

function updateProduct(id, patch) {
  const p = getProduct(id);
  if (!p) return null;
  ['name', 'category', 'unit', 'active'].forEach(k => {
    if (patch[k] !== undefined) p[k] = patch[k];
  });
  saveState();
  return p;
}

function deleteProduct(id) {
  const hasMoves = state.stockMoves.some(m => m.productId === id);
  if (hasMoves) return { ok: false, reason: '履歴があるため削除できません。非表示にしてください。' };
  state.products = state.products.filter(p => p.id !== id);
  saveState();
  return { ok: true };
}

function addStockMove(input) {
  const qty = Number(input.qty);
  if (!qty || isNaN(qty)) return null;
  const type = input.type || 'in';
  if (type !== 'adjust' && qty < 0) return null;
  const move = {
    id: uid('mov'),
    date: input.date || dateKey(new Date()),
    type: type,
    productId: input.productId,
    qty: qty,
    customerId: input.customerId || '',
    customerName: normName(input.customerName || ''),
    reservationId: input.reservationId || '',
    reservationTitle: input.reservationTitle || '',
    memo: normName(input.memo || ''),
    createdAt: new Date().toISOString()
  };
  state.stockMoves.push(move);
  saveState();
  return move;
}

function deleteStockMove(id) {
  state.stockMoves = state.stockMoves.filter(m => m.id !== id);
  saveState();
}

function movesForDate(date) {
  return state.stockMoves.filter(m => m.date === date);
}

function movesForCustomer(customerId, customerName) {
  return state.stockMoves.filter(m => m.type === 'out' &&
    ((customerId && m.customerId === customerId) || (!m.customerId && customerName && m.customerName === normName(customerName))));
}

function recomputeCustomers() {
  state.customers.forEach(c => {
    const list = state.submissions.filter(s => s.customerId === c.id)
      .sort((a, b) => new Date(b.date) - new Date(a.date));
    c.visits = list.length;
    if (list.length) {
      c.lastVisitAt = list[0].date;
      c.room = list[0].room;
    }
    const perRoom = {};
    list.forEach(s => { if (!perRoom[s.room]) perRoom[s.room] = cloneAnswers(s.answers); });
    c.lastAnswers = perRoom;
  });
}

function mergeRemoteSubmissions(rows) {
  let added = 0;
  let changed = false;
  const byId = new Map(state.submissions.map(s => [s.id, s]));
  (rows || []).forEach(r => {
    if (!r || !r.id) return;
    const existingSub = byId.get(r.id);
    if (existingSub) {
      if (!existingSub.synced) { existingSub.synced = true; changed = true; }
      return;
    }
    const name = normName(r.customerName || '（不明）');
    let local = r.customerId ? getCustomer(r.customerId) : null;
    if (!local) local = findCustomerByName(name);
    if (!local) {
      local = createCustomer(name, r.room === 'vip' ? 'vip' : 'std', r.customerId || uid('cus'));
    }
    const sub = {
      id: r.id,
      customerId: local.id,
      customerName: local.name,
      room: r.room === 'vip' ? 'vip' : 'std',
      date: r.date || new Date().toISOString(),
      answers: r.answers || {},
      tablet: r.tablet || '',
      synced: true,
      source: 'sheet'
    };
    state.submissions.push(sub);
    byId.set(sub.id, sub);
    added++;
  });
  if (added) recomputeCustomers();
  if (added || changed) saveState();
  return added;
}

function unsyncedSubmissions() {
  return state.submissions.filter(s => !s.synced && s.source !== 'sheet');
}

function toSheetRow(sub) {
  return SHEET_COLUMNS.map(c => {
    if (c.qid) return answerText(sub, c.qid);
    if (c.key === 'roomLabel') return ROOM_LABELS[sub.room] || '';
    if (c.key === 'date') return fmtDateTime(sub.date);
    if (c.key === 'conditionScore') {
      const score = conditionScore(answerText(sub, 'condition'));
      return score === null ? '' : String(score);
    }
    return String(sub[c.key] || '');
  });
}

function parseSheetDate(v) {
  const s = String(v || '').trim();
  if (!s) return new Date().toISOString();
  const m = s.match(/^(\d{4})[-\/年](\d{1,2})[-\/月](\d{1,2})日?(?:[ T](\d{1,2}):(\d{1,2}))?/);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0));
    return d.toISOString();
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function sheetRowToSubmission(row) {
  const obj = { answers: {} };
  const rowArr = Array.isArray(row) ? row : [];
  SHEET_COLUMNS.forEach((c, i) => {
    const v = rowArr[i] === undefined || rowArr[i] === null ? '' : String(rowArr[i]);
    if (c.qid) {
      if (v) {
        const q = questionById(c.qid);
        obj.answers[c.qid] = (q && q.type === 'multi') ? v.split(' / ').filter(Boolean) : v;
      }
      return;
    }
    if (c.key === 'roomLabel') {
      obj.room = v.indexOf('VIP') >= 0 ? 'vip' : 'std';
      return;
    }
    obj[c.key] = v;
  });
  if (obj.date) obj.date = parseSheetDate(obj.date);
  return obj;
}

function csvEscape(v) {
  const s = String(v === undefined || v === null ? '' : v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function submissionsToCsv(list) {
  const cols = SHEET_COLUMNS.filter(c => c.key !== 'id');
  const header = cols.map(c => c.label || (questionById(c.qid) ? questionById(c.qid).short : c.qid));
  const rows = list.map(s => cols.map(c => {
    if (c.qid) return answerText(s, c.qid);
    if (c.key === 'roomLabel') return ROOM_LABELS[s.room] || '';
    if (c.key === 'date') return fmtDateTime(s.date);
    if (c.key === 'conditionScore') {
      const score = conditionScore(answerText(s, 'condition'));
      return score === null ? '' : String(score);
    }
    return s[c.key] === undefined || s[c.key] === null ? '' : String(s[c.key]);
  }));
  return [header].concat(rows).map(r => r.map(csvEscape).join(',')).join('\r\n');
}

function aggregateToCsv(list, agg, periodLabel) {
  const lines = [];
  lines.push(['集計期間', periodLabel].map(csvEscape).join(','));
  lines.push(['回答数', agg.total].map(csvEscape).join(','));
  lines.push(['顧客数', agg.uniqueCustomers].map(csvEscape).join(','));
  lines.push(['VIPルーム', agg.byRoom.vip].map(csvEscape).join(','));
  lines.push(['一般ルーム', agg.byRoom.std].map(csvEscape).join(','));
  lines.push(['体調平均', agg.conditionAvg === null ? '' : agg.conditionAvg.toFixed(2)].map(csvEscape).join(','));
  lines.push('');
  lines.push(['質問', '選択肢', '回答数', '割合'].map(csvEscape).join(','));
  agg.questions.forEach(item => {
    if (item.q.type === 'text') {
      lines.push([item.q.short, 'コメント件数', item.respondents, ''].map(csvEscape).join(','));
      item.comments.forEach(c => {
        lines.push([item.q.short, c.name + '（' + fmtDate(c.date) + '）', '', c.text].map(csvEscape).join(','));
      });
      return;
    }
    item.counts.forEach(c => {
      const pct = item.respondents ? (c.count / item.respondents * 100).toFixed(1) + '%' : '';
      lines.push([item.q.short, c.option, c.count, pct].map(csvEscape).join(','));
    });
  });
  return lines.join('\r\n');
}

function downloadFile(filename, content, mime) {
  const type = mime || 'text/csv;charset=utf-8';
  const bom = type.indexOf('csv') >= 0 ? '\uFEFF' : '';
  const blob = new Blob([bom + content], { type: type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}

function exportBackup() {
  const payload = {
    app: 'kangen-survey',
    version: APP_VERSION,
    exportedAt: new Date().toISOString(),
    customers: state.customers,
    submissions: state.submissions,
    products: state.products,
    stockMoves: state.stockMoves,
    settings: { weekStart: state.settings.weekStart, tabletName: state.settings.tabletName }
  };
  downloadFile('survey-backup-' + dateKey(new Date()) + '.json', JSON.stringify(payload, null, 2), 'application/json');
}

function importBackup(text) {
  const data = JSON.parse(String(text).replace(/^\uFEFF/, ''));
  if (!data || !Array.isArray(data.customers) || !Array.isArray(data.submissions)) {
    throw new Error('バックアップ形式ではありません');
  }
  const existing = new Set(state.submissions.map(s => s.id));
  let addedSubs = 0;
  let addedCustomers = 0;
  let addedProducts = 0;
  let addedMoves = 0;
  data.customers.forEach(c => {
    if (!c || !c.id) return;
    if (!state.customers.find(x => x.id === c.id)) {
      state.customers.push(c);
      addedCustomers++;
    }
  });
  data.submissions.forEach(s => {
    if (!s || !s.id || existing.has(s.id)) return;
    state.submissions.push(Object.assign({}, s, { synced: s.synced !== false }));
    existing.add(s.id);
    addedSubs++;
  });
  (data.products || []).forEach(p => {
    if (!p || !p.id) return;
    if (!state.products.find(x => x.id === p.id)) {
      state.products.push(p);
      addedProducts++;
    }
  });
  const moveIds = new Set(state.stockMoves.map(m => m.id));
  (data.stockMoves || []).forEach(m => {
    if (!m || !m.id || moveIds.has(m.id)) return;
    state.stockMoves.push(m);
    moveIds.add(m.id);
    addedMoves++;
  });
  recomputeCustomers();
  saveState();
  return { addedSubs, addedCustomers, addedProducts, addedMoves };
}

function clearAllData() {
  const settings = state.settings;
  state = defaultState();
  state.settings = settings;
  saveState();
}

function statsCacheKey() {
  return STORE_KEY + '-s';
}
