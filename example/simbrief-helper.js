/**
 * SimBrief Helper Functions.
 * Replicates the PHP demo's JavaScript functionality (simbrief.apiv1.js)
 * Used for form-based submission and popup monitoring.
 */

// Global variables (matching PHP demo structure)
let sbworker = null;
let SBloop = null;
let ofp_id = null;
let timestamp = null;
let outputpage_save = null;
let api_code = null;

const sbworkerid = 'SBworker';
const sbworkerstyle = 'width=600,height=315';

/**
 * MD5 hash function (truncated to 10 characters like PHP demo)
 * Based on phpjs.org MD5 implementation
 */
function md5(str) {
  // UTF8 encode helper
  function utf8_encode(argString) {
    if (argString === null || typeof argString === 'undefined') {
      return '';
    }
    var string = (argString + '');
    var utftext = '';
    var start, end, stringl = 0;

    start = end = 0;
    stringl = string.length;
    for (var n = 0; n < stringl; n++) {
      var c1 = string.charCodeAt(n);
      var enc = null;

      if (c1 < 128) {
        end++;
      } else if (c1 > 127 && c1 < 2048) {
        enc = String.fromCharCode(
          (c1 >> 6) | 192, (c1 & 63) | 128
        );
      } else if ((c1 & 0xF800) != 0xD800) {
        enc = String.fromCharCode(
          (c1 >> 12) | 224, ((c1 >> 6) & 63) | 128, (c1 & 63) | 128
        );
      } else {
        if ((c1 & 0xFC00) != 0xD800) {
          throw new RangeError('Unmatched trail surrogate at ' + n);
        }
        var c2 = string.charCodeAt(++n);
        if ((c2 & 0xFC00) != 0xDC00) {
          throw new RangeError('Unmatched lead surrogate at ' + (n - 1));
        }
        c1 = ((c1 & 0x3FF) << 10) + (c2 & 0x3FF) + 0x10000;
        enc = String.fromCharCode(
          (c1 >> 18) | 240, ((c1 >> 12) & 63) | 128, ((c1 >> 6) & 63) | 128, (c1 & 63) | 128
        );
      }
      if (enc !== null) {
        if (end > start) {
          utftext += string.slice(start, end);
        }
        utftext += enc;
        start = end = n + 1;
      }
    }

    if (end > start) {
      utftext += string.slice(start, stringl);
    }

    return utftext;
  }

  // MD5 implementation (simplified for 10-character hash)
  function rotateLeft(lValue, iShiftBits) {
    return (lValue << iShiftBits) | (lValue >>> (32 - iShiftBits));
  }

  function addUnsigned(lX, lY) {
    var lX4, lY4, lX8, lY8, lResult;
    lX8 = (lX & 0x80000000);
    lY8 = (lY & 0x80000000);
    lX4 = (lX & 0x40000000);
    lY4 = (lY & 0x40000000);
    lResult = (lX & 0x3FFFFFFF) + (lY & 0x3FFFFFFF);
    if (lX4 & lY4) {
      return (lResult ^ 0x80000000 ^ lX8 ^ lY8);
    }
    if (lX4 | lY4) {
      if (lResult & 0x40000000) {
        return (lResult ^ 0xC0000000 ^ lX8 ^ lY8);
      } else {
        return (lResult ^ 0x40000000 ^ lX8 ^ lY8);
      }
    } else {
      return (lResult ^ lX8 ^ lY8);
    }
  }

  function _F(x, y, z) { return (x & y) | ((~x) & z); }
  function _G(x, y, z) { return (x & z) | (y & (~z)); }
  function _H(x, y, z) { return (x ^ y ^ z); }
  function _I(x, y, z) { return (y ^ (x | (~z))); }

  function _FF(a, b, c, d, x, s, ac) {
    a = addUnsigned(a, addUnsigned(addUnsigned(_F(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }

  function _GG(a, b, c, d, x, s, ac) {
    a = addUnsigned(a, addUnsigned(addUnsigned(_G(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }

  function _HH(a, b, c, d, x, s, ac) {
    a = addUnsigned(a, addUnsigned(addUnsigned(_H(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }

  function _II(a, b, c, d, x, s, ac) {
    a = addUnsigned(a, addUnsigned(addUnsigned(_I(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }

  function convertToWordArray(str) {
    var lWordCount;
    var lMessageLength = str.length;
    var lNumberOfWords_temp1 = lMessageLength + 8;
    var lNumberOfWords_temp2 = (lNumberOfWords_temp1 - (lNumberOfWords_temp1 % 64)) / 64;
    var lNumberOfWords = (lNumberOfWords_temp2 + 1) * 16;
    var lWordArray = new Array(lNumberOfWords - 1);
    var lBytePosition = 0;
    var lByteCount = 0;
    while (lByteCount < lMessageLength) {
      lWordCount = (lByteCount - (lByteCount % 4)) / 4;
      lBytePosition = (lByteCount % 4) * 8;
      lWordArray[lWordCount] = (lWordArray[lWordCount] | (str.charCodeAt(lByteCount) << lBytePosition));
      lByteCount++;
    }
    lWordCount = (lByteCount - (lByteCount % 4)) / 4;
    lBytePosition = (lByteCount % 4) * 8;
    lWordArray[lWordCount] = lWordArray[lWordCount] | (0x80 << lBytePosition);
    lWordArray[lNumberOfWords - 2] = lMessageLength << 3;
    lWordArray[lNumberOfWords - 1] = lMessageLength >>> 29;
    return lWordArray;
  }

  function wordToHex(lValue) {
    var wordToHexValue = '';
    var wordToHexValue_temp = '';
    var lByte, lCount;
    for (lCount = 0; lCount <= 3; lCount++) {
      lByte = (lValue >>> (lCount * 8)) & 255;
      wordToHexValue_temp = '0' + lByte.toString(16);
      wordToHexValue = wordToHexValue + wordToHexValue_temp.substr(wordToHexValue_temp.length - 2, 2);
    }
    return wordToHexValue;
  }

  var x = [], k, AA, BB, CC, DD, a, b, c, d,
    S11 = 7, S12 = 12, S13 = 17, S14 = 22,
    S21 = 5, S22 = 9, S23 = 14, S24 = 20,
    S31 = 4, S32 = 11, S33 = 16, S34 = 23,
    S41 = 6, S42 = 10, S43 = 15, S44 = 21;

  str = utf8_encode(str);
  x = convertToWordArray(str);
  a = 0x67452301;
  b = 0xEFCDAB89;
  c = 0x98BADCFE;
  d = 0x10325476;

  var xl = x.length;
  for (k = 0; k < xl; k += 16) {
    AA = a; BB = b; CC = c; DD = d;
    a = _FF(a, b, c, d, x[k + 0], S11, 0xD76AA478);
    d = _FF(d, a, b, c, x[k + 1], S12, 0xE8C7B756);
    c = _FF(c, d, a, b, x[k + 2], S13, 0x242070DB);
    b = _FF(b, c, d, a, x[k + 3], S14, 0xC1BDCEEE);
    a = _FF(a, b, c, d, x[k + 4], S11, 0xF57C0FAF);
    d = _FF(d, a, b, c, x[k + 5], S12, 0x4787C62A);
    c = _FF(c, d, a, b, x[k + 6], S13, 0xA8304613);
    b = _FF(b, c, d, a, x[k + 7], S14, 0xFD469501);
    a = _FF(a, b, c, d, x[k + 8], S11, 0x698098D8);
    d = _FF(d, a, b, c, x[k + 9], S12, 0x8B44F7AF);
    c = _FF(c, d, a, b, x[k + 10], S13, 0xFFFF5BB1);
    b = _FF(b, c, d, a, x[k + 11], S14, 0x895CD7BE);
    a = _FF(a, b, c, d, x[k + 12], S11, 0x6B901122);
    d = _FF(d, a, b, c, x[k + 13], S12, 0xFD987193);
    c = _FF(c, d, a, b, x[k + 14], S13, 0xA679438E);
    b = _FF(b, c, d, a, x[k + 15], S14, 0x49B40821);
    a = _GG(a, b, c, d, x[k + 1], S21, 0xF61E2562);
    d = _GG(d, a, b, c, x[k + 6], S22, 0xC040B340);
    c = _GG(c, d, a, b, x[k + 11], S23, 0x265E5A51);
    b = _GG(b, c, d, a, x[k + 0], S24, 0xE9B6C7AA);
    a = _GG(a, b, c, d, x[k + 5], S21, 0xD62F105D);
    d = _GG(d, a, b, c, x[k + 10], S22, 0x2441453);
    c = _GG(c, d, a, b, x[k + 15], S23, 0xD8A1E681);
    b = _GG(b, c, d, a, x[k + 4], S24, 0xE7D3FBC8);
    a = _GG(a, b, c, d, x[k + 9], S21, 0x21E1CDE6);
    d = _GG(d, a, b, c, x[k + 14], S22, 0xC33707D6);
    c = _GG(c, d, a, b, x[k + 3], S23, 0xF4D50D87);
    b = _GG(b, c, d, a, x[k + 8], S24, 0x455A14ED);
    a = _GG(a, b, c, d, x[k + 13], S21, 0xA9E3E905);
    d = _GG(d, a, b, c, x[k + 2], S22, 0xFCEFA3F8);
    c = _GG(c, d, a, b, x[k + 7], S23, 0x676F02D9);
    b = _GG(b, c, d, a, x[k + 12], S24, 0x8D2A4C8A);
    a = _HH(a, b, c, d, x[k + 5], S31, 0xFFFA3942);
    d = _HH(d, a, b, c, x[k + 8], S32, 0x8771F681);
    c = _HH(c, d, a, b, x[k + 11], S33, 0x6D9D6122);
    b = _HH(b, c, d, a, x[k + 14], S34, 0xFDE5380C);
    a = _HH(a, b, c, d, x[k + 1], S31, 0xA4BEEA44);
    d = _HH(d, a, b, c, x[k + 4], S32, 0x4BDECFA9);
    c = _HH(c, d, a, b, x[k + 7], S33, 0xF6BB4B60);
    b = _HH(b, c, d, a, x[k + 10], S34, 0xBEBFBC70);
    a = _HH(a, b, c, d, x[k + 13], S31, 0x289B7EC6);
    d = _HH(d, a, b, c, x[k + 0], S32, 0xEAA127FA);
    c = _HH(c, d, a, b, x[k + 3], S33, 0xD4EF3085);
    b = _HH(b, c, d, a, x[k + 6], S34, 0x4881D05);
    a = _HH(a, b, c, d, x[k + 9], S31, 0xD9D4D039);
    d = _HH(d, a, b, c, x[k + 12], S32, 0xE6DB99E5);
    c = _HH(c, d, a, b, x[k + 15], S33, 0x1FA27CF8);
    b = _HH(b, c, d, a, x[k + 2], S34, 0xC4AC5665);
    a = _II(a, b, c, d, x[k + 0], S41, 0xF4292244);
    d = _II(d, a, b, c, x[k + 7], S42, 0x432AFF97);
    c = _II(c, d, a, b, x[k + 14], S43, 0xAB9423A7);
    b = _II(b, c, d, a, x[k + 5], S44, 0xFC93A039);
    a = _II(a, b, c, d, x[k + 12], S41, 0x655B59C3);
    d = _II(d, a, b, c, x[k + 3], S42, 0x8F0CCC92);
    c = _II(c, d, a, b, x[k + 10], S43, 0xFFEFF47D);
    b = _II(b, c, d, a, x[k + 1], S44, 0x85845DD1);
    a = _II(a, b, c, d, x[k + 8], S41, 0x6FA87E4F);
    d = _II(d, a, b, c, x[k + 15], S42, 0xFE2CE6E0);
    c = _II(c, d, a, b, x[k + 6], S43, 0xA3014314);
    b = _II(b, c, d, a, x[k + 13], S44, 0x4E0811A1);
    a = _II(a, b, c, d, x[k + 4], S41, 0xF7537E82);
    d = _II(d, a, b, c, x[k + 11], S42, 0xBD3AF235);
    c = _II(c, d, a, b, x[k + 2], S43, 0x2AD7D2BB);
    b = _II(b, c, d, a, x[k + 9], S44, 0xEB86D391);
    a = addUnsigned(a, AA);
    b = addUnsigned(b, BB);
    c = addUnsigned(c, CC);
    d = addUnsigned(d, DD);
  }

  var temp = wordToHex(a) + wordToHex(b) + wordToHex(c) + wordToHex(d);
  // Return first 10 characters (uppercase) like PHP demo
  return temp.toUpperCase().substr(0, 10);
}

/**
 * Launch SimBrief worker popup window
 */
function LaunchSBworker() {
  sbworker = window.open('about:blank', sbworkerid, sbworkerstyle);

  // Test for popup blockers
  if (sbworker == null || typeof(sbworker) == 'undefined') {
    alert('Please disable your pop-up blocker to generate a flight plan!');
    return false;
  } else {
    if (window.focus) {
      sbworker.focus();
    }
  }
  return true;
}

/**
 * Open the SimBrief popup during the original user gesture.
 * iOS Safari is strict about delayed popup creation after async work.
 */
function prepareSBworkerPlaceholder() {
  const popup = window.open('about:blank', sbworkerid, sbworkerstyle);

  if (popup == null || typeof(popup) == 'undefined') {
    return null;
  }

  try {
    popup.document.title = 'Preparing SimBrief...';
    popup.document.body.innerHTML = '<p style="font-family: sans-serif; padding: 16px;">Preparing SimBrief dispatcher...</p>';
    if (window.focus) {
      popup.focus();
    }
  } catch (error) {
    console.warn('Could not write placeholder content to SimBrief popup:', error);
  }

  return popup;
}

/**
 * Check if SimBrief worker popup is closed
 */
function checkSBworker() {
  if (sbworker && sbworker.closed) {
    window.clearInterval(SBloop);
    Redirect_caller();
  }
}

/**
 * When to look for the OFP after the popup reads closed. The PHP demo checked
 * ONCE, at once, and gave up on a miss — and the popup often reads `closed`
 * long before SimBrief is done (every iPhone dispatch, many desktop ones):
 * prod logs 2026-11-12..14 had ~30 checks fired 1–4 s after submit, all
 * missed, all of those OFPs generated fine; every check at 8 s+ found its OFP.
 *   - the first check waits until FIRST_MS after the submit;
 *   - a miss retries after each RETRY_MS step — 5 checks at most, because
 *     /api/fetchOfpById (exists included) is capped at 20/h per caller;
 *   - a hidden tab never checks: it waits to be shown again (iOS: the pilot
 *     coming back from the SimBrief tab), and a hidden wait spends no retry.
 */
const OFP_WATCH = { FIRST_MS: 8000, RETRY_MS: [4000, 8000, 15000, 30000] };
let ofpWatchRun = 0;    // bumped by every submit: an older watch stops
let ofpSubmitAt = 0;

/**
 * Look for the OFP until it exists (then deps.go(url)) or the retries run out
 * (then deps.onMissing()). Pure on `deps` so it is testable without a browser:
 *   now(), wait(ms, fn), hidden(), onVisible(fn), exists() → Promise<boolean|'limited'|'denied'>,
 *   isCurrent() → false once a newer dispatch started, go(), onMissing().
 */
function watchForOfp(submitAt, deps) {
  let retry = 0;
  function tick() {
    if (!deps.isCurrent()) return;
    if (deps.hidden()) { deps.onVisible(tick); return; }
    Promise.resolve().then(deps.exists).catch(function () { return false; }).then(function (found) {
      if (!deps.isCurrent()) return;
      if (found === true) { deps.go(); return; }
      // Rate-limited or refused: another try would be refused too, and so
      // would the viewer.
      if (found === 'limited' || found === 'denied' || retry >= OFP_WATCH.RETRY_MS.length) { deps.onMissing(found); return; }
      deps.wait(OFP_WATCH.RETRY_MS[retry++], tick);
    });
  }
  deps.wait(Math.max(0, submitAt + OFP_WATCH.FIRST_MS - deps.now()), tick);
}

/**
 * Redirect to output page with OFP ID (after popup closes).
 * Replaces the PHP demo's Redirect_caller() one-shot check — see OFP_WATCH.
 */
function Redirect_caller() {
  const run = ofpWatchRun;
  const id = ofp_id;
  const outputPage = outputpage_save;
  if (!id || !outputPage) return;
  watchForOfp(ofpSubmitAt, {
    now: function () { return Date.now(); },
    wait: function (ms, fn) { setTimeout(fn, ms); },
    hidden: function () { return typeof document !== 'undefined' && document.hidden === true; },
    onVisible: function (fn) {
      function shown() {
        if (document.hidden) return;
        document.removeEventListener('visibilitychange', shown);
        fn();
      }
      document.addEventListener('visibilitychange', shown);
    },
    exists: async function () {
      const response = await window.invaAuthFetch(`/api/fetchOfpById?action=exists&ofp_id=${encodeURIComponent(id)}`);
      // Retrying cannot cure these: rate limit, or a caller the API refuses.
      if (response.status === 429) return 'limited';
      if (response.status === 401 || response.status === 403) return 'denied';
      const result = await response.json();
      return result.exists === true;
    },
    isCurrent: function () { return run === ofpWatchRun; },
    go: function () {
      const url = new URL(outputPage, window.location.origin);
      url.searchParams.set('ofp_id', id);
      window.location.href = url.toString();
    },
    onMissing: function (why) {
      // Say so: a silent stop is what left pilots on the page wondering.
      console.log('OFP not found after the SimBrief popup closed:', id);
      try {
        window.dispatchEvent(new CustomEvent('simbrief:ofp-missing', { detail: { ofpId: id, limited: why === 'limited' } }));
      } catch (e) { /* old browser — the console line stands */ }
    },
  });
}

/**
 * Submit flight plan to SimBrief via form
 * Replicates PHP demo's simbriefsubmit() function
 */
async function simbriefSubmitWithForm(formData, outputPage, existingPopup = null) {
  // Clean up any prior requests
  if (sbworker && sbworker !== existingPopup) {
    sbworker.close();
  }
  if (SBloop) {
    window.clearInterval(SBloop);
  }

  // Reset variables. A new dispatch ends any watch still waiting on the last.
  ofpWatchRun++;
  api_code = null;
  ofp_id = null;
  timestamp = null;
  outputpage_save = null;

  // Set output page (use current origin if relative)
  if (outputPage == null || outputPage == false) {
    outputPage = window.location.href;
  }

  outputpage_save = outputPage;
  
  // Remove protocol from outputpage for API code calculation
  let outputpage_calc = outputPage.replace(/^https?:\/\//, '');

  // Get API code and timestamp from server
  try {
    const response = await window.invaAuthFetch(`/api/generateFlightPlan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ...formData,
        outputPageUrl: outputpage_calc
        // Don't pass timestamp - let API generate it
      })
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.message || 'Failed to generate API code');
    }

    // Store API code and timestamp from server response
    api_code = result.apiCode;
    timestamp = result.timestamp;

    // Calculate OFP ID (same as PHP demo)
    // Format: timestamp_hash where hash = MD5(orig + dest + type).substr(0,10)
    const hashInput = formData.orig.toUpperCase() + formData.dest.toUpperCase() + formData.type.toUpperCase();
    const hash = md5(hashInput);
    ofp_id = timestamp + '_' + hash;

    // Create hidden form and submit to SimBrief
    const sbworkerurl = 'https://www.simbrief.com/ofp/ofp.loader.api.php';
    
    // Create form element
    const form = document.createElement('form');
    form.setAttribute('method', 'get');
    form.setAttribute('action', sbworkerurl);
    form.setAttribute('target', sbworkerid);
    form.style.display = 'none';

    // Add all form parameters
    const params = {
      apicode: api_code,
      outputpage: outputpage_calc,
      timestamp: timestamp,
      orig: formData.orig.toUpperCase(),
      dest: formData.dest.toUpperCase(),
      type: formData.type.toUpperCase(),
      ...(formData.route && { route: formData.route }),
      ...(formData.fltnum && { fltnum: formData.fltnum }),
      ...(formData.airline && { airline: formData.airline }),
      ...(formData.units && { units: formData.units }),
      ...(formData.contpct && { contpct: formData.contpct }),
      ...(formData.resvrule && { resvrule: formData.resvrule }),
      ...(formData.navlog !== undefined && { navlog: formData.navlog }),
      ...(formData.etops !== undefined && { etops: formData.etops }),
      ...(formData.stepclimbs !== undefined && { stepclimbs: formData.stepclimbs }),
      ...(formData.tlr !== undefined && { tlr: formData.tlr }),
      ...(formData.notams !== undefined && { notams: formData.notams }),
      ...(formData.firnot !== undefined && { firnot: formData.firnot }),
      ...(formData.maps && { maps: formData.maps }),
      ...(formData.date && { date: formData.date }),
      ...(formData.deph !== undefined && { deph: formData.deph }),
      ...(formData.depm !== undefined && { depm: formData.depm }),
      ...(formData.reg && { reg: formData.reg }),
      // Departure runway and a per-tail airframe's inputs (Fleet Mode,
      // assets/js/fleet-dispatch.js). Career never sets them, so its request
      // is unchanged. acdata is a JSON string; the GET form URL-encodes it.
      ...(formData.origrwy && { origrwy: formData.origrwy }),
      ...(formData.fin && { fin: formData.fin }),
      ...(formData.selcal && { selcal: formData.selcal }),
      ...(formData.fuelfactor && { fuelfactor: formData.fuelfactor }),
      ...(formData.civalue && { civalue: formData.civalue }),
      ...(formData.cruise && { cruise: formData.cruise }),
      ...(formData.climb && { climb: formData.climb }),
      ...(formData.descent && { descent: formData.descent }),
      ...(formData.etopsrule && { etopsrule: formData.etopsrule }),
      ...(formData.manualrmk && { manualrmk: formData.manualrmk }),
      ...(formData.acdata && { acdata: formData.acdata }),
      // Explicit passenger count (fleet-based sampling — see the REALISTIC
      // PASSENGER LOADS section below). Absent ⇒ SimBrief AUTO load as before.
      ...(formData.pax && { pax: formData.pax })
    };

    // Add hidden inputs to form
    for (const [key, value] of Object.entries(params)) {
      const input = document.createElement('input');
      input.setAttribute('type', 'hidden');
      input.setAttribute('name', key);
      input.setAttribute('value', value);
      form.appendChild(input);
    }

    // Append form to body
    document.body.appendChild(form);

    // Reuse a popup opened during the original click when available.
    if (existingPopup && !existingPopup.closed) {
      sbworker = existingPopup;
    } else if (!LaunchSBworker()) {
      document.body.removeChild(form);
      return false;
    }

    // Set window name for popup communication
    window.name = 'SBcaller';

    // Submit form (opens in popup)
    form.submit();
    ofpSubmitAt = Date.now();

    // Remove form from DOM
    setTimeout(() => {
      document.body.removeChild(form);
    }, 100);

    // Start monitoring loop to detect when popup closes
    SBloop = window.setInterval(checkSBworker, 500);

    return true;
  } catch (error) {
    console.error('Error submitting to SimBrief:', error);
    return false;
  }
}

/* ================================================================
   REALISTIC PASSENGER LOADS — ONE SEAT NUMBER PER TAIL
   ================================================================
   SimBrief is given an explicit pax count per dispatch instead of its own
   AUTO load. The count is sampled from a per-aircraft occupancy distribution
   against the TAIL's seats, INVACalc.resolveTailSeats (invaCalc.js): the
   career aircraft doc's seats/seatConfig, else the tail's fleet.json cabin,
   else the airline x type default (airline = INVACalc.routeAirline of the
   flight number), else the type cap. PIREP approval resolves the same number
   server-side for the payload bonus, so a full flight is a full load factor.
   invaCalc.js must be loaded before this file is used (dashboard, OFP viewer
   and Fleet Mode all load it); without it no pax is sampled (SimBrief AUTO).
   The sampled pax lands in the OFP as weights.pax_count → saved on the
   flightplans doc as passengerCount → what PIREP auto-approval matches
   (±3, lib/auto-approval.js). Sampling here changes nothing there — the
   pilot still files the pax printed on their OFP.
   ================================================================ */

// Occupancy distributions: bucket → probability (sums to 1.0). A bucket keyed
// "lo-hi" samples uniformly inside it; "1.00" is the full-flight bucket.
const PAX_OCC_NARROW = { '0.80-0.84': 0.05, '0.85-0.89': 0.20, '0.90-0.94': 0.45, '0.95-0.99': 0.25, '1.00': 0.05 };
const PAX_OCC_WIDE   = { '0.82-0.86': 0.05, '0.87-0.91': 0.20, '0.92-0.95': 0.45, '0.96-0.99': 0.25, '1.00': 0.05 };

// Occupancy profile + label per type. NO seat counts here — the seats come
// from INVACalc.resolveTailSeats (one number per tail). A type without a
// profile gets no sampled pax (SimBrief AUTO).
const FLEET_SEAT_CONFIGS = {
  'A319': { label: 'A319',               occupancy: PAX_OCC_NARROW },
  'A320': { label: 'A320ceo',            occupancy: PAX_OCC_NARROW },
  'A20N': { label: 'A320neo',            occupancy: PAX_OCC_NARROW },
  'A321': { label: 'A321',               occupancy: PAX_OCC_NARROW },
  'A21N': { label: 'A321neo',            occupancy: PAX_OCC_NARROW },
  'A359': { label: 'A350-900',           occupancy: PAX_OCC_WIDE },
  'A35K': { label: 'A350-1000',          occupancy: PAX_OCC_WIDE },
  'B38M': { label: 'B737 MAX 8',         occupancy: PAX_OCC_NARROW },
  'B738': { label: 'B737-800',           occupancy: PAX_OCC_NARROW },
  'B744': { label: 'B747-400',           occupancy: PAX_OCC_NARROW },
  'B77L': { label: 'B777-200LR',         occupancy: PAX_OCC_NARROW },
  'B77W': { label: 'B777-300ER',         occupancy: PAX_OCC_WIDE },
  'B788': { label: 'B787-8',             occupancy: PAX_OCC_NARROW },
  'B789': { label: 'B787-9',             occupancy: PAX_OCC_WIDE },
  'AT72': { label: 'ATR 72',             occupancy: PAX_OCC_NARROW },
};

// Profile aliases. routes.json and the sector builder call the A350-900
// fleet "A350" (see the note in lib/irl-schedule/parse-schedule.js).
const SEAT_CONFIG_ALIASES = {
  'A350': 'A359',   // this app's internal code for the A350-900 fleet
  'B39M': 'B738',
  'AT75': 'AT72',
  'AT76': 'AT72'
};

// fleet.json, fetched once per page and shared by every seat lookup. Never
// rejects: a failed fetch resolves null (the airline x type default applies).
let _seatFleetData = null;
let _seatFleetLoad = null;
function loadSeatFleetData() {
  if (_seatFleetData) return Promise.resolve(_seatFleetData);
  if (_seatFleetLoad) return _seatFleetLoad;
  try {
    if (typeof fetch !== 'function') return Promise.resolve(null);
    _seatFleetLoad = Promise.resolve(fetch('/fleet.json'))
      .then((r) => (r && r.ok ? r.json() : null))
      .then((data) => { _seatFleetData = (data && typeof data === 'object') ? data : null; return _seatFleetData; })
      .catch(() => { _seatFleetLoad = null; return null; });
    return _seatFleetLoad;
  } catch (e) {
    return Promise.resolve(null);
  }
}

// The tail's seats, or null. `opts` = { tail, aircraftDoc, fleetData }.
// Synchronous: uses fleet.json only once loadSeatFleetData() has resolved —
// dispatch callers use dispatchPax(), which waits for it.
function tailSeatCount(flightNumber, aircraftType, opts) {
  const C = (typeof window !== 'undefined' && window.INVACalc) || null;
  if (!C || typeof C.resolveTailSeats !== 'function') return null;
  const o = opts || {};
  const r = C.resolveTailSeats({
    tail: o.tail || null,
    type: aircraftType,
    routeId: flightNumber,
    aircraftDoc: o.aircraftDoc || null,
    fleetData: o.fleetData || _seatFleetData,
  });
  return r && r.seats > 0 ? r.seats : null;
}

// { label, occupancy, seats } for a dispatch, or null (no profile / no seats).
function resolveSeatConfig(flightNumber, aircraftType, opts) {
  const raw = String(aircraftType || '').toUpperCase().trim();
  const profile = FLEET_SEAT_CONFIGS[SEAT_CONFIG_ALIASES[raw] || raw];
  if (!profile) return null;
  const seats = tailSeatCount(flightNumber, raw, opts);
  return seats ? { label: profile.label, occupancy: profile.occupancy, seats } : null;
}

// Weighted-bucket occupancy sample → pax count, clamped to [1, seats].
// rand is injectable for tests; defaults to Math.random.
function samplePaxCount(config, rand) {
  const rnd = typeof rand === 'function' ? rand : Math.random;
  const buckets = Object.entries(config.occupancy);
  let roll = rnd();
  let occ = null;
  for (const [range, prob] of buckets) {
    if (roll < prob) {
      const parts = range.split('-').map(Number);
      occ = parts.length > 1 ? parts[0] + rnd() * (parts[1] - parts[0]) : parts[0];
      break;
    }
    roll -= prob;
  }
  if (occ === null) occ = 1; // float drift past the last bucket ⇒ full flight
  return Math.max(1, Math.min(config.seats, Math.round(config.seats * occ)));
}

/**
 * Passenger count for a dispatch, from flight number (airline) + aircraft
 * type + `opts.tail` / `opts.aircraftDoc` (the tail's seats). Never more than
 * the tail's seats. Returns a positive integer, or null when the type has no
 * profile or no seats — callers then omit the pax param (SimBrief AUTO).
 */
function generateRealisticPax(flightNumber, aircraftType, rand, opts) {
  const config = resolveSeatConfig(flightNumber, aircraftType, opts);
  return config ? samplePaxCount(config, rand) : null;
}

/**
 * Seats in the cabin the pax count was sampled against — the denominator for
 * "142 / 164" style readouts (the OFP viewer's Weights tab) and the seat
 * map's total. Same resolution as generateRealisticPax, so the two can never
 * disagree. Returns null when the type has no profile.
 */
function fleetSeatCapacity(flightNumber, aircraftType, opts) {
  const config = resolveSeatConfig(flightNumber, aircraftType, opts);
  return config ? config.seats : null;
}

/**
 * The dispatch entry point: waits for fleet.json, then samples against the
 * tail's seats. Resolves { pax, seats } (each null when unknown); never rejects.
 */
async function dispatchPax(flightNumber, aircraftType, opts) {
  try {
    await loadSeatFleetData();
    const config = resolveSeatConfig(flightNumber, aircraftType, opts);
    const rand = opts && typeof opts.rand === 'function' ? opts.rand : undefined;
    return config ? { pax: samplePaxCount(config, rand), seats: config.seats } : { pax: null, seats: null };
  } catch (e) {
    return { pax: null, seats: null };
  }
}

// Expose for the dashboard call sites (classic-script globals work there, but
// explicit window attachment also makes this importable/testable in Node).
if (typeof window !== 'undefined') {
  window.generateRealisticPax = generateRealisticPax;
  window.fleetSeatCapacity = fleetSeatCapacity;
  window.dispatchPax = dispatchPax;
  window.loadSeatFleetData = loadSeatFleetData;
  window._simbriefOfpWatch = { watchForOfp, OFP_WATCH };
  window._fleetPaxInternals = {
    FLEET_SEAT_CONFIGS, resolveSeatConfig, samplePaxCount, tailSeatCount,
    setFleetData: (data) => { _seatFleetData = data || null; _seatFleetLoad = null; },
  };
}
