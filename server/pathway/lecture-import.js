// Real lecture ingestion: text extraction from PDF / PPTX / DOCX / TXT,
// then question generation (Claude when available, heuristic otherwise).

const PDF_MJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.6.82/pdf.min.mjs';
const PDF_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.6.82/pdf.worker.min.mjs';
const JSZIP_JS = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';

let pdfLib = null;
async function pdf() {
  if (!pdfLib) {
    pdfLib = await import(/* @vite-ignore */ PDF_MJS);
    pdfLib.GlobalWorkerOptions.workerSrc = PDF_WORKER;
  }
  return pdfLib;
}

let zipP = null;
function zip() {
  if (!zipP) {
    zipP = new Promise((res, rej) => {
      if (window.JSZip) return res(window.JSZip);
      const s = document.createElement('script');
      s.src = JSZIP_JS;
      s.onload = () => res(window.JSZip);
      s.onerror = () => rej(new Error('Could not load the archive reader. Check your connection and try again.'));
      document.head.appendChild(s);
    });
  }
  return zipP;
}

const clean = t => t.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

async function fromPdf(file) {
  const lib = await pdf();
  const doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
  const out = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const c = await page.getTextContent();
    let line = '', txt = '';
    let lastY = null;
    for (const it of c.items) {
      const y = it.transform ? Math.round(it.transform[5]) : null;
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 4) { txt += line.trim() + '\n'; line = ''; }
      line += it.str + (it.hasEOL ? '\n' : ' ');
      lastY = y;
    }
    txt += line;
    out.push('[Page ' + p + ']\n' + clean(txt));
  }
  return { text: out.join('\n\n'), pages: doc.numPages, unit: 'pages' };
}

function xmlText(xml, tag) {
  const re = new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)</' + tag + '>', 'g');
  const parts = [];
  let m;
  while ((m = re.exec(xml))) parts.push(m[1].replace(/<[^>]+>/g, ''));
  return parts.map(s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
}

async function fromPptx(file) {
  const JSZip = await zip();
  const z = await JSZip.loadAsync(await file.arrayBuffer());
  const names = Object.keys(z.files)
    .filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => (+a.match(/\d+/)[0]) - (+b.match(/\d+/)[0]));
  if (!names.length) throw new Error('No slides found in that .pptx.');
  const notes = Object.keys(z.files).filter(n => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n));
  const out = [];
  for (let i = 0; i < names.length; i++) {
    const xml = await z.files[names[i]].async('string');
    let body = xmlText(xml, 'a:t').join('\n');
    const nn = 'ppt/notesSlides/notesSlide' + (i + 1) + '.xml';
    if (notes.indexOf(nn) >= 0) {
      const nx = await z.files[nn].async('string');
      const nt = xmlText(nx, 'a:t').join(' ').trim();
      if (nt) body += '\nNotes: ' + nt;
    }
    out.push('[Slide ' + (i + 1) + ']\n' + clean(body));
  }
  return { text: out.join('\n\n'), pages: names.length, unit: 'slides' };
}

async function fromDocx(file) {
  const JSZip = await zip();
  const z = await JSZip.loadAsync(await file.arrayBuffer());
  const f = z.files['word/document.xml'];
  if (!f) throw new Error('That .docx could not be read.');
  const xml = await f.async('string');
  const paras = xml.split(/<\/w:p>/).map(p => xmlText(p, 'w:t').join('')).filter(Boolean);
  return { text: clean(paras.join('\n')), pages: paras.length, unit: 'paragraphs' };
}

export async function extractText(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (ext === 'pdf') return fromPdf(file);
  if (ext === 'pptx') return fromPptx(file);
  if (ext === 'docx') return fromDocx(file);
  if (ext === 'txt' || ext === 'md' || ext === 'csv') {
    const t = clean(await file.text());
    return { text: t, pages: t.split(/\n\s*\n/).length, unit: 'sections' };
  }
  throw new Error('Unsupported file type “.' + ext + '”. Use a .pdf, .pptx, .docx, .txt or .md.');
}

// ---- schedule ingestion: .xlsx / .csv / .ics ----

const XLSX_JS = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
let xlsxP = null;
function xlsx() {
  if (!xlsxP) {
    xlsxP = new Promise((res, rej) => {
      if (window.XLSX) return res(window.XLSX);
      const s = document.createElement('script');
      s.src = XLSX_JS;
      s.onload = () => res(window.XLSX);
      s.onerror = () => rej(new Error('Could not load the spreadsheet reader. Check your connection and try again.'));
      document.head.appendChild(s);
    });
  }
  return xlsxP;
}

const pad2 = n => (n < 10 ? '0' : '') + n;
const isoOf = d => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());

const MONS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function parseDate(v, fallbackYear) {
  if (v == null || v === '') return '';
  if (v instanceof Date && !isNaN(v)) return isoOf(v);
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const excelDate = new Date(1899, 11, 30);
    excelDate.setDate(excelDate.getDate() + v);
    return isoOf(excelDate);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + '-' + pad2(+m[2]) + '-' + pad2(+m[3]);
  m = s.match(/^(\d{8})$/);
  if (m) return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8);
  m = s.match(/(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?/);
  if (m) {
    let y = m[3] ? +m[3] : fallbackYear;
    if (y < 100) y += 2000;
    return y + '-' + pad2(+m[1]) + '-' + pad2(+m[2]);
  }
  m = s.match(/(\d{1,2})\s*([a-z]{3,})|([a-z]{3,})\s*(\d{1,2})/i);
  if (m) {
    const day = +(m[1] || m[4]);
    const mon = MONS.indexOf(String(m[2] || m[3]).slice(0, 3).toLowerCase());
    if (mon >= 0 && day) {
      const yy = (s.match(/(20\d{2})/) || [])[1];
      return (yy ? +yy : fallbackYear) + '-' + pad2(mon + 1) + '-' + pad2(day);
    }
  }
  return '';
}

function parseTime(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date && !isNaN(v)) return pad2(v.getHours()) + pad2(v.getMinutes());
  if (typeof v === 'number' && v > 0 && v < 1) {
    const mins = Math.round(v * 24 * 60);
    return pad2(Math.floor(mins / 60)) + pad2(mins % 60);
  }
  const s = String(v).trim().toLowerCase();
  let m = s.match(/^(\d{1,2})[:.]([0-5]\d)/);
  if (m) {
    let h = +m[1];
    if (/pm/.test(s) && h < 12) h += 12;
    if (/am/.test(s) && h === 12) h = 0;
    return pad2(h) + m[2];
  }
  m = s.match(/^(\d{3,4})$/);
  if (m) return pad2(+s.slice(0, s.length - 2)) + s.slice(-2);
  m = s.match(/^(\d{1,2})\s*(am|pm)$/);
  if (m) {
    let h = +m[1];
    if (m[2] === 'pm' && h < 12) h += 12;
    if (m[2] === 'am' && h === 12) h = 0;
    return pad2(h) + '00';
  }
  return '';
}

export function kindOf(name, hint) {
  const s = ((name || '') + ' ' + (hint || '')).toLowerCase();
  if (/\b(exam|midterm|final|quiz|test|practical|assessment|osce|check[- ]?off)\b/.test(s)) return 'exam';
  if (/\b(lab|laboratory)\b|skills|simulation|\bsim\b|dissect|cadaver/.test(s)) return 'lab';
  if (/lunch|break|meal/.test(s)) return 'lunch';
  if (/admin|advis|orientation|meeting|capstone|research|eval|holiday/.test(s)) return 'admin';
  return 'lecture';
}

function pick(headers, patterns) {
  for (const p of patterns) {
    const i = headers.findIndex(h => p.test(h));
    if (i >= 0) return i;
  }
  return -1;
}

function rowsToItems(rows, fileName) {
  const year = new Date().getFullYear();
  let head = -1, headers = [];
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const cells = rows[i].map(c => String(c == null ? '' : c).trim().toLowerCase());
    if (cells.some(c => /(date|day|start|time|begin|course|class|title|event)/.test(c)) && cells.filter(Boolean).length >= 2) {
      head = i; headers = cells; break;
    }
  }
  const items = [];
  if (head >= 0) {
    const ci = {
      date: pick(headers, [/^date/, /date$/, /^day\b/, /^when/, /session date/]),
      start: pick(headers, [/^start/, /start time/, /^begin/, /^time/, /^from/]),
      end: pick(headers, [/^end/, /end time/, /^finish/, /^to$/, /^until/]),
      name: pick(headers, [/^(course|subject|title|event|activity|topic|block|lecture)(?:\s+(name|title))?$/, /^class(?:\s+(name|title|activity))?$/, /course name/, /class name/, /^name/, /^description/, /^summary/]),
      room: pick(headers, [/^(room|location|place|bldg|building|where)/, /room number/]),
      kind: pick(headers, [/^(type|kind|category|format)/]),
    };
    for (let i = head + 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || !r.length) continue;
      const name = ci.name >= 0 ? String(r[ci.name] == null ? '' : r[ci.name]).trim() : '';
      const date = ci.date >= 0 ? parseDate(r[ci.date], year) : '';
      if (!name || !date) continue;
      items.push({
        date,
        t: ci.start >= 0 ? parseTime(r[ci.start]) : '',
        end: ci.end >= 0 ? parseTime(r[ci.end]) : '',
        name: name.slice(0, 80),
        room: ci.room >= 0 ? String(r[ci.room] == null ? '' : r[ci.room]).trim().slice(0, 30) : '',
        kind: kindOf(name, ci.kind >= 0 ? r[ci.kind] : ''),
      });
    }
  }
  if (!items.length) {
    // No header row we recognise — scan every cell pair for a date + a label.
    for (const r of rows) {
      if (!r) continue;
      let date = '';
      for (const c of r) { const d = parseDate(c, year); if (d) { date = d; break; } }
      if (!date) continue;
      const label = r.map(c => String(c == null ? '' : c).trim())
        .filter(c => c && !parseDate(c, year) && !parseTime(c)).join(' · ');
      if (!label) continue;
      let t = '';
      for (const c of r) { const p = parseTime(c); if (p) { t = p; break; } }
      items.push({ date, t, end: '', name: label.slice(0, 80), room: '', kind: kindOf(label, '') });
    }
  }
  if (!items.length) {
    throw new Error('No dated rows found in ' + fileName + '. A sheet with Date / Start / Course columns imports cleanly — or add classes by hand.');
  }
  return items;
}

function unfoldIcs(text) {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
}

function fromIcs(text) {
  const items = [];
  const blocks = unfoldIcs(text).split(/BEGIN:VEVENT/).slice(1);
  for (const b of blocks) {
    const g = re => { const m = b.match(re); return m ? m[1].trim() : ''; };
    const start = g(/DTSTART[^:\n]*:([^\n]+)/);
    if (!start) continue;
    const dm = start.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/);
    if (!dm) continue;
    const end = g(/DTEND[^:\n]*:([^\n]+)/).match(/T(\d{2})(\d{2})/);
    const name = g(/SUMMARY[^:\n]*:([^\n]+)/).replace(/\\,/g, ',') || 'Class';
    items.push({
      date: dm[1] + '-' + dm[2] + '-' + dm[3],
      t: dm[4] ? dm[4] + dm[5] : '',
      end: end ? end[1] + end[2] : '',
      name: name.slice(0, 80),
      room: g(/LOCATION[^:\n]*:([^\n]+)/).replace(/\\,/g, ',').slice(0, 30),
      kind: kindOf(name, g(/CATEGORIES[^:\n]*:([^\n]+)/)),
    });
  }
  if (!items.length) throw new Error('No events found in that calendar file.');
  return items;
}

function splitCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  const t = text.replace(/\r\n/g, '\n');
  const delim = (t.split('\t').length > t.split(',').length) ? '\t' : ',';
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"' && t[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  row.push(cell);
  if (row.some(c => c !== '')) rows.push(row);
  return rows;
}

export async function extractSchedule(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (ext === 'ics') return { items: fromIcs(await file.text()), sheet: '' };
  if (ext === 'csv' || ext === 'tsv' || ext === 'txt') {
    return { items: rowsToItems(splitCsv(await file.text()), file.name), sheet: '' };
  }
  if (ext === 'xlsx' || ext === 'xls' || ext === 'xlsm') {
    const XL = await xlsx();
    const wb = XL.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
    let best = null;
    for (const nm of wb.SheetNames) {
      const rows = XL.utils.sheet_to_json(wb.Sheets[nm], { header: 1, raw: false, blankrows: false, defval: '' });
      try {
        const items = rowsToItems(rows, file.name);
        if (!best || items.length > best.items.length) best = { items, sheet: nm };
      } catch (e) { /* try the next sheet */ }
    }
    if (!best) throw new Error('No dated rows found in that workbook. A sheet with Date / Start / Course columns imports cleanly.');
    return best;
  }
  throw new Error('Unsupported schedule file “.' + ext + '”. Use .xlsx, .csv or .ics.');
}

// ---- question + model generation ----

const SYS = `You write assessment items for a physician assistant student studying from their own lecture material.
Return ONLY minified JSON, no prose, shaped exactly:
{"course":"<block name, e.g. Biochemistry>","topics":[{"name":"<short lab title>","span":"<slide or page range>","desc":"<one sentence describing an interactive model the student would operate — a sequence to order, a value to titrate, a structure to build>"}],"questions":[{"course":"<block>","q":"<stem>","options":["a","b","c","d"],"answer":<index of correct option>,"why":"<one- or two-sentence rationale that explains the mechanism>","source":"<slide or page number where the answer is supported>"}]}
Rules: 6 questions, 3 topics. Every question must be answerable from the supplied text, at PA-program difficulty — mechanism and application, not vocabulary recall. Distractors must be plausible and drawn from the same material. No question may reference "the slide" or "the lecture".`;

function firstJson(s) {
  const i = s.indexOf('{');
  const j = s.lastIndexOf('}');
  if (i < 0 || j < 0) throw new Error('bad json');
  return JSON.parse(s.slice(i, j + 1));
}

export async function makeQuestions(text, meta) {
  const body = text.length > 48000 ? text.slice(0, 48000) : text;
  if (window.claude && window.claude.complete) {
    try {
      const raw = await window.claude.complete({
        model: 'claude-sonnet-4-5',
        max_tokens: 4000,
        system: SYS,
        messages: [{ role: 'user', content: 'File: ' + meta.name + '\n\n' + body }],
      });
      const out = firstJson(raw);
      if (Array.isArray(out.questions) && out.questions.length) {
        const sources = sourceSegments(text);
        out.questions = out.questions
          .filter(q => q && q.q && Array.isArray(q.options) && q.options.length >= 2)
          .map((q, index) => ({
            course: q.course || out.course || 'From your lectures',
            q: String(q.q),
            options: q.options.slice(0, 4).map(String),
            answer: Math.max(0, Math.min(3, Number(q.answer) || 0)),
            why: String(q.why || ''),
            source: sourceForQuestion(q, sources, index),
          }));
        out.topics = (out.topics || []).slice(0, 3).map(t => ({
          name: String(t.name || 'Generated lab'),
          span: String(t.span || ''),
          desc: String(t.desc || ''),
        }));
        return { ...out, engine: 'claude' };
      }
    } catch (e) { /* fall through to heuristic */ }
  }
  return heuristic(body, meta);
}

export function buildDefinitionFlashcards(text) {
  const cards = [];
  const seen = new Set();
  const sourceText = clean(text || '');
  const patterns = [
    /^(?:\[Slide\s+\d+\]\s*)?([^\n:]{2,80})\s+(?:is|are|refers to|means|describes|denotes)\s+([^\n.]{12,220})[.]?/i,
    /^(?:\[Slide\s+\d+\]\s*)?([^\n–-]{2,80})\s*[–-]\s*([^\n.]{12,220})[.]?/i,
  ];

  sourceText.split(/\n+/).map(line => clean(line)).filter(Boolean).forEach(line => {
    patterns.some(pattern => {
      const match = line.match(pattern);
      if (!match) return false;
      const term = match[1].replace(/^[-•\d.\s]+/, '').trim();
      const definition = match[2].trim();
      const key = term.toLowerCase();
      if (term.length < 2 || definition.length < 12 || seen.has(key)) return false;
      seen.add(key);
      cards.push({ term, definition });
      return cards.length >= 24;
    });
  });

  return cards;
}

// Offline fallback: builds items from declarative sentences in the deck.
function heuristic(text, meta) {
  const stop = /^(page|slide|objectives?|outline|references?|questions?|summary|thank you)\b/i;
  const sents = text
    .split(/\n|(?<=[.;])\s+/)
    .map(s => s.replace(/^\[(page|slide)[^\]]*\]\s*/i, '').trim())
    .filter(s => s.length > 45 && s.length < 220 && !stop.test(s) && /\s(is|are|causes|results in|leads to|requires|inhibits|activates|converts)\s/i.test(s));
  const seen = new Set();
  const facts = [];
  for (const s of sents) {
    const m = s.match(/^(.{4,70}?)\s(is|are|causes|results in|leads to|requires|inhibits|activates|converts)\s(.{10,})$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const marker = text.slice(0, text.indexOf(s)).match(/\[(Slide|Page)\s+(\d+)\]/gi);
    facts.push({ term: m[1].replace(/^[-•\d.\s]+/, ''), verb: m[2].toLowerCase(), tail: m[3].replace(/[.;]$/, ''), source: marker ? sourceFromMarker(marker[marker.length - 1], s) : null });
    if (facts.length >= 8) break;
  }
  const questions = facts.slice(0, 6).map((f, i) => {
    const others = facts.filter((_, j) => j !== i).map(o => o.tail);
    const opts = [f.tail].concat(others.slice(0, 3));
    while (opts.length < 4) opts.push('None of the above');
    const order = opts.map((t, k) => ({ t, k })).sort((a, b) => ((a.k * 7 + i) % 5) - ((b.k * 7 + i) % 5));
    return {
      course: 'From your lectures',
      q: 'According to this lecture, ' + f.term + ' ' + f.verb + ' which of the following?',
      options: order.map(o => o.t.slice(0, 140)),
      answer: order.findIndex(o => o.k === 0),
      why: 'Stated directly in ' + meta.name + '. Generated offline, so check it against the source.',
      source: f.source,
    };
  });
  if (!questions.length) {
    throw new Error('Could not pull testable statements out of that file. A deck with objective slides or full-sentence notes works best.');
  }
  return {
    course: 'From your lectures',
    engine: 'offline',
    topics: facts.slice(0, 3).map((f, i) => ({
      name: f.term.slice(0, 48),
      span: 'From ' + meta.name.replace(/\.[a-z]+$/i, ''),
      desc: 'Work through ' + f.term.slice(0, 48).toLowerCase() + ' step by step and check each step against the lecture.',
    })),
    questions,
  };
}

function sourceSegments(text) {
  const matches = [...text.matchAll(/\[(Slide|Page)\s+(\d+)\]\s*([\s\S]*?)(?=\[(?:Slide|Page)\s+\d+\]|$)/gi)];
  return matches.map(match => ({
    type: match[1].toLowerCase(),
    number: Number(match[2]),
    text: clean(match[3]),
  }));
}

function sourceFromMarker(marker, text) {
  const match = String(marker || '').match(/\[(Slide|Page)\s+(\d+)\]/i);
  return match ? { type: match[1].toLowerCase(), number: Number(match[2]), text: clean(text).slice(0, 220) } : null;
}

function sourceForQuestion(question, sources, index) {
  if (!sources.length) return null;
  const requested = String(question.source || '').match(/(?:slide|page)\s*(\d+)/i);
  const source = requested
    ? sources.find(item => item.number === Number(requested[1])) || sources[0]
    : sources[index % sources.length];
  return { ...source, text: source.text.slice(0, 220) };
}
