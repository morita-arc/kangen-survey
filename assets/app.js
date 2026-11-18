/* 画面制御 */
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

const view = {
  screen: 'home',
  pickerSearch: '',
  customerSearch: '',
  customersRoom: 'all',
  detailId: null,
  statsPeriod: 'week',
  statsRoom: 'all',
  openHistory: {},
  draft: null,
  sheetStatus: ''
};

const SCREEN_TITLES = {
  home: 'かんげんアンケート',
  picker: 'お客様を選択',
  survey: 'アンケート入力',
  done: '送信完了',
  customers: '顧客',
  detail: '顧客の詳細',
  stats: '集計',
  settings: '設定'
};

function esc(v) {
  return String(v === undefined || v === null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function toast(message, kind) {
  const el = $('#toast');
  el.textContent = message;
  el.className = 'toast show' + (kind ? ' ' + kind : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.className = 'toast'; }, 3200);
}

function confirmDialog(title, message, okLabel, okStyle) {
  return new Promise(resolve => {
    $('#modal-root').innerHTML =
      '<div class="modal-backdrop" data-act="modal-close" data-value="0">' +
        '<div class="modal" role="dialog" aria-modal="true">' +
          '<h2>' + esc(title) + '</h2>' +
          '<p class="muted">' + esc(message) + '</p>' +
          '<div class="modal-actions">' +
            '<button class="btn ghost" data-act="modal-close" data-value="0">キャンセル</button>' +
            '<button class="btn ' + (okStyle === 'primary' ? 'primary' : 'danger') + '" data-act="modal-close" data-value="1">' + esc(okLabel || 'OK') + '</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    const done = v => { $('#modal-root').innerHTML = ''; resolve(v === '1'); };
    confirmDialog._done = done;
  });
}

function closeModal(value) {
  if (confirmDialog._done) confirmDialog._done(value);
}

let pendingScrollReset = false;

function setScreen(name) {
  view.screen = name;
  pendingScrollReset = true;
  render();
}

function goHome() {
  view.draft = null;
  state.draft = null;
  saveState();
  setScreen('home');
}

function render() {
  const keepY = pendingScrollReset ? 0 : window.scrollY;
  const title = SCREEN_TITLES[view.screen] || '';
  $('#top-title').textContent = title;
  $('#back-btn').hidden = (view.screen === 'home');
  $('#tabbar').hidden = (view.screen === 'survey' || view.screen === 'done');
  const body = $('#main');
  switch (view.screen) {
    case 'home': body.innerHTML = homeView(); break;
    case 'picker': body.innerHTML = pickerView(); break;
    case 'survey': body.innerHTML = surveyView(); break;
    case 'done': body.innerHTML = doneView(); break;
    case 'customers': body.innerHTML = customersView(); break;
    case 'detail': body.innerHTML = detailView(); break;
    case 'stats': body.innerHTML = statsView(); break;
    case 'settings': body.innerHTML = settingsView(); break;
    default: body.innerHTML = homeView();
  }
  renderSyncBadge();
  $$('#tabbar [data-nav]').forEach(b => b.classList.toggle('active', b.dataset.nav === view.screen ||
    (view.screen === 'detail' && b.dataset.nav === 'customers')));
  if (view.screen === 'picker') {
    const input = $('#picker-search');
    if (input && view.pickerSearch) input.value = view.pickerSearch;
  }
  window.scrollTo(0, keepY);
  pendingScrollReset = false;
}

function renderSyncBadge() {
  const n = unsyncedSubmissions().length;
  const badge = $('#sync-badge');
  if (!badge) return;
  badge.textContent = n ? ('未同期 ' + n) : '';
  badge.hidden = !n;
}

function todayLabel() {
  const d = new Date();
  const w = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
  return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日（' + w + '）';
}

function homeView() {
  const now = new Date();
  const range = periodRange('week', now, state.settings.weekStart);
  const weekSubs = state.submissions.filter(s => inRange(s.date, range.from, range.to));
  const todayStart = startOfDay(now);
  const todayEnd = new Date(todayStart.getTime() + 86400000);
  const todaySubs = state.submissions.filter(s => inRange(s.date, todayStart, todayEnd));
  const agg = aggregate(weekSubs);
  const recent = state.submissions.slice().sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);
  const draft = state.draft;

  return '' +
    '<section class="hero">' +
      '<p class="eyebrow">' + esc(todayLabel()) + '</p>' +
      '<h1>本日のアンケート</h1>' +
      '<p class="lead">お客様の前回の回答を呼び出して、変更点だけタップで送信できます。</p>' +
      (draft ? '<div class="resume-banner">入力途中のアンケートがあります（' + esc(draft.customerName) + '・' + esc(ROOM_LABELS[draft.room]) + '）' +
        '<button class="btn small" data-act="resume-draft">再開する</button></div>' : '') +
      '<div class="hero-actions">' +
        '<button class="btn primary xl" data-act="start">アンケートを開始</button>' +
      '</div>' +
    '</section>' +

    '<section class="kpis">' +
      kpi('今週の回答', agg.total + '<span class="unit">件</span>') +
      kpi('今日の回答', todaySubs.length + '<span class="unit">件</span>') +
      kpi('登録顧客', state.customers.length + '<span class="unit">名</span>') +
      kpi('体調平均', agg.conditionAvg === null ? '—' : agg.conditionAvg.toFixed(1) + '<span class="unit">/5</span>') +
    '</section>' +

    '<section class="panel">' +
      '<div class="panel-head"><h2>直近の回答</h2>' +
      '<button class="link" data-act="nav" data-value="stats">集計を見る</button></div>' +
      (recent.length ? '<ul class="recent">' + recent.map(s =>
        '<li data-act="open-sub" data-value="' + esc(s.id) + '">' +
          '<span class="badge ' + s.room + '">' + ROOM_LABELS[s.room] + '</span>' +
          '<span class="recent-name">' + esc(s.customerName) + '</span>' +
          '<span class="recent-date">' + esc(fmtDateTime(s.date)) + '</span>' +
          '<span class="recent-sync">' + (s.synced ? '' : '未同期') + '</span>' +
        '</li>').join('') + '</ul>'
        : '<p class="empty">まだ回答がありません。「アンケートを開始」から始めてください。</p>') +
    '</section>' +

    '<section class="quick">' +
      '<button class="quick-card" data-act="nav" data-value="customers"><span class="quick-title">顧客から探す</span><span class="quick-sub">前回の回答を確認・再利用</span></button>' +
      '<button class="quick-card" data-act="nav" data-value="stats"><span class="quick-title">週次・総集計</span><span class="quick-sub">グラフ・CSV・スプレッドシート</span></button>' +
      '<button class="quick-card" data-act="nav" data-value="settings"><span class="quick-title">設定・同期</span><span class="quick-sub">Googleスプレッドシート連携</span></button>' +
    '</section>';
}

function kpi(label, value) {
  return '<div class="kpi"><span class="kpi-label">' + esc(label) + '</span><span class="kpi-value">' + value + '</span></div>';
}

function filteredCustomers(search) {
  const q = normName(search).toLowerCase();
  const list = state.customers.slice().sort((a, b) => {
    const ta = a.lastVisitAt ? new Date(a.lastVisitAt) : new Date(0);
    const tb = b.lastVisitAt ? new Date(b.lastVisitAt) : new Date(0);
    return tb - ta || a.name.localeCompare(b.name, 'ja');
  });
  if (!q) return list;
  return list.filter(c => c.name.toLowerCase().indexOf(q) >= 0);
}

function pickerView() {
  const list = filteredCustomers(view.pickerSearch);
  return '' +
    '<div class="search-row">' +
      '<input id="picker-search" class="search" type="search" placeholder="お名前で検索" autocomplete="off" data-input="picker-search" value="' + esc(view.pickerSearch) + '">' +
      '<button class="btn" data-act="new-customer">＋ 新しいお客様</button>' +
    '</div>' +
    '<p class="muted small">お客様をタップすると、前回の回答を読み込んでアンケートを開始します。</p>' +
    (list.length ? '<ul class="customer-list">' + list.map(c => {
      const prevVip = c.lastAnswers && c.lastAnswers.vip;
      const prevStd = c.lastAnswers && c.lastAnswers.std;
      return '<li><button class="customer-row" data-act="pick-customer" data-value="' + esc(c.id) + '">' +
        '<span class="avatar">' + esc(c.name.slice(0, 1)) + '</span>' +
        '<span class="customer-main">' +
          '<span class="customer-name">' + esc(c.name) + '</span>' +
          '<span class="customer-sub">' +
            (c.visits ? '来店 ' + c.visits + '回' : '初回') +
            (c.lastVisitAt ? ' ・ 前回 ' + fmtDate(c.lastVisitAt) : '') +
          '</span>' +
        '</span>' +
        '<span class="room-mini">' +
          (prevVip ? '<span class="badge vip">VIP</span>' : '') +
          (prevStd ? '<span class="badge std">一般</span>' : '') +
        '</span>' +
        '<span class="chev">›</span>' +
      '</button></li>';
    }).join('') + '</ul>'
      : '<div class="empty-state"><p>該当するお客様がいません。</p><button class="btn primary" data-act="new-customer">新しいお客様として登録</button></div>');
}

function customersView() {
  const list = filteredCustomers(view.customerSearch);
  const search = view.customerSearch;
  return '' +
    '<div class="search-row">' +
      '<input class="search" type="search" placeholder="お名前で検索" autocomplete="off" data-input="customer-search" value="' + esc(search) + '">' +
      '<button class="btn" data-act="new-customer">＋ 新規登録</button>' +
    '</div>' +
    '<p class="muted small">' + list.length + '名を表示中（全' + state.customers.length + '名）</p>' +
    (list.length ? '<ul class="customer-list">' + list.map(c => {
      const prevVip = c.lastAnswers && c.lastAnswers.vip;
      const prevStd = c.lastAnswers && c.lastAnswers.std;
      return '<li><button class="customer-row" data-act="open-customer" data-value="' + esc(c.id) + '">' +
        '<span class="avatar">' + esc(c.name.slice(0, 1)) + '</span>' +
        '<span class="customer-main"><span class="customer-name">' + esc(c.name) + '</span>' +
          '<span class="customer-sub">来店 ' + (c.visits || 0) + '回' + (c.lastVisitAt ? ' ・ 前回 ' + fmtDate(c.lastVisitAt) : '') + '</span>' +
        '</span>' +
        '<span class="room-mini">' +
          (prevVip ? '<span class="badge vip">VIP</span>' : '') +
          (prevStd ? '<span class="badge std">一般</span>' : '') +
        '</span><span class="chev">›</span></button></li>';
    }).join('') + '</ul>'
      : '<div class="empty-state"><p>顧客が登録されていません。</p><button class="btn primary" data-act="new-customer">最初のお客様を登録</button></div>');
}

function detailView() {
  const c = getCustomer(view.detailId);
  if (!c) return '<p class="empty">顧客が見つかりません。</p>';
  const subs = submissionsForCustomer(c.id);
  const latest = subs[0];
  const latestAnswers = latest ? latest.answers : null;
  return '' +
    '<section class="panel">' +
      '<div class="detail-head">' +
        '<span class="avatar large">' + esc(c.name.slice(0, 1)) + '</span>' +
        '<div><h1 class="detail-name">' + esc(c.name) + '</h1>' +
        '<p class="muted">来店 ' + (c.visits || 0) + '回' + (c.lastVisitAt ? ' ・ 前回 ' + fmtDate(c.lastVisitAt) : '') + '</p></div>' +
      '</div>' +
      '<div class="detail-actions">' +
        '<button class="btn primary" data-act="start-customer" data-value="' + esc(c.id) + '">アンケートを開始</button>' +
        '<button class="btn ghost danger-text" data-act="delete-customer" data-value="' + esc(c.id) + '">削除</button>' +
      '</div>' +
      (c.lastAnswers && c.lastAnswers.vip && Object.keys(c.lastAnswers.vip).length
        ? '<div class="default-block"><span class="badge vip">VIP</span> 前回の回答（' + esc(lastDateForRoom(c, 'vip')) + '）' + answersSummary(c.lastAnswers.vip) + '</div>' : '') +
      (c.lastAnswers && c.lastAnswers.std && Object.keys(c.lastAnswers.std).length
        ? '<div class="default-block"><span class="badge std">一般</span> 前回の回答（' + esc(lastDateForRoom(c, 'std')) + '）' + answersSummary(c.lastAnswers.std) + '</div>' : '') +
    '</section>' +
    '<section class="panel">' +
      '<div class="panel-head"><h2>来店履歴</h2><span class="muted small">' + subs.length + '件</span></div>' +
      (subs.length ? '<ul class="history">' + subs.map(s => {
        const open = !!view.openHistory[s.id];
        return '<li class="history-item">' +
          '<button class="history-row" data-act="toggle-history" data-value="' + esc(s.id) + '">' +
            '<span class="badge ' + s.room + '">' + ROOM_LABELS[s.room] + '</span>' +
            '<span class="history-date">' + esc(fmtDateTime(s.date)) + '</span>' +
            '<span class="history-cond">' + esc(answerText(s, 'condition')) + '</span>' +
            '<span class="chev">' + (open ? '▴' : '▾') + '</span>' +
          '</button>' +
          (open ? '<div class="history-detail">' + historyAnswers(s.answers) + '</div>' : '') +
        '</li>';
      }).join('') + '</ul>' : '<p class="empty">履歴がありません。</p>') +
    '</section>' +
    '<button class="btn ghost" data-act="nav" data-value="customers">顧客一覧へ戻る</button>';
}

function lastDateForRoom(c, room) {
  const list = state.submissions.filter(s => s.customerId === c.id && s.room === room)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  return list.length ? fmtDate(list[0].date) : '';
}

function answersSummary(answers) {
  return '<dl class="answers-dl">' + surveyQuestionsForStats()
    .filter(q => answers && answers[q.id] !== undefined && answers[q.id] !== '' && !(Array.isArray(answers[q.id]) && !answers[q.id].length))
    .map(q => '<dt>' + esc(q.short) + '</dt><dd>' + esc(Array.isArray(answers[q.id]) ? answers[q.id].join(' / ') : answers[q.id]) + '</dd>').join('') + '</dl>';
}

function historyAnswers(answers) {
  const qs = surveyQuestionsForStats();
  return '<dl class="answers-dl">' + qs.map(q => {
    const v = answers ? answers[q.id] : '';
    const text = Array.isArray(v) ? v.join(' / ') : (v || '—');
    return '<dt>' + esc(q.short) + '</dt><dd>' + esc(text) + '</dd>';
  }).join('') + '</dl>';
}

function startDraftForCustomer(customer, room) {
  const stored = getCustomer(customer.id) || createCustomer(customer.name, room, customer.id);
  const prev = previousAnswers(stored.id, room);
  const answers = prev ? cloneAnswers(prev) : {}; delete answers.memo;
  const resolvedRoom = room || stored.room || 'std';
  view.draft = {
    customerId: stored.id,
    customerName: stored.name,
    room: resolvedRoom,
    answers,
    previous: cloneAnswers(answers),
    prefilled: Object.keys(answers),
    hadPrevious: !!prev,
    previousAt: stored.lastVisitAt,
    startedAt: new Date().toISOString(),
    isNew: !prev
  };
  state.draft = view.draft;
  saveState();
  setScreen('survey');
}

function roomChooser(customer) {
  view.pendingCustomer = customer;
  const rooms = ['vip', 'std'];
  $('#modal-root').innerHTML =
    '<div class="modal-backdrop" data-act="modal-close" data-value="0">' +
      '<div class="modal">' +
        '<h2>' + esc(customer.name) + ' 様</h2>' +
        '<p class="muted">今回の部屋を選択してください。前回の回答があれば自動で読み込みます。</p>' +
        '<div class="room-choices">' + rooms.map(r => {
          const prev = previousAnswers(customer.id, r);
          const date = lastDateForRoom(customer, r);
          return '<button class="room-choice ' + r + '" data-act="choose-room" data-value="' + r + '" data-id="' + esc(customer.id) + '">' +
            '<span class="room-choice-label">' + ROOM_LABELS[r] + '</span>' +
            '<span class="room-choice-sub">' + (prev ? '前回の回答あり（' + esc(date) + '）' : (date ? '前回 ' + esc(date) : 'はじめて')) + '</span>' +
          '</button>';
        }).join('') + '</div>' +
        '<div class="modal-actions"><button class="btn ghost" data-act="modal-close" data-value="0">キャンセル</button></div>' +
      '</div>' +
    '</div>';
}

function newCustomerDialog() {
  $('#modal-root').innerHTML =
    '<div class="modal-backdrop" data-act="modal-close" data-value="0">' +
      '<div class="modal">' +
        '<h2>新しいお客様</h2>' +
        '<p class="muted">お名前を入力してください。次回から一覧に表示され、前回の回答を呼び出せます。</p>' +
        '<label class="field"><span>お名前</span>' +
        '<input id="new-name" class="input" type="text" autocomplete="off" placeholder="例）山田 花子"></label>' +
        '<div class="modal-actions">' +
          '<button class="btn ghost" data-act="modal-close" data-value="0">キャンセル</button>' +
          '<button class="btn primary" data-act="create-customer">登録する</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  setTimeout(() => { const el = $('#new-name'); if (el) el.focus(); }, 50);
}

function submitNewCustomer() {
  const input = $('#new-name');
  const name = normName(input ? input.value : '');
  if (!name) { toast('お名前を入力してください'); if (input) input.focus(); return; }
  const existing = findCustomerByName(name);
  $('#modal-root').innerHTML = '';
  if (existing) {
    toast('登録済みのお客様です。前回の回答を読み込みます');
    roomChooser(existing);
  } else {
    roomChooser({ id: uid('cus'), name: name, lastAnswers: {}, visits: 0, lastVisitAt: null, room: 'std' });
  }
}

function switchRoomDialog() {
  if (!view.draft) return;
  const c = getCustomer(view.draft.customerId);
  const other = view.draft.room === 'vip' ? 'std' : 'vip';
  const prev = c ? previousAnswers(c.id, other) : null;
  confirmDialog('部屋を変更', ROOM_LABELS[other] + 'に切り替えます。' + (prev ? '前回の回答を読み込みます。' : 'この部屋の前回回答はありません。'), '切り替える', 'primary')
    .then(ok => {
      if (!ok || !view.draft) return;
      view.draft.room = other;
      view.draft.answers = prev ? cloneAnswers(prev) : {}; delete view.draft.answers.memo;
      view.draft.previous = cloneAnswers(view.draft.answers);
      view.draft.prefilled = Object.keys(view.draft.answers);
      view.draft.hadPrevious = !!prev;
      state.draft = view.draft;
      saveState();
      render();
    });
}

function surveyView() {
  const d = view.draft;
  if (!d) return '<p class="empty">アンケートが開始されていません。</p>';
  const survey = surveyFor(d.room);
  const answered = survey.questions.filter(q => q.type !== 'text' && answerList({ answers: d.answers }, q.id).length > 0).length;
  const required = survey.questions.filter(q => q.type !== 'text').length;
  const prevLabel = d.previousAt ? fmtDate(d.previousAt) : '';
  const hasPrefill = !!d.hadPrevious;

  const cards = survey.questions.map((q, i) => {
    if (q.type === 'text') {
      const val = d.answers[q.id] || '';
      return '<section class="q-card" data-q="' + q.id + '">' +
        '<header class="q-head"><span class="q-no">' + (i + 1) + '</span><div><h2>' + esc(q.title) + '</h2>' +
        '<p class="q-hint">任意・気になる点があればご記入ください</p></div></header>' +
        '<textarea class="input memo" rows="3" placeholder="' + esc(q.placeholder || '') + '" data-input="memo">' + esc(val) + '</textarea>' +
      '</section>';
    }
    const selected = q.type === 'multi' ? (Array.isArray(d.answers[q.id]) ? d.answers[q.id] : []) : (d.answers[q.id] ? [d.answers[q.id]] : []);
    const pre = d.prefilled && d.prefilled.indexOf(q.id) >= 0;
    const options = q.options.map(opt => {
      const on = selected.indexOf(opt) >= 0;
      const wasPrev = on && pre;
      return '<button class="opt' + (on ? ' on' : '') + (q.type === 'scale' ? ' scale-opt' : '') + '" ' +
        'data-act="opt" data-qid="' + q.id + '" data-value="' + esc(opt) + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
        '<span class="tick" aria-hidden="true">✓</span><span class="opt-label">' + esc(opt) + '</span>' +
        (wasPrev ? '<span class="prev-tag">前回</span>' : '') +
      '</button>';
    }).join('');
    return '<section class="q-card" data-q="' + q.id + '">' +
      '<header class="q-head"><span class="q-no">' + (i + 1) + '</span><div><h2>' + esc(q.title) + '</h2>' +
      (q.hint ? '<p class="q-hint">' + esc(q.hint) + '</p>' : '') +
      (!q.hint && q.type === 'multi' ? '<p class="q-hint">複数選択できます</p>' : '') + '</div></header>' +
      '<div class="options ' + (q.type === 'scale' ? 'scale' : '') + '">' + options + '</div>' +
      (q.type === 'scale' ? '<div class="scale-legend"><span>とても良い</span><span>不調</span></div>' : '') +
    '</section>';
  }).join('');

  return '' +
    '<div class="survey-head">' +
      '<div class="survey-person"><span class="survey-name">' + esc(d.customerName) + ' 様</span>' +
        '<span class="badge ' + d.room + '">' + ROOM_LABELS[d.room] + '</span>' +
        '<button class="link small" data-act="switch-room">部屋を変更</button>' +
      '</div>' +
      (hasPrefill
        ? '<div class="info-banner ok">前回' + (prevLabel ? '（' + esc(prevLabel) + '）' : '') + 'の回答を読み込みました。変更する項目だけタップしてください。</div>'
        : '<div class="info-banner">はじめての回答です。該当する項目をタップしてください。</div>') +
    '</div>' +
    '<form id="survey-form" autocomplete="off" onsubmit="return false">' + cards + '</form>' +
    '<div class="survey-footer">' +
      '<div class="progress-text">回答済み <strong>' + answered + '</strong> / ' + required + ' 項目</div>' +
      '<div class="footer-actions">' +
        '<button class="btn ghost" data-act="clear-answers">すべて解除</button>' +
        '<button class="btn primary lg" data-act="submit">送信する</button>' +
      '</div>' +
    '</div>';
}

function doneView() {
  const d = view.lastDone;
  if (!d) return '<p class="empty">送信内容がありません。</p>';
  return '' +
    '<section class="done">' +
      '<div class="done-mark" aria-hidden="true">✓</div>' +
      '<h1>保存しました</h1>' +
      '<p class="done-name">' + esc(d.customerName) + ' 様 ・ ' + ROOM_LABELS[d.room] + '</p>' +
      '<p class="done-sync ' + (d.syncState === 'ok' ? 'ok' : 'warn') + '">' + esc(d.syncMessage) + '</p>' +
      '<div class="done-actions">' +
        '<button class="btn primary xl" data-act="next-customer">次のお客様のアンケート</button>' +
        '<button class="btn ghost" data-act="home">ホームへ戻る</button>' +
      '</div>' +
    '</section>';
}

function statsFiltered() {
  const range = periodRange(view.statsPeriod, new Date(), state.settings.weekStart);
  let list = state.submissions.filter(s => inRange(s.date, range.from, range.to));
  if (view.statsRoom !== 'all') list = list.filter(s => s.room === view.statsRoom);
  return { range, list };
}

function statsView() {
  const { range, list } = statsFiltered();
  const agg = aggregate(list, view.statsRoom);
  const repeat = repeatRate(list, state.submissions);
  const weeks = weeklySummary(
    view.statsRoom === 'all' ? state.submissions : state.submissions.filter(s => s.room === view.statsRoom),
    state.settings.weekStart, 8
  );
  const comments = [];
  list.forEach(s => {
    const t = answerText(s, 'memo');
    if (t) comments.push({ name: s.customerName, date: s.date, room: s.room, text: t });
  });
  comments.sort((a, b) => new Date(b.date) - new Date(a.date));

  const qCards = agg.questions.map(item => {
    if (item.q.type === 'text') return '';
    const max = Math.max(1, ...item.counts.map(c => c.count));
    const rows = item.counts.map(c => {
      const pct = item.respondents ? Math.round(c.count / item.respondents * 100) : 0;
      return '<div class="bar-row">' +
        '<span class="bar-label">' + esc(c.option) + '</span>' +
        '<span class="bar-track"><span class="bar-fill" style="width:' + (c.count / max * 100) + '%"></span></span>' +
        '<span class="bar-num">' + c.count + '<span class="bar-pct">' + (item.respondents ? pct + '%' : '') + '</span></span>' +
      '</div>';
    }).join('');
    return '<section class="panel q-stat">' +
      '<div class="panel-head"><h2>' + esc(item.q.short) + '</h2>' +
      '<span class="muted small">回答 ' + item.respondents + '件' +
      (item.avg !== null ? ' ・ 平均 ' + item.avg.toFixed(2) : '') + '</span></div>' +
      rows +
    '</section>';
  }).join('');

  const weekRows = weeks.map(w => {
    const pct = w.total ? Math.round(w.vip / w.total * 100) : 0;
    return '<tr><td>' + esc(w.label) + '</td><td class="num">' + w.total + '</td>' +
      '<td class="num">' + w.vip + '</td><td class="num">' + w.std + '</td>' +
      '<td class="num">' + (w.conditionAvg === null ? '—' : w.conditionAvg.toFixed(1)) + '</td>' +
      '<td><span class="mini-bar"><span style="width:' + pct + '%"></span></span></td></tr>';
  }).join('');

  return '' +
    '<div class="filter-row">' +
      '<div class="segmented">' +
        [['week', '今週'], ['lastWeek', '先週'], ['month', '今月'], ['all', '全期間']].map(([k, label]) =>
          '<button class="' + (view.statsPeriod === k ? 'on' : '') + '" data-act="stats-period" data-value="' + k + '">' + label + '</button>').join('') +
      '</div>' +
      '<div class="segmented">' +
        [['all', 'すべて'], ['vip', 'VIP'], ['std', '一般']].map(([k, label]) =>
          '<button class="' + (view.statsRoom === k ? 'on' : '') + '" data-act="stats-room" data-value="' + k + '">' + label + '</button>').join('') +
      '</div>' +
    '</div>' +
    '<p class="muted small">集計範囲：' + esc(fmtDate(range.from.toISOString())) + ' 〜 ' + esc(fmtDate(new Date(range.to.getTime() - 1).toISOString())) + ' ・ 週は土曜〜金曜</p>' +
    '<section class="kpis">' +
      kpi('回答数', agg.total + '<span class="unit">件</span>') +
      kpi('顧客数', agg.uniqueCustomers + '<span class="unit">名</span>') +
      kpi('リピート率', repeat === null ? '—' : Math.round(repeat * 100) + '<span class="unit">%</span>') +
      kpi('体調平均', agg.conditionAvg === null ? '—' : agg.conditionAvg.toFixed(2) + '<span class="unit">/5</span>') +
    '</section>' +

    '<section class="panel">' +
      '<div class="panel-head"><h2>週別の推移（直近8週）</h2></div>' +
      '<div class="table-wrap"><table class="table"><thead><tr><th>週</th><th class="num">回答</th><th class="num">VIP</th><th class="num">一般</th><th class="num">体調平均</th><th>VIP比率</th></tr></thead>' +
      '<tbody>' + weekRows + '</tbody></table></div>' +
    '</section>' +

    (agg.total ? qCards : '<div class="empty-state"><p>この期間の回答はありません。</p></div>') +

    (comments.length ? '<section class="panel"><div class="panel-head"><h2>その他のコメント</h2><span class="muted small">' + comments.length + '件</span></div>' +
      '<ul class="comments">' + comments.slice(0, 20).map(c =>
        '<li><div class="comment-head"><span class="badge ' + c.room + '">' + ROOM_LABELS[c.room] + '</span> ' +
        esc(c.name) + '<span class="muted small"> ' + esc(fmtDateTime(c.date)) + '</span></div>' +
        '<p>' + esc(c.text) + '</p></li>').join('') + '</ul></section>' : '') +

    '<div class="stats-actions">' +
      '<button class="btn" data-act="stats-csv">CSVダウンロード</button>' +
      '<button class="btn" data-act="stats-print">印刷 / PDF</button>' +
      '<button class="btn' + (state.settings.sheetUrl ? '' : ' hidden') + '" data-act="sync-all">シートと同期</button>' +
    '</div>';
}

function settingsView() {
  const s = state.settings;
  const unsynced = unsyncedSubmissions().length;
  return '' +
    '<section class="panel">' +
      '<h2>このタブレット</h2>' +
      '<label class="field"><span>端末名（スプレッドシートに記録されます）</span>' +
      '<input class="input" type="text" data-input="tablet-name" value="' + esc(s.tabletName) + '" placeholder="例）受付タブレット1"></label>' +
      '<p class="muted small">週の集計は土曜日〜金曜日で行います。</p>' +
    '</section>' +

    '<section class="panel">' +
      '<h2>Googleスプレッドシート連携</h2>' +
      '<p class="muted small">Apps Script のウェブアプリURLを設定すると、送信時に回答がスプレッドシートへ自動追記されます。設定手順は同梱のREADMEを参照してください。</p>' +
      '<label class="field"><span>ウェブアプリURL</span>' +
      '<input class="input" type="url" data-input="sheet-url" value="' + esc(s.sheetUrl) + '" placeholder="https://script.google.com/macros/s/.../exec"></label>' +
      '<label class="field"><span>合言葉（任意・Apps Scriptと同じ文字列）</span>' +
      '<input class="input" type="text" data-input="sheet-token" value="' + esc(s.token) + '" placeholder="例）kangen2026"></label>' +
      '<label class="check"><input type="checkbox" data-input="auto-sync"' + (s.autoSync ? ' checked' : '') + '> 送信時に自動で同期する</label>' +
      '<div class="row-buttons">' +
        '<button class="btn" data-act="sync-test">接続テスト</button>' +
        '<button class="btn" data-act="sync-push">未送信を送る（' + unsynced + '件）</button>' +
        '<button class="btn" data-act="sync-pull">シートから取り込む</button>' +
        '<button class="btn" data-act="sync-all">両方実行</button>' +
      '</div>' +
      '<p class="muted small" id="sync-status">' + esc(view.sheetStatus || '未同期の回答は' + unsynced + '件です') + '</p>' +
      '<details class="guide"><summary>シート連携の設定方法（初回・更新時）</summary>' +
        '<ol class="tips">' +
          '<li>スプレッドシートの「拡張機能」→「Apps Script」を開く</li>' +
          '<li>「Code.gs（最新版）」文書の全文をコピーして貼り付け、保存</li>' +
          '<li>関数 setupSheet を実行し、権限を承認する</li>' +
          '<li>「デプロイ」→「新しいデプロイ」→ ウェブアプリ（アクセス: 全員）</li>' +
          '<li>発行された「/exec」のURLを上に貼り付け →「接続テスト」</li>' +
          '<li>設定済みの場合は「デプロイを管理」→ 編集 → バージョン: 新しいバージョン → デプロイ（URLは変わりません）</li>' +
        '</ol>' +
        '<p class="small"><a class="link" href="https://docs.google.com/document/d/15_gK-emy8svSRKA8IDSgFecN4T1D8k5qQIRoX-oF9aE/edit" target="_blank" rel="noopener">Code.gs（最新版）</a> ／ ' +
        '<a class="link" href="https://docs.google.com/spreadsheets/d/1JXC-kQ4Mtnb1VI7TM35QB8lf8I-hp3v_doLsEv79lxA/edit" target="_blank" rel="noopener">スプレッドシート</a></p>' +
      '</details>' +
    '</section>' +

    '<section class="panel">' +
      '<h2>データ</h2>' +
      '<p class="muted small">回答はこのタブレットのブラウザ内に保存されています（' + state.submissions.length + '件・顧客' + state.customers.length + '名）。CSVはExcel/スプレッドシートで開けます。</p>' +
      '<div class="row-buttons">' +
        '<button class="btn" data-act="export-csv">回答CSV出力</button>' +
        '<button class="btn" data-act="export-json">バックアップ保存</button>' +
        '<button class="btn" data-act="import-json">バックアップ読込</button>' +
      '</div>' +
      '<input type="file" id="import-file" accept="application/json,.json" hidden>' +
      '<div class="danger-zone"><button class="btn ghost danger-text" data-act="clear-data">すべてのデータを削除</button></div>' +
    '</section>' +

    '<section class="panel">' +
      '<h2>アプリ情報</h2>' +
      '<p class="muted small">かんげんアンケート v' + APP_VERSION + ' ・ VIP/一般の2種類 ・ 回答は端末内保存＋シート同期</p>' +
      '<details class="guide"><summary>使い方のヒント</summary>' +
        '<ul class="tips">' +
          '<li>お客様を選ぶと前回の回答が自動で入ります。変更する項目だけタップして送信できます。</li>' +
          '<li>未回答の項目があっても「このまま送信」で送信できます。</li>' +
          '<li>「すべて解除」で選択をリセットできます。</li>' +
          '<li>集計は「今週／先週／今月／全期間」と「VIP／一般」で絞り込めます。</li>' +
          '<li>複数台で使う場合は、同じスプレッドシートURLを各タブレットに設定してください。</li>' +
        '</ul></details>' +
    '</section>';
}

function openSubmission(id) {
  const s = state.submissions.find(x => x.id === id);
  if (!s) return;
  view.detailId = s.customerId;
  setScreen('detail');
}

function startCustomerFlow(customer) {
  if (!customer) return;
  roomChooser(customer);
}

function submitSurvey() {
  const d = view.draft;
  if (!d) return;
  const missing = missingRequired(d.answers, d.room);
  if (missing.length) {
    const names = missing.slice(0, 3).map(q => q.short).join('、') + (missing.length > 3 ? ' ほか' : '');
    confirmDialog('未回答があります', '未回答が' + missing.length + '件あります（' + names + '）。このまま送信しますか？', 'このまま送信', 'primary')
      .then(ok => {
        if (!ok) {
          const card = $('[data-q="' + missing[0].id + '"]');
          if (card) {
            card.classList.add('missing');
            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setTimeout(() => card.classList.remove('missing'), 1600);
          }
          return;
        }
        if (view.draft === d) finalizeSubmit();
      });
    return;
  }
  finalizeSubmit();
}

function finalizeSubmit() {
  const d = view.draft;
  if (!d) return;
  const customer = getCustomer(d.customerId) || createCustomer(d.customerName, d.room);
  const submission = addSubmission({
    customerId: customer.id,
    customerName: customer.name,
    room: d.room,
    answers: d.answers
  });
  state.draft = null;
  view.draft = null;
  saveState();
  view.lastDone = {
    id: submission.id,
    customerName: submission.customerName,
    room: submission.room,
    syncState: 'pending',
    syncMessage: state.settings.sheetUrl ? 'スプレッドシートへ送信中…' : 'この端末に保存しました（シート未設定）'
  };
  setScreen('done');
  syncAfterSubmit(submission).then(res => {
    if (view.lastDone && view.lastDone.id === submission.id) {
      view.lastDone.syncState = res.ok ? 'ok' : 'local';
      view.lastDone.syncMessage = res.ok
        ? 'Googleスプレッドシートへ送信しました'
        : (state.settings.sheetUrl ? '端末に保存しました。シートへは後で自動送信されます' : 'この端末に保存しました');
      if (view.screen === 'done') render();
    }
    renderSyncBadge();
  });
}

async function syncAfterSubmit(submission) {
  if (!state.settings.sheetUrl) return { ok: false, reason: 'URLが未設定です' };
  if (!navigator.onLine) return { ok: false, reason: 'オフラインです' };
  const res = await postSubmission(submission);
  if (!res.ok) view.sheetStatus = '送信失敗：' + (res.reason || '不明なエラー');
  return res;
}

function markSynced(sub) {
  sub.synced = true;
  sub.source = sub.source || 'local';
  saveState();
}

async function postSubmission(sub) {
  const url = state.settings.sheetUrl.trim();
  if (!url) return { ok: false, reason: 'URLが未設定です' };
  const payload = JSON.stringify({ token: state.settings.token, type: 'submit', row: toSheetRow(sub) });
  const encoded = encodeURIComponent(payload);

  if (encoded.length <= 7000) {
    const submitUrl = url + (url.indexOf('?') >= 0 ? '&' : '?') +
      'action=submit&token=' + encodeURIComponent(state.settings.token) + '&payload=' + encoded;
    try {
      const data = await jsonp(submitUrl, 25000);
      if (data && data.ok) {
        markSynced(sub);
        return { ok: true, duplicate: !!data.duplicate };
      }
      return { ok: false, reason: (data && data.error) || 'シートが受け付けませんでした' };
    } catch (err) {
      return { ok: false, reason: err.message };
    }
  }

  try {
    await fetch(url, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: payload
    });
  } catch (err) {
    return { ok: false, reason: err.message };
  }
  await new Promise(r => setTimeout(r, 1500));
  await pullFromSheet(true);
  const stored = state.submissions.find(x => x.id === sub.id);
  if (stored && stored.synced) return { ok: true };
  return { ok: false, reason: '長文のため送信を確認できませんでした' };
}

function jsonp(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const cb = '__sheetCb' + Date.now() + Math.floor(Math.random() * 1000);
    const script = document.createElement('script');
    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      delete window[cb];
      if (script.parentNode) script.parentNode.removeChild(script);
      clearTimeout(timer);
    };
    window[cb] = data => { cleanup(); resolve(data); };
    script.onerror = () => { cleanup(); reject(new Error('接続できませんでした')); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('タイムアウトしました')); }, timeoutMs || 20000);
    script.src = url + (url.indexOf('?') >= 0 ? '&' : '?') + 'callback=' + encodeURIComponent(cb) + '&t=' + Date.now();
    document.body.appendChild(script);
  });
}

async function pullFromSheet(silent) {
  if (!state.settings.sheetUrl) { if (!silent) toast('スプレッドシートURLが未設定です'); return 0; }
  try {
    const base = state.settings.sheetUrl;
    const listUrl = base + (base.indexOf('?') >= 0 ? '&' : '?') +
      'action=list&token=' + encodeURIComponent(state.settings.token);
    const data = await jsonp(listUrl);
    if (!data || data.ok !== true && !Array.isArray(data.rows)) throw new Error((data && data.error) || 'データを取得できませんでした');
    const rows = (data.rows || []).map(sheetRowToSubmission);
    const added = mergeRemoteSubmissions(rows);
    view.sheetStatus = 'シートから' + added + '件取り込みました（' + rows.length + '件確認）';
    if (!silent) toast(added ? 'シートから' + added + '件取り込みました' : '新しい回答はありません');
    if (view.screen === 'settings' || view.screen === 'stats') render();
    return added;
  } catch (err) {
    view.sheetStatus = '取り込み失敗：' + err.message;
    if (!silent) toast('取り込みに失敗しました：' + err.message);
    if (view.screen === 'settings') render();
    return 0;
  }
}

async function pushUnsynced() {
  const list = unsyncedSubmissions();
  if (!list.length) { toast('未送信の回答はありません'); return 0; }
  if (!state.settings.sheetUrl) { toast('スプレッドシートURLが未設定です'); return 0; }
  let ok = 0;
  let lastError = '';
  for (const sub of list) {
    const res = await postSubmission(sub);
    if (res.ok) ok++;
    else lastError = res.reason || '';
  }
  view.sheetStatus = ok + '件送信しました' +
    (ok < list.length ? '（' + (list.length - ok) + '件は未送信' + (lastError ? '：' + lastError : '') + '）' : '');
  toast(view.sheetStatus);
  if (view.screen === 'settings' || view.screen === 'stats' || view.screen === 'home') render();
  return ok;
}

async function syncAll() {
  const sent = await pushUnsynced();
  await pullFromSheet(true);
  renderSyncBadge();
  if (view.screen === 'settings') render();
  return sent;
}

function testSheetConnection() {
  if (!state.settings.sheetUrl) { toast('URLを入力してください'); return; }
  view.sheetStatus = '接続を確認しています…';
  if (view.screen === 'settings') render();
  jsonp(state.settings.sheetUrl + (state.settings.sheetUrl.indexOf('?') >= 0 ? '&' : '?') + 'action=selftest&token=' + encodeURIComponent(state.settings.token), 15000)
    .then(data => {
      if (data && data.ok) {
        if (data.version >= 2) {
          view.sheetStatus = '接続OK（送信準備完了）：' + (data.title ? '「' + data.title + '」' : 'シート') + '（' + (data.count || 0) + '行）';
          toast('接続できました');
        } else {
          view.sheetStatus = '接続はできましたが、Apps Scriptが古い可能性があります。Code.gsを貼り直して「新しいデプロイ」をやり直してください。';
          toast('スクリプトの再デプロイが必要です');
        }
      } else {
        view.sheetStatus = '接続できましたが応答が不正です' + (data && data.error ? '（' + data.error + '）' : '');
        toast('応答を確認してください');
      }
      if (view.screen === 'settings') render();
    })
    .catch(err => {
      view.sheetStatus = '接続失敗：' + err.message;
      toast('接続できませんでした');
      if (view.screen === 'settings') render();
    });
}

function onOptionTap(qid, value) {
  const d = view.draft;
  if (!d) return;
  const q = questionById(qid);
  if (!q) return;
  if (q.type === 'multi') {
    const arr = Array.isArray(d.answers[qid]) ? d.answers[qid].slice() : [];
    const idx = arr.indexOf(value);
    if (idx >= 0) arr.splice(idx, 1); else arr.push(value);
    d.answers[qid] = arr;
  } else {
    d.answers[qid] = (d.answers[qid] === value) ? '' : value;
  }
  const norm = v => (Array.isArray(v) ? v.slice().sort() : (v || ''));
  const sameAsPrev = d.previous && JSON.stringify(norm(d.previous[qid])) === JSON.stringify(norm(d.answers[qid]))
    && answerList({ answers: d.answers }, qid).length > 0;
  let pref = (d.prefilled || []).filter(k => k !== qid);
  if (sameAsPrev) pref.push(qid);
  d.prefilled = pref;
  state.draft = d;
  saveState();
  render();
}

function clearAnswers() {
  const d = view.draft;
  if (!d) return;
  confirmDialog('すべて解除', 'このアンケートの選択をすべて解除します。よろしいですか？', '解除する').then(ok => {
    if (!ok || !view.draft) return;
    view.draft.answers = {};
    view.draft.prefilled = [];
    state.draft = view.draft;
    saveState();
    render();
  });
}

function exportStatsCsv() {
  const { range, list } = statsFiltered();
  if (!list.length) { toast('この期間の回答がありません'); return; }
  const agg = aggregate(list, view.statsRoom);
  const csv = aggregateToCsv(list, agg, range.label);
  downloadFile('集計_' + dateKey(new Date()) + '.csv', csv);
}

function exportAllCsv() {
  if (!state.submissions.length) { toast('回答がありません'); return; }
  const list = state.submissions.slice().sort((a, b) => new Date(a.date) - new Date(b.date));
  downloadFile('回答一覧_' + dateKey(new Date()) + '.csv', submissionsToCsv(list));
}

function bindEvents() {
  document.addEventListener('click', e => {
    const target = e.target.closest('[data-act]');
    if (!target) return;
    const act = target.dataset.act;
    const value = target.dataset.value;
    switch (act) {
      case 'nav':
        if (value === 'customers') view.detailId = null;
        setScreen(value);
        break;
      case 'home': goHome(); break;
      case 'start': setScreen('picker'); break;
      case 'new-customer': newCustomerDialog(); break;
      case 'create-customer': submitNewCustomer(); break;
      case 'modal-close': {
        const isBackdrop = target.classList.contains('modal-backdrop');
        if (isBackdrop && e.target !== target) break;
        closeModal(value);
        break;
      }
      case 'pick-customer': {
        const c = getCustomer(value);
        if (c) roomChooser(c);
        break;
      }
      case 'start-customer': {
        const c = getCustomer(value);
        if (c) roomChooser(c);
        break;
      }
      case 'choose-room': {
        const id = target.dataset.id;
        const picked = getCustomer(id) ||
          (view.pendingCustomer && view.pendingCustomer.id === id ? view.pendingCustomer : null);
        if (picked) {
          $('#modal-root').innerHTML = '';
          view.pendingCustomer = null;
          startDraftForCustomer(picked, value);
        } else {
          toast('お客様の情報を読み込めませんでした。最初からやり直してください');
        }
        break;
      }
      case 'opt': onOptionTap(target.dataset.qid, value); break;
      case 'submit': submitSurvey(); break;
      case 'clear-answers': clearAnswers(); break;
      case 'switch-room': switchRoomDialog(); break;
      case 'resume-draft':
        if (state.draft) { view.draft = state.draft; setScreen('survey'); }
        break;
      case 'next-customer':
        view.lastDone = null;
        setScreen('picker');
        break;
      case 'open-customer': view.detailId = value; setScreen('detail'); break;
      case 'open-sub': openSubmission(value); break;
      case 'toggle-history':
        view.openHistory[value] = !view.openHistory[value];
        render();
        break;
      case 'delete-customer': {
        const c = getCustomer(value);
        if (!c) break;
        confirmDialog('顧客を削除', c.name + ' 様の情報と全履歴（' + (c.visits || 0) + '件）を削除します。元に戻せません。', '削除する').then(ok => {
          if (!ok) return;
          deleteCustomer(value);
          view.detailId = null;
          toast('削除しました');
          setScreen('customers');
        });
        break;
      }
      case 'stats-period': view.statsPeriod = value; render(); break;
      case 'stats-room': view.statsRoom = value; render(); break;
      case 'stats-csv': exportStatsCsv(); break;
      case 'stats-print': window.print(); break;
      case 'export-csv': exportAllCsv(); break;
      case 'export-json': exportBackup(); break;
      case 'import-json':
        const fileInput = $('#import-file');
        if (fileInput) fileInput.click();
        break;
      case 'clear-data':
        confirmDialog('全データ削除', '顧客・回答・履歴をすべて削除します。スプレッドシート上のデータは消えません。元に戻せません。', 'すべて削除').then(ok => {
          if (!ok) return;
          clearAllData();
          toast('削除しました');
          setScreen('home');
        });
        break;
      case 'sync-test': testSheetConnection(); break;
      case 'sync-push': pushUnsynced(); break;
      case 'sync-pull': pullFromSheet(false); break;
      case 'sync-all': syncAll(); break;
      default: break;
    }
  });

  document.addEventListener('input', e => {
    const t = e.target;
    if (!t || !t.dataset || !t.dataset.input) return;
    const key = t.dataset.input;
    if (key === 'picker-search') {
      view.pickerSearch = t.value;
      const listEl = $('.customer-list');
      const input = t;
      const sel = input.selectionStart;
      render();
      const again = $('#picker-search');
      if (again) { again.focus(); again.setSelectionRange(sel, sel); }
      return;
    }
    if (key === 'customer-search') {
      view.customerSearch = t.value;
      const sel = t.selectionStart;
      render();
      const again = $('[data-input="customer-search"]');
      if (again) { again.focus(); again.setSelectionRange(sel, sel); }
      return;
    }
    if (key === 'memo') {
      if (!view.draft) return;
      view.draft.answers.memo = t.value;
      state.draft = view.draft;
      saveState();
      return;
    }
    if (key === 'tablet-name') { state.settings.tabletName = t.value; saveState(); return; }
    if (key === 'sheet-url') { state.settings.sheetUrl = t.value.trim(); saveState(); return; }
    if (key === 'sheet-token') { state.settings.token = t.value; saveState(); return; }
    if (key === 'auto-sync') { state.settings.autoSync = t.checked; saveState(); return; }
  });

  document.addEventListener('change', e => {
    const t = e.target;
    if (t && t.id === 'import-file' && t.files && t.files[0]) {
      const file = t.files[0];
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const res = importBackup(String(reader.result));
          toast('取り込みました（回答' + res.addedSubs + '件・顧客' + res.addedCustomers + '名）');
          render();
        } catch (err) {
          toast('読み込みに失敗しました：' + err.message);
        }
      };
      reader.readAsText(file);
    }
    if (t && t.dataset && t.dataset.input === 'auto-sync') {
      state.settings.autoSync = t.checked;
      saveState();
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target && e.target.id === 'new-name') {
      e.preventDefault();
      submitNewCustomer();
    }
    if (e.key === 'Escape' && $('#modal-root').innerHTML) {
      closeModal('0');
    }
  });

  $('#back-btn').addEventListener('click', () => {
    if (view.screen === 'survey') {
      confirmDialog('入力を中断', '入力中の内容は「ホーム」に残ります。中断しますか？', '中断する').then(ok => {
        if (ok) { view.draft = null; setScreen('home'); }
      });
      return;
    }
    if (view.screen === 'done') { view.lastDone = null; setScreen('home'); return; }
    if (view.screen === 'detail') { setScreen('customers'); return; }
    if (view.screen === 'picker') { setScreen('home'); return; }
    setScreen('home');
  });

  window.addEventListener('online', () => {
    if (state.settings.autoSync && state.settings.sheetUrl) syncAll();
  });
}

function boot() {
  bindEvents();
  render();
  if (state.draft) view.draft = state.draft;
  if (state.settings.autoSync && state.settings.sheetUrl) {
    setTimeout(() => { syncAll(); }, 1200);
  }
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', boot);
