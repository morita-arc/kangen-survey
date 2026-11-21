/* 在庫・特典・日報のロジック */
const PRODUCT_CATEGORIES = ['野菜', 'コーヒー', 'その他'];
const STOCK_TYPE_LABELS = { in: '仕入', out: '提供', return: '回収', adjust: '調整' };

function customerNameClean(name) {
  return normName(name).replace(/\s*様$/, '');
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
    .filter(m => m.productId === productId && m.type !== 'return' && (!uptoDate || m.date <= uptoDate))
    .reduce((sum, m) => sum + (m.type === 'out' ? -m.qty : m.qty), 0);
}

function currentStock(productId) {
  return stockQty(productId, null);
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

  if (summary.returns.length) {
    blocks.push('【回収】\n' + summary.returns.map(r => r.product.name + '/' + r.qty).join('\n'));
  }

  if (summary.provides.length) {
    const lines = [];
    summary.provides.forEach(item => {
      lines.push(item.product.name + '/' + item.total);
      item.customers.forEach(c => {
        if (!c.name || c.name === '（名前なし）') return;
        lines.push('・' + customerNameClean(c.name) + '様/' + c.qty + item.product.unit);
      });
    });
    blocks.push('【提供】\n' + lines.join('\n'));
  }

  if (summary.stock.length) {
    blocks.push('【在庫】\n' + summary.stock.map(s => s.product.name + '/' + s.qty).join('\n'));
  }

  blocks.push('よろしくお願いいたします。');
  return blocks.join('\n\n') + '\n';
}
