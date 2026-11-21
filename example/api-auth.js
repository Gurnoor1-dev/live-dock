/**
 * api-auth.js — attaches the caller's credential to the upstream-spending
 * proxies (/api/generateFlightPlan, /api/fetchOfp*, /api/infiniteFlight,
 * /api/ifOps, /api/lookupAircraft, /api/tools?__route=ifTracks).
 *
 *   window.invaAuthHeaders(extra)  -> Promise<headers>   (Authorization or X-Fleet-Identity)
 *   window.invaAuthFetch(url, opts) -> fetch with those headers
 *
 * Career pages send the Firebase ID token; Fleet Mode (no Firebase session)
 * sends the signed followIdentity it keeps in localStorage.fleetModeAuth.
 * The server accepts either (lib/proxy-auth.js). Never throws: with no
 * credential it sends the request bare and the server answers 401.
 */
(function () {
  'use strict';

  function fleetIdentity() {
    try {
      if (window.INVA_FLEET && typeof window.INVA_FLEET.getAuth === 'function') {
        var a = window.INVA_FLEET.getAuth();
        if (a && a.followIdentity) return a.followIdentity;
      }
      var raw = window.localStorage && window.localStorage.getItem('fleetModeAuth');
      var stored = raw ? JSON.parse(raw) : null;
      return (stored && stored.followIdentity) || '';
    } catch (e) { return ''; }
  }

  function firebaseUser() {
    try {
      if (typeof firebase === 'undefined' || !firebase.auth) return Promise.resolve(null);
      var auth = firebase.auth();
      if (auth.currentUser) return Promise.resolve(auth.currentUser);
      // Session still restoring on a fresh page load: wait briefly for it.
      return new Promise(function (resolve) {
        var done = false;
        var off = auth.onAuthStateChanged(function (u) {
          if (done) return;
          done = true;
          try { off(); } catch (e) {}
          resolve(u || null);
        }, function () { if (!done) { done = true; resolve(null); } });
        setTimeout(function () { if (!done) { done = true; try { off(); } catch (e) {} resolve(null); } }, 2500);
      });
    } catch (e) { return Promise.resolve(null); }
  }

  async function invaAuthHeaders(extra) {
    var headers = Object.assign({}, extra || {});
    try {
      var user = await firebaseUser();
      if (user && typeof user.getIdToken === 'function') {
        headers['Authorization'] = 'Bearer ' + (await user.getIdToken());
        return headers;
      }
    } catch (e) { /* fall through to the Fleet identity */ }
    var id = fleetIdentity();
    if (id) headers['X-Fleet-Identity'] = id;
    return headers;
  }

  async function invaAuthFetch(url, opts) {
    var o = Object.assign({}, opts || {});
    o.headers = await invaAuthHeaders(o.headers);
    return fetch(url, o);
  }

  window.invaAuthHeaders = invaAuthHeaders;
  window.invaAuthFetch = invaAuthFetch;
})();
