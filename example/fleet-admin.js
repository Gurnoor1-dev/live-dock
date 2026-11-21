/**
 * assets/js/fleet-admin.js — Fleet Mode ADMIN screen (/fleet → Admin).
 *
 * The browser door onto everything staff otherwise do for the fleet in
 * Discord — crew requests (approve, approve as First Officer, decline),
 * reposition requests, and /contracts (sync, publish, auto-publish) — plus
 * the schedule writes Infinite Flight's v3 API gives an org admin: add a leg,
 * edit it, set its flight plan, reorder a tail's legs, delete one, and seat
 * or unseat crew.
 *
 * The tab only appears when /api/fleetAdminMe says the signed-in IF account
 * belongs to an INVA staff profile. That is a convenience, not the gate:
 * every call is re-checked server-side (lib/api-handlers/fleet-admin.js), and
 * every write runs on the org admin token there — never on this page's
 * read-only pilot token.
 *
 * Owned here: the #fhScreenAdmin screen, its two dialogs (#fhAdmModal,
 * #fhAdmConfirm) and its own delegated listeners. fleet-mode-home.js owns
 * the navigation and calls render(data) with the same fleet read every other
 * screen uses, so the schedules shown here are never a second, staler copy.
 */
(function () {
  'use strict';

  var IST_MS = 5.5 * 3600000;
  var H = 3600000;
  var CREW_CAP = 3;
  var ROLE_NAME = { 0: 'Captain', 1: 'First Officer' };
  // PersistentFlightType, in the order a dispatcher reaches for them.
  var FLIGHT_TYPES = [
    [1, 'Passenger'], [3, 'Cargo'], [2, 'Charter'], [4, 'Training'],
    [5, 'Test flight'], [8, 'VIP / executive'], [6, 'Medical emergency'],
    [9, 'Humanitarian relief'], [7, 'Military'], [10, 'General aviation'],
    [11, 'Airshow'], [12, 'Other'], [0, 'None'],
  ];
  var FT_SHORT = {
    0: 'Flight', 1: 'Passenger', 2: 'Charter', 3: 'Cargo', 4: 'Training', 5: 'Test',
    6: 'Medical', 7: 'Military', 8: 'VIP', 9: 'Relief', 10: 'GA', 11: 'Airshow', 12: 'Other',
  };
  // ScheduledFlightStatus → [label, chip class] (same meanings as the board).
  var SS = {
    0: ['Unknown', 'sched'], 1: ['Scheduled', 'sched'], 2: ['Boarding', 'air'], 3: ['Boarded', 'air'],
    4: ['Taxiing', 'air'], 6: ['In flight', 'air'], 7: ['Diverted', 'warn'], 8: ['Delayed', 'warn'],
    9: ['Cancelled', 'bad'], 10: ['Taxiing in', 'sched'], 11: ['Arrived', 'sched'],
  };
  var CLOSED = { 9: true, 11: true };
  // IF's reorder endpoint moves only these (Scheduled, InFlight).
  var REORDERABLE = { 1: true, 6: true };
  var STALE_MS = 12 * H;
  var DECLINE_REASONS = [
    'The leg already has crew',
    'Please fly the earlier leg first',
    'Not eligible for this aircraft yet',
    'Duplicate request',
  ];

  var st = {
    checked: false,
    me: null,               // { admin, name, callsign, orgConnection }
    tab: null,              // requests | schedules | contracts | log | activity
    // Flight log tab: one tail's IF flight log, or a paced whole-fleet scan.
    log: { tailId: '', flights: [], page: 0, totalPages: 0, view: 'legs', loading: false, error: null, scan: null, scanFlights: [] },
    data: null,             // /api/fleetAdminData payload
    loading: false,
    loadedAt: 0,
    rosterAt: 0,
    ticks: 0,
    error: null,
    tail: null,             // selected aircraft id
    showLegs: false,        // phone: the legs view replaces the tail list
    tailQuery: '',
    showClosed: false,
    busy: {},               // key → true while a call is in flight
    declining: null,        // request id whose decline form is open
    declineText: '',
    conflict: {},           // request id → { captainName, canSeatFirstOfficer }
    reqClosed: {},          // registration → true when COLLAPSED (groups open by default)
    menu: null,             // leg id whose "More" menu is open
    drag: null,             // leg id being dragged
    pollTimer: null,
  };
  // The fleet read, handed over by fleet-mode-home.js on every render.
  var fleet = { aircraft: [], airports: {}, bidOnlyTails: [], loaded: false };
  // Open dialog state. kind: leg | crew | plan
  var dlg = null;
  // Open confirm state: { title, body, okLabel, danger, onOk }
  var cfm = null;
  var apCache = {};         // ICAO → airport reference (or false = unknown)
  var apPending = {};

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return window.INVA_ESC.html(s);
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function normReg(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function rules() { return (window.INVA_FLEET_HOME && window.INVA_FLEET_HOME._rules) || {}; }

  // ── time (IST is the airline's clock; IF stores UTC) ─────────────────────
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function validMs(t) { return typeof t === 'number' && Number.isFinite(t) && t > 0; }
  function istDate(ms) { return new Date(ms + IST_MS); }
  function istParts(ms) {
    var d = istDate(ms);
    return { date: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 16) };
  }
  function istToUtcMs(date, time) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
    var t = /^(\d{1,2}):(\d{2})/.exec(String(time || ''));
    if (!m || !t) return NaN;
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +t[1], +t[2]) - IST_MS;
  }
  function fmtClock(ms) { var d = istDate(ms); return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()); }
  function fmtDay(ms) {
    var d = istDate(ms);
    return DOW[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MON[d.getUTCMonth()];
  }
  function fmtUtc(ms) { var d = new Date(ms); return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ' UTC'; }
  function fmtDur(ms) {
    if (!(ms > 0)) return '—';
    var m = Math.round(ms / 60000);
    return Math.floor(m / 60) + 'h ' + pad(m % 60) + 'm';
  }
  function ago(iso) {
    var t = Date.parse(iso);
    if (!validMs(t)) return '';
    var s = Math.max(0, Date.now() - t) / 1000;
    if (s < 90) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    return Math.round(s / 86400) + ' d ago';
  }
  /** "2:10", "2h10", "2h 10m", "130" (minutes) → ms, or NaN. */
  function parseBlock(str) {
    var s = String(str || '').trim().toLowerCase();
    if (!s) return NaN;
    var m = /^(\d{1,2})\s*[:h]\s*(\d{1,2})\s*m?$/.exec(s);
    if (m && +m[2] < 60) return (+m[1] * 60 + +m[2]) * 60000;
    m = /^(\d{1,2})\s*h$/.exec(s);
    if (m) return +m[1] * H;
    m = /^(\d{1,4})\s*m?$/.exec(s);
    if (m) return +m[1] * 60000;
    return NaN;
  }
  function blockText(ms) { var m = Math.round(ms / 60000); return Math.floor(m / 60) + ':' + pad(m % 60); }

  // ── API ──────────────────────────────────────────────────────────────────
  function identity() {
    var auth = window.INVA_FLEET && window.INVA_FLEET.getAuth();
    return auth && auth.followIdentity;
  }
  function api(route, body) {
    var b = Object.assign({ identity: identity() }, body || {});
    return window.INVA_FLEET.api('/api/' + route, { method: 'POST', body: b });
  }
  function act(action, body) { return api('fleetAdminAction', Object.assign({ action: action }, body || {})); }

  function toast(text) {
    var el = $('fhAdmToast');
    if (!el) return;
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.hidden = true; }, 4200);
  }

  function isAdmin() { return !!(st.me && st.me.admin); }

  /** Refresh the fleet (the source of every leg shown) and the admin read.
   *  Pass the tail an action touched: only that one is re-read, which keeps a
   *  run of approvals inside IF's per-minute request limit. */
  function refreshAll(aircraftId) {
    var F = window.INVA_FLEET;
    var p1 = Promise.resolve(aircraftId && F.reloadTail ? F.reloadTail(aircraftId) : F.reload()).catch(function () {});
    var p2 = loadData(true);
    return Promise.all([p1, p2]);
  }

  /** parts: which blocks to ask for (queue | roster | activity | contracts).
   *  Absent ⇒ the first load / a manual refresh: everything. The 60-s poll passes
   *  a smaller set; blocks not asked for keep their previous value in st.data. */
  function loadData(quiet, parts) {
    if (!isAdmin()) return Promise.resolve();
    if (!quiet) { st.loading = true; paint(); }
    var prev = st.data;
    // Action/tab refreshes keep the roster they hold; only the first load asks for it.
    if (!parts && prev && prev.roster) parts = ['queue', 'activity', 'contracts'];
    var body = {};
    if (parts && prev) {
      body.include = parts;
      var top = prev.activity && prev.activity[0] && prev.activity[0].at;
      if (parts.indexOf('activity') !== -1 && top) body.activitySince = top;
    }
    return api('fleetAdminData', body).then(function (json) {
      if (parts && prev) {
        var merged = Object.assign({}, prev, json);
        if (body.activitySince && json.activity) {
          var seen = {};
          merged.activity = json.activity.concat(prev.activity || []).filter(function (a) {
            if (seen[a.id]) return false;
            seen[a.id] = true;
            return true;
          }).slice(0, 20);
        }
        // errors only cover what was asked for; keep earlier ones for the rest.
        var errs = Object.assign({}, prev.errors || {});
        parts.forEach(function (p) {
          delete errs[p === 'queue' ? 'crew' : p];
          if (p === 'queue') delete errs.reposition;
        });
        merged.errors = Object.assign(errs, json.errors || {});
        json = merged;
      }
      if (!parts || !prev || parts.indexOf('roster') !== -1) st.rosterAt = Date.now();
      st.data = json;
      st.error = null;
      st.loadedAt = Date.now();
      if (json.orgConnection && st.me) st.me.orgConnection = json.orgConnection;
      if (!st.tab) st.tab = (json.queue && (json.queue.crew.length || json.queue.reposition.length)) ? 'requests' : 'schedules';
    }).catch(function (e) {
      st.error = (e && e.message) || 'The admin data could not be loaded.';
      if (e && e.code === 'NOT_ADMIN') { st.me = { admin: false }; rerenderHome(); }
    }).then(function () {
      st.loading = false;
      paint();
    });
  }

  function rerenderHome() {
    if (window.INVA_FLEET_HOME && window.INVA_FLEET_HOME.rerender) window.INVA_FLEET_HOME.rerender();
  }

  // ── fleet helpers ─────────────────────────────────────────────────────────
  function tails() {
    var bid = {};
    (fleet.bidOnlyTails || []).forEach(function (r) { bid[normReg(r)] = true; });
    return (fleet.aircraft || []).map(function (a) {
      var legs = (a.schedules || []).slice().sort(function (p, q) {
        var ps = Number(p.sequence), qs = Number(q.sequence);
        if (Number.isFinite(ps) && Number.isFinite(qs) && ps !== qs) return ps - qs;
        return (Date.parse(p.scheduledDepartureUtc) || 0) - (Date.parse(q.scheduledDepartureUtc) || 0);
      });
      return {
        id: a.id,
        reg: a.registration || '—',
        type: (function (c) { return c === '—' ? '' : c; })(rules().typeCode ? rules().typeCode(a.typeName) : (a.typeName || '')),
        typeName: a.typeName && a.typeName !== '—' ? a.typeName : '',
        at: a.airport ? a.airport.icao : null,
        // No tail is stored for now (owner, 2026-11-03): what IF calls stored
        // is in the virtual hangar and still flies — `hangar` only labels it.
        stored: false,
        hangar: a.isFleetActiveSlot === false || a.visibility === 2,
        bidOnly: !!bid[normReg(a.registration)],
        legs: legs,
        open: legs.filter(function (s) { return !CLOSED[s.status]; }),
        raw: a,
      };
    }).sort(function (p, q) { return p.reg.localeCompare(q.reg); });
  }
  function tailById(id) { return tails().find(function (t) { return t.id === id; }) || null; }
  function legOf(tail, legId) { return tail ? tail.legs.find(function (s) { return s.id === legId; }) || null : null; }
  function findLeg(aircraftId, scheduleId) {
    var t = tailById(aircraftId);
    return { tail: t, leg: legOf(t, scheduleId) };
  }
  function isStale(s) {
    var arr = Date.parse(s.scheduledArrivalUtc);
    return Number(s.status) === 6 && validMs(arr) && arr < Date.now() - STALE_MS;
  }
  function crewOf(s) { return Array.isArray(s && s.crew) ? s.crew.filter(Boolean) : []; }
  function captainOf(s) { return crewOf(s).find(function (c) { return Number(c.role) === 0; }) || null; }
  function timed(ms) { return validMs(ms) && ms > 0 && new Date(ms).getUTCFullYear() > 1971; }
  function nextCallsign(cs) {
    var m = /^(.*?)(\d+)$/.exec(String(cs || '').trim());
    if (!m) return String(cs || '');
    var n = String(Number(m[2]) + 1);
    return m[1] + (n.length < m[2].length ? m[2].slice(0, m[2].length - n.length).replace(/\d/g, '0') + n : n);
  }

  // ── airport reference (names + coordinates for the leg editor) ───────────
  function airport(icao) {
    icao = String(icao || '').toUpperCase();
    if (!icao) return null;
    if (fleet.airports && fleet.airports[icao]) return fleet.airports[icao];
    return apCache[icao] || null;
  }
  function lookupAirport(icao, done) {
    icao = String(icao || '').toUpperCase();
    if (!/^[A-Z0-9]{3,4}$/.test(icao) || airport(icao) || apCache[icao] === false) return done && done();
    if (apPending[icao]) return;
    apPending[icao] = true;
    fetch('/api/fleetPilotAirports?icaos=' + encodeURIComponent(icao))
      .then(function (r) { return r.json(); })
      .then(function (j) { apCache[icao] = (j && j.airports && j.airports[icao]) || false; })
      .catch(function () { /* unknown stays unknown */ })
      .then(function () { delete apPending[icao]; if (done) done(); });
  }
  function apLabel(icao) {
    var a = airport(icao);
    if (!a) return '';
    return [a.name, a.city].filter(Boolean).filter(function (v, i, arr) { return arr.indexOf(v) === i; }).join(' · ');
  }
  function estimateBlockMs(o, d, tail) {
    var a = airport(o), b = airport(d), r = rules();
    if (!a || !b || !r.nmBetween || !r.approxBlockMs) return null;
    if (!Number.isFinite(a.lat) || !Number.isFinite(b.lat)) return null;
    var fam = r.family && tail ? r.family(tail.type) : 'Narrow-body';
    return r.approxBlockMs(r.nmBetween(a.lat, a.lon, b.lat, b.lon), fam);
  }

  // ════════════════════════════════════════════════════════════════════════
  // Screen
  // ════════════════════════════════════════════════════════════════════════
  function paint() {
    var screen = $('fhScreenAdmin');
    if (!screen || screen.hidden) return;
    // Until the first read decides (requests waiting → Requests, else
    // Schedules), the Requests pane holds the loading skeleton.
    if (!st.tab && st.data) st.tab = 'requests';
    var tab = st.tab || 'requests';
    paintHead();
    paintTabs(tab);
    ['requests', 'schedules', 'contracts', 'log', 'activity', 'metrics', 'rewards'].forEach(function (k) {
      var pane = $('fhAdmPane' + k.charAt(0).toUpperCase() + k.slice(1));
      if (pane) pane.hidden = tab !== k;
    });
    var errEl = $('fhAdmError');
    errEl.hidden = !st.error;
    errEl.textContent = st.error || '';
    if (tab === 'requests' && !st.declining) paintRequests();
    if (st.tab === 'schedules' && !st.drag) paintSchedules();
    if (st.tab === 'contracts') paintContracts();
    if (st.tab === 'log') paintLog();
    if (st.tab === 'activity') paintActivity();
  }

  function paintHead() {
    var c = st.me && st.me.orgConnection;
    var conn = $('fhAdmConn');
    var warn = $('fhAdmConnWarn');
    if (!c) {
      conn.innerHTML = '';
      warn.hidden = true;
    } else if (c.connected && c.grantedWrite) {
      conn.innerHTML = '<span class="fh-chip fh-chip-air" title="Writes run on the INVA org connection">Org connected</span>';
      warn.hidden = true;
    } else {
      // eslint-disable-next-line no-unsanitized/property -- safe: static markup; every dynamic value is escaped
      conn.innerHTML = '<span class="fh-chip fh-chip-bad">' + (c.connected ? 'No write access' : 'Org disconnected') + '</span>';
      warn.hidden = false;
      warn.textContent = c.connected
        ? 'The INVA org connection is missing schedule write access, so changes will be refused. Reconnect it in the career admin panel: Admin → VA Manager.'
        : 'The INVA org connection to Infinite Flight is down, so changes will be refused. Reconnect it in the career admin panel: Admin → VA Manager.';
    }
    $('fhAdmSub').textContent = (st.me && st.me.name ? 'Signed in as ' + st.me.name + '. ' : '') +
      'Changes go straight to Infinite Flight.';
  }

  function paintTabs(current) {
    current = current || st.tab || 'requests';
    var q = st.data && st.data.queue;
    var n = q ? q.crew.length + q.reposition.length : 0;
    var tabs = [
      ['requests', 'Requests', n || ''],
      ['schedules', 'Schedules', ''],
      ['contracts', 'Contracts', ''],
      ['log', 'Flight log', ''],
      ['activity', 'Activity', ''],
      ['metrics', 'Metrics', ''],
      ['rewards', 'Rewards', ''],
    ];
    // eslint-disable-next-line no-unsanitized/property -- safe: markup built by this module (data escaped where built) or an internal enum/constant
    $('fhAdmTabs').innerHTML = tabs.map(function (t) {
      var on = current === t[0];
      return '<button class="fh-pill' + (on ? ' on' : '') + '" type="button" role="tab" aria-selected="' + on +
        '" data-admtab="' + t[0] + '">' + t[1] +
        (t[2] ? '<span class="fh-adm-badge" aria-label="' + t[2] + ' waiting">' + t[2] + '</span>' : '') + '</button>';
    }).join('');
  }

  // ── Requests ──────────────────────────────────────────────────────────────
  function paintRequests() {
    var el = $('fhAdmRequests');
    if (!st.data) {
      // eslint-disable-next-line no-unsanitized/property -- safe: markup built by this module (data escaped where built) or an internal enum/constant
      el.innerHTML = st.loading ? skeleton(3) : '';
      return;
    }
    var q = st.data.queue || { crew: [], reposition: [] };
    var errs = st.data.errors || {};
    var html = '';
    html += '<div class="fh-blk-head"><h2>Crew requests</h2><span class="fh-sub">' +
      (q.crew.length ? q.crew.length + ' waiting · by aircraft' : '') + '</span></div>';
    if (errs.crew) html += '<p class="fh-adm-warn">' + esc(errs.crew) + '</p>';
    else if (!q.crew.length) {
      html += '<p class="fh-empty">No crew requests waiting. Requests from the Schedules board and Discord <span class="fh-mono">/crew</span> land here and in Discord. Whichever an admin answers first settles both.</p>';
    } else {
      // Who else is asking for the SAME leg. An admin approving one request is
      // implicitly refusing the others, so the contest has to be visible on
      // every card in it — not discoverable by scrolling and comparing
      // callsigns. Keyed per leg, built once rather than per card.
      var vie = {};
      q.crew.forEach(function (r) {
        var k = legKey(r);
        (vie[k] = vie[k] || []).push(r);
      });
      html += groupByTail(q.crew).map(function (g) {
        var open = !st.reqClosed[g.reg];
        return '<details class="fh-adm-group"' + (open ? ' open' : '') + '>' +
          '<summary data-admreqgroup="' + esc(g.reg) + '">' +
          '<span class="fh-adm-gchev" aria-hidden="true"></span>' +
          '<span class="fh-ty">' + esc(g.reg) + '</span>' +
          schedStrip(g.reg) +
          '<span class="fh-adm-badge" aria-label="' + g.rows.length + ' waiting">' + g.rows.length + '</span>' +
          '</summary>' +
          '<div class="fh-adm-glist">' + g.rows.map(function (r) {
            return crewCard(r, vie[legKey(r)] || [r]);
          }).join('') + '</div></details>';
      }).join('');
    }

    if (q.reposition.length || errs.reposition) {
      html += '<div class="fh-blk-head fh-adm-gap"><h2>Reposition requests</h2><span class="fh-sub">' + q.reposition.length + ' waiting</span></div>';
      html += errs.reposition ? '<p class="fh-adm-warn">' + esc(errs.reposition) + '</p>' : q.reposition.map(repoCard).join('');
    }
    // eslint-disable-next-line no-unsanitized/property -- safe: markup built by this module (data escaped where built) or an internal enum/constant
    el.innerHTML = html;
  }

  /** One leg, for keying requests that compete for it. */
  function legKey(r) { return String(r.aircraftId || '') + ':' + String(r.scheduleId || ''); }

  /**
   * Requests bucketed by tail, registrations in alphabetical order, oldest
   * first inside each. Sorting by aircraft is what an admin actually does with
   * this queue — they settle a tail at a time, because the seats on one leg are
   * the same three seats every other request on that tail is after.
   * Requests whose registration is missing land in a trailing "—" group rather
   * than vanishing.
   */
  function groupByTail(rows) {
    var by = {};
    rows.forEach(function (r) {
      var reg = String(r.registration || '').trim() || '—';
      (by[reg] = by[reg] || []).push(r);
    });
    return Object.keys(by).sort(function (a, b) {
      if (a === '—') return 1;
      if (b === '—') return -1;
      return a.localeCompare(b);
    }).map(function (reg) { return { reg: reg, rows: by[reg] }; });
  }

  /** Legs drawn in the group header before it runs out of line. */
  var STRIP_MAX = 5;

  /**
   * The tail's open legs on ONE line, beside its registration in the group
   * header: ICAO → ICAO → ICAO, with what is seated on each leg drawn beneath
   * that leg — a figure per pilot, a warn dot where nobody is.
   *
   * Purely a glance cue. An admin settles this queue a tail at a time, and the
   * question they are answering is which of that tail's legs still have nobody
   * on them. That was only knowable by opening every card; this puts it in the
   * header they are already looking at, with no text to read.
   *
   * RUNS, not one chain: an arrow is drawn only where one leg actually ends
   * where the next begins. A tail whose queue jumps airports would otherwise
   * read as a through-route it is not.
   */
  /**
   * Legs split into RUNS — consecutive legs where one ends where the next
   * begins. Shared by the group-header strip and the pilot-commitments block
   * so the rule lives once: an arrow is drawn only where the route actually
   * continues, because a queue that jumps airports must not read as a
   * through-route it is not.
   */
  function legRuns(legs) {
    var runs = [];
    (legs || []).forEach(function (s) {
      var o = String(s.originIcao || '?').toUpperCase();
      var d = String(s.destinationIcao || '?').toUpperCase();
      var run = runs[runs.length - 1];
      if (!run || run.end !== o) { run = { end: o, nodes: [o], legs: [] }; runs.push(run); }
      run.legs.push(s);
      run.nodes.push(d);
      run.end = d;
    });
    return runs;
  }

  function schedStrip(reg) {
    var t = tails().find(function (x) { return normReg(x.reg) === normReg(reg); });
    var legs = t ? t.open : [];
    if (!legs.length) return '';

    var shown = legs.slice(0, STRIP_MAX);
    var runs = legRuns(shown);

    var html = runs.map(function (run) {
      var parts = '';
      run.nodes.forEach(function (node, i) {
        parts += '<b class="fh-admss-icao">' + esc(node) + '</b>';
        var leg = run.legs[i];
        if (leg) parts += stripLeg(leg);
      });
      return '<span class="fh-admss-run">' + parts + '</span>';
    }).join('');

    var rest = legs.length - shown.length;
    if (rest > 0) html += '<b class="fh-admss-more fh-mono">+' + rest + '</b>';

    // The label is what a screen reader gets instead of the glyphs; nothing
    // here is rendered as text.
    var label = legs.map(function (s) {
      var n = crewOf(s).length;
      return (s.callsign || 'leg') + ' ' + (s.originIcao || '?') + ' to ' + (s.destinationIcao || '?') +
        ', ' + (n ? n + (n === 1 ? ' pilot' : ' pilots') : 'no crew');
    }).join('; ');
    return '<span class="fh-admss" aria-label="' + esc(label) + '">' + html + '</span>';
  }

  /** One leg of the strip: the arrow, and the crew under it. */
  function stripLeg(s) {
    var n = crewOf(s).length;
    var marks = '';
    if (n) for (var i = 0; i < n; i++) marks += PERSON_SVG;
    else marks = '<i class="fh-admss-none"></i>';
    return '<span class="fh-admss-leg' + (n ? '' : ' is-empty') + '"' +
      ' title="' + esc((s.callsign || 'Leg') + ' · ' + (s.originIcao || '?') + ' → ' + (s.destinationIcao || '?') +
        ' · ' + (n ? n + '/' + CREW_CAP + ' crew' : 'no crew')) + '">' +
      '<i class="fh-arr" aria-hidden="true">→</i>' +
      '<span class="fh-admss-crew" aria-hidden="true">' + marks + '</span></span>';
  }

  /**
   * Every OTHER open leg across the fleet this pilot already has their name on.
   *
   * The question an admin is actually answering on this queue is not "is this
   * leg free" — the seat meter says that — but "should this pilot have another
   * leg at all". A pilot already rostered on three legs of two tails is a
   * different decision from one with nothing on, and until now the only way to
   * tell them apart was to open every tail and read the crew lists.
   *
   * Read off the fleet snapshot the page already holds, so this costs no
   * request. Matched on IF USER ID, never on name: two pilots can share a
   * display name and crediting the wrong one here would argue against seating
   * somebody who is in fact free.
   *
   * The requested leg itself is excluded — that is what is being decided, and
   * on it they are a request, not crew.
   */
  function pilotCommitments(r) { return commitmentsIn(tails(), r); }

  /** The pure half, so the rule can be tested without a fleet in the DOM. */
  function commitmentsIn(tailList, r) {
    var uid = String(r && r.userId || '').trim();
    if (!uid) return null;
    var here = String(r.scheduleId || '');
    var groups = [];
    var total = 0;

    (tailList || []).forEach(function (t) {
      var mine = t.open.filter(function (s) {
        if (String(s.id) === here) return false;
        return crewOf(s).some(function (c) { return String(c.userId || '') === uid; });
      });
      if (!mine.length) return;
      total += mine.length;
      groups.push({
        reg: t.reg,
        same: normReg(t.reg) === normReg(r.registration),
        legs: mine,
      });
    });
    if (!total) return null;

    // The tail being decided first — it is the one the admin has in hand — and
    // then the others, which are the part that argues against approving.
    groups.sort(function (a, b) { return (a.same ? 0 : 1) - (b.same ? 0 : 1); });
    return { total: total, groups: groups, otherTails: groups.filter(function (g) { return !g.same; }).length };
  }

  /**
   * The commitments block: what else this pilot is already carrying.
   *
   * Same visual language as the group-header strip — registration chip, then
   * ICAO → ICAO runs — because an admin has already learned to read that shape
   * on this page. What differs is what it counts: legs this pilot is on, rather
   * than seats on one leg. Each leg's status is in its tooltip; none of it is
   * carried in colour.
   *
   * Absent entirely when the pilot has nothing else on, which is the common
   * case — this must not become a row of "0 other legs" on every card.
   */
  function commitEl(r) {
    var c = pilotCommitments(r);
    if (!c) return '';

    // Severity is about WHERE, not how many: more legs on the tail in hand is
    // a rotation being built, which is normal and often the point. Legs on
    // OTHER tails is the thing that cannot physically work.
    //
    // ONE accent, deliberately. A leg already in the air was its own louder
    // tier here; it is not — the status is in each leg's tooltip, and a second
    // alarm colour on a block that is already a heads-up spends the page's only
    // red (reserved for Cancelled) on something an admin is not being asked to
    // act on.
    var tone = c.otherTails ? ' is-other' : '';

    var head = c.total + (c.total === 1 ? ' other leg' : ' other legs');
    if (c.otherTails) head += ' · ' + c.otherTails + (c.otherTails === 1 ? ' other aircraft' : ' other aircraft');

    var rows = c.groups.map(function (g) {
      var shown = g.legs.slice(0, STRIP_MAX);
      var strip = legRuns(shown).map(function (run) {
        var parts = '';
        run.nodes.forEach(function (node, i) {
          parts += '<b class="fh-admss-icao">' + esc(node) + '</b>';
          var leg = run.legs[i];
          if (leg) {
            // The status rides in the tooltip, never in a colour.
            parts += '<span class="fh-admss-leg"' +
              ' title="' + esc((leg.callsign || 'Leg') + ' · ' + (leg.originIcao || '?') + ' → ' +
                (leg.destinationIcao || '?') + ' · ' + ((SS[leg.status] || SS[0])[0])) + '">' +
              '<i class="fh-arr" aria-hidden="true">→</i></span>';
          }
        });
        return '<span class="fh-admss-run">' + parts + '</span>';
      }).join('');
      var rest = g.legs.length - shown.length;
      if (rest > 0) strip += '<b class="fh-admss-more fh-mono">+' + rest + '</b>';
      return '<span class="fh-adm-commit-row">' +
        '<b class="fh-ty' + (g.same ? ' is-same' : '') + '">' + esc(g.reg) + '</b>' +
        '<span class="fh-admss">' + strip + '</span></span>';
    }).join('');

    var label = c.groups.map(function (g) {
      return g.reg + ': ' + g.legs.map(function (s) {
        return (s.callsign || 'leg') + ' ' + (s.originIcao || '?') + ' to ' + (s.destinationIcao || '?') +
          ', ' + ((SS[s.status] || SS[0])[0]);
      }).join('; ');
    }).join('. ');

    return '<div class="fh-adm-commit' + tone + '" aria-label="' +
      esc('Already rostered on ' + head + '. ' + label) + '">' +
      '<span class="fh-adm-commit-head" aria-hidden="true">' + PERSON_SVG + esc(head) + '</span>' +
      '<span class="fh-adm-commit-list" aria-hidden="true">' + rows + '</span></div>';
  }

  /** One seated pilot. Inline so a strip of them costs no requests. */
  var PERSON_SVG = '<svg class="fh-admss-p" viewBox="0 0 10 11" aria-hidden="true">' +
    '<circle cx="5" cy="3" r="2.4"/><path d="M.8 10.6c0-2.4 1.9-3.9 4.2-3.9s4.2 1.5 4.2 3.9z"/></svg>';

  /**
   * Seats as pips plus "n/3 crew" — the shape of the leg at a glance, in place
   * of a sentence an admin had to read to the end to learn the same number.
   */
  function seatsEl(taken) {
    var pips = '';
    for (var i = 0; i < CREW_CAP; i++) {
      pips += '<i class="fh-crewpip' + (i < taken ? ' is-on' : '') + '"></i>';
    }
    // NOT .fh-seats/.fh-seat — those already name the crew dialog's seat LIST
    // further down this file, and its rules would restyle these pips.
    return '<span class="fh-crewmeter" aria-label="' + taken + ' of ' + CREW_CAP + ' seats taken">' +
      pips + '<b>' + taken + '/' + CREW_CAP + ' crew</b></span>';
  }

  /**
   * The contest for one leg: an avatar per pilot asking, the card's own pilot
   * ringed. Shown only when somebody else is asking too, so its presence alone
   * means "this is contested" — the thing a text line could never do at a
   * glance across a long queue.
   */
  function vieEl(rows, self) {
    if (!rows || rows.length < 2) return '';
    var names = rows.map(function (x) { return (x.pilotName || 'a pilot') + ' — ' + (ROLE_NAME[x.role] || 'crew'); });
    return '<span class="fh-adm-vie" aria-label="' + esc(rows.length + ' pilots want this leg: ' + names.join(', ')) +
      '" title="' + esc(names.join('\n')) + '">' +
      rows.map(function (x) {
        return '<i class="fh-av' + (x.id === self.id ? ' is-me' : '') + '">' + esc(initials(x.pilotName)) + '</i>';
      }).join('') +
      '<b>' + rows.length + ' asking</b></span>';
  }

  function crewCard(r, vieRows) {
    var found = findLeg(r.aircraftId, r.scheduleId);
    var leg = found.leg;
    var crew = crewOf(leg);
    var cap = leg ? captainOf(leg) : null;
    var asksCaptain = Number(r.role) === 0;
    var conflict = st.conflict[r.id] || (asksCaptain && cap && cap.userId !== r.userId
      ? { captainName: cap.username || 'Another pilot', canSeatFirstOfficer: crew.length < CREW_CAP } : null);
    var busy = st.busy['req:' + r.id];
    var dep = Date.parse(r.scheduledDepartureUtc);
    var sourceLabel = r.source === 'discord' ? 'Discord /crew' : 'the board';

    var h = '<article class="fh-adm-card" data-admreq="' + esc(r.id) + '">';
    h += '<div class="fh-adm-card-top"><span class="fh-adm-who"><strong class="fh-pilot">' + esc(r.pilotName || 'A pilot') + '</strong>' +
      (r.pilotCallsign ? ' <span class="fh-dim fh-mono">' + esc(r.pilotCallsign) + '</span>' : '') + '</span>' +
      '<span class="fh-adm-role">wants ' + esc(ROLE_NAME[r.role] || 'a seat') + '</span></div>';
    // No registration chip here: the group header this card sits under is the
    // registration, and repeating it on every card was the noise that made the
    // queue hard to scan in the first place.
    h += '<div class="fh-adm-legline"><span class="fh-mono fh-strong">' + esc(r.callsign || '—') + '</span>' +
      '<span class="fh-mono">' + esc(r.originIcao || '?') + ' <span class="fh-arr">→</span> ' + esc(r.destinationIcao || '?') + '</span></div>';
    h += '<p class="fh-adm-meta">' + (timed(dep) ? 'Departs ' + fmtDay(dep) + ' · ' + fmtClock(dep) + ' IST · ' : '') +
      'asked ' + esc(ago(r.createdAt)) + ' via ' + sourceLabel + '</p>';
    if (!leg && fleet.loaded) {
      h += '<p class="fh-adm-warn">This leg is no longer on ' + esc(r.registration || 'the aircraft') + '. Decline the request.</p>';
    } else if (leg) {
      // Seats and contention are ELEMENTS, not prose: both are counts an admin
      // compares across cards, and a glance has to be enough.
      h += '<div class="fh-adm-seatrow">' + seatsEl(crew.length) + vieEl(vieRows, r) + '</div>';
      // What the PILOT is already carrying, under what the LEG already has.
      // Both are inputs to the same decision and they read in that order: the
      // seat is the question, the pilot's other legs are the reason to say no.
      h += commitEl(r);
      if (crew.length) {
        h += '<p class="fh-adm-meta">On the leg: ' + crew.map(function (c) {
          return '<span class="fh-pilot">' + esc(c.username || 'a pilot') + '</span> (' + (ROLE_NAME[c.role] || 'crew') + ')';
        }).join(', ') + '</p>';
      }
    }
    if (conflict) {
      h += '<p class="fh-adm-warn"><strong class="fh-pilot">' + esc(conflict.captainName) + '</strong> already has the Captain’s seat. ' +
        (conflict.canSeatFirstOfficer ? 'Seat this pilot as First Officer instead, or decline.' : 'The leg is full, so it can only be declined.') + '</p>';
    }

    if (st.declining === r.id) {
      h += declineForm(r.id, busy);
    } else {
      h += '<div class="fh-adm-actions">';
      if (conflict) {
        if (conflict.canSeatFirstOfficer) {
          h += '<button class="fh-btn-primary fh-btn-sm" type="button" data-admapprove="' + esc(r.id) + '" data-asfo="1"' + (busy ? ' disabled' : '') + '>' + (busy ? 'Seating…' : 'Approve as First Officer') + '</button>';
        }
      } else {
        h += '<button class="fh-btn-primary fh-btn-sm" type="button" data-admapprove="' + esc(r.id) + '"' + (busy || (!leg && fleet.loaded) ? ' disabled' : '') + '>' + (busy ? 'Approving…' : 'Approve') + '</button>';
      }
      h += '<button class="fh-btn fh-btn-sm" type="button" data-admdecline="' + esc(r.id) + '"' + (busy ? ' disabled' : '') + '>Decline</button>';
      if (leg) h += '<button class="fh-btn-ghost fh-btn-sm fh-adm-link" type="button" data-admgotail="' + esc(r.aircraftId) + '">Open ' + esc(r.registration || 'tail') + '</button>';
      h += '</div>';
    }
    return h + '</article>';
  }

  function repoCard(r) {
    var busy = st.busy['req:' + r.id];
    var dep = Date.parse(r.scheduledDepartureUtc);
    var h = '<article class="fh-adm-card" data-admreq="' + esc(r.id) + '">';
    h += '<div class="fh-adm-card-top"><span class="fh-adm-who"><strong class="fh-pilot">' + esc(r.pilotName || 'A pilot') + '</strong></span>' +
      '<span class="fh-adm-role">ferry flight</span></div>';
    h += '<div class="fh-adm-legline"><span class="fh-mono">' + esc(r.originIcao || '?') + ' <span class="fh-arr">→</span> ' +
      esc(r.destinationIcao || '?') + '</span><span class="fh-ty">' + esc(r.registration || '—') + '</span></div>';
    h += '<p class="fh-adm-meta">' + (timed(dep) ? 'Departs ' + fmtDay(dep) + ' · ' + fmtClock(dep) + ' IST · ' : '') +
      'asked ' + esc(ago(r.createdAt)) + '. Approving creates the ferry leg on Infinite Flight.</p>';
    if (st.declining === r.id) h += declineForm(r.id, busy, 'reposition');
    else {
      h += '<div class="fh-adm-actions"><button class="fh-btn-primary fh-btn-sm" type="button" data-admrepoapprove="' + esc(r.id) + '"' + (busy ? ' disabled' : '') + '>' + (busy ? 'Approving…' : 'Approve') + '</button>' +
        '<button class="fh-btn fh-btn-sm" type="button" data-admdecline="' + esc(r.id) + '" data-kind="reposition"' + (busy ? ' disabled' : '') + '>Decline</button></div>';
    }
    return h + '</article>';
  }

  function declineForm(id, busy, kind) {
    return '<div class="fh-adm-decline">' +
      '<label class="fh-field-label" for="fhAdmReason">Reason sent to the pilot</label>' +
      '<div class="fh-adm-quick">' + DECLINE_REASONS.map(function (t) {
        return '<button class="fh-adm-qr" type="button" data-admqr="' + esc(t) + '">' + esc(t) + '</button>';
      }).join('') + '</div>' +
      '<textarea class="fh-input fh-textarea" id="fhAdmReason" rows="2" maxlength="500" placeholder="Or write your own">' + esc(st.declineText) + '</textarea>' +
      '<div class="fh-adm-actions">' +
      '<button class="fh-btn-ghost fh-btn-sm" type="button" data-admdeclinecancel="1">Cancel</button>' +
      '<button class="fh-btn fh-btn-danger fh-btn-sm" type="button" data-admdeclinesend="' + esc(id) + '" data-kind="' + (kind || 'crew') + '"' + (busy ? ' disabled' : '') + '>' + (busy ? 'Declining…' : 'Decline request') + '</button>' +
      '</div></div>';
  }

  // ── Schedules ─────────────────────────────────────────────────────────────
  function paintSchedules() {
    var all = tails();
    var split = $('fhAdmSplit');
    if (!st.tail || !all.some(function (t) { return t.id === st.tail; })) {
      // Open on a tail there is something to do with: active, with open legs.
      st.tail = (all.find(function (t) { return !t.stored && t.open.length; }) ||
        all.find(function (t) { return !t.stored; }) || all[0] || {}).id || null;
    }
    split.classList.toggle('show-legs', !!st.showLegs);

    var q = st.tailQuery.toUpperCase();
    var list = all.filter(function (t) {
      return !q || normReg(t.reg).indexOf(normReg(q)) !== -1 || String(t.type).toUpperCase().indexOf(q) !== -1 ||
        String(t.at || '').indexOf(q) !== -1;
    });
    // eslint-disable-next-line no-unsanitized/property -- safe: markup built by this module (data escaped where built) or an internal enum/constant
    $('fhAdmTailList').innerHTML = !fleet.loaded ? skeleton(4) : (list.length ? list.map(function (t) {
      var next = t.open[0];
      var on = t.id === st.tail;
      return '<button class="fh-adm-tail' + (on ? ' on' : '') + '" type="button" data-admtail="' + esc(t.id) + '"' +
        (on ? ' aria-current="true"' : '') + '>' +
        '<span class="fh-adm-tail-reg fh-mono">' + esc(t.reg) + '</span>' +
        (t.type ? '<span class="fh-ty">' + esc(t.type) + '</span>' : '<span></span>') +
        '<span class="fh-adm-tail-n">' + (t.open.length ? t.open.length + ' open' : 'no legs') + '</span>' +
        '<span class="fh-adm-tail-sub">' + (t.bidOnly ? '<span class="fh-c-warn">Bid-only</span> · ' : '') +
        (t.stored ? 'Stored · ' : t.hangar ? 'Virtual hangar · ' : '') +
        (next ? esc(next.callsign || '—') + ' ' + esc(next.originIcao) + '→' + esc(next.destinationIcao) : (t.at ? 'Parked at ' + esc(t.at) : 'No schedule')) +
        '</span></button>';
    }).join('') : '<p class="fh-empty">No aircraft match “' + esc(st.tailQuery) + '”.</p>');

    paintLegs(tailById(st.tail));
  }

  function paintLegs(tail) {
    var el = $('fhAdmLegs');
    // eslint-disable-next-line no-unsanitized/property -- safe: markup built by this module (data escaped where built) or an internal enum/constant
    if (!tail) { el.innerHTML = fleet.loaded ? '<p class="fh-empty">No aircraft in the fleet.</p>' : skeleton(3); return; }
    var open = tail.open;
    var closed = tail.legs.filter(function (s) { return CLOSED[s.status]; });
    var movable = open.filter(function (s) { return REORDERABLE[s.status]; });

    var h = '<button class="fh-back fh-adm-back" type="button" data-admback="1"><span class="fh-arr" aria-hidden="true">←</span>All aircraft</button>';
    h += '<div class="fh-adm-legs-head"><div class="fh-adm-legs-id">' +
      '<span class="fh-adm-legs-reg fh-mono">' + esc(tail.reg) + '</span>' +
      '<span class="fh-sub">' + [tail.typeName || (tail.type !== '—' ? tail.type : ''), tail.at ? 'at ' + esc(tail.at) : '', tail.stored ? 'in storage' : tail.hangar ? 'in virtual hangar' : '']
        .filter(Boolean).map(function (x, i) { return i ? x : esc(x); }).join(' · ') +
      '</span></div>' +
      '<button class="fh-btn-primary" type="button" data-admadd="' + esc(tail.id) + '">+ Add leg</button></div>';
    if (tail.bidOnly) {
      h += '<p class="fh-adm-warn"><strong>Bid-only tail.</strong> Its legs are packaged as Fleet Contracts. Adding, moving or deleting a leg changes what pilots bid on, and seating crew here skips bidding.</p>';
    }

    if (!open.length) {
      h += '<p class="fh-empty">No open legs on ' + esc(tail.reg) + '. Add one to put it on the board.</p>';
    } else {
      h += '<div class="fh-adm-hint">' + (movable.length > 1
        ? 'Legs are flown in this order. Drag a row, or use the arrows, to change it.'
        : 'Legs are flown in this order.') + '</div>';
      h += '<ol class="fh-adm-leglist" aria-label="Open legs on ' + esc(tail.reg) + '">' +
        open.map(function (s, i) { return legRow(tail, s, i, movable); }).join('') + '</ol>';
    }

    if (closed.length) {
      h += '<button class="fh-btn-ghost fh-btn-sm fh-adm-closed-toggle" type="button" data-admclosed="1" aria-expanded="' + st.showClosed + '">' +
        (st.showClosed ? 'Hide' : 'Show') + ' ' + closed.length + ' closed leg' + (closed.length === 1 ? '' : 's') + '</button>';
      if (st.showClosed) {
        h += '<ol class="fh-adm-leglist fh-adm-leglist-closed">' + closed.map(function (s, i) { return legRow(tail, s, i, []); }).join('') + '</ol>';
      }
    }
    // eslint-disable-next-line no-unsanitized/property -- safe: numbers and formatted counts only
    el.innerHTML = h;
  }

  function legRow(tail, s, i, movable) {
    var dep = Date.parse(s.scheduledDepartureUtc);
    var arr = Date.parse(s.scheduledArrivalUtc);
    var meta = isStale(s) ? ['Stale', 'sched'] : (SS[s.status] || SS[0]);
    var crew = crewOf(s);
    var mi = movable.indexOf(s);
    var canMove = mi !== -1 && movable.length > 1;
    var busy = st.busy['leg:' + s.id];
    var times = timed(dep) && timed(arr)
      ? '<span class="fh-mono">' + fmtDay(dep) + '</span> · <span class="fh-mono">' + fmtClock(dep) + ' → ' + fmtClock(arr) + '</span> <span class="fh-dim">(' + fmtDur(arr - dep) + ')</span>'
      : '<span class="fh-dim">Anytime</span>';
    var crewTxt = crew.length
      ? crew.map(function (c) { return '<span class="fh-adm-crewname"><span class="fh-pilot">' + esc(c.username || 'a pilot') + '</span> <span class="fh-dim">' + (Number(c.role) === 0 ? 'CPT' : 'FO') + '</span></span>'; }).join('')
      : '<span class="fh-dim">No crew</span>';

    var h = '<li class="fh-adm-leg' + (busy ? ' busy' : '') + (st.drag === s.id ? ' dragging' : '') + '" data-admleg="' + esc(s.id) + '"' +
      (canMove ? ' draggable="true"' : '') + '>';
    h += '<span class="fh-adm-grip' + (canMove ? '' : ' off') + '" aria-hidden="true">' + (canMove ? '⋮⋮' : '') + '</span>';
    h += '<span class="fh-adm-seq fh-mono">' + (i + 1) + '</span>';
    h += '<div class="fh-adm-leg-id"><span class="fh-adm-cs fh-mono">' + esc(s.callsign || '—') + '</span>' +
      '<span class="fh-adm-route fh-mono">' + esc(s.originIcao || '?') + ' <span class="fh-arr">→</span> ' + esc(s.destinationIcao || '?') + '</span>' +
      '<span class="fh-dim fh-adm-ft">' + esc(FT_SHORT[s.flightType] || 'Flight') + (s.flightPlan ? ' · plan filed' : '') + '</span></div>';
    h += '<div class="fh-adm-leg-time">' + times + '</div>';
    h += '<div class="fh-adm-leg-crew">' + crewTxt + '<span class="fh-dim fh-adm-seats">' + crew.length + '/' + CREW_CAP + '</span></div>';
    h += '<span class="fh-chip fh-chip-' + meta[1] + ' fh-adm-leg-chip">' + meta[0] + '</span>';
    h += '<div class="fh-adm-leg-act">';
    if (canMove) {
      h += '<button class="fh-adm-icon" type="button" data-admup="' + esc(s.id) + '" aria-label="Move ' + esc(s.callsign) + ' earlier"' + (mi === 0 || busy ? ' disabled' : '') + '>↑</button>' +
        '<button class="fh-adm-icon" type="button" data-admdown="' + esc(s.id) + '" aria-label="Move ' + esc(s.callsign) + ' later"' + (mi === movable.length - 1 || busy ? ' disabled' : '') + '>↓</button>';
    }
    h += '<button class="fh-btn fh-btn-sm" type="button" data-admcrew="' + esc(s.id) + '"' + (busy ? ' disabled' : '') + '>Crew</button>' +
      '<button class="fh-btn fh-btn-sm" type="button" data-admedit="' + esc(s.id) + '"' + (busy ? ' disabled' : '') + '>Edit</button>' +
      '<span class="fh-adm-menuwrap"><button class="fh-adm-icon" type="button" data-admmenu="' + esc(s.id) + '" aria-haspopup="menu" aria-expanded="' + (st.menu === s.id) + '" aria-label="More actions for ' + esc(s.callsign) + '"' + (busy ? ' disabled' : '') + '>⋯</button>';
    if (st.menu === s.id) {
      h += '<span class="fh-adm-menu" role="menu">' +
        '<button type="button" role="menuitem" data-admplan="' + esc(s.id) + '">Flight plan</button>' +
        '<button type="button" role="menuitem" data-admreturn="' + esc(s.id) + '">Add return leg</button>' +
        '<button type="button" role="menuitem" data-admdup="' + esc(s.id) + '">Duplicate (next day)</button>' +
        '<button type="button" role="menuitem" class="fh-adm-menu-danger" data-admdel="' + esc(s.id) + '">Delete leg</button>' +
        '</span>';
    }
    h += '</span></div></li>';
    return h;
  }

  // ── Contracts ─────────────────────────────────────────────────────────────
  function paintContracts() {
    var el = $('fhAdmContracts');
    // eslint-disable-next-line no-unsanitized/property -- safe: markup built by this module (data escaped where built) or an internal enum/constant
    if (!st.data) { el.innerHTML = skeleton(2); return; }
    if (st.data.errors && st.data.errors.contracts) {
      el.innerHTML = '<p class="fh-adm-warn">' + esc(st.data.errors.contracts) + '</p>';
      return;
    }
    var c = st.data.contracts;
    if (!c || !c.enabled) {
      el.innerHTML = '<p class="fh-empty">Fleet Contracts are switched off, so the five bid-only tails are crewed like any other. Turn them on in the career admin panel (Admin → Fleet Contracts).</p>';
      return;
    }
    var busy = st.busy.contracts;
    var h = '<div class="fh-adm-contract-head"><div class="fh-stats">' +
      stat('Round', esc(c.roundId || '—')) +
      stat('Bidding closes', validMs(c.closeAtMs) ? fmtDay(c.closeAtMs) + ' · ' + fmtClock(c.closeAtMs) : '—') +
      stat('Open contracts', String((c.contracts || []).length)) +
      stat('Bids', String((c.contracts || []).reduce(function (n, x) { return n + (x.bidCount || 0); }, 0))) +
      '</div></div>';
    h += '<div class="fh-adm-actions fh-adm-contract-actions">' +
      '<button class="fh-btn-primary" type="button" data-admcontracts="sync"' + (busy ? ' disabled' : '') + '>' + (busy === 'sync' ? 'Syncing…' : 'Sync now') + '</button>' +
      '<button class="fh-btn" type="button" data-admcontracts="publish"' + (busy ? ' disabled' : '') + '>' + (busy === 'publish' ? 'Publishing…' : 'Publish last closed round') + '</button>' +
      '<button class="fh-adm-switch" type="button" role="switch" aria-checked="' + !!c.autoPublish + '" data-admautopub="' + (c.autoPublish ? '0' : '1') + '"' + (busy ? ' disabled' : '') + '>' +
      '<span class="fh-adm-switch-track" aria-hidden="true"><span class="fh-adm-switch-knob"></span></span>Auto-publish awards</button>' +
      '</div>';
    h += '<p class="fh-adm-hint">Sync packages the open legs on the bid-only tails into this round. Publish seats the winners on their legs. Auto-publish does that by itself when bidding closes.</p>';

    h += '<div class="fh-blk-head fh-adm-gap"><h2>This round</h2><span class="fh-sub">' + (c.withdrawnCount ? c.withdrawnCount + ' withdrawn' : '') + '</span></div>';
    if (!(c.contracts || []).length) h += '<p class="fh-empty">No open contracts in this round yet.</p>';
    else {
      h += '<div class="fh-adm-table">' + (c.contracts || []).map(function (x) {
        return '<div class="fh-adm-trow"><span class="fh-mono fh-strong">' + esc(x.registration) + '</span>' +
          '<span class="fh-ty">' + esc(x.type || '—') + '</span>' +
          '<span>' + x.legs + ' leg' + (x.legs === 1 ? '' : 's') + '</span>' +
          '<span class="fh-mono">' + (x.bidCount || 0) + ' bid' + (x.bidCount === 1 ? '' : 's') + '</span></div>';
      }).join('') + '</div>';
    }
    var missing = (c.reasons || []).filter(function (r) { return r && r.registration; });
    if (missing.length) {
      h += '<div class="fh-blk-head fh-adm-gap"><h2>Not in this round</h2></div><div class="fh-adm-table">' +
        missing.map(function (r) {
          return '<div class="fh-adm-trow fh-adm-trow-2"><span class="fh-mono fh-strong">' + esc(r.registration) + '</span>' +
            '<span class="' + (r.fixable ? 'fh-c-warn' : 'fh-dim') + '">' + esc(r.message || r.reason || '') + '</span></div>';
        }).join('') + '</div>';
    }
    // eslint-disable-next-line no-unsanitized/property -- safe: numbers and formatted counts only
    el.innerHTML = h;
  }
  function stat(k, v) {
    return '<div class="fh-stat"><span class="fh-k">' + k + '</span><span class="fh-adm-stat-v fh-mono">' + v + '</span></div>';
  }

  // ── Metrics + Rewards settings (assets/js/fleet-admin-metrics.js, lazy) ──
  var mxLoad = null;
  function asset(p) { return typeof window.INVA_ASSET === 'function' ? window.INVA_ASSET(p) : p; }
  function loadMx() {
    if (window.INVA_FLEET_ADMIN_MX) return Promise.resolve(window.INVA_FLEET_ADMIN_MX);
    if (mxLoad) return mxLoad;
    mxLoad = new Promise(function (resolve, reject) {
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = asset('/assets/css/fleet-admin-metrics.css');
      document.head.appendChild(link);
      var s = document.createElement('script');
      s.src = asset('/assets/js/fleet-admin-metrics.js');
      s.onload = function () { resolve(window.INVA_FLEET_ADMIN_MX); };
      s.onerror = function () { mxLoad = null; reject(new Error('Could not load the metrics screen.')); };
      document.head.appendChild(s);
    });
    return mxLoad;
  }
  function openMx(tab) {
    var el = $(tab === 'metrics' ? 'fhAdmMetrics' : 'fhAdmRewards');
    return loadMx().then(function (m) {
      m.mount({ act: act, esc: esc, toast: toast, confirmBox: confirmBox });
      m.open(tab, false);
    }).catch(function (e) {
      if (el) el.innerHTML = '<p class="fh-adm-warn" role="alert">' + esc((e && e.message) || 'Could not load.') + '</p>';
    });
  }

  // ── Activity ──────────────────────────────────────────────────────────────
  function paintActivity() {
    var el = $('fhAdmActivity');
    // eslint-disable-next-line no-unsanitized/property -- safe: markup built by this module (data escaped where built) or an internal enum/constant
    if (!st.data) { el.innerHTML = skeleton(4); return; }
    var list = st.data.activity || [];
    if (st.data.errors && st.data.errors.activity) { el.innerHTML = '<p class="fh-adm-warn">' + esc(st.data.errors.activity) + '</p>'; return; }
    if (!list.length) { el.innerHTML = '<p class="fh-empty">Nothing yet. Every change made on this screen is listed here, newest first.</p>'; return; }
    // eslint-disable-next-line no-unsanitized/property -- safe: numbers and formatted counts only
    el.innerHTML = '<ol class="fh-adm-activity">' + list.map(function (a) {
      var t = Date.parse(a.at);
      return '<li><span class="fh-adm-act-when fh-mono" title="' + (validMs(t) ? fmtDay(t) + ' ' + fmtClock(t) + ' IST' : '') + '">' + esc(ago(a.at)) + '</span>' +
        '<span class="fh-adm-act-what">' + esc(a.summary || a.action || '') + '</span>' +
        '<span class="fh-dim fh-adm-act-who">' + esc(a.actorName || '') + '</span></li>';
    }).join('') + '</ol>';
  }

  // ── Flight log ────────────────────────────────────────────────────────────
  // Who actually flew each leg, from IF's per-aircraft flight log
  // (`pilotFlightTimes`), matched by the server to the leg it most likely was
  // (lib/actions/fleet-flight-log.js). One tail per request; the fleet scan
  // walks the tails one at a time because the org connection shares IF's
  // per-minute limit with Discord, the crons and every approval. Infinite Flight
  // limits that org token to 20 requests/minute, so one tail every 3.5 s (about
  // 17/minute) leaves the rest of the budget to everything else.
  var LOG_SCAN_PAUSE_MS = 3500;
  var LOG_MATCH = { time: 'matched by time', crew: 'matched by crew', route: 'matched by route only' };
  var LOG_STATUS = { 0: 'In the air', 2: 'Cancelled' };

  function logDur(seconds) {
    var m = Math.round((Number(seconds) || 0) / 60);
    return Math.floor(m / 60) + 'h ' + ('0' + (m % 60)).slice(-2) + 'm';
  }

  function logWho(p) {
    var inva = p.inva;
    var ifName = p.username || 'Unknown IF user';
    if (inva) {
      return '<span class="fh-strong">' + esc(inva.name || ifName) + '</span>' +
        (inva.callsign ? ' <span class="fh-mono fh-dim">' + esc(inva.callsign) + '</span>' : '') +
        (inva.name && inva.name !== ifName ? '<span class="fh-flog-ifname">' + esc(ifName) + '</span>' : '');
    }
    return '<span class="fh-strong">' + esc(ifName) + '</span> <span class="fh-flog-tag warn">not linked to INVA</span>';
  }

  function logFlight(f) {
    var total = f.pilots.reduce(function (s, p) { return s + p.seconds; }, 0) || 1;
    var dep = Date.parse(f.departedAt);
    var pilots = f.pilots.map(function (p) {
      var pct = Math.round((p.seconds / total) * 100);
      var tags = [];
      if (f.leg && !p.assigned) tags.push('<span class="fh-flog-tag warn">not assigned</span>');
      if (p.periods > 1) tags.push('<span class="fh-flog-tag">' + p.periods + ' stints</span>');
      return '<li class="fh-flog-pilot"><div class="fh-flog-pilot-top"><span class="fh-flog-who">' + logWho(p) + '</span>' +
        '<span class="fh-mono fh-flog-time">' + logDur(p.seconds) + ' <span class="fh-dim">' + pct + '%</span></span></div>' +
        '<div class="fh-flog-bar" aria-hidden="true"><span style="width:' + pct + '%"></span></div>' +
        (tags.length ? '<div class="fh-flog-tags">' + tags.join('') + '</div>' : '') + '</li>';
    }).join('');
    var noShows = f.leg ? f.leg.assigned.filter(function (a) { return !a.flew; }) : [];
    return '<article class="fh-flog">' +
      '<div class="fh-flog-meta">' +
        '<div class="fh-flog-route fh-mono"><span class="fh-strong">' + esc(f.originIcao || '????') + '</span> <span class="fh-dim">→</span> <span class="fh-strong">' + esc(f.destinationIcao || '????') + '</span></div>' +
        '<div class="fh-flog-sub fh-mono">' + (validMs(dep) ? esc(fmtDay(dep) + ' ' + fmtClock(dep)) + ' IST' : '—') +
          ' · ' + logDur(f.flightMinutes * 60) + (st.log.tailId ? '' : ' · ' + esc(f.registration || '')) +
          (LOG_STATUS[f.status] ? ' · <span class="' + (f.status === 0 ? 'fh-c-air' : 'fh-c-bad') + '">' + LOG_STATUS[f.status] + '</span>' : '') + '</div>' +
        '<div class="fh-flog-leg">' + (f.leg
          ? '<span class="fh-mono">' + esc(f.leg.callsign || '—') + '</span> <span class="fh-flog-match' + (f.leg.matchedBy === 'route' ? ' weak' : '') + '">' + LOG_MATCH[f.leg.matchedBy] + '</span>'
          : '<span class="fh-dim">No leg found</span>') + '</div>' +
      '</div>' +
      '<div class="fh-flog-crew">' +
        (pilots ? '<ul class="fh-flog-pilots">' + pilots + '</ul>' : '<p class="fh-dim">No pilot time recorded.</p>') +
        (noShows.length ? '<p class="fh-flog-noshow">Assigned but did not fly: ' + noShows.map(function (a) {
          return esc((a.inva && (a.inva.name || a.inva.callsign)) || a.username || 'Unknown') + ' <span class="fh-dim">(' + esc(a.role) + ')</span>';
        }).join(', ') + '</p>' : '') +
      '</div></article>';
  }

  /** Per-pilot totals over a set of flights, most time first. */
  function logPilotRows(flights) {
    var by = {};
    var order = [];
    flights.forEach(function (f) {
      f.pilots.forEach(function (p) {
        var r = by[p.userId];
        if (!r) { r = by[p.userId] = { p: p, seconds: 0, flights: 0, unassigned: 0, tails: {} }; order.push(r); }
        r.seconds += p.seconds;
        r.flights += 1;
        if (f.leg && !p.assigned) r.unassigned += 1;
        if (f.registration) r.tails[f.registration] = true;
        if (!r.p.inva && p.inva) r.p = p;
      });
    });
    return order.sort(function (x, y) { return y.seconds - x.seconds; });
  }

  function logPilots(flights) {
    var rows = logPilotRows(flights);
    if (!rows.length) return '<p class="fh-empty">No pilot time in the flights loaded.</p>';
    return '<ol class="fh-flog-sum">' + rows.map(function (r) {
      return '<li><span class="fh-flog-who">' + logWho(r.p) + '</span>' +
        '<span class="fh-mono fh-strong fh-flog-sum-time">' + logDur(r.seconds) + '</span>' +
        '<span class="fh-flog-sum-facts fh-mono fh-dim">' + r.flights + (r.flights === 1 ? ' flight' : ' flights') +
          (r.unassigned ? ' · <span class="fh-c-warn">' + r.unassigned + ' not assigned</span>' : '') +
          ' · ' + esc(Object.keys(r.tails).join(', ')) + '</span></li>';
    }).join('') + '</ol>';
  }

  function paintLog() {
    var el = $('fhAdmLog');
    if (!el) return;
    var L = st.log;
    var usingScan = !L.tailId && L.scanFlights.length > 0;
    var set = usingScan ? L.scanFlights : L.flights;
    var list = tails();
    var view = usingScan ? 'pilots' : L.view;

    var controls = '<div class="fh-flog-tools">' +
      '<label class="fh-sortwrap fh-flog-pick"><span class="fh-sortlab">Aircraft</span>' +
        '<select class="fh-select" id="fhAdmLogTail"><option value="">Choose…</option>' + list.map(function (t) {
          return '<option value="' + esc(t.id) + '"' + (t.id === L.tailId ? ' selected' : '') + '>' + esc(t.reg) + (t.type ? ' · ' + esc(t.type) : '') + '</option>';
        }).join('') + '</select></label>' +
      '<div class="fh-seg" role="group" aria-label="View">' +
        '<button type="button" data-admlogview="legs" class="' + (view === 'legs' ? 'on' : '') + '" aria-pressed="' + (view === 'legs') + '"' + (usingScan ? ' disabled' : '') + '>By leg</button>' +
        '<button type="button" data-admlogview="pilots" class="' + (view === 'pilots' ? 'on' : '') + '" aria-pressed="' + (view === 'pilots') + '">By pilot</button>' +
      '</div>' +
      '<button class="fh-btn" type="button" data-admlogscan="1" title="Reads every aircraft’s latest 25 flights, one at a time">' + (L.scan ? 'Stop scan' : 'Scan whole fleet') + '</button>' +
    '</div>';

    var status = L.scan
      ? '<p class="fh-flog-note" aria-live="polite">Reading aircraft ' + L.scan.done + ' of ' + L.scan.total + ', one at a time to stay inside Infinite Flight’s rate limit.</p>'
      : '';
    var err = L.error ? '<p class="fh-adm-warn" role="alert">' + esc(L.error) + '</p>' : '';

    var body;
    if (!L.tailId && !usingScan) {
      body = '<p class="fh-empty">Pick an aircraft to see who flew its legs and for how long, or scan the whole fleet for a per-pilot summary.</p>';
    } else if (L.loading && !set.length) {
      body = skeleton(3);
    } else if (!set.length) {
      body = '<p class="fh-empty">No flights in this aircraft’s log yet.</p>';
    } else {
      body = (usingScan ? '<p class="fh-flog-note">Whole fleet · latest ' + set.length + ' flights across ' +
          Object.keys(set.reduce(function (o, f) { o[f.registration] = 1; return o; }, {})).length + ' aircraft</p>' : '') +
        (view === 'pilots' ? logPilots(set) : '<div class="fh-flog-list">' + set.map(logFlight).join('') + '</div>') +
        (!usingScan && L.page < L.totalPages
          ? '<div class="fh-flog-more"><button class="fh-btn" type="button" data-admlogmore="1"' + (L.loading ? ' disabled' : '') + '>' + (L.loading ? 'Loading…' : 'Load older flights') + '</button></div>'
          : '');
    }
    // eslint-disable-next-line no-unsanitized/property -- safe: markup built by this module (data escaped where built) or an internal enum/constant
    el.innerHTML = controls + status + err + body;
  }

  function loadLog(tailId, page) {
    var L = st.log;
    L.loading = true;
    L.error = null;
    paintLog();
    return act('flightlog', { aircraftId: tailId, page: page, pageSize: 25 }).then(function (r) {
      if (L.tailId !== tailId) return;             // picked another tail meanwhile
      L.flights = page === 1 ? r.flights : L.flights.concat(r.flights);
      L.page = r.page;
      L.totalPages = r.totalPages;
    }).catch(function (e) {
      L.error = (e && e.message) || 'Could not load the flight log.';
    }).then(function () {
      L.loading = false;
      if (st.tab === 'log') paintLog();
    });
  }

  function scanLog() {
    var L = st.log;
    if (L.scan) { L.scan.stop = true; return; }
    var list = tails().filter(function (t) { return !t.stored; });
    var scan = L.scan = { done: 0, total: list.length, stop: false };
    L.scanFlights = [];
    L.tailId = '';
    L.error = null;
    paintLog();
    var i = 0;
    function next() {
      if (scan.stop || i >= list.length) { L.scan = null; if (st.tab === 'log') paintLog(); return; }
      var t = list[i++];
      act('flightlog', { aircraftId: t.id, page: 1, pageSize: 25 }).then(function (r) {
        L.scanFlights = L.scanFlights.concat(r.flights);
      }).catch(function (e) {
        L.error = t.reg + ': ' + ((e && e.message) || 'could not be read.');
        if (e && e.code === 'IF_RATE_LIMITED') { scan.stop = true; L.error += ' The scan stopped; try again in a minute.'; }
      }).then(function () {
        scan.done += 1;
        if (st.tab === 'log') paintLog();
        if (scan.stop || i >= list.length) return next();
        setTimeout(next, LOG_SCAN_PAUSE_MS);
      });
    }
    next();
  }

  function skeleton(n) {
    var h = '';
    for (var i = 0; i < n; i++) h += '<div class="fh-skel-row"><span class="fh-skel" style="width:' + (40 + (i * 13) % 30) + '%"></span><span class="fh-skel" style="width:' + (60 + (i * 17) % 30) + '%"></span></div>';
    return h;
  }

  // ════════════════════════════════════════════════════════════════════════
  // Dialogs
  // ════════════════════════════════════════════════════════════════════════
  var lastFocus = null;
  function openModal(title, sub, wide) {
    lastFocus = document.activeElement;
    $('fhAdmMTitle').textContent = title;
    $('fhAdmMSub').textContent = sub || '';
    $('fhAdmModal').classList.toggle('fh-adm-wide', !!wide);
    $('fhAdmModal').hidden = false;
    document.documentElement.classList.add('fh-lock');
  }
  /** Focus a field in a dialog that has just opened. Synchronous on purpose:
   *  a deferred focus lands wherever the user has ALREADY started typing and
   *  carries their next keystrokes into the wrong field. */
  function focusIn(el) {
    if (el && !$('fhAdmModal').contains(document.activeElement)) el.focus();
  }
  function closeModal() {
    dlg = null;
    $('fhAdmModal').hidden = true;
    $('fhAdmMBody').innerHTML = '';
    $('fhAdmMActions').innerHTML = '';
    if (!cfm) document.documentElement.classList.remove('fh-lock');
    if (lastFocus && lastFocus.focus && document.body.contains(lastFocus)) lastFocus.focus();
  }
  function confirmBox(opts) {
    cfm = opts;
    $('fhAdmCTitle').textContent = opts.title;
    // eslint-disable-next-line no-unsanitized/property -- safe: markup built by this module (data escaped where built) or an internal enum/constant
    $('fhAdmCBody').innerHTML = opts.body;
    // eslint-disable-next-line no-unsanitized/property -- safe: static markup; every dynamic value is escaped
    $('fhAdmCActions').innerHTML =
      '<button class="fh-btn" type="button" data-admcfcancel="1">' + esc(opts.cancelLabel || 'Cancel') + '</button>' +
      '<button class="' + (opts.danger ? 'fh-btn fh-btn-danger' : 'fh-btn-primary') + '" type="button" data-admcfok="1">' + esc(opts.okLabel || 'Confirm') + '</button>';
    $('fhAdmConfirm').hidden = false;
    document.documentElement.classList.add('fh-lock');
    var ok = $('fhAdmConfirm').querySelector('[data-admcfcancel]');
    if (ok) ok.focus();
  }
  function closeConfirm() {
    cfm = null;
    $('fhAdmConfirm').hidden = true;
    if ($('fhAdmModal').hidden) document.documentElement.classList.remove('fh-lock');
  }

  // ── Leg editor ────────────────────────────────────────────────────────────
  /** @param {'create'|'edit'|'return'|'duplicate'} mode */
  function openLegForm(mode, tailId, legId) {
    var tail = tailById(tailId);
    if (!tail) return;
    var src = legId ? legOf(tail, legId) : null;
    var v = { callsign: '', flightType: 1, originIcao: '', destinationIcao: '', depMs: NaN, blockMs: NaN, briefing: '', flightPlan: '', timeless: true };
    var last = tail.open[tail.open.length - 1] || tail.legs[tail.legs.length - 1] || null;
    var srcDep = src ? Date.parse(src.scheduledDepartureUtc) : NaN;
    var srcArr = src ? Date.parse(src.scheduledArrivalUtc) : NaN;
    var srcBlock = timed(srcDep) && timed(srcArr) ? srcArr - srcDep : NaN;
    var roundUp = function (ms) { var step = 5 * 60000; return Math.ceil(ms / step) * step; };

    if (mode === 'edit' && src) {
      v = {
        callsign: src.callsign || '', flightType: Number(src.flightType) || 0,
        originIcao: src.originIcao || '', destinationIcao: src.destinationIcao || '',
        depMs: timed(srcDep) ? srcDep : NaN, blockMs: srcBlock,
        briefing: src.briefing || '', flightPlan: src.flightPlan || '',
        // Every INVA leg is timeless unless somebody chose times for it.
        timeless: src.isTimeless === true || !timed(srcDep),
      };
    } else if (mode === 'return' && src) {
      v.callsign = nextCallsign(src.callsign);
      v.flightType = Number(src.flightType) || 1;
      v.originIcao = src.destinationIcao || '';
      v.destinationIcao = src.originIcao || '';
      v.depMs = timed(srcArr) ? roundUp(srcArr + H) : roundUp(Date.now() + H);
      v.blockMs = srcBlock;
    } else if (mode === 'duplicate' && src) {
      v.callsign = src.callsign || '';
      v.flightType = Number(src.flightType) || 1;
      v.originIcao = src.originIcao || '';
      v.destinationIcao = src.destinationIcao || '';
      v.depMs = timed(srcDep) ? srcDep + 24 * H : roundUp(Date.now() + H);
      v.blockMs = srcBlock;
      v.briefing = src.briefing || '';
      v.flightPlan = src.flightPlan || '';
    } else {
      // A new leg starts where the aircraft will be: after its last open leg,
      // or where it is parked, an hour after whichever is later.
      var lastArr = last ? Date.parse(last.scheduledArrivalUtc) : NaN;
      v.originIcao = (last && !CLOSED[last.status] ? last.destinationIcao : tail.at) || (last ? last.destinationIcao : '') || '';
      v.callsign = last ? nextCallsign(last.callsign) : '';
      v.depMs = roundUp(Math.max(Date.now() + H, timed(lastArr) ? lastArr + H : 0));
    }

    dlg = { kind: 'leg', mode: mode, tailId: tail.id, legId: mode === 'edit' ? legId : null, blockTouched: mode === 'edit' || validMs(v.blockMs), errors: {}, busy: false };
    var titles = { create: 'Add leg', edit: 'Edit leg', 'return': 'Add return leg', duplicate: 'Duplicate leg' };
    openModal(titles[mode], tail.reg + (tail.type ? ' · ' + tail.type : ''), true);

    var p = validMs(v.depMs) ? istParts(v.depMs) : { date: '', time: '' };
    var moreOpen = !!(v.briefing || v.flightPlan);
    // eslint-disable-next-line no-unsanitized/property -- safe: markup built by this module (data escaped where built) or an internal enum/constant
    $('fhAdmMBody').innerHTML =
      '<form class="fh-adm-form" id="fhAdmLegForm" novalidate>' +
      (tail.bidOnly ? '<p class="fh-adm-warn">' + esc(tail.reg) + ' is bid-only. This leg will be packaged into the next Fleet Contracts sync.</p>' : '') +
      '<div class="fh-adm-row2">' +
        field('callsign', 'Callsign', '<input class="fh-input fh-mono fh-upper" id="fhAdmF_callsign" name="callsign" maxlength="32" autocomplete="off" spellcheck="false" value="' + esc(v.callsign) + '" placeholder="e.g. AIC101">',
          '<span class="fh-field-hint fh-c-warn" data-hint="callsign"></span>') +
        field('flightType', 'Flight type', '<select class="fh-input" id="fhAdmF_flightType" name="flightType">' + FLIGHT_TYPES.map(function (t) {
          return '<option value="' + t[0] + '"' + (t[0] === v.flightType ? ' selected' : '') + '>' + t[1] + '</option>';
        }).join('') + '</select>') +
      '</div>' +
      '<div class="fh-adm-od">' +
        field('originIcao', 'From', '<input class="fh-input fh-mono fh-upper" id="fhAdmF_originIcao" name="originIcao" maxlength="8" autocomplete="off" spellcheck="false" value="' + esc(v.originIcao) + '" placeholder="ICAO">', '<span class="fh-field-hint" id="fhAdmApO"></span>') +
        '<button class="fh-adm-icon fh-adm-swap" type="button" data-admswap="1" aria-label="Swap from and to">⇄</button>' +
        field('destinationIcao', 'To', '<input class="fh-input fh-mono fh-upper" id="fhAdmF_destinationIcao" name="destinationIcao" maxlength="8" autocomplete="off" spellcheck="false" value="' + esc(v.destinationIcao) + '" placeholder="ICAO">', '<span class="fh-field-hint" id="fhAdmApD"></span>') +
      '</div>' +
      '<label class="fh-adm-check"><input type="checkbox" id="fhAdmF_timeless" name="timeless"' + (v.timeless ? ' checked' : '') + '>' +
        '<span><strong>Timeless</strong> <span class="fh-dim">— no set time; pilots fly it when they want</span></span></label>' +
      '<div class="fh-adm-row3" id="fhAdmTimes"' + (v.timeless ? ' hidden' : '') + '>' +
        field('scheduledDepartureUtc', 'Departure date (IST)', '<input class="fh-input fh-mono" type="date" id="fhAdmF_depDate" name="depDate" value="' + esc(p.date) + '">') +
        field('depTime', 'Time (IST)', '<input class="fh-input fh-mono" type="time" step="300" id="fhAdmF_depTime" name="depTime" value="' + esc(p.time) + '">') +
        field('scheduledArrivalUtc', 'Block time', '<input class="fh-input fh-mono" id="fhAdmF_block" name="block" inputmode="numeric" autocomplete="off" placeholder="h:mm" value="' + (validMs(v.blockMs) ? blockText(v.blockMs) : '') + '">') +
      '</div>' +
      '<p class="fh-adm-summary" id="fhAdmLegSummary" aria-live="polite"></p>' +
      '<details class="fh-adm-more"' + (moreOpen ? ' open' : '') + '><summary>Briefing and flight plan <span class="fh-dim">(optional)</span></summary>' +
        field('briefing', 'Briefing', '<textarea class="fh-input fh-textarea" id="fhAdmF_briefing" name="briefing" rows="3" maxlength="4000" placeholder="Shown to the crew on Infinite Flight">' + esc(v.briefing) + '</textarea>', '<span class="fh-field-hint" data-count="briefing"></span>') +
        field('flightPlan', 'Flight plan', '<textarea class="fh-input fh-textarea fh-mono" id="fhAdmF_flightPlan" name="flightPlan" rows="3" maxlength="16000" spellcheck="false" placeholder="VIDP DCT DPN DCT BBB DCT VABB">' + esc(v.flightPlan) + '</textarea>', '<span class="fh-field-hint" data-count="flightPlan"></span>') +
      '</details>' +
      '<p class="fh-adm-formerr" id="fhAdmFormErr" role="alert" hidden></p>' +
      '</form>';
    // eslint-disable-next-line no-unsanitized/property -- safe: static markup; every dynamic value is escaped
    $('fhAdmMActions').innerHTML =
      '<button class="fh-btn" type="button" data-admclose="1">Cancel</button>' +
      '<button class="fh-btn-primary" type="submit" form="fhAdmLegForm" id="fhAdmLegSave">' + (mode === 'edit' ? 'Save changes' : 'Add leg') + '</button>';
    [v.originIcao, v.destinationIcao].forEach(function (i) { lookupAirport(i, updateLegSummary); });
    updateLegSummary();
    // Focus the field this mode most likely needs next: a new leg already
    // knows where it starts, a return or duplicate already knows its route.
    var focusOn = mode === 'edit' ? 'callsign'
      : mode === 'create' ? (!v.originIcao ? 'originIcao' : 'destinationIcao')
        : 'depTime';
    var first = $('fhAdmF_' + focusOn);
    focusIn(first);
  }

  function field(name, label, control, after) {
    var id = (/id="([^"]+)"/.exec(control) || [])[1] || '';
    return '<div class="fh-field" data-field="' + name + '"><label class="fh-field-label" for="' + id + '">' + label + '</label>' +
      control + (after || '') + '<span class="fh-field-err" data-err="' + name + '"></span></div>';
  }

  function legFormValues() {
    var g = function (id) { var el = $('fhAdmF_' + id); return el ? el.value : ''; };
    var depMs = istToUtcMs(g('depDate'), g('depTime'));
    var blockMs = parseBlock(g('block'));
    return {
      callsign: g('callsign').trim().toUpperCase(),
      flightType: Number(g('flightType')),
      originIcao: g('originIcao').trim().toUpperCase(),
      destinationIcao: g('destinationIcao').trim().toUpperCase(),
      depMs: depMs,
      blockMs: blockMs,
      timeless: !!($('fhAdmF_timeless') && $('fhAdmF_timeless').checked),
      briefing: g('briefing'),
      flightPlan: g('flightPlan'),
    };
  }

  /** Client-side mirror of validateSchedule() — instant, field by field. */
  function legErrors(v) {
    var e = {};
    if (!v.callsign) e.callsign = 'Callsign is required.';
    else if (v.callsign.length > 32) e.callsign = '32 characters at most.';
    if (!/^[A-Z0-9]{1,8}$/.test(v.originIcao)) e.originIcao = 'Enter an airport code.';
    if (!/^[A-Z0-9]{1,8}$/.test(v.destinationIcao)) e.destinationIcao = 'Enter an airport code.';
    if (!v.timeless) {
      if (!validMs(v.depMs)) e.scheduledDepartureUtc = 'Pick a date and time.';
      if (!(v.blockMs > 0)) e.scheduledArrivalUtc = 'Enter the block time, e.g. 2:10.';
      else if (v.blockMs > 24 * H) e.scheduledArrivalUtc = 'Longer than 24 hours — check it.';
    }
    if (v.briefing.length > 4000) e.briefing = '4,000 characters at most.';
    if (v.flightPlan.length > 16000) e.flightPlan = '16,000 characters at most.';
    return e;
  }

  function showFieldErrors(errs) {
    var body = $('fhAdmMBody');
    if (!body) return;
    Array.prototype.forEach.call(body.querySelectorAll('[data-err]'), function (n) {
      var k = n.getAttribute('data-err');
      n.textContent = errs[k] || '';
      var f = n.closest('.fh-field');
      if (f) f.classList.toggle('err', !!errs[k]);
    });
  }

  function updateLegSummary() {
    if (!dlg || dlg.kind !== 'leg') return;
    var v = legFormValues();
    var tail = tailById(dlg.tailId);
    var o = $('fhAdmApO'), d = $('fhAdmApD');
    // A callsign already flying on this tail is legal but almost always a slip.
    var csHint = document.querySelector('[data-hint="callsign"]');
    if (csHint) {
      var dupe = v.callsign && tail ? tail.open.find(function (s) {
        return s.id !== dlg.legId && String(s.callsign || '').toUpperCase() === v.callsign;
      }) : null;
      var dd = dupe ? Date.parse(dupe.scheduledDepartureUtc) : NaN;
      csHint.textContent = dupe ? 'Already used on ' + tail.reg + (timed(dd) ? ' (' + fmtDay(dd) + ')' : '') + '.' : '';
    }
    if (o) o.textContent = apLabel(v.originIcao) || (v.originIcao.length >= 4 && apCache[v.originIcao] === false ? 'Not in our airport list. Check the code.' : '');
    if (d) {
      d.textContent = v.destinationIcao && v.destinationIcao === v.originIcao
        ? 'Same as From. Fine for a local training flight; otherwise check it.'
        : apLabel(v.destinationIcao) || (v.destinationIcao.length >= 4 && apCache[v.destinationIcao] === false ? 'Not in our airport list. Check the code.' : '');
    }

    // Block time follows the route until somebody types one.
    var est = estimateBlockMs(v.originIcao, v.destinationIcao, tail);
    var blockEl = $('fhAdmF_block');
    if (est && !dlg.blockTouched && blockEl) {
      blockEl.value = blockText(est);
      v.blockMs = est;
    }
    var sum = $('fhAdmLegSummary');
    var times = $('fhAdmTimes');
    if (times) times.hidden = v.timeless;
    if (sum) {
      if (v.timeless) {
        sum.innerHTML = '<span class="fh-mono fh-strong">' + esc(v.originIcao || '????') + '</span> <span class="fh-arr">→</span> ' +
          '<span class="fh-mono fh-strong">' + esc(v.destinationIcao || '????') + '</span><span class="fh-dim"> · timeless</span>';
      } else if (validMs(v.depMs) && v.blockMs > 0) {
        var arr = v.depMs + v.blockMs;
        // eslint-disable-next-line no-unsanitized/property -- safe: markup built by this module (data escaped where built) or an internal enum/constant
        sum.innerHTML = '<span class="fh-mono fh-strong">' + esc(v.originIcao || '????') + ' ' + fmtClock(v.depMs) + '</span> <span class="fh-arr">→</span> ' +
          '<span class="fh-mono fh-strong">' + esc(v.destinationIcao || '????') + ' ' + fmtClock(arr) + '</span> IST' +
          (istParts(arr).date !== istParts(v.depMs).date ? ' <span class="fh-c-warn">(+1 day)</span>' : '') +
          '<span class="fh-dim"> · ' + fmtDay(v.depMs) + ' · ' + fmtUtc(v.depMs) + ' – ' + fmtUtc(arr) + '</span>' +
          (est && dlg.blockTouched && Math.abs(est - v.blockMs) > 20 * 60000
            ? '<br><span class="fh-dim">Estimated block for this route is about ' + fmtDur(est) + '. </span><button class="fh-adm-inline" type="button" data-admuseest="' + est + '">Use it</button>'
            : '');
      } else {
        sum.innerHTML = '<span class="fh-dim">Pick a departure time and block time to see the arrival.</span>';
      }
    }
    ['briefing', 'flightPlan'].forEach(function (k) {
      var c = document.querySelector('[data-count="' + k + '"]');
      var el = $('fhAdmF_' + k);
      if (c && el) c.textContent = el.value.length ? el.value.length.toLocaleString('en-IN') + ' / ' + (k === 'briefing' ? '4,000' : '16,000') : '';
    });
  }

  function submitLegForm() {
    if (!dlg || dlg.kind !== 'leg' || dlg.busy) return;
    var v = legFormValues();
    var errs = legErrors(v);
    showFieldErrors(errs);
    if (Object.keys(errs).length) {
      var firstBad = $('fhAdmMBody').querySelector('.fh-field.err .fh-input');
      if (firstBad) firstBad.focus();
      return;
    }
    var schedule = {
      callsign: v.callsign,
      flightType: v.flightType,
      originIcao: v.originIcao,
      destinationIcao: v.destinationIcao,
      isTimeless: v.timeless,
      scheduledDepartureUtc: v.timeless ? null : new Date(v.depMs).toISOString(),
      scheduledArrivalUtc: v.timeless ? null : new Date(v.depMs + v.blockMs).toISOString(),
      briefing: v.briefing.trim() ? v.briefing : null,
      flightPlan: v.flightPlan.trim() ? v.flightPlan.trim() : null,
    };
    var d = dlg;
    d.busy = true;
    var btn = $('fhAdmLegSave');
    if (btn) { btn.disabled = true; btn.textContent = d.mode === 'edit' ? 'Saving…' : 'Adding…'; }
    var tail = tailById(d.tailId);
    act(d.mode === 'edit' ? 'schedule.update' : 'schedule.create', {
      aircraftId: d.tailId, scheduleId: d.legId, schedule: schedule,
    }).then(function () {
      closeModal();
      toast((d.mode === 'edit' ? 'Saved ' : 'Added ') + schedule.callsign + ' ' + schedule.originIcao + '→' + schedule.destinationIcao + (tail ? ' on ' + tail.reg : '') + '.');
      st.tail = d.tailId;
      return refreshAll(d.tailId);
    }).catch(function (e) {
      d.busy = false;
      if (btn) { btn.disabled = false; btn.textContent = d.mode === 'edit' ? 'Save changes' : 'Add leg'; }
      var fields = e && e.detail && e.detail.fields;
      if (fields) showFieldErrors(fields);
      var fe = $('fhAdmFormErr');
      if (fe) { fe.hidden = false; fe.textContent = (e && e.message) || 'Infinite Flight did not accept the leg.'; }
    });
  }

  // ── Flight plan ───────────────────────────────────────────────────────────
  function openPlan(tailId, legId) {
    var tail = tailById(tailId), s = legOf(tail, legId);
    if (!s) return;
    dlg = { kind: 'plan', tailId: tailId, legId: legId };
    openModal('Flight plan', (s.callsign || '—') + ' · ' + s.originIcao + ' → ' + s.destinationIcao + ' · ' + tail.reg, true);
    // eslint-disable-next-line no-unsanitized/property -- safe: markup built by this module (data escaped where built) or an internal enum/constant
    $('fhAdmMBody').innerHTML = '<div class="fh-adm-form">' +
      field('flightPlan', 'Route string', '<textarea class="fh-input fh-textarea fh-mono" id="fhAdmF_plan" rows="6" maxlength="16000" spellcheck="false" placeholder="' + esc(s.originIcao + ' DCT … ' + s.destinationIcao) + '">' + esc(s.flightPlan || '') + '</textarea>',
        '<span class="fh-field-hint">Pilots dispatching this leg from Fleet Mode get this route in SimBrief.</span>') +
      '<p class="fh-adm-formerr" id="fhAdmFormErr" role="alert" hidden></p></div>';
    // eslint-disable-next-line no-unsanitized/property -- safe: static markup; every dynamic value is escaped
    $('fhAdmMActions').innerHTML =
      (s.flightPlan ? '<button class="fh-btn" type="button" data-admplanclear="1">Clear plan</button>' : '<button class="fh-btn" type="button" data-admclose="1">Cancel</button>') +
      '<button class="fh-btn-primary" type="button" data-admplansave="1">Save plan</button>';
    focusIn($('fhAdmF_plan'));
  }
  function savePlan(clear) {
    if (!dlg || dlg.kind !== 'plan' || dlg.busy) return;
    var d = dlg;
    var plan = clear ? '' : ($('fhAdmF_plan').value || '');
    d.busy = true;
    Array.prototype.forEach.call($('fhAdmMActions').querySelectorAll('button'), function (b) { b.disabled = true; });
    act('schedule.flightplan', { aircraftId: d.tailId, scheduleId: d.legId, flightPlan: plan }).then(function () {
      closeModal();
      toast(clear || !plan.trim() ? 'Flight plan cleared.' : 'Flight plan saved.');
      return refreshAll(d.tailId);
    }).catch(function (e) {
      d.busy = false;
      Array.prototype.forEach.call($('fhAdmMActions').querySelectorAll('button'), function (b) { b.disabled = false; });
      var fe = $('fhAdmFormErr');
      if (fe) { fe.hidden = false; fe.textContent = (e && e.message) || 'Could not save the flight plan.'; }
    });
  }

  // ── Crew ──────────────────────────────────────────────────────────────────
  function openCrew(tailId, legId) {
    var tail = tailById(tailId), s = legOf(tail, legId);
    if (!s) return;
    dlg = { kind: 'crew', tailId: tailId, legId: legId, picking: null, query: '', busy: null, note: null, lookup: null };
    openModal('Crew', (s.callsign || '—') + ' · ' + s.originIcao + ' → ' + s.destinationIcao + ' · ' + tail.reg, true);
    $('fhAdmMActions').innerHTML = '<button class="fh-btn fh-span" type="button" data-admclose="1">Done</button>';
    paintCrew();
    // The roster is only read for this dialog; refetch it when it is stale.
    if (Date.now() - st.rosterAt > 600000) {
      loadData(true, ['roster']).then(function () { if (dlg && dlg.kind === 'crew' && !dlg.busy) paintCrew(); });
    }
  }

  function seatsFor(s) {
    var crew = crewOf(s);
    var cap = captainOf(s);
    var seats = [{ role: 0, member: cap }];
    crew.forEach(function (c) { if (c !== cap) seats.push({ role: Number(c.role), member: c }); });
    while (seats.length < CREW_CAP) seats.push({ role: 1, member: null });
    return seats.slice(0, Math.max(CREW_CAP, seats.length));
  }

  function paintCrew() {
    if (!dlg || dlg.kind !== 'crew') return;
    var tail = tailById(dlg.tailId), s = legOf(tail, dlg.legId);
    var body = $('fhAdmMBody');
    if (!s) {
      body.innerHTML = '<p class="fh-empty">This leg is no longer on ' + esc(tail ? tail.reg : 'the aircraft') + '.</p>';
      return;
    }
    var crew = crewOf(s);
    var full = crew.length >= CREW_CAP;
    var cap = captainOf(s);
    var h = '';
    if (tail.bidOnly) h += '<p class="fh-adm-warn"><strong>' + esc(tail.reg) + ' is bid-only.</strong> Seating a pilot here skips Fleet Contracts bidding. You will be asked to confirm.</p>';
    if (dlg.note) h += '<p class="fh-adm-warn" role="alert">' + dlg.note + '</p>';

    h += '<div class="fh-blk-head"><h2>Seats</h2><span class="fh-sub">' + crew.length + ' of ' + CREW_CAP + ' taken</span></div>';
    h += '<ul class="fh-seats">' + seatsFor(s).map(function (seat, i) {
      var m = seat.member;
      var label = seat.member ? (ROLE_NAME[seat.member.role] || 'Crew') : (i === 0 ? 'Captain' : 'First Officer');
      if (m) {
        var b = dlg.busy === m.userId;
        var other = Number(m.role) === 0 ? 1 : 0;
        var canSwap = other === 1 || !cap || cap.userId === m.userId;
        return '<li class="fh-seat"><span class="fh-seat-av" aria-hidden="true">' + esc(initials(m.username)) + '</span>' +
          '<span class="fh-seat-who"><span class="fh-seat-role">' + label + '</span><span class="fh-seat-name fh-pilot">' + esc(m.username || 'a pilot') + '</span></span>' +
          '<span class="fh-seat-act">' +
          (canSwap ? '<button class="fh-btn-ghost fh-btn-sm" type="button" data-admseatrole="' + esc(m.userId) + '" data-role="' + other + '" data-name="' + esc(m.username || '') + '"' + (b ? ' disabled' : '') + '>' + (other === 0 ? 'Make Captain' : 'Make FO') + '</button>' : '') +
          '<button class="fh-btn fh-btn-sm fh-btn-danger" type="button" data-admunseat="' + esc(m.userId) + '" data-name="' + esc(m.username || 'this pilot') + '"' + (b ? ' disabled' : '') + '>' + (b ? 'Working…' : 'Remove') + '</button>' +
          '</span></li>';
      }
      var role = i === 0 && !cap ? 0 : 1;
      var picking = dlg.picking !== null && dlg.pickSeat === i;
      return '<li class="fh-seat empty' + (picking ? ' picking' : '') + '"><span class="fh-seat-av empty" aria-hidden="true">+</span>' +
        '<span class="fh-seat-who"><span class="fh-seat-role">' + (i === 0 && !cap ? 'Captain' : 'First Officer') + '</span><span class="fh-seat-name fh-dim">' + (full ? 'Leg is full' : 'Empty seat') + '</span></span>' +
        '<span class="fh-seat-act">' + (full ? '' : '<button class="fh-btn fh-btn-sm" type="button" data-admpick="' + i + '" data-role="' + role + '">' + (picking ? 'Choosing…' : 'Assign') + '</button>') + '</span></li>';
    }).join('') + '</ul>';

    if (dlg.picking !== null) h += pickerHtml(s);
    // eslint-disable-next-line no-unsanitized/property -- safe: numbers and formatted counts only
    body.innerHTML = h;
    if (dlg.picking !== null) {
      var q = $('fhAdmPickQ');
      if (q && document.activeElement !== q) { q.value = dlg.query; q.focus(); }
      paintPickList();
    }
  }

  function initials(name) {
    var n = String(name || '').replace(/[^A-Za-z0-9 ._-]/g, '').split(/[\s._-]+/).filter(Boolean);
    return ((n[0] || '?').charAt(0) + (n[1] ? n[1].charAt(0) : (n[0] || '').charAt(1) || '')).toUpperCase();
  }

  function pickerHtml(s) {
    var cap = captainOf(s);
    var roleBtn = function (r) {
      var disabled = r === 0 && cap;
      return '<button type="button" class="' + (dlg.picking === r ? 'on' : '') + '" data-admpickrole="' + r + '"' +
        (disabled ? ' disabled title="' + esc((cap.username || 'Another pilot') + ' is Captain') + '"' : '') +
        ' aria-pressed="' + (dlg.picking === r) + '">' + ROLE_NAME[r] + '</button>';
    };
    return '<div class="fh-adm-picker">' +
      '<div class="fh-adm-picker-head"><span class="fh-field-label">Seat as</span><span class="fh-seg" role="group" aria-label="Seat">' + roleBtn(0) + roleBtn(1) + '</span>' +
      '<button class="fh-btn-ghost fh-btn-sm fh-adm-picker-x" type="button" data-admpickcancel="1">Cancel</button></div>' +
      '<input class="fh-search" id="fhAdmPickQ" type="search" autocomplete="off" spellcheck="false" placeholder="Name, callsign or IF username" aria-label="Search pilots">' +
      '<div class="fh-adm-picklist" id="fhAdmPickList" role="listbox" aria-label="Pilots"></div>' +
      '<div class="fh-adm-lookup"><span class="fh-dim">Not listed? Their career profile has no linked IF account yet.</span>' +
      '<span class="fh-adm-lookup-row"><input class="fh-input" id="fhAdmLookupQ" autocomplete="off" spellcheck="false" placeholder="IF username"><button class="fh-btn fh-btn-sm" type="button" data-admlookup="1">Look up</button></span>' +
      '<span id="fhAdmLookupOut"></span></div>' +
      '</div>';
  }

  function paintPickList() {
    var el = $('fhAdmPickList');
    if (!el || !dlg || dlg.kind !== 'crew') return;
    var s = legOf(tailById(dlg.tailId), dlg.legId);
    var seated = {};
    crewOf(s).forEach(function (c) { seated[c.userId] = true; });
    var roster = (st.data && st.data.roster) || [];
    var q = dlg.query.trim().toLowerCase();
    var list = roster.filter(function (p) {
      if (seated[p.ifUserId]) return false;
      if (!q) return true;
      return [p.name, p.callsign, p.ifUsername, p.rank].some(function (x) { return String(x || '').toLowerCase().indexOf(q) !== -1; });
    });
    var shown = list.slice(0, 30);
    if (!roster.length) {
      // eslint-disable-next-line no-unsanitized/property -- safe: static markup; every dynamic value is escaped
      el.innerHTML = '<p class="fh-dim fh-adm-pad">' + (st.data && st.data.errors && st.data.errors.roster ? esc(st.data.errors.roster) : 'No pilots have a linked Infinite Flight account yet.') + '</p>';
      return;
    }
    // eslint-disable-next-line no-unsanitized/property -- safe: markup built by this module (data escaped where built) or an internal enum/constant
    el.innerHTML = shown.length ? shown.map(function (p) {
      var b = dlg.busy === p.ifUserId;
      return '<button class="fh-pick" type="button" role="option" data-admseat="' + esc(p.ifUserId) + '" data-name="' + esc(p.name || p.ifUsername || '') + '"' + (dlg.busy ? ' disabled' : '') + '>' +
        '<span class="fh-seat-av" aria-hidden="true">' + esc(initials(p.name || p.ifUsername)) + '</span>' +
        '<span class="fh-pick-main"><span class="fh-pick-name">' + esc(p.name || p.ifUsername || 'Pilot') + (p.callsign ? ' <span class="fh-dim fh-mono">' + esc(p.callsign) + '</span>' : '') + '</span>' +
        '<span class="fh-pick-sub">' + esc([p.rank, p.ifUsername ? 'IF ' + p.ifUsername : null].filter(Boolean).join(' · ')) +
        (p.verified ? ' · <span class="fh-c-air">Fleet verified</span>' : '') + '</span></span>' +
        '<span class="fh-pick-go">' + (b ? 'Seating…' : 'Seat') + '</span></button>';
    }).join('') + (list.length > shown.length ? '<p class="fh-dim fh-adm-pad">' + (list.length - shown.length) + ' more — keep typing to narrow it down.</p>' : '')
      : '<p class="fh-dim fh-adm-pad">Nobody matches “' + esc(dlg.query) + '”.</p>';
  }

  function seatPilot(userId, name, role, override) {
    if (!dlg || dlg.kind !== 'crew' || dlg.busy) return;
    var d = dlg;
    d.busy = userId;
    d.note = null;
    paintCrew();
    act('crew.assign', {
      aircraftId: d.tailId, scheduleId: d.legId, userId: userId, role: role, pilotName: name || '', override: !!override,
    }).then(function (r) {
      if (r && r.schedule) patchLeg(d.tailId, r.schedule);
      d.busy = null;
      d.picking = null;
      d.query = '';
      toast((name || 'Pilot') + ' seated as ' + ROLE_NAME[role] + '.');
      paintCrew();
      refreshAll(d.tailId).then(paintCrew);
    }).catch(function (e) {
      d.busy = null;
      var code = e && e.code, det = (e && e.detail) || {};
      if (code === 'NEEDS_BIDDING') {
        paintCrew();
        return confirmBox({
          title: 'Skip bidding?',
          body: '<p>' + esc(e.message) + '</p><p>Seat <strong>' + esc(name || 'this pilot') + '</strong> as ' + ROLE_NAME[role] + ' anyway? The override is recorded in the admin activity.</p>',
          okLabel: 'Seat anyway',
          onOk: function () { seatPilot(userId, name, role, true); },
        });
      }
      if (code === 'CAPTAIN_TAKEN') {
        d.note = '<strong>' + esc(det.captainName || 'Another pilot') + '</strong> is already Captain. ' +
          (det.canSeatFirstOfficer ? '<button class="fh-adm-inline" type="button" data-admseatfo="' + esc(userId) + '" data-name="' + esc(name || '') + '">Seat ' + esc(name || 'them') + ' as First Officer instead</button>' : 'The leg is full.');
        d.picking = 1;
      } else {
        d.note = esc((e && e.message) || 'Could not seat that pilot.');
      }
      paintCrew();
    });
  }

  function unseat(userId, name) {
    var d = dlg;
    confirmBox({
      title: 'Remove ' + (name || 'this pilot') + '?',
      body: '<p>They come off the leg on Infinite Flight right away and get a Discord DM saying so.</p>',
      okLabel: 'Remove from leg',
      danger: true,
      onOk: function () {
        if (!dlg || dlg !== d) return;
        d.busy = userId;
        d.note = null;
        paintCrew();
        act('crew.remove', { aircraftId: d.tailId, scheduleId: d.legId, userId: userId }).then(function () {
          var t = tailById(d.tailId), s = legOf(t, d.legId);
          if (s) patchLeg(d.tailId, Object.assign({}, s, { crew: crewOf(s).filter(function (c) { return c.userId !== userId; }) }));
          d.busy = null;
          toast((name || 'Pilot') + ' removed from the leg.');
          paintCrew();
          refreshAll(d.tailId).then(paintCrew);
        }).catch(function (e) {
          d.busy = null;
          d.note = esc((e && e.message) || 'Could not remove that pilot.');
          paintCrew();
        });
      },
    });
  }

  function lookupPilot() {
    var q = $('fhAdmLookupQ');
    var out = $('fhAdmLookupOut');
    var name = q ? q.value.trim() : '';
    if (!name || !out) return;
    out.innerHTML = '<span class="fh-dim">Looking up…</span>';
    act('pilot.lookup', { username: name }).then(function (r) {
      var p = r.pilot;
      out.innerHTML = '<button class="fh-pick" type="button" data-admseat="' + esc(p.ifUserId) + '" data-name="' + esc(p.ifUsername) + '">' +
        '<span class="fh-seat-av" aria-hidden="true">' + esc(initials(p.ifUsername)) + '</span>' +
        '<span class="fh-pick-main"><span class="fh-pick-name">' + esc(p.ifUsername) + '</span><span class="fh-pick-sub">Infinite Flight account · no career link</span></span>' +
        '<span class="fh-pick-go">Seat</span></button>';
    }).catch(function (e) {
      out.innerHTML = '<span class="fh-c-bad">' + esc((e && e.message) || 'Not found.') + '</span>';
    });
  }

  /** Swap one schedule into the local fleet copy so a dialog reflects a write at once. */
  function patchLeg(tailId, schedule) {
    (fleet.aircraft || []).forEach(function (a) {
      if (a.id !== tailId || !Array.isArray(a.schedules)) return;
      a.schedules = a.schedules.map(function (s) { return s.id === schedule.id ? Object.assign({}, s, schedule) : s; });
    });
  }

  // ── Leg actions ───────────────────────────────────────────────────────────
  function reorder(tail, legId, dir) {
    var movable = tail.open.filter(function (s) { return REORDERABLE[s.status]; });
    var i = movable.findIndex(function (s) { return s.id === legId; });
    if (i < 0) return;
    var afterId;
    if (dir === 'up') { if (i === 0) return; afterId = i >= 2 ? movable[i - 2].id : null; }
    else { if (i >= movable.length - 1) return; afterId = movable[i + 1].id; }
    moveLeg(tail, legId, afterId);
  }

  function moveLeg(tail, legId, afterId) {
    var s = legOf(tail, legId);
    st.busy['leg:' + legId] = true;
    // Optimistic: show the new order immediately, then let the fleet read settle it.
    (fleet.aircraft || []).forEach(function (a) {
      if (a.id !== tail.id) return;
      var list = tail.legs.filter(function (x) { return x.id !== legId; });
      var at = afterId ? list.findIndex(function (x) { return x.id === afterId; }) + 1 : 0;
      list.splice(at, 0, s);
      list.forEach(function (x, n) { x.sequence = n; });
      a.schedules = list;
    });
    paint();
    act('schedule.reorder', { aircraftId: tail.id, scheduleId: legId, afterId: afterId }).then(function () {
      toast('Moved ' + (s ? s.callsign : 'the leg') + '.');
    }).catch(function (e) {
      toast((e && e.message) || 'Could not reorder.');
    }).then(function () {
      delete st.busy['leg:' + legId];
      return refreshAll(tail.id);
    });
  }

  function deleteLeg(tail, legId) {
    var s = legOf(tail, legId);
    if (!s) return;
    var crew = crewOf(s);
    confirmBox({
      title: 'Delete ' + (s.callsign || 'this leg') + '?',
      body: '<p><span class="fh-mono fh-strong">' + esc(s.originIcao) + ' → ' + esc(s.destinationIcao) + '</span> comes off ' + esc(tail.reg) + ' on Infinite Flight. This can’t be undone.</p>' +
        (crew.length ? '<p>' + crew.map(function (c) { return '<strong class="fh-pilot">' + esc(c.username || 'a pilot') + '</strong>'; }).join(', ') + (crew.length === 1 ? ' is' : ' are') + ' assigned and will lose the leg.</p>' : '') +
        (tail.bidOnly ? '<p>' + esc(tail.reg) + ' is bid-only: the next sync drops this leg from its contract.</p>' : ''),
      okLabel: 'Delete leg',
      danger: true,
      onOk: function () {
        st.busy['leg:' + legId] = true;
        paint();
        act('schedule.delete', { aircraftId: tail.id, scheduleId: legId }).then(function () {
          toast('Deleted ' + (s.callsign || 'the leg') + ' from ' + tail.reg + '.');
        }).catch(function (e) {
          toast((e && e.message) || 'Could not delete the leg.');
        }).then(function () {
          delete st.busy['leg:' + legId];
          return refreshAll(tail.id);
        });
      },
    });
  }

  // ── Request decisions ─────────────────────────────────────────────────────
  function decide(kind, id, op, extra) {
    var queued = ((st.data && st.data.queue && st.data.queue[kind]) || []).find(function (q) { return q.id === id; });
    var tailId = queued && queued.aircraftId;
    st.busy['req:' + id] = true;
    paintRequestsForce();
    return act('request.decide', Object.assign({ kind: kind, id: id, op: op }, extra || {})).then(function (r) {
      var res = (r && r.result) || {};
      delete st.conflict[id];
      st.declining = null;
      st.declineText = '';
      if (op === 'approve') {
        toast(kind === 'crew'
          ? (res.assignedUsername || res.pilotName || 'Pilot') + ' seated as ' + (res.roleName || 'crew') + ' on ' + (res.callsign || 'the leg') + '.'
          : 'Ferry ' + (res.originIcao || '') + '→' + (res.destinationIcao || '') + ' created.');
      } else {
        // A decline changes nothing on Infinite Flight — only the queue moved.
        toast('Request declined. The pilot has been told why.');
        return loadData(true);
      }
      return refreshAll(tailId);
    }).catch(function (e) {
      if (e && e.code === 'CAPTAIN_TAKEN') {
        st.conflict[id] = { captainName: (e.detail || {}).captainName, canSeatFirstOfficer: !!(e.detail || {}).canSeatFirstOfficer };
      } else if (e && (e.code === 'BAD_STATE' || e.code === 'NOT_PENDING')) {
        toast((e.message || 'Already handled') + ' Refreshing.');
        st.declining = null;
        return loadData(true);
      } else toast((e && e.message) || 'That did not go through.');
    }).then(function () {
      delete st.busy['req:' + id];
      paintRequestsForce();
    });
  }
  function paintRequestsForce() {
    if ((st.tab || 'requests') !== 'requests') return;
    var keepFocus = document.activeElement && document.activeElement.id === 'fhAdmReason';
    paintRequests();
    paintTabs();
    if (keepFocus && $('fhAdmReason')) $('fhAdmReason').focus();
  }

  function contractsOp(op, on) {
    st.busy.contracts = op;
    paint();
    act('contracts', { op: op, on: on }).then(function (r) {
      if (r && r.contracts && st.data) st.data.contracts = r.contracts;
      var res = (r && r.result) || {};
      toast(op === 'sync' ? 'Sync done' + (res.roundId ? ' for round ' + res.roundId : '') + '.'
        : op === 'publish' ? 'Published ' + (res.published || 0) + ' contract' + (res.published === 1 ? '' : 's') + (res.failed ? ', ' + res.failed + ' failed' : '') + '.'
          : 'Auto-publish is ' + (res.autoPublish ? 'on' : 'off') + '.');
      return loadData(true);
    }).catch(function (e) {
      toast((e && e.message) || 'Fleet Contracts refused that.');
    }).then(function () {
      delete st.busy.contracts;
      paint();
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // Events (delegated; everything here is re-rendered wholesale)
  // ════════════════════════════════════════════════════════════════════════
  function within(el) {
    var screen = $('fhScreenAdmin');
    return (screen && screen.contains(el)) || $('fhAdmModal').contains(el) || $('fhAdmConfirm').contains(el);
  }

  function onClick(e) {
    if (!e.target || !e.target.closest || !$('fhScreenAdmin')) return;
    // Backdrops. The leg editor ignores its own: a stray tap outside a
    // half-filled form must not throw the form away (Cancel and Esc still do).
    if (e.target.hasAttribute('data-admcfcancel-back')) return closeConfirm();
    if (e.target.hasAttribute('data-admclose-back')) return dlg && dlg.kind === 'leg' ? undefined : closeModal();
    // <summary> is neither a button nor a tab, so the request-group headers
    // have to be named here or their clicks never reach the branches below.
    var t = e.target.closest('button,[data-admtab],[data-admreqgroup]');
    var ours = !!t && within(t) && !t.disabled;
    // A click anywhere outside an open leg menu closes it. Decided BEFORE the
    // repaint, which detaches `t` — its attributes are still readable after.
    if (st.menu && !e.target.closest('.fh-adm-menuwrap')) { st.menu = null; paint(); }
    if (!ours) return;
    var a = function (name) { return t.getAttribute('data-' + name); };

    // confirm dialog first: it sits on top
    if (a('admcfcancel') !== null) return closeConfirm();
    if (a('admcfok') !== null) { var c = cfm; closeConfirm(); if (c && c.onOk) c.onOk(); return; }
    if (a('admclose') !== null) return closeModal();

    if (a('admtab')) {
      st.tab = a('admtab'); st.menu = null; paint();
      // Metrics + Rewards fetch on open, in their own lazy module; they never ride the queue poll.
      if (st.tab === 'metrics' || st.tab === 'rewards') return openMx(st.tab);
      if (st.tab !== 'schedules') loadData(true);
      return;
    }
    if (t.id === 'fhAdmRefresh') { t.disabled = true; refreshAll().then(function () { t.disabled = false; }); return; }
    if (a('admlogview')) { st.log.view = a('admlogview'); return paintLog(); }
    if (a('admlogscan')) return scanLog();
    if (a('admlogmore')) return loadLog(st.log.tailId, st.log.page + 1);

    // requests
    if (a('admapprove')) return decide('crew', a('admapprove'), 'approve', a('asfo') ? { asRole: 1 } : {});
    if (a('admrepoapprove')) return decide('reposition', a('admrepoapprove'), 'approve');
    if (a('admdecline')) { st.declining = a('admdecline'); st.declineText = ''; paintRequestsForce(); var r = $('fhAdmReason'); if (r) r.focus(); return; }
    if (a('admdeclinecancel') !== null) { st.declining = null; st.declineText = ''; return paintRequestsForce(); }
    if (a('admqr')) { st.declineText = a('admqr'); var ta = $('fhAdmReason'); if (ta) { ta.value = st.declineText; ta.focus(); } return; }
    if (a('admdeclinesend')) {
      var reason = ($('fhAdmReason') && $('fhAdmReason').value.trim()) || '';
      if (!reason) { var rr = $('fhAdmReason'); if (rr) { rr.classList.add('err'); rr.focus(); } return; }
      return decide(a('kind') || 'crew', a('admdeclinesend'), 'reject', { reason: reason });
    }
    if (a('admreqgroup')) {
      // Own the toggle rather than letting <details> do it: paintRequests
      // rebuilds this innerHTML on every poll, so the open state has to live in
      // st or it would snap back open a few seconds later.
      e.preventDefault();
      var reg = a('admreqgroup');
      if (st.reqClosed[reg]) delete st.reqClosed[reg]; else st.reqClosed[reg] = true;
      return paintRequestsForce();
    }
    if (a('admgotail')) { st.tab = 'schedules'; st.tail = a('admgotail'); st.showLegs = true; return paint(); }

    // schedules
    if (a('admtail')) { st.tail = a('admtail'); st.showLegs = true; st.menu = null; paint(); window.scrollTo(0, 0); return; }
    if (a('admback') !== null) { st.showLegs = false; return paint(); }
    if (a('admclosed') !== null) { st.showClosed = !st.showClosed; return paint(); }
    var tail = tailById(st.tail);
    if (a('admadd')) return openLegForm('create', a('admadd'));
    if (a('admmenu')) { st.menu = st.menu === a('admmenu') ? null : a('admmenu'); return paint(); }
    if (a('admedit')) return openLegForm('edit', st.tail, a('admedit'));
    if (a('admcrew')) return openCrew(st.tail, a('admcrew'));
    if (a('admplan')) { st.menu = null; paint(); return openPlan(st.tail, a('admplan')); }
    if (a('admreturn')) { st.menu = null; paint(); return openLegForm('return', st.tail, a('admreturn')); }
    if (a('admdup')) { st.menu = null; paint(); return openLegForm('duplicate', st.tail, a('admdup')); }
    if (a('admdel')) { st.menu = null; paint(); return tail && deleteLeg(tail, a('admdel')); }
    if (a('admup')) return tail && reorder(tail, a('admup'), 'up');
    if (a('admdown')) return tail && reorder(tail, a('admdown'), 'down');

    // leg editor
    if (a('admswap') !== null) {
      var o = $('fhAdmF_originIcao'), d = $('fhAdmF_destinationIcao');
      var tmp = o.value; o.value = d.value; d.value = tmp;
      return updateLegSummary();
    }
    if (a('admuseest')) { var be = $('fhAdmF_block'); if (be) be.value = blockText(Number(a('admuseest'))); return updateLegSummary(); }

    // flight plan
    if (a('admplansave') !== null) return savePlan(false);
    if (a('admplanclear') !== null) return savePlan(true);

    // crew
    if (a('admpick') !== null && dlg) { dlg.picking = Number(a('role')); dlg.pickSeat = Number(a('admpick')); dlg.note = null; return paintCrew(); }
    if (a('admpickrole') !== null && dlg) { dlg.picking = Number(a('admpickrole')); return paintCrew(); }
    if (a('admpickcancel') !== null && dlg) { dlg.picking = null; dlg.query = ''; return paintCrew(); }
    if (a('admseat') && dlg) return seatPilot(a('admseat'), a('name'), dlg.picking === null ? 1 : dlg.picking);
    if (a('admseatfo') && dlg) return seatPilot(a('admseatfo'), a('name'), 1);
    if (a('admseatrole') && dlg) return seatPilot(a('admseatrole'), a('name'), Number(a('role')));
    if (a('admunseat') && dlg) return unseat(a('admunseat'), a('name'));
    if (a('admlookup') !== null) return lookupPilot();

    // contracts
    if (a('admcontracts')) return contractsOp(a('admcontracts'));
    if (a('admautopub') !== null) return contractsOp('autopublish', a('admautopub') === '1');
  }

  function onInput(e) {
    var t = e.target;
    if (!t || !within(t)) return;
    if (t.id === 'fhAdmTailSearch') { st.tailQuery = t.value; return paintSchedules(); }
    if (t.id === 'fhAdmLogTail') {
      if (e.type !== 'change' || t.value === st.log.tailId) return;
      st.log.tailId = t.value;
      st.log.flights = [];
      st.log.page = st.log.totalPages = 0;
      st.log.view = 'legs';
      return st.log.tailId ? loadLog(st.log.tailId, 1) : paintLog();
    }
    if (t.id === 'fhAdmReason') { st.declineText = t.value; t.classList.remove('err'); return; }
    if (t.id === 'fhAdmPickQ' && dlg) { dlg.query = t.value; return paintPickList(); }
    if (dlg && dlg.kind === 'leg' && t.id && t.id.indexOf('fhAdmF_') === 0) {
      if (t.id === 'fhAdmF_block') dlg.blockTouched = !!t.value.trim();
      if (t.classList.contains('fh-upper')) {
        var pos = t.selectionStart;
        t.value = t.value.toUpperCase();
        try { t.setSelectionRange(pos, pos); } catch (err) { /* type without selection */ }
      }
      var f = t.closest('.fh-field');
      if (f && f.classList.contains('err')) { f.classList.remove('err'); var er = f.querySelector('.fh-field-err'); if (er) er.textContent = ''; }
      if (t.id === 'fhAdmF_originIcao' || t.id === 'fhAdmF_destinationIcao') {
        clearTimeout(onInput._ap);
        var icao = t.value.trim();
        onInput._ap = setTimeout(function () { lookupAirport(icao, updateLegSummary); }, 250);
      }
      updateLegSummary();
    }
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      if (cfm) { e.stopPropagation(); return closeConfirm(); }
      if (dlg) {
        if (dlg.kind === 'crew' && dlg.picking !== null) { dlg.picking = null; return paintCrew(); }
        e.stopPropagation();
        return closeModal();
      }
      if (st.menu) { st.menu = null; return paint(); }
    }
    if (e.key === 'Enter' && e.target && e.target.id === 'fhAdmLookupQ') { e.preventDefault(); return lookupPilot(); }
    if (e.key === 'Tab' && (dlg || cfm)) trapFocus(e, cfm ? $('fhAdmConfirm') : $('fhAdmModal'));
  }

  function trapFocus(e, root) {
    var f = Array.prototype.filter.call(root.querySelectorAll('button,input,select,textarea,summary,[href]'), function (n) {
      return !n.disabled && n.offsetParent !== null;
    });
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function onSubmit(e) {
    if (e.target && e.target.id === 'fhAdmLegForm') { e.preventDefault(); submitLegForm(); }
  }

  // Drag to reorder (pointer devices; the arrows cover touch and keyboard).
  function onDragStart(e) {
    var row = e.target.closest && e.target.closest('.fh-adm-leg[draggable="true"]');
    if (!row) return;
    st.drag = row.getAttribute('data-admleg');
    row.classList.add('dragging');
    try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', st.drag); } catch (err) { /* old browsers */ }
  }
  function onDragOver(e) {
    if (!st.drag) return;
    var row = e.target.closest && e.target.closest('.fh-adm-leg[draggable="true"]');
    if (!row) return;
    e.preventDefault();
    Array.prototype.forEach.call(document.querySelectorAll('.fh-adm-leg.drop-before,.fh-adm-leg.drop-after'), function (n) {
      n.classList.remove('drop-before', 'drop-after');
    });
    if (row.getAttribute('data-admleg') === st.drag) return;
    var r = row.getBoundingClientRect();
    row.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after');
  }
  function onDrop(e) {
    if (!st.drag) return;
    e.preventDefault();
    var row = document.querySelector('.fh-adm-leg.drop-before,.fh-adm-leg.drop-after');
    var dragged = st.drag;
    st.drag = null;
    if (!row) return paint();
    var before = row.classList.contains('drop-before');
    var target = row.getAttribute('data-admleg');
    var tail = tailById(st.tail);
    if (!tail) return paint();
    var movable = tail.open.filter(function (s) { return REORDERABLE[s.status] && s.id !== dragged; });
    var ti = movable.findIndex(function (s) { return s.id === target; });
    var afterId = before ? (ti > 0 ? movable[ti - 1].id : null) : target;
    var cur = tail.open.filter(function (s) { return REORDERABLE[s.status]; });
    var ci = cur.findIndex(function (s) { return s.id === dragged; });
    var curAfter = ci > 0 ? cur[ci - 1].id : null;
    if (afterId === curAfter) return paint();
    moveLeg(tail, dragged, afterId);
  }
  function onDragEnd() {
    if (!st.drag) return;
    st.drag = null;
    paint();
  }

  document.addEventListener('click', onClick);
  document.addEventListener('input', onInput);
  document.addEventListener('change', onInput);
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('submit', onSubmit);
  document.addEventListener('dragstart', onDragStart);
  document.addEventListener('dragover', onDragOver);
  document.addEventListener('drop', onDrop);
  document.addEventListener('dragend', onDragEnd);

  // ── public surface (fleet-mode-home.js drives these) ─────────────────────
  window.INVA_FLEET_ADMIN = {
    /** Ask once per sign-in whether this IF account is staff. */
    init: function () {
      if (st.checked || !identity()) return Promise.resolve(isAdmin());
      st.checked = true;
      return api('fleetAdminMe').then(function (me) {
        st.me = me || { admin: false };
      }).catch(function () {
        st.me = { admin: false };
        st.checked = false; // a network blip should not hide the tab for the session
      }).then(function () {
        if (isAdmin()) rerenderHome();
        return isAdmin();
      });
    },
    isAdmin: isAdmin,
    /** Called by the home on every render while the Admin screen is up. */
    render: function (homeData) {
      fleet.aircraft = (homeData && homeData.aircraft) || [];
      fleet.airports = (homeData && homeData.airports) || {};
      fleet.bidOnlyTails = (homeData && homeData.bidOnlyTails) || [];
      fleet.loaded = !!(homeData && homeData.loaded);
      if (!st.data && !st.loading) loadData();
      else if (Date.now() - st.loadedAt > 60000 && !st.loading) loadData(true);
      paint();
      if (dlg && dlg.kind === 'crew' && !dlg.busy) paintCrew();
      if (!st.pollTimer) {
        // The queue changes in Discord too; keep it current while staff watch it.
        st.pollTimer = setInterval(function () {
          if (document.visibilityState !== 'visible') return; // 0 reads in a background tab
          var screen = $('fhScreenAdmin');
          if (screen && !screen.hidden && !st.declining && !dlg) {
            st.ticks++;
            // Contracts summary (~20 reads) only every 5th tick or while its tab is open.
            var parts = ['queue', 'activity'];
            if (st.ticks % 5 === 0 || st.tab === 'contracts') parts.push('contracts');
            loadData(true, parts);
          }
        }, 60000);
      }
      if (!st.visHandler) {
        st.visHandler = function () {
          if (document.visibilityState !== 'visible' || st.loading) return;
          var screen = $('fhScreenAdmin');
          if (screen && !screen.hidden && st.data && Date.now() - st.loadedAt > 60000) loadData(true, ['queue', 'activity']);
        };
        document.addEventListener('visibilitychange', st.visHandler);
      }
    },
    reset: function () {
      if (st.visHandler) { document.removeEventListener('visibilitychange', st.visHandler); st.visHandler = null; }
      if (dlg) closeModal();
      if (cfm) closeConfirm();
      clearInterval(st.pollTimer);
      st.pollTimer = null;
      st.checked = false;
      st.me = null;
      st.data = null;
      st.tab = null;
      if (window.INVA_FLEET_ADMIN_MX) window.INVA_FLEET_ADMIN_MX.reset();
    },
    // Pure helpers, for tests.
    _rules: {
      parseBlock: parseBlock,
      istToUtcMs: istToUtcMs,
      istParts: istParts,
      nextCallsign: nextCallsign,
      legErrors: legErrors,
      seatsFor: seatsFor,
      commitmentsIn: commitmentsIn,
    },
  };
})();
