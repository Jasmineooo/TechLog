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
/* Fixed header table — any CSV column whose header matches one of these is
 * imported; unrecognised extra columns are simply ignored. No mapping dialog. */
const HEADER_CANDIDATES = {
  term: ['英文表达块', 'term', '英文表达', '表达块'],
  meaning: ['中文语境解释', '语境解释', '中文解释', 'meaning'],
  category: ['类别', '分类', 'category'],
  proficiency: ['熟练度', '熟练程度', 'proficiency'],
  stageWeek: ['阶段/周', '阶段', '周次', 'stageweek', 'stage'],
  imageUrl: ['图片', '图像', 'imageurl', 'image'],
  collocation: ['固定搭配/句式', '固定搭配', '句式', 'collocation'],
  definition: ['英文原句', '英文定义', '原句', 'definition'],
  context: ['章节语境', '维修侧在问什么', '语境', 'context'],
  forceProficiency: ['强制熟练度', '强制覆盖', 'forceproficiency'],
  id: ['id', '编号'],
  easeFactor: ['easefactor', '难度系数'],
  interval: ['interval', '间隔'],
  repetitions: ['repetitions', '重复次数'],
  due: ['due', '到期日'],
  lastReviewed: ['lastreviewed', '上次复习']
};

function normalizeHeader(h) {
  return String(h == null ? '' : h)
    .replace(/^\uFEFF/, '')
    .trim()
    .replace(/[(（].*$/, '')   // strip trailing (0-3) etc.
    .replace(/[:：].*$/, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

const KNOWN_HEADER_NORMS = (function () {
  const set = {};
  Object.keys(HEADER_CANDIDATES).forEach(function (k) {
    HEADER_CANDIDATES[k].forEach(function (n) { set[normalizeHeader(n)] = k; });
  });
  return set;
})();

function mapColumns(headers) {
  const normHeaders = headers.map(function (h) {
    return { orig: h, norm: normalizeHeader(h) };
  });
  const mapping = {};
  const claimed = {};

  // pass 1: exact header match
  Object.keys(HEADER_CANDIDATES).forEach(function (key) {
    mapping[key] = '';
    for (let i = 0; i < HEADER_CANDIDATES[key].length; i++) {
      const want = normalizeHeader(HEADER_CANDIDATES[key][i]);
      const hit = normHeaders.find(function (h) {
        return h.norm === want && !claimed[h.orig];
      });
      if (hit) {
        mapping[key] = hit.orig;
        claimed[hit.orig] = key;
        break;
      }
    }
  });

  // pass 2: header containing the keyword (e.g. "熟练度(0-3)分") — never steal a
  // column already mapped, and never let 强制熟练度 leak into proficiency.
  Object.keys(HEADER_CANDIDATES).forEach(function (key) {
    if (mapping[key]) return;
    const hit = normHeaders.find(function (h) {
      if (!h.norm || claimed[h.orig]) return false;
      if (key !== 'forceProficiency' && h.norm.indexOf('强制') !== -1) return false;
      return HEADER_CANDIDATES[key].some(function (n) {
        const nn = normalizeHeader(n);
        return nn.length >= 2 && h.norm.indexOf(nn) !== -1;
      });
    });
    if (hit) {
      mapping[key] = hit.orig;
      claimed[hit.orig] = key;
    }
  });
  return mapping;
}

/* =====================================================================
 * Built-in CSV engine (no CDN): Excel-safe.
 * Handles UTF-8 / UTF-16 / GBK encodings, BOM, Excel's "sep=," first line,
 * auto delimiter (comma / semicolon / tab), quoted fields with , " and \n.
 * ===================================================================== */
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

function stripBom(text) {
  return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
}

function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/).find(function (l) { return l.trim() !== ''; }) || '';
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let inQ = false;
  for (let i = 0; i < firstLine.length; i++) {
    const ch = firstLine[i];
    if (ch === '"') inQ = !inQ;
    else if (!inQ && counts[ch] !== undefined) counts[ch]++;
  }
  let best = ',';
  Object.keys(counts).forEach(function (d) { if (counts[d] > counts[best]) best = d; });
  return best;
}

function csvParse(text, delimiter) {
  text = stripBom(String(text || ''));
  delimiter = delimiter || ',';
  const rowsOut = [];
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
    } else if (c === delimiter) {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); rowsOut.push(row); row = []; field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rowsOut.push(row); }
  if (!rowsOut.length) return { headers: [], rows: [] };
  const headers = rowsOut[0];
  const data = rowsOut.slice(1)
    .filter(function (r) { return r.some(function (v) { return String(v).trim() !== ''; }); })
    .map(function (r) {
      const o = {};
      headers.forEach(function (h, i) { o[h] = r[i] !== undefined ? r[i] : ''; });
      return o;
    });
  return { headers: headers, rows: data };
}

/* Decode a CSV file buffer. Excel on Chinese Windows writes GBK by default,
 * which is why reading it as UTF-8 produces garbled headers. */
function decodeCsvBuffer(buf) {
  const bytes = new Uint8Array(buf);
  if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
    return new TextDecoder('utf-16le').decode(buf);
  }
  if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
    return new TextDecoder('utf-16be').decode(buf);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch (e) { /* not valid UTF-8 */ }
  const legacy = ['gbk', 'gb18030', 'big5'];
  for (let i = 0; i < legacy.length; i++) {
    try {
      const out = new TextDecoder(legacy[i]).decode(buf);
      if (out && !/^.*\uFFFD.*$/s.test(out.slice(0, 200))) return out;
    } catch (e2) { /* try next */ }
  }
  return new TextDecoder('utf-8').decode(buf);
}

/* Find the real header row: Excel may put a title row above it, or a "sep=,"
 * line first. Scans the first 10 rows and picks the one with the most known
 * column names; falls back to row 0. */
function findHeaderRow(matrix) {
  let bestIdx = 0, bestScore = 0;
  const limit = Math.min(matrix.length, 10);
  for (let i = 0; i < limit; i++) {
    let score = 0;
    matrix[i].forEach(function (cell) {
      const n = normalizeHeader(cell);
      if (n && KNOWN_HEADER_NORMS[n]) score++;
    });
    if (score > bestScore) { bestScore = score; bestIdx = i; }
  }
  return bestIdx;
}

function parseCsvText(rawText) {
  let text = stripBom(String(rawText || ''));
  // Excel sometimes writes "sep=," (or "sep=;") as the very first line.
  const sepMatch = text.match(/^sep=([,;\t])\s*\r?\n/i);
  if (sepMatch) {
    text = text.slice(sepMatch[0].length);
    const matrix = toMatrix(text, sepMatch[1]);
    return buildResult(matrix, sepMatch[1]);
  }
  const delim = detectDelimiter(text);
  const matrix = toMatrix(text, delim);
  return buildResult(matrix, delim);
}

function toMatrix(text, delimiter) {
  const raw = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); raw.push(row); row = []; field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); raw.push(row); }
  return raw;
}

function buildResult(matrix, delimiter) {
  const meaningful = matrix.filter(function (r) {
    return r.some(function (v) { return String(v).trim() !== ''; });
  });
  if (!meaningful.length) return { headers: [], rows: [], delimiter: delimiter };
  const hIdx = findHeaderRow(meaningful);
  // drop the sep line / title rows above the header
  const table = meaningful.slice(hIdx);
  const headers = [];
  table[0].forEach(function (h, i) {
    let name = String(h == null ? '' : h).replace(/^\uFEFF/, '').trim();
    if (!name) return; // unnamed column -> ignored
    if (headers.indexOf(name) !== -1) {
      let suffix = 2;
      while (headers.indexOf(name + ' (' + suffix + ')') !== -1) suffix++;
      name = name + ' (' + suffix + ')';
    }
    headers.push(name);
  });
  const rows = table.slice(1).map(function (r) {
    const o = {};
    headers.forEach(function (h, i) { o[h] = r[i] !== undefined ? r[i] : ''; });
    return o;
  });
  return { headers: headers, rows: rows, delimiter: delimiter, headerRow: hIdx };
}

function importCSV(file) {
  const name = (file.name || '').toLowerCase();
  if (/\.(xlsx|xls)$/.test(name)) {
    alert('这是 Excel 工作簿（.xlsx/.xls），无法直接读取。\n请在 Excel 中「另存为 → CSV（逗号分隔）」后再导入。');
    return;
  }
  if (name && !/\.(csv|txt|tsv)$/.test(name) &&
      !confirm('所选文件「' + file.name + '」看起来不是 CSV，仍要尝试导入吗？')) {
    return;
  }
  if (file.size === 0) {
    alert('文件是空的，请检查导出是否完整。');
    return;
  }
  const reader = new FileReader();
  reader.onload = function () {
    try {
      const text = decodeCsvBuffer(reader.result);
      const parsed = parseCsvText(text);
      if (!parsed.headers.length) {
        alert('CSV 解析失败：未检测到表头');
        return;
      }
      const mapping = mapColumns(parsed.headers);
      if (!mapping.term || !mapping.meaning) {
        alert('未找到必需列。\n\n需要：英文表达块（term）、中文语境解释（meaning）\n检测到的表头：\n' +
          parsed.headers.join(' | '));
        return;
      }
      const summary = applyImport(parsed.rows, mapping);
      showImportSummary(summary, parsed, mapping);
      queue = [];
      reviewAheadMode = false;
      renderReview();
      renderStats();
    } catch (e) {
      alert('CSV 解析失败: ' + e.message);
    }
  };
  reader.onerror = function () {
    alert('读取文件失败。\n如果是手机浏览器（尤其微信内置浏览器），请改用系统浏览器（Safari / Chrome）打开本页后重试。');
  };
  reader.readAsArrayBuffer(file);
}

function showImportSummary(summary, parsed, mapping) {
  const el = document.getElementById('importSummary');
  if (!el) return;
  const usedKeys = Object.keys(mapping).filter(function (k) { return mapping[k]; });
  const usedHeaders = usedKeys.map(function (k) { return mapping[k]; });
  const ignored = parsed.headers.filter(function (h) {
    return usedHeaders.indexOf(h) === -1;
  });

  let text = summary.newCount + ' new, ' + summary.updated + ' content-updated, ' +
    summary.protected + ' proficiency-protected, ' + summary.forced + ' proficiency-forced, ' +
    summary.unchanged + ' unchanged' +
    (summary.skipped ? '（跳过 ' + summary.skipped + ' 行空 term）' : '');
  text += '\n已导入字段：' + usedKeys.map(function (k) {
    return k + ' ← ' + mapping[k];
  }).join('，');
  if (ignored.length) {
    text += '\n忽略未匹配列：' + ignored.join('、');
  }
  if (parsed.delimiter !== ',') {
    text += '\n分隔符：' + (parsed.delimiter === '\t' ? '制表符' : '分号');
  }
  el.textContent = text;
  if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
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

/* =====================================================================
 * Review UI
 * ===================================================================== */
let cards = [];
let queue = [];
let reviewAheadMode = false;
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
  document.getElementById('cardFront').classList.add('hidden');
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
    // BOM so Excel opens UTF-8 Chinese correctly
    download('﻿' + csvUnparse(rows), 'faa-cards-' + getTodayBeijing() + '.csv', 'text/csv');
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
  const name = (file.name || '').toLowerCase();
  if (name && !/\.(json|txt)$/.test(name) &&
      !confirm('所选文件「' + file.name + '」不是 .json 备份，仍要尝试导入吗？')) {
    return;
  }
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

  // File pickers use native <label> activation — no JS click forwarding needed.
  document.getElementById('csvFileInput').addEventListener('change', function (e) {
    const f = e.target.files && e.target.files[0];
    if (f) importCSV(f);
    e.target.value = '';
  });

  document.getElementById('exportCsvBtn').addEventListener('click', exportCSV);
  document.getElementById('exportJsonBtn').addEventListener('click', exportJSON);

  document.getElementById('jsonFileInput').addEventListener('change', function (e) {
    const f = e.target.files && e.target.files[0];
    if (f) importJSON(f);
    e.target.value = '';
  });

  window.addEventListener('resize', drawWeekChart);

  renderAll();
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', init);
}
