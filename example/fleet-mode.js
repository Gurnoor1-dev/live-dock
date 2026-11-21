/**
 * assets/js/fleet-mode.js — Fleet Mode (pilot), ISOLATED from career mode.
 *
 * Sign-in: Infinite Flight OAuth2 authorization-code + PKCE (v3 preview).
 * The browser builds the authorize URL (config from /api/fleetPilotAuthConfig),
 * opens the popup, and receives {code,state} from /if-oauth-callback.html over
 * the same three same-origin channels the admin connect uses (postMessage /
 * BroadcastChannel / localStorage — window.opener can be severed by COOP).
 * The code is exchanged SERVER-side (/api/fleetPilotAuthExchange — the client
 * secret never reaches the browser); the per-pilot token set comes back here
 * and is PERSISTED in localStorage, so a returning pilot lands on the board
 * instead of signing in again (see "auth storage" below).
 *
 * READS run in the BROWSER against api.infiniteflight.com on the pilot's own
 * token (fetchFleetDirect / fetchPositions), with /api/fleetPilotFleet as the
 * automatic fallback — that relay costs 1 + 2N upstream calls per load.
 *
 * THIS FILE NO LONGER WRITES ANYTHING (2026-08-23). The pick-a-tail →
 * pick-a-leg → confirm booking flow and the reposition modal were removed:
 * Fleet Mode is a read-only board over the schedules already filed on the
 * fleet, and assets/js/fleet-mode-home.js renders all of it. What is left here
 * is sign-in, the fleet read, and the INVA_FLEET bridge the home calls.
 *
 * The server side was deliberately left INTACT and dormant — /api/fleetPilotHold,
 * /api/fleetPilotLegs, /api/fleetPilotReposition and the Discord approval flow
 * all still work; they simply have no caller in the browser any more. Restoring
 * a booking UI means writing a new caller, not un-deleting a handler.
 */
(function () {
  'use strict';

  // Only the read + auth routes are called from the browser now. The write
  // routes still exist server-side (see the file header) — deliberately absent
  // here so a stray call cannot creep back in unnoticed.
  var API = {
    config: '/api/fleetPilotAuthConfig',
    exchange: '/api/fleetPilotAuthExchange',
    refresh: '/api/fleetPilotAuthRefresh',
    fleet: '/api/fleetPilotFleet',
    airports: '/api/fleetPilotAirports',
    flexState: '/api/fleetPilotFlexState',
  };

  var AUTH_KEY = 'fleetModeAuth';     // localStorage — per-pilot IF token set
  var STATE_KEY = 'fmOAuthState';
  var VERIFIER_KEY = 'fmOAuthVerifier';
  // localStorage — { at, publicApiBase, bidOnlyTails } from /api/fleetPilotAuthConfig,
  // so a new tab knows the direct-read base at once instead of waiting on the call.
  // Replaces the old sessionStorage `fmPublicApiBase` (not read any more).
  var CONFIG_KEY = 'fmConfig';
  // localStorage — { at, airports, nearest }: airport reference data never changes
  // between deploys, so most loads make no /api/fleetPilotAirports call at all.
  var AIRPORTS_KEY = 'fmAirports';
  // localStorage — { v, user, org, at, list }: the org's Active aircraft list,
  // same owner as fmBoard, at most AIRCRAFT_LIST_MAX_AGE_MS old (IF reference-data
  // rule). A board load then costs only the open-schedules call(s).
  var AIRCRAFT_KEY = 'fmAircraftList';
  var AIRCRAFT_LIST_MAX_AGE_MS = 60 * 60 * 1000;
  var AIRPORTS_TTL_MS = 7 * 24 * 3600 * 1000;
  var AIRPORTS_MAX = 600;
  var NEAREST_MAX = 300;
  var FLEX_PREFETCH_MS = 30000;      // a boot-time Flex read may serve the first load only inside this
  var LIVE_GRACE_MS = 1500;          // how long the board waits for live before painting without it
  // Still parsed off the briefing on the direct read: handleFleetPilotFleet
  // reports `hold` and both paths must return the identical shape.
  var HOLD_MARKER_RE = /\[FLEETMODE-HOLD until=([^\s\]]+) pilot=([^\]]*)\]/;

  var state = {
    auth: null,          // { accessToken, refreshToken, expiresAt, profile, org, scopes, grantedWrite }
    fleet: [],
    org: null,           // { id, name, description?, ... } as last reported by the fleet read
    serverTimeUtc: null,
    oauthHandled: false,
  };

  var $ = function (id) { return document.getElementById(id); };
  var signinView = $('signinView');

  // ── auth storage — PERSISTENT, not per-tab ──────────────────────────────
  // Fleet Mode asks for `offline_access`, so the token set carries a refresh
  // token; keeping it across visits is what turns sign-in from "every time I
  // open the page" into "once". Infinite Flight's own API playground does
  // exactly this — "access and refresh tokens are stored in your browser local
  // storage so the demo can refresh your session without cookies".
  //
  // Why localStorage and not something safer: the ACCESS token has to be
  // readable by script anyway (fetchFleetDirect sends it to
  // api.infiniteflight.com from this thread), so only the refresh token could
  // have been hidden, and hiding it means an httpOnly cookie — a server-side
  // custody model we do not have a route for. The pilot's token is read-only
  // and INVA-org-scoped (pilotScopes in lib/api-handlers/fleet-pilot.js), and
  // SIGN OUT clears it here and, via the storage event, in every other tab.
  //
  // Every touch is guarded: blocked/partitioned storage throws on ACCESS, not
  // just on write. When it does, Fleet Mode behaves exactly as it did before
  // persistence — signed in for this tab, gone when it closes.
  function store(kind) {
    try { return window[kind] || null; } catch (e) { return null; }
  }
  function readStored() {
    try { return JSON.parse((store('localStorage') || {}).getItem(AUTH_KEY) || 'null'); } catch (e) { return null; }
  }
  function loadAuth() {
    var stored = readStored();
    if (stored) return stored;
    // One-time migration: sessions opened before persistence landed are in
    // sessionStorage under the same key. Promote them instead of signing the
    // pilot out on the deploy that added this.
    try {
      var ss = store('sessionStorage');
      var legacy = ss && ss.getItem(AUTH_KEY);
      if (legacy) { ss.removeItem(AUTH_KEY); return saveAuth(JSON.parse(legacy)); }
    } catch (e) {}
    return null;
  }
  function saveAuth(a) {
    state.auth = a;
    try { (store('localStorage') || {}).setItem(AUTH_KEY, JSON.stringify(a)); } catch (e) {}
    return a;
  }
  function clearAuth() {
    state.auth = null;
    try { (store('localStorage') || {}).removeItem(AUTH_KEY); } catch (e) {}
    try { (store('sessionStorage') || {}).removeItem(AUTH_KEY); } catch (e) {}
    try { (store('localStorage') || {}).removeItem(BOARD_KEY); } catch (e) {}   // a signed-out browser keeps no board
    try { (store('localStorage') || {}).removeItem(AIRCRAFT_KEY); } catch (e) {}
    historyCache = {};   // a signed-out tab keeps no tail history either
  }

  // ── last-known board (Phase 2 of docs/planning/fleet-load-time.md) ───────
  // The fleet json exactly as handed to onFleet, kept per IF user + org so a
  // return visit can paint it at once while the real read runs. It is a PREVIEW
  // input only: it is never assigned to state.lastFleet / state.fleet / state.org.
  var BOARD_KEY = 'fmBoard';
  var BOARD_MAX_CHARS = 1500000;
  var BOARD_MAX_AGE_MS = 3600 * 1000;   // IF caching rule: user data is discarded within 1 hour
  function boardOwner() {
    var a = state.auth;
    return {
      user: (a && a.profile && a.profile.userId) || '',
      org: (a && a.org && a.org.id) || '',
    };
  }
  /** Deferred so it never delays the paint; too big or a throwing write ⇒ the key is removed. */
  function saveBoard(json) {
    setTimeout(function () {
      try {
        var who = boardOwner();
        if (!state.auth || !who.user || !who.org || !json) return;
        var s = JSON.stringify({ v: 1, user: who.user, org: who.org, at: Date.now(), json: json });
        if (s.length > BOARD_MAX_CHARS) { lsDel(BOARD_KEY); return; }
        try { (store('localStorage') || {}).setItem(BOARD_KEY, s); } catch (e) { lsDel(BOARD_KEY); }
      } catch (e) { lsDel(BOARD_KEY); }
    }, 0);
  }
  /** The stored json, or null unless it is this user's + org's, under 1 h old and has tails. */
  function loadBoard() {
    try {
      var raw = lsGet(BOARD_KEY);
      if (!raw) return null;
      var b = JSON.parse(raw);
      var who = boardOwner();
      if (!b || b.v !== 1 || !who.user || !who.org) return null;
      if (b.user !== who.user || b.org !== who.org) return null;
      if (typeof b.at !== 'number' || !(Date.now() - b.at < BOARD_MAX_AGE_MS) || b.at > Date.now() + 60000) return null;
      if (!b.json || !Array.isArray(b.json.aircraft) || !b.json.aircraft.length) return null;
      return b.json;
    } catch (e) { return null; }
  }

  // Guarded accessors for the OAuth handshake keys. The auth-token helpers
  // above already went through store(); the sign-in path did not, and used bare
  // sessionStorage./localStorage. — so on a browser that throws on storage
  // ACCESS (Safari with "Block All Cookies") the setItem took sign-in down and
  // the getItem in the 600ms poll below threw uncaught, forever. ssSet reports
  // whether the write landed, because a PKCE verifier we cannot store is a flow
  // that cannot complete — that has to surface, not be swallowed.
  function ssGet(k) { try { return (store('sessionStorage') || {}).getItem(k); } catch (e) { return null; } }
  function ssSet(k, v) { try { (store('sessionStorage') || {}).setItem(k, v); return true; } catch (e) { return false; } }
  function ssDel(k) { try { (store('sessionStorage') || {}).removeItem(k); } catch (e) {} }
  function lsGet(k) { try { return (store('localStorage') || {}).getItem(k); } catch (e) { return null; } }
  function lsDel(k) { try { (store('localStorage') || {}).removeItem(k); } catch (e) {} }

  // ── API relay with one refresh retry ────────────────────────────────────
  // ── every request on this page is on a clock ────────────────────────────
  //
  // A fetch that never settles is the worst failure this page has: the board
  // renders only from onFleet()/onFleetError(), there is no retry on the fleet
  // read, and the loading skeletons are the static shell — so ONE stalled
  // request leaves a pilot staring at skeletons forever, with no error and
  // nothing to do but guess. That is not hypothetical: it is what "stuck on
  // loading" was, and it is browser-specific because whether a request stalls
  // or fails fast is exactly the sort of thing engines differ on (and the
  // direct path makes ~31 cross-origin calls to api.infiniteflight.com, with
  // iCloud Private Relay in that path for a lot of iPhone users).
  //
  // AbortController + setTimeout rather than AbortSignal.timeout(): the latter
  // is Safari 16+, and this fix exists FOR Safari — the one browser where it
  // must not be the thing that is missing.
  //
  // A timed-out request rejects with `.timedOut`, which is what lets
  // fetchFleetRaw treat a stall the way it already treats a CORS refusal:
  // disable the direct path and let the relay answer. That fallback existed all
  // along and could never fire, because it was reached only by a REJECTION and
  // a hang never rejects.
  var REQ_TIMEOUT_MS = 12000;        // one upstream call
  var FLEET_LOAD_TIMEOUT_MS = 45000; // the whole board read, fan-out included

  function fetchT(url, init, ms) {
    var ac = typeof AbortController === 'function' ? new AbortController() : null;
    var opts = Object.assign({}, init || {});
    if (ac) opts.signal = ac.signal;
    var timer = null;
    var timedOut = false;

    return new Promise(function (resolve, reject) {
      timer = setTimeout(function () {
        timedOut = true;
        if (ac) { try { ac.abort(); } catch (e) {} }
        // Reject even when AbortController is missing, so the chain always
        // moves on rather than waiting on a fetch nothing can cancel.
        var err = new Error('The request timed out.');
        err.timedOut = true;
        reject(err);
      }, ms || REQ_TIMEOUT_MS);

      fetch(url, opts).then(resolve, function (e) {
        if (timedOut) return;        // the timeout already rejected
        reject(e);
      });
    }).then(function (r) {
      clearTimeout(timer);
      return r;
    }, function (e) {
      clearTimeout(timer);
      if (timedOut && !e.timedOut) e.timedOut = true;
      throw e;
    });
  }

  function apiFetch(url, opts, _retried) {
    opts = opts || {};
    var headers = { 'Content-Type': 'application/json' };
    if (state.auth) headers.Authorization = 'Bearer ' + state.auth.accessToken;
    return fetchT(url, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    }).then(function (resp) {
      if (resp.status === 401 && state.auth && state.auth.refreshToken && !_retried) {
        return refreshAuth().then(function (ok) {
          if (!ok) throw new Error('Your Infinite Flight session expired — sign in again.');
          return apiFetch(url, opts, true);
        });
      }
      return resp.json().catch(function () { return {}; }).then(function (json) {
        if (!resp.ok) {
          // The message alone is not always enough: some refusals are ACTIONABLE
          // (CAPTAIN_TAKEN offers the right-hand seat), and a caller can only
          // act on them if the machine-readable half survives the throw.
          var err = new Error(json.error || ('Request failed (HTTP ' + resp.status + ')'));
          err.status = resp.status;
          if (json.code) err.code = json.code;
          err.detail = json;
          throw err;
        }
        return json;
      });
    });
  }

  // ── refresh ─────────────────────────────────────────────────────────────
  // Refresh tokens ROTATE ("store the newest refresh token returned by the
  // token endpoint and discard the old one" — docs/reference/if-v3-oauth-preview.md),
  // and a persisted session means several tabs can share one. Two tabs must
  // never spend the same token: the loser's grant is already dead, and a server
  // that does reuse detection would kill the whole family. Hence
  //   (a) one refresh in flight per tab,
  //   (b) adopt a newer set another tab has already stored instead of calling,
  //   (c) on failure, look once more before giving up — a rejection here is
  //       usually "someone else got there first", not "the pilot is signed out".
  var _refreshing = null;

  /** A newer token set another tab has written, or null. */
  function newerStored() {
    var stored = readStored();
    if (!stored || !stored.accessToken) return null;
    if (!state.auth) return stored;
    if (stored.accessToken === state.auth.accessToken) return null;
    return (stored.expiresAt || 0) > (state.auth.expiresAt || 0) ? stored : null;
  }

  function refreshAuth() {
    if (_refreshing) return _refreshing;
    if (!state.auth || !state.auth.refreshToken) { signOut(true); return Promise.resolve(false); }

    var adopted = newerStored();
    if (adopted) { state.auth = adopted; return Promise.resolve(true); }

    _refreshing = fetchT(API.refresh, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        refreshToken: state.auth.refreshToken,
        // Lets the server re-mint the caller identity. A refresh grant is not
        // obliged to return an id_token, and a session that now survives across
        // visits can outlive the identity's own expiry — without this, the
        // identity routes (crew request, leg alerts, guide…) would quietly start
        // answering "sign in again" on a session that is otherwise healthy.
        followIdentity: state.auth.followIdentity || null,
      }),
    }).then(function (r) { return r.ok ? r.json() : null; }).then(function (json) {
      if (!json || !json.accessToken) throw new Error('refresh rejected');
      saveAuth(Object.assign({}, state.auth, {
        accessToken: json.accessToken,
        refreshToken: json.refreshToken || state.auth.refreshToken,
        expiresAt: json.expiresAt,
        followIdentity: json.followIdentity || state.auth.followIdentity || null,
      }));
      return true;
    }).catch(function () {
      var raced = newerStored();
      if (raced) { state.auth = raced; return true; }
      signOut(true);
      return false;
    }).then(function (ok) { _refreshing = null; return ok; });

    return _refreshing;
  }

  /** Mint a fresh access token if the stored one is spent. Cheap to call on
   *  every load: it only reaches the network once the token has actually
   *  expired (`expiresAt` already carries the server's 60s skew). */
  function ensureFreshAuth() {
    if (!state.auth || !state.auth.accessToken) return Promise.resolve(false);
    if (!state.auth.expiresAt || Date.now() < state.auth.expiresAt) return Promise.resolve(true);
    if (!state.auth.refreshToken) return Promise.resolve(true); // no way to renew — let the 401 path decide
    return refreshAuth();
  }

  // ── cross-tab session sync ──────────────────────────────────────────────
  // localStorage is shared, so a sign-in, a rotation or a SIGN OUT in one tab
  // has to be respected by the others — otherwise a second tab keeps using a
  // refresh token that has already been rotated away, or stays on the board
  // after the pilot signed out somewhere else.
  function armAuthSync() {
    window.addEventListener('storage', function (ev) {
      if (ev.key !== AUTH_KEY) return;
      if (!ev.newValue) {                    // signed out in another tab
        if (state.auth) signOut(false);
        return;
      }
      var next = null;
      try { next = JSON.parse(ev.newValue); } catch (e) { return; }
      if (!next || !next.accessToken) return;
      var wasSignedOut = !state.auth;
      state.auth = next;
      if (wasSignedOut) showApp();           // signed in in another tab
    });
  }

  // ── PKCE sign-in ────────────────────────────────────────────────────────
  function randomString(len) {
    var bytes = new Uint8Array(len);
    crypto.getRandomValues(bytes);
    return Array.prototype.map.call(bytes, function (b) { return ('0' + (b & 63).toString(36)).slice(-1); }).join('') +
      Array.prototype.map.call(bytes.slice(0, 8), function (b) { return (b % 10); }).join('');
  }
  function pkceChallenge(verifier) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)).then(function (digest) {
      return btoa(String.fromCharCode.apply(null, new Uint8Array(digest)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    });
  }

  // The authorize URL cannot be known until a fetch AND a SHA-256 digest have
  // resolved, but the WINDOW has to be claimed before either — see startSignIn.
  // Opening on about:blank shows a white tab for that beat, and on iOS the new
  // tab takes focus immediately, so it reads as a broken page. Say what is
  // happening instead. about:blank inherits our origin, so this is same-origin.
  function holdingPage(popup) {
    try {
      // The airport scene follows the OS theme by itself (inva-airport-loader.svg);
      // the page behind it continues the scene's sky and ground in both themes.
      popup.document.write(
        '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<title>Connecting…</title>' +
        // Same layout as .inva-ld in components.css (the popup has no stylesheet of ours).
        '<style>:root{--s1:#0b0d12;--s2:#161a22;--g:#242a36;color:#e8eaf0}' +
        '@media (prefers-color-scheme:light){:root{--s1:#eef1f6;--s2:#dfe4ee;--g:#b2bac9;color:#1c2230}}' +
        'body{margin:0;height:100vh;background:linear-gradient(var(--s1) 0 50%,var(--g) 50%);' +
        'font:14px -apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif}' +
        'img{position:fixed;inset:0;width:100%;height:100%;object-fit:contain}' +
        '@media (min-aspect-ratio:1/1){body{background:linear-gradient(var(--s1) 0,var(--s2) 79%,var(--g) 79% 81.2%,var(--s1) 81.2% 92.8%,var(--g) 92.8%)}' +
        'img{-webkit-mask-image:var(--m);mask-image:var(--m);' +
        '--m:linear-gradient(to right,transparent calc(50% - 50vh),#000 calc(50% - 38vh),#000 calc(50% + 38vh),transparent calc(50% + 50vh))}}' +
        'p{position:fixed;left:0;right:0;bottom:24px;margin:0;text-align:center;opacity:.75}</style>' +
        '<body><img src="/assets/img/loaders/inva-airport-loader.svg" alt="">' +
        '<p>Connecting to Infinite Flight…</p></body>'
      );
      popup.document.close();
    } catch (e) { /* cosmetic only — never let it stop the flow */ }
  }

  function startSignIn() {
    var btn = $('btnSignIn'), errEl = $('signInError');
    btn.disabled = true;
    errEl.hidden = true;

    // WHY THE WINDOW IS CLAIMED HERE AND NAVIGATED LATER:
    // Safari — and therefore every browser on iOS — only honours window.open
    // while it is SYNCHRONOUSLY on the call stack of the gesture handler.
    // Chrome instead grants a 5s transient-activation window, which a config
    // fetch plus a SHA-256 digest comfortably fits inside, which is exactly why
    // opening it down in the .then() worked everywhere we tested and blocked
    // 100% of the time on iPhone. Worse, the "allow popups for this site"
    // advice was a dead end: Safari was not applying the blocker preference,
    // it was refusing an un-gestured open(), so turning the blocker off
    // changed nothing. Claim the window on the gesture, point it at the
    // authorize URL once the challenge resolves.
    var popup = window.open('', 'if-oauth-fleet', 'width=480,height=680');
    if (!popup) {
      btn.disabled = false;
      errEl.textContent = 'Could not open the Infinite Flight sign-in window — allow popups for this site and try again.';
      errEl.hidden = false;
      return;
    }
    holdingPage(popup);

    fetchT(API.config).then(function (r) { return r.json(); }).then(function (cfg) {
      if (cfg.mock) {                          // local dev, IF_V3_MOCK=1
        try { popup.close(); } catch (e) {}    // no authorize step to send it to
        return exchange('mock-code', 'mock-verifier');
      }
      if (!cfg.configured || !cfg.clientId) {
        throw new Error(cfg.configError || 'Infinite Flight OAuth is not configured on the server.');
      }
      var verifier = randomString(64);
      var stateToken = randomString(24);
      // Guarded: with Safari's "Block All Cookies" on, storage throws on ACCESS,
      // not just on write — an unguarded touch here took sign-in down entirely.
      if (!ssSet(VERIFIER_KEY, verifier) || !ssSet(STATE_KEY, stateToken)) {
        throw new Error('This browser is blocking site storage, which sign-in needs. ' +
          'Allow cookies for this site (iOS: Settings → Apps → Safari → Block All Cookies, off) and try again.');
      }
      state.oauthHandled = false;
      return pkceChallenge(verifier).then(function (challenge) {
        var u = new URL(cfg.authorizeUrl);
        u.searchParams.set('client_id', cfg.clientId);
        u.searchParams.set('redirect_uri', cfg.redirectUri);
        u.searchParams.set('response_type', 'code');
        u.searchParams.set('scope', cfg.scopes);
        u.searchParams.set('code_challenge', challenge);
        u.searchParams.set('code_challenge_method', 'S256');
        u.searchParams.set('state', stateToken);
        // The pilot can close the holding tab while we are still resolving.
        if (popup.closed) throw new Error('Sign-in window was closed before it opened.');
        popup.location.href = u.toString();
        armOAuthListeners();
        btn.disabled = false;
      });
    }).catch(function (err) {
      try { if (!popup.closed) popup.close(); } catch (e) {}
      btn.disabled = false;
      errEl.textContent = err.message || String(err);
      errEl.hidden = false;
    });
  }

  function armOAuthListeners() {
    if (armOAuthListeners._armed) return;
    armOAuthListeners._armed = true;

    window.addEventListener('message', function (ev) {
      if (ev.origin !== window.location.origin) return;
      handleOAuthResult(ev.data);
    });
    try {
      var bc = new BroadcastChannel('if-oauth');
      bc.onmessage = function (ev) { handleOAuthResult(ev.data); };
    } catch (e) { /* unsupported — other channels cover it */ }
    window.addEventListener('storage', function (ev) {
      if (ev.key === 'ifOAuthResult' && ev.newValue) {
        try { handleOAuthResult(JSON.parse(ev.newValue)); } catch (e) {}
      }
    });
    // last-resort poll (storage events don't fire in the writing tab)
    setInterval(function () {
      var raw = lsGet('ifOAuthResult');
      if (!raw) return;
      try { handleOAuthResult(JSON.parse(raw)); } catch (e) {}
    }, 600);
  }

  function handleOAuthResult(msg) {
    if (!msg || msg.source !== 'if-oauth' || state.oauthHandled) return;
    var expected = ssGet(STATE_KEY);
    if (!expected) return; // not this tab's flow (e.g. admin connect elsewhere)
    if (msg.error) {
      state.oauthHandled = true;
      lsDel('ifOAuthResult');
      showSignInError('Sign-in was cancelled or denied (' + msg.error + ').');
      return;
    }
    if (!msg.code || msg.state !== expected) return; // stale/foreign result — ignore
    state.oauthHandled = true;
    lsDel('ifOAuthResult');
    ssDel(STATE_KEY);
    var verifier = ssGet(VERIFIER_KEY);
    ssDel(VERIFIER_KEY);
    if (!verifier) return showSignInError('PKCE verifier missing — please try again.');
    exchange(msg.code, verifier);
  }

  function exchange(code, verifier) {
    showSignInBusy(true);
    return fetchT(API.exchange, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code, codeVerifier: verifier }),
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (out) {
        if (!out.ok) throw new Error(out.j.error || 'Sign-in failed.');
        saveAuth({
          accessToken: out.j.accessToken,
          refreshToken: out.j.refreshToken,
          expiresAt: out.j.expiresAt,
          scopes: out.j.scopes,
          grantedWrite: out.j.grantedWrite,
          profile: out.j.profile || {},
          org: out.j.org,
          // Must be carried over: without it every identity-route call fails
          // with "Sign in again" — and signing in again runs
          // THIS code, so dropping it here made the advice impossible to
          // act on. refreshAuth() preserves it for the same reason.
          followIdentity: out.j.followIdentity || null,
        });
        showApp();
      })
      .catch(function (err) { showSignInError(err.message || String(err)); })
      .then(function () { showSignInBusy(false); });
  }

  function showSignInError(msg) {
    var el = $('signInError');
    el.textContent = msg;
    el.hidden = false;
  }
  function showSignInBusy(busy, label) {
    var btn = $('btnSignIn');
    btn.disabled = busy;
    if (busy) {
      // Only the FIRST capture is the real label — a second busy call while
      // still busy would otherwise memorise "Connecting…" as the button text.
      if (!btn._html) btn._html = btn.innerHTML;
      btn.textContent = label || 'Connecting…';
    } else if (btn._html) {
      // eslint-disable-next-line no-unsanitized/property -- safe: markup built by this module (data escaped where built) or an internal enum/constant
      btn.innerHTML = btn._html; // restore label + icon
    }
  }

  function signOut(expired) {
    clearAuth();
    if (window.INVA_FLEET_HOME) window.INVA_FLEET_HOME.hide();
    signinView.hidden = false;
    if (expired) showSignInError('Your Infinite Flight session expired — sign in again.');
  }

  // ── app boot ────────────────────────────────────────────────────────────
  // Sign-in lands on the Fleet Home (assets/js/fleet-mode-home.js) — the map,
  // the fleet at a glance and the schedule board — and that is the whole app.
  // There is no second view: the booking flow this file used to own was removed
  // on 2026-08-23, so the home module is now a hard dependency rather than a
  // preferred front end. Say so plainly if it failed to load, instead of
  // leaving the pilot on a blank page.
  function showApp() {
    signinView.hidden = true;
    if (!window.INVA_FLEET_HOME) {
      signinView.hidden = false;
      showSignInError('The fleet board failed to load — refresh the page and try again.');
      return;
    }
    window.INVA_FLEET_HOME.show();
    loadFleet().catch(function () { /* already reported through onFleetError */ });
  }

  /**
   * Ask which of our tails are actually airborne.
   *
   * v3's own "Get Aircraft Position" documentation says the persisted position
   * "can be stale when the aircraft is not actively reporting", and that to
   * know whether an aircraft is live you compare its id with the flightId in
   * the session flights feed. So the /live/* endpoints cannot answer this and
   * the server does that comparison for us — the Expert feed is thousands of
   * flights and only ours come back.
   *
   * It needs only the ids, so it is started the moment the aircraft list
   * answers (ctx.startLive), beside the per-tail fan-out, not after it.
   *
   * Never rejects: without it the board falls back to schedule-only behaviour,
   * which is worse but not broken. Resolves { live, session }.
   */
  function liveRequest(ids) {
    var empty = { live: [], session: false };
    if (!ids.length || !state.auth) return Promise.resolve(empty);
    return fetchT('/api/fleetPilotLive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + state.auth.accessToken },
      body: JSON.stringify({ aircraftIds: ids }),
    }).then(function (r) { return r.json(); }).then(function (j) {
      return { live: (j && j.live) || [], session: !!(j && j.session) };
    }).catch(function () { return empty; });
  }

  /** Per-load context: the live request is started once, by whichever path
   *  knows the ids first. */
  function newCtx() {
    var ctx = { liveP: null, late: null };
    ctx.startLive = function (ids) {
      if (!ctx.liveP) ctx.liveP = liveRequest(ids);
      return ctx.liveP;
    };
    return ctx;
  }

  /**
   * Bid-only tails (plan §7.5, Fleet Contracts) — merged onto BOTH fleet-read
   * paths at the same point, so the direct read and the relay hand the Fleet
   * Home the identical list regardless of which one answered. It comes from
   * this page's one config fetch (fetchConfig, already in flight by then, so
   * waiting on it is parallel not serial); if that fetch fails, the list stored
   * by an earlier visit, else empty (the feature is then a no-op).
   */
  function withBidOnlyTails(json, cfgP) {
    return (cfgP || fetchConfig()).then(function (cfg) {
      var stored = cfg || storedConfig();
      json.bidOnlyTails = (stored && stored.bidOnlyTails) || [];
      return json;
    });
  }

  /**
   * One /api/fleetPilotAuthConfig call per page load, shared by directBase()
   * and withBidOnlyTails(), and kept in localStorage so the NEXT page load
   * knows publicApiBase without waiting. Never rejects (null on failure, and a
   * failure is not memoised, so the next load tries again).
   */
  var _cfgP = null;
  function storedConfig() {
    try {
      var c = JSON.parse(lsGet(CONFIG_KEY) || 'null');
      return c && typeof c === 'object' ? c : null;
    } catch (e) { return null; }
  }
  function fetchConfig() {
    if (_cfgP) return _cfgP;
    _cfgP = fetchT(API.config).then(function (r) { return r.json(); }).then(function (cfg) {
      var c = {
        at: Date.now(),
        publicApiBase: cfg && cfg.publicApiBase ? String(cfg.publicApiBase).replace(/\/+$/, '') : null,
        bidOnlyTails: (cfg && cfg.bidOnlyTails) || [],
      };
      try { (store('localStorage') || {}).setItem(CONFIG_KEY, JSON.stringify(c)); } catch (e) {}
      return c;
    }).catch(function () { _cfgP = null; return null; });
    return _cfgP;
  }

  /**
   * Flex Crew state (lib/actions/fleet-flex-crew.js flexBoardState) — which
   * tails are Flex and whether each one's First Officer seat is released.
   * Unlike the bid-only list it is re-read on EVERY load: it moves with the
   * sweep. A failed read is `null`, and the board then treats Flex
   * tails as it always did; the server refuses the seat either way. It needs
   * no token, so it is started before the token refresh resolves. Never rejects.
   */
  function readFlex() {
    return fetchT(API.flexState).then(function (r) { return r.json(); }).then(function (j) {
      return j && j.ok ? { tails: j.tails || [], types: j.types || [], byAircraft: j.byAircraft || {} } : null;
    }).catch(function () { return null; });
  }

  // Boot starts config + Flex before the token refresh; the first load may
  // reuse that Flex read if it is fresh, every later load reads again.
  var _bootFlex = null;
  function prefetchEarly() {
    fetchConfig();
    _bootFlex = { p: readFlex(), at: Date.now() };
  }
  function takeFlex() {
    var pre = _bootFlex;
    _bootFlex = null;
    return pre && Date.now() - pre.at < FLEX_PREFETCH_MS ? pre.p : readFlex();
  }

  /**
   * Reject if `p` has not settled inside `ms`.
   *
   * The per-request clock in fetchT covers every call this file makes; this is
   * the backstop for the whole read, because the fan-out is ~31 of them and a
   * chain can stall for reasons no single request owns — a promise that is
   * never returned, a fetch added later without the wrapper, a browser that
   * will not abort. The board has exactly two outcomes, onFleet or
   * onFleetError, and anything that reaches neither is the bug this prevents:
   * loading skeletons that never resolve into anything.
   */
  function withDeadline(p, ms, message) {
    var timer = null;
    return Promise.race([
      p,
      new Promise(function (_resolve, reject) {
        timer = setTimeout(function () {
          var e = new Error(message);
          e.timedOut = true;
          reject(e);
        }, ms);
      }),
    ]).then(function (v) { clearTimeout(timer); return v; },
      function (e) { clearTimeout(timer); throw e; });
  }

  /** Live is the slowest, least important part of the read (the server scans
   *  the session feed), so the board waits at most LIVE_GRACE_MS for it once
   *  everything else is ready. Past that it paints with no live and
   *  loadFleet patches it in when it lands (ctx.late). */
  function awaitLive(json, ctx) {
    var liveP = ctx.startLive((json.aircraft || []).map(function (a) { return a.id; }));
    var timer = null;
    var grace = new Promise(function (resolve) {
      timer = setTimeout(function () { resolve(null); }, LIVE_GRACE_MS);
    });
    return Promise.race([liveP, grace]).then(function (l) {
      clearTimeout(timer);
      if (l) {
        json.live = l.live;
        json.liveSession = l.session;
      } else {
        json.live = [];
        json.liveSession = false;
        ctx.late = liveP;
      }
      return json;
    });
  }

  function loadFleet() {
    // A persisted session is usually resumed on a spent access token, and the
    // board polls this every 90s — renewing here keeps the direct IF read
    // from ever seeing a 401 in the first place.
    //
    // Config and Flex state need no token, so they start NOW, before the
    // refresh resolves, and overlap the whole IF read.
    var ctx = newCtx();
    var cfgP = fetchConfig();
    var flexP = takeFlex();

    return withDeadline(ensureFreshAuth().then(function (ok) {
      if (!ok) throw new Error('Your Infinite Flight session expired — sign in again.');
      return fetchFleet(ctx);
    }).then(function (json) {
      return Promise.all([withBidOnlyTails(json, cfgP), flexP]).then(function (r) {
        json.flex = r[1];
        return awaitLive(json, ctx);
      });
    }),
    FLEET_LOAD_TIMEOUT_MS,
    'The fleet did not load in time — Infinite Flight or the network is not answering. Reload to try again.'
    ).then(function (json) {
      state.lastFleet = json;
      state.fleet = json.aircraft || [];
      state.serverTimeUtc = json.serverTimeUtc;
      state.org = json.org || state.org;
      if (window.INVA_FLEET_HOME) window.INVA_FLEET_HOME.onFleet(json);
      saveBoard(json);
      if (ctx.late) {
        // Live missed the grace window: patch the SAME object when it lands,
        // unless a newer load has replaced the board in the meantime.
        ctx.late.then(function (l) {
          if (state.lastFleet !== json) return;
          json.live = l.live;
          json.liveSession = l.session;
          if (window.INVA_FLEET_HOME) window.INVA_FLEET_HOME.onFleet(json);
          saveBoard(json);
        });
      }
      return json;
    }).catch(function (err) {
      if (window.INVA_FLEET_HOME) window.INVA_FLEET_HOME.onFleetError(err);
      throw err;
    });
  }

  // ── fleet read: straight from the browser, relay as the fallback ─────────
  // The pilot's own OAuth token already carries live:aircraft.read and
  // live:schedules.read, so the READ fan-out can run here instead of in
  // /api/fleetPilotFleet — that handler costs 1 + 2N upstream calls per load
  // (fleet list, then a position AND a schedule call per tail), which is by
  // far the heaviest function in Fleet Mode. Doing it in the browser removes
  // that per-load serverless bill entirely.
  //
  // WRITES stay on the relay: hold/release/reposition run on the ORG ADMIN
  // connection server-side, not on the pilot's read-only token.
  //
  // The direct path is skipped in mock mode (no upstream to call) and is
  // disabled for the rest of the session the first time it fails — a browser
  // that refuses the cross-origin call surfaces it as a TypeError, which is
  // exactly the "IF does not serve CORS to browsers" case. Either way the
  // relay answers and the page behaves identically, just at the old cost.
  var direct = { base: null, resolved: false, disabled: false };

  function directBase() {
    if (direct.resolved) return Promise.resolve(direct.base);
    // A stored copy answers at once (null/'' there still means "relay only");
    // this page's own fetch refreshes it for the next load.
    var stored = storedConfig();
    if (stored && 'publicApiBase' in stored) {
      direct.resolved = true;
      direct.base = stored.publicApiBase ? String(stored.publicApiBase).replace(/\/+$/, '') : null;
      return Promise.resolve(direct.base);
    }
    return fetchConfig().then(function (c) {
      direct.base = c ? c.publicApiBase : null;
      direct.resolved = true;
      return direct.base;
    });
  }

  // ── per-tab rate budget ─────────────────────────────────────────────────
  // Infinite Flight limits each signed-in pilot's token to 5 requests/minute
  // (20 with Pro). The budget is read off the response headers when the browser
  // exposes them; when it does not, the calls of the last minute are counted
  // against the free limit (callsAvailable), and a 429 still blocks as usual.
  var RATE_WAIT_MAX_MS = 20000;      // wait out a block up to this long, else refuse
  var RATE_DEFAULT_RETRY_MS = 30000; // a 429 with no usable Retry-After
  var budget = { remaining: null, resetAt: 0, pro: null, blockedUntil: 0 };

  function headerOf(resp, name) {
    try { return resp && resp.headers && typeof resp.headers.get === 'function' ? resp.headers.get(name) : null; }
    catch (e) { return null; }
  }
  /** "Reset" may be epoch seconds, epoch ms or a date string: ms epoch or 0. */
  function parseResetAt(v) {
    if (v == null || v === '') return 0;
    var n = Number(v);
    if (isFinite(n)) return n > 1e12 ? n : n > 1e9 ? n * 1000 : 0;
    var d = Date.parse(v);
    return isFinite(d) ? d : 0;
  }
  /** Retry-After as ms: seconds, or an HTTP date. */
  function parseRetryAfter(v) {
    if (v == null || v === '') return 0;
    var n = Number(v);
    if (isFinite(n)) return Math.max(0, n * 1000);
    var d = Date.parse(v);
    return isFinite(d) ? Math.max(0, d - Date.now()) : 0;
  }
  function noteBudget(resp) {
    var rem = headerOf(resp, 'X-Rate-Limit-Remaining');
    if (rem != null && rem !== '' && isFinite(Number(rem))) budget.remaining = Number(rem);
    var reset = parseResetAt(headerOf(resp, 'X-Rate-Limit-Reset'));
    if (reset) budget.resetAt = reset;
    var pro = headerOf(resp, 'X-User-Pro');
    if (pro != null) budget.pro = String(pro).toLowerCase() === 'true';
    // Nothing left this minute: hold the next call until the minute turns.
    if (budget.remaining != null && budget.remaining <= 0 && budget.resetAt > Date.now() &&
        budget.resetAt - Date.now() <= 60000) {
      budget.blockedUntil = Math.max(budget.blockedUntil, budget.resetAt);
    }
  }
  function rateError(ms) {
    var err = new Error('Infinite Flight is rate-limiting this account — the board will retry in ' +
      Math.max(1, Math.ceil(ms / 1000)) + ' s');
    err.rateLimited = true;
    err.retryAfterMs = ms;
    return err;
  }
  /** When each IF call of the last minute was sent — the fallback count for a
   *  browser that cannot read the rate headers. */
  var sentAt = [];
  function sentLastMinute() {
    var cut = Date.now() - 60000;
    while (sentAt.length && sentAt[0] < cut) sentAt.shift();
    return sentAt.length;
  }
  /** How many MORE calls this load may spend, one kept in reserve. With no
   *  usable header the free limit (5/min) is assumed and counted here: guessing
   *  high would spend the pilot's whole minute on optional position reads. */
  function callsAvailable() {
    if (budget.blockedUntil > Date.now()) return 0;
    var rem = budget.remaining;
    if (rem == null || (budget.resetAt && Date.now() >= budget.resetAt)) {
      rem = (budget.pro === true ? 20 : 5) - sentLastMinute();
    }
    return rem - 1;
  }

  function ifGet(path) {
    var wait = budget.blockedUntil - Date.now();
    if (wait > 0) {
      if (wait > RATE_WAIT_MAX_MS) return Promise.reject(rateError(wait));
      return new Promise(function (r) { setTimeout(r, wait); }).then(function () { return ifGetNow(path); });
    }
    return ifGetNow(path);
  }

  function ifGetNow(path) {
    sentAt.push(Date.now());
    return fetchT(direct.base + path, {
      headers: { Authorization: 'Bearer ' + state.auth.accessToken },
    }).then(function (resp) {
      noteBudget(resp);
      if (resp.status === 401) {
        var e = new Error('Your Infinite Flight session expired — sign in again.');
        e.ifExpired = true;
        throw e;
      }
      if (resp.status === 429) {
        var ms = parseRetryAfter(headerOf(resp, 'Retry-After')) || RATE_DEFAULT_RETRY_MS;
        budget.remaining = 0;
        budget.blockedUntil = Date.now() + ms;
        throw rateError(ms);
      }
      if (!resp.ok) throw new Error('Infinite Flight request failed (HTTP ' + resp.status + ')');
      return resp.json();
    }).then(function (payload) {
      // v3 answers either a bare body or an { errorCode, result } envelope.
      if (payload && typeof payload === 'object' && 'errorCode' in payload) {
        if (payload.errorCode !== 0) throw new Error('Infinite Flight error ' + payload.errorCode);
        return payload.result == null ? null : payload.result;
      }
      return payload == null ? null : payload;
    });
  }

  /** Run `job` over `items` with at most `limit` in flight — the fan-out is
   *  one request per tail and the IF guide asks integrations not to burst. */
  function mapLimit(items, limit, job) {
    var out = new Array(items.length);
    var i = 0;
    function worker() {
      if (i >= items.length) return Promise.resolve();
      var idx = i++;
      return Promise.resolve(job(items[idx], idx)).then(function (v) {
        out[idx] = v;
        return worker();
      });
    }
    var workers = [];
    for (var w = 0; w < Math.min(limit, items.length); w++) workers.push(worker());
    return Promise.all(workers).then(function () { return out; });
  }

  function parseHoldMarker(schedule) {
    var m = String((schedule && schedule.briefing) || '').match(HOLD_MARKER_RE);
    if (!m) return null;
    var until = Date.parse(m[1]);
    if (!isFinite(until)) return null;
    return { until: new Date(until).toISOString(), pilot: m[2] || null, expired: Date.now() >= until };
  }

  /** The org's Active aircraft list, cached in localStorage (same user + org as
   *  fmBoard, at most an hour old, dropped on sign-out). A hit costs no call. */
  function loadAircraftList() {
    try {
      var raw = lsGet(AIRCRAFT_KEY);
      if (!raw) return null;
      var c = JSON.parse(raw);
      var who = boardOwner();
      if (!c || c.v !== 1 || !who.user || !who.org || c.user !== who.user || c.org !== who.org) return null;
      if (typeof c.at !== 'number' || !(Date.now() - c.at < AIRCRAFT_LIST_MAX_AGE_MS) || c.at > Date.now() + 60000) return null;
      return Array.isArray(c.list) && c.list.length ? c.list : null;
    } catch (e) { return null; }
  }
  function saveAircraftList(list) {
    try {
      var who = boardOwner();
      if (!state.auth || !who.user || !who.org) return;
      (store('localStorage') || {}).setItem(AIRCRAFT_KEY, JSON.stringify({ v: 1, user: who.user, org: who.org, at: Date.now(), list: list }));
    } catch (e) { lsDel(AIRCRAFT_KEY); }
  }

  /** ALL of the org's open schedules (not Cancelled, not Arrived): one call per
   *  100 legs. `aircraftId` narrows it to one tail. Items come back grouped by
   *  aircraft and ordered by sequence. */
  var SCHEDULE_PAGE_MAX = 30;
  function fetchOpenSchedules(orgId, aircraftId) {
    var base = '/live/organizations/' + encodeURIComponent(orgId) + '/schedules';
    function page(n, acc) {
      return ifGet(base + '?page=' + n + '&pageSize=100' + (aircraftId ? '&aircraftId=' + encodeURIComponent(aircraftId) : ''))
        .then(function (res) {
          var items = res && Array.isArray(res.items) ? res.items : Array.isArray(res) ? res : [];
          acc = acc.concat(items);
          var total = res && isFinite(Number(res.totalPages)) ? Number(res.totalPages) : 1;
          return n < total && n < SCHEDULE_PAGE_MAX ? page(n + 1, acc) : acc;
        });
    }
    return page(1, []);
  }

  /** Same enrichment handleFleetPilotFleet does, so both paths hand the Fleet
   *  Home the identical shape. `hold` is still parsed even though nothing
   *  books any more: the relay reports it, and the two paths must not drift. */
  function fetchFleetDirect(ctx) {
    var org = state.auth && state.auth.org;
    if (!org || !org.id) return Promise.reject(new Error('no org'));

    // The type-name file loads beside the list call (it is only read when each
    // tail is built below), and live starts the moment the ids are known.
    //
    // Two reads, whatever the fleet size: the Active aircraft list (cached up to
    // an hour) and the org-wide OPEN schedules (one call per 100 legs) — the
    // pilot's token is held to 5 calls/minute, so there is no per-tail fan-out.
    // History fetches its own tail's full list on demand (loadTailHistory).
    var typesP = loadTypeNames();
    var cachedList = loadAircraftList();
    var listP = cachedList ? Promise.resolve(cachedList)
      : ifGet('/live/organizations/' + encodeURIComponent(org.id) + '/aircraft').then(function (list) {
        var act = (Array.isArray(list) ? list : [])
          .filter(function (a) { return a.status === 0; }) // Active records only
          .sort(function (a, b) { return (a.fleetRank || 0) - (b.fleetRank || 0); });
        saveAircraftList(act);
        return act;
      });
    var listStarted = listP.then(function (active) {
      ctx.startLive(active.map(function (a) { return a.id; }));
      return active;
    });
    var schedP = fetchOpenSchedules(org.id);
    // A rejection from either read must not leave the other unhandled.
    schedP.catch(function () {}); listStarted.catch(function () {});

    return Promise.all([listStarted, schedP, typesP]).then(function (r) {
        var active = r[0];
        var byTail = {};
        r[1].forEach(function (s) {
          if (!s || s.status === 9 || s.status === 11) return;   // open legs only, whatever the endpoint says
          (byTail[s.aircraftId] = byTail[s.aircraftId] || []).push(s);
        });
        Object.keys(byTail).forEach(function (id) {
          var l = byTail[id];
          l.forEach(function (s, i) { s.__i = i; });
          l.sort(function (p, q) {
            var hp = p.sequence != null && isFinite(Number(p.sequence));
            var hq = q.sequence != null && isFinite(Number(q.sequence));
            if (hp && hq && Number(p.sequence) !== Number(q.sequence)) return Number(p.sequence) - Number(q.sequence);
            if (hp !== hq) return hp ? -1 : 1;
            return p.__i - q.__i;
          });
          l.forEach(function (s) { delete s.__i; });
        });

        // A tail with no open leg has nothing to say where it is: ask for its
        // position, but only while the minute's budget allows (one call kept in
        // reserve); otherwise reuse what the last board knew.
        var prevById = {};
        ((state.lastFleet && state.lastFleet.aircraft) || []).forEach(function (x) { prevById[x.id] = x; });
        var spent = 0;
        var startBudget = callsAvailable();
        return mapLimit(active, 3, function (a) {
          var schedules = byTail[a.id] || [];
          var prev = prevById[a.id] || null;
          var posP;
          if (schedules.length) {
            posP = Promise.resolve(null);
          } else if (startBudget - spent >= 1 && callsAvailable() >= 1) {
            spent++;
            posP = ifGet('/live/aircraft/' + encodeURIComponent(a.id) + '/position')
              .catch(function (e) {
                if (e && e.ifExpired) throw e;
                return prev ? prev.position || null : null;   // rate-limited or failed: last known
              });
          } else {
            posP = Promise.resolve(prev ? prev.position || null : null);
          }
          return posP.then(function (position) {
            var hold = null;
            for (var s = 0; s < schedules.length; s++) {
              var h = parseHoldMarker(schedules[s]);
              if (h && !h.expired && (schedules[s].status === 1 || schedules[s].status === 0)) {
                hold = Object.assign({}, h, {
                  scheduleId: schedules[s].id,
                  callsign: schedules[s].callsign,
                  destinationIcao: schedules[s].destinationIcao,
                });
                break;
              }
            }

            return {
              id: a.id,
              registration: a.registration,
              typeName: typeNameFor(a.registration),
              fleetRank: a.fleetRank,
              isFleetActiveSlot: a.isFleetActiveSlot,
              visibility: a.visibility,
              position: position,
              airport: null,   // filled in below, in ONE batched lookup
              schedules: schedules,
              hold: hold,
            };
          });
        }).then(function (aircraft) {
          // Parked tails still have to resolve to an airport exactly as the
          // relay resolves them — that ICAO is what the booking flow asks for
          // legs with. ONE batched call does the whole fleet: the parked points
          // AND the names of every airport the schedules touch (fetchFleet's
          // later names lookup then finds nothing missing).
          var parked = aircraft.filter(function (a) {
            return a.position && isFinite(a.position.latitude) && isFinite(a.position.longitude) &&
              a.position.state !== 2;
          });
          var points = parked.map(function (a) { return [a.position.latitude, a.position.longitude]; });
          return resolveAirports(scheduleIcaos(aircraft), points).then(function (out) {
            parked.forEach(function (a, i) {
              var prev = prevById[a.id];
              a.airport = out.nearest[i] || (prev && prev.airport) || null;
            });
            return {
              ok: true,
              org: { id: org.id, name: org.name },
              serverTimeUtc: new Date().toISOString(),
              aircraft: aircraft,
              source: 'direct',
            };
          });
        });
      });
  }

  // ONE retry of the board read after a 429's wait. A retry that is itself
  // rate-limited does not schedule another: the next reload, or the Flight bag's
  // own cycle, takes over.
  var rateRetry = { timer: null, running: false };
  function scheduleRateRetry(ms) {
    if (rateRetry.timer || rateRetry.running) return;
    rateRetry.timer = setTimeout(function () {
      rateRetry.timer = null;
      rateRetry.running = true;
      Promise.resolve().then(loadFleet).catch(function () {}).then(function () { rateRetry.running = false; });
    }, Math.max(1000, (ms || RATE_DEFAULT_RETRY_MS)) + 500);
  }

  function fetchFleetRaw(ctx, _retried) {
    if (direct.disabled) return apiFetch(API.fleet);
    return directBase().then(function (base) {
      if (!base) { direct.disabled = true; return apiFetch(API.fleet); }
      return fetchFleetDirect(ctx)
        .catch(function (err) {
          // Expired access token: refresh once (same contract as apiFetch)
          // and retry, rather than throwing the pilot back to sign-in.
          if (err && err.ifExpired) {
            if (_retried || !state.auth || !state.auth.refreshToken) throw err;
            return refreshAuth().then(function (ok) {
              if (!ok) throw err;
              ctx.liveP = null;   // the live POST (if any) carried the spent token
              return fetchFleetRaw(ctx, true);
            });
          }
          // Rate-limited: the direct path is fine and the relay would spend the
          // SAME token's budget, so neither is changed. Keep the last board (or
          // say why there is none) and try once more after the wait.
          if (err && err.rateLimited) {
            scheduleRateRetry(err.retryAfterMs);
            if (state.lastFleet) return state.lastFleet;
            throw err;
          }
          direct.disabled = true;                // CORS/network/shape — relay from here on
          if (window.console) console.warn('[fleet-mode] direct IF read unavailable, using the relay:', err && err.message);
          return apiFetch(API.fleet);
        });
    });
  }

  /** Re-read ONE tail's schedules and repaint. An admin decision changes one
   *  aircraft, and a whole-fleet reload costs 1 + 2N calls on the admin's own
   *  token — two or three approvals in a minute used to hit IF's 100/min
   *  limit. Falls back to the full reload when there is nothing to patch or
   *  the direct path is off (the relay has no single-tail route). */
  function reloadTail(aircraftId) {
    var json = state.lastFleet;
    var tail = json && (json.aircraft || []).find(function (a) { return a.id === aircraftId; });
    if (!tail || direct.disabled || !direct.base) return loadFleet();
    var org = state.auth && state.auth.org;
    return ensureFreshAuth().then(function (ok) {
      if (!ok || !org || !org.id) throw new Error('Your Infinite Flight session expired — sign in again.');
      // The org endpoint with ?aircraftId= keeps the patched list OPEN-only,
      // exactly like the rest of the board (1 call).
      return fetchOpenSchedules(org.id, aircraftId);
    }).then(function (schedules) {
      tail.schedules = (Array.isArray(schedules) ? schedules : []).filter(function (s) {
        return s && s.status !== 9 && s.status !== 11;
      });
      if (window.INVA_FLEET_HOME) window.INVA_FLEET_HOME.onFleet(json);
      saveBoard(json);
      return json;
    });
  }

  /** One tail's FULL schedule list (Arrived legs included) for the History
   *  screen: 1 call, on demand. Memory only, 5 minutes per tail, never stored.
   *  Direct when the browser reads IF itself, else the relay's ?aircraftId=. */
  var HISTORY_TTL_MS = 5 * 60 * 1000;
  var historyCache = {};   // aircraftId → { at, schedules } | { p } while in flight
  function loadTailHistory(aircraftId) {
    var c = historyCache[aircraftId];
    if (c && c.p) return c.p;
    if (c && Date.now() - c.at < HISTORY_TTL_MS) return Promise.resolve(c.schedules);
    var useDirect = !direct.disabled && !!direct.base;
    var p = ensureFreshAuth().then(function (ok) {
      if (!ok) throw new Error('Your Infinite Flight session expired — sign in again.');
      if (useDirect) return ifGet('/live/aircraft/' + encodeURIComponent(aircraftId) + '/schedules');
      return apiFetch(API.fleet + '?aircraftId=' + encodeURIComponent(aircraftId)).then(function (j) { return j && j.schedules; });
    }).then(function (schedules) {
      var list = Array.isArray(schedules) ? schedules : [];
      historyCache[aircraftId] = { at: Date.now(), schedules: list };
      return list;
    }, function (err) {
      delete historyCache[aircraftId];
      if (err && err.status === 429 && !err.rateLimited) {
        err.rateLimited = true;
        err.retryAfterMs = (err.detail && Number(err.detail.retryAfter) * 1000) || RATE_DEFAULT_RETRY_MS;
      }
      throw err;
    });
    historyCache[aircraftId] = { p: p };
    return p;
  }

  /** Every ICAO the fleet's schedules touch (upper-cased, unique). */
  function scheduleIcaos(aircraft) {
    var want = {};
    (aircraft || []).forEach(function (a) {
      (a.schedules || []).forEach(function (s) {
        if (s.originIcao) want[String(s.originIcao).toUpperCase()] = 1;
        if (s.destinationIcao) want[String(s.destinationIcao).toUpperCase()] = 1;
      });
    });
    return Object.keys(want);
  }

  function fetchFleet(ctx) {
    return fetchFleetRaw(ctx).then(function (json) {
      // The relay path has just answered, so the ids are known: start live now
      // (a no-op when the direct path already did).
      ctx.startLive((json.aircraft || []).map(function (a) { return a.id; }));
      // Names + coordinates for every airport the fleet touches — the Fleet
      // Home labels its map and its route columns from these. Already-known
      // airports are skipped; on the direct path the one call above already
      // fetched them all, so this is a no-op there.
      var want = {};
      scheduleIcaos(json.aircraft).forEach(function (i) { want[i] = 1; });
      (json.aircraft || []).forEach(function (a) {
        if (a.airport && a.airport.icao) want[a.airport.icao] = 1;
      });
      return resolveAirports(Object.keys(want), []).then(function () { return json; });
    });
  }

  // ── static data the direct path needs (the relay does this server-side) ──
  var _airports = {};      // ICAO → { iata, name, city, lat, lon }, accumulated
  var _nearest = {};       // "lat4,lon4" → nearest airport (or null), accumulated
  var _airportMiss = {};   // ICAOs the server answered without — not asked again this page
  var _airportsAt = Date.now();
  var _typeByReg = null;

  // Both airport maps survive page loads for 7 days (whole-cache stamp).
  (function loadAirportCache() {
    try {
      var c = JSON.parse(lsGet(AIRPORTS_KEY) || 'null');
      if (c && typeof c === 'object' && c.at && Date.now() - c.at < AIRPORTS_TTL_MS &&
          c.airports && typeof c.airports === 'object' && c.nearest && typeof c.nearest === 'object') {
        _airports = c.airports;
        _nearest = c.nearest;
        _airportsAt = c.at;
      }
    } catch (e) {}
  })();

  /** Airport reference lookup. Kept on the server (/api/fleetPilotAirports)
   *  rather than shipped to the browser: the full table is ~7.9k rows / 150 KB
   *  compressed, and the handler makes NO Infinite Flight call — it reads the
   *  same airports.csv handleFleetPilotFleet does, so nearest-airport
   *  resolution is identical on both paths and a tail never becomes
   *  unbookable just because the browser did the fleet read. One cheap
   *  invocation per load, against 1 + 2N upstream calls before. */
  function pointKey(p) { return p[0].toFixed(4) + ',' + p[1].toFixed(4); }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  /** Persist the airport caches. Over the caps the persisted copy is dropped
   *  (and the next page load starts empty); the in-memory data stays, because
   *  the board is still labelled from it. */
  function saveAirportCache() {
    try {
      var ls = store('localStorage');
      if (!ls) return;
      if (Object.keys(_airports).length > AIRPORTS_MAX || Object.keys(_nearest).length > NEAREST_MAX) {
        ls.removeItem(AIRPORTS_KEY);
        _airportsAt = Date.now();
        return;
      }
      ls.setItem(AIRPORTS_KEY, JSON.stringify({ at: _airportsAt, airports: _airports, nearest: _nearest }));
    } catch (e) {}
  }

  function resolveAirports(icaos, points) {
    var wanted = (icaos || []).filter(function (i) { return i && !_airports[i] && !_airportMiss[i]; });
    wanted = wanted.filter(function (i, n) { return wanted.indexOf(i) === n; });
    var pts = points || [];
    // Points already answered are not sent again; identical points go once.
    var keys = [];
    pts.forEach(function (p) {
      var k = pointKey(p);
      if (!has(_nearest, k) && keys.indexOf(k) < 0) keys.push(k);
    });
    function answer() {
      return {
        airports: _airports,
        nearest: pts.map(function (p) { var k = pointKey(p); return has(_nearest, k) ? _nearest[k] : null; }),
      };
    }
    if (!wanted.length && !keys.length) return Promise.resolve(answer());

    var q = [];
    if (wanted.length) q.push('icaos=' + encodeURIComponent(wanted.join(',')));
    if (keys.length) q.push('near=' + encodeURIComponent(keys.join(';')));
    return fetchT(API.airports + '?' + q.join('&'))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (json) {
        if (!json) return answer();
        Object.keys(json.airports || {}).forEach(function (k) { _airports[k] = json.airports[k]; });
        // `nearest` comes back in the order the points were sent. A null hit is
        // an answer too (nothing within 10 km) and is cached.
        var near = json.nearest || [];
        keys.forEach(function (k, i) { if (i < near.length) _nearest[k] = near[i] || null; });
        wanted.forEach(function (i) { if (!_airports[i]) _airportMiss[i] = 1; });
        saveAirportCache();
        return answer();
      })
      .catch(function () { return answer(); });
  }

  /** Registration → type name, from the SAME file the relay reads
   *  (aircraft_registry.json) so both paths print identical type strings.
   *  ~16 KB over the wire compressed, then HTTP-cached — cheaper than one
   *  relay round trip, and it is paid once per browser rather than per load. */
  function loadTypeNames() {
    if (_typeByReg) return Promise.resolve(_typeByReg);
    return fetchT('/aircraft_registry.json').then(function (r) { return r.json(); }).then(function (json) {
      _typeByReg = {};
      Object.keys(json || {}).forEach(function (airline) {
        Object.keys(json[airline] || {}).forEach(function (bucket) {
          var list = json[airline][bucket];
          if (!Array.isArray(list)) return;
          list.forEach(function (frame) {
            if (frame && frame.registration && frame.aircraftType) {
              _typeByReg[String(frame.registration).toUpperCase()] = frame.aircraftType;
            }
          });
        });
      });
      return _typeByReg;
    }).catch(function () { _typeByReg = {}; return _typeByReg; });
  }

  // The IF org's own type for tails the Planespotters scrape behind
  // aircraft_registry.json does not list, or lists as a different real-world
  // airframe (VT-JRA: A350-900 in the scrape, A350-1000 in the org). It
  // OUTRANKS the registry, which stays real airframes. MUST equal
  // ORG_TYPE_OVERRIDES in lib/api-handlers/fleet-pilot.js
  // (tests/calc/fleetTypeOverrides.test.js).
  var ORG_TYPE_OVERRIDES = {
    'VT-BWE': 'Boeing 737 MAX 8',
    'VT-AWB': 'Boeing 787-9 Dreamliner',
    'VT-AWC': 'Boeing 787-9 Dreamliner',
    'VT-JRA': 'Airbus A350-1000',
    'VT-JRP': 'Airbus A350-1000',
  };

  function typeNameFor(registration) {
    var reg = String(registration || '').toUpperCase();
    return ORG_TYPE_OVERRIDES[reg] || (_typeByReg && _typeByReg[reg]) || null;
  }


  // ── static wiring ───────────────────────────────────────────────────────
  // The sign-in button is the only control this file owns now; everything
  // else on the page belongs to the Fleet Home and reaches us through the
  // bridge below (its SIGN OUT is #fhSignOut, not #btnSignOut).
  $('btnSignIn').addEventListener('click', startSignIn);

  // ── bridge for the Fleet Home (assets/js/fleet-mode-home.js) ────────────
  // The home renders the fleet; the auth/token handling and the IF calls stay
  // owned by this file. openBooking/openHome were removed with the booking
  // flow — the home no longer has anywhere to hand off to.
  window.INVA_FLEET = {
    getAuth: function () { return state.auth; },
    getAirports: function () { return _airports; },
    reload: loadFleet,
    reloadTail: reloadTail,
    loadTailHistory: loadTailHistory,
    signOut: function () { signOut(false); },
    // Authenticated relay for the home's own calls. Any route that reads IF on
    // the pilot's behalf needs the bearer token, and this is the only path that
    // carries it AND refreshes on a 401 — an IF token lasts ~30 min, so a tab
    // left open outlives it. Routes authenticated purely by the HMAC
    // identity (Guide / LegAlert / Dispatch / FlightBag) do NOT need this and use a plain
    // fetch; anything touching the fleet does.
    api: function (url, opts) { return apiFetch(url, opts); },

    /** Test seam — the request clocks, which have no other way in.
     *  tests/calc/fleetNetTimeouts.test.js. */
    _net: {
      fetchT: fetchT,
      withDeadline: withDeadline,
      REQ_TIMEOUT_MS: REQ_TIMEOUT_MS,
      FLEET_LOAD_TIMEOUT_MS: FLEET_LOAD_TIMEOUT_MS,
    },
  };

  // ── boot ────────────────────────────────────────────────────────────────
  // A stored session is resumed silently. An access token only lasts ~30 min,
  // so a returning pilot's is essentially always spent — renew it BEFORE the
  // board paints, rather than letting the first read 401 and recover, so the
  // sign-in card never flashes past on a session that is actually fine.
  armAuthSync();
  state.auth = loadAuth();
  if (state.auth && state.auth.accessToken) {
    // Config and Flex state need no token: ask now so they overlap the refresh.
    prefetchEarly();
    // Last-known board: paint it now, labelled, while the real read runs. The
    // sign-in card stays hidden through a token renewal; a failed renewal ends
    // in signOut(true), which hides the home and shows the card again.
    var cached = window.INVA_FLEET_HOME && window.INVA_FLEET_HOME.preview ? loadBoard() : null;
    if (cached) {
      signinView.hidden = true;
      try { window.INVA_FLEET_HOME.preview(cached); } catch (e) {
        try { window.INVA_FLEET_HOME.hide(); } catch (e2) {}
        signinView.hidden = false;
      }
    }
    if (state.auth.expiresAt && Date.now() >= state.auth.expiresAt) {
      showSignInBusy(true, 'Restoring your session…');
      ensureFreshAuth().then(function (ok) {
        showSignInBusy(false);
        if (ok) showApp(); else armOAuthListeners();
      });
    } else {
      showApp();
    }
  } else {
    armOAuthListeners();
  }
})();
