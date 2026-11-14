/* アンケート定義と集計ロジック（DOM非依存） */
const ROOM_LABELS = { vip: 'VIPルーム', std: '一般ルーム' };

const Q = {
  shower: {
    id: 'shower', short: 'シャワー', title: 'ご入酵後のシャワーについて', type: 'single',
    options: ['通常シャワー', '炭酸シャワー（RIVIERA CUBE）', '炭酸アイスバス']
  },
  pack: {
    id: 'pack', short: 'パック', title: 'パックについて', type: 'single',
    options: ['炭酸ガスパック', 'アロマパック']
  },
  drink: {
    id: 'drink', short: 'ドリンク', title: 'ドリンクについて', hint: '複数ご希望可能', type: 'multi',
    options: ['シリカ水', 'ゆずサイダー', 'ミネラルウォーター', 'コピ・ルアック（ジャコウネコ珈琲）※HOTのみ']
  },
  wear: {
    id: 'wear', short: '服装', title: 'ご入酵時の服装について', type: 'single',
    options: ['使い捨て紙ショーツなど（色は茶色です）', '短パン', 'Tシャツ', 'Tシャツ・短パン']
  },
  temp: {
    id: 'temp', short: '温度', title: 'ご入酵時の温度調整について', type: 'single',
    options: ['マットあり（温度高め）', 'マットなし（温度低め）']
  },
  stay: {
    id: 'stay', short: '過ごし方', title: 'ご入酵時（桶内）の過ごし方について', type: 'single',
    options: ['ご自身のスマホ持込（防水ケースのレンタルあり）', 'ヒーリング音楽', 'iPadでの動画視聴', 'iPadでの音楽視聴']
  },
  hydrogen: {
    id: 'hydrogen', short: '水素吸入', title: '水素吸入について', hint: '複数選択できます', type: 'multi',
    options: ['入酵時', 'ヒーリング時']
  },
  healingWear: {
    id: 'healingWear', short: 'ヒーリング服装', title: 'ヒーリングルームでの服装について', type: 'single',
    options: ['Tシャツ・短パン', 'バスローブ']
  },
  option: {
    id: 'option', short: 'オプション', title: '選べるオプション', hint: '複数選択できます', type: 'multi',
    options: ['水耕栽培の野菜', 'コピ・ルアック（ジャコウネコ珈琲）※ドリップパック']
  },
  condition: {
    id: 'condition', short: '体調', title: '本日の体調はいかがでしょうか', type: 'scale',
    hint: '体調が優れない場合や少しでも不安があるときは、のぼせやすくなることがありますので無理をなさらずスタッフまでお知らせください。',
    options: ['とても良い', '良い', '普通', 'やや不調', '不調']
  },
  memo: {
    id: 'memo', short: 'その他', title: 'その他、気になる点', type: 'text', optional: true,
    placeholder: '気になる点があればご記入ください'
  }
};

const SURVEYS = {
  vip: {
    id: 'vip', label: ROOM_LABELS.vip, accent: '#b08d57',
    questions: [Q.shower, Q.pack, Q.drink, Q.wear, Q.temp, Q.stay, Q.hydrogen, Q.healingWear, Q.option, Q.condition, Q.memo]
  },
  std: {
    id: 'std', label: ROOM_LABELS.std, accent: '#2f6f63',
    questions: [Q.pack, Q.drink, Q.wear, Q.temp, Q.stay, Q.hydrogen, Q.healingWear, Q.option, Q.condition, Q.memo]
  }
};

function surveyFor(room) {
  return SURVEYS[room] || SURVEYS.std;
}

function allQuestions() {
  const seen = new Set();
  const list = [];
  [SURVEYS.vip, SURVEYS.std].forEach(s => s.questions.forEach(q => {
    if (!seen.has(q.id)) { seen.add(q.id); list.push(q); }
  }));
  return list;
}

function questionById(id) {
  return allQuestions().find(q => q.id === id) || null;
}

function pad2(n) { return String(n).padStart(2, '0'); }

function dateKey(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function startOfWeek(d, weekStart) {
  const start = (weekStart === 0) ? 0 : 1;
  const x = startOfDay(d);
  const diff = (x.getDay() - start + 7) % 7;
  x.setDate(x.getDate() - diff);
  return x;
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.getFullYear() + '/' + pad2(d.getMonth() + 1) + '/' + pad2(d.getDate());
}

function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return fmtDate(iso) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

function weekLabel(start, end) {
  return fmtDate(start.toISOString()) + ' 〜 ' + fmtDate(end.toISOString());
}

function inRange(iso, from, to) {
  const t = new Date(iso).getTime();
  return t >= from.getTime() && t < to.getTime();
}

function periodRange(period, now, weekStart) {
  const today = startOfDay(now);
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  if (period === 'today') return { from: today, to: tomorrow, label: '今日' };
  if (period === 'week') {
    const from = startOfWeek(now, weekStart);
    const to = new Date(from); to.setDate(from.getDate() + 7);
    return { from, to, label: '今週' };
  }
  if (period === 'lastWeek') {
    const to = startOfWeek(now, weekStart);
    const from = new Date(to); from.setDate(to.getDate() - 7);
    return { from, to, label: '先週' };
  }
  if (period === 'month') {
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return { from, to, label: '今月' };
  }
  return { from: new Date(2000, 0, 1), to: new Date(2100, 0, 1), label: '全期間' };
}

function answerList(sub, qid) {
  const v = sub.answers ? sub.answers[qid] : null;
  if (Array.isArray(v)) return v;
  if (v === null || v === undefined || v === '') return [];
  return [v];
}

function answerText(sub, qid) {
  return answerList(sub, qid).join(' / ');
}

function isAnswered(sub, qid) {
  return answerList(sub, qid).length > 0;
}

function conditionScore(label) {
  const idx = Q.condition.options.indexOf(label);
  return idx === -1 ? null : (5 - idx);
}

function aggregate(subs, roomFilter) {
  const total = subs.length;
  const customerSet = new Set(subs.map(s => s.customerId || s.customerName));
  const byRoom = { vip: 0, std: 0 };
  subs.forEach(s => { if (byRoom[s.room] !== undefined) byRoom[s.room]++; });

  const conditionScores = subs.map(s => conditionScore(answerText(s, 'condition'))).filter(v => v !== null);
  const conditionAvg = conditionScores.length
    ? conditionScores.reduce((a, b) => a + b, 0) / conditionScores.length : null;

  let statQuestions = surveyQuestionsForStats();
  if (roomFilter === 'std' || (!roomFilter && byRoom.vip === 0)) {
    statQuestions = statQuestions.filter(q => q.id !== 'shower');
  }

  const questions = statQuestions.map(q => {
    if (q.type === 'text') {
      const comments = subs.filter(s => isAnswered(s, q.id))
        .map(s => ({ name: s.customerName, room: s.room, date: s.date, text: answerText(s, q.id) }));
      return { q, respondents: comments.length, comments, counts: [], avg: null };
    }
    const counts = q.options.map(opt => ({
      option: opt,
      count: subs.filter(s => answerList(s, q.id).includes(opt)).length
    }));
    const respondents = subs.filter(s => isAnswered(s, q.id)).length;
    let avg = null;
    if (q.type === 'scale') {
      const scores = subs.map(s => {
        const label = answerText(s, q.id);
        const idx = q.options.indexOf(label);
        return idx === -1 ? null : (5 - idx);
      }).filter(v => v !== null);
      avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
    }
    return { q, respondents, counts, avg, comments: [] };
  });

  return { total, uniqueCustomers: customerSet.size, byRoom, conditionAvg, questions };
}

function surveyQuestionsForStats() {
  return [Q.shower, Q.pack, Q.drink, Q.wear, Q.temp, Q.stay, Q.hydrogen, Q.healingWear, Q.option, Q.condition, Q.memo];
}

function weeklySummary(subs, weekStart, weeksBack) {
  const count = weeksBack || 8;
  const thisWeek = startOfWeek(new Date(), weekStart);
  const weeks = [];
  for (let i = count - 1; i >= 0; i--) {
    const from = new Date(thisWeek); from.setDate(thisWeek.getDate() - i * 7);
    const to = new Date(from); to.setDate(from.getDate() + 7);
    const list = subs.filter(s => inRange(s.date, from, to));
    const scores = list.map(s => conditionScore(answerText(s, 'condition'))).filter(v => v !== null);
    weeks.push({
      from, to,
      label: fmtDate(from.toISOString()) + '〜' + fmtDate(new Date(to.getTime() - 1).toISOString()),
      total: list.length,
      vip: list.filter(s => s.room === 'vip').length,
      std: list.filter(s => s.room === 'std').length,
      conditionAvg: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null
    });
  }
  return weeks;
}

function repeatRate(subs, allSubs) {
  if (!subs.length) return null;
  const all = allSubs && allSubs.length ? allSubs : subs;
  const byCustomer = new Map();
  all.forEach(s => {
    const k = s.customerId || s.customerName;
    if (!byCustomer.has(k)) byCustomer.set(k, []);
    byCustomer.get(k).push(new Date(s.date).getTime());
  });
  byCustomer.forEach(arr => arr.sort((a, b) => a - b));
  let repeat = 0;
  subs.forEach(s => {
    const k = s.customerId || s.customerName;
    const times = byCustomer.get(k) || [];
    const t = new Date(s.date).getTime();
    if (times.some(x => x < t)) repeat++;
  });
  return repeat / subs.length;
}

function missingRequired(answers, room) {
  const qs = surveyFor(room).questions.filter(q => !q.optional && q.type !== 'text');
  return qs.filter(q => answerList({ answers }, q.id).length === 0);
}
