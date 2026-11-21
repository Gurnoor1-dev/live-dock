/* ══════════════════════════════════════════════════════════════════════════
   FLEET MODE — onboarding guide
   ─────────────────────────────────────────────────────────────────────────
   A first-run walkthrough of Fleet Mode as it actually behaves on this page:
   the live board, the tail rail, and the three-step booking flow.

   Two kinds of step:
     • "spot" — dims the page and cuts a hole around a REAL element, so the
       pilot is looking at their own fleet, not a screenshot of someone's.
     • "art"  — a self-contained illustration, used for the booking flow.
       Walking a live tour INTO the booking columns would mean selecting a
       real aircraft and risking a real hold, so booking is taught with
       mockups built from the same design tokens.

   Steps whose anchor is not on the page (an empty fleet, nothing airborne)
   are skipped rather than pointing at nothing.

   State lives in Redis, keyed to the IF user, so a pilot who did the tour on
   their phone is not walked through it again on their laptop. The browser
   mirrors that answer in localStorage once it has it, so the usual case —
   already seen — costs no round trip and never flashes the overlay while the
   network makes up its mind. Neither store failing may break the page.
   ═════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // Bump to re-run the tour for everyone after a material UI change. Both
  // stores compare against it, so a bump invalidates browser and server
  // copies together.
  // v2 — crew requests. The board gained a Request action and the tour a
  // chapter for it, so everyone who has already seen v1 gets the tour again.
  var VERSION = 2;
  var LS_KEY = 'invaFleetGuide';
  var API = '/api/fleetPilotGuide';

  var HOLE_PAD = 8;          // breathing room around a spotlit element
  var GAP = 16;              // spotlight → card
  var SCROLL_SETTLE_MS = 340; // smooth-scroll duration before we measure
  // Must match the @media width that docks the card in fleet-mode.html. Below
  // it the card owns a fixed strip along one edge and there is no "place the
  // card beside the element" to do — only "keep the element out from under it".
  var COMPACT_PX = 720;

  function isCompact() { return window.innerWidth <= COMPACT_PX; }

  /** Height of the screen the docked card occupies, in pixels.
   *  The stylesheet publishes it as `--fg-dock` (a percentage) so the two
   *  cannot disagree; the landscape rule sets it to 0 because there the card
   *  takes a side instead. Measured off the card itself when it is up, since
   *  a short card should not reserve a tall band. */
  function dockPx() {
    if (!root || !isCompact()) return 0;
    var pct = parseFloat(getComputedStyle(root).getPropertyValue('--fg-dock'));
    if (!isFinite(pct) || pct <= 0) return 0;
    var cap = window.innerHeight * (pct / 100);
    var actual = card ? card.offsetHeight : 0;
    return Math.min(cap, actual || cap) + 20;   // + the card's own bottom offset
  }

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return window.INVA_ESC.html(s);
  }

  // ── illustrations ────────────────────────────────────────────────────────
  // Drawn with the page's own tokens so they read as the same product rather
  // than as documentation art. Used where a live tour cannot go: the board is
  // grouped by tail, so "here is one aircraft's queue" needs a fixed example
  // rather than whatever the fleet happens to be doing at the time.

  /** One tail's block on the Schedules board: the group header, then two legs
   *  — one already taken, one still looking for a pilot. */
  function legArt() {
    return '<div class="fg-art fg-art-legs">' +
      '<div class="fg-leg-head">' +
        '<span class="fg-reg">VT-ANU</span>' +
        '<span class="fg-chip fg-chip-ok">On ground</span>' +
        '<span class="fg-leg-where">Mumbai (BOM)</span>' +
      '</div>' +
      '<div class="fg-leg on">' +
        '<span class="fg-leg-cs">AI 129</span>' +
        '<span class="fg-leg-rt">BOM → DXB</span>' +
        '<span class="fg-leg-tm">Today 04:15</span>' +
        '<span class="fg-leg-ft">Unassigned</span>' +
      '</div>' +
      '<div class="fg-leg">' +
        '<span class="fg-leg-cs">AI 131</span>' +
        '<span class="fg-leg-rt">BOM → LHR</span>' +
        '<span class="fg-leg-tm">Tomorrow 06:40</span>' +
        '<span class="fg-leg-ft">Assigned</span>' +
      '</div>' +
    '</div>';
  }

  /** The three stages of claiming a leg: ask, review, assigned. */
  function crewArt() {
    return '<div class="fg-art fg-art-crew">' +
      '<div class="fg-step-row">' +
        '<span class="fg-step-n">1</span>' +
        '<div class="fg-step-b"><div class="fg-step-t">You ask for the leg</div>' +
          '<div class="fg-step-s">Request on the row, or pick Captain / First Officer in the flight card.</div></div>' +
      '</div>' +
      '<div class="fg-step-row">' +
        '<span class="fg-step-n">2</span>' +
        '<div class="fg-step-b"><div class="fg-step-t">A coordinator reviews it</div>' +
          '<div class="fg-step-s">It lands in the ops channel on Discord with Approve and Decline.</div></div>' +
      '</div>' +
      '<div class="fg-step-row">' +
        '<span class="fg-step-n">3</span>' +
        '<div class="fg-step-b"><div class="fg-step-t">You are on the crew</div>' +
          '<div class="fg-step-s">Approval puts your name on the schedule in Infinite Flight, and you get a DM.</div></div>' +
      '</div>' +
    '</div>';
  }

  // ── the tour ─────────────────────────────────────────────────────────────
  // `target` is resolved at display time; a step whose target has gone is
  // skipped. `page` switches the home screen first so the anchor exists.
  var STEPS = [
    {
      id: 'welcome', kind: 'hero', chapter: 'Welcome',
      title: 'One fleet. Real tails.',
      body: '<p>INVA flies a <b>single shared fleet</b>. Every aircraft is a real tail with a real position — and it stays exactly where the last pilot left it.</p>' +
            '<p>So a 777 parked at Dubai can only fly <i>out of</i> Dubai. Fly it home and it is home. The fleet moves because you moved it.</p>',
      art: '<div class="fg-art fg-art-hero"><div class="fg-hero-line"></div>' +
           '<span class="fg-hero-a">VABB</span><span class="fg-hero-plane" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/></svg></span><span class="fg-hero-b">OMDB</span></div>',
    },
    {
      id: 'stats', kind: 'spot', chapter: 'The fleet', page: 'fleet', target: '#fhStats',
      title: 'The fleet at a glance',
      body: '<p>How many tails you have, how many are airborne right now, and how many are parked and ready to fly.</p>' +
            '<p>Each figure is also a filter: tap one and the map and the list below show just those tails.</p>',
    },
    {
      id: 'map', kind: 'spot', chapter: 'The fleet', page: 'fleet', target: '.fh-mapwrap',
      title: 'Where everything actually is',
      body: '<p>Live positions, straight from Infinite Flight. Filter by state with the figures above the map, or hit <b>Fit fleet</b> to frame every tail at once.</p>' +
            '<p>Click a tail to select it — its details show on the right, or open full screen on a phone.</p>',
      place: 'right',
    },
    {
      id: 'strip', kind: 'spot', chapter: 'The fleet', page: 'fleet', target: '#fhStripWrap',
      title: 'Active fleet',
      body: '<p>Every tail in service: what it is, where it is, and what it flies next. Tap one for everything about it.</p>',
      place: 'top',
    },
    {
      id: 'board', kind: 'spot', chapter: 'The fleet', page: 'board', target: '#fhSchedTable',
      title: 'The Board',
      body: '<p>The <b>Board</b> tab lists every flight in the air or stopped en route right now: when it left, when it lands, and how long it has to run — plus who is on it, by seat.</p>' +
            '<p>A dot on a time means it is <b>live</b>, worked out from the aircraft\'s own position. A plain time is the filed schedule, and <b>≈</b> marks an estimate.</p>',
      place: 'top',
    },
    {
      id: 'rail', kind: 'spot', chapter: 'The fleet', page: 'fleet', target: '#fhSelCard',
      title: 'The selected tail',
      body: '<p>Everything about one aircraft: where it is, who flew it last, and the buttons to show it on the <b>map</b>, open its <b>history</b>, or jump to its <b>schedules</b>.</p>',
      place: 'left',
    },
    {
      id: 'schedules', kind: 'spot', chapter: 'The fleet', page: 'schedules', target: '#fhSchTable',
      title: 'The full schedule board',
      body: '<p>Every scheduled leg on the fleet, filterable along the top. Click any row to open the flight — route, timings, live progress and the tail behind it.</p>',
      place: 'top',
    },
    {
      id: 'bytail', kind: 'spot', chapter: 'What each tail owes',
      page: 'schedules', target: '#fhSchTable',
      title: 'Grouped by aircraft',
      body: '<p>Every leg still on the books, under the tail that has to fly it. An aircraft can only depart from where it is, so its legs only make sense as a <b>queue</b>.</p>' +
            '<p>Tails in the air come first, then whichever has the soonest departure.</p>',
      place: 'top',
    },
    {
      id: 'legrow', kind: 'hero', chapter: 'What each tail owes',
      title: 'Reading a leg',
      body: '<p>Each row is one filed leg: the flight number, the day, the route, and its times in <b>IST</b>.</p>' +
            '<p><b>Assigned</b> means somebody has already taken it. <b>Unassigned</b> legs are the ones still looking for a pilot. <b>Stale</b> is a leg Infinite Flight never closed out — abandoned, not in progress.</p>' +
            '<p>Click any row to open the flight in full.</p>',
      art: legArt(),
    },
    {
      id: 'crewreq', kind: 'hero', chapter: 'What each tail owes',
      title: 'Claiming a leg',
      body: '<p>See an <b>Unassigned</b> leg you want? Hit <b>Request</b> on the row to put your hand up as Captain — or open the flight card to ask for <b>First Officer</b> instead.</p>' +
            '<p>It is a request, not a claim: a coordinator confirms it, and only then does your name go on the aircraft\'s schedule in Infinite Flight. A leg takes up to <b>three</b> crew.</p>' +
            '<p>Changed your mind? Ask an admin — taking someone off a leg is theirs to do.</p>',
      art: crewArt(),
    },
    {
      id: 'schedcta', kind: 'spot', chapter: 'What each tail owes', page: 'fleet',
      target: '#fhAllSchedules',
      title: 'The whole board',
      body: '<p>Here, or <b>Schedules</b> in the top nav. The selected tail\'s block is highlighted when you arrive.</p>',
      place: 'bottom',
    },
    {
      id: 'done', kind: 'hero', chapter: 'That\'s it', last: true,
      title: 'Go fly something',
      body: '<p>You know where the fleet is and what each tail still has to fly.</p>' +
            '<p>Need this again? It is <b>Guide</b> in the account menu, top right, any time.</p>',
    },
  ];

  // ── stored state ─────────────────────────────────────────────────────────
  function readLocal() {
    try {
      var raw = window.localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }        // private mode, quota, disabled — fine
  }
  function writeLocal(record) {
    try { window.localStorage.setItem(LS_KEY, JSON.stringify(record || {})); }
    catch (e) { /* the server copy is the one that matters */ }
  }
  /** Has this record already covered the current tour? */
  function covers(record) {
    return !!record && Number(record.v) >= VERSION;
  }

  function api(payload) {
    var fleet = window.INVA_FLEET;
    var auth = fleet && fleet.getAuth && fleet.getAuth();
    var identity = auth && auth.followIdentity;
    if (!identity) return Promise.resolve(null);     // older session: local only
    return fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ identity: identity }, payload)),
    }).then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });          // never blocks the page
  }

  // ── overlay ──────────────────────────────────────────────────────────────
  var root = null, hole = null, card = null;
  var idx = 0, open = false, order = [], placeTimer = 0;

  function build() {
    if (root) return;
    root = document.createElement('div');
    root.className = 'fg-root';
    root.id = 'fgRoot';
    root.hidden = true;
    root.innerHTML =
      '<div class="fg-hole" id="fgHole"></div>' +
      '<div class="fg-card" id="fgCard" role="dialog" aria-modal="true" aria-labelledby="fgTitle"></div>';
    document.body.appendChild(root);
    hole = $('fgHole');
    card = $('fgCard');

    root.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', schedulePlace);
    // The page scrolls under a spot step; the hole has to track it.
    window.addEventListener('scroll', schedulePlace, true);
  }

  function onKey(e) {
    if (!open) return;
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); go(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
  }

  function onClick(e) {
    var t = e.target.closest ? e.target.closest('[data-fg]') : null;
    if (!t) return;
    var act = t.getAttribute('data-fg');
    if (act === 'next') go(1);
    else if (act === 'back') go(-1);
    else if (act === 'skip') finish(false);
    else if (act === 'done') finish(true);
    else if (act === 'jump') show(Number(t.getAttribute('data-i')));
  }

  function resolve(step) {
    if (step.kind !== 'spot') return null;
    var el = document.querySelector(step.target);
    // An element with no box (hidden screen, empty list) is as good as absent.
    return el && el.getBoundingClientRect().width > 0 ? el : null;
  }

  /** Steps that can actually be shown right now, in order. */
  function buildOrder() {
    order = STEPS.filter(function (s) {
      if (s.kind !== 'spot') return true;
      // Its screen may not be rendered yet, so a missing target here is not
      // proof it is gone. Only drop targets on the screen we are already on.
      var home = window.INVA_FLEET_HOME;
      var page = home && home.page && home.page();
      if (s.page && page && s.page !== page) return true;
      // On the screen we are on, "there" means it has a box: the selected-tail
      // rail is display:none on a phone until its sheet is opened, and a
      // spotlight on an invisible element points at nothing.
      var el = document.querySelector(s.target);
      return !!el && el.getBoundingClientRect().width > 0;
    });
  }

  function go(delta) {
    var next = idx + delta;
    if (next < 0) return;
    if (next >= order.length) return finish(true);
    show(next);
  }

  function show(i) {
    idx = Math.max(0, Math.min(i, order.length - 1));
    var step = order[idx];

    // Put the right screen up before we look for the anchor.
    var home = window.INVA_FLEET_HOME;
    if (step.page && home && home.goto) home.goto(step.page);

    renderCard(step);

    var el = resolve(step);
    if (step.kind === 'spot' && !el) {
      // Its screen is up and the anchor still is not there — nothing to point
      // at, so drop it and keep moving in whichever direction we were going.
      order.splice(idx, 1);
      if (!order.length) return finish(true);
      return show(Math.min(idx, order.length - 1));
    }
    if (el) {
      // The free band is the viewport minus whatever the docked card owns.
      // Centring in the WHOLE viewport is what put the target dead behind the
      // card on a phone — the tour pointed at something you could not see.
      var dock = dockPx();
      var r = el.getBoundingClientRect();
      var top = 80, bottom = window.innerHeight - dock - 24;
      if (r.top < top || r.bottom > bottom) {
        if (dock) {
          // Sit it in the middle of the band that is actually visible. Also
          // brings horizontally-scrolled rows across, which the wide boards
          // need before they stop being tables at this width.
          var want = top + Math.max(0, (bottom - top - r.height) / 2);
          window.scrollBy({ top: r.top - want, behavior: 'smooth' });
          el.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
        } else {
          el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
        }
        clearTimeout(placeTimer);
        placeTimer = setTimeout(place, SCROLL_SETTLE_MS);
        return;
      }
    }
    place();
  }

  function schedulePlace() {
    if (!open) return;
    clearTimeout(placeTimer);
    placeTimer = setTimeout(place, 60);
  }

  /** Position the spotlight and the card for the current step. */
  function place() {
    if (!open) return;
    var step = order[idx];
    var el = resolve(step);
    var vw = window.innerWidth, vh = window.innerHeight;

    if (!el) {
      // Hero step: no cutout, card centred by CSS (see renderCard, which sets
      // .center up front so the entry animation is the right one from frame
      // zero rather than being swapped mid-flight).
      hole.classList.add('empty');
      hole.style.cssText = 'top:50%;left:50%;width:0;height:0;';
      card.style.top = '';
      card.style.left = '';
      return;
    }

    hole.classList.remove('empty');

    var pad = step.pad == null ? HOLE_PAD : step.pad;
    var r = el.getBoundingClientRect();
    var top = Math.max(4, r.top - pad);
    var left = Math.max(4, r.left - pad);
    var w = Math.min(vw - left - 4, r.width + pad * 2);
    var h = Math.min(vh - top - 4, r.height + pad * 2);
    hole.style.cssText = 'top:' + top + 'px;left:' + left + 'px;width:' + w + 'px;height:' + h + 'px;';

    // Docked: the card's position is the stylesheet's business, not ours, and
    // writing top/left here would fight the !important rules that dock it.
    // The cutout is already placed above; there is nothing else to do.
    if (dockPx()) return;

    var cw = card.offsetWidth, ch = card.offsetHeight;
    var want = step.place || 'auto';
    var below = vh - (top + h) - GAP, above = top - GAP;
    var right = vw - (left + w) - GAP, leftRoom = left - GAP;

    // Fall back through the sides that actually have room rather than
    // honouring a preference that would push the card off screen.
    var side = want;
    if (side === 'auto' || (side === 'bottom' && below < ch) || (side === 'top' && above < ch) ||
        (side === 'right' && right < cw) || (side === 'left' && leftRoom < cw)) {
      side = below >= ch ? 'bottom' : above >= ch ? 'top'
        : right >= cw ? 'right' : leftRoom >= cw ? 'left' : 'bottom';
    }

    var ct, cl;
    if (side === 'bottom') { ct = top + h + GAP; cl = r.left + r.width / 2 - cw / 2; }
    else if (side === 'top') { ct = top - GAP - ch; cl = r.left + r.width / 2 - cw / 2; }
    else if (side === 'right') { cl = left + w + GAP; ct = r.top + r.height / 2 - ch / 2; }
    else { cl = left - GAP - cw; ct = r.top + r.height / 2 - ch / 2; }

    card.style.top = Math.max(12, Math.min(ct, vh - ch - 12)) + 'px';
    card.style.left = Math.max(12, Math.min(cl, vw - cw - 12)) + 'px';
  }

  function renderCard(step) {
    var n = order.length;
    var dots = order.map(function (s, i) {
      return '<button class="fg-dot' + (i === idx ? ' on' : i < idx ? ' done' : '') +
        '" data-fg="jump" data-i="' + i + '" aria-label="Step ' + (i + 1) + ': ' + esc(s.title) + '"></button>';
    }).join('');

    var last = idx === n - 1;
    card.className = 'fg-card' + (step.kind === 'hero' ? ' hero center' : '');
    // eslint-disable-next-line no-unsanitized/property -- safe: markup built by this module (data escaped where built) or an internal enum/constant
    card.innerHTML =
      '<div class="fg-bar"><i style="width:' + Math.round(((idx + 1) / n) * 100) + '%"></i></div>' +
      '<div class="fg-body">' +
        '<div class="fg-eyebrow"><span class="fg-chapter">' + esc(step.chapter) + '</span>' +
          '<span class="fg-count">' + (idx + 1) + ' / ' + n + '</span></div>' +
        '<h2 class="fg-title" id="fgTitle">' + esc(step.title) + '</h2>' +
        '<div class="fg-text">' + step.body + '</div>' +
        (step.art || '') +
      '</div>' +
      '<div class="fg-foot">' +
        '<div class="fg-dots">' + dots + '</div>' +
        '<span class="fg-grow"></span>' +
        (idx > 0 ? '<button class="fg-btn-quiet" data-fg="back">Back</button>' : '') +
        (last
          ? '<button class="fg-btn-go" data-fg="done">Start flying</button>'
          : '<button class="fg-btn-go" data-fg="next">Next</button>') +
      '</div>' +
      (last ? '' : '<button class="fg-x" data-fg="skip" aria-label="Skip the guide">Skip</button>');
  }

  // ── lifecycle ────────────────────────────────────────────────────────────
  function start() {
    build();
    buildOrder();
    if (!order.length) return;
    open = true;
    idx = 0;
    root.hidden = false;
    show(0);
  }

  /** @param completed true when they read it through rather than skipping. */
  function finish(completed) {
    if (!open) return;
    open = false;
    clearTimeout(placeTimer);
    root.hidden = true;
    var record = { v: VERSION, done: !!completed, at: Date.now() };
    writeLocal(record);
    api({ action: 'seen', version: VERSION, completed: !!completed });
  }

  /**
   * Open the tour if this pilot has never been shown it.
   *
   * Order matters: the browser copy is checked first and, when it covers the
   * current version, we return without touching the network — that is the
   * every-visit path. Only a browser that does NOT know asks the server, and
   * a "yes" from the server is mirrored locally so the question is asked once
   * per device rather than once per load.
   */
  function maybeAutoStart() {
    if (open) return Promise.resolve(false);
    if (covers(readLocal())) return Promise.resolve(false);
    return api({ action: 'get' }).then(function (j) {
      if (j && covers(j.seen)) { writeLocal(j.seen); return false; }
      start();
      return true;
    });
  }

  /** Replay from the header button — ignores stored state on purpose. */
  function restart() { start(); }

  window.INVAFleetGuide = {
    start: restart,
    maybeAutoStart: maybeAutoStart,
    isOpen: function () { return open; },
    // Pure rules, exposed so tests can pin them without a DOM.
    _rules: { VERSION: VERSION, LS_KEY: LS_KEY, STEPS: STEPS, covers: covers },
  };
})();
