/* 在庫・特典・日報のロジック */
const PRODUCT_CATEGORIES = ['野菜', 'コーヒー', '備品'];
const CATEGORY_FIXED_UNITS = { '野菜': '袋', 'コーヒー': '個' };
const EQUIPMENT_UNITS = ['個', '枚', '本', '箱', '袋', 'セット', 'ロール', '缶', 'パック', 'ケース'];
const STOCK_TYPE_LABELS = { in: '初期在庫', out: '提供', return: '回収', adjust: '調整' };

function normalizeCategory(category) {
  return PRODUCT_CATEGORIES.indexOf(category) >= 0 ? category : '備品';
}

function unitForCategory(category, requested) {
  const c = normalizeCategory(category);
  if (CATEGORY_FIXED_UNITS[c]) return CATEGORY_FIXED_UNITS[c];
  return normName(requested || '') || '個';
}

function customerNameClean(name) {
  return normName(name).replace(/\s*様$/, '');
}

function nameMatchKey(name) {
  let s = String(name || '');
  if (s.normalize) s = s.normalize('NFKC');
  s = s.replace(/[\u30A1-\u30F6]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
  s = s.replace(/新規|会員|VIP|一般|HPB|ホットペッパー|ビューティー|予約/gi, '');
  s = s.replace(/[\s　・,，.．、。!！?？「」『』【】\[\]()（）]/g, '');
  s = s.replace(/(様|さん|殿|氏)$/, '');
  s = s.replace(/[ー〜～\-－]/g, '');
  return s.trim();
}

function nameDistance(a, b) {
  const s = String(a || ''), t = String(b || '');
  if (!s.length) return t.length;
  if (!t.length) return s.length;
  let prev = Array.from({ length: t.length + 1 }, (_, i) => i);
  for (let i = 1; i <= s.length; i++) {
    const cur = [i];
    for (let j = 1; j <= t.length; j++) {
      const cost = s.charAt(i - 1) === t.charAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[t.length];
}

function matchCustomerCandidates(name, customers) {
  const key = nameMatchKey(name);
  if (!key) return [];
  const list = [];
  (customers || []).forEach(c => {
    if (!c || !c.name) return;
    const ck = nameMatchKey(c.name);
    if (!ck) return;
    let score = 0;
    let reason = '';
    if (ck === key) {
      score = 100;
      reason = 'exact';
    } else {
      const short = Math.min(ck.length, key.length);
      if (short >= 2 && (ck.indexOf(key) === 0 || key.indexOf(ck) === 0)) {
        score = 80;
        reason = 'prefix';
      } else {
        const d = nameDistance(key, ck);
        const max = Math.max(key.length, ck.length);
        const allow = max <= 3 ? 1 : 2;
        const ratio = max <= 3 ? 0.34 : 0.5;
        if (d <= allow && d / max <= ratio) {
          score = 60 - d * 5;
          reason = 'fuzzy';
        }
      }
    }
    if (score) list.push({ customer: c, score: score, reason: reason });
  });
  return list.sort((a, b) => b.score - a.score || String(a.customer.name).localeCompare(String(b.customer.name), 'ja'));
}

function bestCustomerForName(name, customers, strict) {
  const candidates = matchCustomerCandidates(name, customers);
  if (!candidates.length) return null;
  if (candidates.length === 1) return (!strict || candidates[0].reason !== 'fuzzy') ? candidates[0].customer : null;
  if (candidates[0].reason === 'exact' && candidates.filter(c => c.score === candidates[0].score).length === 1) {
    return candidates[0].customer;
  }
  if (candidates[0].reason === 'prefix' && candidates.filter(c => c.score === candidates[0].score).length === 1) {
    return candidates[0].customer;
  }
  return null;
}

function customerLabel(name) {
  const n = customerNameClean(name);
  return n ? n + '様' : '';
}

function todayKey() {
  return dateKey(new Date());
}

function shiftDateKey(key, days) {
  const d = new Date(key + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return dateKey(d);
}

function reportDateLabel(key) {
  const d = new Date(key + 'T12:00:00');
  return d.getFullYear() + '/' + pad2(d.getMonth() + 1) + '/' + pad2(d.getDate());
}

function sortedProducts(includeInactive) {
  return state.products
    .filter(p => includeInactive || p.active !== false)
    .slice()
    .sort((a, b) => (a.sort || 0) - (b.sort || 0) || a.name.localeCompare(b.name, 'ja'));
}

function stockQty(productId, uptoDate) {
  return state.stockMoves
    .filter(m => m.productId === productId && (!uptoDate || m.date <= uptoDate))
    .reduce((sum, m) => sum + (m.type === 'out' ? -m.qty : m.qty), 0);
}

function currentStock(productId) {
  return stockQty(productId, null);
}

function stockQtyExcluding(productId, uptoDate, excludeId) {
  return state.stockMoves
    .filter(m => m.productId === productId && m.id !== excludeId && (!uptoDate || m.date <= uptoDate))
    .reduce((sum, m) => sum + (m.type === 'out' ? -m.qty : m.qty), 0);
}

function consumedQty(productId) {
  return state.stockMoves
    .filter(m => m.productId === productId && m.type === 'out')
    .reduce((sum, m) => sum + m.qty, 0);
}

function productLedger(productId) {
  const moves = state.stockMoves
    .filter(m => m.productId === productId)
    .slice()
    .sort((a, b) => (a.date + a.createdAt).localeCompare(b.date + b.createdAt));
  let balance = 0;
  const rows = moves.map(move => {
    balance += move.type === 'out' ? -move.qty : move.qty;
    return { move: move, balance: balance };
  });
  const monthMap = new Map();
  rows.forEach(row => {
    const month = row.move.date.slice(0, 7);
    if (!monthMap.has(month)) monthMap.set(month, { month: month, consumed: 0, replenished: 0, adjusted: 0, end: 0 });
    const entry = monthMap.get(month);
    if (row.move.type === 'out') entry.consumed += row.move.qty;
    else if (row.move.type === 'return') entry.replenished += row.move.qty;
    else if (row.move.type === 'adjust') entry.adjusted += row.move.qty;
    entry.end = row.balance;
  });
  const consumed = rows.filter(r => r.move.type === 'out').reduce((s, r) => s + r.move.qty, 0);
  const replenished = rows.filter(r => r.move.type === 'return').reduce((s, r) => s + r.move.qty, 0);
  const lastConsumed = rows.filter(r => r.move.type === 'out').slice(-1)[0];
  return {
    rows: rows.slice().reverse(),
    consumed: consumed,
    replenished: replenished,
    byMonth: Array.from(monthMap.values()).sort((a, b) => b.month.localeCompare(a.month)),
    current: balance,
    lastConsumed: lastConsumed ? lastConsumed.move.date : ''
  };
}

function movesOnDate(date) {
  return state.stockMoves
    .filter(m => m.date === date)
    .slice()
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

function customerProvideHistory(customerId, customerName) {
  return state.stockMoves
    .filter(m => m.type === 'out' && ((customerId && m.customerId === customerId) || (!m.customerId && customerNameClean(m.customerName) === customerNameClean(customerName))))
    .slice()
    .sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
}

function dailyInventorySummary(date) {
  const moves = movesOnDate(date);
  const productMap = new Map(state.products.map(p => [p.id, p]));

  const returns = [];
  const returnMap = new Map();
  moves.filter(m => m.type === 'return').forEach(m => {
    const cur = returnMap.get(m.productId) || 0;
    returnMap.set(m.productId, cur + m.qty);
  });
  sortedProducts(true).forEach(p => {
    if (returnMap.has(p.id) && returnMap.get(p.id) > 0) {
      returns.push({ product: p, qty: returnMap.get(p.id) });
    }
  });

  const provides = [];
  const outMap = new Map();
  moves.filter(m => m.type === 'out').forEach(m => {
    if (!outMap.has(m.productId)) outMap.set(m.productId, { total: 0, customers: new Map(), order: [] });
    const entry = outMap.get(m.productId);
    entry.total += m.qty;
    const name = normName(m.customerName) || '（名前なし）';
    if (!entry.customers.has(name)) {
      entry.customers.set(name, 0);
      entry.order.push(name);
    }
    entry.customers.set(name, entry.customers.get(name) + m.qty);
  });
  sortedProducts(true).forEach(p => {
    if (outMap.has(p.id) && outMap.get(p.id).total > 0) {
      const entry = outMap.get(p.id);
      provides.push({
        product: p,
        total: entry.total,
        customers: entry.order.map(name => ({ name: name, qty: entry.customers.get(name) }))
      });
    }
  });

  const stock = sortedProducts(true)
    .map(p => ({ product: p, qty: stockQty(p.id, date) }))
    .filter(x => x.qty > 0);

  return {
    date: date,
    returns: returns,
    provides: provides,
    stock: stock,
    moves: moves,
    productMap: productMap
  };
}

function buildDailyReport(date, includeDate) {
  const summary = dailyInventorySummary(date);
  const blocks = [];
  if (includeDate) blocks.push(reportDateLabel(date));
  blocks.push('【返信不要】\nお疲れ様です。');

  const reportReturns = summary.returns.filter(r => r.product.category !== '備品');
  const reportProvides = summary.provides.filter(p => p.product.category !== '備品');
  const reportStock = summary.stock.filter(s => s.product.category !== '備品');

  if (reportReturns.length) {
    blocks.push('【回収】\n' + reportReturns.map(r => r.product.name + '/' + r.qty).join('\n'));
  }

  if (reportProvides.length) {
    const lines = [];
    reportProvides.forEach(item => {
      lines.push(item.product.name + '/' + item.total);
      item.customers.forEach(c => {
        if (!c.name || c.name === '（名前なし）') return;
        lines.push('・' + customerNameClean(c.name) + '様/' + c.qty + item.product.unit);
      });
    });
    blocks.push('【提供】\n' + lines.join('\n'));
  }

  if (reportStock.length) {
    blocks.push('【在庫】\n' + reportStock.map(s => s.product.name + '/' + s.qty).join('\n'));
  }

  blocks.push('よろしくお願いいたします。');
  return blocks.join('\n\n') + '\n';
}
