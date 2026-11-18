/*
 * Where did this visitor come from?
 * Remembers the post that sent them (?src=fb-p1 from a compassbizsolutions.com/go/
 * link, or utm_* tags, or another site's referrer) and adds it to every form
 * they send on this site, so the admin dashboard can tie leads to posts.
 * Add to a page with: <script src="/track.js"></script>
 */
(function () {
  if (window.__cbsTrack) return;
  window.__cbsTrack = true;
  var KEY = 'cbs_src', DAYS = 60;
  function read() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
  function write(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} }
  var q; try { q = new URLSearchParams(location.search); } catch (e) { q = { get: function () { return null; } }; }
  var clean = function (v) { return String(v || '').replace(/[^A-Za-z0-9 _.\-]/g, '').slice(0, 60); };
  var src = clean(q.get('src')), us = clean(q.get('utm_source')), um = clean(q.get('utm_medium')), uc = clean(q.get('utm_campaign'));
  var ref = '';
  try { if (document.referrer) { var h = new URL(document.referrer).hostname; if (h && h.indexOf('compassbizsolutions.com') === -1) ref = h.replace(/^www\./, ''); } } catch (e) {}
  var now = new Date().toISOString(), cur = read();
  if (cur && cur.at && (Date.now() - new Date(cur.at).getTime()) > DAYS * 864e5) cur = null;
  var tagged = !!(src || us);
  // The newest tagged visit (a post link) wins; a plain referrer
  // (google.com, facebook.com…) only fills in when nothing tagged is saved.
  if (tagged || (ref && !(cur && (cur.src || cur.utm_source)))) {
    cur = {
      src: src,
      utm_source: us || (src ? src.split('-')[0] : ref),
      utm_medium: um || (tagged ? 'social' : 'referral'),
      utm_campaign: uc,
      ref: ref,
      landing: location.pathname,
      at: now,
      first_at: (cur && cur.first_at) || now
    };
    write(cur);
  }
  window.cbsAttribution = function () { return read(); };

  // Count steps (no personal info): page views, a daily visitor, and the steps
  // pages report with window.cbsEvent('check_start') etc. Sam reads the totals.
  var sent = {};
  function send(e, once) {
    try {
      if (once) { if (sent[e]) return; sent[e] = 1; }
      var a = read();
      var body = JSON.stringify({ e: e, src: (a && (a.src || a.utm_source)) || 'direct', p: location.pathname });
      if (navigator.sendBeacon) navigator.sendBeacon('/api/ev', new Blob([body], { type: 'text/plain' }));
      else if (window.fetch) window.fetch('/api/ev', { method: 'POST', body: body, keepalive: true });
    } catch (x) {}
  }
  window.cbsEvent = function (e) { send(String(e || ''), true); };
  try {
    var path = location.pathname.replace(/\/index\.html$/, '/').replace(/\.html$/, '').toLowerCase();
    var parts = path.split('/').filter(Boolean).slice(0, 2);
    send('view:' + (parts.length ? parts.join('/') : 'home'), true);
    var today = new Date().toISOString().slice(0, 10);
    if (localStorage.getItem('cbs_seen') !== today) { localStorage.setItem('cbs_seen', today); send('visitor', true); }
  } catch (x) {}
  document.addEventListener('click', function (ev) {
    var el = ev.target && ev.target.closest ? ev.target.closest('a') : null;
    if (!el) return;
    var h = el.getAttribute('href') || '';
    if (/calendly\.com|\/go\/[a-z0-9-]*call/i.test(h)) send('call_click', true);
    else if (/\/course(\/|$)/.test(h)) send('course_click', true);
    else if (/fieldkit/i.test(h)) send('fieldkit_click', true);
    else if (/reviewkit/i.test(h)) send('reviewkit_click', true);
    else if (/buy\.stripe\.com/.test(h)) send('buy_click', true);
  }, true);

  // Add the source to form posts that go to our own APIs
  var API = /(compassbizsolutions\.com)?\/api\/(send-diagnostic|contact|waitlist|fieldkit-waitlist|fieldkit-founding-start|reviewkit-checkout|portal-signup|course-signup)/;
  var orig = window.fetch;
  if (!orig) return;
  window.fetch = function (input, init) {
    try {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var a = read();
      if (a && init && init.body && typeof init.body === 'string' && API.test(url) && /post/i.test(init.method || '')) {
        var b = JSON.parse(init.body);
        if (b && typeof b === 'object' && !Array.isArray(b)) {
          b.attribution = a;
          if (!b.utm_source && a.utm_source) b.utm_source = a.utm_source;
          if (!b.utm_medium && a.utm_medium) b.utm_medium = a.utm_medium;
          if (!b.utm_campaign && (a.utm_campaign || a.src)) b.utm_campaign = a.utm_campaign || a.src;
          init = Object.assign({}, init, { body: JSON.stringify(b) });
        }
      }
    } catch (e) {}
    return orig.call(this, input, init);
  };
})();
