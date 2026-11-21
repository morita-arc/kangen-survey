/* 在庫・特典・日報の画面 */
function stockClass(n) {
  if (n < 0) return 'neg';
  if (n === 0) return 'zero';
  if (n <= 2) return 'low';
  return '';
}

function typeBadge(type) {
  return '<span class="badge stock-type ' + type + '">' + (STOCK_TYPE_LABELS[type] || type) + '</span>';
}

function moveQtyText(m) {
  if (m.type === 'out') return '-' + m.qty;
  if (m.type === 'return') return String(m.qty);
  if (m.type === 'adjust') return (m.qty > 0 ? '+' : '') + m.qty;
  return '+' + m.qty;
}

function inventoryView() {
  const today = todayKey();
  const products = sortedProducts(true);
  const summary = dailyInventorySummary(today);
  const provided = summary.provides.reduce((s, x) => s + x.total, 0);
  const returned = summary.returns.reduce((s, x) => s + x.qty, 0);
  const inStock = products.filter(p => currentStock(p.id) > 0).length;
  const zero = products.filter(p => currentStock(p.id) <= 0).length;
  const groups = PRODUCT_CATEGORIES.map(category => ({
    category: category,
    items: products.filter(p => p.category === category)
  })).filter(g => g.items.length);
  const recent = summary.moves.slice().reverse().slice(0, 8);

  return '' +
    '<section class="inv-hero">' +
      '<div><p class="eyebrow">在庫・特典</p><h1>在庫管理</h1>' +
      '<p class="lead">野菜・コーヒーの提供、仕入、回収を記録。日報はコピーしてそのまま送れます。</p></div>' +
      '<div class="inv-hero-actions">' +
        '<button class="btn primary xl" data-act="inv-entry" data-value="out">＋ 提供を記録</button>' +
      '</div>' +
    '</section>' +

    '<section class="kpis">' +
      kpi('本日の提供', provided + '<span class="unit">点</span>') +
      kpi('本日の回収', returned + '<span class="unit">点</span>') +
      kpi('在庫あり', inStock + '<span class="unit">商品</span>') +
      kpi('在庫切れ', zero + '<span class="unit">商品</span>') +
    '</section>' +

    '<section class="inv-actions">' +
      '<button class="inv-action" data-act="inv-entry" data-value="in"><span class="inv-action-title">仕入を記録</span><span class="inv-action-sub">いつ・何個入ったか</span></button>' +
      '<button class="inv-action" data-act="inv-entry" data-value="return"><span class="inv-action-title">回収を記録</span><span class="inv-action-sub">日報用（在庫は変えません）</span></button>' +
      '<button class="inv-action" data-act="inv-report"><span class="inv-action-title">日報を作成</span><span class="inv-action-sub">コピーしてチャットへ</span></button>' +
      '<button class="inv-action" data-act="product-add"><span class="inv-action-title">商品登録</span><span class="inv-action-sub">野菜・コーヒーの種類</span></button>' +
      '<button class="inv-action" data-act="inv-history"><span class="inv-action-title">履歴</span><span class="inv-action-sub">提供・仕入・回収の記録</span></button>' +
    '</section>' +

    '<section class="panel">' +
      '<div class="panel-head"><h2>現在の在庫</h2><span class="muted small">' + products.length + '品目</span></div>' +
      (products.length
        ? groups.map(g =>
            '<div class="stock-group"><h3>' + esc(g.category) + '</h3>' + g.items.map(p => {
              const qty = currentStock(p.id);
              return '<div class="stock-row">' +
                '<div class="stock-main"><span class="stock-name">' + esc(p.name) + '</span>' +
                  '<span class="stock-cat">' + esc(p.category) + (p.active === false ? ' ・ 非表示' : '') + '</span></div>' +
                '<div class="stock-qty ' + stockClass(qty) + '"><strong>' + qty + '</strong><span>' + esc(p.unit) + '</span></div>' +
                '<button class="btn small" data-act="adjust-stock" data-value="' + esc(p.id) + '">調整</button>' +
              '</div>';
            }).join('') + '</div>').join('')
        : '<div class="empty-state"><p>商品が登録されていません。野菜・コーヒーの種類を登録してください。</p>' +
          '<button class="btn primary" data-act="product-add">商品を登録</button></div>') +
    '</section>' +

    '<section class="panel">' +
      '<div class="panel-head"><h2>本日の動き</h2><button class="link" data-act="inv-history">すべて見る</button></div>' +
      (recent.length
        ? '<ul class="move-list">' + recent.map(m => {
            const p = getProduct(m.productId);
            return '<li class="move-row">' + typeBadge(m.type) +
              '<span class="move-main">' + esc(p ? p.name : '（不明）') +
              ' <strong>' + moveQtyText(m) + '</strong>' + esc(p ? p.unit : '') + '</span>' +
              '<span class="move-meta">' + esc(m.customerName ? customerLabel(m.customerName) : '') +
              (m.memo ? (m.customerName ? ' ・ ' : '') + esc(m.memo) : '') + '</span>' +
              '<span class="move-time">' + esc(fmtTime(m.createdAt)) + '</span></li>';
          }).join('') + '</ul>'
        : '<p class="empty">本日の記録はまだありません。上の「提供を記録」から始めてください。</p>') +
    '</section>';
}

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

function startEntry(kind) {
  view.entry = {
    kind: kind,
    date: todayKey(),
    customerName: '',
    memo: '',
    qty: {},
    saving: false
  };
  const screen = kind === 'out' ? 'provide' : kind === 'in' ? 'purchase' : 'collect';
  setScreen(screen);
}

function entryView(screen) {
  const kind = screen === 'provide' ? 'out' : screen === 'purchase' ? 'in' : 'return';
  const e = view.entry;
  if (!e || e.kind !== kind) {
    return '<div class="empty-state"><p>入力画面を開き直してください。</p>' +
      '<button class="btn primary" data-act="inv-entry" data-value="' + kind + '">開始する</button></div>';
  }
  const products = sortedProducts(false);
  const total = products.reduce((s, p) => s + (Number(e.qty[p.id]) || 0), 0);
  const isOut = kind === 'out';
  const customerNames = Array.from(new Set(state.customers.map(c => c.name))).sort((a, b) => a.localeCompare(b, 'ja'));

  return '' +
    '<section class="panel entry-meta">' +
      (isOut
        ? '<label class="field"><span>お客様名</span>' +
          '<input id="entry-customer" class="input" type="text" list="customer-names" autocomplete="off" data-input="entry-customer" value="' + esc(e.customerName) + '" placeholder="お名前を入力または選択">' +
          '<datalist id="customer-names">' + customerNames.map(n => '<option value="' + esc(n) + '"></option>').join('') + '</datalist>' +
          '<span class="muted small">登録済みの名前を選ぶか、新しく入力してください（自動で顧客登録されます）</span></label>'
        : '') +
      '<label class="field"><span>日付（過去の日付も選べます）</span>' +
        '<input class="input" type="date" data-input="entry-date" value="' + esc(e.date) + '"></label>' +
      '<label class="field"><span>' + (kind === 'in' ? '仕入先・メモ' : 'メモ（任意）') + '</span>' +
        '<input class="input" type="text" data-input="entry-memo" value="' + esc(e.memo) + '" placeholder="' + (kind === 'in' ? '例）○○青果' : '例）返却分') + '"></label>' +
      (kind === 'return'
        ? '<p class="inv-note">回収は日報に記録されますが、在庫数は変わりません。</p>'
        : '') +
    '</section>' +

    '<section class="panel entry-products">' +
      '<div class="panel-head"><h2>' + (isOut ? '提供する商品' : kind === 'in' ? '仕入れた商品' : '回収した商品') + '</h2>' +
      '<span class="muted small">数量を入力（＋ / −）</span></div>' +
      (products.length ? '<div class="entry-list">' + products.map(p => {
        const qty = Number(e.qty[p.id]) || 0;
        const stock = stockQty(p.id, e.date);
        const short = isOut && qty > stock;
        return '<div class="entry-row">' +
          '<div class="entry-info"><span class="entry-name">' + esc(p.name) + '</span>' +
            '<span class="entry-sub">在庫 ' + stock + esc(p.unit) + ' ・ ' + esc(p.category) + '</span>' +
            (short ? '<span class="entry-short">在庫が不足します</span>' : '') +
          '</div>' +
          '<div class="stepper">' +
            '<button class="step-btn" data-act="qty-dec" data-value="' + esc(p.id) + '" aria-label="減らす">−</button>' +
            '<input class="step-input" type="number" inputmode="numeric" min="0" step="1" value="' + qty + '" data-input="entry-qty" data-id="' + esc(p.id) + '">' +
            '<button class="step-btn" data-act="qty-inc" data-value="' + esc(p.id) + '" aria-label="増やす">＋</button>' +
            '<span class="step-unit">' + esc(p.unit) + '</span>' +
          '</div>' +
        '</div>';
      }).join('') + '</div>'
        : '<div class="empty-state"><p>商品がありません。先に商品を登録してください。</p>' +
          '<button class="btn" data-act="product-add">商品登録へ</button></div>') +
    '</section>' +

    '<div class="entry-footer">' +
      '<div class="entry-total">合計 <strong>' + total + '</strong> 点</div>' +
      '<button class="btn primary lg" data-act="entry-save">' +
        (isOut ? '提供を保存' : kind === 'in' ? '仕入を保存' : '回収を保存') + '</button>' +
    '</div>';
}

function saveEntry() {
  const e = view.entry;
  if (!e || e.saving) return;
  const items = sortedProducts(false)
    .map(p => ({ product: p, qty: Number(e.qty[p.id]) || 0 }))
    .filter(x => x.qty > 0);
  if (!items.length) { toast('数量を入力してください'); return; }

  if (e.kind === 'out') {
    const name = customerNameClean(e.customerName);
    if (!name) { toast('お客様名を入力してください'); return; }
    const short = items.filter(x => x.qty > stockQty(x.product.id, e.date));
    if (short.length) {
      const list = short.map(x => x.product.name + '（在庫' + stockQty(x.product.id, e.date) + '）').join('、');
      confirmDialog('在庫が不足します', list + ' の在庫が足りません。このまま記録しますか？', 'このまま保存', 'primary')
        .then(ok => { if (ok) commitEntry(items, name); });
      return;
    }
    commitEntry(items, name);
  } else {
    commitEntry(items, '');
  }
}

function commitEntry(items, customerName) {
  const e = view.entry;
  if (!e) return;
  e.saving = true;
  let customer = null;
  if (e.kind === 'out') {
    customer = findCustomerByName(customerName) || state.customers.find(c => customerNameClean(c.name) === customerName) || createCustomer(customerName, 'std');
  }
  items.forEach(x => {
    addStockMove({
      date: e.date,
      type: e.kind,
      productId: x.product.id,
      qty: x.qty,
      customerId: customer ? customer.id : '',
      customerName: customer ? customer.name : '',
      memo: e.memo
    });
  });
  view.entry = null;
  toast(items.length + '件記録しました');
  setScreen('inventory');
}

function productsView() {
  const products = state.products.slice().sort((a, b) => (a.sort || 0) - (b.sort || 0));
  return '' +
    '<div class="panel-head"><h2>商品一覧</h2><button class="btn primary" data-act="product-add">＋ 商品を追加</button></div>' +
    (products.length
      ? '<ul class="product-list">' + products.map(p => {
          const qty = currentStock(p.id);
          return '<li class="product-row ' + (p.active === false ? 'inactive' : '') + '">' +
            '<div class="product-main"><span class="product-name">' + esc(p.name) + '</span>' +
              '<span class="product-sub">' + esc(p.category) + ' ・ ' + esc(p.unit) + (p.active === false ? ' ・ 非表示' : '') + '</span></div>' +
            '<div class="stock-qty ' + stockClass(qty) + '"><strong>' + qty + '</strong><span>' + esc(p.unit) + '</span></div>' +
            '<button class="btn small" data-act="product-edit" data-value="' + esc(p.id) + '">編集</button>' +
          '</li>';
        }).join('') + '</ul>'
      : '<div class="empty-state"><p>まだ商品がありません。</p><button class="btn primary" data-act="product-add">商品を登録</button></div>') +
    '<p class="muted small">商品の種類・単位を登録します。在庫の修正は「在庫」画面の「調整」から行えます。</p>';
}

function productModal(id) {
  const p = id ? getProduct(id) : null;
  const isEdit = !!p;
  const qty = p ? currentStock(p.id) : 0;
  $('#modal-root').innerHTML =
    '<div class="modal-backdrop" data-act="modal-close" data-value="0">' +
      '<div class="modal">' +
        '<h2>' + (isEdit ? '商品を編集' : '商品を追加') + '</h2>' +
        '<label class="field"><span>商品名</span>' +
          '<input id="product-name" class="input" type="text" autocomplete="off" value="' + esc(p ? p.name : '') + '" placeholder="例）ミックス、アラビカ"></label>' +
        '<label class="field"><span>種類</span>' +
          '<select id="product-category" class="input">' +
            PRODUCT_CATEGORIES.map(c => '<option value="' + esc(c) + '"' + ((p ? p.category : '野菜') === c ? ' selected' : '') + '>' + esc(c) + '</option>').join('') +
          '</select></label>' +
        '<label class="field"><span>単位</span>' +
          '<input id="product-unit" class="input" type="text" list="unit-options" autocomplete="off" value="' + esc(p ? p.unit : '袋') + '" placeholder="袋 / 個 / 杯 など">' +
          '<datalist id="unit-options"><option value="袋"></option><option value="個"></option><option value="杯"></option><option value="本"></option><option value="箱"></option></datalist></label>' +
        (isEdit
          ? '<p class="muted small">現在の在庫：' + qty + esc(p.unit) + '（変更は「在庫」→「調整」から）</p>' +
            '<label class="check"><input id="product-active" type="checkbox"' + (p.active === false ? '' : ' checked') + '> 提供画面に表示する</label>'
          : '<label class="field"><span>初期在庫</span>' +
            '<div class="stepper"><button class="step-btn" data-act="draft-step" data-value="-1" aria-label="減らす">−</button>' +
            '<input id="product-initial" class="step-input" type="number" inputmode="numeric" min="0" step="1" value="0">' +
            '<button class="step-btn" data-act="draft-step" data-value="1" aria-label="増やす">＋</button></div></label>') +
        '<div class="modal-actions">' +
          (isEdit ? '<button class="btn ghost danger-text" data-act="product-delete" data-value="' + esc(p.id) + '">削除</button>' : '') +
          '<button class="btn ghost" data-act="modal-close" data-value="0">キャンセル</button>' +
          '<button class="btn primary" data-act="product-save" data-value="' + esc(p ? p.id : '') + '">保存</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  setTimeout(() => { const el = $('#product-name'); if (el) el.focus(); }, 50);
}

function saveProduct(id) {
  const name = normName($('#product-name') ? $('#product-name').value : '');
  const category = $('#product-category') ? $('#product-category').value : '野菜';
  const unit = normName($('#product-unit') ? $('#product-unit').value : '') || '袋';
  if (!name) { toast('商品名を入力してください'); return; }
  const duplicate = state.products.find(p => p.id !== id && normName(p.name) === name);
  if (duplicate) { toast('同じ名前の商品が登録されています'); return; }

  if (id) {
    const active = $('#product-active') ? $('#product-active').checked : true;
    updateProduct(id, { name: name, category: category, unit: unit, active: active });
    toast('商品を更新しました');
  } else {
    const initial = Number($('#product-initial') ? $('#product-initial').value : 0) || 0;
    addProduct({ name: name, category: category, unit: unit, initial: initial });
    toast('商品を登録しました（初期在庫 ' + initial + '）');
  }
  $('#modal-root').innerHTML = '';
  render();
}

function deleteProductFromModal(id) {
  const p = getProduct(id);
  if (!p) return;
  confirmDialog('商品を削除', p.name + ' を削除します。履歴がある場合は削除できません。', '削除する')
    .then(ok => {
      if (!ok) return;
      const res = deleteProduct(id);
      if (!res.ok) { toast(res.reason); return; }
      $('#modal-root').innerHTML = '';
      toast('削除しました');
      render();
    });
}

function adjustStockModal(id) {
  const p = getProduct(id);
  if (!p) return;
  const qty = currentStock(id);
  $('#modal-root').innerHTML =
    '<div class="modal-backdrop" data-act="modal-close" data-value="0">' +
      '<div class="modal">' +
        '<h2>在庫を調整</h2>' +
        '<p class="muted">' + esc(p.name) + ' の現在の在庫：' + qty + esc(p.unit) + '</p>' +
        '<label class="field"><span>新しい在庫数</span>' +
          '<input id="adjust-value" class="input" type="number" inputmode="numeric" min="0" step="1" value="' + Math.max(0, qty) + '"></label>' +
        '<label class="field"><span>理由（任意）</span>' +
          '<input id="adjust-reason" class="input" type="text" value="在庫調整" placeholder="例）棚卸し"></label>' +
        '<div class="modal-actions">' +
          '<button class="btn ghost" data-act="modal-close" data-value="0">キャンセル</button>' +
          '<button class="btn primary" data-act="adjust-save" data-value="' + esc(id) + '">保存</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  setTimeout(() => { const el = $('#adjust-value'); if (el) el.select(); }, 50);
}

function saveAdjust(id) {
  const val = Number($('#adjust-value') ? $('#adjust-value').value : NaN);
  if (isNaN(val) || val < 0) { toast('0以上の数字を入力してください'); return; }
  const delta = val - currentStock(id);
  if (!delta) { $('#modal-root').innerHTML = ''; return; }
  const reason = normName($('#adjust-reason') ? $('#adjust-reason').value : '') || '在庫調整';
  addStockMove({ date: todayKey(), type: 'adjust', productId: id, qty: delta, memo: reason });
  $('#modal-root').innerHTML = '';
  toast('在庫を調整しました');
  render();
}

function reportView() {
  const date = view.reportDate || todayKey();
  const text = buildDailyReport(date, view.reportIncludeDate);
  const summary = dailyInventorySummary(date);
  const provided = summary.provides.reduce((s, x) => s + x.total, 0);
  const returned = summary.returns.reduce((s, x) => s + x.qty, 0);
  const rows = Math.max(14, Math.min(40, text.split('\n').length + 2));
  return '' +
    '<div class="date-nav">' +
      '<button class="btn small" data-act="report-shift" data-value="-1">‹ 前日</button>' +
      '<input class="input" type="date" data-input="report-date" value="' + esc(date) + '">' +
      '<button class="btn small" data-act="report-shift" data-value="1">翌日 ›</button>' +
      '<button class="btn small ghost" data-act="report-today">今日</button>' +
    '</div>' +
    '<label class="check"><input type="checkbox" data-input="report-include-date"' + (view.reportIncludeDate ? ' checked' : '') + '> 日付を先頭に入れる</label>' +
    '<p class="muted small">' + esc(reportDateLabel(date)) + ' の提供：' + provided + '点 ／ 回収：' + returned + '点</p>' +
    '<textarea id="report-text" class="report-text" readonly rows="' + rows + '" spellcheck="false">' + esc(text) + '</textarea>' +
    '<div class="row-buttons">' +
      '<button class="btn primary lg" data-act="report-copy">日報をコピー</button>' +
      '<button class="btn" data-act="report-shift" data-value="-1">前日を見る</button>' +
      '<button class="btn" data-act="report-shift" data-value="1">翌日を見る</button>' +
    '</div>' +
    '<p class="muted small">チャットにそのまま貼り付けてください。過去の日付も上の日付から選べます。</p>';
}

function copyReport() {
  const ta = $('#report-text');
  if (!ta) return;
  const text = ta.value;
  const done = () => toast('日報をコピーしました');
  const fallback = () => {
    ta.focus();
    ta.select();
    try { document.execCommand('copy'); done(); }
    catch (e) { toast('長押しでコピーしてください'); }
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(fallback);
  } else {
    fallback();
  }
}

function invHistoryView() {
  const date = view.invHistoryDate || todayKey();
  const moves = movesOnDate(date).slice().reverse();
  return '' +
    '<div class="date-nav">' +
      '<button class="btn small" data-act="history-shift" data-value="-1">‹ 前日</button>' +
      '<span class="date-label">' + esc(reportDateLabel(date)) + '</span>' +
      '<button class="btn small" data-act="history-shift" data-value="1">翌日 ›</button>' +
      '<button class="btn small ghost" data-act="history-today">今日</button>' +
    '</div>' +
    (moves.length
      ? '<ul class="move-list history-list">' + moves.map(m => {
          const p = getProduct(m.productId);
          return '<li class="move-row">' + typeBadge(m.type) +
            '<span class="move-main">' + esc(p ? p.name : '（不明）') +
            ' <strong>' + moveQtyText(m) + '</strong>' + esc(p ? p.unit : '') + '</span>' +
            '<span class="move-meta">' + esc(m.customerName ? customerLabel(m.customerName) : '') +
            (m.memo ? (m.customerName ? ' ・ ' : '') + esc(m.memo) : '') + '</span>' +
            '<span class="move-time">' + esc(fmtTime(m.createdAt)) + '</span>' +
            '<button class="btn small ghost danger-text" data-act="move-delete" data-value="' + esc(m.id) + '">削除</button>' +
          '</li>';
        }).join('') + '</ul>'
      : '<div class="empty-state"><p>この日の記録はありません。</p></div>') +
    '<p class="muted small">記録を削除すると在庫も再計算されます。</p>';
}

function handleInventoryClick(e) {
  const target = e.target.closest('[data-act]');
  if (!target) return;
  const act = target.dataset.act;
  const value = target.dataset.value;
  switch (act) {
    case 'inv-entry': startEntry(value); break;
    case 'inv-report':
      view.reportDate = todayKey();
      setScreen('report');
      break;
    case 'inv-history':
      view.invHistoryDate = todayKey();
      setScreen('invhistory');
      break;
    case 'qty-inc':
    case 'qty-dec': {
      if (!view.entry) break;
      const id = value;
      const cur = Number(view.entry.qty[id]) || 0;
      view.entry.qty[id] = Math.max(0, Math.min(9999, cur + (act === 'qty-inc' ? 1 : -1)));
      render();
      break;
    }
    case 'entry-save': saveEntry(); break;
    case 'product-add': productModal(null); break;
    case 'product-edit': productModal(value); break;
    case 'product-save': saveProduct(value); break;
    case 'product-delete': deleteProductFromModal(value); break;
    case 'adjust-stock': adjustStockModal(value); break;
    case 'adjust-save': saveAdjust(value); break;
    case 'draft-step': {
      const input = $('#product-initial');
      if (input) input.value = Math.max(0, (Number(input.value) || 0) + Number(value));
      break;
    }
    case 'report-shift':
      view.reportDate = shiftDateKey(view.reportDate || todayKey(), Number(value));
      render();
      break;
    case 'report-today':
      view.reportDate = todayKey();
      render();
      break;
    case 'report-copy': copyReport(); break;
    case 'history-shift':
      view.invHistoryDate = shiftDateKey(view.invHistoryDate || todayKey(), Number(value));
      render();
      break;
    case 'history-today':
      view.invHistoryDate = todayKey();
      render();
      break;
    case 'move-delete': {
      const move = state.stockMoves.find(m => m.id === value);
      if (!move) break;
      const p = getProduct(move.productId);
      confirmDialog('記録を削除', (p ? p.name : '') + ' ' + moveQtyText(move) + ' の記録を削除します。在庫も再計算されます。', '削除する')
        .then(ok => {
          if (!ok) return;
          deleteStockMove(value);
          toast('削除しました');
          render();
        });
      break;
    }
    default: break;
  }
}

function handleInventoryInput(e) {
  const t = e.target;
  if (!t || !t.dataset || !t.dataset.input) return;
  const key = t.dataset.input;
  if (key === 'entry-date') {
    if (view.entry) view.entry.date = t.value || todayKey();
    render();
    return;
  }
  if (key === 'entry-memo') {
    if (view.entry) view.entry.memo = t.value;
    return;
  }
  if (key === 'entry-customer') {
    if (view.entry) view.entry.customerName = t.value;
    return;
  }
  if (key === 'entry-qty') {
    if (!view.entry) return;
    const id = t.dataset.id;
    const v = Math.max(0, Math.min(9999, parseInt(t.value || '0', 10) || 0));
    view.entry.qty[id] = v;
    const totalEl = $('.entry-total strong');
    if (totalEl) {
      const total = Object.keys(view.entry.qty).reduce((s, k) => s + (Number(view.entry.qty[k]) || 0), 0);
      totalEl.textContent = total;
    }
    return;
  }
  if (key === 'report-date') {
    if (!t.value) return;
    view.reportDate = t.value;
    render();
    return;
  }
  if (key === 'report-include-date') {
    view.reportIncludeDate = t.checked;
    render();
    return;
  }
}

document.addEventListener('click', handleInventoryClick);
document.addEventListener('input', handleInventoryInput);
document.addEventListener('change', e => {
  const t = e.target;
  if (t && t.dataset && (t.dataset.input === 'entry-date' || t.dataset.input === 'report-date')) {
    handleInventoryInput(e);
  }
  if (t && t.dataset && t.dataset.input === 'report-include-date') {
    view.reportIncludeDate = t.checked;
    render();
  }
  if (t && t.dataset && t.dataset.input === 'entry-qty') {
    if (t.value === '' && view.entry) { view.entry.qty[t.dataset.id] = 0; t.value = '0'; }
  }
});
