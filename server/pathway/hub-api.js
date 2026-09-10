// PA-thway — Student Hub data layer.
//
// One interface, two drivers:
//   • supabase — a real shared board: everyone with the cohort code sees the same
//     notes, comments, likes, challenges and standings, on any phone or network.
//   • local — the same API backed by this device's storage, used when no keys are
//     configured. Shares between windows on one device via BroadcastChannel.
//
// The app never knows which driver it got. Everything below returns plain data in
// one shape, so the UI is identical either way.

const CFG = (typeof window !== 'undefined' && window.PATHWAY_CONFIG) || {};
const POLL_MS = CFG.POLL_MS || 5000;

const DEVICE_STORE = 'pathway.device.key';
export function deviceKey() {
  try {
    let k = window.localStorage.getItem(DEVICE_STORE);
    if (!k) {
      k = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      window.localStorage.setItem(DEVICE_STORE, k);
    }
    return k;
  } catch (e) {
    // Private mode: a per-session identity is still better than none.
    if (!window.__pathwayKey) window.__pathwayKey = 'd' + Math.random().toString(36).slice(2, 12);
    return window.__pathwayKey;
  }
}

const initials = name => {
  const n = (name || '').trim();
  if (!n) return 'PA';
  return n.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
};

// Points are derived, never stored: 10 a correct answer, 25 a duel won.
function tally(members, scores, challenges) {
  return members.map(m => {
    const mine = scores.filter(s => s.member_key === m.device_key);
    const correct = mine.reduce((a, s) => a + (s.score || 0), 0);
    const answered = mine.reduce((a, s) => a + (s.total || 0), 0);
    const won = challenges.filter(c => c.to_key === m.device_key && c.status === 'answered' && c.correct).length;
    return {
      key: m.device_key, name: m.name, emoji: m.emoji, initials: initials(m.name),
      points: correct * 10 + won * 25, correct, answered, duelsWon: won,
      lastSeen: m.last_seen,
    };
  }).sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
}

function stitch(raw) {
  const likesFor = id => raw.likes.filter(l => l.target_id === id);
  const notes = raw.notes.filter(n => !n.hidden).map(n => {
    const ls = likesFor(n.id);
    return {
      id: n.id, authorKey: n.author_key, author: n.author_name, initials: initials(n.author_name),
      title: n.title, course: n.course, body: n.body, file: n.file || '',
      questions: Array.isArray(n.questions) ? n.questions : [],
      ts: new Date(n.created_at).getTime(),
      edited: !!n.edited_at,
      likes: ls.length,
      likedByMe: ls.some(l => l.member_key === raw.me),
      comments: raw.comments.filter(c => c.note_id === n.id && !c.hidden)
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
        .map(c => {
          const cl = likesFor(c.id);
          return {
            id: c.id, authorKey: c.author_key, author: c.author_name, initials: initials(c.author_name),
            text: c.body, ts: new Date(c.created_at).getTime(),
            likes: cl.length, likedByMe: cl.some(l => l.member_key === raw.me),
          };
        }),
    };
  }).sort((a, b) => b.ts - a.ts);

  return {
    code: raw.code,
    ownerKey: raw.ownerKey,
    isOwner: raw.ownerKey === raw.me,
    me: raw.me,
    notes,
    members: raw.members.map(m => ({
      key: m.device_key, name: m.name, emoji: m.emoji, initials: initials(m.name),
      year: m.year || '', lastSeen: m.last_seen,
    })),
    board: tally(raw.members, raw.scores, raw.challenges),
    challenges: raw.challenges.map(c => ({
      id: c.id, fromKey: c.from_key, from: c.from_name, fromEmoji: c.from_emoji,
      toKey: c.to_key, to: c.to_name, block: c.block,
      question: c.question || {}, stake: c.stake, message: c.message,
      status: c.status, correct: c.correct,
      replyEmoji: c.reply_emoji, replyMessage: c.reply_message,
      ts: new Date(c.created_at).getTime(),
    })).sort((a, b) => b.ts - a.ts),
    notifs: raw.notifs.filter(n => n.member_key === raw.me)
      .map(n => ({ id: n.id, kind: n.kind, actor: n.actor_name, actorEmoji: n.actor_emoji,
        noteId: n.note_id, body: n.body, read: n.read, ts: new Date(n.created_at).getTime() }))
      .sort((a, b) => b.ts - a.ts),
  };
}

// ------------------------------------------------------------------ server
//
// Talks to server/hub.py in this repo. Every write returns the whole fresh
// snapshot, so the UI never has to reconcile a local guess against the server.

function serverDriver(base) {
  const me = deviceKey();
  const root = (base || '').replace(/\/+$/, '') + '/api/hub';

  const req = async (path, opts) => {
    const r = await fetch(root + path, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        'X-Device-Key': me,
        ...((opts || {}).headers || {}),
      },
    });
    const text = await r.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { /* not JSON */ }
    if (!r.ok) throw new Error((data && data.error) || ('Hub request failed (' + r.status + ').'));
    return data;
  };
  const send = (path, body, method) => req(path, {
    method: method || 'POST',
    body: JSON.stringify(body || {}),
  });

  return {
    live: true,
    me,

    join: (code, profile) => send('/join', { code, profile }),
    snapshot: code => req('/snapshot/' + encodeURIComponent(code)),
    touch: code => req('/snapshot/' + encodeURIComponent(code)),

    postNote: (code, n) => send('/' + code + '/notes', n),
    editNote: (code, id, p) => send('/' + code + '/notes/' + id, p, 'PATCH'),
    deleteNote: (code, id) => req('/' + code + '/notes/' + id, { method: 'DELETE' }),
    hideNote: (code, id) => send('/' + code + '/hide', { targetId: id, kind: 'note' }),

    postComment: (code, noteId, c) => send('/' + code + '/notes/' + noteId + '/comments', c),
    deleteComment: (code, id) => req('/' + code + '/comments/' + id, { method: 'DELETE' }),
    hideComment: (code, id) => send('/' + code + '/hide', { targetId: id, kind: 'comment' }),

    // One endpoint toggles: like if you have not, unlike if you have.
    toggleLike: (code, targetId, kind, actor) => send('/' + code + '/like', { targetId, kind, actor }),

    sendChallenge: (code, ch) => send('/' + code + '/challenges', ch),
    answerChallenge: (code, id, a) => send('/' + code + '/challenges/' + id, a, 'PATCH'),

    recordScore: (code, s) => send('/' + code + '/scores', s),
    report: (code, targetId, kind, reason) => send('/' + code + '/report', { targetId, kind, reason }),
    markRead: code => send('/' + code + '/read', {}),
  };
}

// ------------------------------------------------------------------ local

function localDriver() {
  const me = deviceKey();
  const key = code => 'pathway.hub.' + code;
  const load = code => {
    try {
      const d = JSON.parse(window.localStorage.getItem(key(code)) || 'null');
      if (d && d.cohorts) return d;
    } catch (e) { /* corrupt or absent */ }
    return { cohorts: [], members: [], notes: [], comments: [], likes: [], challenges: [], scores: [], notifs: [] };
  };
  const save = (code, d) => {
    try { window.localStorage.setItem(key(code), JSON.stringify(d)); } catch (e) { /* quota */ }
    try { if (localDriver._bc) localDriver._bc.postMessage({ code }); } catch (e) { /* closed */ }
  };
  const edit = (code, fn) => { const d = load(code); fn(d); save(code, d); return Promise.resolve(); };
  const uid = () => 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const now = () => new Date().toISOString();

  try { if (!localDriver._bc) localDriver._bc = new BroadcastChannel('pathway.hub'); } catch (e) { /* older browser */ }

  return {
    live: false,
    me,

    join(code, profile) {
      const d = load(code);
      if (!d.cohorts.length) d.cohorts.push({ code, name: profile.klass || '', owner_key: me, created_at: now() });
      const m = d.members.find(x => x.device_key === me);
      const row = { cohort: code, device_key: me, name: profile.name || 'Anonymous',
        emoji: profile.emoji || '', year: profile.year || '', last_seen: now() };
      if (m) Object.assign(m, row); else d.members.push(row);
      save(code, d);
      return Promise.resolve({ ownerKey: d.cohorts[0].owner_key });
    },
    touch(code, profile) { return this.join(code, profile).then(() => undefined); },

    snapshot(code) {
      const d = load(code);
      if (!d.cohorts.length) return Promise.reject(new Error('No cohort found for ' + code + '.'));
      return Promise.resolve(stitch({ code, me, ownerKey: d.cohorts[0].owner_key, ...d }));
    },

    postNote: (code, n) => edit(code, d => d.notes.unshift({
      id: uid(), cohort: code, author_key: me, author_name: n.author, title: n.title,
      course: n.course, body: n.body, file: n.file || '', questions: n.questions || [],
      hidden: false, edited_at: null, created_at: now(),
    })),
    editNote: (id, p) => {
      const codes = Object.keys(window.localStorage).filter(k => k.indexOf('pathway.hub.') === 0);
      codes.forEach(k => {
        const code = k.slice(12);
        edit(code, d => { const n = d.notes.find(x => x.id === id); if (n) Object.assign(n, p, { edited_at: now() }); });
      });
      return Promise.resolve();
    },
    deleteNote(id) { return this._drop('notes', id); },
    hideNote(id) { return this.editNote(id, { hidden: true }); },

    postComment: (code, noteId, c) => edit(code, d => d.comments.push({
      id: uid(), cohort: code, note_id: noteId, author_key: me,
      author_name: c.author, body: c.text, hidden: false, created_at: now(),
    })),
    deleteComment(id) { return this._drop('comments', id); },
    hideComment(id) { return this._drop('comments', id); },

    like: (code, targetId, kind) => edit(code, d => {
      if (!d.likes.some(l => l.target_id === targetId && l.member_key === me)) {
        d.likes.push({ cohort: code, target_id: targetId, target_kind: kind, member_key: me, created_at: now() });
      }
    }),
    unlike(targetId) {
      return this._each(code => edit(code, d => {
        d.likes = d.likes.filter(l => !(l.target_id === targetId && l.member_key === me));
      }));
    },

    sendChallenge: (code, ch) => edit(code, d => d.challenges.unshift({
      id: uid(), cohort: code, from_key: me, from_name: ch.from, from_emoji: ch.fromEmoji || '',
      to_key: ch.toKey, to_name: ch.to, block: ch.block, question: ch.question || {},
      stake: ch.stake || '', message: ch.message || '', status: 'sent', correct: null,
      reply_emoji: '', reply_message: '', note_id: ch.noteId || null, created_at: now(),
    })),
    answerChallenge(id, a) {
      return this._each(code => edit(code, d => {
        const c = d.challenges.find(x => x.id === id);
        if (c) Object.assign(c, { status: 'answered', correct: !!a.correct,
          reply_emoji: a.emoji || '', reply_message: a.message || '', answered_at: now() });
      }));
    },

    recordScore: (code, s) => edit(code, d => d.scores.push({
      id: uid(), cohort: code, member_key: me, member_name: s.name || 'Anonymous',
      label: s.label || 'Quiz', score: s.score || 0, total: s.total || 0, created_at: now(),
    })),

    report: (code, targetId, kind, reason) => edit(code, d => d.reports = (d.reports || []).concat([
      { id: uid(), target_id: targetId, target_kind: kind, reporter_key: me, reason: reason || '', created_at: now() },
    ])),

    notify: (code, memberKey, n) => {
      if (!memberKey || memberKey === me) return Promise.resolve();
      return edit(code, d => d.notifs.unshift({
        id: uid(), cohort: code, member_key: memberKey, kind: n.kind,
        actor_name: n.actor || '', actor_emoji: n.actorEmoji || '',
        note_id: n.noteId || null, body: n.body || '', read: false, created_at: now(),
      }));
    },
    markRead: code => edit(code, d => d.notifs.forEach(n => { if (n.member_key === me) n.read = true; })),

    _each(fn) {
      const codes = Object.keys(window.localStorage)
        .filter(k => k.indexOf('pathway.hub.') === 0).map(k => k.slice(12));
      return Promise.all(codes.map(fn)).then(() => undefined);
    },
    _drop(table, id) {
      return this._each(code => edit(code, d => { d[table] = d[table].filter(r => r.id !== id); }));
    },
  };
}

// ------------------------------------------------------------------ factory

export function createHub() {
  const driver = serverDriver((CFG.API_BASE || '').trim());
  const fallback = localDriver();

  // If the server is unreachable — offline, or an export opened straight off the
  // filesystem — the Hub silently drops to on-device mode rather than breaking.
  // Everything the student does still works; it just is not shared.
  driver.probe = async function () {
    try {
      const r = await fetch(((CFG.API_BASE || '').replace(/\/+$/, '')) + '/api/hub/health');
      return r.ok;
    } catch (e) { return false; }
  };

  // One facade over both drivers. Calls go to the server; if the server is not
  // there, the same call is served from this device instead. The app above never
  // learns which one answered — it just gets a snapshot.
  const api = { me: driver.me, live: true, mode: 'server' };

  let active = driver;
  const demote = why => {
    if (active === driver) {
      active = fallback;
      api.live = false;
      api.mode = 'device';
      api.reason = why || 'The Hub server is not reachable.';
      if (api.onModeChange) api.onModeChange('device', api.reason);
    }
  };

  const METHODS = [
    'join', 'snapshot', 'touch', 'postNote', 'editNote', 'deleteNote', 'hideNote',
    'postComment', 'deleteComment', 'hideComment', 'toggleLike', 'sendChallenge',
    'answerChallenge', 'recordScore', 'report', 'markRead',
  ];
  METHODS.forEach(name => {
    api[name] = async function (...args) {
      try {
        return await active[name](...args);
      } catch (e) {
        // A 4xx is the server answering — a real error, and it should surface.
        // A network failure means the server is not reachable at all.
        const msg = String((e && e.message) || e);
        const offline = /Failed to fetch|NetworkError|Load failed|network|failed \((404|405|5\d\d)\)/i.test(msg);
        if (active === driver && offline) {
          demote(/404|405/.test(msg)
            ? 'The Hub is not deployed on the server yet.'
            : 'The Hub server is not reachable.');
          return active[name](...args);
        }
        throw e;
      }
    };
  });

  // Polling is the sync mechanism: a class-sized board is a handful of small
  // reads, and it degrades gracefully on a phone that drops off the network.
  // Writes return a fresh snapshot, so your own actions never wait for a tick.
  api.watch = function (code, onData, onError) {
    let stop = false, timer = null, bc = null;
    const pull = async () => {
      if (stop) return;
      try { onData(await api.snapshot(code)); }
      catch (e) { if (onError) onError(e); }
      if (!stop) timer = setTimeout(pull, POLL_MS);
    };
    pull();
    // On-device mode has no server to poll, so windows tell each other directly.
    try {
      bc = new BroadcastChannel('pathway.hub');
      bc.onmessage = e => { if (!api.live && (!e.data || e.data.code === code)) pull(); };
    } catch (e) { /* older browser */ }
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
      try { if (bc) bc.close(); } catch (e) { /* closed */ }
    };
  };
  api.refresh = code => api.snapshot(code);
  return api;
}
