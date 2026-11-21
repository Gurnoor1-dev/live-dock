/* INVA_ESC — the one HTML escaper (security-hardening P5). Load FIRST on every page. */
(function (root) {
  'use strict';
  var MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
  function html(v) {
    return String(v == null ? '' : v).replace(/[&<>"'`]/g, function (c) { return MAP[c]; });
  }
  // Same escaping; named separately so attribute call sites read as intended.
  var attr = html;
  // https: URLs and same-origin relative paths pass through; anything else becomes '#'.
  function url(v) {
    var s = String(v == null ? '' : v).trim();
    if (!s) return '#';
    if (/[\u0000-\u001f]/.test(s)) return '#';
    if (/^\/(?![\/\x5c])/.test(s)) return s;
    if (/^(\.{1,2}\/|\?|#)/.test(s)) return s;
    if (/^[a-z][a-z0-9+.-]*:/i.test(s)) {
      return /^https:\/\//i.test(s) ? s : '#';
    }
    if (/^\/\//.test(s) || s.indexOf(String.fromCharCode(92)) !== -1) return '#';
    return s;
  }
  var api = { html: html, attr: attr, url: url };
  root.INVA_ESC = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
