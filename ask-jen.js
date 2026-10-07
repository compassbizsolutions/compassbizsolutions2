/*
 * Ask Jen chat bubble for the Compass website.
 * Add to any page with: <script src="/ask-jen.js" defer></script>
 * Lives in a shadow root so it can't clash with the page's own styles.
 * Answers come from fixkit.compassbizsolutions.com/api/ask-jen-public.
 */
(function () {
  if (window.__askJenLoaded) return;
  window.__askJenLoaded = true;

  var API = 'https://fixkit.compassbizsolutions.com/api/ask-jen-public';
  var STORE = 'askjen_site_chat';
  var history = [];
  try { history = JSON.parse(sessionStorage.getItem(STORE) || '[]') || []; } catch (e) { history = []; }

  var host = document.createElement('div');
  host.id = 'ask-jen-widget';
  host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483000;';
  document.body.appendChild(host);
  var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;

  root.innerHTML =
    '<style>' +
    ':host{all:initial}' +
    '*{box-sizing:border-box;font-family:"DM Sans",Inter,system-ui,-apple-system,"Segoe UI",sans-serif}' +
    '.bubble{display:flex;align-items:center;gap:8px;background:#C8701A;color:#fff;border:none;border-radius:999px;padding:12px 18px 12px 14px;font-size:15px;font-weight:700;cursor:pointer;box-shadow:0 8px 24px rgba(13,27,42,.28)}' +
    '.bubble:hover{background:#E08930}' +
    '.av{width:26px;height:26px;border-radius:50%;background:#1B2E4B;color:#fff;display:grid;place-items:center;font-weight:800;font-size:13px}' +
    '.panel{position:fixed;right:16px;bottom:16px;width:min(380px,calc(100vw - 32px));height:min(560px,calc(100vh - 32px));background:#fff;border-radius:16px;box-shadow:0 18px 50px rgba(13,27,42,.35);display:none;flex-direction:column;overflow:hidden;border:1px solid #DCE4EF}' +
    '.panel.open{display:flex}' +
    '.head{background:#1B2E4B;color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px}' +
    '.head .av{background:#C8701A;width:34px;height:34px;font-size:15px}' +
    '.hn{font-weight:800;font-size:15px}.hs{font-size:12px;color:rgba(255,255,255,.65)}' +
    '.x{margin-left:auto;background:none;border:none;color:#fff;font-size:22px;cursor:pointer;line-height:1;padding:4px 8px}' +
    '.msgs{flex:1;overflow-y:auto;padding:14px;background:#F4F7FC;display:flex;flex-direction:column;gap:10px}' +
    '.m{max-width:85%;padding:10px 13px;border-radius:14px;font-size:14px;line-height:1.55;white-space:pre-wrap;word-wrap:break-word;color:#1B2E4B}' +
    '.m.jen{background:#fff;border:1px solid #DCE4EF;align-self:flex-start;border-bottom-left-radius:4px}' +
    '.m.you{background:#1B2E4B;color:#fff;align-self:flex-end;border-bottom-right-radius:4px}' +
    '.m a{color:#C8701A}.m.you a{color:#F2C08B}' +
    '.typing{color:#5A7291;font-style:italic}' +
    '.starters{display:flex;flex-wrap:wrap;gap:6px;padding:0 14px 10px;background:#F4F7FC}' +
    '.st{background:#fff;border:1px solid #DCE4EF;color:#1B2E4B;border-radius:999px;padding:6px 11px;font-size:12.5px;cursor:pointer}' +
    '.st:hover{border-color:#C8701A;color:#C8701A}' +
    '.foot{border-top:1px solid #DCE4EF;padding:10px;display:flex;gap:8px;background:#fff}' +
    '.in{flex:1;border:1px solid #C8D6E8;border-radius:10px;padding:10px 12px;font-size:15px;outline:none;resize:none;max-height:90px}' +
    '.in:focus{border-color:#C8701A}' +
    '.send{background:#C8701A;color:#fff;border:none;border-radius:10px;padding:0 16px;font-weight:700;font-size:14px;cursor:pointer}' +
    '.send:disabled{opacity:.5;cursor:default}' +
    '.links{font-size:12px;color:#5A7291;padding:0 12px 10px;background:#fff;text-align:center}' +
    '.links a{color:#C8701A;text-decoration:none;font-weight:600}' +
    '@media (max-width:520px){.bubble .lbl{display:none}.bubble{padding:12px}.panel{right:8px;bottom:8px;width:calc(100vw - 16px);height:calc(100vh - 16px)}}' +
    '</style>' +
    '<button class="bubble" type="button" aria-label="Ask Jen a question"><span class="av">J</span><span class="lbl">Ask Jen</span></button>' +
    '<div class="panel" role="dialog" aria-label="Ask Jen">' +
    '  <div class="head"><span class="av">J</span><div><div class="hn">Ask Jen</div><div class="hs">Questions about Compass, FixKit, FieldKit or ReviewKit</div></div><button class="x" type="button" aria-label="Close">×</button></div>' +
    '  <div class="msgs"></div>' +
    '  <div class="starters"></div>' +
    '  <div class="foot"><textarea class="in" rows="1" placeholder="Type your question…" aria-label="Your question"></textarea><button class="send" type="button">Send</button></div>' +
    '  <div class="links"><a href="/faq">Browse the FAQ</a> · Already a customer? <a href="https://fixkit.compassbizsolutions.com">Ask Jen in your portal</a></div>' +
    '</div>';

  var bubble = root.querySelector('.bubble');
  var panel = root.querySelector('.panel');
  var msgs = root.querySelector('.msgs');
  var input = root.querySelector('.in');
  var sendBtn = root.querySelector('.send');
  var starters = root.querySelector('.starters');
  var busy = false;

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function linkify(s) {
    return esc(s).replace(/([a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,})|((?:https?:\/\/)?(?:[a-z0-9-]+\.)+(?:com|app)(?:\/[^\s<,)]*)?)/gi, function (m, mail, url) {
      if (mail) return '<a href="mailto:' + mail + '">' + mail + '</a>';
      var u = url.replace(/[.]$/, ''), tail = url.slice(u.length);
      return '<a href="' + (/^https?:/.test(u) ? u : 'https://' + u) + '" target="_blank" rel="noopener">' + u + '</a>' + tail;
    });
  }
  function add(role, text) {
    var d = document.createElement('div');
    d.className = 'm ' + (role === 'user' ? 'you' : 'jen');
    d.innerHTML = linkify(text);
    msgs.appendChild(d);
    msgs.scrollTop = msgs.scrollHeight;
    return d;
  }
  function save() { try { sessionStorage.setItem(STORE, JSON.stringify(history.slice(-16))); } catch (e) {} }

  var STARTERS = ['What does FixKit cost?', 'What is the free profit-leak check?', 'How do refunds work?', 'When does FieldKit launch?'];
  function renderStarters() {
    starters.innerHTML = '';
    if (history.length) return;
    STARTERS.forEach(function (t) {
      var b = document.createElement('button');
      b.className = 'st'; b.type = 'button'; b.textContent = t;
      b.onclick = function () { send(t); };
      starters.appendChild(b);
    });
  }
  function init() {
    msgs.innerHTML = '';
    add('assistant', "Hi, I'm Jen. Ask me anything about Compass, FixKit, FieldKit or ReviewKit: what they cost, how they work, or whether they fit your business.");
    history.forEach(function (h) { add(h.role, h.content); });
    renderStarters();
  }

  function send(text) {
    text = String(text || input.value).trim();
    if (!text || busy) return;
    input.value = '';
    busy = true; sendBtn.disabled = true;
    add('user', text);
    starters.innerHTML = '';
    var t = add('assistant', 'Jen is typing…'); t.classList.add('typing');
    var past = history.slice();
    history.push({ role: 'user', content: text });
    fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text, history: past }) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var reply = (d && d.reply) || "Sorry, I couldn't answer just now. Email support@compassbizsolutions.com.";
        t.classList.remove('typing'); t.innerHTML = linkify(reply);
        history.push({ role: 'assistant', content: reply }); save();
      })
      .catch(function () {
        t.classList.remove('typing');
        t.innerHTML = linkify("I couldn't connect just now. Try again, or email support@compassbizsolutions.com.");
        history.pop();
      })
      .then(function () { busy = false; sendBtn.disabled = false; msgs.scrollTop = msgs.scrollHeight; });
  }

  bubble.onclick = function () { panel.classList.add('open'); bubble.style.display = 'none'; init(); setTimeout(function () { input.focus(); }, 50); };
  root.querySelector('.x').onclick = function () { panel.classList.remove('open'); bubble.style.display = ''; };
  sendBtn.onclick = function () { send(); };
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });

  // Any link to #ask-jen on the page opens the chat
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest && e.target.closest('a[href="#ask-jen"]');
    if (a) { e.preventDefault(); bubble.onclick(); }
  });
  window.openAskJen = function () { bubble.onclick(); };
})();
