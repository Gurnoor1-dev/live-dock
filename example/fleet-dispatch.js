/**
 * Fleet Mode → SimBrief dispatch: the maps and the form builder.
 * ---------------------------------------------------------------------------
 * Pure. No DOM, no fetch, no side effects — everything here is a lookup or a
 * string transform, so it can be tested in a bare `vm` context the way this
 * repo tests the rest of the browser rules.
 *
 * WHY THE MAPS ARE DUPLICATED FROM assets/js/dashboard.js
 * Career mode's `planWithSimBrief` (dashboard.js:832-1145) declares
 * SIMBRIEF_AIRCRAFT_MAP, AIRLINE_ICAO_MAP and SIMBRIEF_AIRFRAME_MAP inline. That
 * function is the load-bearing career dispatch path, so by owner decision it is
 * NOT refactored to share this module — the copies below are deliberate.
 *
 * The drift guard is therefore a TEST, not the type system:
 * tests/calc/fleetDispatchMaps.test.js slices both literals out of both files as
 * text and asserts they are deep-equal. If you change a map here, change it
 * there, or that test fails. This is the same failure mode CLAUDE.md records for
 * the invaCalc.js ↔ payroll-utils.js slab tables.
 *
 * WHAT THIS MODULE ADDS THAT CAREER DOES NOT HAVE
 * Career reads its aircraft type off a sector doc, where it is already one of a
 * dozen known ICAO codes. Fleet Mode reads it off `typeCode()`
 * (fleet-mode-home.js:418), which recognises a wider set (A20N, A21N, AT76,
 * B78X, A35K…) and falls back to free text for anything the registry does not
 * know. And a fleet leg identifies its operator by an ICAO callsign prefix
 * (AIC173), where the airframe map is keyed by IATA (AI:A320). Hence the two
 * fleet-only tables below.
 *
 * Consumed by assets/js/fleet-mode-home.js (the flight dialog's Dispatch
 * button). Loaded eagerly from fleet-mode.html — see the note there about
 * transient activation.
 */
(function () {
  'use strict';

  // ── duplicated from assets/js/dashboard.js — keep in sync, see header ─────

  /* dashboard.js:882 */
  var SIMBRIEF_AIRCRAFT_MAP = {
    "A319": "A319",
    "A320": "A320",
    "A321": "A321",
    "A20N": "A20N",
    "A21N": "A21N",
    "B738": "B738",
    "B38M": "B38M",
    "B788": "B788",
    "B789": "B789",
    "B77W": "B77W",
    "B77L": "B77L",
    "B744": "B744",
    "A359": "A359",
    "A35K": "A35K",
    "AT72": "AT72"
  };

  /* dashboard.js:1034 */
  var AIRLINE_ICAO_MAP = {
    'AI': 'AIC', // Air India
    'IX': 'AIX', // Air India Express
    '6E': 'IGO', // IndiGo
    'SG': 'SEJ', // SpiceJet
    'UK': 'VTI', // Vistara
    'QP': 'AKJ', // Akasa Air
    'I5': 'IAD', // AirAsia India
    'G8': 'GOW', // Go First
  };

  /* dashboard.js:1050 — SimBrief saved-airframe ids under the INVA account
     (783627), keyed "IATA_prefix:aircraft_type". An airframe id carries the
     real cabin and performance profile; a bare type code does not, which is why
     it is preferred wherever one exists. */
  var SIMBRIEF_AIRFRAME_MAP = {
    'UK:A320': '783627_1771244115844',
    'AI:A320': '783627_1771244196756',
    'AI:A321': '783627_1771244227244',
    'AI:A359': '783627_1771244251002',
    'IX:B738': '783627_1771244311145',
    'IX:B38M': '783627_1771244319317',
    'AI:B788': '783627_1771244362874',
    'UK:B789': '783627_1771244387015',
    'AI:B77L': '783627_1771244498810',
    'AI:B77W': '783627_1771244614291',
    'AI:B744': '783627_1771244627288',
  };

  // ── fleet-only ───────────────────────────────────────────────────────────

  /** ICAO → IATA, DERIVED by inverting AIRLINE_ICAO_MAP rather than typed out.
   *  A second hand-written table is a second thing to keep in step, and this one
   *  would be silently wrong (a dispatch would just miss its airframe id and
   *  fall back to a bare type, which looks like it worked). A test asserts this
   *  is the exact inverse. */
  var AIRLINE_IATA_MAP = (function () {
    var out = {};
    for (var iata in AIRLINE_ICAO_MAP) {
      if (Object.prototype.hasOwnProperty.call(AIRLINE_ICAO_MAP, iata)) {
        out[AIRLINE_ICAO_MAP[iata]] = iata;
      }
    }
    return out;
  })();

  /** Collapse a fleet type code onto the nearest type that has a saved AIRFRAME.
   *
   *  ⚠ This is for the airframe KEY ONLY, never for the `type` we send when no
   *  airframe matches. A20N, A21N and A35K are deliberately NOT here (owner
   *  2026-10-30): a saved airframe carries its type's weights and burn, so the
   *  A320/A321/A359 airframes planned those tails as a ceo / an A350-900. They
   *  fly on SimBrief's own A20N / A21N / A35K profiles instead. */
  var AIRFRAME_ALIASES = {
    'A19N': 'A319',
    'B39M': 'B738',
    'AT76': 'AT72',
    'AT75': 'AT72',
    'A350': 'A359',
    'B78X': 'B789',
  };

  /** PER-TAIL airframes (owner 2026-10-28). A tail listed here is planned on
   *  ITS airframe whatever the callsign or the type map says — it outranks
   *  SIMBRIEF_AIRFRAME_MAP. Fleet-only: career keys by type and is untouched.
   *
   *  Two shapes, because SimBrief shares airframes two ways:
   *    { airframe: '<owner>_<13 digits>' }  a SAVED airframe. Its Internal ID
   *        goes in `type`; its owner's later edits apply, and if the owner
   *        deletes it SimBrief answers "Unknown Aircraft".
   *    { def: {...} }  an ENCODED share link (airframes/share/eyJ…) — the whole
   *        airframe in the URL, with no id. The API cannot load one, so the
   *        definition is kept HERE in the share link's own keys and units (KGS,
   *        as decoded — compare it 1:1 against the link) and customAirframe()
   *        turns it into `type` + `acdata` + the plain inputs. */
  var A21N_TV_LR = {   // VT-TVG / VT-TVH / VT-TVI share one airframe
    basetype: 'A21N', per: 'C', cat: 'M', etopsrange: '180',
    equip: 'SDE2E3FGHIJ1RWXYZ', transponder: 'LB1', pbn: 'A1B1C1D1O1S2', extrarmk: 'RMK/TCAS',
    maxpax: '188', paxwgt: '77', bagwgt: '15',
    oew: '50100', mzfw: '79296', mtow: '97000', mlw: '79200', maxfuel: '26166',
    contpct: '0.05', resvrule: '30', fuelfactor: 'P00',
    defaultcruise: 'CI', defaultclimb: '250/300/78', defaultdescent: '78/300/250',
  };
  function tvTail(fin) {
    var def = { reg: 'VT-' + fin, fin: fin, manualrmk: 'AIRFRAME FOR INVA VT-' + fin };
    for (var k in A21N_TV_LR) def[k] = A21N_TV_LR[k];
    return { def: def };
  }
  var SIMBRIEF_TAIL_AIRFRAMES = {
    'VT-TVG': tvTail('TVG'),
    'VT-TVH': tvTail('TVH'),
    'VT-TVI': tvTail('TVI'),
    // VT-TVA is an A321 CEO in Infinite Flight, although its shared airframe
    // is an A21N. Planned on INVA's saved A321 (ceo weights and burn) with the
    // tail's own identity and cost index from that share link — never the neo
    // weights or its M05 fuel factor, which would under-fuel a ceo.
    'VT-TVA': { airframe: SIMBRIEF_AIRFRAME_MAP['AI:A321'], fin: 'TVA', civalue: '30', manualrmk: 'VT-TVA FOR INVA.' },
    'VT-BWE': { def: {
      basetype: 'B38M', reg: 'VT-BWE', fin: 'BWE', selcal: 'ABCD', hexcode: '801697',
      per: 'D', cat: 'M', etopsrange: '180',
      equip: 'SDE1FGHILORVWXY', transponder: 'HB1', pbn: 'A1B1C1D1L1O1S1S2',
      manualrmk: 'VT-BWE FOR INVA',
      maxpax: '184', paxwgt: '77', bagwgt: '15',
      oew: '45070', mzfw: '68878', mtow: '82600', mlw: '69308', maxfuel: '20730',
      contpct: '0.05', resvrule: '30', fuelfactor: 'P00',
      defaultcruise: 'CI', defaultci: '25', defaultclimb: '250/280/78', defaultdescent: '78/280/250',
    } },
    // Saved airframes (SimBrief account 790832).
    'VT-ALM': { airframe: '790832_1793171175246' },   // 777-300ER
    'VT-ALO': { airframe: '790832_1793171175246' },
    'VT-ALP': { airframe: '790832_1793171175246' },
    'VT-ALR': { airframe: '790832_1793171175246' },
    'VT-ALS': { airframe: '790832_1793171175246' },
    'VT-ALU': { airframe: '790832_1793171175246' },
    'VT-ALX': { airframe: '790832_1793171175246' },
    'VT-AEP': { airframe: '790832_1793171612943' },   // 777-300ER
    'VT-AEQ': { airframe: '790832_1793171612943' },
    'VT-AER': { airframe: '790832_1793171612943' },
    'VT-AEI': { airframe: '790832_1793171932403' },   // 777-200
    'VT-AEF': { airframe: '790832_1793171932403' },
    'VT-ANG': { airframe: '790832_1793173049248' },   // 787-8
    'VT-ANK': { airframe: '790832_1793173049248' },
    'VT-ANL': { airframe: '790832_1793173049248' },
    'VT-ANM': { airframe: '790832_1793173049248' },
    'VT-ANS': { airframe: '790832_1793173049248' },
    'VT-NAC': { airframe: '790832_1793173150565' },   // 787-8
  };

  var KG_TO_LB = 2.20462262;
  /** kg → THOUSANDS of pounds, 3 dp — the only weight unit acdata accepts. */
  function klb(kg) { return Math.round(Number(kg) * KG_TO_LB) / 1000; }

  /**
   * An encoded airframe as API inputs. Only what the API documents is sent:
   * acdata takes cat/equip/transponder/pbn/extrarmk/maxpax/weights/hexcode/
   * per/paxwgt. Ceiling, thrust, taxi fuel and max cargo have no API input and
   * fall back to SimBrief's profile for the base type.
   *   - paxwgt is ONE figure in pounds INCLUDING bags (the docs' example is
   *     230 lb), so the link's passenger and bag weights are summed.
   *   - cat, equip and transponder are all-or-nothing: SimBrief ignores all
   *     three if any one is missing.
   */
  function customAirframe(d) {
    var acdata = {
      cat: d.cat, equip: d.equip, transponder: d.transponder,
      pbn: 'PBN/' + d.pbn,
      maxpax: String(d.maxpax),
      oew: klb(d.oew), mzfw: klb(d.mzfw), mtow: klb(d.mtow), mlw: klb(d.mlw), maxfuel: klb(d.maxfuel),
      per: d.per,
      paxwgt: Math.round((Number(d.paxwgt) + Number(d.bagwgt || 0)) * KG_TO_LB),
    };
    if (d.extrarmk) acdata.extrarmk = d.extrarmk;
    if (d.hexcode) acdata.hexcode = d.hexcode;
    var params = {
      fin: d.fin,
      contpct: d.contpct,
      resvrule: d.resvrule,
      fuelfactor: d.fuelfactor,
      cruise: d.defaultcruise,
      climb: d.defaultclimb,
      descent: d.defaultdescent,
      manualrmk: d.manualrmk,
      acdata: JSON.stringify(acdata),
    };
    if (d.selcal) params.selcal = d.selcal;
    if (d.defaultci) params.civalue = d.defaultci;
    if (d.etopsrange) params.etopsrule = d.etopsrange;
    return { type: d.basetype, params: params };
  }

  /** The SimBrief `type` and extra inputs for a tail listed above, or null. */
  function tailAirframe(registration) {
    var t = SIMBRIEF_TAIL_AIRFRAMES[up(registration)];
    if (!t) return null;
    if (t.def) return customAirframe(t.def);
    var params = {};
    ['fin', 'civalue', 'manualrmk'].forEach(function (k) { if (t[k]) params[k] = t[k]; });
    return { type: t.airframe, airframe: t.airframe, params: params };
  }

  /** A departure runway as SimBrief's `origrwy` wants it ("27", "09L"), '' for
   *  none (SimBrief picks one), or null when it is not a runway at all.
   *  Forgiving about how a pilot types it: "rwy 9l" → "09L". */
  var RWY_RE = /^(0[1-9]|[12][0-9]|3[0-6])[LRC]?$/;
  function normalizeRunway(v) {
    var s = up(v).replace(/\s+/g, '').replace(/^(RWY|RW)/, '');
    if (!s) return '';
    if (/^[1-9][LRC]?$/.test(s)) s = '0' + s;
    return RWY_RE.test(s) ? s : null;
  }

  /** A type SimBrief will accept as a bare code: exactly four alphanumerics.
   *  typeCode()'s fallback branch (fleet-mode-home.js:423) emits free text like
   *  "A310-300" for an airframe the registry does not know, and SimBrief answers
   *  that with a silent failure INSIDE the popup — the worst place to discover
   *  it. Checked up front so the button can say so instead. */
  var TYPE_RE = /^[A-Z0-9]{4}$/;

  function up(v) { return String(v == null ? '' : v).trim().toUpperCase(); }

  /**
   * Split an IF callsign into its operator prefix and flight number.
   * "AIC173" → { prefix: 'AIC', fltnum: '0173' }. A callsign with no trailing
   * digits (or none at all) yields an empty fltnum, which the caller omits.
   */
  function splitCallsign(callsign) {
    var cs = up(callsign).replace(/\s+/g, '');
    var letters = cs.match(/^[A-Z]+/);
    var digits = cs.match(/\d+$/);
    return {
      prefix: letters ? letters[0] : '',
      fltnum: digits ? digits[0].padStart(4, '0') : '',
    };
  }

  /**
   * The route string SimBrief should start from, or '' to let it auto-route.
   *
   * IF's `flightPlan` field holds the whole thing including the endpoints
   * ("VIDP DPN BBB VABB"); SimBrief wants only what lies between them and
   * rejects a route that repeats the airports. Anything left over after
   * stripping them is passed through as-is — we are not validating waypoints,
   * only removing the two tokens we know are wrong.
   */
  function routeBetween(flightPlan, orig, dest) {
    var parts = up(flightPlan).split(/\s+/).filter(Boolean);
    if (!parts.length) return '';
    if (parts[0] === up(orig)) parts.shift();
    if (parts.length && parts[parts.length - 1] === up(dest)) parts.pop();
    return parts.join(' ');
  }

  /**
   * Everything a SimBrief dispatch needs for one Fleet Mode leg.
   *
   * @param {object} leg
   *   @param {string} leg.callsign     the schedule's callsign, e.g. "AIC173"
   *   @param {string} leg.orig         origin ICAO
   *   @param {string} leg.dest         destination ICAO
   *   @param {string} leg.type         a typeCode() result, e.g. "A20N"
   *   @param {string} [leg.registration] tail, e.g. "VT-ANM"
   *   @param {string} [leg.flightPlan] IF's filed route string
   *   @param {number} [leg.pax]        sampled passenger load, or falsy to omit
   *   @param {string} [leg.depRunway]  the pilot's departure runway, or blank
   *                                    to let SimBrief choose
   * @returns {{dispatchable: boolean, reason?: string, formData?: object,
   *            airline: string, type: string, airframe: string,
   *            tailAirframe: boolean}}
   */
  function buildFormData(leg) {
    var l = leg || {};
    var orig = up(l.orig);
    var dest = up(l.dest);
    var ty = up(l.type);

    var cs = splitCallsign(l.callsign);
    // Career's own expression, kept identical: a 3-letter prefix IS the ICAO
    // code, a 2-letter one is IATA and needs mapping, anything else is INVA.
    var airline = cs.prefix.length === 3
      ? cs.prefix
      : (AIRLINE_ICAO_MAP[cs.prefix] || cs.prefix || 'INVA');
    // …and back the other way for the airframe key, which is IATA-keyed.
    var iata = cs.prefix.length === 2 ? cs.prefix : (AIRLINE_IATA_MAP[cs.prefix] || '');

    // The tail's own airframe first — see SIMBRIEF_TAIL_AIRFRAMES.
    var tail = tailAirframe(l.registration);
    var airframe = tail
      ? (tail.airframe || '')
      : iata
        ? (SIMBRIEF_AIRFRAME_MAP[iata + ':' + (AIRFRAME_ALIASES[ty] || ty)] || '')
        : '';
    // NOT aliased — see AIRFRAME_ALIASES. A neo stays a neo.
    var type = tail ? tail.type : (airframe || SIMBRIEF_AIRCRAFT_MAP[ty] || ty);

    function refuse(reason) {
      return { dispatchable: false, reason: reason, airline: airline, type: type, airframe: airframe, tailAirframe: !!tail };
    }
    if (orig.length !== 4 || dest.length !== 4) return refuse('This leg has no usable airports.');
    if (orig === dest) return refuse('This leg starts and ends at the same airport.');
    if (!airframe && !TYPE_RE.test(type)) return refuse('SimBrief cannot plan a ' + (ty || 'unknown') + '.');
    var rwy = normalizeRunway(l.depRunway);
    if (rwy === null) {
      return refuse('"' + String(l.depRunway).trim() + '" is not a runway. Use a number like 27 or 09L, or leave it blank.');
    }

    var route = routeBetween(l.flightPlan, orig, dest);

    var formData = {
      orig: orig,
      dest: dest,
      type: type,
      airline: airline,
      // Career's flags, verbatim (dashboard.js:1075-1079) — a fleet OFP should
      // come out looking like a career one.
      navlog: '1',
      stepclimbs: '1',
      tlr: '1',
      notams: '1',
      maps: 'detail',
    };
    if (cs.fltnum) formData.fltnum = cs.fltnum;
    if (l.registration) formData.reg = String(l.registration);
    if (route) formData.route = route;
    if (l.pax) formData.pax = String(l.pax);
    if (rwy) formData.origrwy = rwy;
    if (tail) {
      for (var k in tail.params) {
        if (tail.params[k]) formData[k] = String(tail.params[k]);
      }
    }

    return { dispatchable: true, formData: formData, airline: airline, type: type, airframe: airframe, tailAirframe: !!tail };
  }

  window.INVA_FLEET_DISPATCH = {
    buildFormData: buildFormData,
    splitCallsign: splitCallsign,
    routeBetween: routeBetween,
    normalizeRunway: normalizeRunway,
    // Exposed for tests/calc/fleetDispatchMaps.test.js and the form tests.
    _maps: {
      SIMBRIEF_AIRCRAFT_MAP: SIMBRIEF_AIRCRAFT_MAP,
      AIRLINE_ICAO_MAP: AIRLINE_ICAO_MAP,
      SIMBRIEF_AIRFRAME_MAP: SIMBRIEF_AIRFRAME_MAP,
      AIRLINE_IATA_MAP: AIRLINE_IATA_MAP,
      AIRFRAME_ALIASES: AIRFRAME_ALIASES,
      SIMBRIEF_TAIL_AIRFRAMES: SIMBRIEF_TAIL_AIRFRAMES,
    },
  };
})();
