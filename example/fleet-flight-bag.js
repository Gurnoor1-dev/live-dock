/**
 * assets/js/fleet-flight-bag.js — the Fleet Mode "Flight bag" tab.
 * ---------------------------------------------------------------------------
 * Every leg the signed-in pilot is crewed on, in the order they will get to
 * fly it (orderBag), each with the same Dispatch -> SimBrief -> OFP loop career mode's
 * Dispatch page has (assets/js/dashboard-dispatch.js): a leg row, a "Crew
 * brief" panel that opens only on click, an OCC document printer, and the crew
 * boarding pass.
 *
 * What lives here, and what does not
 *   Here:       the ordering rule (orderBag), the boarding pass, the printer,
 *               and the markup for the whole tab (render). The functions that
 *               decide something are PURE, so tests/calc/fleetFlightBag.test.js
 *               runs this file in a bare `vm` context the way the dispatch form
 *               tests do. Only hydrate() and the printer's painter touch the DOM.
 *   NOT here:   the click handling, the SimBrief popup and the dispatch itself.
 *               The popup has to be claimed SYNCHRONOUSLY in the click handler
 *               (Safari honours window.open only while it is on the gesture's
 *               call stack — fleet-mode.js:284), so that one handler stays in
 *               fleet-mode-home.js and serves BOTH the flight dialog's button
 *               and this tab's. This file only renders the buttons and carries
 *               the data-* attributes that handler reads.
 *
 * Isolation (CLAUDE.md, Fleet Mode): no Firebase, no career collections, and
 * nothing is written anywhere. The two public routes it reads — /api/weather
 * and /api/realAtis — take no token. The only storage is a per-viewer
 * convenience (which briefs are open); the remembered OFP ids are written by
 * ofp-viewer.html and READ by fleet-mode-home.js via parseOfps().
 *
 * Contract with fleet-mode-home.js: render(ctx) takes plain VIEW ROWS (strings
 * and booleans, built there from model()) and returns HTML. It never sees a
 * leg object, so a change to model() cannot reach in here.
 */
(function () {
  'use strict';

  var H = 3600000;
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MON_UP = MON.map(function (m) { return m.toUpperCase(); });

  function esc(s) {
    return window.INVA_ESC.html(s);
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function isNum(n) { return typeof n === 'number' && isFinite(n); }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  // ── order ────────────────────────────────────────────────────────────────

  /** A row's index on its aircraft: IF `sequence`, else null. */
  function seqOf(r) {
    return r.seq != null && isFinite(Number(r.seq)) ? Number(r.seq) : null;
  }

  /** How many open legs that are not the pilot's fly before this one on its
   *  tail (fleet-mode-home.js bagRows). Missing or junk counts as none. */
  function aheadOf(r) {
    var a = Number(r.ahead);
    return isFinite(a) && a > 0 ? a : 0;
  }

  /**
   * The pilot's legs in the order they will get to fly them (owner,
   * 2026-10-12): first the legs nothing else stands in front of, then the
   * legs that wait behind other pilots' (or unassigned) legs on the same tail,
   * fewest waiting first — `ahead`. Legs with the same `ahead` are grouped by
   * registration, and inside a tail by the leg's index on it — IF `sequence`,
   * then `n`, its place in the tail's list. `ahead` never falls along a tail's
   * sequence, so a tail's own order always survives.
   * rows: [{ id, reg?, seq?, n?, ahead? }], id = schedule id. A leg listed
   * twice appears once. Returns NEW objects; never throws.
   */
  function orderBag(rows) {
    var seen = {};
    var out = [];
    (Array.isArray(rows) ? rows : []).forEach(function (r, i) {
      if (!r) return;
      var id = String(r.id == null ? '' : r.id);
      if (id) {
        if (has(seen, id)) return;
        seen[id] = true;
      }
      out.push(Object.assign({}, r, { _i: i }));
    });
    out.sort(function (p, q) {
      var ap = aheadOf(p), aq = aheadOf(q);
      if (ap !== aq) return ap - aq;
      var rp = String(p.reg || ''), rq = String(q.reg || '');
      if (rp !== rq) return rp < rq ? -1 : 1;
      var sp = seqOf(p), sq = seqOf(q);
      if (sp != null && sq != null && sp !== sq) return sp - sq;
      if ((sp != null) !== (sq != null)) return sp != null ? -1 : 1;
      return (p.n || 0) - (q.n || 0) || p._i - q._i;
    });
    out.forEach(function (r) { delete r._i; });
    return out;
  }

  // ── what changed between two answers ────────────────────────────────────

  /** The slack on the first answer's window: an approval made just before the
   *  fleet was read may or may not be in that read (the read and the approval
   *  race), so anything inside a minute of it is refreshed to be safe. */
  var FIRST_FETCH_SLACK_MS = 60000;

  /** A `legs` list -> { list, by } with one entry per scheduleId (first one
   *  wins), `approvedAt` a number or null, entries without a schedule dropped. */
  function indexApprovals(list) {
    var out = { list: [], by: {} };
    if (!Array.isArray(list)) return out;
    list.forEach(function (l) {
      if (!l || l.scheduleId == null || l.scheduleId === '') return;
      var id = String(l.scheduleId);
      if (has(out.by, id)) return;
      var t = Number(l.approvedAt);
      var e = {
        scheduleId: id,
        aircraftId: l.aircraftId ? String(l.aircraftId) : null,
        approvedAt: isFinite(t) && t > 0 ? t : null,
      };
      out.by[id] = e;
      out.list.push(e);
    });
    return out;
  }

  /**
   * Which approvals appeared or went away between two /api/fleetPilotFlightBag
   * answers, and which tails' schedules therefore need re-reading.
   *
   * prev        the earlier `legs`, or null/undefined when there is none yet
   *             (the FIRST answer of this session)
   * next        the new `legs`
   * fullLoadAt  ms the last FULL fleet read finished. Only used when `prev` is
   *             missing: with nothing to compare, an approval newer than that
   *             read (less FIRST_FETCH_SLACK_MS) is treated as added, because
   *             the fleet the board holds cannot contain it. 0/unknown means no
   *             fleet has been read yet, so the read still to come will have it
   *             and nothing is added.
   *
   * added    in `next` and not in `prev` — or there with a different approval
   *          time, which is a removal followed by a fresh approval
   * removed  in `prev` and not in `next`
   * tails    the aircraft ids of both, once each, added legs first
   * blind    an added/removed approval names no aircraft, so the caller cannot
   *          pick the tail to re-read and has to re-read the fleet
   *
   * Pure; never throws; entries are { scheduleId, aircraftId, approvedAt }.
   */
  function diffApprovals(prev, next, fullLoadAt) {
    var out = { added: [], removed: [], tails: [], blind: false };
    var now = indexApprovals(next);
    if (Array.isArray(prev)) {
      var was = indexApprovals(prev);
      now.list.forEach(function (e) {
        var o = has(was.by, e.scheduleId) ? was.by[e.scheduleId] : null;
        if (!o || o.approvedAt !== e.approvedAt) out.added.push(e);
      });
      was.list.forEach(function (e) {
        if (!has(now.by, e.scheduleId)) out.removed.push(e);
      });
    } else if (isNum(fullLoadAt) && fullLoadAt > 0) {
      var since = fullLoadAt - FIRST_FETCH_SLACK_MS;
      now.list.forEach(function (e) {
        if (e.approvedAt != null && e.approvedAt > since) out.added.push(e);
      });
    }
    var seen = {};
    out.added.concat(out.removed).forEach(function (e) {
      if (!e.aircraftId) { out.blind = true; return; }
      if (has(seen, e.aircraftId)) return;
      seen[e.aircraftId] = true;
      out.tails.push(e.aircraftId);
    });
    return out;
  }

  // ── remembered OFPs ──────────────────────────────────────────────────────

  var OFP_ID_RE = /^[0-9]{10}_[A-Za-z0-9]{10}$/;

  /**
   * localStorage `invaFleetOfps` -> { scheduleId: { ofpId, at } }.
   * Written by ofp-viewer.html. Anything that is not a well-formed SimBrief
   * OFP id is dropped, so a corrupt or hand-edited value can never become a
   * "View OFP" link.
   */
  function parseOfps(raw) {
    var out = {};
    var obj = raw;
    if (typeof raw === 'string') {
      try { obj = JSON.parse(raw); } catch (e) { return out; }
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
    Object.keys(obj).forEach(function (k) {
      var v = obj[k];
      if (!v || typeof v.ofpId !== 'string' || !OFP_ID_RE.test(v.ofpId)) return;
      var at = Number(v.at);
      out[k] = { ofpId: v.ofpId, at: isFinite(at) ? at : 0 };
    });
    return out;
  }

  // ── crew boarding pass ───────────────────────────────────────────────────
  // Ported from dashboard-dispatch.js (flightPassModel / boardingPassHtml).
  // Paper stays paper in both themes.

  /** A small deterministic hash so a seat does not reshuffle on every render. */
  function hashNum(str, mod) {
    var h = 0, s = String(str);
    for (var i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return Math.abs(h) % mod;
  }

  /** Seat from the leg id — the same leg is always the same seat. `fam` is
   *  fleet-mode-home.js's family(): Wide-body | Narrow-body | Turboprop. */
  function assignSeat(fam, seed) {
    var maxRow, seats;
    if (fam === 'Turboprop') { maxRow = 18; seats = ['A', 'B', 'C', 'D']; }
    else if (fam === 'Wide-body') { maxRow = 45; seats = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K']; }
    else { maxRow = 30; seats = ['A', 'B', 'C', 'D', 'E', 'F']; }
    var pick = function (mod) { return hashNum(seed + ':' + mod, mod); };
    return (pick(maxRow - 9) + 10) + seats[pick(seats.length)];
  }

  /** "09 OCT 2026" — IST, like every time on this page. */
  function passDate(ms) {
    var d = new Date((isNum(ms) ? ms : Date.now()) + 5.5 * H);
    return pad(d.getUTCDate()) + ' ' + MON_UP[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }

  /**
   * o: { flight, from, to, fromCity, toCity, aircraft, fam, tail, legId,
   *      name, dateMs, nm }
   */
  function passModel(o) {
    o = o || {};
    var flight = o.flight || '—';
    var seat = assignSeat(o.fam, String(o.legId || flight));
    var date = passDate(o.dateMs);
    var name = String(o.name || 'PILOT');
    var tail = o.tail && o.tail !== '—' ? o.tail : '—';
    var aircraft = o.aircraft || '—';
    return {
      badge: o.fam === 'Wide-body' ? 'BUSINESS' : 'ECONOMY',
      seat: seat,
      from: o.from || '',
      fromCity: String(o.fromCity || 'DEPARTURE').toUpperCase(),
      to: o.to || '',
      toCity: String(o.toCity || 'ARRIVAL').toUpperCase(),
      dist: isNum(o.nm) && o.nm > 0 ? o.nm.toLocaleString('en-US') + ' NM' : '— NM',
      d: [
        { l: 'FLIGHT', v: flight }, { l: 'DATE', v: date }, { l: 'AIRCRAFT', v: aircraft },
        { l: 'TAIL', v: tail }, { l: 'SEAT', v: seat },
      ],
      name: name,
      seq: 'SEQ ' + (hashNum(String(o.legId || flight), 90) + 10),
      note: 'SIMULATED PASSENGER MANIFEST — NOT A REAL DOCUMENT',
      stub: [{ l: 'FLIGHT', v: flight }, { l: 'DATE', v: date }, { l: 'SEAT', v: seat }],
    };
  }

  function boardingPassHtml(p) {
    var cells = p.d.map(function (it) {
      return '<div class="fh-bag-bp-cell"><div class="fh-bag-bp-k">' + esc(it.l) + '</div>' +
        '<div class="fh-bag-bp-v">' + esc(it.v) + '</div></div>';
    }).join('');
    var stub = p.stub.map(function (s) {
      return '<div class="fh-bag-bp-srow"><span class="fh-bag-bp-k">' + esc(s.l) + '</span>' +
        '<span class="fh-bag-bp-sv">' + esc(s.v) + '</span></div>';
    }).join('');
    return '<div class="fh-bag-bp">' +
      '<span class="fh-bag-bp-notch fh-bag-bp-notch-t" aria-hidden="true"></span>' +
      '<span class="fh-bag-bp-notch fh-bag-bp-notch-b" aria-hidden="true"></span>' +
      '<div class="fh-bag-bp-main">' +
        '<div class="fh-bag-bp-top"><span class="fh-bag-bp-brand">INVA</span>' +
          '<span class="fh-bag-bp-kind">BOARDING PASS</span>' +
          '<span class="fh-bag-bp-badge">' + esc(p.badge) + '</span></div>' +
        '<div class="fh-bag-bp-route">' +
          '<div class="fh-bag-bp-ap"><div class="fh-bag-bp-icao">' + esc(p.from) + '</div>' +
            '<div class="fh-bag-bp-city">' + esc(p.fromCity) + '</div></div>' +
          '<div class="fh-bag-bp-mid"><span class="fh-bag-bp-plane" aria-hidden="true">✈</span>' +
            '<span class="fh-bag-bp-line"></span><span class="fh-bag-bp-dist">' + esc(p.dist) + '</span></div>' +
          '<div class="fh-bag-bp-ap"><div class="fh-bag-bp-icao">' + esc(p.to) + '</div>' +
            '<div class="fh-bag-bp-city">' + esc(p.toCity) + '</div></div>' +
        '</div>' +
        '<div class="fh-bag-bp-grid">' + cells + '</div>' +
        '<div class="fh-bag-bp-pax"><span class="fh-bag-bp-name">' + esc(p.name) + '</span>' +
          '<span class="fh-bag-bp-seq">' + esc(p.seq) + '</span></div>' +
        '<div class="fh-bag-bp-note">' + esc(p.note) + '</div>' +
      '</div>' +
      '<div class="fh-bag-bp-stub">' +
        '<div class="fh-bag-bp-brand fh-bag-bp-brand-sm">INVA</div>' +
        '<div class="fh-bag-bp-sroute">' + esc(p.from) + '<span>→</span>' + esc(p.to) + '</div>' +
        '<div class="fh-bag-bp-srows">' + stub + '</div>' +
        '<div class="fh-bag-bp-barcode" aria-hidden="true"></div>' +
        '<div class="fh-bag-bp-sname">' + esc(p.name) + '</div>' +
      '</div>' +
    '</div>';
  }

  // ── OCC document printer ─────────────────────────────────────────────────
  // Career's printer has five slips; two of them (WX, real-world ATIS) read
  // public weather routes, and the other three read Infinite Flight's
  // expert-server feed, which this page does not need. Read-only: nothing
  // printed here feeds pay, bonuses or any record.

  var PRINT_KINDS = [
    ['wx', 'WX', 'Weather / METAR'],
    ['realatis', 'REAL ATIS', 'Real-world ATIS (FAA D-ATIS / live METAR)'],
  ];

  /** METAR -> an ATIS-style broadcast. The fallback for REAL ATIS when
   *  /api/realAtis cannot be reached; labelled WX-DERIVED on the slip. */
  function metarToAtis(icao, raw, now) {
    var m = String(raw || '');
    var time = (m.match(/\b\d{2}(\d{4})Z\b/) || [])[1];
    var hour = time ? parseInt(time.slice(0, 2), 10) : new Date(isNum(now) ? now : Date.now()).getUTCHours();
    var letter = String.fromCharCode(65 + (hour % 26));
    var wind = m.match(/\b(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?KT\b/);
    var vis = m.match(/\s(\d{4})\s/);
    var tmp = m.match(/\s(M?\d{2})\/(M?\d{2})\s/);
    var qnh = m.match(/\bQ(\d{4})\b/) || m.match(/\bA(\d{4})\b/);
    var parts = [icao + ' ATIS INFO ' + letter + (time ? ' ' + time + 'Z' : '') + '.'];
    if (wind) parts.push('WIND ' + wind[1] + '/' + wind[2] + (wind[3] ? ' GUST ' + wind[3] : '') + 'KT.');
    if (vis) parts.push('VIS ' + vis[1] + 'M.');
    if (tmp) parts.push('TEMP ' + tmp[1].replace('M', '-') + ' DEW ' + tmp[2].replace('M', '-') + '.');
    if (qnh) parts.push((qnh[0].charAt(0) === 'Q' ? 'QNH' : 'ALTIMETER') + ' ' + qnh[1] + '.');
    parts.push('ACKNOWLEDGE INFO ' + letter + '.');
    return { letter: letter, text: parts.join(' ') };
  }

  /** A slip as lines: { segs: [{ t, b }] } or { rule: true }. Pure — the
   *  fetched weather comes in as `o`:
   *    kind  'wx' | 'realatis'
   *    dep, arr   ICAO
   *    wx    { ICAO: /api/weather body | null }
   *    atis  /api/realAtis body | null
   *    who   the requester
   *    now   ms
   */
  function slipLines(kind, o) {
    var T = function () {
      var segs = [];
      for (var i = 0; i < arguments.length; i++) {
        var p = arguments[i];
        segs.push(Array.isArray(p) ? { t: p[0], b: true } : { t: p, b: false });
      }
      return { segs: segs };
    };
    var R = { rule: true };
    var L = [];
    var dep = o.dep, arr = o.arr;
    var airports = [dep, arr].filter(Boolean);
    var atis = o.atis;
    var wx = o.wx || {};

    if (kind === 'realatis' && atis) {
      L.push(T(['INVA OCC — REAL-WORLD ATIS']), R);
      [['dep', dep], ['arr', arr]].forEach(function (pair) {
        var k = pair[0], icao = pair[1];
        if (!icao) return;
        var ap = atis[k];
        if (!ap || !ap.available || !Array.isArray(ap.reports) || ap.reports.length === 0) {
          L.push(T('ATIS ' + icao + ' — NIL (NO SOURCE)'), R);
          return;
        }
        var tag = ap.source === 'datis' ? 'D-ATIS' : 'WX-DERIVED';
        ap.reports.forEach(function (rep) {
          var ty = rep.type && rep.type !== 'combined' ? ' ' + String(rep.type).toUpperCase() : '';
          var info = rep.code ? ' INFO ' + rep.code : '';
          L.push(T([icao], ty + info + ' · ' + tag));
          String(rep.text || '').split(/\n+/).filter(Boolean).forEach(function (seg) { L.push(T(seg)); });
        });
        L.push(R);
      });
    } else {
      L.push(T([kind === 'wx' ? 'INVA OCC — WX / METAR' : 'INVA OCC — REAL-WORLD ATIS']), R);
      airports.forEach(function (icao) {
        var w = wx[icao];
        if (!w || !w.available || !w.raw) { L.push(T('METAR ' + icao + ' — NOT AVAILABLE'), R); return; }
        if (kind === 'wx') {
          var p = w.parsed || {};
          var wind = (p.wind_kts || 0) + (p.gust_kts ? 'G' + p.gust_kts : '') + 'KT';
          L.push(
            T(String(w.raw).indexOf('METAR') === 0 ? w.raw : 'METAR ' + w.raw),
            T(' CAT ', [p.category || '—'], ' · WIND ' + wind),
            R
          );
        } else {
          var a = metarToAtis(icao, w.raw, o.now);
          L.push(T([icao], ' INFO ' + a.letter + ' · WX-DERIVED'), T(a.text), R);
        }
      });
    }
    var d = new Date((isNum(o.now) ? o.now : Date.now()) + 5.5 * H);
    L.push(T('REQ BY ' + (o.who || 'INVA') + ' · ' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + ' IST'));
    return L;
  }

  var _wxCache = {};
  function fetchWx(icao) {
    if (!icao) return Promise.resolve(null);
    var hit = _wxCache[icao];
    if (hit && Date.now() - hit.at < 5 * 60 * 1000) return Promise.resolve(hit.data);
    return fetch('/api/weather?icao=' + encodeURIComponent(icao)).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (data) {
      _wxCache[icao] = { data: data, at: Date.now() };
      return data;
    });
  }
  /** null = unreachable; the caller falls back to the METAR-derived slip. */
  function fetchRealAtis(dep, arr) {
    var qs = [];
    if (dep) qs.push('dep=' + encodeURIComponent(dep));
    if (arr) qs.push('arr=' + encodeURIComponent(arr));
    return fetch('/api/realAtis?' + qs.join('&')).then(function (r) {
      return r.ok ? r.json() : null;
    }).catch(function () { return null; });
  }
  function fetchWxMap(icaos) {
    var uniq = icaos.filter(function (x, i) { return x && icaos.indexOf(x) === i; });
    return Promise.all(uniq.map(function (i) { return fetchWx(i).catch(function () { return null; }); }))
      .then(function (list) {
        var map = {};
        uniq.forEach(function (icao, i) { map[icao] = list[i]; });
        return map;
      });
  }
  function buildSlip(kind, dep, arr, who) {
    var now = Date.now();
    var base = { dep: dep, arr: arr, who: who, now: now };
    var withWx = function (atis) {
      return fetchWxMap([dep, arr]).then(function (wx) {
        return slipLines(kind, Object.assign({}, base, { wx: wx, atis: atis }));
      });
    };
    if (kind === 'realatis') {
      return fetchRealAtis(dep, arr).then(function (atis) {
        return atis ? slipLines(kind, Object.assign({}, base, { atis: atis })) : withWx(null);
      });
    }
    return withWx(null);
  }

  // ── view state (per page-load; never persisted) ──────────────────────────
  // The tab re-renders on every 90 s fleet poll, so anything a pilot has opened
  // or printed lives HERE and the markup is rebuilt from it — the same reason
  // dispatchBusy lives in fleet-mode-home.js and not on a button.
  var _briefOpen = {};     // legId -> true
  var _bpHidden = {};      // legId -> true  (boarding pass collapsed)
  var _printer = {};       // legId -> { kind, lines, shown, phase }
  var _auto = {};          // legId -> true  (first-open WX slip already queued)
  var _who = 'INVA';

  function isBriefOpen(id) { return _briefOpen[id] === true; }
  function toggleBrief(id) {
    if (_briefOpen[id]) delete _briefOpen[id]; else _briefOpen[id] = true;
    return isBriefOpen(id);
  }
  function isBpOpen(id) { return _bpHidden[id] !== true; }
  function toggleBoardingPass(id) {
    if (_bpHidden[id]) delete _bpHidden[id]; else _bpHidden[id] = true;
    return isBpOpen(id);
  }

  // ── markup ───────────────────────────────────────────────────────────────

  var ICON_SEND = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/></svg>';
  var ICON_DOC = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg>';
  var ICON_CHEV = '<svg class="fh-bag-chev" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

  /** The dispatch button(s) for a row. One primary per view: the row builder
   *  marks exactly one `primary`. A leg with a remembered OFP offers View OFP
   *  and a GHOST Redispatch — planning it again is allowed, never the default. */
  function dispatchHtml(v) {
    if (v.dispatch === 'none') return '';
    var ids = ' data-bagdispatch="' + esc(v.tailId) + '" data-bagleg="' + esc(v.legId) + '"';
    if (v.dispatch === 'busy') {
      return '<button type="button" class="fh-btn fh-btn-sm fh-bag-act-main" disabled>Opening SimBrief…</button>';
    }
    var cls = v.primary ? 'fh-btn fh-btn-sm fh-btn-primary' : v.ofp ? 'fh-btn fh-btn-sm fh-btn-ghost' : 'fh-btn fh-btn-sm';
    var label = v.dispatch === 'tap' ? 'Tap to open SimBrief' : v.ofp ? 'Redispatch' : 'Dispatch';
    var icon = v.dispatch === 'tap' || v.ofp ? '' : ICON_SEND;
    var view = v.ofp
      ? '<button type="button" class="fh-btn fh-btn-sm" data-bagofp="' + esc(v.legId) + '">' + ICON_DOC + 'View OFP</button>'
      : '';
    // The departure runway box. Built by the home module (it owns the typed
    // value, which survives the 90 s re-render); this file only places it.
    var rwy = v.rwyHtml ? '<label class="fh-bag-rwy"><span class="fh-bag-rwy-l">Dep RWY</span>' + v.rwyHtml + '</label>' : '';
    return rwy + view + '<button type="button" class="' + cls + (v.ofp ? '' : ' fh-bag-act-main') + '"' + ids + '>' + icon + label + '</button>';
  }

  function printerHtml(key, dep, arr) {
    var btns = PRINT_KINDS.map(function (k) {
      return '<button type="button" class="fh-bag-prt-btn" data-bagprint="' + k[0] + '" title="' + esc(k[2]) + '">' + esc(k[1]) + '</button>';
    }).join('');
    return '<div class="fh-bag-prt" data-key="' + esc(key) + '" data-dep="' + esc(dep || '') + '" data-arr="' + esc(arr || '') + '">' +
      '<div class="fh-bag-prt-top"><span class="fh-bag-prt-led" aria-hidden="true"></span>' +
        '<span class="fh-bag-prt-name">OCC doc printer · ' + esc(dep || '----') + '/' + esc(arr || '----') + '</span>' +
        '<span class="fh-bag-prt-status" aria-live="polite">Ready</span></div>' +
      '<div class="fh-bag-prt-btns">' + btns + '</div>' +
      '<div class="fh-bag-prt-slot" aria-hidden="true"></div>' +
      '<div class="fh-bag-prt-bay"></div>' +
    '</div>';
  }

  function briefHtml(v, ctx) {
    var pass = passModel(Object.assign({}, v.pass, { name: ctx.who }));
    var open = isBpOpen(v.legId);
    return '<div class="fh-bag-brief" data-brief="' + esc(v.legId) + '">' +
      '<div class="fh-bag-bcol">' +
        '<div class="fh-bag-bhead"><span class="fh-bag-btitle">Ops documents</span><span class="fh-bag-bhint">Print, read, tear off</span></div>' +
        printerHtml(v.legId, v.dep, v.arr) +
      '</div>' +
      '<div class="fh-bag-bcol">' +
        '<div class="fh-bag-bhead"><span class="fh-bag-btitle">Crew boarding pass <span class="fh-dim">· Seat ' + esc(pass.seat) + ' · ' +
          (pass.badge === 'BUSINESS' ? 'Business' : 'Economy') + '</span></span>' +
          '<button type="button" class="fh-btn fh-btn-ghost fh-btn-sm" data-bagpass="' + esc(v.legId) + '" aria-expanded="' + open + '">' + (open ? 'Hide' : 'Show') + '</button></div>' +
        (open
          ? boardingPassHtml(pass)
          : '<button type="button" class="fh-bag-bp-closed" data-bagpass="' + esc(v.legId) + '">Open boarding pass for <span class="fh-mono fh-bag-ink">' + esc(v.cs) + '</span></button>') +
      '</div>' +
    '</div>';
  }

  /** One row. Cell order is the desktop column order; on a phone the same DOM
   *  is a stacked card (see assets/css/fleet-bag.css), so there is ONE copy of
   *  each fact except the key-value list, which only the phone shows. */
  function rowHtml(v, ctx, opts) {
    opts = opts || {};
    var pending = !!opts.pending;
    var open = !pending && isBriefOpen(v.legId);
    var time = v.time ? ' <span class="fh-num">' + esc(v.time) + '</span>' : '';
    var meta = [
      ['Aircraft', '<span class="fh-mono">' + esc(v.reg) + '</span> · ' + esc(v.ty)],
      ['Departs', '<b class="fh-bag-day">' + esc(v.day) + '</b>' + time],
      ['Block', '<span class="fh-mono">' + esc(v.block) + '</span>'],
      ['Seat', esc(v.role)],
    ];
    if (v.ofp) meta.push(['Plan', 'Dispatched — OFP on file']);
    var actions = pending
      ? '<button type="button" class="fh-btn fh-btn-sm" data-flight="' + esc(v.tailId) + '" data-leg="' + esc(v.legId) + '">Details</button>'
      : dispatchHtml(v) +
        '<button type="button" class="fh-btn fh-btn-sm fh-bag-brief-btn" data-bagbrief="' + esc(v.legId) + '" aria-expanded="' + open + '">Crew brief' + ICON_CHEV + '</button>' +
        '<button type="button" class="fh-btn fh-btn-sm" data-flight="' + esc(v.tailId) + '" data-leg="' + esc(v.legId) + '">Details</button>';
    return '<div class="fh-bag-item' + (pending ? ' is-pending' : '') + '" role="listitem" data-bag-leg="' + esc(v.legId) + '">' +
      '<span class="fh-bag-no fh-mono">' + (pending ? '·' : esc(v.no)) + '</span>' +
      '<div class="fh-bag-flight">' +
        '<span class="fh-bag-fno">' + (pending ? '' : '<span class="fh-bag-mobno fh-mono" aria-hidden="true">' + esc(v.no) + '</span>') +
          '<span class="fh-cs">' + esc(v.cs) + '</span>' +
          // A leg approved while this tab was open — the home module clears it
          // when the pilot leaves the tab.
          (v.fresh && !pending ? '<span class="fh-bag-new">New</span>' : '') + '</span>' +
        '<span class="fh-bag-route"><span class="fh-mono fh-bag-ink">' + esc(v.route) + '</span>' + (v.city ? ' · ' + esc(v.city) : '') + '</span>' +
      '</div>' +
      '<div class="fh-bag-ac"><span class="fh-bag-reg fh-mono">' + esc(v.reg) + '</span><span class="fh-bag-sub">' + esc(v.ty) + '</span></div>' +
      '<div class="fh-bag-dep"><span><b class="fh-bag-day">' + esc(v.day) + '</b>' + time + '</span>' +
        '<span class="fh-bag-sub">Block ' + esc(v.block) + '</span></div>' +
      '<div class="fh-bag-seat"><span class="fh-bag-role">' + esc(v.role) + '</span>' +
        (v.side ? '<span class="fh-bag-sub">' + esc(v.side) + '</span>' : '') + '</div>' +
      '<div class="fh-bag-status">' + v.chipHtml + (v.ofp ? '<span class="fh-bag-sub">Dispatched</span>' : '') +
        (v.wait ? '<span class="fh-bag-sub">' + esc(v.wait) + '</span>' : '') + '</div>' +
      '<div class="fh-bag-actions">' + actions + '</div>' +
      '<dl class="fh-bag-meta">' + meta.map(function (m) {
        return '<div><dt>' + m[0] + '</dt><dd>' + m[1] + '</dd></div>';
      }).join('') + '</dl>' +
      (open ? briefHtml(v, ctx) : '') +
    '</div>';
  }

  function tableHtml(rows, ctx, opts) {
    return '<div class="fh-bag-table" role="list">' +
      '<div class="fh-bag-head" role="presentation" aria-hidden="true">' +
        '<span>#</span><span>Flight</span><span>Aircraft</span><span>Departs · block</span>' +
        '<span>Seat</span><span>Status</span><span class="fh-bag-hact"></span></div>' +
      rows.map(function (v) { return rowHtml(v, ctx, opts); }).join('') +
    '</div>';
  }

  function emptyHtml() {
    return '<section class="fh-blk"><div class="fh-bag-empty">' +
      '<h2>No legs assigned to you yet.</h2>' +
      '<p>Legs you are approved for appear here, ready to dispatch.</p>' +
      '<button type="button" class="fh-btn-primary" data-page="schedules">Request a seat on Schedules</button>' +
    '</div></section>';
  }

  /**
   * The whole tab as HTML.
   *   ctx.rows     view rows, already in order (see fleet-mode-home.js bagView)
   *   ctx.pending  legs the pilot asked for and an admin has not yet approved
   *   ctx.who      the name on the boarding pass and the printer slips
   */
  function render(ctx) {
    ctx = ctx || {};
    var rows = ctx.rows || [], pend = ctx.pending || [];
    _who = ctx.who || 'INVA';
    var out = '';
    if (!rows.length) {
      out += emptyHtml();
    } else {
      out += '<section class="fh-blk"><div class="fh-blk-head"><h2>Assigned to you</h2></div>' +
        tableHtml(rows, { who: _who }) + '</section>';
    }
    if (pend.length) {
      out += '<section class="fh-blk"><div class="fh-blk-head"><h2>Awaiting approval</h2>' +
        '<span class="fh-sub">An admin confirms these in Discord</span></div>' +
        tableHtml(pend, { who: _who }, { pending: true }) + '</section>';
    }
    return out;
  }

  // ── the printer's painter (the only DOM code in this file) ───────────────

  function reducedMotion() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
    catch (e) { return false; }
  }
  function prtEl(key) {
    if (typeof document === 'undefined') return null;
    return document.querySelector('.fh-bag-prt[data-key="' + String(key).replace(/["\\]/g, '\\$&') + '"]');
  }

  function paintPrinter(key, animateLast) {
    var el = prtEl(key);
    if (!el) return;
    var st = _printer[key];
    var phase = st ? st.phase : 'idle';
    el.setAttribute('data-phase', phase);
    el.querySelector('.fh-bag-prt-status').textContent = phase === 'busy' ? 'Printing…' : phase === 'done' ? 'Printed' : 'Ready';
    Array.prototype.forEach.call(el.querySelectorAll('.fh-bag-prt-btn'), function (b) {
      b.disabled = phase === 'busy';
      b.classList.toggle('is-on', !!st && st.kind === b.getAttribute('data-bagprint') && phase !== 'idle');
      b.classList.toggle('is-dim', phase === 'busy' && (!st || st.kind !== b.getAttribute('data-bagprint')));
    });
    var bay = el.querySelector('.fh-bag-prt-bay');
    if (!st || !st.lines) { bay.innerHTML = ''; return; }
    var lines = st.lines.slice(0, st.shown).map(function (l, i) {
      var fresh = animateLast && i === st.shown - 1 ? ' is-fresh' : '';
      if (l.rule) return '<div class="fh-bag-prt-rule' + fresh + '"></div>';
      return '<div class="fh-bag-prt-ln' + fresh + '">' + l.segs.map(function (s) {
        return s.b ? '<b>' + esc(s.t) + '</b>' : esc(s.t);
      }).join('') + '</div>';
    }).join('');
    // eslint-disable-next-line no-unsanitized/property -- safe: markup built by this module (data escaped where built) or an internal enum/constant
    bay.innerHTML = '<div class="fh-bag-prt-sheet">' + lines +
      '<button type="button" class="fh-bag-prt-tear" data-bagtear="1" title="Tear off"' + (phase === 'done' ? '' : ' hidden') + '>✂  TEAR HERE  ✂</button>' +
      '<div class="fh-bag-prt-zig" aria-hidden="true"></div></div>';
  }

  function occPrintKey(key, kind) {
    var el = prtEl(key);
    if (!el) return;
    var cur = _printer[key];
    if (cur && cur.phase === 'busy') return;
    var dep = el.getAttribute('data-dep'), arr = el.getAttribute('data-arr');
    _printer[key] = { kind: kind, lines: null, shown: 0, phase: 'busy' };
    paintPrinter(key);
    Promise.resolve().then(function () { return buildSlip(kind, dep, arr, _who); }).catch(function (e) {
      return [
        { segs: [{ t: 'INVA OCC — LINK DOWN', b: true }] }, { rule: true },
        { segs: [{ t: String((e && e.message) || 'NETWORK ERROR').toUpperCase(), b: false }] },
      ];
    }).then(function (lines) {
      var st = { kind: kind, lines: lines, shown: 0, phase: 'busy' };
      _printer[key] = st;
      if (reducedMotion()) { st.shown = lines.length; st.phase = 'done'; paintPrinter(key); return; }
      var step = function () {
        if (_printer[key] !== st) return;             // torn off or reprinted
        if (st.shown >= lines.length) { st.phase = 'done'; paintPrinter(key); return; }
        st.shown += 1;
        paintPrinter(key, true);
        setTimeout(step, lines[st.shown - 1].rule ? 60 : 130);
      };
      setTimeout(step, 120);
    });
  }

  /** A printer button was clicked. `btn` is the element the delegate matched. */
  function occPrint(btn, kind) {
    var el = btn && btn.closest ? btn.closest('.fh-bag-prt') : null;
    if (el) occPrintKey(el.getAttribute('data-key'), kind);
  }

  function occTear(btn) {
    var el = btn && btn.closest ? btn.closest('.fh-bag-prt') : null;
    if (!el) return;
    var key = el.getAttribute('data-key');
    var st = _printer[key];
    if (!st || st.phase !== 'done') return;
    var sheet = el.querySelector('.fh-bag-prt-sheet');
    if (sheet) sheet.classList.add('is-torn');
    setTimeout(function () {
      if (_printer[key] === st) { delete _printer[key]; paintPrinter(key); }
    }, reducedMotion() ? 0 : 520);
  }

  /**
   * After the tab's markup is (re)written: repaint every printer from its state
   * — a poll rebuilds the DOM under a slip that is mid-print — and print the
   * first WX slip when a brief is opened for the first time, as career does.
   */
  function hydrate(root) {
    var host = root || (typeof document !== 'undefined' ? document : null);
    if (!host || !host.querySelectorAll) return;
    Array.prototype.forEach.call(host.querySelectorAll('.fh-bag-prt'), function (el) {
      var key = el.getAttribute('data-key');
      if (_printer[key]) paintPrinter(key);
      else if (!_auto[key]) {
        _auto[key] = true;
        setTimeout(function () { occPrintKey(key, 'wx'); }, reducedMotion() ? 0 : 500);
      }
    });
  }

  window.INVA_FLEET_BAG = {
    orderBag: orderBag,
    diffApprovals: diffApprovals,
    FIRST_FETCH_SLACK_MS: FIRST_FETCH_SLACK_MS,
    parseOfps: parseOfps,
    hashNum: hashNum,
    assignSeat: assignSeat,
    passModel: passModel,
    boardingPassHtml: boardingPassHtml,
    metarToAtis: metarToAtis,
    slipLines: slipLines,
    render: render,
    hydrate: hydrate,
    isBriefOpen: isBriefOpen,
    toggleBrief: toggleBrief,
    isBpOpen: isBpOpen,
    toggleBoardingPass: toggleBoardingPass,
    occPrint: occPrint,
    occTear: occTear,
  };
})();
