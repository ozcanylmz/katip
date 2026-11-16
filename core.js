/* Kâtip · ortak hesaplar (sayfa ve service worker birlikte kullanır) */
(function (root) {
  'use strict';

  const pad = n => String(n).padStart(2, '0');
  const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const today = () => ymd(new Date());
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };
  const diff = (s, from) => Math.round((parse(s) - parse(from || today())) / 864e5);

  const AY = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  const AYK = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
  const GUN = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
  const GUNK = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];

  const fmt = s => { const d = parse(s); return d.getDate() + ' ' + AYK[d.getMonth()] + ' ' + GUNK[d.getDay()]; };
  const fmtLong = s => { const d = parse(s); return d.getDate() + ' ' + AY[d.getMonth()] + ' ' + d.getFullYear() + ' ' + GUN[d.getDay()]; };

  // ---- Resmî tatil ve süre hesabı ----
  // Sabit tarihli ulusal bayramlar. Dini bayramlar her yıl değiştiği için otomatik eklenmez.
  const SABIT = ['01-01', '04-23', '05-01', '05-19', '07-15', '08-30', '10-29'];
  const SABIT_AD = { '01-01': 'Yılbaşı', '04-23': '23 Nisan', '05-01': '1 Mayıs', '05-19': '19 Mayıs', '07-15': '15 Temmuz', '08-30': '30 Ağustos', '10-29': '29 Ekim' };
  function tatilMi(s) {
    const d = parse(s), md = s.slice(5);
    if (d.getDay() === 0) return 'Pazar';
    if (d.getDay() === 6) return 'Cumartesi';
    if (SABIT.includes(md)) return SABIT_AD[md];
    return null;
  }

  // start + n birim; ay ve yıl takvim günüyle (31 Ocak + 1 ay = 28/29 Şubat)
  function addPeriod(start, n, unit) {
    const d = parse(start);
    if (unit === 'gun') d.setDate(d.getDate() + n);
    else if (unit === 'hafta') d.setDate(d.getDate() + 7 * n);
    else {
      const months = unit === 'yil' ? 12 * n : n;
      const day = d.getDate();
      d.setDate(1); d.setMonth(d.getMonth() + months);
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(day, last));
    }
    return ymd(d);
  }

  // Son günü hesaplar ve her kaymanın nedenini döndürür.
  function sonGun(start, n, unit, adli) {
    if (!start || !n) return null;
    let s = addPeriod(start, n, unit);
    const notes = [];
    if (adli) {
      const y = s.slice(0, 4);
      if (s >= y + '-07-20' && s <= y + '-08-31') {
        notes.push(fmt(s) + ' adli tatile denk geldi; tatil bitiminden itibaren bir hafta uzadı');
        s = y + '-09-07';
      }
    }
    const first = s, why = tatilMi(s);
    let guard = 0;
    while (tatilMi(s) && guard++ < 10) s = addDays(s, 1);
    if (why) notes.push(fmt(first) + ' ' + (why === 'Cumartesi' || why === 'Pazar' ? 'hafta sonu' : why + ' tatili') + '; ilk iş günü ' + fmt(s));
    return { date: s, notes };
  }

  // ---- İş durumu ----
  // Süreli işte son gün esastır. Süresiz işte planlanan gün; o gün geçtiyse "en geç" tarihine bakılır.
  const keyDate = (t, from) => {
    if (t.kind !== 'suresiz') return t.due || t.plan || '';
    if (t.plan && (t.plan >= (from || today()) || !t.due)) return t.plan;
    return t.due || '';
  };
  function left(t, from) { const k = keyDate(t, from); return k ? diff(k, from) : null; }
  function urgency(t, from) {
    if (t.done) return 'done';
    const n = left(t, from);
    if (n === null) return 'none';
    if (n < 0) return 'late';
    if (n === 0) return 'today';
    if (n <= 3) return 'soon';
    if (n <= 7) return 'week';
    return 'later';
  }
  function countdown(t, from) {
    const n = left(t, from);
    if (n === null) return null;
    if (n < 0) return (-n) + ' gün geçti';
    if (n === 0) return 'Bugün';
    if (n === 1) return 'Yarın';
    return n + ' gün';
  }
  const ageDays = (t, from) => t.createdAt ? diff(from || today(), t.createdAt.slice(0, 10)) : 0;

  const DEFAULTS = { remSureli: [7, 5, 3, 1, 0], remSuresiz: [3, 1, 0], nudge: 7, hour: '08:30' };

  // Günlük bildirim içeriği: eşiğe gelen, bugün biten, geciken ve bekleyen işler.
  function digest(tasks, settings, from) {
    from = from || today();
    const st = Object.assign({}, DEFAULTS, settings || {});
    const open = tasks.filter(t => !t.done);
    const lines = [];
    let hot = 0;
    const label = t => t.what + (t.party ? ' · ' + t.party : '');
    const sorted = open.slice().sort((a, b) => (keyDate(a, from) || '9').localeCompare(keyDate(b, from) || '9'));
    for (const t of sorted) {
      const n = left(t, from);
      const rem = t.kind === 'sureli' ? st.remSureli : st.remSuresiz;
      if (n === null) {
        const a = ageDays(t, from);
        if (st.nudge && a > 0 && a % st.nudge === 0) lines.push('⏳ ' + a + ' gündür bekliyor: ' + label(t));
        continue;
      }
      if (n < 0) { hot++; lines.push('⚠️ ' + (-n) + ' gün geçti: ' + label(t)); }
      else if (n === 0) { hot++; lines.push((t.kind === 'sureli' ? '🔴 Bugün son gün: ' : '📌 Bugün: ') + label(t)); }
      else if (rem.includes(n)) { hot++; lines.push((t.kind === 'sureli' ? '⏱ ' : '• ') + n + ' gün kaldı: ' + label(t)); }
    }
    let title, body;
    if (lines.length) {
      title = hot ? hot + ' iş dikkat istiyor' : 'Bekleyen işler';
      body = lines.slice(0, 6).join('\n') + (lines.length > 6 ? '\n+' + (lines.length - 6) + ' iş daha' : '');
    } else {
      const next = sorted.find(t => left(t, from) !== null);
      title = 'Günaydın';
      body = open.length
        ? 'Bugün hatırlatılacak iş yok · ' + open.length + ' açık iş' + (next ? '\nEn yakın: ' + label(next) + ' (' + countdown(next, from) + ')' : '')
        : 'Açık işiniz yok.';
    }
    const badge = open.filter(t => { const u = urgency(t, from); return u === 'late' || u === 'today' || u === 'soon'; }).length;
    return { title, body, badge, hot };
  }

  // ---- Türkçe tarih ayıklama (dikte ve hızlı yazım için) ----
  const AY_RE = 'ocak|şubat|subat|mart|nisan|mayıs|mayis|haziran|temmuz|ağustos|agustos|eylül|eylul|ekim|kasım|kasim|aralık|aralik';
  const AY_IDX = { ocak: 0, şubat: 1, subat: 1, mart: 2, nisan: 3, mayıs: 4, mayis: 4, haziran: 5, temmuz: 6, ağustos: 7, agustos: 7, eylül: 8, eylul: 8, ekim: 9, kasım: 10, kasim: 10, aralık: 11, aralik: 11 };
  const GUN_RE = 'pazartesi|salı|sali|çarşamba|carsamba|perşembe|persembe|cumartesi|cuma|pazar';
  const GUN_IDX = { pazar: 0, pazartesi: 1, salı: 2, sali: 2, çarşamba: 3, carsamba: 3, perşembe: 4, persembe: 4, cuma: 5, cumartesi: 6 };
  const SAYI = { bir: 1, iki: 2, üç: 3, uc: 3, dört: 4, dort: 4, beş: 5, bes: 5, altı: 6, alti: 6, yedi: 7, sekiz: 8, dokuz: 9, on: 10, onbeş: 15, 'on beş': 15, yirmi: 20, otuz: 30 };
  const SUF = "(?:'?(?:[ydt]?[ae]|[ydt]?[ıiuü]n?|n[ae]|[ae] kadar|ne kadar|y[ae] kadar| kadar|ndan önce| günü| gününe| günü?ne kadar))?";

  function parseDate(text, from) {
    from = from || today();
    const s = ' ' + text.toLocaleLowerCase('tr').replace(/\s+/g, ' ') + ' ';
    const B = '(?<=[\\s,.(])', E = '(?=[\\s,.;:!?)])';
    const tries = [
      [new RegExp(B + '(bugün|bu gün)' + SUF + E), () => from],
      [new RegExp(B + '(yarın)' + SUF + E), () => addDays(from, 1)],
      [new RegExp(B + '(öbür gün|öbürgün|ertesi gün)' + SUF + E), () => addDays(from, 2)],
      [new RegExp(B + '(\\d{1,2})[./](\\d{1,2})(?:[./](\\d{2,4}))?' + E), m => {
        let y = m[3] ? +m[3] : +from.slice(0, 4); if (y < 100) y += 2000;
        let d = y + '-' + pad(+m[2]) + '-' + pad(+m[1]);
        if (!m[3] && d < from) d = (y + 1) + d.slice(4);
        return valid(d) ? d : null;
      }],
      [new RegExp(B + '(\\d{1,2}) (' + AY_RE + ")(?:'?[a-zıiüöçş]*)?(?: (\\d{4}))?" + E), m => {
        let y = m[3] ? +m[3] : +from.slice(0, 4);
        let d = y + '-' + pad(AY_IDX[m[2]] + 1) + '-' + pad(+m[1]);
        if (!m[3] && d < from) d = (y + 1) + d.slice(4);
        return valid(d) ? d : null;
      }],
      [new RegExp(B + '(\\d+|' + Object.keys(SAYI).join('|') + ') (gün|hafta|ay)(?: (?:içinde|içerisinde|sonra|sonraya|kadar))?' + E), m => {
        const n = /\d/.test(m[1]) ? +m[1] : SAYI[m[1]];
        return addPeriod(from, n, m[2] === 'gün' ? 'gun' : m[2] === 'hafta' ? 'hafta' : 'ay');
      }],
      [new RegExp(B + '(?:(haftaya|gelecek hafta|önümüzdeki hafta) )?(' + GUN_RE + ')' + SUF + E), m => {
        const want = GUN_IDX[m[2]], cur = parse(from).getDay();
        let n = (want - cur + 7) % 7; if (n === 0) n = 7;
        // "haftaya cuma": gelecek takvim haftasının (Pzt başlangıçlı) o günü
        if (m[1]) { const mon = i => (i + 6) % 7; if (mon(cur) + n <= 6) n += 7; }
        return addDays(from, n);
      }],
      [new RegExp(B + '(haftaya|gelecek hafta|önümüzdeki hafta)' + E), () => addDays(from, 7)],
      [new RegExp(B + '(ay sonu|ay sonuna|ay sonunda)' + E), () => { const d = parse(from); return ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0)); }],
    ];
    for (const [re, fn] of tries) {
      const m = s.match(re);
      if (m) { const d = fn(m); if (d) return { date: d, match: m[0].trim() }; }
    }
    return null;
  }
  function valid(s) { const d = parse(s); return !isNaN(d) && ymd(d) === s; }

  // ---- iCalendar (hatırlatmalı takvim kaydı) ----
  function ics(t, rem) {
    const day = keyDate(t); if (!day) return null;
    const esc = v => String(v || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, m => '\\' + m);
    const c = s => s.replace(/-/g, '');
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const alarms = (rem || []).map(n => {
      // Tüm gün etkinliği 00:00'da başlar; hatırlatma o günün 09:00'ında
      const trig = n === 0 ? 'PT9H' : n === 1 ? '-PT15H' : '-P' + (n - 1) + 'DT15H';
      const desc = n === 0 ? 'Bugün: ' + t.what : n + ' gün kaldı: ' + t.what;
      return ['BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:' + trig, 'DESCRIPTION:' + esc(desc), 'END:VALARM'].join('\r\n');
    });
    const title = (t.kind === 'sureli' ? 'SON GÜN: ' : '') + t.what + (t.party ? ' (' + t.party + ')' : '');
    const details = [t.party && 'Taraf: ' + t.party, t.no && 'Dosya: ' + t.no, t.note].filter(Boolean).join('\n');
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Katip//TR', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
      'UID:' + t.id + '@katip', 'DTSTAMP:' + stamp, 'DTSTART;VALUE=DATE:' + c(day), 'DTEND;VALUE=DATE:' + c(addDays(day, 1)),
      'SUMMARY:' + esc(title), details ? 'DESCRIPTION:' + esc(details) : null, ...alarms, 'END:VEVENT', 'END:VCALENDAR']
      .filter(Boolean).join('\r\n');
  }

  root.Katip = { pad, ymd, parse, today, addDays, diff, fmt, fmtLong, AY, AYK, GUN, GUNK, tatilMi, addPeriod, sonGun,
    keyDate, left, urgency, countdown, ageDays, DEFAULTS, digest, parseDate, ics };
})(typeof self !== 'undefined' ? self : this);
