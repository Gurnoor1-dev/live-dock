/**
 * assets/js/fleet-mode-home.js — Fleet Mode HOME, shown straight after the
 * Infinite Flight sign-in on /fleet (and /live).
 *
 * Design source: claude.ai/design project "Indian Virtual Airline Fleet
 * Homepage" → `Fleet Mode Home.dc.html`. Five screens behind one header:
 *   Fleet      — stat row, live map, the fleet as a list, and a detail rail for
 *                the selected tail (a full-screen sheet below 1140px).
 *   Board      — every leg in the air or stopped en route right now, with its
 *                departs / arrives / time to run / block and who is on it.
 *   Schedules  — the whole board, filterable, grouped by day.
 *   Flight bag — the signed-in pilot's own legs in the order they were
 *                approved, each with the SimBrief dispatch and a crew brief.
 *                Markup + printer + boarding pass: assets/js/fleet-flight-bag.js.
 *   Airline    — org card, hubs, fleet by type, network, recent activity.
 *   History    — one aircraft's own record (reached from the detail rail).
 *   Admin      — staff only; owned by assets/js/fleet-admin.js (a sixth
 *                screen, a fifth tab). The home only routes to it.
 *
 * Every number on these screens is derived from the live IF fleet read
 * (fleet-mode.js `fetchFleet()`); nothing is seeded or invented. Where the v3
 * API has no equivalent of something the mock-up showed, the panel says so
 * rather than displaying a plausible-looking placeholder — there is no
 * aircraft flight-log endpoint in v3, so History is built from the tail's own
 * schedule record and admits when that is empty.
 *
 * READ-ONLY for pilots as of 2026-08-23 (the Admin screen is the staff
 * exception, and writes only through its own server routes). The pick-a-tail → pick-a-leg → confirm booking
 * flow was removed, so nothing on these screens writes: they report the
 * schedules already filed on the fleet (Follow-a-tail was removed 2026-10-15).
 * fleet-mode.js still owns
 * auth and the IF calls (window.INVA_FLEET), but no longer has a second view
 * to hand off to. The server's write routes are intact and dormant.
 *
 * Adaptations from the mock-up, both deliberate:
 *   - Airport codes come from /api/fleetPilotAirports (real IATA, ICAO where
 *     an airport has none) rather than the mock-up's hard-coded table, so the
 *     compact codes stay true for anywhere the fleet actually goes.
 *   - The 1440px fixed canvas is fluid here; the rail drops under the main
 *     column below 1180px and the map keeps its aspect on phones.
 */
(function () {
  'use strict';

  var MAPLIBRE_JS = '/assets/vendor/maplibre/maplibre-gl.js';
  var MAPLIBRE_CSS = '/assets/vendor/maplibre/maplibre-gl.css';
  var LOGO = '/assets/thumbnails/ai.png';
  // A plane seen from above, nose up (north): the map rotates it to the
  // heading, the legend draws it as-is. Filled with currentColor, so it takes
  // whatever status colour its element is given.
  // The leg-alert bell. Outlined when off, filled when on (fleet-mode.html .fh-bell).
  var BELL_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21.5a2.4 2.4 0 0 0 2.35-1.9h-4.7A2.4 2.4 0 0 0 12 21.5ZM18.5 16v-5a6.5 6.5 0 0 0-5-6.33V4a1.5 1.5 0 0 0-3 0v.67a6.5 6.5 0 0 0-5 6.33v5l-2 2v.6h17V18l-2-2Z"/></svg>';
  var PLANE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.2C12.72 2.2 13.3 2.82 13.3 3.58V9.08L20.7 13.43V15.43L13.3 13.13V17.99L15.35 19.51V21.13L12 20.3L8.65 21.13V19.51L10.7 17.99V13.13L3.3 15.43V13.43L10.7 9.08V3.58C10.7 2.82 11.28 2.2 12 2.2Z"/></svg>';

  // INVA's four Indian hubs — drawn with the airline mark on the map and
  // given their own cards on the Airline screen.
  var HUBS = ['VIDP', 'VABB', 'VOBL', 'VECC'];

  // ── status metas ───────────────────────────────────────────────────────
  // EVERY meta on this page is [label, colour, chipClass], aircraft states and
  // schedule states alike. They used to disagree — aircraft were
  // [label, fg, bg] and schedules [label, bg, fg] — so the two chip() calls
  // read `chip(a.meta[0], a.meta[2], a.meta[1])` against
  // `chip(s.ssMeta[0], s.ssMeta[1], s.ssMeta[2])`: the same helper with its
  // arguments swapped. One shape now, and chip() takes the whole meta.
  //
  // [1] is a colour the map markers, the strip dots and the progress line
  // paint with directly (nothing there can take a class). It is a THEME TOKEN,
  // never a hex: fleet-mode.html defines each one for light and dark, so a
  // marker repaints when the theme changes.
  // [2] is the semantic class the chip uses — status is styled by MEANING
  // (DESIGN.md §8.2): air green (live) · gnd blue · stop magenta · warn amber ·
  // sched grey · bad red · done blue, hollow.
  var IN_FLIGHT = ['In flight',   'var(--fh-air)',   'air'];
  var ON_GROUND = ['On ground',   'var(--fh-gnd)',   'gnd'];
  var STOPPED   = ['Stopped',     'var(--fh-stop)',  'stop'];
  var MAINT     = ['Maintenance', 'var(--fh-warn)',  'warn'];
  var STORED    = ['Stored',      'var(--fh-sched)', 'sched'];
  // Bid-only tails (plan §7.5, Fleet Contracts). Reuses the 'warn' chip class
  // (same as Maintenance) — no new CSS variant needed.
  var BID_ONLY_META = ['Needs bidding', 'var(--fh-warn)', 'warn'];

  // PersistentFlightType → a SERVICE label. It always ends in "flight" on
  // purpose: the bare word "Passenger" used to sit right beside a pilot's name
  // ("Passenger · Thunderbird.02") and read as if the pilot were the passenger.
  // A label like "Passenger flight" cannot be mistaken for a person, and it is
  // shown with the route, never in the crew line.
  var FT = {
    0: 'Flight', 1: 'Passenger flight', 2: 'Charter flight', 3: 'Cargo flight', 4: 'Training flight',
    5: 'Test flight', 6: 'Medical flight', 7: 'Military flight', 8: 'VIP flight', 9: 'Relief flight',
    10: 'General aviation flight', 11: 'Airshow flight', 12: 'Flight',
  };
  // ScheduledFlightStatus → [label, colour, chipClass] — same shape as above.
  var SS = {
    0: ['Unknown',    'var(--fh-sched)', 'sched'],
    1: ['Scheduled',  'var(--fh-sched)', 'sched'],
    2: ['Boarding',   'var(--fh-air)',   'air'],
    3: ['Boarded',    'var(--fh-air)',   'air'],
    4: ['Taxiing',    'var(--fh-air)',   'air'],
    6: ['In flight',  'var(--fh-air)',   'air'],
    7: ['Diverted',   'var(--fh-warn)',  'warn'],
    8: ['Delayed',    'var(--fh-warn)',  'warn'],
    9: ['Cancelled',  'var(--fh-bad)',   'bad'],
    10: ['Taxiing in', 'var(--fh-sched)', 'sched'],
    11: ['Arrived',   'var(--fh-sched)', 'sched'],
  };

  var WIDE = ['B77W', 'B77L', 'B772', 'B788', 'B789', 'B78X', 'A359', 'A35K', 'A350',
              'A332', 'A333', 'A339', 'B744', 'B748'];
  var PROP = ['AT76', 'AT75', 'DH8D'];

  // AircraftPersistenceState 4 (Stopped) is an EN-ROUTE state: the session
  // ended in the air. Stopped comes BEFORE OnGround — it is a heads-up, not a
  // fault, and it is NOT terminal: the pilot can rejoin and carry on flying,
  // which is why nothing here treats a stop as the end of the leg. Left alone
  // the tail reaches the ground roughly this long after.
  var STOPPED_TO_GROUND_MIN = 30;

  // ── stale "In flight" schedules ────────────────────────────────────────
  // ScheduledFlightStatus 6 is NOT a liveness signal. Infinite Flight never
  // closes a schedule out on its own: a pilot who goes in flight and never
  // finishes leaves the row at 6 for good. Our board is months old, so those
  // accumulate — 7 of them were crowding out 5 real flights, and every one
  // rendered as "97% flown · 0h 00m · ETA 24 Mar" because the progress clamp
  // and dur()'s floor turn a months-past arrival into confident nonsense.
  //
  // The schedule is the LIVE signal here and the position is not.
  // AircraftPersistenceState is the state the aircraft record was *persisted*
  // in — where the tail was left — and it does not update mid-flight: every
  // one of the five aircraft Infinite Flight's own org page showed en route
  // still read OnGround. Gating leg liveness on it emptied the board.
  //
  // So a schedule at 6 (InFlight) is believed on its own, and the only guard
  // is chronological: Infinite Flight never closes schedules out, so legs sit
  // at 6 forever. One past its own arrival by this much was abandoned, not
  // flown — without the cut-off, dur()'s floor turns a months-past arrival
  // into confident nonsense ("97% flown, 0h 00m to run").
  var STALE_AIRBORNE_MS = 12 * 3600000;   // past its own scheduled arrival
  var STALE_META = ['Stale', 'var(--fh-sched)', 'sched'];
  // Arrived, but the schedule row was never closed out. Distinct from Stale:
  // this flight happened, it just needs tidying up. Green with a HOLLOW dot,
  // never `air`: "landed" and "airborne" reading as one colour is exactly
  // the confusion this chip exists to prevent.
  var DONE_META = ['Landed · open', 'var(--fh-done)', 'done'];
  // The leg is running, but nobody is flying it: the session ended in the air.
  // Same colour as the Stopped tail chip, because it is the same event.
  var STOPPED_META = ['Stopped en route', 'var(--fh-stop)', 'stop'];

  /**
   * Is a schedule the API reports as InFlight actually being flown right now?
   * @param {number} arrT  the leg's effective arrival. Deliberately the only
   *   input: the persisted position lags and cannot be a gate. No lower bound
   *   on departure, because pilots push back early and IF flips the leg to
   *   InFlight when they do.
   */
  function legIsAirborne(arrT, now) {
    return (now - arrT) < STALE_AIRBORNE_MS;
  }

  /**
   * What a leg Infinite Flight still calls InFlight ACTUALLY is.
   *
   * Status 6 covers four situations. A full read of the fleet next to IF's own
   * org page (2026-07-30, all 15 active tails) says which is which, and the
   * discriminator is `orphaned` — the tail is not in the live session feed, so
   * nobody is connected in it:
   *
   *   parked at the leg's DESTINATION → it arrived; nobody closed the row.
   *   nobody connected, not there yet → the session ended: STOPPED.
   *   parked at the leg's ORIGIN      → it has not left. Its next flight.
   *   anything else                   → abandoned.
   *
   * The order matters and is not arbitrary. `orphaned` sits ABOVE the
   * parked-at-origin test because the persisted position is where the aircraft
   * PUSHED BACK FROM and is never rewritten en route — all four tails IF
   * called Stopped (VT-TSD, VT-NAC, VT-ALQ, VT-JRE) read as parked at their
   * own origin. It sits BELOW the destination test because a tail sitting at
   * the far end plainly got there before its pilot logged off.
   *
   * What is NOT in this rule, having been tried and refuted:
   *   • AircraftPersistenceState. It reads 0 (Unknown) on every tail in this
   *     org, stopped ones included — there is no 4 to wait for, ever.
   *   • A clock window. VT-ALQ's stopped leg departed 4 May and IF still calls
   *     it Stopped; VT-TSD's is an "Anytime" leg with no clock at all. Both
   *     would fail any "could it still be finishing?" test.
   *   • Altitude. VT-BWE is parked at VOBL, field elevation ~3,000 ft, and any
   *     bare `altitude > 1000` reads it as airborne.
   *
   * Cross-checked the other way too: VT-ALM is absent from the feed and is NOT
   * stopped, because it has no status-6 leg; VT-ANM and VT-AEF both carry one
   * and are NOT stopped, because they are in the feed.
   *
   * @param {boolean} live      the feed has this tail airborne
   * @param {string?} at        ICAO the tail is parked at, if known
   * @param {boolean} orphaned  a feed was read and this tail is not in it
   */
  function legPhase(live, at, origin, dest, orphaned) {
    if (live) return 'air';
    if (at && dest && at === dest) return 'done';
    if (orphaned) return 'stopped';
    if (at && origin && at === origin) return 'next';
    return 'stale';
  }

  /** Is this position actually moving, i.e. worth deriving figures from?
   *  A persisted position parked at the origin would otherwise report a
   *  live-looking 1% and a several-day ETE. */
  function posIsMoving(a) {
    return isFinite(Number(a.spd)) && Number(a.spd) >= 40 &&
      isFinite(Number(a.alt)) && Number(a.alt) > 1000;
  }

  // Organization enums (if-v3-oauth-preview.md) — shown as-reported on the
  // Airline screen rather than assumed.
  var WORLD_TYPE = { 0: 'Solo', 1: 'Casual', 2: 'Training', 3: 'Expert', 4: 'Private' };
  var OPERATION_TYPE = {
    1: 'Airline', 2: 'Charter', 3: 'Freight', 4: 'Military', 5: 'Flight school', 6: 'Private',
  };
  // The organization's public page on Infinite Flight Live.
  var ORG_PUBLIC_URL = 'https://live.infiniteflight.com/organization/25f27176-a2d4-46e3-844e-cc39eb3a5579';

  var H = 3600000;
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  var $ = function (id) { return document.getElementById(id); };
  var homeView = null;

  var ui = {
    page: 'fleet',      // fleet | board | schedules | bag | airline | activity | history | admin
    sel: null,          // selected aircraft id
    filter: 'ALL',      // map/strip filter
    schFilter: 'ALL',   // schedules screen filter
    schSort: 'STATUS',  // schedules screen tail ordering — see SCHED_SORTS
    schQuery: '',       // schedules screen search box
    // Which tail blocks are expanded. Empty = every aircraft starts collapsed:
    // the board opens as a fleet index you scan, not a wall of every leg the
    // airline owes. A search overrides this — see openGroup().
    schOpen: new Set(),
  };
  var data = {
    aircraft: [],
    org: null,
    airports: {},       // ICAO → { iata, name, city, lat, lon }
    live: {},           // aircraftId → live session flight (real position)
    liveSession: false, // did we actually get a live feed to reason from?
    // Bid-only tails (plan §7.5, Fleet Contracts) — registrations. Empty when
    // the feature is off; both the direct read and /api/fleetPilotFleet carry
    // this field identically (assets/js/fleet-mode.js:withBidOnlyTails).
    bidOnlyTails: [],
    // Flex Crew (assets/js/fleet-mode.js:readFlex) — { tails: [reg], types: [ICAO],
    // byAircraft: { id → { legId, phase, foSeatOpen, foOpensAt, stopCrew } } },
    // or null when it could not be read.
    flex: null,
    syncedAt: null,
    error: null,
    loaded: false,
    preview: false,     // the board on screen is a cached paint, not a read
  };
  var map = null, markers = {}, airportMarkers = [], codeLabels = [], didFit = false;

  // ── My activity + bounty chips (assets/js/fleet-activity.js) ───────────
  // The tab's bulk is a lazily loaded module, so the board's load does not
  // grow. This file keeps only what the Fleet / Schedules rows need: whether
  // the bounty switch is on and the open idle-tail bounties by registration.
  // Fetched when the board first renders (once per session) and again on a
  // re-open of the tab after 5 min; there is no timer.
  var bty = { at: 0, enabled: false, items: [], byReg: {}, inflight: null };
  var actLoad = null;           // the module's script promise
  var actPending = false;       // setPage is being called by viewPilot()

  function myIdentity() {
    try {
      var auth = window.INVA_FLEET && window.INVA_FLEET.getAuth();
      return (auth && auth.followIdentity) || '';
    } catch (e) { return ''; }
  }

  function fetchBounties(force) {
    var id = myIdentity();
    if (!id) return Promise.resolve();
    if (bty.inflight) return bty.inflight;
    if (bty.at && !(force && Date.now() - bty.at > 5 * 60 * 1000)) return Promise.resolve();
    bty.at = Date.now();   // set first: a failed read is not retried by the next render
    bty.inflight = fetch('/api/fleetPilotBounties', { headers: { 'X-Fleet-Identity': id } }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (j) {
      var was = bty.enabled;
      bty.enabled = !!(j && j.enabled === true);
      bty.items = bty.enabled && Array.isArray(j.items) ? j.items : [];
      bty.byReg = {};
      bty.items.forEach(function (o) { bty.byReg[normReg(o.registration)] = o; });
      if (was !== bty.enabled || bty.enabled) render();
    }).catch(function () { /* chips stay off; the tab shows its own state */ })
      .then(function () { bty.inflight = null; });
    return bty.inflight;
  }

  /** The chip for a tail, or '' while the switch is off / the tail has none. Escaped. */
  function bountyChip(reg) {
    var o = bty.enabled ? bty.byReg[normReg(reg)] : null;
    if (!o || !(o.bountyHours > 0)) return '';
    return '<span class="fh-bty" title="Locked when your seat is approved">+' +
      esc(String(Math.round(o.bountyHours * 10) / 10)) + ' h bounty</span>';
  }

  function loadActivity() {
    if (window.INVA_FLEET_ACTIVITY) return Promise.resolve(window.INVA_FLEET_ACTIVITY);
    if (actLoad) return actLoad;
    var asset = function (p) { return typeof window.INVA_ASSET === 'function' ? window.INVA_ASSET(p) : p; };
    actLoad = new Promise(function (resolve, reject) {
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = asset('/assets/css/fleet-activity.css');
      document.head.appendChild(link);
      var s = document.createElement('script');
      s.src = asset('/assets/js/fleet-activity.js');
      s.onload = function () { resolve(window.INVA_FLEET_ACTIVITY); };
      s.onerror = function () { reject(new Error('activity script failed to load')); };
      document.body.appendChild(s);
    }).catch(function (e) { actLoad = null; throw e; });
    return actLoad;
  }

  /** The signed-in pilot's airborne leg, from the fleet read the page already has, or null. */
  function flyingNow() {
    if (!data.loaded || !myUserId()) return null;
    var hit = null;
    model().forEach(function (a) {
      if (hit || !a.enRoute || !a.active || !myCrewIn(a.active.crew)) return;
      var eta = Number.isFinite(a.active.etaShown) ? relTime(a.active.etaShown).replace(/^in /, '') + ' to go' : '';
      hit = { reg: a.reg, route: code(a.active.o) + ' → ' + code(a.active.d), eta: eta };
    });
    return hit;
  }

  function actCtx() {
    var auth = window.INVA_FLEET && window.INVA_FLEET.getAuth();
    return {
      identity: myIdentity(),
      name: (auth && auth.profile && auth.profile.displayName) || '',
      flying: flyingNow(),
      head: $('fhActHead'),
      body: $('fhActBody'),
      bounties: function () { return { enabled: bty.enabled, items: bty.items }; },
      fetchBounties: fetchBounties,
      onChange: function () { if (ui.page === 'activity' || ui.page === 'airline') render(); },
    };
  }

  /** Open the tab's data: load the module, fetch what is stale, repaint. */
  function enterActivity(cs) {
    loadActivity().then(function (m) { return m.open(actCtx(), cs || null); })
      .then(function () { if (ui.page === 'activity') render(); })
      .catch(function () {
        var b = $('fhActBody');
        if (b) b.innerHTML = '<div class="fh-blk"><div class="fh-empty">Activity could not be loaded. Reload the page and try again.</div></div>';
      });
  }

  /** The Airline tab's leaderboard needs my profile snapshot in memory. */
  function enterLeaderboard() {
    if (!myIdentity()) return;
    loadActivity().then(function (m) { return m.ensureMine(actCtx()); }).catch(function () { /* the block says so */ });
  }

  function viewPilot(cs) {
    actPending = true;
    setPage('activity');
    actPending = false;
    enterActivity(cs);
  }

  // ── crew requests ──────────────────────────────────────────────────────
  // A pilot cannot assign themselves: Infinite Flight needs org owner/admin
  // plus live:schedules.write to touch a schedule's crew, and a Fleet Mode
  // token carries neither. So the button files a REQUEST, an admin approves
  // it in Discord, and the assignment happens server-side on the org token.
  //
  // crewBusy holds the scheduleId being submitted (not a boolean) so only the
  // clicked row shows pending. crewPending remembers what was asked, because the leg keeps reading
  // Unassigned until an admin acts on it and a pilot who gets no feedback will
  // click again.
  //
  // It OUTLIVES the session, in localStorage keyed by the signed-in IF user id.
  // A page reload is the ordinary case here — the board is a thing pilots leave
  // open and come back to — and an in-memory Set meant the button went back to
  // reading "Request this leg" on every refresh, which is the duplicate request
  // it exists to prevent. Keyed by user id so a shared device never shows one
  // pilot another's requests.
  //
  // It is a CACHE, not a record: the server owns the queue, and an entry here
  // is only ever a reason to disable a button. It is dropped the moment the leg
  // resolves (crew seated, or the leg closed), so an admin's decline cannot
  // leave a pilot staring at a dead button forever.
  var crewBusy = null;
  // The scheduleId being released by "Unassign me" (fleetPilotUnassign), or null.
  var unassignBusy = null;
  // ── leg alerts (the bell) ──────────────────────────────────────────────
  // A bell on a leg asks the server to DM this pilot ONCE when the leg AHEAD
  // of it on the tail is about to land or has arrived, whichever is first
  // (lib/actions/fleet-leg-alerts.js, run by the hold watch). Offered on any
  // leg with an earlier open leg ahead — crewed or not, since a rostered pilot
  // on a non-Flex tail is exactly the one waiting. `legAlerts` mirrors the
  // server's list of schedule ids; `legAlertBusy` is the one being toggled.
  var legAlerts = new Set();
  var legAlertBusy = null;
  var CREW_PENDING_KEY = 'fmCrewPending';
  var crewPending = new Set();
  // Whose requests the Set currently holds. This module is evaluated before
  // sign-in has necessarily resolved, so the Set cannot simply be loaded once
  // at start — it is (re)loaded the first time a render knows who the pilot is,
  // and again if that ever changes. Without this, signing in after load left an
  // empty Set and every button back to "Request this leg".
  var crewPendingFor = null;

  function crewPendingKey(me) {
    return me ? CREW_PENDING_KEY + ':' + me : '';
  }
  function syncCrewPendingOwner() {
    var me = myUserId();
    if (me === crewPendingFor) return;
    crewPendingFor = me;
    crewPending = new Set();
    try {
      var k = crewPendingKey(me);
      if (!k) return;
      var raw = JSON.parse(window.localStorage.getItem(k) || '[]');
      if (Array.isArray(raw)) raw.filter(Boolean).forEach(function (id) { crewPending.add(String(id)); });
    } catch (e) { /* private mode / storage disabled — the Set still works */ }
  }
  function saveCrewPending() {
    try {
      var k = crewPendingKey(crewPendingFor);
      if (k) window.localStorage.setItem(k, JSON.stringify([...crewPending]));
    } catch (e) { /* private mode / storage disabled — the Set still works */ }
  }
  function rememberCrewRequest(legId) {
    syncCrewPendingOwner();
    crewPending.add(String(legId));
    saveCrewPending();
  }
  /**
   * Forget legs that have since resolved, so the entry cannot outlive what it
   * describes. A leg is resolved once it carries crew (the request was granted,
   * or somebody else took the seat) or has left the board entirely (flown,
   * cancelled, deleted). A DECLINED request leaves no trace on the leg, which
   * is why the second rule matters: that leg eventually closes and the entry
   * goes with it.
   */
  function pruneCrewPending(all) {
    syncCrewPendingOwner();
    if (!crewPending.size) return;
    var live = {};
    (all || []).forEach(function (a) {
      (a.sch || []).forEach(function (sc) { if (sc.id) live[sc.id] = sc; });
    });
    var before = crewPending.size;
    [...crewPending].forEach(function (id) {
      var sc = live[id];
      if (!sc || crewCount(sc.crew)) crewPending.delete(id);
    });
    if (crewPending.size !== before) saveCrewPending();
  }

  // SimBrief dispatch, same shape and for the same reason: the flight dialog
  // re-renders on every 90s data tick, so a button that carried its own state
  // in the DOM (career mode mutates the element's innerHTML and styles) would be
  // destroyed mid-gesture. Holding the scheduleId here means a re-render
  // REPRODUCES the right label instead.
  //   dispatchBusy    — a dispatch is in flight for this leg
  //   dispatchGesture — the popup was blocked; the button is now a second,
  //                     explicit "tap to open" so window.open runs on a fresh
  //                     user gesture (the iOS rule fleet-mode.js:284 documents)
  var dispatchBusy = null;
  var dispatchGesture = null;
  //   dispatchRwy     — scheduleId -> the departure runway the pilot typed, as
  //                     typed. One value per leg for both Dispatch surfaces;
  //                     per page-load, never persisted. Read at click time, so
  //                     the popup claim stays synchronous.
  var dispatchRwy = {};

  /** The departure-runway box. Blank means SimBrief picks, as before. */
  function rwyInputHtml(s, cls) {
    return '<input type="text" class="fh-input fh-mono fh-upper ' + cls + '" data-dprwy="' + esc(s.id) + '"' +
      ' value="' + esc(dispatchRwy[s.id] || '') + '" maxlength="7" placeholder="Auto"' +
      ' autocomplete="off" autocapitalize="characters" spellcheck="false"' +
      ' aria-label="Departure runway for ' + esc(s.cs || 'this leg') + ', blank lets SimBrief choose">';
  }

  /** innerHTML that does not throw the caret out of a runway box: both
   *  Dispatch surfaces are rebuilt on every 90 s tick, which may land while
   *  a pilot is typing. */
  function writeKeepingRunway(host, html) {
    var a = document.activeElement;
    var leg = a && host.contains(a) ? a.getAttribute('data-dprwy') : null;
    var pos = leg != null ? a.selectionStart : null;
    // eslint-disable-next-line no-unsanitized/property -- safe: markup built by this module (data escaped where built) or an internal enum/constant
    host.innerHTML = html;
    if (leg == null) return;
    var box = [].find.call(host.querySelectorAll('[data-dprwy]'), function (el) {
      return el.getAttribute('data-dprwy') === leg;
    });
    if (!box) return;
    box.focus();
    try { box.setSelectionRange(pos, pos); } catch (e) { /* not a text box */ }
  }

  // ── Flight bag (assets/js/fleet-flight-bag.js renders it) ──────────────
  // The pilot's own legs in the order they were APPROVED. The order is not on
  // the fleet read — Infinite Flight keeps no "assigned at" — so it comes from
  // the portal's own approval records via /api/fleetPilotFlightBag, which takes
  // the HMAC identity only (no IF bearer, so a plain fetch is correct here).
  //   approvals  the route's `legs`, or null before the first answer
  //   count      the route's approved count at that answer — what a pulse is
  //              compared with; null until a full answer has landed
  //   status     idle | ok | failed
  //
  // STAYING CURRENT. Nothing re-reads the fleet on its own (the board has no
  // poll), and a full read is 1 + 2N Infinite Flight calls on the pilot's token
  // against a 100/min limit, so the open tab does NOT poll the fleet. It polls
  // the portal's approval count instead: one Firestore aggregation every
  // BAG_PULSE_MS, zero Infinite Flight calls. A changed count means a leg was
  // approved or taken off the pilot, which names the tail to re-read — one call
  // each (INVA_FLEET.reloadTail), or a full read past BAG_TAILS_MAX. Seats that
  // leave no approval record (a Fleet Contract publish, crew added on the IF
  // website) are caught by a full read when the board is older than
  // BAG_FLEET_MAX_MS, or BAG_OPEN_MAX_MS on opening the tab.
  //
  // The loop is a setTimeout CHAIN (never setInterval): the next link is only
  // set when the last one finished, so requests cannot overlap. It runs only
  // while the bag is the page on screen, the tab is visible, and the pilot has
  // a signed identity; it backs off after a failure and starts over on success.
  var BAG_PULSE_MS = 15000;
  var BAG_BACKOFF_MS = [30000, 60000, 120000];
  var BAG_FLEET_MAX_MS = 5 * 60000;         // safety net while the tab is open
  var BAG_OPEN_MAX_MS = 2 * 60000;          // …and when the tab is opened
  var BAG_TAILS_MAX = 3;                    // more than this: one full read
  var OFPS_KEY = 'invaFleetOfps';           // written by ofp-viewer.html
  var bag = {
    approvals: null, count: null, status: 'idle',
    busy: false, user: '', pilotName: '', profiled: false,
    timer: null,            // the next link of the chain
    nextAt: 0,              // when that link fires, for the "next try in" text
    fails: 0,               // consecutive failed links; 0 = healthy
    checkedAt: 0,           // when a link last succeeded
    entering: false,        // the next link is the first since the tab opened
    fresh: {},              // scheduleId → true: approved while the tab was open
    // Re-reads the fleet still owes, kept across links so a failed read is
    // retried instead of forgotten: whole fleet, tails by id, and the legs to
    // announce once their row exists.
    owe: { full: false, tails: [], announce: [] },
  };
  // The last FULL fleet read: its json (onFleet gets a NEW object for a full
  // load and the SAME one for a single-tail patch) and when it finished.
  var fleetJson = null;
  var fleetFullLoadAt = 0;
  // Background full reads stop after 15 minutes with no pointer/keyboard/touch
  // input or tab-visible event, and resume on the next one.
  var IDLE_STOP_MS = 15 * 60 * 1000;
  var lastInputAt = Date.now();
  (function watchInput() {
    function touch() { lastInputAt = Date.now(); }
    try {
      ['pointerdown', 'keydown', 'touchstart', 'mousemove', 'wheel'].forEach(function (t) {
        window.addEventListener(t, touch, { passive: true });
      });
      if (document.addEventListener) {
        document.addEventListener('visibilitychange', function () { if (!document.hidden) touch(); });
      }
    } catch (e) { /* no input signal: reads simply never idle out */ }
  })();
  var fleetBusy = null;       // a full read in flight — never two at once
  var fleetTriedAt = 0;       // when one last STARTED, so a failing read waits its turn

  // A dispatch started from the Flight bag leaves a note in sessionStorage so
  // the OFP viewer's "Return to Dispatch" (which always goes to /fleet) lands
  // back on this tab instead of the Fleet screen. Read ONCE, here, and removed:
  // it must never outlive the trip it was written for. Only 'bag' is honoured.
  var RETURN_KEY = 'fmReturnPage';
  var returnPage = (function () {
    var v = '';
    try {
      v = sessionStorage.getItem(RETURN_KEY) || '';
      sessionStorage.removeItem(RETURN_KEY);
    } catch (e) { /* private mode — the pilot lands on Fleet, as before */ }
    return v === 'bag' ? v : '';
  })();

  // ── formatting ─────────────────────────────────────────────────────────
  function esc(s) {
    return window.INVA_ESC.html(s);
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  /** 'VT-ANM' / 'vt anm' both collapse to comparable letters — the same
   *  normalisation lib/actions/fleet-tail-lookup.js:normReg() uses server
   *  side, so a bid-only match here agrees with the server's. */
  function normReg(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  /** IST wall clock — Fleet Mode reports schedule times in IST throughout. */
  function ist(t) {
    if (!isFinite(t) || t <= 0) return '—';
    var d = new Date(t + 5.5 * H);
    return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes());
  }
  function istDayOffset(t) {
    if (!isFinite(t) || t <= 0) return '';
    var a = new Date(t + 5.5 * H), b = new Date(Date.now() + 5.5 * H);
    var dd = Math.round((Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate()) -
      Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate())) / 86400000);
    // Only ±1 day reads well as a delta; past that istClock() shows the date,
    // and an absurd value (a bad timestamp) shows nothing at all.
    if (dd === 0 || Math.abs(dd) > 1) return '';
    return dd > 0 ? ' +' + dd : ' ' + dd;
  }
  /** Wall clock for something happening about now: '07:37', '07:37 +1' for
   *  tomorrow. Anything further out gets its DATE instead of a day count —
   *  "07:37 -123" told nobody anything; "07:37 · 28 Mar" does. */
  function istClock(t) {
    if (!isFinite(t) || t <= 0) return '—';
    var off = istDayOffset(t);
    if (off) return ist(t) + off;
    return dayDelta(t) === 0 ? ist(t) : ist(t) + ' · ' + fmtShort(t);
  }
  /** Whole IST days between t and now (negative = past). */
  function dayDelta(t) {
    var a = new Date(t + 5.5 * H), b = new Date(Date.now() + 5.5 * H);
    return Math.round((Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate()) -
      Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate())) / 86400000);
  }
  function fmtShort(t) {
    var d = new Date(t + 5.5 * H);
    return d.getUTCDate() + ' ' + MON[d.getUTCMonth()];
  }
  function fmtDate(t) {
    var d = new Date(t + 5.5 * H);
    return DAYS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MON[d.getUTCMonth()];
  }
  function fmtLong(t) {
    var d = new Date(t + 5.5 * H);
    return d.getUTCDate() + ' ' + MON[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }
  function dayKey(t) {
    var d = new Date(t + 5.5 * H);
    return d.getUTCFullYear() + '-' + d.getUTCMonth() + '-' + d.getUTCDate();
  }
  function dur(ms) {
    // A leg with no scheduled times yields a zero (or nonsense) span. "0h 00m"
    // reads as a real, instantaneous flight; an em dash reads as "not known".
    if (!isFinite(ms) || ms <= 0) return '—';
    var m = Math.round(ms / 60000);
    return Math.floor(m / 60) + 'h ' + pad(m % 60) + 'm';
  }
  /** How far off something is, in words: 'in 30m', 'in 6h 15m', 'landing now',
   *  '2h ago'. Sits above an absolute time so the clock does not have to be
   *  done in your head — the number people actually want first. */
  function relTime(t) {
    if (!isFinite(t) || t <= 0) return '';
    var m = Math.round((t - Date.now()) / 60000);
    var past = m < 0;
    var n = Math.abs(m);
    if (n < 2) return 'now';
    var txt = n < 60 ? n + 'm'
      : n < 1440 ? Math.floor(n / 60) + 'h' + (n % 60 ? ' ' + (n % 60) + 'm' : '')
      : coarse(n / 1440);
    return past ? txt + ' ago' : 'in ' + txt;
  }
  /**
   * Days, but only while a day count still means something. This board carries
   * schedules months deep — Infinite Flight never closes a row out — so "71d"
   * and "132d" were routine, and nobody reads those as a duration. Rolls up to
   * weeks and then months at the points where the smaller unit stops being
   * legible.
   *
   * Deliberately short forms ('2w', '3mo'): these sit in narrow table cells and
   * beside a clock, where the long form would wrap.
   */
  var DAYS_PER_MONTH = 30.44;   // mean Gregorian, so 12 months lands on a year
  function coarse(days) {
    var d = Math.round(days);
    if (d < 7) return d + 'd';
    if (days < 56) return Math.round(days / 7) + 'w';         // up to 8 weeks
    if (days < 365) return Math.round(days / DAYS_PER_MONTH) + 'mo';
    return Math.round(days / 365) + 'y';
  }
  /** An ETA cell: the IST clock, with the relative time under it in grey. The
   *  clock leads because it is the answer — "in 5h" is the reference you read
   *  second, and a pilot planning around a slot needs the wall time first. */
  /** Phone board cells are narrow: let "14:40 · 10 Jul" break only before the
   *  dot, never inside the time or the date. Text content is unchanged. */
  function etaClockHtml(s) {
    var i = s.indexOf(' · ');
    if (i < 0) return '<span class="fh-nw">' + esc(s) + '</span>';
    return '<span class="fh-nw">' + esc(s.slice(0, i)) + '</span> <span class="fh-nw">' + esc(s.slice(i + 1)) + '</span>';
  }
  function etaCell(t, cls, via) {
    var rel = relTime(t);
    return '<div class="fh-eta' + (cls ? ' ' + cls : '') + '">' +
      '<span class="fh-eta-t">' + etaClockHtml((via === 'approx' ? '≈ ' : '') + istClock(t)) + '</span>' +
      (rel || via === 'live'
        ? '<span class="fh-eta-rel' + vLive(via) + '"' + vLiveAttr(via) + '>' + esc(rel || 'live') + '</span>'
        : '') + '</div>';
  }

  /** The long form, for the rail and the activity feed where there is room.
   *  Same roll-up as coarse(): a tail last moved "2 months ago", never
   *  "71 days ago". */
  function ago(ms) {
    if (!isFinite(ms)) return 'unknown';
    var m = Math.round(ms / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + ' min ago';
    var h = m / 60;
    if (h < 24) return Math.floor(h) + 'h ' + pad(m % 60) + 'm ago';
    var days = h / 24;
    var d = Math.round(days);
    if (d < 7) return plural(d, 'day');
    if (days < 56) return plural(Math.round(days / 7), 'week');
    if (days < 365) return plural(Math.round(days / DAYS_PER_MONTH), 'month');
    return plural(Math.round(days / 365), 'year');
  }
  function plural(n, unit) {
    return n + ' ' + unit + (n === 1 ? '' : 's') + ' ago';
  }

  function city(icao) {
    var a = data.airports[icao];
    return (a && (a.city || a.name)) || icao || '—';
  }
  /** The mock-up's compact 3-letter codes. Real IATA where the airport
   *  reference has one, ICAO otherwise — never a guess. */
  function code(icao) {
    var a = data.airports[icao];
    return (a && a.iata) || icao || '—';
  }
  function isHub(icao) { return HUBS.indexOf(icao) !== -1; }
  function coords(icao) {
    var a = data.airports[icao];
    return a && isFinite(a.lat) && isFinite(a.lon) ? [a.lon, a.lat] : null;
  }

  /** 'Boeing 777-300ER' → 'B77W'. Falls back to the trimmed type name so an
   *  airframe the registry does not know still labels itself honestly. */
  var TYPE_CODES = [
    // Every 777-200 this airline flies is a -200LR, and the registry writes the
    // bare "Boeing 777-200" for them (lib/actions/fleet-pireps.js says the same)
    // — so a bare -200 is B77L and dispatches on the AI:B77L airframe. Only an
    // explicit -200ER is a B772.
    ['B77W', /777-300/i], ['B77L', /777-200\s*LR/i], ['B772', /777-200\s*ER/i], ['B77L', /777-200/i],
    ['B78X', /787-10/i], ['B789', /787-9/i], ['B788', /787-8(?!\d)/i],
    ['A35K', /A350-1000/i], ['A359', /A350/i],
    ['A339', /A330-900|A330.*neo/i], ['A333', /A330-300/i], ['A332', /A330-200/i],
    ['B748', /747-8/i], ['B744', /747-400/i],
    ['A20N', /A320.*neo|A320-2\d\dN/i], ['A21N', /A321.*neo|A321-2\d\dN/i], ['A19N', /A319.*neo/i],
    ['A321', /A321/i], ['A320', /A320/i], ['A319', /A319/i],
    // A 737NG is written with Boeing's two-character customer code as often as
    // the generic "-800" — the registry has "737-8HG(WL)", "737-86N(WL)",
    // "737-8AL(WL)" — so match both. Missing them fell through to the free-text
    // branch ("737-8HG(") and SimBrief dispatch refused every 737-800.
    ['B38M', /MAX\s*8/i], ['B39M', /MAX\s*9/i],
    ['B738', /737-8(?:00|[0-9A-Z]{2})(?!\d)/i], ['B739', /737-9(?:00|[0-9A-Z]{2})(?!\d)/i],
    ['AT76', /ATR[\s-]*72/i], ['DH8D', /Q400|Dash\s*8[\s-]*400/i],
    ['E190', /E190/i], ['E195', /E195/i], ['E145', /ERJ[\s-]*145|E145/i],
  ];
  function typeCode(typeName) {
    var n = String(typeName || '');
    for (var i = 0; i < TYPE_CODES.length; i++) {
      if (TYPE_CODES[i][1].test(n)) return TYPE_CODES[i][0];
    }
    return n.replace(/^(Boeing|Airbus|Embraer|ATR|Bombardier|De Havilland)\s*/i, '').slice(0, 8) || '—';
  }
  function family(code) {
    if (WIDE.indexOf(code) !== -1) return 'Wide-body';
    if (PROP.indexOf(code) !== -1) return 'Turboprop';
    return 'Narrow-body';
  }

  // ── model ──────────────────────────────────────────────────────────────
  // ── who already has this leg ───────────────────────────────────────────
  // Infinite Flight DOES now carry crew natively: a Schedule has a `crew[]` of
  // { userId, username, role }, managed through
  // PUT/DELETE /v3/live/schedules/{id}/crew/{userId}. That is the truth and it
  // is checked first.
  //
  // The three briefing patterns below are the OLD record — before the API had
  // a crew field, the only way to say "somebody has taken this" was a marker
  // Fleet Mode wrote into the briefing itself. Nothing writes them any more,
  // but legs filed under the old scheme are still on the board and still have
  // to read as taken, so they stay as a fallback. Anything that changes what
  // the dormant booking/reposition handlers write must change these with it.
  var CREW_HOLD_RE = /\[FLEETMODE-HOLD until=([^\s\]]+) pilot=([^\]]*)\]/;
  var CREW_BOOKED_RE = /Added via Fleet Mode by (.+?)\s+[—-]/;
  var CREW_FERRY_RE = /\[REPOSITION\][^]*?requested via Fleet Mode by (.+?)\.\s*$/;

  var CREW_ROLE_NAME = { 0: 'Captain', 1: 'First Officer' };
  /** IF caps a schedule at three crew members. */
  var CREW_CAP = 3;

  /** The pilot who holds this leg, or null if it is free. */
  function crewOn(s) {
    // Native crew wins over anything the briefing claims.
    var native = s && Array.isArray(s.crew) ? s.crew.filter(Boolean) : [];
    if (native.length) {
      return {
        kind: 'crew',
        pilot: (native[0].username || '').trim() || 'a pilot',
        members: native,
      };
    }
    var b = String((s && s.briefing) || '');
    var m = b.match(CREW_HOLD_RE);
    // An EXPIRED hold is not crew: the whole point of the soft hold is that it
    // releases the leg back to the pool when it is not flown in time.
    if (m) {
      var until = Date.parse(m[1]);
      if (!isFinite(until) || Date.now() < until) {
        return { kind: 'hold', pilot: (m[2] || '').trim() || 'a pilot' };
      }
      return null;
    }
    m = b.match(CREW_BOOKED_RE);
    if (m) return { kind: 'booked', pilot: m[1].trim() };
    m = b.match(CREW_FERRY_RE);
    if (m) return { kind: 'ferry', pilot: m[1].trim() };
    return null;
  }

  /** The pilot in the left-hand seat, or null. Takes the RESOLVED crew object
   *  from crewOn() — native assignments only, because a legacy briefing marker
   *  records a name and never a role, so there is no seat to read off it.
   *
   *  Infinite Flight does not enforce one Captain per leg (its only crew rule
   *  is the cap of three), so this is the check that stops two commanders on
   *  one aircraft. The server owns the same rule in createCrewRequest(); this
   *  copy exists so the prompt can be raised BEFORE a request is filed. */
  function captainOn(crew) {
    if (!crew || crew.kind !== 'crew') return null;
    return (crew.members || []).find(function (c) { return c && Number(c.role) === 0; }) || null;
  }

  /** Is the signed-in pilot one of this leg's crew? Takes the RESOLVED crew
   *  object from crewOn(). Native assignments only — a legacy briefing marker
   *  carries a display name, never a user id, so it can never match. */
  function myCrewIn(crew) {
    var me = myUserId();
    if (!me || !crew || crew.kind !== 'crew') return null;
    return (crew.members || []).find(function (c) { return c && c.userId === me; }) || null;
  }

  /** The signed-in pilot's Infinite Flight user id, or '' before sign-in. */
  function myUserId() {
    try {
      var auth = window.INVA_FLEET && window.INVA_FLEET.getAuth();
      return (auth && auth.profile && auth.profile.userId) || '';
    } catch (e) { return ''; }
  }

  /** How a taken leg reads on a row: every filled seat by name, in words —
   *  "Captain Thunderbird.02 · First Officer Rhea.S". The cell truncates with
   *  an ellipsis (CSS) rather than collapsing to "2 crew", because WHO is on a
   *  leg is the fact a pilot scans for. A legacy briefing marker records a name
   *  and never a seat, so it reads "Pilot NAME". */
  /** Captain first, then First Officers, then anything unrecognised — stable.
   *  Shared by both crew renderings so their ORDER cannot drift apart. */
  function crewMembersSorted(crew) {
    var members = ((crew && crew.members) || []).filter(Boolean).slice();
    var rankOf = function (c) { return CREW_ROLE_NAME[c.role] ? Number(c.role) : 9; };
    return members.map(function (c, i) { return { c: c, i: i }; })
      .sort(function (p, q) { return rankOf(p.c) - rankOf(q.c) || p.i - q.i; })
      .map(function (x) { return x.c; });
  }

  /** How many pilots are actually rostered. A ferry/hold marker is not crew. */
  function crewCount(crew) {
    return crew && crew.kind === 'crew' ? crewMembersSorted(crew).length : 0;
  }

  function crewLabel(crew) {
    if (!crew) return '';
    if (crew.kind === 'crew') {
      return crewMembersSorted(crew).map(function (c) {
        return (CREW_ROLE_NAME[c.role] || 'Pilot') + ' ' + ((c.username || '').trim() || 'a pilot');
      }).join(' · ');
    }
    return crew.kind === 'ferry' ? 'Ferry · ' + crew.pilot
      : crew.kind === 'hold' ? 'Held by ' + crew.pilot
      : 'Pilot ' + crew.pilot;
  }

  /**
   * crewLabel with the pilot NAMES in bold and Live cyan (.fh-pilot) — the seat
   * words stay plain, so on a long board the eye lands on who is flying rather
   * than on "Captain".
   *
   * Returns HTML, so it escapes its own inputs: a username comes from Infinite
   * Flight and is not ours to trust. crewLabel stays plain text because it also
   * feeds the board's SEARCH index (filterRow), which must not match markup.
   */
  function crewLabelHtml(crew) {
    if (!crew) return '';
    if (crew.kind === 'crew') {
      return crewMembersSorted(crew).map(function (c) {
        return esc(CREW_ROLE_NAME[c.role] || 'Pilot') + ' <strong class="fh-pilot">' +
          esc((c.username || '').trim() || 'a pilot') + '</strong>';
      }).join(' · ');
    }
    var who = '<strong class="fh-pilot">' + esc(crew.pilot) + '</strong>';
    return crew.kind === 'ferry' ? 'Ferry · ' + who
      : crew.kind === 'hold' ? 'Held by ' + who
      : 'Pilot ' + who;
  }

  /** The crew line with the EMPTY seats named too — an empty seat is as much a
   *  fact as a name, and on a long board the absence of a name reads as missing
   *  data rather than as an open leg.
   *    opts.compact  the narrow-cell wording for a leg with nobody on it
   *    opts.live     the leg is already under way: nobody can be requested onto
   *                  it, so no "seat open" text — only who is rostered. */
  function crewSeats(crew, opts) {
    return crewSeatsWith(crew, opts || {}, crewLabel, function (t) { return t; });
  }

  /** crewSeats as HTML, pilot names bold. Do NOT pass the result through esc(). */
  function crewSeatsHtml(crew, opts) {
    return crewSeatsWith(crew, opts || {}, crewLabelHtml, esc);
  }

  /** The seat wording itself — ONE copy, so the plain and bold renderings can
   *  never disagree about which seat is open. */
  function crewSeatsWith(crew, opts, labelFn, escFn) {
    if (!crew) {
      return escFn(opts.live ? 'No crew on the roster'
        : opts.compact ? 'Open · Captain & First Officer seats'
        : 'Captain seat open · First Officer seat open');
    }
    var label = labelFn(crew);
    if (crew.kind !== 'crew' || opts.live) return label;
    var members = crewMembersSorted(crew);
    var hasCap = members.some(function (c) { return Number(c.role) === 0; });
    var hasFo = members.some(function (c) { return Number(c.role) === 1; });
    var parts = label ? [label] : [];
    if (!hasCap) parts.push(escFn('Captain seat open'));
    if (!hasFo && members.length < CREW_CAP) parts.push(escFn('First Officer seat open'));
    return parts.join(' · ');
  }

  /** Raw IF schedules → the leg objects every screen renders from. ONE copy:
   *  model() builds a tail's open legs with it and the History screen builds the
   *  tail's full list (Arrived legs included) with it. */
  function buildLegs(rawSchedules) {
    return (rawSchedules || []).map(function (s, i) {
        return {
          id: s.id,
          // The leg's INDEX on its own aircraft: IF's `sequence` (the order the
          // tail flies them in — every leg is timeless now), else its place in
          // IF's list, which IF returns ordered by sequence anyway.
          seq: s.sequence != null && isFinite(Number(s.sequence)) ? Number(s.sequence) : null,
          idx: i,
          cs: s.callsign || '—',
          ft: s.flightType,
          ftName: FT[s.flightType] || 'Flight',
          o: String(s.originIcao || '').toUpperCase(),
          d: String(s.destinationIcao || '').toUpperCase(),
          depT: Date.parse(s.scheduledDepartureUtc),
          arrT: Date.parse(s.scheduledArrivalUtc),
          // IF's own "Schedule type: Timeless" flag (2026-10-05 preview). The
          // board has always INFERRED this from the 0001 sentinel below; the
          // flag is the authoritative answer and is preferred where present.
          timeless: s.isTimeless === true,
          adepT: s.actualDepartureUtc ? Date.parse(s.actualDepartureUtc) : null,
          aarrT: s.actualArrivalUtc ? Date.parse(s.actualArrivalUtc) : null,
          ss: s.status,
          ssMeta: SS[s.status] || SS[0],
          crew: crewOn(s),
          // IF's filed route string ("VIDP DPN BBB VABB"), for the SimBrief
          // dispatch. Deliberately NOT `briefing` as well: crewOn() above
          // already reads that, and a second reader would become a second,
          // divergent source of "who has this leg".
          fp: s.flightPlan || null,
        };
      // A leg with no scheduled time carries .NET's DateTime.MinValue —
      // "0001-01-01T00:00:00+00:00" — which Date.parse turns into roughly
      // -62135596800000. These are the legs Infinite Flight's own board labels
      // "Anytime", and they are REAL: VT-TSD's VABB→EGLL and VT-AEF's
      // KSFO→VOBL both arrived this way. Dropping them for having no clock
      // (the old `depT > 0 && arrT > 0` filter) made them vanish from the
      // board entirely. Keep them, flag them, and print "Anytime" instead of
      // 1 Jan 0001.
      }).map(function (s) {
        // IF now SAYS so (`isTimeless`, 2026-10-05 preview) instead of leaving
        // us to infer it from the 0001 sentinel. The sentinel check stays as
        // the fallback: a leg read from cache, or from a tail synced before the
        // flag existed, still arrives without it.
        s.timed = s.timeless === true ? false : (s.depT > 0 && s.arrT > 0);
        return s;
      // Keep every leg that still has to happen, timed or not. An untimed
      // ARRIVED row carries no information and no clock, so it is dropped;
      // an untimed open one is a real "Anytime" leg and two of those were
      // airborne the last time this was checked.
      }).filter(function (s) { return s.timed || isOpenLeg(s); });
  }

  /** The airport a tail with no position is parked at, read off its queue: the
   *  origin of its lowest-sequence open leg, unless it is already flying that
   *  leg (status 6 — then the tail is between airports and the feed decides). */
  function airportFromLegs(sch) {
    var first = (sch || []).filter(isOpenLeg).sort(legIndexOrder)[0];
    return first && first.ss !== 6 && first.o ? first.o : null;
  }

  /** Raw fleet read → the shape every screen renders from. */
  function model() {
    // Bid-only tails (plan §7.5): a Set built once per model() call, off the
    // list the fleet read carried (empty when the feature is off).
    var bidOnlySet = {};
    (data.bidOnlyTails || []).forEach(function (r) { bidOnlySet[normReg(r)] = true; });
    var flexSet = {};
    ((data.flex && data.flex.tails) || []).forEach(function (r) { flexSet[normReg(r)] = true; });
    // ...and every tail of a Flex type (the server's isFlexTail asks the same).
    var flexTypes = (data.flex && data.flex.types) || [];
    return (data.aircraft || []).map(function (a) {
      var bidOnly = !!bidOnlySet[normReg(a.registration)];
      var flexTail = !!flexSet[normReg(a.registration)] || flexTypes.indexOf(typeCode(a.typeName)) !== -1;
      var flexEntry = flexTail && data.flex.byAircraft ? data.flex.byAircraft[a.id] || null : null;
      var pos = a.position || null;
      var sch = buildLegs(a.schedules);

      // A tail's legs in its own flying order (owner, 2026-10-12) — replaces
      // the old timed-first, departure-ascending order, which meant nothing
      // once every leg went timeless.
      sch.sort(legIndexOrder);
      // Effective arrival. Today it IS the filed arrival: a raw fleet read
      // proved actualDepartureUtc and actualArrivalUtc are always null on this
      // org's legs, so there is nothing better to derive it from. Kept as its
      // own field because every downstream figure reads it — when a real
      // departure time does become available, this is the one line to change.
      sch.forEach(function (s) { s.eArr = s.arrT; });
      // Bid-only tails (plan §7.5): tail-level, stamped onto every leg so
      // crewBlockReason(s) — which only ever sees a leg, never its tail — can
      // refuse without a second parameter.
      if (bidOnly) sch.forEach(function (s) { s.bidOnly = true; });
      // Flex Crew, the same way: every leg knows its tail is Flex, and the leg
      // in play carries the sweep's picture of it (flexCoPilot reads both).
      if (flexTail) {
        sch.forEach(function (s) {
          s.flexTail = true;
          s.flexEntry = flexEntry && flexEntry.legId === s.id ? flexEntry : null;
        });
      }

      // ── which legs are actually being flown? ─────────────────────────────
      // The LIVE SESSION FEED is the authority. Nothing in the persisted read
      // distinguishes a tail in the cruise from one parked at the gate, so
      // when the feed is available a tail's presence in it decides, and its
      // ABSENCE is proof the tail is not flying — whatever status 6 claims.
      // Without a feed (`liveSession` false) absence proves nothing, and the
      // old timing rule stands: no data is not evidence.
      //
      // Decided once, here, so the board, the Schedules screen, the rail, the
      // hub inbound counts and the history timeline cannot disagree. A tail
      // with two open legs (it happens — the pilot filed twice) shows both,
      // which is what Infinite Flight itself does.
      // The live feed carries every CONNECTED tail, parked ones included — a
      // match means "we have a real current position", NOT "airborne".
      // Verified against the Expert feed: VT-TSD 36000ft/519kt and VT-AEF
      // 28ft/0kt were both present. Altitude and speed are what separate them
      // (isConnected and pilotState read identically on all of them).
      var lf = (data.live && data.live[a.id]) || null;
      var feed = !!data.liveSession;
      var lfMoving = !!lf && posIsMoving({ alt: lf.altitude, spd: lf.speed });
      var at = a.airport ? a.airport.icao : null;
      // The board read no longer fetches a position for a tail that has an open
      // leg (5 calls/minute per pilot): its queue says where it is parked.
      var atDerived = false;
      if (!at && !pos) {
        at = airportFromLegs(sch);
        atDerived = !!at;
      }
      // The persisted record says the tail was left in the air. Only consulted
      // WITHOUT a feed now. `isOnGround` is the field to use, NOT altitude:
      // VOBL sits at ~3,000 ft and a bare altitude test calls everything parked
      // there airborne, which is exactly how VT-BWE was reported Stopped.
      var posAirborne = !!pos && pos.isOnGround === false;
      // A feed was read and this tail is not in it: nobody is connected in it,
      // whatever any schedule OR the persisted record claims. This is the whole
      // discriminator.
      //
      // It used to exempt a record left mid-air (`&& !posAirborne`, VT-JRB,
      // July), when IF's own page called such a tail In flight and every
      // stopped tail's record read on-ground. Since ~2026-10 IF persists the
      // mid-air fix when a session ends in the air (state 2, isOnGround false)
      // and its page calls those tails STOPPED — on 2026-10-11 all seven tails
      // absent from the feed read that way (GHF 15 h old, TVA, AWC…), and the
      // exemption painted every one of them In flight. Parked tails sit IN the
      // feed at 0 kt, so absence is still the clean signal.
      var orphaned = feed && !lf;

      // An aircraft flies ONE leg at a time. Infinite Flight leaves rows at
      // status 6 forever, so a tail can carry several: VT-JRE had two open at
      // once (VIDP→LIRF and VIDP→EGLL) and both resolved to the same phase,
      // which put the same aircraft on the board twice, in two places.
      //
      // The official site knows which is real from `flightPlanInfo.waypoints`
      // — for VT-JRE it read VIDP…LIRF, the EARLIER of the two. Public v3
      // exposes no waypoints (`GET /live/aircraft/{id}` is fleet-slot metadata
      // only, confirmed by calling it), so the rule is the ordering: schedules
      // are flown in sequence, `sch` is already in leg-index order, and
      // the earliest still-open leg is the one that blocked the queue. Later
      // rows at 6 are leftovers and are demoted to stale.
      var claimsAir = sch.filter(function (s) { return s.ss === 6; });
      var claimed = false;
      claimsAir.forEach(function (s) {
        // With a feed, "airborne" means present in it AND moving — absence is
        // a stop, whatever the record says (see `orphaned`). Without one, the
        // clock is all we have — no data is not evidence.
        var isLive = feed ? lfMoving
          : (s.timed && legIsAirborne(s.eArr, Date.now()));
        s.phase = legPhase(isLive, at, s.o, s.d, orphaned);
        // Only the first leg that claims the aircraft keeps it.
        if (s.phase === 'air' || s.phase === 'stopped') {
          if (claimed) s.phase = 'stale';
          else claimed = true;
        }
        s.air = s.phase === 'air';
        s.stopped = s.phase === 'stopped';
        // "Next" is a real upcoming flight, not a leftover — never dim it.
        // Neither is a stop: that leg is happening, it just lost its pilot.
        s.stale = s.phase === 'done' || s.phase === 'stale';
        if (s.phase === 'done') s.ssMeta = DONE_META;
        else if (s.phase === 'stale') s.ssMeta = STALE_META;
        else if (s.phase === 'stopped') s.ssMeta = STOPPED_META;
        else if (s.phase === 'next') s.ssMeta = SS[1] || s.ssMeta;
      });
      // The leg this tail is on. A genuinely airborne one wins over a stopped
      // one — a tail can only be flying one of them, and the feed knows which.
      var airborne = claimsAir.find(function (s) { return s.air; }) || null;
      var stoppedLeg = claimsAir.find(function (s) { return s.stopped; }) || null;
      var active = airborne || stoppedLeg;

      // Display times (departs / arrives / time to run / block). Stamped AFTER
      // the phases, because they read s.air / s.stopped — and only ever ADD
      // fields: nothing above is re-derived from them. See annotateTimes().
      var famName = family(typeCode(a.typeName));
      sch.forEach(function (s) { annotateTimes(s, famName, lf, Date.now()); });

      // ── where is this tail? ──────────────────────────────────────────────
      // AircraftPersistenceState 0 = Unknown and 3 = Cancelled say nothing
      // about position, and the docs warn the persisted state goes stale when
      // an aircraft is not actively reporting. Left alone, such a tail fell
      // outside every bucket: the stat row read 0/0/0 while the map cheerfully
      // drew it, and the Airline page (which counts SCHEDULE status) disagreed
      // with both. So resolve Unknown from the evidence we do have.
      var st = pos && isFinite(Number(pos.state)) ? Number(pos.state) : 0;
      // Airborne beyond argument: at a mile up and moving, no reported state
      // says otherwise.
      var flying = lf ? lfMoving
        : (!!pos && Number(pos.altitude) > 1000 && Number(pos.speed) > 50);
      // A live match settles it: in the feed and moving is flying, in the feed
      // and still is parked. There is no third case here — every tail IF calls
      // Stopped is ABSENT from the feed, so a stop is decided below.
      if (lf) st = lfMoving ? 2 : 1;
      // Nobody is connected in a tail that Infinite Flight still shows on a
      // leg. That is Stopped, and it is the ONLY way this board reaches state
      // 4: AircraftPersistenceState read 0 on every tail until ~2026-10, and
      // since then reads 1/2 — a stopped tail reports 2 (airborne), never 4
      // (2026-10-11 read, all 31 tails). There is no 4 from the API to wait for.
      else if (stoppedLeg) st = 4;
      // Off the feed with a record left in the air but no leg still running:
      // the same stop, with the paperwork already closed.
      else if (feed && posAirborne) st = 4;
      else if (st === 0 || st === 3) {
        if (posAirborne) st = 2;
        else if (flying) st = 2;
        else if (airborne) st = 2;            // a leg is genuinely running
        else if (pos || atDerived) st = 1;
      }
      // A persisted OnGround does NOT outrank a live leg. The record says
      // where the tail was LEFT, and it is not rewritten while the flight is
      // in progress — every aircraft IF's own org page showed en route still
      // read OnGround here. 4 (Stopped, ending in the air) and 5 (Maintenance)
      // are states the API committed to about a tail that is not simply
      // parked, so leave those alone.
      if ((flying || airborne) && (st === 1 || st === 0)) st = 2;

      // IF calls a hangared tail, or one pushed outside the active fleet slots,
      // "stored". For now no INVA aircraft is stored (owner, 2026-11-03): those
      // tails sit in the VIRTUAL HANGAR and still fly, so `stored` is false and
      // every bucket, count and sort treats them as in service; `hangar` only
      // labels them. The server's copy is isStoredTail() in fleet-tail-lookup.js.
      var hangar = a.isFleetActiveSlot === false || a.visibility === 2;
      var stored = false;
      // One bucket per tail, used by the meta chip, the stat row, the legend,
      // the map filter AND the markers — they cannot disagree again.
      //
      // A live leg outranks "stored". Outside the active fleet slots is a
      // BOOKING restriction, not a claim about where the aircraft is: VT-JRB
      // sat in our Stored rail while IF's org page had it airborne on
      // LIRF→KEWR with 30 minutes to run. `flyable` below still refuses it,
      // which is the part that actually matters.
      var bucket = (stored && !active) ? 'stored'
        : st === 2 ? 'inflight'
        : st === 4 ? 'stopped'
        : st === 5 ? 'maint'
        : 'ground';
      var meta = bucket === 'stored' ? STORED
        : bucket === 'inflight' ? IN_FLIGHT
        : bucket === 'stopped' ? STOPPED
        : bucket === 'maint' ? MAINT
        : ON_GROUND;

      // In the air with a pilot, or stopped and still finishing the leg —
      // either way the tail is between airports, not parked.
      var enRoute = bucket === 'inflight' || bucket === 'stopped';

      var code = typeCode(a.typeName);
      var upd = pos && pos.updatedAt ? Date.parse(pos.updatedAt) : NaN;
      var atCoords = !lf && !pos && atDerived ? coords(at) : null;
      return {
        id: a.id,
        reg: a.registration || '—',
        ty: code,
        fam: family(code),
        typeName: a.typeName || null,
        rank: a.fleetRank,
        stored: stored,
        hangar: hangar,
        outOfSlot: stored && a.isFleetActiveSlot === false,
        bidOnly: bidOnly,
        st: st,
        bucket: bucket,
        meta: meta,
        // The live fix when we have one — it is the only position that is
        // actually current. The persisted record is where the tail was LEFT.
        // No fix at all (parked tail with an open leg): the field it sits on.
        lat: lf ? lf.latitude : pos ? pos.latitude : atCoords ? atCoords[1] : null,
        lon: lf ? lf.longitude : pos ? pos.longitude : atCoords ? atCoords[0] : null,
        alt: lf ? lf.altitude : pos ? pos.altitude : 0,
        spd: lf ? lf.speed : pos ? pos.speed : 0,
        vs: lf ? lf.verticalSpeed : pos ? pos.verticalSpeed : 0,
        hdg: lf ? lf.heading : pos ? pos.heading : 0,
        live: lf,
        pilot: (lf && lf.username) || (pos && pos.lastPilotUsername) || null,
        upd: upd,
        at: at,
        hold: a.hold || null,
        sch: sch,
        active: active,
        next: sch.find(function (s) { return s.ss !== 6 && s.ss !== 11 && s.ss !== 9; }) || null,
        enRoute: enRoute,
        stale: st !== 2 && st !== 4 && isFinite(upd) && (Date.now() - upd) > 6 * H,
        flyable: !stored && st !== 2 && st !== 4 && st !== 5,
        // READY TO FLY (owner, 2026-10-12): flyable AND its first leg — the
        // next one by index — has nobody on it. A tail whose leg #1 is rostered
        // is somebody's, whatever else it carries; one with no open leg has
        // nothing to fly.
        readyToFly: !stored && st !== 2 && st !== 4 && st !== 5 &&
          (function () { var first = sch.find(isOpenLeg); return !!first && !first.crew; })(),
      };
    });
  }

  function selected(all) {
    return all.find(function (a) { return a.id === ui.sel; }) ||
      all.find(function (a) { return !a.stored; }) || all[0] || null;
  }
  function passesFilter(a) {
    var f = ui.filter;
    return f === 'ALL' || (f === 'IN' && a.bucket === 'inflight') ||
      (f === 'GND' && a.bucket === 'ground') || (f === 'FLY' && a.readyToFly);
  }

  // ── shared render helpers ──────────────────────────────────────────────
  /** The route arrow. A mono glyph since the 2026-09-03 redesign: at the new
   *  type scale the drawn 1px line-and-head between two 17px ICAOs read as a
   *  rendering artefact rather than as a mark. The old colour/width arguments
   *  are accepted and ignored — every caller passed the same muted grey, so
   *  the colour now lives in .fh-arr rather than in a hundred inline styles. */
  function arrow() {
    return '<span class="fh-arr" aria-hidden="true">→</span>';
  }
  /** Status chip. Takes a whole meta ([label, colour, class]) so the two
   *  families of meta cannot be passed in different orders — see the meta
   *  block at the top. Colour comes from the class, not from inline style. */
  function chip(meta) {
    if (!meta) return '';
    return '<span class="fh-chip fh-chip-' + (meta[2] || 'sched') + '">' + esc(meta[0]) + '</span>';
  }
  function tyChip(ty) { return '<span class="fh-ty">' + esc(ty) + '</span>'; }

  /**
   * The ONE route display: origin code + city, a hairline track with an
   * arrowhead, destination code + city. Codes in mono, names in sans and
   * truncating (CSS), never wrapping the layout. It lives INSIDE an existing
   * Route cell — it is one child, so the 8/6/6 cell contracts are untouched.
   *   opts.cls    size variant: 'fh-route-sm' | 'fh-route-lg'
   *   opts.pct    a progress dot on the track ('42%'), for a leg under way
   *   opts.color  that dot's status colour
   * Chrome only, so greys: the dot is the one thing that carries status.
   */
  function routeHtml(o, d, opts) {
    opts = opts || {};
    var end = function (icao, cls) {
      var name = city(icao), c = code(icao);
      return '<span class="fh-rp' + cls + '"><span class="fh-icao">' + esc(c) + '</span>' +
        (name && name !== c ? '<span class="fh-rn">' + esc(name) + '</span>' : '') + '</span>';
    };
    return '<span class="fh-route' + (opts.cls ? ' ' + opts.cls : '') + '">' + end(o, '') +
      '<span class="fh-rtrack" aria-hidden="true">' +
        (opts.pct != null ? '<i style="left:' + opts.pct + ';--c:' + (opts.color || 'var(--fh-sched)') + '"></i>' : '') +
      '</span>' + end(d, ' to') + '</span>';
  }
  /** A moment as a clock string, "≈" for an estimate, "—" for none. Dates
   *  come along once it is not today/tomorrow (istClock). */
  function clockText(t, via) {
    return Number.isFinite(t) ? (via === 'approx' ? '≈ ' : '') + istClock(t) : '—';
  }

  // ── aircraft photo ─────────────────────────────────────────────────────
  // The real airframe, from the same Planespotters source the dispatch page
  // uses (assets/js/aircraft-photo.js owns the fetch, the cache and the
  // attribution markup). Sharing the module also shares the session cache, so
  // a tail already seen on dispatch appears here with no request at all.
  //
  // These screens re-render on every poll, so a slot that always started empty
  // would blink the photo out and back roughly every 30s. When the answer is
  // already cached we emit the <img> inline and the re-render is seamless;
  // only a genuinely unknown registration gets the fill-in-later slot.
  function photoHtml(reg, cls) {
    var api = window.INVAAircraftPhoto;
    if (!api || !reg || reg === '—') return '';
    var known = api.peek(reg);
    if (known === null) return '';    // looked up, has no photo — show nothing
    if (known) {
      return '<div class="' + cls + '">' + api.markup(known, {
        reg: reg, linkClass: 'fh-photo-link', creditClass: 'fh-photo-credit',
      }) + '</div>';
    }
    return '<div class="' + cls + '" data-fh-photo="' + esc(reg) + '" hidden></div>';
  }

  function fillPhotos() {
    var api = window.INVAAircraftPhoto;
    if (!api) return;
    Array.prototype.forEach.call(document.querySelectorAll('[data-fh-photo]'), function (slot) {
      var reg = slot.getAttribute('data-fh-photo');
      slot.removeAttribute('data-fh-photo');   // claimed — never fetched twice
      api.get(reg).then(function (photo) {
        if (!photo || !slot.isConnected) return;
        // eslint-disable-next-line no-unsanitized/property -- safe: markup built by this module (data escaped where built) or an internal enum/constant
        slot.innerHTML = api.markup(photo, {
          reg: reg, linkClass: 'fh-photo-link', creditClass: 'fh-photo-credit',
        });
        slot.hidden = false;
      });
    });
  }

  function progress(s) {
    // A stopped leg is still a leg in progress — it just lost its pilot. The
    // filed clock is the only thing left to place it on.
    if (!s.air && !s.stopped) return 0;
    var dep = s.adepT || s.depT;
    var arr = s.eArr;                      // when it really arrives, not as filed
    if (!isFinite(dep) || !isFinite(arr) || arr <= dep) return 0;
    return Math.min(0.97, Math.max(0.03, (Date.now() - dep) / (arr - dep)));
  }

  // ── live progress, ETE and ETA ─────────────────────────────────────────
  // For a tail that IS flying, the schedule clock is the plan, not the truth:
  // it was filed hours ago and takes no account of the winds, the route or a
  // late push. Where we have the aircraft's position and its destination we
  // derive these from the great-circle distance still to run instead, which
  // is the same thing Infinite Flight shows. Every one of these returns null
  // rather than a guess when the inputs are missing — the caller prints '—'.
  var NM_PER_RAD = 3440.065;
  function nmBetween(lat1, lon1, lat2, lon2) {
    var r = Math.PI / 180;
    var dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
    // Same operations, in the same order, as nmBetween in lib/actions/fleet-live.js
    // (** 2, not x * x — the two can differ in the last bit, and the parity test
    // demands identical ETEs).
    var s = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
    return 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s)) * NM_PER_RAD;
  }
  /** Great-circle miles still to run, or null. */
  function nmRemaining(a, s) {
    var d = data.airports[s.d];
    if (!d || !isFinite(d.lat) || !isFinite(a.lat) || !isFinite(a.lon)) return null;
    return nmBetween(a.lat, a.lon, d.lat, d.lon);
  }
  // Both figures return null unless the position is actually moving, and the
  // callers fall back to the scheduled clock — which is exactly what Infinite
  // Flight's own org page shows. The persisted position of a tail in flight
  // is usually still sitting at the departure gate, and using it would report
  // "1% flown" and an ETE of several days on a flight halfway across an ocean.
  /** Milliseconds to destination at the current ground speed, or null. */
  function liveEte(a, s) {
    var rem = nmRemaining(a, s);
    if (rem == null || !posIsMoving(a)) return null;
    return (rem / Number(a.spd)) * H;
  }
  /** Fraction of the great-circle actually covered, or null. */
  function liveProgress(a, s) {
    var o = data.airports[s.o];
    var rem = nmRemaining(a, s);
    if (rem == null || !posIsMoving(a) || !o || !isFinite(o.lat)) return null;
    var total = nmBetween(o.lat, o.lon, data.airports[s.d].lat, data.airports[s.d].lon);
    if (!(total > 1)) return null;
    return Math.min(0.99, Math.max(0.01, 1 - rem / total));
  }

  // ── departure / arrival the way the Discord /status bot resolves them ──────
  // FAITHFUL COPIES of lib/actions/fleet-live.js (isFlyingFix, liveEteMs) and
  // lib/actions/fleet-status.js (effectiveArrival, depMs, actualDepMs).
  // tests/calc/fleetTimesParity.test.js feeds the same fixes to both and expects
  // identical ETEs — change one side and that test fails.
  //
  // ARRIVAL   live   the tail has a FLYING fix in the live feed: now + great-circle
  //                  nm(fix → destination) / ground speed. Beats the filed clock.
  //           filed  scheduledArrivalUtc.
  //           none   "—". Never guessed.
  // DEPARTURE filed  scheduledDepartureUtc, else the actual off-blocks time.
  //
  // Deliberately NOT the persisted position: legFigures() below still falls back
  // to it for the progress bar, but a time on screen must mean what /status
  // means by it, and /status reads the live feed only.
  //
  // These feed NEW display fields (s.etaShown / etaVia / depShown / depVia /
  // eteShown / blockShown …, see annotateTimes). They never touch s.eArr or the
  // phase: what a leg IS (flying, stopped, landed) is decided elsewhere and is
  // not derived from anything printed here.
  var MIN_GROUND_SPEED_KT = 40;   // = MIN_GROUND_SPEED_KT in fleet-live.js
  var MIN_ALTITUDE_FT = 1000;     // = MIN_ALTITUDE_FT in fleet-live.js

  /** A finite number, or NaN — and null counts as NaN (Number(null) is 0, which
   *  would read a missing coordinate as 0°N 0°E). Mirrors num() in fleet-live.js. */
  function numOrNaN(v) {
    if (v === null || v === undefined || v === '') return NaN;
    var n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  }
  /** Is this live fix an aircraft in the climb/cruise/descent? Speed AND altitude. */
  function isFlyingFix(fix) {
    var spd = numOrNaN(fix && fix.speed);
    var alt = numOrNaN(fix && fix.altitude);
    return spd >= MIN_GROUND_SPEED_KT && alt > MIN_ALTITUDE_FT;
  }
  /** Milliseconds still to run to dest ({lat, lon}) at the fix's ground speed,
   *  or null when that cannot honestly be computed. */
  function liveEteMs(fix, dest) {
    if (!isFlyingFix(fix)) return null;
    if (!dest || !Number.isFinite(dest.lat) || !Number.isFinite(dest.lon)) return null;
    var lat = numOrNaN(fix && fix.latitude);
    var lon = numOrNaN(fix && fix.longitude);
    if (isNaN(lat) || isNaN(lon)) return null;
    var nm = nmBetween(lat, lon, dest.lat, dest.lon);
    var hours = nm / numOrNaN(fix.speed);
    if (!Number.isFinite(hours) || hours < 0) return null;
    return hours * 3600000;
  }
  /** A schedule timestamp that is a real time — not NaN, not .NET's MinValue. */
  function validMs(t) { return typeof t === 'number' && Number.isFinite(t) && t >= 0; }
  /** When the leg arrives and how we know: {eta, via: 'live'|'filed'|null}. */
  function effectiveArrival(fix, dest, filedArrMs, now) {
    var ete = fix ? liveEteMs(fix, dest) : null;
    if (ete !== null) return { eta: now + ete, via: 'live' };
    if (validMs(filedArrMs)) return { eta: filedArrMs, via: 'filed' };
    return { eta: NaN, via: null };
  }

  // ── approximate block time ─────────────────────────────────────────────────
  // For a leg with no filed times (an "Anytime" leg, or one already in flight
  // that was never timed). Great-circle distance at a family cruise speed, plus
  // a flat allowance for taxi, climb and descent, rounded to 5 minutes. Always
  // printed with "≈": it is an estimate and must never read as a filed figure.
  var CRUISE_KT = { 'Narrow-body': 440, 'Wide-body': 480, 'Turboprop': 270 };
  var BLOCK_ALLOWANCE_MS = 30 * 60000;
  var BLOCK_ROUND_MS = 5 * 60000;
  function approxBlockMs(nm, fam) {
    if (typeof nm !== 'number' || !(nm > 1) || !Number.isFinite(nm)) return null;
    var kt = CRUISE_KT[fam] || CRUISE_KT['Narrow-body'];
    var ms = (nm / kt) * H + BLOCK_ALLOWANCE_MS;
    return Math.round(ms / BLOCK_ROUND_MS) * BLOCK_ROUND_MS;
  }
  /** An airport's {lat, lon}, or null when the reference has no coordinates. */
  function airportPt(icao) {
    var a = data.airports[icao];
    return a && Number.isFinite(a.lat) && Number.isFinite(a.lon) ? a : null;
  }

  /**
   * Stamp the DISPLAY times onto one leg. Pure with respect to phase: reads
   * s.air / s.stopped / s.stale, never writes them.
   *
   *   etaShown / etaVia    arrival        via 'live' | 'filed' | null
   *   eteShown / eteVia    time to run    via 'live' | 'filed' | null
   *   depShown / depVia    departure      via 'filed' | 'actual' | 'approx' | null
   *   blockShown / blockVia block         via 'filed' | 'approx' | null
   *
   * 'approx' departure exists only for a leg in the air with a LIVE ETA and no
   * filed times: ETA minus the approximate block.
   */
  function annotateTimes(s, fam, fix, now) {
    var flying = !!(s.air || s.stopped);
    var live = s.air && fix && isFlyingFix(fix) ? fix : null;
    var oPt = airportPt(s.o), dPt = airportPt(s.d);

    var arr = s.stale ? { eta: NaN, via: null } : effectiveArrival(live, dPt, s.arrT, now);
    s.etaShown = arr.eta; s.etaVia = arr.via;

    s.eteShown = null; s.eteVia = null;
    if (flying && Number.isFinite(arr.eta)) {
      var rem = arr.eta - now;
      if (arr.via === 'live') { s.eteShown = rem; s.eteVia = 'live'; }
      else if (rem > 0) { s.eteShown = rem; s.eteVia = 'filed'; }
    }

    var nm = oPt && dPt ? nmBetween(oPt.lat, oPt.lon, dPt.lat, dPt.lon) : null;
    var approx = nm != null ? approxBlockMs(nm, fam) : null;
    if (s.timed && s.arrT > s.depT) { s.blockShown = s.arrT - s.depT; s.blockVia = 'filed'; }
    else if (approx != null) { s.blockShown = approx; s.blockVia = 'approx'; }
    else { s.blockShown = null; s.blockVia = null; }

    s.depShown = NaN; s.depVia = null;
    if (validMs(s.depT)) { s.depShown = s.depT; s.depVia = 'filed'; }
    else if (validMs(s.adepT)) { s.depShown = s.adepT; s.depVia = 'actual'; }
    else if (flying && arr.via === 'live' && approx != null) {
      s.depShown = arr.eta - approx; s.depVia = 'approx';
    }
  }

  /** "≈ 2h 15m" for an estimate, "2h 15m" for a filed figure, "—" for neither. */
  function blockText(s) {
    if (!s || s.blockShown == null) return '—';
    var t = dur(s.blockShown);
    return t !== '—' && s.blockVia === 'approx' ? '≈ ' + t : t;
  }
  /** A departure as text: "≈ 05:10" (estimate) · "05:10" · "—". */
  function depText(s) {
    if (!s || !Number.isFinite(s.depShown)) return '—';
    return (s.depVia === 'approx' ? '≈ ' : '') + ist(s.depShown) + istDayOffset(s.depShown);
  }
  /** Marks a figure as live: a small dot painted on the element's own
   *  background (class only — an extra element inside a .fh-num / .fh-eta-t
   *  would give the board's no-wrap check a second line box to measure). */
  var VLIVE_TITLE = 'Live — worked out from the aircraft\'s position and ground speed';
  function vLive(via) { return via === 'live' ? ' fh-vlive' : ''; }
  function vLiveAttr(via) { return via === 'live' ? ' title="' + esc(VLIVE_TITLE) + '"' : ''; }

  /**
   * Time and distance to run for one leg — the single place that decides
   * between the live position and the filed clock, so the board, the rail and
   * the flight dialog cannot print three different arrival times for the same
   * flight.
   *
   * A moving position wins. Otherwise fall back to the schedule, exactly as
   * Infinite Flight's own org page does: it shows a leg's ETE counting down
   * against its scheduled arrival, and shows no ETE at all before departure.
   * "Airborne, no fix" must never render as an em dash — a flight halfway to
   * San Francisco with a blank ETE reads as broken.
   */
  function legFigures(a, s) {
    if (!s || (!s.air && !s.stopped)) {
      return { ete: null, etaAt: s && s.stale ? null : (s ? s.eArr : null), f: 0, live: false };
    }
    // Nothing is flying a stopped leg, so there is no ground speed to derive
    // anything from — its last reported position is frozen. Filed clock only.
    var ete = s.air ? liveEte(a, s) : null;
    if (ete != null) {
      var lp = liveProgress(a, s);
      return { ete: ete, etaAt: Date.now() + ete, f: lp != null ? lp : progress(s), live: true };
    }
    var rem = s.eArr - Date.now();
    return { ete: rem > 0 ? rem : null, etaAt: s.eArr, f: progress(s), live: false };
  }

  // ── FLEET screen ───────────────────────────────────────────────────────
  // (syncStripFade lived here until 2026-09-03. The aircraft strip was a
  // horizontal card scroller with a right-edge fade to say "there is more
  // fleet that way"; it is a vertical list now, so there is no off-screen
  // fleet to advertise and nothing to keep in sync.)

  function renderFleet(all) {
    var active = all.filter(function (a) { return !a.stored; });
    var stored = all.filter(function (a) { return a.stored; });
    var count = function (fn) { return all.filter(fn).length; };
    var nIn = count(function (a) { return a.bucket === 'inflight'; });
    var nOn = count(function (a) { return a.bucket === 'ground'; });
    var nStop = count(function (a) { return a.bucket === 'stopped'; });
    var nFly = count(function (a) { return a.readyToFly; });
    var nMaint = count(function (a) { return a.bucket === 'maint'; });
    var nHangar = count(function (a) { return a.hangar; });
    $('fhFleetSub').textContent = all.length + ' aircraft · updated ' +
      (data.syncedAt ? ist(data.syncedAt) + ' IST' : '—');

    // The KPI strip IS the filter (DESIGN.md §6.8, "tiles as filters"): four
    // cells, each a button that narrows the map and the list, the pressed one
    // marked. Before 2026-10-08 the same four counts sat twice — as stats AND
    // as pills on the map. Every bucket still shows: the bar underneath splits
    // the whole fleet, so its legend always adds up to "All aircraft".
    // [filter, label, value, colour class, suffix, sub-line]. Colour arrives
    // as a CLASS — the palette lives in fleet-mode.html and nowhere else.
    var tiles = [
      ['ALL', 'All aircraft', all.length, '', '',
        active.length + ' in service' + (stored.length ? ' · ' + stored.length + ' stored' : '') +
          (nHangar ? ' · ' + nHangar + ' in virtual hangar' : '')],
      // "more": stopped and maintenance tails are buckets of their own, not
      // part of the figure above them.
      ['IN', 'In flight', nIn, 'fh-c-air', '',
        nStop ? nStop + ' more stopped en route' : nIn ? 'being flown now' : 'nothing in the air'],
      ['GND', 'On ground', nOn, 'fh-c-gnd', '',
        nMaint ? nMaint + ' more in maintenance' : 'parked at an airport'],
      ['FLY', 'Ready to fly', nFly, '', '/' + all.length, '', readyPills(all)],
    ];
    var parts = [
      ['In flight', nIn, 'air'], ['Stopped', nStop, 'stop'], ['On ground', nOn, 'gnd'],
      ['Maintenance', nMaint, 'warn'],
    ].concat(stored.length ? [['Stored', stored.length, 'sched']] : []);
    // eslint-disable-next-line no-unsanitized/property -- safe: markup built by this module (data escaped where built) or an internal enum/constant
    $('fhStats').innerHTML = tiles.map(function (s) {
      var on = ui.filter === s[0];
      return '<button class="fh-stat" type="button" data-filter="' + s[0] + '" aria-pressed="' + on + '">' +
        '<span class="fh-k">' + esc(s[1]) + '</span>' +
        '<span class="fh-stat-v' + (s[3] ? ' ' + s[3] : '') + '">' + s[2] +
          (s[4] ? '<small>' + esc(s[4]) + '</small>' : '') + '</span>' +
        // s[6], when given, is markup built from escaped parts (readyPills).
        '<span class="fh-stat-s">' + (s[6] != null ? s[6] : esc(s[5])) + '</span></button>';
    }).join('') +
      '<div class="fh-statbar">' +
        '<div class="fh-statbar-track" role="img" aria-label="' + esc(parts.filter(function (p) { return p[1]; })
          .map(function (p) { return p[1] + ' ' + p[0].toLowerCase(); }).join(', ')) + '">' +
          parts.filter(function (p) { return p[1]; }).map(function (p) {
            return '<span class="fh-fill-' + p[2] + '" style="flex:' + p[1] + '"></span>';
          }).join('') + '</div>' +
        '<div class="fh-legend">' + parts.filter(function (p) { return p[1] || p[2] !== 'warn'; }).map(function (p) {
          return '<span class="fh-leg"><span class="fh-dot' + (p[2] === 'sched' ? ' sq' : '') + '" style="--c:var(--fh-' + p[2] + ')"></span>' +
            esc(p[0]) + ' <b>' + p[1] + '</b></span>';
        }).join('') + '</div>' +
      '</div>';

    // The map's own key: what each marker shape means.
    // eslint-disable-next-line no-unsanitized/property -- safe: markup built by this module (data escaped where built) or an internal enum/constant
    $('fhLegend').innerHTML = [
      ['In flight', 'var(--fh-air)', true], ['Stopped', 'var(--fh-stop)', true],
      ['On ground', 'var(--fh-gnd)', false],
    ].concat(stored.length ? [['Stored', 'var(--fh-sched)', false]] : []).map(function (l) {
      return '<span class="fh-leg">' + (l[2]
        ? '<span class="fh-leg-plane" style="color:' + l[1] + '">' + PLANE_SVG + '</span>'
        : '<span class="fh-dot' + (l[0] === 'Stored' ? ' sq' : '') + '" style="--c:' + l[1] + '"></span>') +
        '<span>' + l[0] + '</span></span>';
    }).join('') + '<span class="fh-leg"><img src="' + LOGO + '" alt=""><span>Hub</span></span>';

    var shown = active.filter(passesFilter);
    $('fhFleetCount').textContent = shown.length === active.length
      ? active.length + ' in service'
      : shown.length + ' of ' + active.length + ' shown';

    // A vertical list since 2026-09-03, not a horizontal card scroller. Four
    // facts per tail on three lines: what it is, what state it is in, where it
    // is, and what it does next — the last of which is the one a pilot came to
    // read, so it gets its own line rather than a card footer.
    // eslint-disable-next-line no-unsanitized/property -- safe: numbers and formatted counts only
    $('fhStrip').innerHTML = shown.length ? shown.map(function (a) {
      // `where` carries markup (the route component), so each piece is
      // escaped where it is built rather than the whole string at the point of use.
      var lt = a.active;
      var where = a.enRoute && lt
        ? routeHtml(lt.o, lt.d, { cls: 'fh-route-sm' }) +
          (isFinite(a.alt) && a.alt > 500 ? '<span class="fh-rfl">FL' + Math.round(a.alt / 100) + '</span>' : '')
        : a.at ? esc(city(a.at)) + ' (' + esc(code(a.at)) + ')' + (a.hangar ? ' · virtual hangar' : '') : 'Position unknown';
      var next;
      if (lt) {
        // Departure and arrival the way /status resolves them: a live ETA is
        // marked (dot), a filed one is plain, an estimate carries "≈".
        var bits = [];
        if (Number.isFinite(lt.depShown)) bits.push('dep ' + esc(depText(lt)));
        if (Number.isFinite(lt.etaShown)) {
          bits.push('lands <b' + (lt.etaVia === 'live' ? ' class="fh-vlive"' + vLiveAttr('live') : '') + '>' +
            esc(istClock(lt.etaShown)) + '</b>');
        }
        next = a.st === 4
          ? (bits.length ? 'Stopped · ' + bits.join(' · ') : 'Stopped')
          : 'Airborne' + (bits.length ? ' · ' + bits.join(' · ') : '');
      } else if (a.next) {
        next = 'Next: <b>' + esc(a.next.cs + ' ' + code(a.next.o)) + ' ' + arrow() + ' ' +
          esc(code(a.next.d)) + (a.next.timed ? ' · ' + esc(istClock(a.next.depT)) : '') + '</b>';
      } else {
        next = 'No flight assigned' +
          (isFinite(a.upd) ? ' · parked ' + esc(ago(Date.now() - a.upd)).replace(/ ago$/, '') : '');
      }
      return '<button class="fh-tail' + (a.id === ui.sel ? ' sel' : '') + '" data-tail="' + esc(a.id) + '">' +
        '<span class="fh-dot" style="--c:' + a.meta[1] + '"></span>' +
        '<span class="fh-tail-main"><span class="fh-reg">' + esc(a.reg) + '</span>' + tyChip(a.ty) + '</span>' +
        '<span class="fh-tail-state fh-c-' + esc(a.meta[2]) + '">' + esc(a.meta[0]) + '</span>' +
        (a.bidOnly ? '<span class="fh-tail-state fh-c-warn">' + esc(BID_ONLY_META[0]) + '</span>' : '') +
        '<span class="fh-tail-where' + (a.enRoute && lt ? ' fh-tail-route' : '') + '">' + where + '</span>' +
        '<span class="fh-tail-next">' + next + (!a.enRoute ? bountyChip(a.reg) ? ' ' + bountyChip(a.reg) : '' : '') + '</span>' +
        '</button>';
    }).join('') : '<div class="fh-empty">No aircraft match this filter.</div>';

    renderRail(all);
  }

  // ── BOARD screen ───────────────────────────────────────────────────────
  // Every leg that is in the air or stopped en route RIGHT NOW. It used to be
  // the "Active schedules" block at the foot of the Fleet screen; it has its
  // own tab since 2026-09-30 and is where all live-leg information goes:
  // effective departs / arrives / time to run (renderers read the display
  // fields annotateTimes stamps, never s.eArr), an approximate block for legs
  // with no filed time, the route with airport names, who is on it by seat.
  // Upcoming and stale legs are the Schedules screen's business.
  function renderBoard(all) {
    var rows = [];
    all.forEach(function (a) {
      a.sch.forEach(function (s) { if (s.air || s.stopped) rows.push({ a: a, s: s }); });
    });
    // Airborne first, then stopped; inside each, soonest to land first (the
    // order /status reads in), legs with no arrival at the end.
    var arrKey = function (r) { return Number.isFinite(r.s.etaShown) ? r.s.etaShown : Infinity; };
    rows.sort(function (p, q) {
      var gp = p.s.air ? 0 : 1, gq = q.s.air ? 0 : 1;
      if (gp !== gq) return gp - gq;
      var ep = arrKey(p), eq = arrKey(q);
      if (ep !== eq) return ep < eq ? -1 : 1;
      return (p.s.depT - q.s.depT) || 0;
    });
    var nAir = rows.filter(function (r) { return r.s.air; }).length;
    var nStop = rows.length - nAir;
    $('fhSchedCount').textContent = rows.length
      ? nAir + ' in the air' + (nStop ? ' · ' + nStop + ' stopped' : '') +
        (data.syncedAt ? ' · updated ' + ist(data.syncedAt) + ' IST' : '')
      : 'Nothing in the air right now' + (data.syncedAt ? ' · updated ' + ist(data.syncedAt) + ' IST' : '');

    // ⚠ SIX cells per row — .fh-sched-grid is laid out by :nth-child in both
    // the stacked (phone) and the column (≥900px) form. Adding or dropping one
    // scrambles the phone card while desktop still looks correct.
    // eslint-disable-next-line no-unsanitized/property -- safe: numbers and formatted counts only
    $('fhSchedTable').innerHTML = rows.length ? (
      '<div class="fh-thead fh-sched-grid">' +
        '<span>Flight</span><span>Route · crew</span><span>Progress</span>' +
        '<span>Time to run</span><span class="fh-r">Arrives</span>' +
        '<span class="fh-r">Status</span></div>' +
      rows.map(function (r) {
        var s = r.s, a = r.a;
        var f = legFigures(a, s).f;
        var eta = Number.isFinite(s.etaShown)
          ? etaCell(s.etaShown, '', s.etaVia) : '<span class="fh-num">—</span>';
        var eteTxt = s.eteShown != null ? dur(s.eteShown) : '—';
        return '<div class="fh-trow fh-sched-grid' + (a.id === ui.sel ? ' sel' : '') +
            '" data-flight="' + esc(a.id) + '" data-leg="' + esc(s.id || '') + '">' +
          '<div class="fh-cell"><span class="fh-cs">' + esc(s.cs) + '</span>' +
            '<span class="fh-sub">' + esc(a.reg + ' · ' + a.ty) + '</span>' +
            '<span class="fh-sub">' + esc(s.ftName) + '</span></div>' +
          '<div class="fh-cell">' + routeHtml(s.o, s.d) +
            '<span class="fh-sub fh-crew">' + crewSeatsHtml(s.crew, { live: true }) + '</span></div>' +
          '<div class="fh-cell"><div class="fh-bar"><i style="width:' + (f * 100).toFixed(0) + '%;--c:' +
            (s.air ? 'var(--fh-air)' : 'var(--fh-stop)') + '"></i></div>' +
            '<span class="fh-sub">' + (f * 100).toFixed(0) + '% flown</span>' +
            '<span class="fh-sub">' + esc('Dep ' + depText(s) + ' · Block ' + blockText(s)) + '</span></div>' +
          '<span class="fh-num' + vLive(s.eteVia) + '"' + vLiveAttr(s.eteVia) + '>' + esc(eteTxt) + '</span>' +
          '<div class="fh-r">' + eta + '</div>' +
          '<div class="fh-r">' + chip(s.ssMeta) + '</div>' +
          '</div>';
      }).join('')
    ) : '<div class="fh-empty">Nothing in the air or stopped en route right now. Upcoming legs are on the Schedules tab.</div>';
  }

  /** Right rail: the selected tail in full, and what you can do with it. */
  function renderRail(all) {
    var s = selected(all);
    if (!s) { $('fhSelCard').innerHTML = ''; return; }
    ui.sel = s.id;

    var leg = s.active || s.next;
    var legKind = 'Nothing scheduled', legNote = 'No flight assigned yet', pct = '0%';
    var depLabel = '', arrLabel = '', arrVia = null, cs = '—';
    // Nothing on the board for this tail — the common case for a freshly
    // parked airframe. Say so plainly and offer the one useful action
    // instead of rendering an empty progress line.
    if (!leg) {
      legKind = 'No flight scheduled';
      // A tail can be free AND still carry a leg the API never closed out —
      // say so, or the board's stale row looks like the rail contradicting it.
      var nStaleLegs = s.sch.filter(function (x) { return x.stale; }).length;
      legNote = s.stored
        ? 'Stored aircraft are outside the active fleet slots and take no schedules.'
        : s.st === 2 ? 'Airborne with no schedule attached.'
        : s.st === 4 ? 'Stopped en route — the session ended in the air. The pilot can rejoin and carry on; otherwise it settles onto the ground shortly.'
        : s.st === 5 ? 'Out of service for maintenance.'
        : 'This tail is parked' + (s.at ? ' at ' + city(s.at) : '') + ' with nothing on the books.' +
          (nStaleLegs ? ' (' + nStaleLegs + ' old ' + (nStaleLegs === 1 ? 'leg was' : 'legs were') +
            ' left open on it and never closed out.)' : '');
    }
    if (leg) {
      cs = leg.cs;
      // Times are the display fields annotateTimes stamped (live ETA when the
      // tail has a flying fix in the live feed, else filed, else none) — the
      // same ones the Board and the flight dialog print, so they cannot differ.
      depLabel = Number.isFinite(leg.depShown)
        ? (s.active ? 'Departed ' : 'Departs ') + clockText(leg.depShown, leg.depVia)
        : (s.active ? 'Departure time unknown' : 'Anytime');
      var railArr = leg.etaShown;
      arrVia = leg.etaVia;
      arrLabel = Number.isFinite(railArr)
        ? 'Arrives ' + (relTime(railArr) ? relTime(railArr) + ' · ' : '') + istClock(railArr)
        : 'Arrival unknown';
      if (s.active) {
        pct = (legFigures(s, leg).f * 100).toFixed(0) + '%';
        legKind = (s.st === 4 ? 'Stopped en route · ' : 'In the air now · ') + leg.ftName;
        legNote = s.st === 4
          // The leg's own times say the rest; a stopped leg has no live figure.
          ? ''
          : leg.eteShown != null
            ? dur(leg.eteShown) + ' to run' +
              (leg.eteVia === 'live' ? ' · live position' : ' · filed schedule — no live position fix') +
              (leg.blockShown != null ? ' · block ' + blockText(leg) : '')
            : Number.isFinite(railArr)
              ? 'Airborne — past its scheduled arrival.'
              : 'Airborne — no live position and no filed arrival to work one from.';
      } else {
        legKind = 'Next flight · ' + leg.ftName;
        legNote = !leg.timed
          ? 'Anytime — no scheduled time' + (leg.blockShown != null ? ' · ' + blockText(leg) + ' block time' : '')
          : leg.depT > Date.now()
            ? 'Departs ' + relTime(leg.depT) + ' · ' + blockText(leg) + ' block time'
            : 'Departure time has passed';
      }
    }

    var nOpenLegs = s.sch.filter(isOpenLeg).length;
    var metrics = s.enRoute ? [
      ['Altitude', isFinite(s.alt) ? Math.round(s.alt).toLocaleString() + ' ft' : '—'],
      ['Ground speed', isFinite(s.spd) ? Math.round(s.spd) + ' kt' : '—'],
      ['Vertical', s.vs > 100 ? 'Climbing ' + Math.round(s.vs).toLocaleString() + ' fpm'
        : s.vs < -100 ? 'Descending ' + Math.abs(Math.round(s.vs)).toLocaleString() + ' fpm' : 'Level'],
      ['Heading', isFinite(s.hdg) ? Math.round(s.hdg) + '°' : '—'],
      ['Flown by', s.pilot || 'Unknown'],
      [s.st === 4 ? 'Stopped' : 'Last update', isFinite(s.upd) ? ago(Date.now() - s.upd) : 'Unknown'],
    ] : [
      ['Parked at', s.at ? city(s.at) + ' (' + code(s.at) + ')' : 'Unknown'],
      ['Availability', s.stored ? 'Stored' : s.st === 5 ? 'Maintenance'
        : s.hangar ? 'Ready to fly · virtual hangar' : 'Ready to fly'],
      ['Last flown by', s.pilot || 'Unknown'],
      ['Last movement', isFinite(s.upd) ? ago(Date.now() - s.upd) : 'Unknown'],
      ['Fleet priority', s.rank ? '#' + s.rank : '—'],
      ['Schedules', nOpenLegs
        ? nOpenLegs + (nOpenLegs === 1 ? ' leg' : ' legs') : 'None filed'],
    ];

    // The CTA used to hand off to the booking flow. With that gone the only
    // thing this button can usefully do is take you to the tail's own queue on
    // the Schedules board — so it is enabled whenever the tail HAS one, and
    // states the tail's situation when it does not. A tail's state is no longer
    // a reason to disable it: you can read the schedule of an aircraft that is
    // stored, airborne or in maintenance.
    var nOpen = s.sch.filter(isOpenLeg).length;
    var cta = { label: 'No schedules filed', hint: '', to: '', cls: '', can: false };
    if (nOpen) {
      cta.label = 'Schedules · ' + nOpen + (nOpen === 1 ? ' leg' : ' legs');
      cta.hint = s.stored ? 'stored'
        : s.st === 2 ? 'in the air' + (s.pilot ? ' with ' + s.pilot : '')
        : s.st === 4 ? 'stopped en route'
        : s.st === 5 ? 'in maintenance'
        : s.next ? 'next ' + s.next.cs : '';
      cta.to = s.next && !s.active ? code(s.next.d) : '';
      cta.cls = 'fh-cta-primary'; cta.can = true;
    } else if (s.stored) {
      cta.hint = 'stored — not in the active fleet';
    } else if (s.st === 5) {
      cta.hint = 'in maintenance';
    } else {
      cta.hint = 'nothing on the books for this tail';
    }

    // eslint-disable-next-line no-unsanitized/property -- safe: markup built by this module (data escaped where built) or an internal enum/constant
    $('fhSelCard').innerHTML =
      '<div class="fh-detail">' +
        // Both chips live in the head: `sel-head` pushes the FIRST .fh-chip to
        // the right margin, so status leads the right-hand group and "Parked a
        // while" sits beside it rather than orphaned on the descriptive line.
        '<div class="fh-sel-head">' +
          '<span class="fh-sel-reg">' + esc(s.reg) + '</span>' + tyChip(s.ty) + chip(s.meta) +
          (s.stale ? '<span class="fh-chip fh-chip-warn">Parked a while</span>' : '') +
        '</div>' +
        '<span class="fh-sub">' + esc((s.typeName || s.ty) + ' · ' + s.fam +
          (s.rank ? ' · #' + s.rank : '')) + '</span>' +
        photoHtml(s.reg, 'fh-photo') +
        '<div class="fh-leg-box">' +
          '<div class="fh-leg-top"><span class="fh-k">' + esc(legKind) + '</span>' +
            (leg ? '<span class="fh-cs">' + esc(cs) + '</span>' : '') + '</div>' +
          (leg
            ? routeHtml(leg.o, leg.d, {
                cls: 'fh-route-lg', pct: s.active ? pct : null, color: s.meta[1],
              }) +
              // "Departed" only when it actually has — this box also renders
              // the NEXT leg of a parked tail, which has not left yet.
              '<div class="fh-leg-ends">' +
                '<span>' + esc(depLabel) + '</span>' +
                '<span' + (arrVia === 'live' ? ' class="fh-vlive"' + vLiveAttr('live') : '') + '>' + esc(arrLabel) + '</span></div>' +
              (legNote ? '<span class="fh-note">' + esc(legNote) + '</span>' : '')
            : '<span class="fh-note">' + esc(legNote) + '</span>') +
        '</div>' +
        '<dl class="fh-kv">' + metrics.map(function (m) {
          return '<div><dt class="fh-k">' + esc(m[0]) + '</dt>' +
            '<dd class="fh-kv-v">' + esc(m[1]) + '</dd></div>';
        }).join('') + '</dl>' +
        '<div class="fh-sel-actions">' +
          '<button class="fh-btn fh-cta' + (cta.cls ? ' ' + cta.cls : '') + '" id="fhSelPrimary"' +
            (cta.can ? '' : ' disabled') + '>' +
            '<span>' + esc(cta.label) + '</span>' +
            (cta.hint ? '<span class="fh-cta-hint">' + esc(cta.hint) + '</span>' : '') +
          '</button>' +
          '<div class="fh-sel-row">' +
            '<button class="fh-btn-ghost" id="fhSelLocate">On map</button>' +
            '<button class="fh-btn-ghost" id="fhSelHistory">History</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    fillPhotos();
  }

  // ── SCHEDULES screen ───────────────────────────────────────────────────
  /** Legs somebody has to do something about. Defined once so the count on
   *  the pill and the rows the filter shows can never drift apart. */
  function needsAttention(r) {
    // "Scheduled, and its departure time has passed" USED to be here and had
    // to go: in this data a past departure is the norm, not an exception.
    // Infinite Flight files legs and leaves them, so of the 177 open legs on
    // the fleet, 108 are timed and every one of those has departed — the pill
    // read ~112 of 177 and meant nothing. What is left is genuinely unusual:
    // a leg left open in flight, a stopped tail, a diversion, a delay.
    return r.s.stale || r.s.stopped || r.s.ss === 8 || r.s.ss === 7;
  }

  /**
   * An open leg nobody has claimed yet.
   *
   * This replaced legBookable() when the booking flow was removed on
   * 2026-08-23. The old rule answered "may this row offer a Book button?" and
   * therefore also had to exclude tails that were merely unavailable to book
   * (stored, in maintenance) — irrelevant now that nothing is booked here.
   * What is left is the part that was always about the LEG: an Infinite Flight
   * schedule has no crew field, so the briefing marker crewOn() reads is the
   * only record that somebody has taken it. Everything without one still needs
   * a pilot, whoever ends up assigned.
   *
   * A leg in the air or stopped en route is excluded whether or not it carries
   * a marker: somebody is plainly on it. Stale legs are NOT excluded — an
   * abandoned leg is unflown work, which is the whole point of the figure.
   */
  function legUnassigned(r) {
    return !r.s.crew && !r.s.air && !r.s.stopped && r.s.ss !== 11;
  }

  /**
   * Does this leg still have to happen?
   *
   * This is what makes the board the right SIZE, and it is measured, not
   * chosen: Infinite Flight's own schedules page reads one org-level feed and
   * that feed returned 161 Scheduled + 12 InFlight + 4 Diverted and **zero**
   * Arrived or Cancelled — 177 legs across the fleet. Our per-tail v3 read
   * holds 807, of which 630 are Arrived. Filtering to the same rule reproduces
   * their count exactly, per aircraft as well as in total (VT-ALP 5, VT-ANS 9,
   * VT-ANM 7, VT-TSD 5, VT-ALS 6).
   *
   * Same test the Fleet board has always used, now shared, so the two screens
   * cannot disagree about what is still on the books.
   */
  function isOpenLeg(s) { return s.ss !== 11 && s.ss !== 9; }

  /** Ready-to-fly tails as pills under the tile; nothing when there are none. */
  var READY_PILLS_MAX = 6;
  function readyPills(all) {
    var regs = (all || []).filter(function (a) { return a.readyToFly; }).map(function (a) { return a.reg; });
    if (!regs.length) return '';
    var shown = regs.slice(0, READY_PILLS_MAX).map(function (r) {
      return '<span class="fh-ready-pill fh-mono">' + esc(r) + '</span>';
    });
    if (regs.length > READY_PILLS_MAX) {
      shown.push('<span class="fh-ready-pill more">+' + (regs.length - READY_PILLS_MAX) + '</span>');
    }
    return '<span class="fh-stat-pills">' + shown.join('') + '</span>';
  }

  /** A tail's legs by their index on that aircraft — IF `sequence`, then the
   *  position in IF's own list. Same order the server's currentLeg() uses. */
  function legIndexOrder(p, q) {
    var hp = p.seq != null, hq = q.seq != null;
    if (hp && hq && p.seq !== q.seq) return p.seq - q.seq;
    if (hp !== hq) return hp ? -1 : 1;
    return p.idx - q.idx;
  }

  /** Does this tail still have an open leg to fly BEFORE this one? Only then is
   *  there something for the bell to wait on. Same rule as the server's
   *  alertBlockReason, so the bell is never offered where it would be refused. */
  function hasLegAhead(a, s) {
    if (!a || !s || !s.id || !isOpenLeg(s) || s.air || s.stopped) return false;
    var open = (a.sch || []).filter(isOpenLeg).slice().sort(legIndexOrder);
    return open.findIndex(function (x) { return x.id === s.id; }) > 0;
  }

  /** Ordering band: today, then upcoming, then the recent past, then legs
   *  with no clock at all. Rank first, departure time within the rank.
   *  Still the ordering INSIDE an aircraft's group — the board is grouped by
   *  aircraft now, but a tail's own legs read best in this order. */
  function schedBand(s) {
    if (!s.timed) return 3;                 // "Anytime" — nothing to sort on
    var d = dayDelta(s.depT);
    return d === 0 ? 0 : d > 0 ? 1 : 2;
  }

  /** What sortGroups orders a tail's block by: storage, the share of its
   *  open legs with nobody on them, what it is doing now, and its family. */
  function tailOrder(g) {
    // Ranked by how ready the tail is to be flown, not by how interesting it
    // looks: a parked aircraft is the one somebody can actually pick up, so it
    // leads. Stopped is next — it is between airports and will free up on its
    // own. Airborne is last: there is nothing to do with it right now.
    // (This is the reverse of the pre-2026-08-28 order, which led with the
    // airborne tails back when the board was a status display rather than
    // something you take work from.)
    var live = g.rows.some(function (r) { return r.s.air; }) ? 2
      : g.rows.some(function (r) { return r.s.stopped; }) ? 1 : 0;
    // Outside the org's active fleet slots outranks everything: IF itself puts
    // that tail in storage, so it can never be the answer to "what can I fly"
    // and sinks below every in-service aircraft regardless of status. Only
    // the slot decides (owner, 2026-10-30): a tail merely hangared inside the
    // active slots can still carry a full set of open legs, so it sorts with
    // the rest on those legs. For now no tail is stored (owner, 2026-11-03), so
    // `outOfSlot` is false everywhere and an out-of-slot tail sorts with the rest.
    var stored = g.a && g.a.outOfSlot ? 1 : 0;
    // Share of the tail's OPEN legs with no crew — counted over the whole
    // tail, not just the rows a filter left showing.
    var open = ((g.a && g.a.sch) || g.rows.map(function (r) { return r.s; })).filter(isOpenLeg);
    var openPct = open.length ? open.filter(function (s) { return !s.crew; }).length / open.length : 0;
    var famRank = g.a && FAMILY_ORDER[g.a.fam] != null ? FAMILY_ORDER[g.a.fam] : 3;
    return { stored: stored, live: live, openPct: openPct, famRank: famRank };
  }

  // ── schedules screen: search + sort ─────────────────────────────────────

  /** Everything about a row a pilot might plausibly type, lowercased. Covers
   *  the tail, its type, whoever is on the leg, both airports in all three
   *  spellings (ICAO / IATA / city) and the flight number. */
  function schedHaystack(r) {
    var a = r.a, s = r.s;
    var bits = [
      a.reg, a.ty, a.typeName, a.pilot, s.cs, s.ftName,
      s.o, s.d, code(s.o), code(s.d), city(s.o), city(s.d),
    ];
    if (s.crew) {
      bits.push(crewLabel(s.crew));
      if (s.crew.kind === 'crew') {
        (s.crew.members || []).forEach(function (c) { bits.push(c && c.username); });
      } else {
        bits.push(s.crew.pilot);
      }
    }
    return bits.filter(Boolean).join(' ').toLowerCase();
  }

  /** Every whitespace-separated term must appear somewhere in the row. AND
   *  rather than OR so "787 delhi" narrows instead of widening — with one
   *  fleet and a few hundred legs, widening is never what you meant. */
  function matchesQuery(r, q) {
    var terms = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return true;
    var hay = schedHaystack(r);
    return terms.every(function (t) { return hay.indexOf(t) !== -1; });
  }

  /** Is this tail's block expanded? A search forces every surviving block
   *  open — results you cannot see are not results, and the pilot has already
   *  told us what they are looking for. */
  function openGroup(key) {
    return !!ui.schQuery || ui.schOpen.has(key);
  }

  var SCHED_SORTS = [
    ['STATUS', 'Ready to fly'],
    ['TYPE', 'Aircraft type'],
    ['REG', 'Registration A–Z'],
    ['LEGS', 'Most legs'],
  ];
  /** TYPE sort: wide-bodies first, then narrow-bodies, then turboprops. */
  var FAMILY_ORDER = { 'Wide-body': 0, 'Narrow-body': 1, 'Turboprop': 2 };

  /** Order the tail blocks. Every mode falls back to registration so the board
   *  is stable — two tails that tie must not swap places between renders. */
  function sortGroups(groups, mode) {
    var byReg = function (p, q) { return String(p.a.reg).localeCompare(String(q.a.reg)); };
    return groups.sort(function (p, q) {
      if (mode === 'REG') return byReg(p, q);
      if (mode === 'LEGS') return q.rows.length - p.rows.length || byReg(p, q);
      if (mode === 'TYPE') {
        return (p.ord.famRank - q.ord.famRank) ||
          String(p.a.ty).localeCompare(String(q.a.ty)) || byReg(p, q);
      }
      // Ready to fly: out-of-slot tails sink; then the share of a tail's open legs
      // nobody is on, highest first; then parked before stopped before airborne.
      if (p.ord.stored !== q.ord.stored) return p.ord.stored - q.ord.stored;
      return (q.ord.openPct - p.ord.openPct) || (p.ord.live - q.ord.live) || byReg(p, q);
    });
  }

  /** The day a leg sits on, for the row's own Date cell — the board no longer
   *  groups by day, so each row has to carry its own. */
  function legDayLabel(s) {
    // An untimed leg is "Anytime" — unless it is in the air and a departure has
    // been worked out for it (an estimate, or the actual off-blocks time).
    var t = s.timed ? s.depT : s.depShown;
    if (!s.timed && !Number.isFinite(t)) return 'Anytime';
    var d = dayDelta(t);
    return d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : d === -1 ? 'Yesterday' : fmtShort(t);
  }

  function renderSchedules(all) {
    // A date cut-off used to do this job — anything over three days old was
    // dropped — because the board was buried under months of legs. Those legs
    // were the ARRIVED ones, and now that they are gone the cut-off does the
    // opposite of what it was for: of the 177 open legs, 107 are more than
    // three days old and every one is real, unflown work that Infinite Flight
    // itself lists (VT-ANM's diverted VIAR→VIDP among them). Status is the
    // filter; age is only an ordering.
    var rows = [];
    all.forEach(function (a) {
      a.sch.forEach(function (s) {
        if (isOpenLeg(s)) rows.push({ a: a, s: s });
      });
    });
    // Search narrows the set BEFORE the counts are taken, so a pill can never
    // promise rows the table will not show — the same rule the open/closed
    // split already follows.
    var q = ui.schQuery;
    var matched = rows.length;
    if (q) {
      rows = rows.filter(function (r) { return matchesQuery(r, q); });
      matched = rows.length;
    }
    var today = dayKey(Date.now());
    var counts = {
      ALL: rows.length,
      AIR: rows.filter(function (r) { return r.s.air; }).length,
      TODAY: rows.filter(function (r) { return dayKey(r.s.depT) === today; }).length,
      // A leg left open long after its aircraft landed is exactly the kind of
      // thing this filter is for — somebody has to close it out. So is a leg
      // whose pilot dropped out mid-air: it will never finish on its own.
      ATTN: rows.filter(needsAttention).length,
    };
    var open = rows.filter(legUnassigned).length;
    var tails = rows.reduce(function (set, r) { set[r.a.id] = 1; return set; }, {});
    var nTails = Object.keys(tails).length;

    // Every count on this screen is over the open set, so a pill can never
    // promise rows the table will not show. Completed legs are named rather
    // than silently absent — they are still on the tail's History screen.
    $('fhSchHeadline').textContent = (q ? 'Matching “' + q + '”: ' : '') +
      counts.ALL + ' still to fly across ' +
      nTails + (nTails === 1 ? ' aircraft' : ' aircraft') + ' · ' +
      counts.AIR + ' airborne · ' + counts.TODAY + ' departing today';

    // eslint-disable-next-line no-unsanitized/property -- safe: numbers and formatted counts only
    $('fhSchFilters').innerHTML = [['ALL', 'All'], ['AIR', 'Airborne'], ['TODAY', 'Today'], ['ATTN', 'Needs attention']]
      .map(function (f) {
        var on = ui.schFilter === f[0];
        return '<button class="fh-pill' + (on ? ' on' : '') + '" data-schfilter="' + f[0] + '">' +
          '<span>' + f[1] + '</span><span class="fh-pill-n">' + counts[f[0]] + '</span></button>';
      }).join('');

    // The same hairline strip the Fleet screen uses — these were two different
    // treatments of one thing (separate cards here, a joined strip there).
    // eslint-disable-next-line no-unsanitized/property -- safe: numbers and formatted counts only
    $('fhSchStats').innerHTML = [
      [counts.AIR, 'Airborne now', 'being flown by members', 'fh-c-air'],
      [counts.TODAY, 'Departing today', 'across the network', ''],
      [counts.ATTN, 'Needs attention', 'stopped, diverted, delayed or left open', 'fh-c-warn'],
      [open, 'Unassigned', 'filed, nobody on them yet', 'fh-c-warn'],
    ].map(function (s) {
      return '<div class="fh-stat"><span class="fh-k">' + esc(s[1]) + '</span>' +
        '<span class="fh-stat-v' + (s[3] ? ' ' + s[3] : '') + '">' + s[0] + '</span>' +
        '<span class="fh-stat-s">' + esc(s[2]) + '</span></div>';
    }).join('');

    var pass = function (r) {
      return ui.schFilter === 'ALL' ||
        (ui.schFilter === 'AIR' && r.s.air) ||
        (ui.schFilter === 'TODAY' && dayKey(r.s.depT) === today) ||
        (ui.schFilter === 'ATTN' && needsAttention(r));
    };
    // ── grouped by AIRCRAFT ──────────────────────────────────────────────
    // The board reads "what does each tail still have to fly", which is the
    // question the fleet is actually organised around: an aircraft can only
    // depart from where it is, so its legs only make sense as a queue.
    // (It grouped by DAY until 2026-08-23, when the booking flow was removed
    // and this screen became the product rather than a lookup beside it.)
    var shown = rows.filter(pass);

    var groups = [];
    shown.forEach(function (r) {
      var g = groups.find(function (x) { return x.key === r.a.id; });
      if (!g) groups.push(g = { key: r.a.id, a: r.a, rows: [] });
      g.rows.push(r);
    });

    // Inside a tail: the legs in that aircraft's own order — its leg #1, #2,
    // #3 by index (owner, 2026-10-12; replaced the today/upcoming/past bands).
    groups.forEach(function (g) {
      g.rows.sort(function (p, q) { return legIndexOrder(p.s, q.s); });
      g.ord = tailOrder(g);
    });
    sortGroups(groups, ui.schSort);

    // Column 2 carries the DATE, not the aircraft: the group header names the
    // tail now, and with day grouping gone each row has to say which day it is
    // on. Same eight columns, so the phone rules that restack this grid by
    // column index (fleet-mode.html, the 720px block) still line up.
    // Column headings only make sense above actual columns — with every tail
    // collapsed the board is a list of aircraft, not a table.
    var anyOpen = groups.some(function (g) { return openGroup(g.key); });
    var expandBtn = $('fhSchExpand');
    if (expandBtn) {
      var allOpen = groups.length > 0 && groups.every(function (g) { return openGroup(g.key); });
      expandBtn.textContent = allOpen ? 'Collapse all' : 'Expand all';
      expandBtn.disabled = !groups.length || !!ui.schQuery;
    }

    // eslint-disable-next-line no-unsanitized/property -- safe: numbers and formatted counts only
    $('fhSchTable').innerHTML = groups.length ? (
      (anyOpen ? '<div class="fh-thead fh-board-grid">' +
        '<span>Flight</span><span>Date</span><span>Route</span>' +
        '<span class="fh-r">Departs</span><span class="fh-r">Arrives</span>' +
        '<span class="fh-r">Block</span><span class="fh-r">Status</span><span></span></div>' : '') +
      groups.map(function (g) {
        var a = g.a;
        var where = a.enRoute && a.active
          ? code(a.active.o) + ' → ' + code(a.active.d) +
            (a.st === 4 ? ' · settles on ground soon'
              : Number.isFinite(a.active.etaShown)
                ? ' · lands ' + istClock(a.active.etaShown) + (a.active.etaVia === 'live' ? ' (live)' : '') : '')
          : a.at ? (a.stored ? 'Parked at ' + city(a.at) + ' (' + code(a.at) + ') · cannot be flown'
              : 'Parked at ' + city(a.at) + ' (' + code(a.at) + ')' + (a.hangar ? ' · virtual hangar' : ''))
          : 'Position unknown';
        var unassigned = g.rows.filter(legUnassigned).length;
        var open = openGroup(g.key);
        // The header is the whole control, not just the caret: on a phone a
        // 12px chevron is not a tap target, and the row is already a button.
        return '<button class="fh-group fh-group-tail' + (a.id === ui.sel ? ' sel' : '') +
              (open ? ' open' : '') + '" data-schgroup="' + esc(a.id) +
              '" aria-expanded="' + (open ? 'true' : 'false') + '">' +
            '<span class="fh-caret" aria-hidden="true"></span>' +
            '<span class="fh-dot' + (a.stored ? ' sq' : '') + '" style="--c:' + a.meta[1] + '"></span>' +
            '<span class="fh-group-label">' + esc(a.reg) + '</span>' + tyChip(a.ty) +
            chip(a.meta) + (a.bidOnly ? chip(BID_ONLY_META) : '') +
            '<span class="fh-group-where">' + esc(where) + '</span>' +
            // "open" rather than "unassigned": this is the number a pilot is
            // scanning for, so it is emphasised rather than parenthesised.
            '<span class="fh-group-n">' + g.rows.length + (g.rows.length === 1 ? ' leg' : ' legs') +
              (unassigned ? ' · <b>' + unassigned + ' open</b>' : '') +
              (!a.enRoute && bountyChip(a.reg) ? ' ' + bountyChip(a.reg) : '') + '</span></button>' +
          (open ? g.rows.map(function (r) {
            var reqBusy = crewBusy === r.s.id;
            var reqSent = crewPending.has(r.s.id);
            var mine = myCrewIn(r.s.crew);
            var bellOn = !!r.s.id && legAlerts.has(String(r.s.id));
            // Kept while on even once nothing is ahead, so it can still be
            // turned off before the next sweep sends the arrival and clears it.
            var bell = myUserId() && (bellOn || hasLegAhead(r.a, r.s))
              ? '<button type="button" class="fh-bell' + (bellOn ? ' on' : '') + '" data-legalert="' +
                  esc(r.a.id) + '" data-alertleg="' + esc(r.s.id) + '" aria-pressed="' + bellOn + '"' +
                  ' aria-label="' + (bellOn ? 'Leg alert on' : 'Alert me when the leg ahead lands') + '"' +
                  ' title="' + (bellOn ? 'Leg alert on' : 'Alert me when the leg ahead lands') + '"' +
                  (legAlertBusy === r.s.id ? ' disabled' : '') + '>' + BELL_SVG + '</button>'
              : '';
            // Both surfaces ask the SAME rule whether a leg can be requested,
            // so the row and the dialog can never disagree about it. Note a
            // part-crewed leg is still open: three can fly it.
            var canReq = !crewBlockReason(r.s);
            // Flex Crew: a released co-pilot seat beats "View" on a stopped
            // leg; a crewed Flex leg says its co-pilot seat is locked.
            var fx = flexCoPilot(r.s);
            var flexOpen = !!(fx && fx.open) && canReq;
            var flexLocked = !!(fx && !fx.open) && !!r.s.crew && !mine && isOpenLeg(r.s) && !(r.s.air || r.s.stopped);
            // Airborne and stopped rows just open the flight dialog ("View").
            // The row's Request is the one-click path and takes whichever seat
            // is actually free: Captain on an empty leg, First Officer once
            // somebody is in the left-hand seat. A leg that already has crew
            // says "Co-pilot", because that is the seat being offered — the old
            // "Request this leg" implied a choice the row never gave, and then
            // interrupted the click with a Captain-is-taken prompt. The dialog
            // is still where a seat can be picked deliberately.
            // [label, modifier class]. The hierarchy the classes encode:
            //   fh-act        amber outline — the thing to DO on this row
            //   fh-act-on     amber solid   — you already did it
            //   fh-act-mine   green         — you are crewed on this leg
            //   fh-act-quiet  neutral       — nothing to act on here
            // "View" sits at `quiet` rather than amber on purpose: most of the
            // board is airborne, and making every one of those rows a bright
            // button would drown out Request, which is the actual product.
            var act = r.s.bidOnly ? ['Bid in Contracts', 'fh-act-quiet']
              : flexOpen && !reqBusy ? ['Co-pilot', '']
              : r.s.air || r.s.stopped ? ['View', 'fh-act-quiet']
              : mine ? ['You are crew', 'fh-act-mine']
              : reqBusy ? ['· · ·', 'fh-act-quiet']
              // Already asked for: the button says so and is DEAD. It used to
              // stay live and open the dialog, which read as "ask again" on the
              // one row where asking again is the mistake. The row itself still
              // opens the dialog, so nothing is unreachable.
              : reqSent ? ["You've requested", 'fh-act-on']
              : canReq ? [crewCount(r.s.crew) ? 'Co-pilot' : 'Request this leg', '']
              : flexLocked ? ['Co-pilot locked', 'fh-act-quiet']
              : r.s.crew ? ['Assigned · view', 'fh-act-quiet']
              : ['View', 'fh-act-quiet'];
            // The row itself opens the dialog too: this screen has no detail
            // rail, so selecting a tail here used to change nothing on screen.
            return '<div class="fh-trow fh-board-grid' + (r.a.id === ui.sel ? ' sel' : '') +
                (r.s.stale ? ' fh-trow-stale' : '') + '" data-flight="' + esc(r.a.id) +
                '" data-leg="' + esc(r.s.id || '') + '">' +
              // Cell 1 is the flight and what KIND of flight it is. The service
              // label ("Passenger flight") lives here with the flight number and
              // NEVER beside the crew: the bare word "Passenger" next to a pilot's
              // name read as if the pilot were the passenger.
              '<div class="fh-cell"><span class="fh-cs">' + esc(r.s.cs) + '</span>' +
                '<span class="fh-sub">' + esc(r.s.ftName) + '</span></div>' +
              '<div class="fh-cell"><span class="fh-day">' + esc(legDayLabel(r.s)) + '</span>' +
                (Number.isFinite(r.s.timed ? r.s.depT : r.s.depShown)
                  ? '<span class="fh-sub">' + esc(fmtShort(r.s.timed ? r.s.depT : r.s.depShown)) + '</span>' : '') + '</div>' +
              // Route with airport names, then who is on it BY SEAT — an empty
              // seat is as much a fact as a name, and on a board this long the
              // absence of a name is easy to read as missing data.
              '<div class="fh-cell">' + routeHtml(r.s.o, r.s.d) +
                // crewSeatsHtml, so the pilot names come through BOLD — hence no
                // esc() around it. The pending string is a literal of ours.
                '<span class="fh-sub fh-crew">' + (r.s.crew
                  ? crewSeatsHtml(r.s.crew, { live: !!(r.s.air || r.s.stopped) })
                  : crewPending.has(r.s.id) ? "You've requested · seats open" 
                  : crewSeatsHtml(null, { compact: true, live: !!(r.s.air || r.s.stopped) })) + '</span></div>' +
              // Departs / Arrives / Block are the DISPLAY times (annotateTimes):
              // live ETA for a flying tail, filed otherwise, "≈" for an estimate.
              // A BARE clock plus a ±1 marker, not istClock(): column 2 of this
              // board already carries the date, and istClock() appends it again
              // for anything more than a day out — "12:30 · 10 Jul" beside a
              // cell that says "10 Jul", in a column too narrow to hold it.
              '<span class="fh-num">' + esc(depText(r.s)) + '</span>' +
              '<div class="fh-r">' + (Number.isFinite(r.s.etaShown)
                ? etaCell(r.s.etaShown, '', r.s.etaVia) : '<span class="fh-num">—</span>') + '</div>' +
              '<span class="fh-num fh-dim">' + esc(blockText(r.s)) + '</span>' +
              '<div class="fh-r">' + chip(r.s.ssMeta) + (r.s.bidOnly ? chip(BID_ONLY_META) : '') + '</div>' +
              '<div class="fh-r"><span class="fh-actwrap">' + bell +
                '<button class="fh-act' + (act[1] ? ' ' + act[1] : '') + '" ' +
                (flexLocked ? 'title="' + esc(fx.why) + '" ' : '') +
                (!flexOpen && (r.s.air || r.s.stopped) ? 'data-flight="' + esc(r.a.id) + '" data-leg="' + esc(r.s.id || '') + '"'
                  : canReq && !mine && !reqSent && !reqBusy
                    ? 'data-crewreq="' + esc(r.a.id) + '" data-crewleg="' + esc(r.s.id || '') + '"'
                  : 'data-flight="' + esc(r.a.id) + '" data-leg="' + esc(r.s.id || '') + '"') +
                (reqBusy || reqSent ? ' disabled' : '') +
                '>' + act[0] + '</button></span></div>' +
              '</div>';
          }).join('') : '');
      }).join('')
    ) : '<div class="fh-empty">' + (q
      ? 'Nothing matches “' + esc(q) + '”. Try a tail, an aircraft type, a pilot, an airport or a flight number.'
      : 'No flights match this filter.') + '</div>';
  }

  /** Keep the static search box and sort picker in step with ui state. They
   *  live in the page rather than being re-rendered, so typing is not
   *  interrupted by the 90s poll re-drawing the board under the caret. */
  function syncSchedControls() {
    var box = $('fhSchSearch');
    if (box && box.value !== ui.schQuery) box.value = ui.schQuery;
    var sel = $('fhSchSort');
    if (!sel) return;
    // Built once, then left alone — rebuilding would close the dropdown under
    // a pilot mid-choice. Keyed off innerHTML rather than .options so this
    // does not depend on the element really being a <select>.
    if (!sel.innerHTML) {
      // eslint-disable-next-line no-unsanitized/property -- safe: markup built by this module (data escaped where built) or an internal enum/constant
      sel.innerHTML = SCHED_SORTS.map(function (s) {
        return '<option value="' + s[0] + '">' + esc(s[1]) + '</option>';
      }).join('');
    }
    if (sel.value !== ui.schSort) sel.value = ui.schSort;
  }

  // ── FLIGHT BAG screen ──────────────────────────────────────────────────
  // Every open leg the signed-in pilot is crewed on, in the order it was
  // approved to them. Rows are the SAME model() legs the Schedules screen draws
  // (so a leg here cannot disagree with its status there), picked by the SAME
  // test canDispatch() applies — open, and I am on its crew — which is also why
  // every row can be dispatched. A leg the pilot has asked for but nobody has
  // approved yet is listed beneath, Details only.
  //
  // Markup, the crew brief, the printer and the boarding pass are
  // assets/js/fleet-flight-bag.js; this section builds the VIEW ROWS it draws
  // (plain strings and booleans) and owns the state that must survive the 90 s
  // re-render: the approvals, and the dispatch busy/blocked flags above.
  var BAG_PENDING_META = ['Awaiting approval', 'var(--fh-warn)', 'warn'];

  /** The OFPs this browser remembers, { scheduleId: { ofpId, at } }. A
   *  per-viewer convenience written by ofp-viewer.html — never authoritative,
   *  never sent anywhere. */
  function readOfps() {
    try {
      return window.INVA_FLEET_BAG.parseOfps(window.localStorage.getItem(OFPS_KEY) || '{}');
    } catch (e) { return {}; }
  }
  function forgetOfp(scheduleId) {
    try {
      var all = JSON.parse(window.localStorage.getItem(OFPS_KEY) || '{}') || {};
      delete all[scheduleId];
      window.localStorage.setItem(OFPS_KEY, JSON.stringify(all));
    } catch (e) { /* nothing to forget */ }
  }

  // ── Flight bag: keeping it current (the reasoning is with `bag`, above) ──

  /** The signed identity the approval route takes — no IF bearer, so a plain
   *  fetch is right. An older session minted none. */
  function bagIdentity() {
    var auth = window.INVA_FLEET && window.INVA_FLEET.getAuth();
    return (auth && auth.followIdentity) || '';
  }

  /** Has the chain any business running? Every link re-asks, and so does the
   *  one that would schedule the next. */
  function bagWanted() {
    return ui.page === 'bag' && !document.hidden && !!homeView && !homeView.hidden && !!bagIdentity();
  }

  /** A different pilot signed in on this page: nothing learned for the last
   *  one applies to them. */
  function bagSyncUser() {
    var me = myUserId();
    if (bag.user === me) return;
    bag.user = me; bag.approvals = null; bag.count = null; bag.status = 'idle';
    bag.fresh = {}; bag.fails = 0; bag.checkedAt = 0; bag.nextAt = 0;
    bag.owe = { full: false, tails: [], announce: [] };
  }

  /** Set the ONE pending link of the chain, replacing any other. */
  function bagSchedule(ms) {
    clearTimeout(bag.timer);
    bag.timer = null;
    if (!bagWanted()) { bag.nextAt = 0; return; }
    bag.nextAt = Date.now() + ms;
    bag.timer = setTimeout(bagCycle, ms);
  }
  function bagStop() {
    clearTimeout(bag.timer);
    bag.timer = null;
    bag.nextAt = 0;
  }

  /** The pulse (`{identity, pulse:true}` → `{count}`, about one Firestore read)
   *  or the full list (→ `{legs, count}`). Rejects on anything but a usable
   *  answer — a 503 included, which is the server saying it cannot tell. */
  function bagRequest(pulse) {
    var identity = bagIdentity();
    if (!identity) return Promise.reject(new Error('no identity'));
    return fetch('/api/fleetPilotFlightBag', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pulse ? { identity: identity, pulse: true } : { identity: identity }),
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (j) {
      if (!j || (pulse ? typeof j.count !== 'number' : !Array.isArray(j.legs))) throw new Error('bad body');
      return j;
    });
  }

  /**
   * The full list of my approvals — set against the list before it, what says
   * which tails to re-read. A failure keeps the last answer: a pilot's
   * approval history only ever grows, so an older answer is still right about
   * everything it lists.
   *
   * Legs that arrived are marked New and queued for a toast only when there WAS
   * an earlier list and the pilot is looking at the tab; the very first answer
   * has nothing to compare with (diffApprovals uses the fleet read's age).
   */
  function bagFull() {
    return bagRequest(false).then(function (j) {
      var B = window.INVA_FLEET_BAG;
      var prev = bag.approvals;
      var d = B && B.diffApprovals
        ? B.diffApprovals(prev, j.legs, fleetFullLoadAt)
        : { added: [], removed: [], tails: [], blind: false };
      bag.approvals = j.legs;
      bag.count = typeof j.count === 'number' ? j.count : j.legs.length;
      bag.status = 'ok';
      var o = bag.owe;
      d.tails.forEach(function (id) { if (o.tails.indexOf(id) === -1) o.tails.push(id); });
      if (d.blind) o.full = true;
      if (prev && ui.page === 'bag') {
        d.added.forEach(function (e) {
          bag.fresh[e.scheduleId] = true;
          if (o.announce.indexOf(e.scheduleId) === -1) o.announce.push(e.scheduleId);
        });
      }
      // The order and the approval times now; the row itself follows the
      // fleet read that settle() is about to do.
      if (ui.page === 'bag') render();
    });
  }

  /** Is the fleet read older than `maxAge`? A read that was only ATTEMPTED
   *  counts as recent, so one that keeps failing is retried at the same pace
   *  rather than on every link. */
  function fleetIsStale(maxAge) {
    // A cached preview never causes a read of its own: the real one is already
    // on its way. Nor does an idle tab: IF's rule is no new data after 15
    // minutes without user input; the next input resumes it.
    if (data.preview || !data.loaded || fleetBusy) return false;
    if (Date.now() - lastInputAt > IDLE_STOP_MS) return false;
    return Date.now() - Math.max(fleetFullLoadAt, fleetTriedAt) > maxAge;
  }

  /** The ONE door to a whole-fleet read (1 + 2N Infinite Flight calls): a
   *  second caller while one is out shares it instead of starting another. */
  function fleetReloadOnce() {
    if (fleetBusy) return fleetBusy;
    fleetTriedAt = Date.now();
    var done = function () { fleetBusy = null; };
    fleetBusy = Promise.resolve().then(function () { return window.INVA_FLEET.reload(); })
      .then(function (v) { done(); return v; }, function (e) { done(); throw e; });
    return fleetBusy;
  }

  /**
   * Pay what the fleet read owes: re-read the tails whose approvals changed —
   * one Infinite Flight call each — or the whole fleet when there are more than
   * BAG_TAILS_MAX, when a tail is not on the board, or when the single-tail
   * path is not there. A patch that itself fell back to a full read (the relay
   * path) has covered every other tail, so the rest are dropped. Whatever an
   * approval owes and fails stays owed for the next link; `forceFull` (the
   * safety net) is not an approval's debt and is not carried over — its own
   * clock (fleetTriedAt) spaces the retries instead.
   */
  function bagSettle(forceFull) {
    var o = bag.owe, F = window.INVA_FLEET;
    var canPatch = !!F && typeof F.reloadTail === 'function';
    var full = forceFull || o.full || o.tails.length > BAG_TAILS_MAX || (o.tails.length > 0 && !canPatch) ||
      o.tails.some(function (id) { return !data.aircraft.some(function (a) { return a.id === id; }); });
    var work;
    if (full) {
      work = fleetReloadOnce().then(function () { o.full = false; o.tails = []; });
    } else {
      work = o.tails.slice().reduce(function (chain, id) {
        return chain.then(function () {
          if (!o.tails.length) return null;
          var before = fleetJson;
          return Promise.resolve(F.reloadTail(id)).then(function () {
            o.tails = fleetJson !== before ? [] : o.tails.filter(function (t) { return t !== id; });
          });
        });
      }, Promise.resolve());
    }
    return work.then(bagAnnounce);
  }

  /** Toast the legs that arrived, once their rows exist — the callsign and
   *  route come off the fleet read, which is why this waits for it. role=status,
   *  so it is announced; the live line beside the title is not. */
  function bagAnnounce() {
    var o = bag.owe;
    var ids = o.announce;
    o.announce = [];
    if (!ids.length || ui.page !== 'bag') return;
    var rows = {};
    bagRows(model()).forEach(function (r) { rows[r.id] = r; });
    var found = ids.filter(function (id) { return rows[id]; });
    if (!found.length) { toastFollow(ids.length === 1 ? 'New leg approved' : ids.length + ' new legs approved'); return; }
    var r = rows[found[0]];
    var one = r.s.cs + ' ' + code(r.s.o) + ' → ' + code(r.s.d);
    toastFollow(found.length === 1
      ? 'New leg approved: ' + one
      : found.length + ' new legs approved: ' + one + ' and ' + (found.length - 1) + ' more');
  }

  /** One link: the pulse (or, with no answer yet or a changed count, the full
   *  list), then the fleet re-reads it calls for, then the safety net. */
  function bagCheck(entering) {
    var limit = entering ? BAG_OPEN_MAX_MS : BAG_FLEET_MAX_MS;
    var first = bag.count == null
      ? bagFull()
      : bagRequest(true).then(function (j) { if (j.count !== bag.count) return bagFull(); return null; });
    return first.then(function () {
      // Seats with no approval record (a Fleet Contract publish, crew added on
      // the IF website) never change the count; only an old board gives them away.
      return bagSettle(fleetIsStale(limit));
    });
  }

  function bagCycle() {
    bag.timer = null;
    if (!bagWanted()) return;
    if (bag.busy) { bagSchedule(BAG_PULSE_MS); return; }
    bagSyncUser();
    bag.busy = true;
    var entering = bag.entering;
    bag.entering = false;
    paintBagLive();
    bagCheck(entering).then(function () {
      bag.fails = 0;
      bag.checkedAt = Date.now();
    }, function () {
      bag.fails += 1;
      bag.status = bag.approvals ? 'ok' : 'failed';
    }).then(function () {
      bag.busy = false;
      bagSchedule(bag.fails ? BAG_BACKOFF_MS[Math.min(bag.fails, BAG_BACKOFF_MS.length) - 1] : BAG_PULSE_MS);
      if (ui.page === 'bag') render();
      paintBagLive();
    });
  }

  /** The bag came on screen (a tab click, or landing back from the OFP viewer):
   *  start over — a fresh attempt, nothing marked New, the first link at once. */
  function enterBag() {
    bagSyncUser();
    bag.fresh = {};
    bag.fails = 0;
    bag.entering = true;
    if (!bagIdentity() && !bag.approvals) bag.status = 'failed';   // an older session minted no identity
    bagSchedule(0);
    paintBagLive();
  }
  function leaveBag() {
    bagStop();
    bag.fresh = {};
    paintBagLive();
  }

  function bagAgoText(ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    if (s < 5) return 'just now';
    if (s < 60) return s + ' s ago';
    return Math.floor(s / 60) + ' min ago';
  }

  /** The line beside the title. NOT part of #fhBagBody: it ticks, and a ticking
   *  string inside the body would rebuild the table and drop focus off whatever
   *  button the pilot is on. textContent only. */
  function paintBagLive() {
    var el = $('fhBagLive');
    if (!el) return;
    var state = '', text = '';
    if (ui.page === 'bag' && bagIdentity()) {
      if (bag.busy) { state = 'checking'; text = 'Checking…'; }
      else if (bag.fails && bag.nextAt) {
        state = 'retry';
        text = 'Reconnecting — next try in ' + Math.max(1, Math.round((bag.nextAt - Date.now()) / 1000)) + ' s';
      } else if (bag.checkedAt) {
        state = 'live';
        text = 'Live · checked ' + bagAgoText(Date.now() - bag.checkedAt);
      } else { state = 'checking'; text = 'Checking…'; }
    }
    if (el.textContent !== text) el.textContent = text;
    if (el.dataset) el.dataset.state = state;
    el.hidden = !text;
    var sep = $('fhBagLiveSep');
    if (sep) sep.hidden = !text;
  }

  /** The pilot's name for the boarding pass: the career roster's name for
   *  them if it resolves, else the Infinite Flight username. One request, on
   *  the first brief a pilot opens. */
  function loadBagProfile() {
    if (bag.profiled) return;
    bag.profiled = true;
    dispatchProfile().then(function (me) {
      if (me && me.pilotName) { bag.pilotName = String(me.pilotName); render(); }
    });
  }

  /** Open legs I am crewed on, one entry per leg. `n` is the leg's place on
   *  its tail — Infinite Flight's own order, the tie-break for legs with no
   *  clock, exactly as the Schedules screen keeps it. `ahead` is how many open
   *  legs that are NOT mine the tail flies before this one (`a.sch` is already
   *  in `sequence` order): another pilot's legs, or nobody's, that have to be
   *  flown before I can fly mine. orderBag puts the legs I can fly soonest first. */
  function bagRows(all) {
    var rows = [];
    (all || []).forEach(function (a) {
      var ahead = 0;
      (a.sch || []).forEach(function (s, n) {
        if (!isOpenLeg(s)) return;
        if (!myCrewIn(s.crew)) { ahead++; return; }
        rows.push({ id: s.id, a: a, s: s, n: n, seq: s.seq, reg: a.reg, depT: s.depT, timed: s.timed, ahead: ahead });
      });
    });
    return rows;
  }

  /** Legs I asked for that nobody has approved yet. `ahead` as in bagRows —
   *  a pending leg is not mine yet, so it counts as ahead of the ones after it. */
  function bagPendingRows(all, taken) {
    var rows = [];
    (all || []).forEach(function (a) {
      var ahead = 0;
      (a.sch || []).forEach(function (s, n) {
        if (!isOpenLeg(s)) return;
        if (myCrewIn(s.crew)) return;
        if (s.id && !taken[s.id] && crewPending.has(String(s.id))) {
          rows.push({ id: s.id, a: a, s: s, n: n, seq: s.seq, reg: a.reg, depT: s.depT, timed: s.timed, ahead: ahead });
        }
        ahead++;
      });
    });
    return rows;
  }

  /** Why a leg sits where it does in the bag: the legs its tail flies first. */
  function bagWaitText(ahead) {
    var n = Number(ahead);
    if (!(n > 0)) return '';
    return 'After ' + n + ' earlier ' + (n === 1 ? 'leg' : 'legs');
  }

  /** What every row prints, approved or not. */
  function bagLegView(a, s) {
    var day = legDayLabel(s);
    // A bare clock — NOT depText(), which appends a ±1 day marker. The day
    // label printed beside it ("Tomorrow") already says that, twice is noise.
    var t = Number.isFinite(s.depShown) ? (s.depVia === 'approx' ? '≈ ' : '') + ist(s.depShown) : '—';
    var oPt = airportPt(s.o), dPt = airportPt(s.d);
    var nm = oPt && dPt ? Math.round(nmBetween(oPt.lat, oPt.lon, dPt.lat, dPt.lon)) : null;
    var cd = city(s.d);
    return {
      legId: s.id,
      tailId: a.id,
      cs: s.cs,
      route: code(s.o) + ' → ' + code(s.d),
      // An airport the reference does not know comes back as its own ICAO;
      // printing that twice is noise.
      city: cd && cd !== code(s.d) && cd !== s.d ? cd : '',
      reg: a.reg,
      ty: a.ty,
      day: day,
      time: day === 'Anytime' || t === '—' ? '' : t,
      block: blockText(s),
      chipHtml: chip(s.ssMeta),
      dep: s.o,
      arr: s.d,
      // Everything the boarding pass needs besides the pilot's name.
      pass: {
        flight: s.cs, from: s.o, fromCity: city(s.o), to: s.d, toCity: city(s.d),
        aircraft: a.ty, fam: a.fam, tail: a.reg, legId: s.id,
        dateMs: Number.isFinite(s.depShown) ? s.depShown : Date.now(), nm: nm,
      },
    };
  }

  function renderBag(all) {
    var B = window.INVA_FLEET_BAG;
    var host = $('fhBagBody');
    if (!B || !host) return;
    syncCrewPendingOwner();
    all = all || [];

    var ordered = B.orderBag(bagRows(all));
    var ofps = readOfps();
    var taken = {};
    var primaryGiven = false;
    var views = ordered.map(function (r, i) {
      taken[r.id] = true;
      var s = r.s;
      var me = myCrewIn(s.crew);
      var role = me && CREW_ROLE_NAME[me.role] ? CREW_ROLE_NAME[me.role] : 'Crew';
      var v = bagLegView(r.a, s);
      v.no = i + 1;
      v.role = role;
      v.side = role === 'Captain' ? 'Left seat' : role === 'First Officer' ? 'Right seat' : '';
      v.fresh = !!bag.fresh[s.id];
      v.ofp = !!ofps[s.id];
      v.wait = bagWaitText(r.ahead);
      v.dispatch = !canDispatch(s) ? 'none'
        : dispatchBusy === s.id ? 'busy'
        : dispatchGesture === s.id ? 'tap' : 'ready';
      v.rwyHtml = v.dispatch === 'none' || v.dispatch === 'busy' ? '' : rwyInputHtml(s, 'fh-bag-rwy-in');
      // ONE primary on the whole tab: the first leg that still has to be
      // planned and is actually fit to be — not already dispatched, not under
      // way, not an abandoned row. Everything after it is a plain button.
      v.primary = false;
      if (!primaryGiven && v.dispatch !== 'none' && !v.ofp && !s.air && !s.stopped && !s.stale) {
        v.primary = true;
        primaryGiven = true;
      }
      return v;
    });

    var pending = B.orderBag(bagPendingRows(all, taken)).map(function (r) {
      var v = bagLegView(r.a, r.s);
      v.no = '';
      v.role = '—';
      v.side = '';
      v.ofp = false;
      v.dispatch = 'none';
      v.primary = false;
      v.wait = bagWaitText(r.ahead);
      v.chipHtml = chip(BAG_PENDING_META);
      return v;
    });

    var n = views.length;
    $('fhBagSub').textContent = (n ? n + (n === 1 ? ' leg' : ' legs') + ' assigned to you' : 'Nothing assigned to you yet') +
      (pending.length ? ' · ' + pending.length + ' awaiting approval' : '');

    var auth = window.INVA_FLEET && window.INVA_FLEET.getAuth();
    var html = B.render({
      rows: views,
      pending: pending,
      who: bag.pilotName || (auth && auth.profile && auth.profile.displayName) || 'Pilot',
    });
    // Rewritten only when it changed: every fleet refresh and every check re-
    // renders everything, and a rebuilt DOM would drop focus from whatever
    // button a pilot is on.
    if (host._fhHtml !== html) { writeKeepingRunway(host, html); host._fhHtml = html; }
    B.hydrate(host);
    paintBagLive();
  }

  /** Re-open a plan this browser remembers. Checks the OFP is still there
   *  first — SimBrief expires them — and says so rather than landing the pilot
   *  on the viewer's error page. */
  function viewOfp(tail, s) {
    var rec = readOfps()[s.id];
    if (!rec) return;
    var go = function () {
      try {
        // The same record a fresh dispatch leaves, so the viewer treats this as
        // a Fleet Mode plan: Back goes to /fleet, and the career flightplans
        // collection is never written.
        sessionStorage.setItem('dispatchLegData', JSON.stringify({
          fleetMode: true,
          scheduleId: s.id,
          aircraftId: tail.id,
          flightNumber: s.cs,
          departure: s.o,
          arrival: s.d,
          aircraft: tail.ty,
          tailNumber: tail.reg || '',
          pilotName: bag.pilotName || '',
        }));
        sessionStorage.setItem(RETURN_KEY, 'bag');
      } catch (e) { /* private mode — the viewer still opens */ }
      window.location.href = '/ofp-viewer?ofp_id=' + encodeURIComponent(rec.ofpId);
    };
    window.invaAuthFetch('/api/fetchOfpById?action=exists&ofp_id='+ encodeURIComponent(rec.ofpId))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && j.exists === false) {
          forgetOfp(s.id);
          toastFollow('That flight plan has expired — Redispatch to plan it again.');
          render();
          return;
        }
        go();
      })
      .catch(go);
  }

  // ── AIRLINE screen ─────────────────────────────────────────────────────
  function renderAirline(all) {
    var org = data.org || {};
    var active = all.filter(function (a) { return !a.stored; });
    var stored = all.filter(function (a) { return a.stored; });
    var hangared = all.filter(function (a) { return a.hangar; });
    var rows = [];
    all.forEach(function (a) { a.sch.forEach(function (s) { rows.push({ a: a, s: s }); }); });
    var today = dayKey(Date.now());

    $('fhOrgName').textContent = org.name || 'Indian Virtual';
    $('fhOrgDesc').textContent = org.description ||
      'Persistent Live operations on the INVA fleet — every aircraft stays where its last pilot left it.';
    // Every tag is a live fact about the organization: its IF world and
    // operation type when the API reported them, then counts off this read.
    var tags = [];
    if (WORLD_TYPE[org.worldType]) tags.push(WORLD_TYPE[org.worldType] + ' Server');
    if (OPERATION_TYPE[org.operationType]) tags.push(OPERATION_TYPE[org.operationType]);
    tags.push(active.length + (active.length === 1 ? ' aircraft in service' : ' aircraft in service'));
    if (stored.length) tags.push(stored.length + ' stored');
    if (hangared.length) tags.push(hangared.length + ' in virtual hangar');
    var types = {};
    all.forEach(function (a) { types[a.ty] = 1; });
    var nTypes = Object.keys(types).length;
    tags.push(nTypes + (nTypes === 1 ? ' type' : ' types'));
    // Interpunct-separated facts rather than bordered pills — this is one
    // sentence about the airline, not five independent tags. The separators
    // are drawn by CSS (.fh-tags span + span::before).
    // eslint-disable-next-line no-unsanitized/property -- safe: markup built by this module (data escaped where built) or an internal enum/constant
    $('fhOrgTags').innerHTML = tags
      .map(function (t) { return '<span>' + esc(t) + '</span>'; }).join('');

    var slotPct = all.length ? (active.length / all.length * 100).toFixed(0) + '%' : '0%';
    $('fhSlotBar').style.width = slotPct;
    $('fhSlotLabel').textContent = active.length + ' of ' + all.length + ' aircraft in service';
    $('fhSlotNote').textContent = stored.length
      ? stored.length + ' aircraft ' + (stored.length === 1 ? 'is' : 'are') +
        ' outside the active fleet slots and cannot be flown until the airline’s slot count grows, highest fleet priority first.'
      : hangared.length
      ? hangared.length + ' aircraft ' + (hangared.length === 1 ? 'is' : 'are') +
        ' in the virtual hangar. Infinite Flight lists ' + (hangared.length === 1 ? 'it' : 'them') +
        ' as stored, but ' + (hangared.length === 1 ? 'it is' : 'they are') + ' in service and can be flown.'
      : 'Every aircraft the organization owns is inside its active fleet slots.';

    // Hub cards: INVA's four bases, plus any other airport the fleet is
    // actually sitting at in numbers — so a temporary concentration shows up
    // instead of four cards that never change.
    var parkedBy = {};
    all.forEach(function (a) { if (a.at && !a.enRoute) parkedBy[a.at] = (parkedBy[a.at] || 0) + 1; });
    var extra = Object.keys(parkedBy)
      .filter(function (i) { return !isHub(i) && parkedBy[i] >= 2; })
      .sort(function (p, q) { return parkedBy[q] - parkedBy[p]; })
      .slice(0, 4);

    // A TABLE, not five cards. The question is "which airport has what", and a
    // column of aligned figures answers it in one glance where separate cards
    // made you compare across gutters. The header row is emitted once here so
    // the columns are named; the "outstation" mark is a CSS ::after on the
    // city, so it needs no cell of its own.
    // eslint-disable-next-line no-unsanitized/property -- safe: numbers and formatted counts only
    $('fhHubs').innerHTML =
      '<div class="fh-hub head"><span class="fh-k">Airport</span><span class="fh-k">Parked</span>' +
        '<span class="fh-k">Departures</span><span class="fh-k">Inbound</span></div>' +
      HUBS.concat(extra).map(function (icao) {
        var parked = all.filter(function (a) { return a.at === icao && !a.enRoute; }).length;
        var deps = rows.filter(function (r) { return r.s.o === icao && dayKey(r.s.depT) === today; }).length;
        var inbound = rows.filter(function (r) { return r.s.d === icao && r.s.air; }).length;
        var hub = isHub(icao);
        return '<div class="fh-hub' + (hub ? '' : ' outstation') + '">' +
            '<div><span class="fh-hub-city">' + esc(city(icao)) + '</span>' +
              '<span class="fh-hub-code">' + esc(code(icao)) + '</span></div>' +
            '<span class="fh-hub-n" style="--c:var(--fh-gnd)">' + parked + '</span>' +
            '<span class="fh-hub-n">' + deps + '</span>' +
            '<span class="fh-hub-n" style="--c:var(--fh-air)">' + inbound + '</span>' +
          '</div>';
      }).join('');

    var byType = {};
    all.forEach(function (a) {
      // typeName is the manufacturer's full name ("Boeing 777-300ER"); the row
      // shows it beside the short code, so it is carried on the accumulator
      // rather than looked up again at render time.
      (byType[a.ty] = byType[a.ty] ||
        { ty: a.ty, fam: a.fam, typeName: a.typeName || a.ty, n: 0 }).n++;
    });
    var types = Object.keys(byType).map(function (k) { return byType[k]; })
      .sort(function (p, q) { return q.n - p.n; });
    var typeCount = $('fhTypeCount');
    if (typeCount) {
      typeCount.textContent = all.length + (all.length === 1 ? ' aircraft' : ' aircraft');
    }
    // Three cells then a full-width bar: .fh-type is a grid, so the bar spans
    // the row (grid-column:1/-1) rather than needing a wrapper of its own.
    // eslint-disable-next-line no-unsanitized/property -- safe: numbers and formatted counts only
    $('fhByType').innerHTML = types.map(function (t) {
      return '<div class="fh-type">' + tyChip(t.ty) +
        '<span class="fh-sub">' + esc((t.typeName || t.ty) + ' · ' + t.fam) + '</span>' +
        '<span class="fh-type-n">' + t.n + '</span>' +
        '<div class="fh-bar"><i style="width:' + (t.n / all.length * 100).toFixed(0) + '%;--c:var(--fh-ink-2)"></i></div></div>';
    }).join('');

    var net = {};
    rows.forEach(function (r) { if (r.s.o) net[r.s.o] = 1; if (r.s.d) net[r.s.d] = 1; });
    all.forEach(function (a) { if (a.at) net[a.at] = 1; });
    var netKeys = Object.keys(net).sort(function (p, q) { return city(p).localeCompare(city(q)); });
    // The monthly leaderboard: from my profile snapshot, once the module has it.
    var lbEl = $('fhLeaderboard');
    if (lbEl) {
      var lbHtml = window.INVA_FLEET_ACTIVITY ? window.INVA_FLEET_ACTIVITY.leaderboard()
        : '<div class="fh-empty">Loading…</div>';
      // eslint-disable-next-line no-unsanitized/property -- safe: built and escaped by fleet-activity.js
      if (lbEl._fhHtml !== lbHtml) { lbEl.innerHTML = lbHtml; lbEl._fhHtml = lbHtml; }
    }
    $('fhNetworkCount').textContent = netKeys.length +
      (netKeys.length === 1 ? ' airport' : ' airports') + ' · hubs in bold';
    // eslint-disable-next-line no-unsanitized/property -- safe: markup built by this module (data escaped where built) or an internal enum/constant
    $('fhNetwork').innerHTML = netKeys.length ? netKeys.map(function (i) {
      return '<span class="fh-netchip' + (isHub(i) ? ' hub' : '') + '">' + esc(city(i) + ' · ' + code(i)) + '</span>';
    }).join('') : '<span class="fh-sub">No airports on the board yet.</span>';

    var activity = all.filter(function (a) { return a.bucket === 'inflight' && a.active; }).slice(0, 4).map(function (a) {
      return { c: 'var(--fh-air)', text: a.active.cs + ' airborne to ' + city(a.active.d),
        meta: a.reg + ' · ' + a.ty + (a.pilot ? ' · ' + a.pilot : ''),
        time: ist(a.active.adepT || a.active.depT) };
    }).concat(
      all.filter(function (a) { return a.bucket !== 'inflight' && !a.stored && isFinite(a.upd); })
        .sort(function (p, q) { return q.upd - p.upd; }).slice(0, 4).map(function (a) {
          return { c: a.st === 4 ? 'var(--fh-stop)' : 'var(--fh-gnd)',
            text: a.st === 4
              ? a.reg + ' stopped en route' + (a.active ? ' to ' + city(a.active.d) : '')
              : a.reg + ' parked at ' + city(a.at),
            meta: a.ty + (a.pilot ? ' · last flown by ' + a.pilot : ''), time: ist(a.upd) };
        })
    );
    // eslint-disable-next-line no-unsanitized/property -- safe: markup built by this module (data escaped where built) or an internal enum/constant
    $('fhActivity').innerHTML = activity.length ? activity.map(function (a) {
      return '<div class="fh-act-row"><span class="fh-dot" style="--c:' + a.c + '"></span>' +
        '<div class="fh-cell"><span>' + esc(a.text) + '</span>' +
        '<span class="fh-sub">' + esc(a.meta) + '</span></div>' +
        '<span class="fh-num fh-dim">' + esc(a.time) + '</span></div>';
    }).join('') : '<div class="fh-empty">Nothing has moved yet.</div>';
  }

  // ── HISTORY screen ─────────────────────────────────────────────────────
  // v3 exposes no flight-log endpoint, so this is the tail's own schedule
  // record — completed legs first — plus what the position tells us. When
  // that record is empty the screen says so instead of inventing a past.
  // The board holds OPEN legs only now (the org-wide schedules read), so this
  // screen fetches its own tail's full list — 1 call, on entry, kept in memory
  // by INVA_FLEET.loadTailHistory for 5 minutes.
  var hist = { id: null, raw: null, loading: false, err: null, retryAt: 0, timer: null };
  var HIST_REFRESH_MS = 5 * 60 * 1000;

  function histStart(tailId) {
    var F = window.INVA_FLEET;
    if (hist.loading || !F || typeof F.loadTailHistory !== 'function') return;
    hist.loading = true;
    hist.id = tailId;
    Promise.resolve().then(function () { return F.loadTailHistory(tailId); }).then(function (raw) {
      hist.loading = false;
      hist.err = null;
      hist.raw = { id: tailId, list: raw, at: Date.now() };
    }, function (e) {
      hist.loading = false;
      var ms = e && e.rateLimited ? (e.retryAfterMs || 30000) : 15000;
      hist.err = { rateLimited: !!(e && e.rateLimited), message: e && e.message, tailId: tailId };
      hist.retryAt = Date.now() + ms;
      // One repaint when the wait is over, which tries again if still on screen.
      clearTimeout(hist.timer);
      hist.timer = setTimeout(function () { if (ui.page === 'history' && data.loaded) render(); }, ms + 250);
    }).then(function () { if (ui.page === 'history' && data.loaded) render(); });
  }

  /** The tail's legs for History: its full list through the SAME leg builder as
   *  the board; a leg that is also on the board keeps the board's version, which
   *  carries the live phase. */
  function historyLegs(s, rawList) {
    var open = {};
    s.sch.forEach(function (l) { open[l.id] = l; });
    var famName = s.fam;
    return buildLegs(rawList).map(function (l) {
      if (open[l.id]) return open[l.id];
      annotateTimes(l, famName, null, Date.now());
      return l;
    });
  }

  function histNotice(text) {
    // eslint-disable-next-line no-unsanitized/property -- safe: fixed text and a number
    $('fhHistLegs').innerHTML = '<div class="fh-empty">' + esc(text) + '</div>';
    $('fhHistStats').innerHTML = '';
    $('fhHistVisited').innerHTML = '';
  }

  function renderHistory(all) {
    var s = selected(all);
    if (!s) return;

    var rawList = null;
    if (hist.raw && hist.raw.id === s.id) rawList = hist.raw.list;
    var stale = !rawList || Date.now() - hist.raw.at > HIST_REFRESH_MS;
    if (stale && !hist.loading && !(hist.err && hist.err.tailId === s.id && Date.now() < hist.retryAt)) {
      histStart(s.id);
    }
    var loadingNow = !rawList && (hist.loading || !(hist.err && hist.err.tailId === s.id));
    var failedNow = !rawList && !loadingNow;

    var legs = (rawList ? historyLegs(s, rawList) : s.sch).slice().sort(function (p, q) { return q.depT - p.depT; });
    var flown = legs.filter(function (l) { return l.ss === 11; });
    var totalMs = flown.reduce(function (t, l) {
      return t + Math.max(0, (l.aarrT || l.arrT) - (l.adepT || l.depT));
    }, 0);
    var visits = {};
    flown.forEach(function (l) {
      if (l.o) visits[l.o] = (visits[l.o] || 0) + 1;
      if (l.d) visits[l.d] = (visits[l.d] || 0) + 1;
    });
    var visitKeys = Object.keys(visits).sort(function (p, q) { return visits[q] - visits[p]; }).slice(0, 7);
    var maxVisit = visitKeys.length ? visits[visitKeys[0]] : 1;

    // The registration IS this page, so it leads at photo scale; the type and
    // status badges and the descriptive line stack underneath it.
    // eslint-disable-next-line no-unsanitized/property -- safe: markup built by this module (data escaped where built) or an internal enum/constant
    $('fhHistHead').innerHTML =
      photoHtml(s.reg, 'fh-photo fh-photo-hist') +
      '<div class="fh-hist-id">' +
        '<h1 class="fh-hist-reg">' + esc(s.reg) + '</h1>' +
        '<div class="fh-hist-badges">' + tyChip(s.ty) + chip(s.meta) +
          '<span class="fh-sub">' + esc((s.typeName || s.ty) + ' · ' + s.fam + ' · ' +
            (s.st === 4 ? 'stopped en route' : s.st === 2 ? 'currently airborne'
              : s.at ? 'currently at ' + city(s.at) : 'position unknown')) + '</span>' +
        '</div>' +
      '</div>';
    fillPhotos();

    // eslint-disable-next-line no-unsanitized/property -- safe: numbers and formatted counts only
    $('fhHistStats').innerHTML = [
      ['Legs on record', legs.length, ''],
      ['Completed', flown.length, 'fh-c-done'],
      ['Hours logged', totalMs ? (totalMs / H).toFixed(1) : '0.0', ''],
      ['Airports visited', Object.keys(visits).length, ''],
    ].map(function (st) {
      return '<div class="fh-stat"><span class="fh-k">' + esc(st[0]) + '</span>' +
        '<span class="fh-stat-v' + (st[2] ? ' ' + st[2] : '') + '">' + st[1] + '</span></div>';
    }).join('');

    // ⚠ SIX cells per row — .fh-hist-grid. Cell 1 is the timeline dot, which
    // the phone layout hides; the other five restack by :nth-child.
    // eslint-disable-next-line no-unsanitized/property -- safe: numbers and formatted counts only
    $('fhHistLegs').innerHTML = legs.length ? (
      '<div class="fh-thead fh-hist-grid"><span></span><span>Flight</span><span>Route</span>' +
        '<span>Flown</span><span class="fh-r">Block</span><span class="fh-r">Status</span></div>' +
      legs.map(function (l) {
        var dep = l.adepT || l.depT, arr = l.aarrT || l.arrT;
        return '<div class="fh-trow fh-hist-grid">' +
          '<span class="fh-hist-dot" style="--c:' +
            (l.air ? 'var(--fh-air)' : l.stopped ? 'var(--fh-stop)' : l.ss === 11 ? 'var(--fh-done)'
              : 'var(--fh-sched)') + '"></span>' +
          '<div class="fh-cell"><span class="fh-cs">' + esc(l.cs) + '</span>' +
            '<span class="fh-sub">' + esc(l.ftName) + '</span></div>' +
          '<div class="fh-cell">' + routeHtml(l.o, l.d) + '</div>' +
          // Only a leg that has flown (or is flying) has a "Flown" date; a
          // scheduled one would print IF's 0001 placeholder as "Mon 1 Jan".
          ((l.ss === 11 || l.air || l.stopped) && validMs(dep)
            ? '<div class="fh-cell"><span class="fh-strong">' + esc(fmtDate(dep)) + '</span>' +
              '<span class="fh-sub fh-num">' + esc(ist(dep) + (validMs(arr) ? ' – ' + ist(arr) +
                (dayKey(arr) !== dayKey(dep) ? ' +1' : '') : '')) + '</span></div>'
            : '<div class="fh-cell"></div>') +
          // The flown span when both ends are real; otherwise the leg's estimate
          // (marked ≈) — an untimed leg has no span, and "—" hid a usable figure.
          '<span class="fh-num">' + esc(validMs(dep) && validMs(arr) && arr > dep ? dur(arr - dep) : blockText(l)) + '</span>' +
          '<div class="fh-r">' + chip(l.ssMeta) + '</div>' +
          '</div>';
      }).join('')
    ) : '<div class="fh-empty">No schedules on this aircraft yet. Infinite Flight keeps no ' +
      'flight log per airframe, so its record starts with the first leg scheduled on it here.</div>';

    // eslint-disable-next-line no-unsanitized/property -- safe: numbers and formatted counts only
    $('fhHistVisited').innerHTML =
      '<div class="fh-blk-head"><h2>Where it has been</h2><span class="fh-sub">visits</span></div>' +
      (visitKeys.length ? visitKeys.map(function (k) {
        return '<div class="fh-visit"><span class="fh-visit-city">' + esc(city(k)) + '</span>' +
          '<div class="fh-bar"><i style="width:' + (visits[k] / maxVisit * 100).toFixed(0) + '%;--c:var(--fh-ink-2)"></i></div>' +
          '<span class="fh-num">' + visits[k] + '</span></div>';
      }).join('') : '<div class="fh-empty">No completed legs on record yet.</div>');

    // eslint-disable-next-line no-unsanitized/property -- safe: numbers and formatted counts only
    $('fhHistRecord').innerHTML =
      '<div class="fh-blk-head"><h2>Aircraft record</h2></div>' +
      '<dl>' +
      [['Registration', s.reg], ['Type', (s.typeName || s.ty) + ' · ' + s.fam],
       ['Fleet priority', s.rank ? '#' + s.rank : '—'],
       ['Fleet slot', s.stored ? 'Stored' : s.hangar ? 'Virtual hangar' : 'Active'],
       ['Last movement', isFinite(s.upd) ? fmtLong(s.upd) + ' · ' + ist(s.upd) + ' IST' : 'Unknown'],
       ['Last flown by', s.pilot || 'Unknown']]
      .map(function (r) {
        return '<div class="fh-rec"><dt class="fh-rec-k">' + esc(r[0]) + '</dt>' +
          '<dd class="fh-rec-v">' + esc(r[1]) + '</dd></div>';
      }).join('') + '</dl>';

    // History is the flown record; the open queue lives on the Schedules board.
    // Jump straight to this tail's block there rather than dead-ending here.
    if (loadingNow) histNotice('Loading ' + s.reg + '’s flight record from Infinite Flight…');
    else if (failedNow) {
      var wait = Math.max(1, Math.ceil((hist.retryAt - Date.now()) / 1000));
      histNotice(hist.err.rateLimited
        ? 'Infinite Flight is limiting requests from this account — try again in ' + wait + ' s.'
        : 'The flight record could not be loaded — trying again in ' + wait + ' s.');
    }

    var nOpen = s.sch.filter(isOpenLeg).length;
    $('fhHistSchedules').disabled = !nOpen;
    $('fhHistSchedules').textContent = nOpen
      ? 'Open schedules · ' + nOpen + (nOpen === 1 ? ' leg' : ' legs')
      : 'Nothing left to fly on ' + s.reg;
  }

  // ── flight detail dialog ───────────────────────────────────────────────
  // The Schedules board carries no detail rail, so "View" (and a click on the
  // row) had nowhere to go — it selected a tail whose card is on another
  // screen, which reads as a dead button. Everything the rail would have
  // said now opens here instead, with the same actions attached.
  var fm = { tail: null, leg: null };

  // ── the /dispatch deep link ────────────────────────────────────────────
  //
  // Discord's /dispatch hands out `/fleet?dispatch=<aircraftId>:<scheduleId>`.
  // It cannot link straight to SimBrief: the dispatch has to be SIGNED, and a
  // signature minted when the command ran would be stale by the time anybody
  // clicked it. So the link comes here and the portal signs it fresh.
  //
  // Sign-in needs no special handling. Fleet Mode authenticates in a POPUP
  // (fleet-mode.js:295), so this tab never navigates and the query string
  // survives on its own. The sessionStorage mirror only covers a manual reload
  // mid-sign-in.
  var PENDING_KEY = 'fmPendingDispatch';

  /** "<aircraftId>:<scheduleId>" → {tail, leg}, or null.
   *  Split on the FIRST colon only — IF ids are opaque and a schedule GUID
   *  containing one would silently resolve to the wrong leg under split(':'). */
  function parseDispatchParam(raw) {
    var v = String(raw == null ? '' : raw).trim();
    var i = v.indexOf(':');
    if (i <= 0 || i === v.length - 1) return null;
    return { tail: v.slice(0, i), leg: v.slice(i + 1) };
  }

  var pendingDispatch = (function () {
    var raw = '';
    try {
      raw = new URLSearchParams(window.location.search).get('dispatch') || '';
      if (raw) {
        sessionStorage.setItem(PENDING_KEY, raw);
        // Strip it so a refresh after dispatching does not re-open the dialog.
        var u = new URL(window.location.href);
        u.searchParams.delete('dispatch');
        window.history.replaceState({}, '', u.toString());
      } else {
        raw = sessionStorage.getItem(PENDING_KEY) || '';
      }
    } catch (e) { /* private mode, or no History API — the link just no-ops */ }
    return parseDispatchParam(raw);
  })();

  /** One shot, after the first fleet read: open the dialog on the linked leg.
   *  Deliberately does NOT fire the dispatch — the popup needs a real gesture,
   *  and the link's job is to put the button under the pilot's thumb. */
  function consumePendingDispatch() {
    if (!pendingDispatch) return;
    var want = pendingDispatch;
    pendingDispatch = null;
    try { sessionStorage.removeItem(PENDING_KEY); } catch (e) {}

    var all = model();
    var tail = all.find(function (a) { return a.id === want.tail; });
    var leg = tail && tail.sch.find(function (x) { return x.id === want.leg; });
    if (!leg) {
      toastFollow('That leg is no longer on the board.');
      return;
    }
    // Opened even when the pilot turns out not to be crew: they came from a
    // Discord button, and showing them the leg beats a bare refusal. The
    // Dispatch button simply will not render.
    select(tail.id);
    openFlight(tail.id, leg.id);
  }

  function openFlight(tailId, legId) {
    fm.tail = tailId; fm.leg = legId || null;
    renderFlightModal();
    $('fhFlightModal').hidden = false;
  }
  function closeFlight() {
    fm.tail = fm.leg = null;
    var el = $('fhFlightModal');
    if (el) el.hidden = true;
    placeBellTip();
  }

  // ── the one-time leg-alert tip ─────────────────────────────────────────
  // The first time a pilot takes a Flex Crew leg that has a leg ahead of it,
  // the row's bell is the thing they need: it tells them when the aircraft
  // is theirs. Shown ONCE per browser (localStorage), under that bell, and
  // closed after BELL_TIP_MS or on a tap. A fixed element outside the board,
  // because the board's cards clip and every poll redraws the rows; render()
  // re-places it. Waits while the flight dialog covers the board.
  var BELL_TIP_KEY = 'fmBellTipSeen';
  var BELL_TIP_MS = 8000;
  var bellTip = null;          // the leg id whose bell it points at
  var bellTipTimer = null;
  var bellTipUsed = false;     // once per page even when storage is unavailable

  function bellTipSeen() {
    try { return window.localStorage.getItem(BELL_TIP_KEY) === '1'; } catch (e) { return false; }
  }

  /** Does a seat on this leg earn the tip? A Flex leg with a leg ahead of it
   *  on the tail — the rows that carry a bell. Pure. */
  function wantsBellTip(a, s) {
    return !!(s && s.flexTail && hasLegAhead(a, s));
  }

  /** After a Flex seat: point at this leg's bell, if it has one and the tip is unseen. */
  function offerBellTip(tailId, legId) {
    if (bellTipUsed || bellTipSeen()) return;
    var a = model().find(function (x) { return x.id === tailId; });
    var s = a && a.sch.find(function (x) { return x.id === legId; });
    if (!wantsBellTip(a, s)) return;
    bellTipUsed = true;
    bellTip = legId;
    placeBellTip();
  }

  function closeBellTip() {
    bellTip = null;
    if (bellTipTimer) { clearTimeout(bellTipTimer); bellTipTimer = null; }
    var el = $('fhBellTip');
    if (el) el.hidden = true;
  }

  function placeBellTip() {
    var el = $('fhBellTip');
    var sel = bellTip && '.fh-bell[data-alertleg="' +
      (window.CSS && CSS.escape ? CSS.escape(bellTip) : String(bellTip).replace(/"/g, '\\"')) + '"]';
    var bell = sel && homeView ? homeView.querySelector(sel) : null;
    if (!bell || !bell.offsetParent || fm.tail) {
      if (el) el.hidden = true;
      return;
    }
    if (!el) {
      el = document.createElement('div');
      el.id = 'fhBellTip';
      el.className = 'fh-belltip';
      el.setAttribute('role', 'status');
      el.textContent = 'Get an alert when it\u2019s your turn to fly.';
      el.addEventListener('click', closeBellTip);
      homeView.appendChild(el);
    }
    el.hidden = false;
    var r = bell.getBoundingClientRect();
    var w = el.offsetWidth;
    var left = Math.max(16, Math.min(r.left + r.width / 2 - 22, window.innerWidth - 16 - w));
    el.style.top = Math.round(r.bottom + 10) + 'px';
    el.style.left = Math.round(left) + 'px';
    el.style.setProperty('--fh-tip-x', Math.round(r.left + r.width / 2 - left) + 'px');
    // The clock starts when it is first SEEN, and only then is it spent.
    if (!bellTipTimer) {
      try { window.localStorage.setItem(BELL_TIP_KEY, '1'); } catch (e) { /* once per page instead */ }
      bellTipTimer = setTimeout(closeBellTip, BELL_TIP_MS);
    }
  }

  function renderFlightModal() {
    if (!fm.tail) return;
    var all = model();
    var a = all.find(function (x) { return x.id === fm.tail; });
    if (!a) return closeFlight();
    var s = (fm.leg && a.sch.find(function (x) { return x.id === fm.leg; })) || a.active || a.next;
    if (!s) return closeFlight();

    $('fhFmTitle').textContent = s.cs;
    $('fhFmSub').textContent = a.reg + ' · ' + (a.typeName || a.ty) + ' · ' + s.ftName;
    // eslint-disable-next-line no-unsanitized/property -- safe: markup built by this module (data escaped where built) or an internal enum/constant
    $('fhFmChip').innerHTML = chip(s.ssMeta);

    var fig = legFigures(a, s);
    var f = fig.f;
    var live = s.eteVia === 'live';
    var rem = s.air && live ? nmRemaining(a, s) : null;
    var clockRel = function (t, via) {
      return clockText(t, via) + (relTime(t) ? ' · ' + relTime(t) : '');
    };

    // Departs / Arrives / Block / Time to run are the DISPLAY times — the same
    // fields the Board, the rail and the schedules rows print. [label, text, via]
    var cells = [
      ['Departs', Number.isFinite(s.depShown)
        ? clockRel(s.depShown, s.depVia) + (s.depVia === 'actual' ? ' · actual' : '')
        : (s.timed || s.air || s.stopped ? '—' : 'Anytime'), null],
      ['Arrives', s.stale ? '—'
        : Number.isFinite(s.etaShown) ? clockRel(s.etaShown, s.etaVia)
        : (s.timed || s.air || s.stopped ? '—' : 'Anytime'), s.etaVia],
      ['Block time', blockText(s), null],
    ];
    if (s.air || s.stopped) {
      cells.push(['Time to run', s.eteShown != null ? dur(s.eteShown) : '—', s.eteVia]);
      // Only shown when it was actually measured — a distance worked out from
      // a position still parked at the gate is a lie with three digits on it.
      if (rem != null) cells.push(['Distance to run', Math.round(rem).toLocaleString() + ' NM', null]);
      if (live) {
        cells.push(['Altitude', isFinite(a.alt) && a.alt > 0 ? 'FL' + Math.round(a.alt / 100) : '—', null]);
        cells.push(['Ground speed', isFinite(a.spd) ? Math.round(a.spd) + ' kt' : '—', null]);
      }
    }
    cells.push(['Flown by', a.pilot || 'Unknown', null]);
    cells.push(['Last movement', isFinite(a.upd) ? ago(Date.now() - a.upd) : 'Unknown', null]);

    // Who is rostered on this leg, by seat, in words: "Captain X · First Officer
    // Y", with an empty seat named ("Captain seat open"). A legacy briefing
    // marker only ever knew one name and reads "Pilot NAME".
    // HTML (names in .fh-pilot), so the cell is flagged 'html' and not escaped.
    var crewHtml = crewSeatsHtml(s.crew, { live: !!(s.air || s.stopped) }) +
      (!s.crew && crewPending.has(s.id) ? ' · your request is pending' : '');
    cells.push(['Crew', crewHtml, 'html']);

    // Bid-only tails (plan §7.5, Fleet Contracts) take priority over every
    // other note: crewBlockReason() refuses this leg before it even looks at
    // stale/stopped/air, so the note that explains the missing Request/FO
    // buttons has to lead with the actual reason too.
    var note = s.bidOnly
      ? 'This tail is bid-only — its flights are awarded as Fleet Contracts. See Dashboard → Contracts.'
      : s.stale
      ? 'Infinite Flight still lists this leg as in flight, but ' + a.reg + ' is ' +
        (a.at ? 'on the ground at ' + city(a.at) : 'not airborne') + '. Nothing closed the ' +
        'schedule out when the flight ended, so it stays on the board until someone does.'
      : s.stopped ? 'Stopped en route: the leg is still open and ' + a.reg + ' is not parked, ' +
        'but nobody is connected in it. The pilot can rejoin and this goes back to ' +
        'In flight on the next refresh. Times below are the filed ' +
        'schedule; there is no live position to work from.'
      : s.air ? (s.etaVia === 'live'
        ? 'Live — arrival and time to run are worked out from the aircraft\'s position and ' +
          'ground speed, not the filed schedule.' +
          (s.depVia === 'approx' ? ' This flight has no filed times, so departure and block time are estimates (≈).' : '')
        : s.etaVia === 'filed'
        ? 'In flight. Times are the filed schedule — the live feed has no position for this ' +
          'aircraft, so there is nothing to work a live arrival from.'
        : 'In flight, but there is no live position and no filed arrival, so no arrival time can be given.')
      : a.stored ? 'This aircraft is stored: outside the active fleet slots, and it takes no schedules.'
      : '';
    // An estimate is always marked, and the mark is explained once.
    if (s.blockVia === 'approx') {
      note += (note ? ' ' : '') + 'Block time marked ≈ is an estimate: distance at a typical cruise ' +
        'speed for this type, plus 30 minutes for taxi, climb and descent.';
    }

    // Reuses the rail's leg-route and key/value primitives rather than a
    // modal-only copy of each — they were pixel-for-pixel the same thing under
    // two names, and only one of them ever got updated.
    // eslint-disable-next-line no-unsanitized/property -- safe: markup built by this module (data escaped where built) or an internal enum/constant
    $('fhFmBody').innerHTML =
      '<div class="fh-leg-route">' +
        '<div class="fh-modal-ap"><span class="fh-leg-icao">' + esc(code(s.o)) + '</span>' +
          '<span class="fh-sub">' + esc(city(s.o)) + '</span></div>' +
        '<div class="fh-leg-line"><i style="left:' + (f * 100).toFixed(0) + '%;--c:' +
          (s.air ? 'var(--fh-air)' : s.stopped ? 'var(--fh-stop)' : 'var(--fh-sched)') + '"></i></div>' +
        '<div class="fh-modal-ap to"><span class="fh-leg-icao">' + esc(code(s.d)) + '</span>' +
          '<span class="fh-sub">' + esc(city(s.d)) + '</span></div>' +
      '</div>' +
      (s.air || s.stopped ? '<span class="fh-note">' + (f * 100).toFixed(0) + '% of the way there' +
        (s.stopped ? ' when the session ended' : '') + '</span>' : '') +
      '<dl class="fh-kv">' + cells.map(function (c) {
        // Crew is a list of names and wraps badly in a half-width cell, so it
        // takes the full row.
        return '<div' + (c[0] === 'Crew' ? ' style="grid-column:1/-1"' : '') +
          '><dt class="fh-k">' + esc(c[0]) + '</dt>' +
          '<dd class="fh-kv-v">' + (c[2] === 'html' ? c[1] : esc(c[1])) +
            (c[2] === 'live' ? ' <span class="fh-via" title="' + esc(VLIVE_TITLE) + '">live</span>' : '') + '</dd></div>';
      }).join('') + '</dl>' +
      (note ? '<p class="fh-modal-note">' + esc(note) + '</p>' : '');

    var acts = [];
    // Requesting a leg — the dialog is where the role is chosen; the board's
    // Request button is the one-click path and always asks for Captain.
    // A pilot already on the leg can leave it from here (owner 2026-11-09):
    // a confirm, then straight off — the server takes only their own seat.
    var blocked = crewBlockReason(s);
    var fxd = flexCoPilot(s);
    if (crewBusy === s.id) {
      acts.push('<button class="fh-btn fh-span" disabled>Sending…</button>');
    } else if (crewPending.has(s.id)) {
      acts.push('<button class="fh-btn fh-span" disabled>You\'ve requested — awaiting approval</button>');
    } else if (!blocked && fxd && fxd.open) {
      // Flex Crew: the released co-pilot seat is the only seat on offer, and
      // taking it seats the pilot at once — no request, no prompt.
      acts.push('<button class="fh-btn-primary fh-span" data-fmcrewreq="1">Take the co-pilot seat</button>');
    } else if (blocked && fxd && !fxd.open && s.crew && isOpenLeg(s) && !myCrewIn(s.crew)) {
      acts.push('<button class="fh-btn fh-span" disabled>' + esc(fxd.why) + '</button>');
    } else if (!blocked) {
      // With the left-hand seat already filled, First Officer is the seat
      // actually on offer, so it leads. Captain stays clickable rather than
      // disappearing — it raises the prompt that explains why, which is more
      // use than a button that silently is not there.
      // Both span the full width: they are the point of the dialog, and at two
      // to a row "Request as First Officer" truncates.
      var capHere = captainOn(s.crew);
      acts.push('<button class="fh-btn-' + (capHere ? 'ghost' : 'primary') +
        ' fh-span" data-fmcrewreq="0">Request as Captain</button>');
      acts.push('<button class="fh-btn-' + (capHere ? 'primary' : 'ghost') +
        ' fh-span" data-fmcrewreq="1">Request as First Officer</button>');
    }
    // SimBrief dispatch — only on a leg this pilot is actually crewed on, and
    // only while it is still open. Deliberately NOT gated on crewBlockReason():
    // that function answers "can you ASK for this leg", so it returns a reason
    // for a leg you already hold — the exact opposite of what is wanted here.
    if (canDispatch(s)) {
      if (dispatchBusy !== s.id) {
        acts.push('<label class="fh-field fh-span fh-dp-rwy"><span class="fh-field-label">Departure runway</span>' +
          rwyInputHtml(s, '') + '</label>');
      }
      if (dispatchBusy === s.id) {
        acts.push('<button class="fh-btn fh-span" disabled>Opening SimBrief…</button>');
      } else if (dispatchGesture === s.id) {
        acts.push('<button class="fh-btn-primary fh-span" data-fmdispatch="1">Tap to open SimBrief</button>');
      } else {
        acts.push('<button class="fh-btn-primary fh-span" data-fmdispatch="1">Dispatch with SimBrief</button>');
      }
    }
    if (canUnassign(s)) {
      acts.push(unassignBusy === s.id
        ? '<button class="fh-btn fh-span" disabled>Unassigning…</button>'
        : '<button class="fh-btn fh-span fh-btn-danger" data-fmunassign="1">Unassign me from this leg</button>');
    }
    acts.push('<button class="fh-btn" data-fmmap="1">Show on map</button>');
    acts.push('<button class="fh-btn" data-fmhist="1">Aircraft history</button>');
    writeKeepingRunway($('fhFmActions'), acts.join(''));
  }

  // ── crew requests: ask for a leg ────────────────────────────────────────

  /**
   * The co-pilot seat on a Flex Crew leg (lib/actions/fleet-flex-crew.js).
   * It exists ONLY once the sweep has released it — the aircraft stopped en
   * route and sat 5 h without anyone resuming it, which is when the "free
   * seat" post goes to Discord — and only until a newcomer takes it. Until
   * then it is locked. Null on a tail that is not Flex.
   *
   * @returns {null | {open: true} | {open: false, why: string}}
   */
  function flexCoPilot(s) {
    if (!s || !s.flexTail) return null;
    var e = s.flexEntry;
    var members = s.crew && s.crew.kind === 'crew' ? (s.crew.members || []) : [];
    var flew = {};
    ((e && e.stopCrew) || []).forEach(function (id) { flew[String(id)] = true; });
    var newcomer = members.some(function (m) { return m && !flew[String(m.userId)]; });
    if (e && e.phase === 'stopped' && e.foSeatOpen && !newcomer && members.length < CREW_CAP) {
      return { open: true };
    }
    return {
      open: false,
      why: e && e.phase === 'stopped' && isFinite(e.foOpensAt) && e.foOpensAt > 0
        ? 'Co-pilot seat opens ' + istClock(e.foOpensAt) + ' if the aircraft is still stopped.'
        : 'Co-pilot seat is locked until a free seat is posted in Discord.',
    };
  }

  /** Can the signed-in pilot ask for this leg? Returns a reason string when
   *  they cannot, or '' when they can. */
  function crewBlockReason(s) {
    if (!s) return 'No leg selected.';
    // Bid-only tails (plan §7.5, Fleet Contracts): checked first — the tail
    // is bid-only regardless of the leg's own state, and this is the single
    // source crewBlockReason() call sites ask before showing Request.
    if (s.bidOnly) return 'This tail is bid-only — see Dashboard → Contracts.';
    if (!myUserId()) return 'Sign in again to request a leg.';
    if (s.ss === 9 || s.ss === 11) return 'This leg is already closed.';
    // Flex Crew: a released co-pilot seat is the one way onto a stopped leg,
    // and the co-pilot seat is the one thing locked on a crewed Flex leg.
    var fx = flexCoPilot(s);
    if (fx && fx.open && !myCrewIn(s.crew)) return '';
    if (s.air || s.stopped) return 'This leg is already under way.';
    if (myCrewIn(s.crew)) return 'You are already crew on this leg.';
    if (fx && s.crew) return fx.why;
    // A leg carries up to three: somebody already having it does NOT close it,
    // which is the whole point of the Captain / First Officer choice.
    if (s.crew && s.crew.kind === 'crew') {
      return (s.crew.members || []).length >= CREW_CAP
        ? 'This leg already has ' + CREW_CAP + ' crew.' : '';
    }
    // A legacy briefing marker names one pilot and carries no count, so there
    // is no way to tell whether there is room. Treat it as taken.
    if (s.crew) return 'Somebody has already taken this leg.';
    return '';
  }

  /** Can this pilot plan this leg with SimBrief?
   *
   *  Deliberately NOT crewBlockReason(). That function answers "can you ASK for
   *  this leg", so it returns a reason for a leg you already hold — precisely
   *  the legs that ARE dispatchable. Asking it here would hide the button from
   *  everyone who could use it.
   *
   *  `myCrewIn` is native-crew only, so a legacy briefing marker (a name, no
   *  user id) never matches. That is correct: we cannot prove such a leg is
   *  yours, and dispatch is only offered on legs we can. */
  function canDispatch(s) {
    return !!(s && isOpenLeg(s) && myCrewIn(s.crew));
  }

  /** Can this pilot leave this leg from the website? Only a leg they are on
   *  (native crew, so it is provably theirs), that has not closed, on a tail
   *  that is not bid-only (a Fleet Contract seat is the contract's to end).
   *  The server re-checks all of it: only a seat held through a crew request. */
  function canUnassign(s) {
    if (!s || s.bidOnly || s.ss === 9 || s.ss === 11) return false;
    return !!myCrewIn(s.crew);
  }

  // ── "that seat is taken" prompt ────────────────────────────────────────
  //
  // A leg whose Captain's seat is filled is NOT blocked — two more can fly it —
  // so crewBlockReason() deliberately still says yes to it. What must not
  // happen is a pilot silently filing for a command they cannot have: Infinite
  // Flight does not enforce one Captain per leg, and the request is approved on
  // the org token hours later, by which point only an admin can undo the role.
  //
  // So the Captain paths stop here first and ASK. This is an offer of the
  // right-hand seat, not an error — that is why it is a dialog with an action
  // in it and not the toast every other refusal uses.
  // ── and the co-pilot coordination check ───────────────────────────────
  //
  // A First Officer request is half of an arrangement between two people, and
  // Infinite Flight knows nothing about the other half. A pilot who files for
  // the right-hand seat without speaking to the Captain produces an approved
  // assignment, a Discord notification and an admin's time spent, for a flight
  // that was never going to happen. So the seat is offered, and then the
  // question is asked.
  //
  // ONLY when a Captain is actually seated. On an empty leg there is nobody to
  // have coordinated with — the pilot is asking to wait for someone — and a
  // dialog asking about a person who does not exist is a speed bump, not a
  // check. That path files straight through.
  //
  // Asked EVERY time, with no "do not ask again": the question is about THIS
  // leg, and a yes last week cannot answer it.
  var BRIEF_URL = 'https://discord.com/channels/1246895842581938276/1550099613099499580';
  var BRIEF_NAME = 'fleet-mode-brief';

  /** #channel, the way Discord renders a channel mention. */
  function briefLink() {
    return '<a class="fh-dchan" href="' + BRIEF_URL + '" target="_blank" rel="noopener noreferrer">' +
      '<span class="fh-dchan-h" aria-hidden="true">#</span>' + esc(BRIEF_NAME) + '</a>';
  }

  /**
   * Legs this pilot is ALREADY rostered on and has not flown, fleet-wide.
   *
   * Read off the board's own model, so it costs no request. Matched on IF user
   * id through myCrewIn — a legacy briefing hold carries a display name and
   * never a user id, so it cannot match, which is correct: a soft hold is not
   * an assignment.
   *
   * The leg being requested is excluded. They are not crew on it yet, and
   * counting it would warn them about the very thing they are asking for.
   */
  function myOpenLegs(all, exceptLegId) {
    var out = [];
    (all || []).forEach(function (a) {
      (a.sch || []).forEach(function (s) {
        if (!s || String(s.id) === String(exceptLegId)) return;
        if (!isOpenLeg(s)) return;
        if (!myCrewIn(s.crew)) return;
        out.push({ reg: a.reg, s: s, wide: a.fam === 'Wide-body' });
      });
    });
    return out;
  }

  /**
   * Which of the pilot's own unflown legs a request should warn about. Pure.
   *
   * A pilot flying narrow-bodies may also fly ONE wide-body (owner,
   * 2026-11-01). So asking for a wide-body counts only the wide-body seats
   * they already hold: the first goes straight in, a second is warned. Asking
   * for a narrow-body counts everything, as it always has. Approved seats
   * only — `mine` is read off IF's crew lists, where a pending ask never is.
   */
  function legsToWarnAbout(mine, targetWide) {
    if (!targetWide) return mine || [];
    return (mine || []).filter(function (m) { return m.wide; });
  }

  /** Is this tail a wide-body, by the board's own family? */
  function tailIsWide(tailId) {
    var t = model().find(function (a) { return a.id === tailId; });
    return !!(t && t.fam === 'Wide-body');
  }

  // kind: 'taken'  — they asked for Captain and it is gone; offer the other seat
  //       'buddy'  — they asked for the right-hand seat outright
  //       'busy'   — nothing wrong with the SEAT; they already have legs out
  //       'leave'  — they are on the leg and asked to unassign themselves
  var cfm = null;   // { kind, tailId, legId, captain, cs, route, reg, role, mine }

  function openConfirm(kind, tailId, s, captainName, reg, role) {
    var wide = tailIsWide(tailId);
    cfm = {
      kind: kind,
      tailId: tailId,
      legId: s.id,
      captain: String(captainName || '').trim() || 'Another pilot',
      cs: s.cs || 'this leg',
      route: code(s.o) + ' → ' + code(s.d),
      reg: reg || '',
      // The seat being asked for. Was hard-coded to First Officer at the
      // confirm handler, which was true while both prompts were about the
      // right-hand seat — 'busy' can be either, so it travels with the prompt.
      role: Number(role) || 0,
      // Folded into whichever prompt is already opening rather than stacked as
      // a second modal: two in a row to answer one question reads as the first
      // not having worked.
      wide: wide,
      mine: legsToWarnAbout(myOpenLegs(model(), s.id), wide),
    };
    renderConfirm();
    var el = $('fhCrewConfirm');
    if (el) el.hidden = false;
  }

  function askFirstOfficer(tailId, s, captainName, reg) {
    openConfirm('taken', tailId, s, captainName, reg, 1);
  }

  /** The co-pilot check. Caller has already established there IS a Captain. */
  function askCoPilotCoordinated(tailId, s, captainName, reg) {
    openConfirm('buddy', tailId, s, captainName, reg, 1);
  }

  /**
   * File the request, unless the pilot already has legs out — in which case
   * tell them first and let them decide.
   *
   * The seat is fine here; this is only about the pilot's own backlog, which
   * they can see on the board but will not have counted. A fleet manager is
   * looking at exactly the same list on their side of the queue (the admin
   * screen shows it on every card), so a pilot who asks anyway at least does
   * it knowing the likely answer.
   *
   * Never blocks: the decision is the fleet manager's, and a pilot may have a
   * good reason — a leg they are about to fly, or one they mean to release.
   */
  function requestOrWarn(tailId, s, reg, role) {
    if (legsToWarnAbout(myOpenLegs(model(), s.id), tailIsWide(tailId)).length) {
      return openConfirm('busy', tailId, s, '', reg, role);
    }
    requestCrew(tailId, s.id, role);
  }

  function closeConfirm() {
    cfm = null;
    var el = $('fhCrewConfirm');
    if (el) el.hidden = true;
  }

  /** At most this many of the pilot's own legs are listed before "+N more". */
  var BUSY_LIST_MAX = 4;

  /**
   * "You already have these out." Pure.
   *
   * A COUNT would not be enough: a pilot who has forgotten a leg needs to see
   * which one before they can judge whether this request is reasonable, and
   * the whole point is to let them decide rather than to stop them.
   *
   * Worded as what fleet managers tend to do, not as a rule — nothing here
   * blocks anything, and promising a rejection we do not control would be a
   * lie the first time one is approved.
   */
  function busyWarning(mine, wide) {
    if (!mine || !mine.length) return '';
    var n = mine.length;
    var rows = mine.slice(0, BUSY_LIST_MAX).map(function (m) {
      return '<li><b class="fh-mono">' + esc(m.s.cs || 'Leg') + '</b> ' +
        '<span class="fh-mono fh-cf-rt">' + esc(code(m.s.o)) + ' \u2192 ' + esc(code(m.s.d)) + '</span>' +
        '<span class="fh-cf-reg">' + esc(m.reg || '') + '</span></li>';
    }).join('');
    var rest = n - Math.min(n, BUSY_LIST_MAX);
    if (rest > 0) rows += '<li class="fh-cf-more">+' + rest + ' more</li>';

    // A wide-body ask lists only wide-body seats (legsToWarnAbout): the
    // narrow-body ones are allowed alongside, so they are not the problem.
    if (wide) {
      return '<div class="fh-cf-busy">' +
        '<p class="fh-cf-busy-head">You already have <strong>' + n +
          (n === 1 ? ' wide-body leg' : ' wide-body legs') + '</strong> to fly.</p>' +
        '<ul class="fh-cf-busy-list">' + rows + '</ul>' +
        '<p class="fh-cf-busy-note">You can fly one wide-body alongside your narrow-body legs. ' +
          'Fleet managers usually turn down a second wide-body until the first has flown, ' +
          'so flying or releasing it first makes this more likely to be approved.</p>' +
        '</div>';
    }

    return '<div class="fh-cf-busy">' +
      '<p class="fh-cf-busy-head">You already have <strong>' + n +
        (n === 1 ? ' leg' : ' legs') + '</strong> to fly.</p>' +
      '<ul class="fh-cf-busy-list">' + rows + '</ul>' +
      '<p class="fh-cf-busy-note">Fleet managers can see this too, and usually turn down a request ' +
        'from a pilot with legs outstanding. Flying or releasing one of those first makes this ' +
        'more likely to be approved.</p>' +
      '</div>';
  }

  function renderConfirm() {
    if (!cfm || !$('fhCfBody')) return;
    $('fhCfTitle').textContent = cfm.kind === 'buddy'
      ? 'Flying as co-pilot'
      : cfm.kind === 'busy' ? (cfm.wide ? 'You already have a wide-body' : 'You have legs waiting')
        : 'Captain\u2019s seat is taken';
    $('fhCfSub').textContent = cfm.cs + ' · ' + cfm.route +
      (cfm.reg ? ' · ' + cfm.reg : '');

    // Leaving a leg: no approval, so this dialog IS the safeguard. Says what
    // happens, at once, and that getting back on means asking again.
    if (cfm.kind === 'leave') {
      $('fhCfTitle').textContent = 'Unassign from this leg?';
      // eslint-disable-next-line no-unsanitized/property -- safe: markup built by this module (data escaped where built) or an internal enum/constant
      $('fhCfBody').innerHTML =
        '<p>You’ll be taken off <strong>' + esc(cfm.cs) + '</strong>' +
          (cfm.seat ? ' as <strong>' + esc(cfm.seat) + '</strong>' : '') +
          ' straight away — no approval needed.</p>' +
        '<p>The fleet managers will be told the seat is open. To fly this leg again you’ll ' +
          'have to request it like anyone else, and someone may take it first.</p>';
      $('fhCfActions').innerHTML =
        // Destructive = outlined red; the one filled button is the safe default.
        '<button class="fh-btn fh-btn-danger" data-cfok="1">Yes, unassign me</button>' +
        '<button class="fh-btn-primary" data-cfcancel="1">Keep me on</button>';
      return;
    }

    // The 'busy' prompt has no seat question to answer — it exists only to show
    // the pilot their own backlog before they add to it.
    if (cfm.kind === 'busy') {
      // eslint-disable-next-line no-unsanitized/property -- safe: markup built by this module (data escaped where built) or an internal enum/constant
      $('fhCfBody').innerHTML = busyWarning(cfm.mine, cfm.wide);
      $('fhCfActions').innerHTML =
        '<button class="fh-btn-primary" data-cfok="1">Request anyway</button>' +
        '<button class="fh-btn" data-cfcancel="1">Cancel</button>';
      return;
    }

    // The seat-taken path still has to explain the seat before it can ask about
    // the person — the pilot asked for a command they are not getting. Folded
    // into THIS dialog rather than stacked as a second one: it is one decision
    // ("fly the right-hand seat alongside them, yes or no"), and two modals in a
    // row to answer it would read as the first not having worked.
    var lead = cfm.kind === 'buddy'
      ? '<p>You\u2019re asking for the <strong>First Officer</strong> seat alongside ' +
          '<strong>' + esc(cfm.captain) + '</strong>.</p>'
      : '<p><strong>' + esc(cfm.captain) + '</strong> already has command of ' +
          '<strong>' + esc(cfm.reg || 'this aircraft') + '</strong> on this leg.</p>' +
        '<p class="fh-cf-seat">The flight still has room. Request it as ' +
          '<strong>First Officer</strong> and you fly it alongside ' + esc(cfm.captain) + '.</p>';

    // eslint-disable-next-line no-unsanitized/property -- safe: markup built by this module (data escaped where built) or an internal enum/constant
    $('fhCfBody').innerHTML = lead +
      '<p>A buddy flight only works if you both show up. Have you spoken to them and agreed ' +
        'this leg \u2014 the time, who will take off or land?</p>' +
      '<p>New to flying as a pair? The brief is in ' + briefLink() + '.</p>' +
      // Appended rather than raised as a second modal — one decision, one
      // dialog. It sits last because the seat question is what they opened.
      busyWarning(cfm.mine, cfm.wide);

    $('fhCfActions').innerHTML =
      '<button class="fh-btn-primary" data-cfok="1">Yes \u2014 we\u2019ve coordinated</button>' +
      '<button class="fh-btn" data-cfcancel="1">Cancel</button>';
  }

  /** The Captain paths all funnel through here: prompt if the seat is taken,
   *  file the request if it is not. Returns nothing — both outcomes are
   *  terminal from the click's point of view. */
  function requestAsCaptain(tail, s) {
    var cap = captainOn(s.crew);
    if (cap) return askFirstOfficer(tail.id, s, cap.username, tail.reg);
    requestOrWarn(tail.id, s, tail.reg, 0);
  }

  /**
   * The board row's path: ask for whichever seat is open rather than asking the
   * pilot which they meant. A Captain already in the left-hand seat means the
   * only seat on offer is First Officer, which is what the row's "Co-pilot"
   * label already said — so the SEAT needs no confirming. The arrangement with
   * the person in the other seat does, which is what askCoPilotCoordinated
   * stops for. An empty leg is still a Captain request and stops for nothing.
   *
   * The server decides either way (createCrewRequest re-reads the leg and can
   * still answer CAPTAIN_TAKEN if someone was seated in between); this only
   * stops the UI asking a question it already knows the answer to.
   */
  function requestFreeSeat(tail, s) {
    // A released Flex co-pilot seat is assigned on the spot, not requested.
    var fx = flexCoPilot(s);
    if (fx && fx.open) return requestCrew(tail.id, s.id, 1);
    var cap = captainOn(s.crew);
    if (cap) return askCoPilotCoordinated(tail.id, s, cap.username, tail.reg);
    requestOrWarn(tail.id, s, tail.reg, 0);
  }

  /** File a crew request. Identity comes from the signed HMAC minted at
   *  sign-in — the server never trusts a user id sent from here. */
  function requestCrew(tailId, legId, role) {
    var auth = window.INVA_FLEET.getAuth();
    var identity = auth && auth.followIdentity;
    if (!identity) {
      toastFollow('Sign in again to request a leg.');
      return Promise.resolve();
    }
    crewBusy = legId;
    render();
    // Goes through the bridge's authenticated relay, NOT a bare fetch: this
    // route reads the org, the tail and its schedules on the pilot's own IF
    // token, so it needs the Authorization header (and the refresh-on-401 that
    // comes with it). identityPost's plain fetch is not a model for this — that
    // route is authenticated by the HMAC identity alone.
    return window.INVA_FLEET.api('/api/fleetPilotCrewRequest', {
      method: 'POST',
      body: {
        identity: identity,
        aircraftId: tailId,
        scheduleId: legId,
        role: Number(role) || 0,
        pilotName: (auth.profile && auth.profile.displayName) || '',
      },
    }).then(function (res) {
      // Flex Crew (narrow-body tails) seats the pilot on the spot — there is
      // nothing pending to remember, and the board should show the seat now.
      if (res && res.assigned) {
        toastFollow(res.notice || ('Assigned as ' + (res.roleName || 'crew') + ' via Flex Crew.'));
        offerBellTip(tailId, legId);
        try {
          Promise.resolve(window.INVA_FLEET.reloadTail(tailId)).catch(function () { /* next refresh shows it */ });
        } catch (e) { /* next refresh shows it */ }
        return;
      }
      rememberCrewRequest(legId);
      toastFollow('Request sent — an admin will confirm it in Discord.');
    }).catch(function (e) {
      // The server owns the same one-Captain rule and re-checks it against a
      // fresh read, so it can refuse a request this screen thought was fine —
      // somebody took the seat while the board was stale. Raise the same offer
      // rather than printing a dead end. `code` is carried on the error by
      // fleet-mode.js's relay.
      if (e && e.code === 'CAPTAIN_TAKEN') {
        var ct = model().find(function (a) { return a.id === tailId; });
        var cs = ct && ct.sch.find(function (x) { return x.id === legId; });
        if (cs) return askFirstOfficer(tailId, cs, (e.detail || {}).captainName, ct.reg);
      }
      toastFollow(e.message || 'Could not send the request.');
    }).then(function () {
      crewBusy = null;
      render();
    });
  }

  // ── leaving a leg ──────────────────────────────────────────────────────

  /** The confirm first; nothing is sent until the pilot says yes. */
  function askUnassign(tail, s) {
    var mine = myCrewIn(s.crew);
    openConfirm('leave', tail.id, s, '', tail.reg, mine ? Number(mine.role) : 0);
    if (cfm) {
      cfm.seat = mine && CREW_ROLE_NAME[mine.role] ? CREW_ROLE_NAME[mine.role] : '';
      renderConfirm();
    }
  }

  /** Take the pilot off the leg. Identity is the signed HMAC; the server
   *  decides which seat is theirs and refuses anything else. */
  function unassignSelf(tailId, legId) {
    var auth = window.INVA_FLEET.getAuth();
    var identity = auth && auth.followIdentity;
    if (!identity) {
      toastFollow('Sign in again to leave a leg.');
      return Promise.resolve();
    }
    if (unassignBusy) return Promise.resolve();
    unassignBusy = legId;
    render();
    return fetch('/api/fleetPilotUnassign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: identity, scheduleId: legId }),
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        // `error` from our handler; `message` is what Cloud Run's own 404 sends.
        if (!r.ok) throw new Error((j && (j.error || j.message)) || ('Could not take you off the leg (HTTP ' + r.status + ').'));
        return j;
      });
    }).then(function (j) {
      toastFollow('You’re off ' + ((j && j.callsign) || 'the leg') + '. The fleet managers have been told.');
      try {
        Promise.resolve(window.INVA_FLEET.reloadTail(tailId)).catch(function () { /* next refresh shows it */ });
      } catch (e) { /* next refresh shows it */ }
    }).catch(function (e) {
      toastFollow((e && e.message) || 'Could not take you off the leg.');
    }).then(function () {
      unassignBusy = null;
      render();
    });
  }

  // ── SimBrief dispatch ──────────────────────────────────────────────────
  //
  // Career mode's equivalent is dashboard.js:planWithSimBrief. This is the same
  // protocol on the same helper (simbrief-helper.js), with three differences
  // that are all forced by Fleet Mode being what it is:
  //
  //   1. THE POPUP IS CLAIMED SYNCHRONOUSLY, first thing, before any await.
  //      Safari only honours window.open while it is on the gesture's call
  //      stack — the rule fleet-mode.js:284-294 documents at length after
  //      sign-in blocked 100% of the time on iPhone. Career gets away with a
  //      two-step "Tap to Open SimBrief" dance because it mutates a button
  //      element; this screen re-renders every 90s and would destroy it.
  //   2. THE PILOT'S CAREER DETAILS COME FROM THE SERVER. There is no Firebase
  //      auth here, so users/{uid}.simbriefUsername is unreadable in the
  //      browser — /api/fleetPilotDispatch resolves it from the signed HMAC.
  //      A failure there is NOT fatal: the username only feeds the OFP viewer's
  //      polling fallback, and the normal ?ofp_id= redirect needs none.
  //   3. NOTHING IS WRITTEN ANYWHERE. Career marks the leg `dispatched` on its
  //      sector doc; Fleet Mode owns no such record and must not touch career
  //      collections, so dispatching a leg twice is simply allowed.

  // simbrief-helper.js gave up looking for the plan (see OFP_WATCH there):
  // say so, rather than leaving the pilot on this screen wondering.
  if (window.addEventListener) {
    window.addEventListener('simbrief:ofp-missing', function (e) {
      toastFollow(e.detail && e.detail.limited
        ? 'Too many SimBrief look-ups this hour. Try again later.'
        : 'SimBrief did not finish that plan. Dispatch again when ready.');
    });
  }

  /** The career profile behind this pilot, or {} — never rejects. */
  function dispatchProfile() {
    var auth = window.INVA_FLEET.getAuth();
    var identity = auth && auth.followIdentity;
    if (!identity) return Promise.resolve({});
    return fetch('/api/fleetPilotDispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: identity }),
    }).then(function (r) {
      return r.ok ? r.json() : {};
    }).catch(function () { return {}; });
  }

  /**
   * Hand a leg to SimBrief. Called from the Dispatch buttons — the flight
   * dialog's and the Flight bag's, which share one click branch.
   * `popup` is the window already claimed on the click — see note 1 above.
   * `returnTo` ('bag' or nothing) is where the OFP viewer's Back should land.
   */
  function dispatchLeg(tail, s, popup, returnTo) {
    var built = window.INVA_FLEET_DISPATCH.buildFormData({
      callsign: s.cs,
      orig: s.o,
      dest: s.d,
      type: tail.ty,
      registration: tail.reg,
      flightPlan: s.fp,
      depRunway: dispatchRwy[s.id] || '',
    });
    if (!built.dispatchable) {
      if (popup) { try { popup.close(); } catch (e) {} }
      toastFollow(built.reason);
      return;
    }

    dispatchBusy = s.id;
    dispatchGesture = null;
    render();

    // Same per-tail sampling career uses (simbrief-helper.js:dispatchPax, the
    // pure INVACalc.resolveTailSeats on fleet.json — no career collection is
    // read), so a Fleet Mode OFP carries a believable load rather than
    // SimBrief's AUTO guess. dispatchPax never rejects; a null pax (unknown
    // type) means omit, exactly as career dispatch does.
    var paxJob = window.dispatchPax
      ? window.dispatchPax(s.cs, tail.ty, { tail: tail.reg || '' })
      : Promise.resolve(null);
    return Promise.all([dispatchProfile(), paxJob]).then(function (res) {
      var me = res[0];
      var formData = built.formData;
      if (res[1] && res[1].pax) formData.pax = String(res[1].pax);

      // Read back by the OFP viewer. `fleetMode` is the flag that keeps it from
      // writing a career `flightplans` doc and sends its Back button to /fleet.
      try {
        sessionStorage.setItem('dispatchLegData', JSON.stringify({
          fleetMode: true,
          scheduleId: s.id,
          aircraftId: tail.id,
          flightNumber: s.cs,
          departure: formData.orig,
          arrival: formData.dest,
          aircraft: tail.ty,
          tailNumber: tail.reg || '',
          pilotName: me.pilotName || '',
          pilotCallsign: me.pilotCallsign || '',
          // Absent stays absent — see handleFleetPilotDispatch. 'AUTO' would
          // make the viewer poll a nonexistent user for five minutes.
          ...(me.simbriefUsername ? { simbriefUsername: me.simbriefUsername } : {}),
        }));
        // Back from the viewer lands where the dispatch started. Cleared for a
        // dispatch from anywhere else, so a stale note cannot hijack it.
        if (returnTo === 'bag') sessionStorage.setItem(RETURN_KEY, 'bag');
        else sessionStorage.removeItem(RETURN_KEY);
      } catch (e) { /* private mode — the ?ofp_id= redirect still works */ }

      return window.simbriefSubmitWithForm(
        formData, window.location.origin + '/ofp-viewer', popup
      );
    }).then(function (ok) {
      if (!ok) toastFollow('Could not open the SimBrief dispatcher.');
    }).catch(function (e) {
      if (popup) { try { popup.close(); } catch (_) {} }
      toastFollow((e && e.message) || 'Could not open the SimBrief dispatcher.');
    }).then(function () {
      dispatchBusy = null;
      render();
    });
  }

  // ── leg alerts: HMAC-identity API ──────────────────────────────────────
  // A plain fetch authenticated by the signed identity alone (no IF bearer).
  function identityPost(payload, url) {
    var auth = window.INVA_FLEET.getAuth();
    var identity = auth && auth.followIdentity;
    if (!identity) return Promise.reject(new Error('Sign in again to use leg alerts.'));
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ identity: identity }, payload)),
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(j.error || 'Request failed.');
        return j;
      });
    });
  }

  function loadLegAlerts() {
    var auth = window.INVA_FLEET.getAuth();
    if (!auth || !auth.followIdentity) return;
    identityPost({ action: 'list' }, '/api/fleetPilotLegAlert').then(function (j) {
      legAlerts = new Set((j.alerts || []).map(String));
      render();
    }).catch(function () { /* alerts are optional — never block the page */ });
  }

  function toggleLegAlert(tailId, legId) {
    if (!tailId || !legId || legAlertBusy) return;
    var on = !legAlerts.has(String(legId));
    legAlertBusy = legId;
    render();
    identityPost({ action: on ? 'on' : 'off', aircraftId: tailId, scheduleId: legId }, '/api/fleetPilotLegAlert')
      .then(function (j) {
        legAlerts = new Set((j.alerts || []).map(String));
        toastFollow(on
          ? "Alert on — you'll get a Discord DM when the leg ahead is about to land."
          : 'Alert off.');
      })
      .catch(function (e) { toastFollow((e && e.message) || 'Could not change the alert.'); })
      .then(function () { legAlertBusy = null; render(); });
  }

  /** In-page status line (#fhFollowToast — the id predates the removal of
   *  Follow-a-tail and is kept: the e2e specs and the markup key on it). */
  function toastFollow(text) {
    var el = $('fhFollowToast');
    if (!el) return;
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastFollow._t);
    toastFollow._t = setTimeout(function () { el.hidden = true; }, 9000);
  }

  // ── map ────────────────────────────────────────────────────────────────
  function loadMaplibre() {
    if (window.maplibregl) return Promise.resolve(window.maplibregl);
    if (loadMaplibre._p) return loadMaplibre._p;
    loadMaplibre._p = new Promise(function (resolve, reject) {
      var css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = MAPLIBRE_CSS;
      document.head.appendChild(css);
      var js = document.createElement('script');
      js.src = MAPLIBRE_JS;
      js.onload = function () { resolve(window.maplibregl); };
      js.onerror = function () { reject(new Error('map unavailable')); };
      document.head.appendChild(js);
    });
    return loadMaplibre._p;
  }

  // The base map follows the theme: CARTO Positron in light, Dark Matter in
  // dark, both without labels (DESIGN.md §7.2) — our own markers carry every
  // name that matters. The background colour shows while tiles load; MapLibre
  // cannot read CSS, so it is taken from the --fh-map-bg token.
  var CARTO_KEY = 'cb1_44ok_1_7ec98f58aad43899aa32a8c4';
  function mapIsDark() {
    var t = window.INVAFleetTheme;
    return t && t.effective ? t.effective() === 'dark' : true;
  }
  function mapStyle() {
    var dark = mapIsDark();
    var bg = '';
    try { bg = getComputedStyle(document.documentElement).getPropertyValue('--fh-map-bg').trim(); } catch (e) { /* no CSSOM */ }
    return {
      version: 8,
      sources: {
        base: {
          type: 'raster',
          tiles: ['a', 'b'].map(function (h) {
            return 'https://' + h + '.basemaps.cartocdn.com/' + (dark ? 'dark_nolabels' : 'light_nolabels') +
              '/{z}/{x}/{y}@2x.png?key=' + CARTO_KEY;
          }),
          tileSize: 256,
          attribution: '© OpenStreetMap · © CARTO',
        },
      },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': bg || (dark ? '#0a0a0a' : '#f2f2f2') } },
        { id: 'base', type: 'raster', source: 'base', paint: dark
          ? { 'raster-opacity': 0.7, 'raster-saturation': -0.4 }
          : { 'raster-opacity': 0.9, 'raster-saturation': -1 } },
      ],
    };
  }

  function bootMap() {
    var el = $('fhMap');
    if (!el || map) return;
    loadMaplibre().then(function (maplibregl) {
      if (map) return;
      map = new maplibregl.Map({
        container: el,
        style: mapStyle(),
        center: [78, 22], zoom: 3.1, minZoom: 1.6, maxZoom: 9,
        dragRotate: false, attributionControl: false,
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
      map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
      map.on('load', function () { drawAirports(); syncMarkers(); });
      map.on('zoom', applyZoomStyling);
    }).catch(function () {
      el.innerHTML = '<div class="fh-empty">The map could not load. Everything else on this page still works.</div>';
    });
  }

  /** Hubs get the airline mark; anywhere the fleet actually is (or is flying
   *  to) gets a small diamond whose code appears once you zoom in. */
  function drawAirports() {
    if (!map || !window.maplibregl) return;
    airportMarkers.forEach(function (m) { m.remove(); });
    airportMarkers = [];
    codeLabels = [];

    var used = {};
    HUBS.forEach(function (i) { used[i] = 1; });
    model().forEach(function (a) {
      if (a.at) used[a.at] = 1;
      a.sch.forEach(function (s) { if (s.o) used[s.o] = 1; if (s.d) used[s.d] = 1; });
    });

    Object.keys(used).forEach(function (icao) {
      var c = coords(icao);
      if (!c) return;
      var hub = isHub(icao);
      // The scaled content sits in an inner wrapper: MapLibre owns the
      // transform on the marker root itself (that is how it positions it).
      var el = document.createElement('div');
      el.className = 'fh-apt' + (hub ? ' hub' : '');
      var inner = document.createElement('div');
      inner.className = 'fh-apt-in';
      if (hub) {
        // eslint-disable-next-line no-unsanitized/property -- safe: markup built by this module (data escaped where built) or an internal enum/constant
        inner.innerHTML = '<img src="' + LOGO + '" alt="">' +
          '<div class="fh-apt-lab"><b>' + esc(city(icao)) + '</b><span>' + esc(code(icao)) + '</span></div>';
      } else {
        inner.innerHTML = '<span class="fh-apt-mark"></span><span class="fh-apt-code">' + esc(code(icao)) + '</span>';
        codeLabels.push(inner.querySelector('.fh-apt-code'));
      }
      el.appendChild(inner);
      airportMarkers.push(
        new maplibregl.Marker({ element: el, anchor: 'left', offset: [hub ? -10 : -4, 0] })
          .setLngLat(c).addTo(map)
      );
    });
    applyZoomStyling();
  }

  /** Markers size with the zoom: small enough at world view that a busy hub
   *  is readable, bigger as you come in. One CSS var drives every marker. */
  function applyZoomStyling() {
    if (!map) return;
    var z = map.getZoom();
    var t = Math.min(1, Math.max(0, (z - 1.6) / (9 - 1.6)));
    var scale = (0.62 + t * 0.73).toFixed(3);
    var el = $('fhMap');
    if (el) el.style.setProperty('--fh-mks', scale);
    var show = z >= 4.2;
    codeLabels.forEach(function (l) { l.style.display = show ? 'block' : 'none'; });
  }

  function markerEl(a, isSel) {
    var wrap = document.createElement('div');
    wrap.className = 'fh-mk';
    // Inner wrapper carries the zoom scale — MapLibre owns the root's transform.
    var inner = document.createElement('div');
    inner.className = 'fh-mk-in';
    if (a.enRoute) {
      // Stopped counts as en route: it still has a heading and is between
      // airports, so it reads as traffic rather than as a parked dot.
      var t = document.createElement('div');
      t.className = 'fh-mk-air';
      t.style.color = a.meta[1];
      t.style.transform = 'rotate(' + (isFinite(a.hdg) ? a.hdg : 0) + 'deg)';
      // eslint-disable-next-line no-unsanitized/property -- safe: markup built by this module (data escaped where built) or an internal enum/constant
      t.innerHTML = PLANE_SVG;
      inner.appendChild(t);
    } else {
      var d = document.createElement('div');
      d.className = 'fh-mk-dot' + (a.stored ? ' stored' : '');
      d.style.background = a.meta[1];
      inner.appendChild(d);
    }
    if (isSel) {
      var ring = document.createElement('div');
      ring.className = 'fh-mk-ring';
      inner.appendChild(ring);
      var tag = document.createElement('div');
      tag.className = 'fh-mk-tag';
      tag.textContent = a.reg;
      inner.appendChild(tag);
    }
    wrap.appendChild(inner);
    wrap.onclick = function () {
      select(a.id);
      if (isSheetMode()) openSheet(a.id, false);
    };
    return wrap;
  }

  function syncMarkers() {
    if (!map || !window.maplibregl) return;
    var all = model();
    all.forEach(function (a) {
      if (markers[a.id]) { markers[a.id].remove(); delete markers[a.id]; }
      if (!passesFilter(a) || !isFinite(a.lat) || !isFinite(a.lon)) return;
      markers[a.id] = new maplibregl.Marker({ element: markerEl(a, a.id === ui.sel) })
        .setLngLat([a.lon, a.lat]).addTo(map);
    });
    if (!didFit) { didFit = true; fitFleet(all); }
  }

  function fitFleet(all) {
    if (!map || !window.maplibregl) return;
    var pts = (all || model()).filter(function (a) { return isFinite(a.lat) && isFinite(a.lon); });
    if (!pts.length) return;
    var b = new window.maplibregl.LngLatBounds();
    pts.forEach(function (a) { b.extend([a.lon, a.lat]); });
    map.fitBounds(b, { padding: { top: 70, right: 70, bottom: 60, left: 70 }, duration: 700, maxZoom: 5 });
  }

  function flyToTail(a) {
    if (!map || !a || !isFinite(a.lat) || !isFinite(a.lon)) return;
    map.flyTo({ center: [a.lon, a.lat], zoom: Math.max(map.getZoom(), 4.4), duration: 800 });
  }

  // ── screens + wiring ───────────────────────────────────────────────────
  function setPage(page) {
    closeSheet(false);
    var was = ui.page;
    ui.page = page;
    // The Flight bag is the one screen that keeps itself current (see `bag`):
    // opening it starts the check chain and asks for the approval order, leaving
    // it stops the chain. Before render() so a failure to even try is known.
    if (was === 'bag' && page !== 'bag') leaveBag();
    if (page === 'bag' && was !== 'bag') enterBag();
    // My activity fetches on OPEN only (viewPilot() opens another pilot itself);
    // the Airline tab needs my profile snapshot for its leaderboard.
    if (page === 'activity' && !actPending) enterActivity(null);
    if (page === 'airline' && was !== 'airline') enterLeaderboard();
    render();
    window.scrollTo(0, 0);
  }
  function select(id) {
    ui.sel = id;
    render();
  }

  // ── the selected tail as a full-screen sheet (below 1140px) ────────────────
  // Where the rail is not beside the content (phone, tablet) it would otherwise
  // sit at the very bottom of the Fleet page, under the list you just tapped in.
  // So it is the SAME element (.fh-detail-col, holding #fhSelCard and its
  // buttons) switched into overlay mode by a class — not a second copy of the
  // markup, so the ids the handlers and the guide use stay unique. It lives
  // inside #homeView, where the delegated click handler can see it.
  //
  // Opens on a tap of a tail in the Active-fleet list or a map marker. Closes
  // on the Close button, Esc, "On map" (which then scrolls to the map) and any
  // navigation. Page scroll is locked while open; focus moves in and returns to
  // the row that opened it. At >= 1140px none of this runs and the rail simply
  // sits beside the content.
  var sheet = { open: false, tail: null, restore: false, mq: null };

  function isSheetMode() {
    try {
      return !!(window.matchMedia && !window.matchMedia('(min-width: 1140px)').matches);
    } catch (e) { return false; }
  }
  function setPageLock(on) {
    try {
      var root = document.documentElement;
      if (root && root.classList) root.classList.toggle('fh-lock', !!on);
    } catch (e) { /* no DOM to lock */ }
  }
  function openSheet(tailId, fromRow) {
    var col = $('fhDetailCol');
    if (!col || sheet.open) return;
    sheet.open = true;
    sheet.tail = tailId || ui.sel;
    sheet.restore = !!fromRow;
    col.classList.add('fh-sheet-open');
    col.setAttribute('role', 'dialog');
    col.setAttribute('aria-modal', 'true');
    col.setAttribute('aria-label', 'Selected aircraft');
    setPageLock(true);
    col.scrollTop = 0;
    var x = $('fhSelClose');
    if (x && x.focus) x.focus();
    // Growing past 1140px while it is open puts the rail back beside the
    // content, so the sheet's scroll lock has to come off with it.
    if (!sheet.mq && window.matchMedia) {
      sheet.mq = window.matchMedia('(min-width: 1140px)');
      var onChange = function () { if (sheet.mq.matches) closeSheet(false); };
      if (sheet.mq.addEventListener) sheet.mq.addEventListener('change', onChange);
      else if (sheet.mq.addListener) sheet.mq.addListener(onChange);
    }
  }
  function closeSheet(restoreFocus) {
    if (!sheet.open) return;
    var col = $('fhDetailCol');
    sheet.open = false;
    if (col) {
      col.classList.remove('fh-sheet-open');
      col.removeAttribute('role');
      col.removeAttribute('aria-modal');
      col.removeAttribute('aria-label');
    }
    setPageLock(false);
    var id = sheet.tail, back = sheet.restore;
    sheet.tail = null; sheet.restore = false;
    if (restoreFocus !== false && back) {
      // The list re-renders wholesale, so the row that was tapped is a
      // different node by now — find it again by its tail id.
      var rows = document.querySelectorAll('.fh-tail');
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].dataset && rows[i].dataset.tail === id) {
          try { rows[i].focus({ preventScroll: true }); } catch (e) { rows[i].focus(); }
          break;
        }
      }
    }
  }
  /** Keep Tab inside the open sheet. */
  function trapSheetTab(e) {
    var col = $('fhDetailCol');
    if (!col || !col.querySelectorAll) return;
    var items = Array.prototype.filter.call(
      col.querySelectorAll('button, a[href], [tabindex]:not([tabindex="-1"])'),
      function (n) { return !n.disabled && n.getClientRects().length; });
    if (!items.length) return;
    var first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    else if (!col.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
  }

  /** The tab rail (DESIGN.md §4.2) is the ONLY navigation, at every width —
   *  the phone bottom bar went with the 2026-10-08 INVA Line redesign. Tabs are
   *  plain data-page buttons, so the delegated click handler routes them. */
  var NAV = [['fleet', 'Fleet'], ['board', 'Board'], ['schedules', 'Schedules'], ['bag', 'Flight bag'], ['airline', 'Airline'], ['activity', 'My activity']];

  // Staff get a fifth tab (assets/js/fleet-admin.js). Asked of the admin
  // module every render: it learns the answer from /api/fleetAdminMe after
  // sign-in and re-renders the home when it does.
  function isFleetAdmin() {
    return !!(window.INVA_FLEET_ADMIN && window.INVA_FLEET_ADMIN.isAdmin());
  }
  // Extra tabs a page may register before boot: window.INVA_FLEET_EXTRA_PAGES =
  // [{ id, label, render(el) }]. Empty on /fleet; the preview adds "Rules".
  function extraPages() {
    var x = window.INVA_FLEET_EXTRA_PAGES;
    return Array.isArray(x) ? x.filter(function (p) { return p && /^[a-z][a-z0-9]*$/.test(p.id || '') && typeof p.render === 'function'; }) : [];
  }
  function navItems() {
    var items = isFleetAdmin() ? NAV.concat([['admin', 'Admin']]) : NAV;
    var extra = extraPages();
    return extra.length ? items.concat(extra.map(function (p) { return [p.id, p.label]; })) : items;
  }
  /** Shows the extra pages' own `fh-screen` (made on first use) and paints the open one. */
  function syncExtraScreens() {
    var extra = extraPages();
    if (!extra.length) return;
    var anchor = $('fhScreenAdmin');
    extra.forEach(function (p) {
      var el = $('fhScreen' + p.id.charAt(0).toUpperCase() + p.id.slice(1));
      if (!el && anchor && anchor.parentNode) {
        el = document.createElement('div');
        el.className = 'fh-screen';
        el.id = 'fhScreen' + p.id.charAt(0).toUpperCase() + p.id.slice(1);
        el.hidden = true;
        anchor.parentNode.insertBefore(el, anchor.nextSibling);
      }
      if (!el) return;
      el.hidden = ui.page !== p.id;
      if (ui.page === p.id && !el._fhPainted) { el._fhPainted = true; p.render(el); }
    });
  }

  function renderNav() {
    var onPage = function (id) {
      // History is reached from a tail's card and has no destination of its
      // own, so it keeps Fleet lit rather than lighting nothing at all.
      return ui.page === id || (id === 'fleet' && ui.page === 'history');
    };
    var nav = $('fhNav');
    var html = navItems().map(function (n) {
      var on = onPage(n[0]);
      return '<button class="fh-navlink' + (on ? ' on' : '') + '" type="button" data-page="' + n[0] + '"' +
        (on ? ' aria-current="page"' : '') + '>' + n[1] + '</button>';
    }).join('');
    // Rebuilt only when it changed: the 90 s poll re-renders everything, and
    // swapping identical tabs would drop hover and focus for nothing.
    // eslint-disable-next-line no-unsanitized/property -- safe: markup built by this module (data escaped where built) or an internal enum/constant
    if (nav && nav._fhHtml !== html) { nav.innerHTML = html; nav._fhHtml = html; }
    positionTabInk();
  }

  // ── the tab rail's behaviour (presentation only) ──────────────────────
  // A 2px ink rule slides to the active tab, a soft pill follows the pointer,
  // the rail fades at the right edge while tabs are hidden past it, and the
  // mark slides into the rail once the header has scrolled away.
  function positionTabInk() {
    var scroll = $('fhTabScroll'), ink = $('fhTabInk');
    if (!scroll || !ink || !scroll.querySelector) return;
    var tab = scroll.querySelector('.fh-navlink.on');
    if (!tab || !tab.offsetWidth) { ink.style.width = '0px'; return; }
    ink.style.width = Math.max(0, tab.offsetWidth - 20) + 'px';
    ink.style.transform = 'translateX(' + (tab.offsetLeft + 10) + 'px)';
    var l = tab.offsetLeft, r = l + tab.offsetWidth;
    if (scroll.scrollTo && (l < scroll.scrollLeft || r > scroll.scrollLeft + scroll.clientWidth)) {
      scroll.scrollTo({ left: Math.max(0, l - 24), behavior: 'smooth' });
    }
    syncTabFade();
  }
  function syncTabFade() {
    var scroll = $('fhTabScroll');
    if (scroll && scroll.classList) {
      scroll.classList.toggle('has-more', scroll.scrollLeft + scroll.clientWidth < scroll.scrollWidth - 4);
    }
  }
  var tabRailBound = false;
  function bindTabRail() {
    var scroll = $('fhTabScroll'), hover = $('fhTabHover'), rail = $('fhTabrail'), top = $('fhTop');
    if (tabRailBound || !scroll) return;
    tabRailBound = true;
    scroll.addEventListener('pointerover', function (e) {
      var t = e.target && e.target.closest ? e.target.closest('.fh-navlink') : null;
      if (!t || !hover || e.pointerType === 'touch') return;
      hover.style.width = t.offsetWidth + 'px';
      hover.style.transform = 'translateX(' + t.offsetLeft + 'px)';
      hover.style.opacity = '1';
    });
    scroll.addEventListener('pointerleave', function () { if (hover) hover.style.opacity = '0'; });
    scroll.addEventListener('scroll', syncTabFade, { passive: true });
    window.addEventListener('resize', positionTabInk);
    if (top && rail && rail.classList && typeof IntersectionObserver !== 'undefined') {
      new IntersectionObserver(function (entries) {
        rail.classList.toggle('is-stuck', !entries[0].isIntersecting);
      }).observe(top);
    }
    // Tab widths are only right once Geist has loaded.
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(positionTabInk);
  }

  // ── header: the IST clock, and the theme control in the account menu ──
  var clockTimer = null;
  function tickClock() {
    // The Flight bag's "checked 8 s ago" / "next try in 30 s" rides this tick.
    paintBagLive();
    var el = $('fhClock');
    if (!el) return;
    var now = Date.now();
    el.textContent = fmtShort(now) + ' · ' + ist(now) + ' IST';
  }
  function syncThemeButtons() {
    var cur = window.INVAFleetTheme && window.INVAFleetTheme.get ? window.INVAFleetTheme.get() : 'system';
    var btns = document.querySelectorAll ? document.querySelectorAll('[data-fhtheme]') : [];
    Array.prototype.forEach.call(btns, function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-fhtheme') === cur));
    });
  }
  /** Close the account menu — before anything that opens a layer above the
   *  page (the guide) or leaves it (sign out): an open popover sits in the
   *  top layer, over everything. */
  function closeMenu() {
    var m = $('fhMeMenu');
    if (!m) return;
    try { if (m.hidePopover && m.matches(':popover-open')) m.hidePopover(); } catch (e) { /* no Popover API */ }
    if (m.classList) m.classList.remove('fh-menu-fallback-open');
    syncMenuExpanded(false);
  }

  /** The one status line over a cached board (#fhBoardStatus, fixed — no layout
   *  shift). The time is the snapshot's own; a different IST day adds the date
   *  the way the header clock does. Hidden once the real read lands. */
  function paintBoardStatus() {
    var el = $('fhBoardStatus');
    if (!el) return;
    if (!data.preview) { el.hidden = true; return; }
    var t = data.syncedAt;
    var when = ist(t) + ' IST';
    if (isFinite(t) && t > 0 && dayDelta(t) !== 0) when = fmtShort(t) + ' · ' + when;
    el.textContent = 'Board from ' + when + ' · ' + (data.error ? 'could not refresh' : 'refreshing…');
    el.hidden = false;
  }

  /** Name, initials, tab rail, theme buttons and the clock — what show() and
   *  preview() both need before anything can paint. */
  function openHomeShell() {
    homeView = homeView || $('homeView');
    homeView.hidden = false;
    var auth = window.INVA_FLEET.getAuth();
    var name = (auth && auth.profile && auth.profile.displayName) || 'Pilot';
    $('fhMeName').textContent = name;
    // The header's left side is the pilot (a plain label); the menu is on
    // the server icon at the right (.fh-mebtn).
    var who = $('fhWhoName');
    if (who) who.textContent = name;
    $('fhMeInitials').textContent = name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || 'IF';
    bindTabRail();
    syncThemeButtons();
    tickClock();
    if (!clockTimer) clockTimer = setInterval(tickClock, 15000);
  }

  /** Apply a fleet json to `data.*` — shared by onFleet and preview() so the
   *  two cannot drift. */
  function applyFleetJson(json) {
    data.aircraft = json.aircraft || [];
    data.bidOnlyTails = json.bidOnlyTails || [];
    data.flex = json.flex || null;
    // Which tails the live session feed has airborne, keyed by aircraft id,
    // plus whether we got a feed at all — absence only proves "not flying"
    // when there was something to be absent from.
    data.live = {};
    (json.live || []).forEach(function (l) { if (l && l.aircraftId) data.live[l.aircraftId] = l; });
    data.liveSession = !!json.liveSession;
    data.org = json.org || data.org;
    data.syncedAt = Date.parse(json.serverTimeUtc) || Date.now();
    data.airports = window.INVA_FLEET.getAirports() || {};
    data.error = null;
    data.loaded = true;
    didFit = false;
  }

  function render() {
    if (!homeView || homeView.hidden) return;
    // A session that lost staff access (or a non-staff sign-in on the same
    // tab) must not be left on a screen it can no longer reach.
    if (ui.page === 'admin' && !isFleetAdmin()) ui.page = 'fleet';
    renderNav();
    ['fleet', 'board', 'schedules', 'bag', 'airline', 'activity', 'history', 'admin'].forEach(function (p) {
      $('fhScreen' + p.charAt(0).toUpperCase() + p.slice(1)).hidden = ui.page !== p;
    });
    syncExtraScreens();
    // The bounty chips on Fleet and Schedules: one read per session (none when
    // the switch is off beyond a single config doc). My activity paints from
    // memory; it fetched when it opened.
    if ((ui.page === 'fleet' || ui.page === 'schedules') && myIdentity()) fetchBounties(false);
    if (ui.page === 'activity' && window.INVA_FLEET_ACTIVITY) window.INVA_FLEET_ACTIVITY.paint(actCtx());
    // The Admin screen works from the same fleet read, and its request queue
    // needs no fleet at all, so it renders before the early returns below.
    if (ui.page === 'admin') window.INVA_FLEET_ADMIN.render(data);

    if (data.error) {
      $('fhError').textContent = data.error;
      $('fhError').hidden = false;
    } else {
      $('fhError').hidden = true;
    }
    paintBoardStatus();
    if (!data.loaded) return;

    var all = model();
    // Drop remembered requests whose leg has since resolved, before anything
    // draws off them. Here rather than on the fetch because `model()` is what
    // turns the raw read into legs, and this must see exactly what the board
    // sees — a prune against a different shape is a button that disagrees with
    // the row beside it.
    pruneCrewPending(all);
    if (!all.length) {
      $('fhFleetSub').textContent = 'No aircraft in the INVA fleet yet.';
      if (ui.page === 'bag') renderBag(all);
      return;
    }
    if (!ui.sel || !all.some(function (a) { return a.id === ui.sel; })) {
      var first = all.find(function (a) { return !a.stored; }) || all[0];
      ui.sel = first.id;
    }

    if (ui.page === 'fleet') {
      renderFleet(all);
      bootMap();
      syncMarkers();
      // Coming back from another screen, the canvas was sized while hidden.
      if (map) setTimeout(function () { map.resize(); }, 0);
    }
    else if (ui.page === 'board') renderBoard(all);
    else if (ui.page === 'schedules') { syncSchedControls(); renderSchedules(all); }
    else if (ui.page === 'bag') renderBag(all);
    else if (ui.page === 'airline') renderAirline(all);
    else if (ui.page === 'history') renderHistory(all);

    // The dialog holds live figures (time and distance to run), so it has to
    // move with the data rather than freeze on open.
    if (fm.tail) renderFlightModal();
    if (bellTip) placeBellTip();
  }

  /** One delegated listener for the whole home — every list is re-rendered
   *  wholesale, so per-node handlers would have to be re-bound each pass. */
  function onClick(e) {
    homeView = homeView || $('homeView');
    if (!homeView || homeView.hidden || !e.target || !e.target.closest) return;
    var t = e.target.closest('[data-page],[data-filter],[data-schfilter],[data-tail],' +
      '[data-flight],[data-fhclose],[data-fmmap],[data-fmhist],[data-fmdispatch],' +
      '[data-bagdispatch],[data-bagbrief],[data-bagpass],[data-bagprint],[data-bagtear],[data-bagofp],' +
      '[data-crewreq],[data-fmcrewreq],[data-fmunassign],[data-cfok],[data-cfcancel],[data-schgroup],#fhSchExpand,' +
      '[data-legalert],[data-actcs],[data-actme],[data-actmore],[data-actretry],[data-actlegs],' +
      '[data-fhtheme],[data-fhsheetclose],' +
      '#fhFitFleet,#fhAllSchedules,#fhSelPrimary,#fhSelLocate,#fhSelHistory,#fhSelClose,' +
      // Every id with a branch below MUST be listed here — this closest() is
      // the gate, and an id missing from it can never reach its handler. That
      // is exactly how #fhGuide shipped dead: the branch was written, the
      // selector was not updated, and the button did nothing from day one.
      // tests/calc/fleetGuideSteps.test.js now pins the two lists together.
      '#fhHistBack,#fhHistSchedules,#fhSignOut,#fhReload,#fhGuide');
    if (!t || !homeView.contains(t) || t.disabled) return;

    var all = model();
    var sel = function () { return all.find(function (a) { return a.id === ui.sel; }); };
    var fmTail = function () { return all.find(function (a) { return a.id === fm.tail; }); };

    // The bell sits inside a row that opens the flight dialog, so it is
    // answered before anything that reads the row.
    if (t.dataset.legalert) { closeBellTip(); return toggleLegAlert(t.dataset.legalert, t.dataset.alertleg); }

    // ── My activity (assets/js/fleet-activity.js) ──
    if (t.dataset.actcs) return viewPilot(String(t.dataset.actcs));
    if (t.hasAttribute('data-actme')) return enterActivity(null);
    if (t.dataset.actmore) { if (window.INVA_FLEET_ACTIVITY) window.INVA_FLEET_ACTIVITY.loadMore(t.dataset.actmore); return; }
    if (t.hasAttribute('data-actretry')) { if (window.INVA_FLEET_ACTIVITY) window.INVA_FLEET_ACTIVITY.retry(); return; }
    if (t.dataset.actlegs) {
      // "View legs" on an open bounty: the Schedules board, narrowed to that tail.
      ui.schQuery = String(t.dataset.actlegs);
      ui.schFilter = 'ALL';
      return setPage('schedules');
    }

    // ── account menu: the theme control ──
    if (t.hasAttribute('data-fhtheme')) {
      if (window.INVAFleetTheme) window.INVAFleetTheme.set(t.getAttribute('data-fhtheme'));
      return;
    }
    // ── the tail sheet's scrim (below 1140px) ──
    if (t.hasAttribute('data-fhsheetclose')) return closeSheet();

    // ── the seat-taken prompt ──
    // Answered FIRST: it can sit on top of the flight dialog, and its own
    // backdrop must not be read as a click on whatever is behind it.
    if (t.hasAttribute('data-cfcancel')) return closeConfirm();
    if (t.hasAttribute('data-cfok')) {
      var cq = cfm;
      closeConfirm();
      // The seat rides on the prompt. It used to be hard-coded to First
      // Officer, which was true while both prompts were about the right-hand
      // seat — the backlog warning can be either seat.
      if (cq && cq.kind === 'leave') unassignSelf(cq.tailId, cq.legId);
      else if (cq) requestCrew(cq.tailId, cq.legId, cq.role);
      return;
    }

    // ── dialog ──
    if (t.hasAttribute('data-fhclose')) return closeFlight();
    if (t.hasAttribute('data-fmmap')) {
      var mt = fmTail();
      closeFlight();
      if (mt) { select(mt.id); setPage('fleet'); flyToTail(mt); }
      return;
    }
    if (t.hasAttribute('data-fmhist')) {
      var ht = fmTail();
      closeFlight();
      if (ht) { select(ht.id); setPage('history'); }
      return;
    }
    // SimBrief dispatch. The window MUST be opened here, synchronously, while
    // this handler is still on the gesture's call stack — everything else can
    // wait for a promise, that cannot (fleet-mode.js:284-294). Re-resolve the
    // leg the way data-fmcrewreq below does rather than trusting fm.leg.
    //
    // ONE branch for both Dispatch buttons — the flight dialog's
    // (data-fmdispatch) and the Flight bag's (data-bagdispatch, which names its
    // own tail and leg). Two copies of the popup claim is how one of them
    // would eventually drift to claiming it late. The only difference is where
    // the OFP viewer's Back should land (`dret`).
    if (t.hasAttribute('data-fmdispatch') || t.hasAttribute('data-bagdispatch')) {
      var dt, ds, dret = '';
      if (t.hasAttribute('data-bagdispatch')) {
        dt = all.find(function (a) { return a.id === t.getAttribute('data-bagdispatch'); });
        ds = dt && dt.sch.find(function (x) { return x.id === t.dataset.bagleg; });
        dret = 'bag';
      } else {
        dt = fmTail();
        ds = dt && ((fm.leg && dt.sch.find(function (x) { return x.id === fm.leg; })) || dt.active || dt.next);
      }
      if (!dt || !ds) return;
      // The button only renders for a leg I am crewed on, but the crew can
      // change between that render and this click.
      if (!canDispatch(ds)) return;
      if (dispatchBusy) return;
      var dpop = window.prepareSBworkerPlaceholder();
      if (!dpop) {
        // Blocked. Turn the button into an explicit second tap rather than
        // telling the pilot to go and find their popup settings — on iOS the
        // blocker is usually not the cause, a missing gesture is.
        dispatchGesture = ds.id;
        render();
        toastFollow('Tap once more to open SimBrief.');
        return;
      }
      dispatchLeg(dt, ds, dpop, dret);
      return;
    }
    // ── Flight bag ──
    if (t.hasAttribute('data-bagbrief')) {
      window.INVA_FLEET_BAG.toggleBrief(t.getAttribute('data-bagbrief'));
      loadBagProfile();
      render();
      return;
    }
    if (t.hasAttribute('data-bagpass')) {
      window.INVA_FLEET_BAG.toggleBoardingPass(t.getAttribute('data-bagpass'));
      render();
      return;
    }
    // The printer repaints itself in place; nothing re-renders.
    if (t.hasAttribute('data-bagprint')) {
      window.INVA_FLEET_BAG.occPrint(t, t.getAttribute('data-bagprint'));
      return;
    }
    if (t.hasAttribute('data-bagtear')) {
      window.INVA_FLEET_BAG.occTear(t);
      return;
    }
    if (t.hasAttribute('data-bagofp')) {
      var ol = null;
      var ot = all.find(function (a) {
        ol = a.sch.find(function (x) { return x.id === t.getAttribute('data-bagofp'); });
        return !!ol;
      });
      if (ot && ol) viewOfp(ot, ol);
      return;
    }
    // Requesting a leg from inside the dialog, where the role is chosen. The
    // dialog can be open on a leg it resolved itself (fm.leg is null when it
    // fell back to the active/next leg), so re-resolve exactly as
    // renderFlightModal does rather than trusting fm.leg.
    // Leaving a leg from the dialog: re-resolve the leg like data-fmcrewreq.
    if (t.hasAttribute('data-fmunassign')) {
      var ut = fmTail();
      var us = ut && ((fm.leg && ut.sch.find(function (x) { return x.id === fm.leg; })) || ut.active || ut.next);
      if (!us || !canUnassign(us)) return;
      return askUnassign(ut, us);
    }
    if (t.hasAttribute('data-fmcrewreq')) {
      var ct = fmTail();
      if (!ct) return;
      var cs = (fm.leg && ct.sch.find(function (x) { return x.id === fm.leg; })) || ct.active || ct.next;
      if (!cs) return;
      var why = crewBlockReason(cs);
      if (why) { toastFollow(why); return; }
      // Captain goes through the seat check. First Officer needs no prompt
      // about the SEAT — it was an explicit choice — but it does need the
      // coordination check whenever there is somebody to have coordinated with.
      if (Number(t.dataset.fmcrewreq) === 0) return requestAsCaptain(ct, cs);
      var cfx = flexCoPilot(cs);
      if (cfx && cfx.open) return requestCrew(ct.id, cs.id, 1);
      var fcap = captainOn(cs.crew);
      if (fcap) return askCoPilotCoordinated(ct.id, cs, fcap.username, ct.reg);
      requestOrWarn(ct.id, cs, ct.reg, 1);
      return;
    }
    // The board's one-click path. Takes the seat that is free — see the row's
    // label — so it never has to stop and ask. The dialog is where a seat can
    // be chosen deliberately.
    if (t.dataset.crewreq) {
      var rt = all.find(function (a) { return a.id === t.dataset.crewreq; });
      var rs = rt && rt.sch.find(function (x) { return x.id === t.dataset.crewleg; });
      if (!rs) return;
      var rwhy = crewBlockReason(rs);
      if (rwhy) { toastFollow(rwhy); return; }
      requestFreeSeat(rt, rs);
      return;
    }
    // A tail block on the Schedules board: expand or collapse it, and select
    // it while we are here so the map and rail agree with what is open. Its
    // own attribute rather than data-tail, which three OTHER lists use and
    // which must keep meaning "just select this".
    if (t.dataset.schgroup) {
      var gid = t.dataset.schgroup;
      if (ui.schOpen.has(gid)) ui.schOpen.delete(gid);
      else ui.schOpen.add(gid);
      select(gid);
      return;
    }
    if (t.id === 'fhSchExpand') {
      var open = model().filter(function (a) {
        return a.sch.some(isOpenLeg);
      });
      var everyOpen = open.length > 0 && open.every(function (a) { return ui.schOpen.has(a.id); });
      if (everyOpen) ui.schOpen.clear();
      else open.forEach(function (a) { ui.schOpen.add(a.id); });
      render();
      return;
    }
    if (t.dataset.flight) return openFlight(t.dataset.flight, t.dataset.leg);

    if (t.dataset.page) return setPage(t.dataset.page);
    if (t.dataset.filter) { ui.filter = t.dataset.filter; didFit = false; render(); return; }
    if (t.dataset.schfilter) { ui.schFilter = t.dataset.schfilter; render(); return; }
    if (t.id === 'fhFitFleet') return fitFleet(all);
    if (t.id === 'fhAllSchedules') return setPage('schedules');
    if (t.id === 'fhReload') return reload();
    if (t.id === 'fhGuide') {
      closeMenu();
      if (window.INVAFleetGuide) window.INVAFleetGuide.start();
      return;
    }
    if (t.id === 'fhSignOut') { closeMenu(); return window.INVA_FLEET.signOut(); }
    if (t.id === 'fhSelClose') return closeSheet();
    if (t.id === 'fhSelLocate') {
      // From the sheet the map is behind it: close, bring the map into view,
      // then fly to the tail.
      if (sheet.open) {
        closeSheet(false);
        var mapBlk = document.querySelector('.fh-a-map');
        if (mapBlk && mapBlk.scrollIntoView) mapBlk.scrollIntoView({ block: 'start' });
      }
      return flyToTail(sel());
    }
    if (t.id === 'fhSelHistory') return setPage('history');
    if (t.id === 'fhHistBack') return setPage('fleet');
    // The rail CTA and the History button both mean "show me this tail's
    // queue": keep it selected so its group is highlighted on the board.
    if (t.id === 'fhSelPrimary' || t.id === 'fhHistSchedules') {
      var a = sel();
      // Arriving with a tail in mind, so open it — landing on a collapsed
      // block would answer "show me this aircraft's legs" with a closed row.
      if (a) { select(a.id); ui.schOpen.add(a.id); }
      return setPage('schedules');
    }
    if (t.dataset.tail) {
      select(t.dataset.tail);
      var picked = all.find(function (a) { return a.id === t.dataset.tail; });
      // Below 1140px the tail's details open as a full-screen sheet; beside the
      // content (>= 1140px) the rail is already showing, so fly the map instead.
      if (ui.page === 'fleet' && picked) {
        if (isSheetMode()) openSheet(picked.id, true);
        else flyToTail(picked);
      }
    }
  }

  function reload() {
    $('fhError').hidden = true;
    var btn = $('fhReload');
    if (btn) btn.disabled = true;
    // Through the one door, so a Reload pressed while the Flight bag's own read
    // is out shares it instead of starting a second 1 + 2N-call fan-out.
    fleetReloadOnce().catch(function () {}).then(function () {
      if (btn) btn.disabled = false;
    });
  }

  // ── onboarding ──────────────────────────────────────────────────────────
  // Deferred until the first fleet read has rendered: the guide spotlights
  // real elements, and pointing at an empty stats row or a map with no tails
  // on it would teach nothing. Once per page load, whatever the guide decides.
  var guideChecked = false;
  function maybeGuide() {
    if (guideChecked || !data.loaded || data.preview || !window.INVAFleetGuide) return;
    if (!homeView || homeView.hidden) return;
    guideChecked = true;
    Promise.resolve(window.INVAFleetGuide.maybeAutoStart()).catch(function () {});
  }

  // ── public surface (fleet-mode.js drives these) ─────────────────────────
  window.INVA_FLEET_HOME = {
    /**
     * A cached paint (fleet-mode.js boot, last-known board): a PREVIEW, not a
     * read. It shows the board and labels it; it does not touch fleetJson or
     * fleetFullLoadAt, start no session work (leg alerts, bag chain, guide,
     * Fleet Admin, pending dispatch) and never causes a fleet read —
     * show() and the real onFleet do all of that, as before.
     */
    preview: function (json) {
      if (!json || !Array.isArray(json.aircraft)) return;
      openHomeShell();
      applyFleetJson(json);
      data.preview = true;
      render();
      if (map) { drawAirports(); syncMarkers(); }
    },
    show: function () {
      openHomeShell();
      loadLegAlerts();
      // Back from the OFP viewer after a dispatch that started in the Flight
      // bag: land on it again (read once at load — see returnPage).
      if (returnPage === 'bag') {
        returnPage = '';
        ui.page = 'bag';
      }
      render();
      // On the bag (landed back on it, or signed in again while it was up):
      // start the check chain, as a tab click would.
      if (ui.page === 'bag') enterBag();
      maybeGuide();
      if (window.INVA_FLEET_ADMIN) window.INVA_FLEET_ADMIN.init();
      // Sizes are wrong if the map was built while the section was hidden.
      if (map) setTimeout(function () { map.resize(); }, 0);
    },
    /** Which home screen is up — the guide skips steps for other screens. */
    page: function () { return ui.page; },
    /** Re-render after something outside the home changed what it shows
     *  (the admin module learning this session is staff). */
    rerender: function () { render(); },
    /** Switch screens so the guide's next anchor is actually in the DOM. */
    goto: function (page) { if (page && page !== ui.page) setPage(page); },
    // Only sign-out reaches this now that there is no booking flow to hand the
    // page over to; kept because fleet-mode.js calls it on signOut().
    hide: function () {
      homeView = homeView || $('homeView');
      if (homeView) homeView.hidden = true;
      if (data.preview) {
        // A cached board must not outlive its sign-in: the next pilot on this
        // browser starts from skeletons.
        data.preview = false;
        data.aircraft = []; data.live = {}; data.liveSession = false;
        data.flex = null; data.bidOnlyTails = []; data.syncedAt = null; data.loaded = false;
      }
      paintBoardStatus();
      closeMenu();
      bagStop();
      bag.fresh = {};
      if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
      if (window.INVA_FLEET_ADMIN) window.INVA_FLEET_ADMIN.reset();
      // Nothing learned for this pilot applies to the next one on this browser.
      if (window.INVA_FLEET_ACTIVITY) window.INVA_FLEET_ACTIVITY.reset();
      bty.at = 0; bty.enabled = false; bty.items = []; bty.byReg = {};
    },
    onFleet: function (json) {
      // A NEW object is a full load; the SAME object back is a single-tail
      // patch (INVA_FLEET.reloadTail mutates and re-sends it). Only a full load
      // makes the board current, so only it moves the clock the Flight bag's
      // safety net and first-answer window are measured from.
      if (json !== fleetJson) { fleetJson = json; fleetFullLoadAt = Date.now(); }
      applyFleetJson(json);
      data.preview = false;
      render();
      if (map) { drawAirports(); syncMarkers(); }
      maybeGuide();
      // Last: the only point that is guaranteed to be after BOTH sign-in and a
      // fleet read, which a link to a specific leg needs.
      consumePendingDispatch();
    },
    onFleetError: function (err) {
      data.error = (err && err.message) || 'The INVA fleet could not be loaded.';
      render();
    },
    /**
     * Everything the board reasoned from, next to what it concluded — one
     * row per tail, ready to paste back.
     *
     * Four fixes to aircraft state were wrong in a row because each was
     * inferred from what the page RENDERED rather than from what it was
     * given. The raw read settled it every time, so this stops being an
     * ad-hoc console expression and becomes part of the page:
     *
     *   copy(JSON.stringify(INVA_FLEET_HOME.debug(), null, 1))
     *
     * `state` is the field the whole question turns on — the documented
     * AircraftPersistenceState, straight off /live/aircraft/{id}/position,
     * unprocessed. `shows` is what we put on screen. When those two disagree
     * the answer is in this table and nowhere else.
     */
    debug: function () {
      var all = model();
      return {
        at: new Date().toISOString(),
        liveSession: data.liveSession,
        liveCount: Object.keys(data.live || {}).length,
        tails: (data.aircraft || []).map(function (a) {
          var p = a.position || null;
          var m = all.find(function (x) { return x.id === a.id; }) || {};
          var lf = (data.live || {})[a.id] || null;
          return {
            reg: a.registration,
            state: p ? p.state : null,          // ← AircraftPersistenceState, raw
            isOnGround: p ? p.isOnGround : null,
            alt: p ? Math.round(Number(p.altitude)) : null,
            spd: p ? Math.round(Number(p.speed) * 100) / 100 : null,
            lat: p ? Number(p.latitude) : null,
            lon: p ? Number(p.longitude) : null,
            updatedAt: p ? p.updatedAt : null,
            nearest: a.airport ? a.airport.icao : null,
            at: m.at || null,                    // where the board puts it (derived from its open leg when no position)
            inFeed: !!lf,
            feedAlt: lf ? Math.round(lf.altitude) : null,
            feedSpd: lf ? Math.round(lf.speed) : null,
            legs: (a.schedules || []).map(function (s) {
              return s.callsign + ' ' + s.originIcao + '>' + s.destinationIcao +
                ' ss=' + s.status + ' dep=' + s.scheduledDepartureUtc;
            }),
            phases: (m.sch || []).map(function (s) { return s.cs + ':' + (s.phase || '-'); }),
            shows: m.meta ? m.meta[0] : null,   // ← what the board concluded
            st: m.st,
            ready: !!m.readyToFly,               // counted in "Ready to fly"?
          };
        }),
      };
    },
    // Pure rules the board depends on, exposed so tests can pin them without
    // standing up the whole screen. Not part of the page's own API.
    _rules: {
      legIndexOrder: legIndexOrder,
      legIsAirborne: legIsAirborne,
      legPhase: legPhase,
      posIsMoving: posIsMoving,
      STOPPED_TO_GROUND_MIN: STOPPED_TO_GROUND_MIN,
      nmBetween: nmBetween,
      isFlyingFix: isFlyingFix,
      liveEteMs: liveEteMs,
      effectiveArrival: effectiveArrival,
      approxBlockMs: approxBlockMs,
      CRUISE_KT: CRUISE_KT,
      BLOCK_ALLOWANCE_MS: BLOCK_ALLOWANCE_MS,
      MIN_GROUND_SPEED_KT: MIN_GROUND_SPEED_KT,
      MIN_ALTITUDE_FT: MIN_ALTITUDE_FT,
      crewSeats: crewSeats,
      typeCode: typeCode,
      family: family,
      relTime: relTime,
      coarse: coarse,
      ago: ago,
      crewOn: crewOn,
      crewLabel: crewLabel,
      myCrewIn: myCrewIn,
      myOpenLegs: myOpenLegs,
      legsToWarnAbout: legsToWarnAbout,
      busyWarning: busyWarning,
      captainOn: captainOn,
      crewBlockReason: crewBlockReason,
      flexCoPilot: flexCoPilot,
      wantsBellTip: wantsBellTip,
      CREW_CAP: CREW_CAP,
      legUnassigned: legUnassigned,
      schedBand: schedBand,
      tailOrder: tailOrder,
      legDayLabel: legDayLabel,
      isOpenLeg: isOpenLeg,
      matchesQuery: matchesQuery,
      schedHaystack: schedHaystack,
      sortGroups: sortGroups,
      SCHED_SORTS: SCHED_SORTS,
      STALE_AIRBORNE_MS: STALE_AIRBORNE_MS,
      parseDispatchParam: parseDispatchParam,
      canDispatch: canDispatch,
    },
  };

  document.addEventListener('click', onClick);
  // The tip is fixed; the bell scrolls. Capture catches the inner scrollers too.
  if (window.addEventListener) {
    window.addEventListener('scroll', function () { if (bellTip) placeBellTip(); }, { passive: true, capture: true });
    window.addEventListener('resize', function () { if (bellTip) placeBellTip(); });
  }

  // The Flight bag's check chain sleeps with the browser tab and wakes with it:
  // coming back to the bag checks AT ONCE (and treats the board as just opened,
  // so one that went stale in the background is re-read), rather than after
  // whatever is left of a 15 s — or backed-off — wait.
  document.addEventListener('visibilitychange', function () {
    if (ui.page !== 'bag') return;
    if (document.hidden) { bagStop(); return; }
    if (bagWanted()) {
      bag.entering = true;
      bagSchedule(0);
    }
  });

  // The theme changed (account menu, or the OS while on System): the theme
  // buttons and the map tiles follow. Everything else is CSS tokens.
  document.addEventListener('fh:theme', function () {
    syncThemeButtons();
    if (map) map.setStyle(mapStyle());
  });

  // The search box and sort picker are the only controls on this page that are
  // not clicks, so they need their own delegated listeners. Both re-render in
  // place: the inputs live in the static markup, outside #fhSchTable, so the
  // caret survives.
  document.addEventListener('input', function (e) {
    // The departure runway is only remembered here, never re-rendered: a
    // keystroke must not rebuild the box it is typed into. buildFormData()
    // normalises and checks it at dispatch. (`box`, not `t`: this is an input
    // event, not one of onClick's gated branches.)
    var box = e.target;
    if (box && box.hasAttribute && box.hasAttribute('data-dprwy')) {
      dispatchRwy[box.getAttribute('data-dprwy')] = String(box.value || '').trim().toUpperCase();
      return;
    }
    var t = e.target;
    if (!t || t.id !== 'fhSchSearch') return;
    ui.schQuery = String(t.value || '').trim();
    render();
  });
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (!t || t.id !== 'fhSchSort') return;
    ui.schSort = t.value;
    render();
  });
  document.addEventListener('keydown', function (e) {
    // Esc closes the TOPMOST dialog only: the seat-taken prompt sits above the
    // flight dialog, so cancel it first (same as data-cfcancel).
    var cfEl = $('fhCrewConfirm');
    if (e.key === 'Escape' && cfEl && !cfEl.hidden) return closeConfirm();
    if (e.key === 'Escape' && fm.tail) return closeFlight();
    // Then the tail sheet — topmost first: prompt, flight dialog, sheet.
    if (e.key === 'Escape' && sheet.open) return closeSheet();
    if (e.key === 'Tab' && sheet.open) trapSheetTab(e);
    // Escape clears a search rather than doing nothing, which is what every
    // other search box on the internet does.
    if (e.key === 'Escape' && e.target && e.target.id === 'fhSchSearch' && ui.schQuery) {
      e.target.value = '';
      ui.schQuery = '';
      render();
    }
  });
  // Account menu: opened by the Indian Virtual server icon at the right of the
  // header (#fhMeMenu + .fh-mebtn popovertarget). The icon's aria-expanded
  // follows the menu either way.
  function syncMenuExpanded(open) {
    var btn = document.querySelector ? document.querySelector('.fh-mebtn') : null;
    if (btn) btn.setAttribute('aria-expanded', String(!!open));
  }
  var meMenu = $('fhMeMenu');
  if (meMenu && meMenu.addEventListener) {
    meMenu.addEventListener('toggle', function (e) { syncMenuExpanded(e.newState === 'open'); });
  }
  // Fallback: browsers without the Popover API (iOS Safari < 17) would leave
  // Refresh / Guide / Sign out unreachable, so toggle a class instead.
  // UI-only: the menu buttons still reach onClick through the delegation above.
  if (typeof HTMLElement !== 'undefined' && !('popover' in HTMLElement.prototype)) {
    document.addEventListener('click', function (e) {
      var menu = $('fhMeMenu');
      if (!menu) return;
      var btn = e.target && e.target.closest ? e.target.closest('.fh-mebtn') : null;
      if (btn) menu.classList.toggle('fh-menu-fallback-open');
      else menu.classList.remove('fh-menu-fallback-open');
      syncMenuExpanded(menu.classList.contains('fh-menu-fallback-open'));
    });
    document.addEventListener('keydown', function (e) {
      var menu = $('fhMeMenu');
      if (e.key === 'Escape' && menu) { menu.classList.remove('fh-menu-fallback-open'); syncMenuExpanded(false); }
    });
  }
})();
