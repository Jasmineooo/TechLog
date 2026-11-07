'use strict';

/* =====================================================================
 * Storage: localStorage with in-memory fallback (private mode / HarmonyOS)
 * ===================================================================== */
const STORE_KEY = 'faa_srs_cards';
let storageAvailable = false;
const memoryStore = {};
try {
  const t = '__srs_test__';
  localStorage.setItem(t, '1');
  localStorage.removeItem(t);
  storageAvailable = true;
} catch (e) {
  storageAvailable = false;
}

function saveCards() {
  const s = JSON.stringify(cards);
  if (storageAvailable) {
    try {
      localStorage.setItem(STORE_KEY, s);
      return;
    } catch (e) {
      storageAvailable = false;
      showStorageBanner();
    }
  }
  memoryStore[STORE_KEY] = s;
}

function loadCards() {
  let raw = null;
  if (storageAvailable) {
    try {
      raw = localStorage.getItem(STORE_KEY);
    } catch (e) {
      storageAvailable = false;
      showStorageBanner();
      raw = memoryStore[STORE_KEY] || null;
    }
  } else {
    raw = memoryStore[STORE_KEY] || null;
  }
  if (raw === null || raw === undefined) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function showStorageBanner() {
  if (typeof document === 'undefined') return;
  const b = document.getElementById('storageBanner');
  if (b) b.classList.remove('hidden');
}

/* =====================================================================
 * Dates — always Asia/Shanghai (UTC+8)
 * ===================================================================== */
function getTodayBeijing() {
  const now = new Date();
  const utc8 = new Date(now.getTime() + 8 * 3600 * 1000);
  return utc8.toISOString().slice(0, 10);
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isDateStr(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

/* =====================================================================
 * Deterministic daily hash (NO Math.random in the due queue)
 * ===================================================================== */
function dailyHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  // Murmur-style finalizer: without it, strings that share an equal-length
  // suffix (e.g. id + same-length date) keep a constant relative order,
  // so the daily shuffle would never actually change between days.
  h = h ^ (h >>> 16);
  h = Math.imul(h, 0x45d9f3b);
  h = h ^ (h >>> 16);
  return h;
}

/* =====================================================================
 * Card model
 * ===================================================================== */
const CONTENT_FIELDS = ['meaning', 'category', 'stageWeek', 'imageUrl', 'collocation', 'definition', 'context'];
let idCounter = 0;

function newId() {
  idCounter += 1;
  return 'c' + Date.now().toString(36) + '-' + idCounter;
}

function clampProf(v, dflt) {
  const n = parseInt(v, 10);
  if (isNaN(n)) return dflt;
  return Math.min(3, Math.max(0, n));
}

function parseForce(v) {
  return ['是', '1', 'yes', 'true', 'y'].indexOf(String(v == null ? '' : v).trim().toLowerCase()) !== -1;
}

function makeCard(o) {
  o = o || {};
  const ef = parseFloat(o.easeFactor);
  return {
    id: o.id ? String(o.id) : newId(),
    term: o.term || '',
    meaning: o.meaning || '',
    category: o.category || '',
    proficiency: clampProf(o.proficiency, 0),
    stageWeek: o.stageWeek || '',
    imageUrl: o.imageUrl || '',
    collocation: o.collocation || '',
    definition: o.definition || '',
    context: o.context || '',
    forceProficiency: !!o.forceProficiency,
    easeFactor: isFinite(ef) ? ef : 2.5,
    interval: Number.isInteger(o.interval) ? o.interval : (parseInt(o.interval, 10) || 0),
    repetitions: Number.isInteger(o.repetitions) ? o.repetitions : (parseInt(o.repetitions, 10) || 0),
    due: isDateStr(o.due) ? o.due : getTodayBeijing(),
    lastReviewed: isDateStr(o.lastReviewed) ? o.lastReviewed : null,
    reviewLog: Array.isArray(o.reviewLog) ? o.reviewLog : []
  };
}

function seedCards() {
  const today = getTodayBeijing();
  return [
    makeCard({
      id: 'seed-1',
      term: 'galvanic corrosion',
      meaning: '电偶腐蚀：两种不同金属在电解质中接触时，电位较负的金属加速腐蚀的现象。CFRP 与铝合金搭接处是典型风险区。',
      category: '腐蚀',
      proficiency: 0,
      stageWeek: 'Q1-W08',
      collocation: 'galvanic corrosion between CFRP and aluminum',
      definition: 'Galvanic corrosion occurs when two dissimilar metals are electrically coupled in the presence of an electrolyte.',
      context: '维修侧在问：CFRP 面板与铝梁之间是否需要玻璃布隔离层？',
      due: today
    }),
    makeCard({
      id: 'seed-2',
      term: 'torque stripe',
      meaning: '力矩标记线：涂在螺栓/螺母上的标记漆，用于目视检查紧固件是否发生转动。',
      category: '紧固件',
      proficiency: 1,
      stageWeek: 'Q1-W08',
      collocation: 'apply a torque stripe to the fastener',
      definition: 'A broken torque stripe indicates possible fastener rotation and requires re-torque.',
      due: today
    }),
    makeCard({
      id: 'seed-3',
      term: 'blind rivet',
      meaning: '抽芯铆钉（盲铆钉）：只需单侧接近即可安装的铆钉，用于无法到达结构背面的区域。',
      category: '紧固件',
      proficiency: 0,
      stageWeek: 'Q1-W09',
      context: '维修侧在问：此处能否用盲铆替代实心铆钉？需要查 SRM 哪个章节？',
      due: today
    })
  ];
}

/* =====================================================================
 * SM-2 scheduling & automatic proficiency
 * ===================================================================== */
function scheduleSM2(card, rating) {
  if (rating < 3) {
    card.repetitions = 0;
    card.interval = 1;
  } else {
    if (card.repetitions === 0) {
      card.interval = 1;
    } else if (card.repetitions === 1) {
      card.interval = 6;
    } else {
      card.interval = Math.round(card.interval * card.easeFactor);
    }
    card.repetitions += 1;
  }
  card.easeFactor = Math.max(
    1.3,
    card.easeFactor + (0.1 - (5 - rating) * (0.08 + (5 - rating) * 0.02))
  );
  card.due = addDays(getTodayBeijing(), card.interval);
  card.lastReviewed = getTodayBeijing();
  return card;
}

function updateProficiency(card, rating) {
  if (card.forceProficiency) return; // manual proficiency: skip auto update
  if (rating <= 2) {
    card.proficiency = 0;
    return;
  }
  if (rating === 3) return;
  // rating 4 or 5: bump only if the previous rating was also >= 4
  const log = card.reviewLog; // called BEFORE current rating is appended
  const prev = log.length ? log[log.length - 1].rating : null;
  if (prev !== null && prev >= 4) {
    card.proficiency = Math.min(3, card.proficiency + 1);
  }
}

/* =====================================================================
 * Due queue: proficiency ASC, then due ASC, then daily hash (stable/day)
 * ===================================================================== */
function getDueQueue() {
  const today = getTodayBeijing();
  return cards
    .filter(function (c) { return c.due <= today; })
    .sort(function (a, b) {
      if (a.proficiency !== b.proficiency) return a.proficiency - b.proficiency;
      if (a.due !== b.due) return a.due < b.due ? -1 : 1;
      return dailyHash(a.id + today) - dailyHash(b.id + today);
    });
}

function getAheadQueue() {
  const today = getTodayBeijing();
  return cards
    .filter(function (c) { return c.due > today; })
    .sort(function (a, b) {
      if (a.due !== b.due) return a.due < b.due ? -1 : 1;
      if (a.proficiency !== b.proficiency) return a.proficiency - b.proficiency;
      return dailyHash(a.id + today) - dailyHash(b.id + today);
    });
}

/* =====================================================================
 * CSV import — column mapping + merge rules
 * ===================================================================== */
const TARGET_FIELDS = [
  { key: 'term', label: '英文表达块 (term) *' },
  { key: 'meaning', label: '中文语境解释 (meaning) *' },
  { key: 'category', label: '类别 (category)' },
  { key: 'proficiency', label: '熟练度 (proficiency)' },
  { key: 'stageWeek', label: '阶段/周 (stageWeek)' },
  { key: 'imageUrl', label: '图片 (imageUrl)' },
  { key: 'collocation', label: '固定搭配 (collocation)' },
  { key: 'definition', label: '英文原句/定义 (definition)' },
  { key: 'context', label: '章节语境 (context)' },
  { key: 'forceProficiency', label: '强制熟练度 (forceProficiency)' },
  { key: 'id', label: 'ID (仅备份文件)' },
  { key: 'easeFactor', label: 'easeFactor (仅备份文件)' },
  { key: 'interval', label: 'interval (仅备份文件)' },
  { key: 'repetitions', label: 'repetitions (仅备份文件)' },
  { key: 'due', label: 'due (仅备份文件)' }
];

function normalizeHeader(h) {
  return String(h == null ? '' : h)
    .trim()
    .replace(/[(（].*$/, '')   // strip trailing (0-3) etc.
    .replace(/\s+/g, '')
    .toLowerCase();
}

function mapColumns(headers) {
  const candidates = {
    term: ['英文表达块', 'term'],
    meaning: ['中文语境解释', 'meaning'],
    category: ['类别', 'category'],
    proficiency: ['熟练度', 'proficiency'],
    stageWeek: ['阶段', '阶段/周', 'stageweek'],
    imageUrl: ['图片', 'imageurl', 'image'],
    collocation: ['固定搭配', '固定搭配/句式', 'collocation'],
    definition: ['英文原句/定义', 'definition'],
    context: ['章节语境', '维修侧在问什么', 'context'],
    forceProficiency: ['强制熟练度', 'forceproficiency'],
    id: ['id'],
    easeFactor: ['easefactor'],
    interval: ['interval'],
    repetitions: ['repetitions'],
    due: ['due']
  };
  const normHeaders = headers.map(function (h) {
    return { orig: h, norm: normalizeHeader(h) };
  });
  const mapping = {};
  Object.keys(candidates).forEach(function (key) {
    mapping[key] = '';
    for (let i = 0; i < candidates[key].length; i++) {
      const want = normalizeHeader(candidates[key][i]);
      const hit = normHeaders.find(function (h) { return h.norm === want; });
      if (hit) {
        mapping[key] = hit.orig;
        break;
      }
    }
  });
  return mapping;
}

/* Built-in CSV engine — Papa Parse via CDN is only an optional accelerator.
 * The app must stay fully functional when jsdelivr is unreachable (offline-first). */
function csvEscape(v) {
  const s = String(v == null ? '' : v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function csvUnparse(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const lines = [headers.map(csvEscape).join(',')];
  rows.forEach(function (r) {
    lines.push(headers.map(function (h) { return csvEscape(r[h]); }).join(','));
  });
  return lines.join('\r\n');
}

function csvParse(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // strip BOM
  const out = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); out.push(row); row = []; field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); out.push(row); }
  if (!out.length) return { headers: [], rows: [] };
  const headers = out[0];
  const data = out.slice(1)
    .filter(function (r) { return r.some(function (v) { return String(v).trim() !== ''; }); })
    .map(function (r) {
      const o = {};
      headers.forEach(function (h, i) { o[h] = r[i] !== undefined ? r[i] : ''; });
      return o;
    });
  return { headers: headers, rows: data };
}

function importCSV(file) {
  if (typeof Papa !== 'undefined') {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: function (results) {
        const headers = results.meta && results.meta.fields ? results.meta.fields : [];
        if (!headers.length) {
          alert('CSV 解析失败：未检测到表头');
          return;
        }
        pendingImport = { rows: results.data, headers: headers };
        showMappingUI(headers, results.data.length);
      },
      error: function (err) {
        alert('CSV 解析失败: ' + err.message);
      }
    });
    return;
  }
  // Fallback: built-in parser (CDN unavailable)
  const reader = new FileReader();
  reader.onload = function () {
    try {
      const res = csvParse(String(reader.result || ''));
      if (!res.headers.length) {
        alert('CSV 解析失败：未检测到表头');
        return;
      }
      pendingImport = { rows: res.rows, headers: res.headers };
      showMappingUI(res.headers, res.rows.length);
    } catch (e) {
      alert('CSV 解析失败: ' + e.message);
    }
  };
  reader.onerror = function () {
    alert('CSV 读取失败');
  };
  reader.readAsText(file);
}

function applyImport(rows, mapping) {
  const byTerm = new Map();
  cards.forEach(function (c) { byTerm.set(c.term, c); });
  const summary = { newCount: 0, updated: 0, protected: 0, forced: 0, unchanged: 0, skipped: 0 };

  const get = function (row, key) {
    const h = mapping[key];
    if (!h) return '';
    const v = row[h];
    return v === undefined || v === null ? '' : String(v).trim();
  };

  rows.forEach(function (row) {
    const term = get(row, 'term');
    if (!term) {
      summary.skipped++;
      return;
    }
    const profRaw = get(row, 'proficiency');
    const force = parseForce(get(row, 'forceProficiency'));
    const existing = byTerm.get(term);

    if (!existing) {
      // New card: CSV supplies initial content AND (for backup round-trips) SRS state.
      const efRaw = parseFloat(get(row, 'easeFactor'));
      const card = makeCard({
        id: get(row, 'id') || undefined,
        term: term,
        meaning: get(row, 'meaning'),
        category: get(row, 'category'),
        proficiency: profRaw === '' ? 0 : clampProf(profRaw, 0),
        stageWeek: get(row, 'stageWeek'),
        imageUrl: get(row, 'imageUrl'),
        collocation: get(row, 'collocation'),
        definition: get(row, 'definition'),
        context: get(row, 'context'),
        forceProficiency: force,
        easeFactor: isFinite(efRaw) ? efRaw : 2.5,
        interval: parseInt(get(row, 'interval'), 10) || 0,
        repetitions: parseInt(get(row, 'repetitions'), 10) || 0,
        due: isDateStr(get(row, 'due')) ? get(row, 'due') : getTodayBeijing()
      });
      cards.push(card);
      byTerm.set(term, card);
      summary.newCount++;
      if (force) summary.forced++;
      return;
    }

    // Existing card: CSV owns content fields only; SRS state is never touched.
    let changed = false;
    CONTENT_FIELDS.forEach(function (f) {
      const v = get(row, f);
      if (v !== '' && v !== existing[f]) {
        existing[f] = v;
        changed = true;
      }
    });

    if (force) {
      if (profRaw !== '') existing.proficiency = clampProf(profRaw, existing.proficiency);
      existing.forceProficiency = true;
      summary.forced++;
    } else if (profRaw !== '' && clampProf(profRaw, existing.proficiency) !== existing.proficiency) {
      // App-maintained proficiency wins over stale CSV value.
      summary.protected++;
    }

    if (changed) summary.updated++;
    else if (!force) summary.unchanged++;
  });

  saveCards();
  return summary;
}

function showMappingUI(headers, rowCount) {
  const auto = mapColumns(headers);
  const container = document.getElementById('mappingRows');
  container.innerHTML = '';
  TARGET_FIELDS.forEach(function (f) {
    const row = document.createElement('div');
    row.className = 'mapping-row';
    const label = document.createElement('label');
    label.textContent = f.label;
    const select = document.createElement('select');
    select.dataset.field = f.key;
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = '— 不导入 —';
    select.appendChild(empty);
    headers.forEach(function (h) {
      const opt = document.createElement('option');
      opt.value = h;
      opt.textContent = h;
      select.appendChild(opt);
    });
    select.value = auto[f.key] || '';
    row.appendChild(label);
    row.appendChild(select);
    container.appendChild(row);
  });
  const info = document.createElement('p');
  info.className = 'muted small';
  info.textContent = '检测到 ' + rowCount + ' 行数据。';
  container.appendChild(info);

  document.getElementById('mappingView').classList.remove('hidden');
  document.getElementById('summaryView').classList.add('hidden');
  document.getElementById('importModal').classList.remove('hidden');
}

function confirmImport() {
  const selects = document.querySelectorAll('#mappingRows select');
  const mapping = {};
  selects.forEach(function (s) { mapping[s.dataset.field] = s.value; });
  if (!mapping.term || !mapping.meaning) {
    alert('必须映射「英文表达块」和「中文语境解释」两列');
    return;
  }
  const summary = applyImport(pendingImport.rows, mapping);
  pendingImport = null;

  const text =
    summary.newCount + ' new, ' +
    summary.updated + ' content-updated, ' +
    summary.protected + ' proficiency-protected, ' +
    summary.forced + ' proficiency-forced, ' +
    summary.unchanged + ' unchanged' +
    (summary.skipped ? '（跳过 ' + summary.skipped + ' 行空 term）' : '');
  document.getElementById('summaryText').textContent = text;
  document.getElementById('importSummary').textContent = '最近导入: ' + text;

  document.getElementById('mappingView').classList.add('hidden');
  document.getElementById('summaryView').classList.remove('hidden');

  queue = [];
  reviewAheadMode = false;
  renderReview();
  renderStats();
}

/* =====================================================================
 * Review UI
 * ===================================================================== */
let cards = [];
let queue = [];
let reviewAheadMode = false;
let pendingImport = null;
let lastReviewInfo = null;

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function truncate(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function handleImageError(img) {
  const div = document.createElement('div');
  div.className = 'img-placeholder';
  div.textContent = '图片未找到: ' + img.getAttribute('src');
  if (img.parentNode) img.parentNode.replaceChild(div, img);
}

function renderReview() {
  const frontEl = document.getElementById('cardFront');
  const backEl = document.getElementById('cardBack');
  const showBtn = document.getElementById('showAnswerBtn');
  const ratingsEl = document.getElementById('ratingButtons');
  const caughtUp = document.getElementById('caughtUp');
  const cardView = document.getElementById('cardView');
  const aheadBanner = document.getElementById('aheadBanner');
  const queueInfo = document.getElementById('queueInfo');
  const aheadBtn = document.getElementById('reviewAheadBtn');
  const backBtn = document.getElementById('backToDueBtn');

  if (!queue.length) {
    queue = reviewAheadMode ? getAheadQueue() : getDueQueue();
  }

  if (!queue.length) {
    cardView.classList.add('hidden');
    caughtUp.classList.remove('hidden');
    const aheadCount = getAheadQueue().length;
    if (!reviewAheadMode && aheadCount > 0) {
      aheadBtn.classList.remove('hidden');
      backBtn.classList.add('hidden');
      document.getElementById('caughtUpHint').textContent =
        '还有 ' + aheadCount + ' 张未到期卡片可提前复习。';
    } else if (reviewAheadMode) {
      aheadBtn.classList.add('hidden');
      backBtn.classList.remove('hidden');
      document.getElementById('caughtUpHint').textContent = '提前复习队列已完成。';
    } else {
      aheadBtn.classList.add('hidden');
      backBtn.classList.add('hidden');
      document.getElementById('caughtUpHint').textContent = '今天没有到期的卡片。';
    }
    queueInfo.textContent = '';
    return;
  }

  cardView.classList.remove('hidden');
  caughtUp.classList.add('hidden');
  backEl.classList.add('hidden');
  ratingsEl.classList.add('hidden');
  showBtn.classList.remove('hidden');
  aheadBanner.classList.toggle('hidden', !reviewAheadMode);
  queueInfo.textContent = '队列剩余 ' + queue.length + ' 张' + (reviewAheadMode ? '（提前复习）' : '');

  const c = queue[0];
  let html = '';
  if (c.imageUrl) {
    // Front: image as prompt; NEVER the English term.
    html += '<img class="front-img" src="' + escapeHtml(c.imageUrl) + '" alt="" onerror="handleImageError(this)">';
    html += '<div class="tag-row">' + (c.category ? '<span class="tag">' + escapeHtml(c.category) + '</span>' : '') + '</div>';
    if (c.meaning && c.meaning.length < 60) {
      html += '<p class="hint">' + escapeHtml(c.meaning) + '</p>';
    }
  } else {
    html += '<p class="prompt">' + escapeHtml(truncate(c.meaning, 60)) + '</p>';
    html += '<div class="tag-row">' + (c.category ? '<span class="tag">' + escapeHtml(c.category) + '</span>' : '') + '</div>';
  }
  frontEl.innerHTML = html;
}

function showAnswer() {
  const c = queue[0];
  if (!c) return;
  const backEl = document.getElementById('cardBack');

  let html = '<div class="back-term">' + escapeHtml(c.term) + '</div>';
  if (c.collocation) {
    html += '<div class="back-row"><span class="back-label">固定搭配 / Collocation</span>' +
      '<div>' + escapeHtml(c.collocation) + '</div></div>';
  }
  html += '<div class="back-meaning">' + escapeHtml(c.meaning) + '</div>';
  if (c.definition) {
    html += '<div class="back-row"><span class="back-label">英文原句 / Definition</span>' +
      '<div class="def-box">' + escapeHtml(c.definition) + '</div></div>';
  }
  if (c.context) {
    html += '<div class="back-row"><span class="back-label">章节语境 / Context</span>' +
      '<div class="context">' + escapeHtml(c.context) + '</div></div>';
  }
  html += '<div class="meta">' +
    escapeHtml(c.stageWeek || '—') +
    ' · 熟练度 ' + c.proficiency + '/3' +
    ' · EF ' + c.easeFactor.toFixed(2) +
    ' · 间隔 ' + c.interval + ' 天' +
    ' · 到期 ' + c.due +
    '</div>';
  if (c.forceProficiency) {
    html += '<span class="badge">手动熟练度</span>';
  }
  if (c.imageUrl) {
    html += '<img class="back-img" src="' + escapeHtml(c.imageUrl) + '" alt="" onerror="handleImageError(this)">';
  }

  backEl.innerHTML = html;
  backEl.classList.remove('hidden');
  document.getElementById('showAnswerBtn').classList.add('hidden');
  document.getElementById('ratingButtons').classList.remove('hidden');
}

function rateCard(rating) {
  const c = queue[0];
  if (!c) return;
  const oldEF = c.easeFactor;
  const oldProf = c.proficiency;

  scheduleSM2(c, rating);
  updateProficiency(c, rating); // reads reviewLog BEFORE current entry is appended
  c.reviewLog.push({ date: getTodayBeijing(), rating: rating });

  lastReviewInfo = {
    term: c.term,
    rating: rating,
    oldEF: oldEF,
    newEF: c.easeFactor,
    interval: c.interval,
    due: c.due,
    oldProf: oldProf,
    newProf: c.proficiency
  };

  saveCards();
  queue.shift();
  renderReview();
  renderStats();
}

/* =====================================================================
 * Stats / dashboard
 * ===================================================================== */
function renderStats() {
  const today = getTodayBeijing();
  const dueCount = cards.filter(function (c) { return c.due <= today; }).length;
  const forceCount = cards.filter(function (c) { return c.forceProficiency; }).length;

  const grid = document.getElementById('statGrid');
  grid.innerHTML = '';
  [
    { num: cards.length, label: '总卡片数' },
    { num: dueCount, label: '今日到期' },
    { num: forceCount, label: '手动熟练度' }
  ].forEach(function (s) {
    grid.innerHTML += '<div class="stat-box"><div class="stat-num">' + s.num +
      '</div><div class="stat-label">' + s.label + '</div></div>';
  });

  // proficiency distribution
  const profCounts = [0, 0, 0, 0];
  cards.forEach(function (c) { profCounts[c.proficiency] = (profCounts[c.proficiency] || 0) + 1; });
  renderBars(document.getElementById('profStats'), profCounts.map(function (n, i) {
    return { name: '熟练度 ' + i, count: n };
  }));

  // category distribution
  const catMap = {};
  cards.forEach(function (c) {
    const k = c.category || '（未分类）';
    catMap[k] = (catMap[k] || 0) + 1;
  });
  const catRows = Object.keys(catMap).sort().map(function (k) {
    return { name: k, count: catMap[k] };
  });
  renderBars(document.getElementById('catStats'), catRows);

  drawWeekChart();

  // settings: storage info
  const si = document.getElementById('storageInfo');
  if (si) {
    si.textContent = '存储引擎: ' + (storageAvailable ? 'localStorage' : '内存（localStorage 不可用）') +
      ' · key: ' + STORE_KEY + ' · 卡片数: ' + cards.length;
  }

  // debug panel
  const dbg = document.getElementById('debugInfo');
  const utcDate = new Date().toISOString().slice(0, 10);
  let txt = 'today (UTC+8): ' + today + '\nUTC date: ' + utcDate +
    '\nstorage: ' + (storageAvailable ? 'localStorage' : 'in-memory (localStorage unavailable)') +
    '\nMath.random used in getDueQueue: no (dailyHash only)';
  if (lastReviewInfo) {
    txt += '\n\nlast review: ' + lastReviewInfo.term +
      '\n  rating: ' + lastReviewInfo.rating +
      '\n  easeFactor: ' + lastReviewInfo.oldEF.toFixed(2) + ' → ' + lastReviewInfo.newEF.toFixed(2) +
      '\n  interval: ' + lastReviewInfo.interval + ' 天' +
      '\n  due: ' + lastReviewInfo.due +
      '\n  proficiency: ' + lastReviewInfo.oldProf + ' → ' + lastReviewInfo.newProf;
  }
  dbg.textContent = txt;
}

function renderBars(el, rows) {
  if (!rows.length) {
    el.innerHTML = '<p class="muted small">暂无数据</p>';
    return;
  }
  const max = Math.max.apply(null, rows.map(function (r) { return r.count; }).concat([1]));
  el.innerHTML = rows.map(function (r) {
    const pct = Math.round((r.count / max) * 100);
    return '<div class="bar-row">' +
      '<span class="bar-name" title="' + escapeHtml(r.name) + '">' + escapeHtml(r.name) + '</span>' +
      '<span class="bar-track"><span class="bar-fill" style="width:' + pct + '%"></span></span>' +
      '<span class="bar-count">' + r.count + '</span></div>';
  }).join('');
}

function drawWeekChart() {
  const canvas = document.getElementById('weekChart');
  if (!canvas || !canvas.parentElement) return;
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const width = Math.max(280, canvas.parentElement.clientWidth - 4);
  const height = 160;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);

  const days = [];
  for (let i = 6; i >= 0; i--) days.push(addDays(getTodayBeijing(), -i));
  const counts = days.map(function (d) {
    return cards.reduce(function (n, c) {
      return n + c.reviewLog.filter(function (e) { return e.date === d; }).length;
    }, 0);
  });

  const max = Math.max.apply(null, counts.concat([1]));
  const padL = 8, padB = 22, padT = 18;
  const bw = (width - padL * 2) / 7;

  ctx.textAlign = 'center';
  days.forEach(function (d, i) {
    const h = counts[i] === 0 ? 0 : Math.max(4, (counts[i] / max) * (height - padT - padB));
    const w = bw * 0.6;
    const x = padL + i * bw + (bw - w) / 2;
    const y = height - padB - h;
    ctx.fillStyle = '#2563eb';
    ctx.fillRect(x, y, w, h);
    if (counts[i] > 0) {
      ctx.fillStyle = '#1c2733';
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.fillText(String(counts[i]), x + w / 2, y - 5);
    }
    ctx.fillStyle = '#6b7a89';
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText(d.slice(5), x + w / 2, height - 7);
  });
}

/* =====================================================================
 * Export / backup
 * ===================================================================== */
function download(content, filename, mime) {
  const blob = new Blob([content], { type: mime + ';charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

function exportCSV() {
  const rows = cards.map(function (c) {
    return {
      id: c.id,
      term: c.term,
      meaning: c.meaning,
      category: c.category,
      proficiency: c.proficiency,
      stageWeek: c.stageWeek,
      imageUrl: c.imageUrl,
      collocation: c.collocation,
      definition: c.definition,
      context: c.context,
      forceProficiency: c.forceProficiency ? '是' : '',
      easeFactor: c.easeFactor,
      interval: c.interval,
      repetitions: c.repetitions,
      due: c.due
    };
  });
  try {
    const csvText = (typeof Papa !== 'undefined') ? Papa.unparse(rows) : csvUnparse(rows);
    // BOM so Excel opens UTF-8 Chinese correctly
    download('﻿' + csvText, 'faa-cards-' + getTodayBeijing() + '.csv', 'text/csv');
  } catch (e) {
    alert('导出失败: ' + e.message);
  }
}

function exportJSON() {
  const payload = {
    version: 1,
    exported: getTodayBeijing(),
    cards: cards
  };
  download(JSON.stringify(payload, null, 2), 'faa-cards-backup-' + getTodayBeijing() + '.json', 'application/json');
}

function importJSON(file) {
  const reader = new FileReader();
  reader.onload = function () {
    try {
      const data = JSON.parse(reader.result);
      const arr = Array.isArray(data) ? data : data.cards;
      if (!Array.isArray(arr)) throw new Error('未找到 cards 数组');
      if (!confirm('将用备份覆盖当前 ' + cards.length + ' 张卡片（备份含 ' + arr.length + ' 张）。确定继续？')) {
        return;
      }
      cards = arr.map(function (o) { return makeCard(o); });
      saveCards();
      queue = [];
      reviewAheadMode = false;
      renderReview();
      renderStats();
      alert('备份恢复完成');
    } catch (e) {
      alert('JSON 导入失败: ' + e.message);
    }
  };
  reader.readAsText(file);
}

/* =====================================================================
 * Init & event wiring
 * ===================================================================== */
function renderAll() {
  renderReview();
  renderStats();
}

function switchView(name) {
  document.querySelectorAll('.view').forEach(function (v) {
    v.classList.toggle('active', v.id === 'view-' + name);
  });
  document.querySelectorAll('.nav-item').forEach(function (b) {
    b.classList.toggle('active', b.dataset.view === name);
  });
  if (name === 'stats') renderStats(); // canvas needs a visible parent to size correctly
  if (typeof window !== 'undefined') window.scrollTo(0, 0);
}

function clearData() {
  if (!confirm('将删除全部 ' + cards.length + ' 张卡片及所有复习记录，且无法恢复。\n建议先导出 JSON 备份。确定清空？')) return;
  if (!confirm('再次确认：真的要清空所有数据吗？')) return;
  cards = [];
  saveCards();
  queue = [];
  reviewAheadMode = false;
  lastReviewInfo = null;
  const summary = document.getElementById('importSummary');
  if (summary) summary.textContent = '';
  renderAll();
  alert('已清空所有数据');
}

function init() {
  if (!storageAvailable) showStorageBanner();

  const loaded = loadCards();
  if (loaded && Array.isArray(loaded)) {
    cards = loaded.map(function (o) { return makeCard(o); });
  } else {
    cards = seedCards();
    saveCards();
  }

  document.querySelectorAll('.nav-item').forEach(function (btn) {
    btn.addEventListener('click', function () {
      switchView(btn.dataset.view);
    });
  });

  document.getElementById('clearDataBtn').addEventListener('click', clearData);

  document.getElementById('showAnswerBtn').addEventListener('click', showAnswer);

  document.querySelectorAll('#ratingButtons button').forEach(function (btn) {
    btn.addEventListener('click', function () {
      rateCard(parseInt(btn.dataset.rating, 10));
    });
  });

  document.getElementById('reviewAheadBtn').addEventListener('click', function () {
    reviewAheadMode = true;
    queue = [];
    renderReview();
  });

  document.getElementById('backToDueBtn').addEventListener('click', function () {
    reviewAheadMode = false;
    queue = [];
    renderReview();
  });

  document.getElementById('importCsvBtn').addEventListener('click', function () {
    document.getElementById('csvFileInput').click();
  });
  document.getElementById('csvFileInput').addEventListener('change', function (e) {
    const f = e.target.files && e.target.files[0];
    if (f) importCSV(f);
    e.target.value = '';
  });

  document.getElementById('exportCsvBtn').addEventListener('click', exportCSV);
  document.getElementById('exportJsonBtn').addEventListener('click', exportJSON);

  document.getElementById('importJsonBtn').addEventListener('click', function () {
    document.getElementById('jsonFileInput').click();
  });
  document.getElementById('jsonFileInput').addEventListener('change', function (e) {
    const f = e.target.files && e.target.files[0];
    if (f) importJSON(f);
    e.target.value = '';
  });

  document.getElementById('cancelImportBtn').addEventListener('click', function () {
    pendingImport = null;
    document.getElementById('importModal').classList.add('hidden');
  });
  document.getElementById('confirmImportBtn').addEventListener('click', confirmImport);
  document.getElementById('closeSummaryBtn').addEventListener('click', function () {
    document.getElementById('importModal').classList.add('hidden');
  });

  window.addEventListener('resize', drawWeekChart);

  renderAll();
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', init);
}
