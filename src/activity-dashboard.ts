/**
 * Self-contained live activity dashboard served at GET /dashboard.
 *
 * Kept as a single inlined string with no external assets so the relay stays a
 * zero-dependency process and the page works with no network access beyond
 * localhost. It consumes GET /activity/stream (Server-Sent Events) and falls
 * back to polling GET /activity if the stream drops.
 */
export const DASHBOARD_HTML = String.raw`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Claude → Figma · Live Activity</title>
<style>
  :root {
    color-scheme: dark;
    --bg: #16111b;
    --panel: #1e1826;
    --panel-2: #261e30;
    --border: #362b44;
    --text: #f3eef8;
    --muted: #a294b4;
    --accent: #c08bec;
    --ok: #5ddc8c;
    --warn: #ffc86b;
    --err: #ff7a66;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  header {
    padding: 20px 24px;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
    position: sticky;
    top: 0;
    background: var(--bg);
    z-index: 2;
  }
  h1 { font-size: 16px; margin: 0; font-weight: 600; }
  .sub { color: var(--muted); font-size: 12px; }
  .spacer { flex: 1; }
  .pill {
    display: inline-flex; align-items: center; gap: 7px;
    padding: 5px 12px; border-radius: 999px;
    background: var(--panel-2); border: 1px solid var(--border);
    font-size: 12px; font-variant-numeric: tabular-nums;
  }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); flex: none; }
  .dot.live { background: var(--ok); animation: pulse 1.4s ease-in-out infinite; }
  .dot.off  { background: var(--err); }
  @keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: .25 } }

  main { padding: 20px 24px 60px; max-width: 1100px; }
  section { margin-bottom: 28px; }
  h2 {
    font-size: 11px; text-transform: uppercase; letter-spacing: .09em;
    color: var(--muted); margin: 0 0 10px; font-weight: 600;
  }

  .channels { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
  .card {
    background: var(--panel); border: 1px solid var(--border);
    border-radius: 10px; padding: 14px 16px;
  }
  .card.working { border-color: var(--accent); }
  .card-top { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .chan { font-weight: 600; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .state { font-size: 12px; color: var(--muted); }
  .state.working { color: var(--accent); }
  .cur {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px; margin-top: 6px; word-break: break-word;
  }
  .counts { display: flex; gap: 14px; margin-top: 10px; font-size: 12px; color: var(--muted); }
  .counts b { color: var(--text); font-weight: 600; font-variant-numeric: tabular-nums; }

  .bar { height: 3px; background: var(--panel-2); border-radius: 3px; overflow: hidden; margin-top: 10px; }
  .bar > i {
    display: block; height: 100%; width: 40%; border-radius: 3px;
    background: var(--accent); animation: slide 1.1s ease-in-out infinite;
  }
  @keyframes slide { 0% { margin-left: -40% } 100% { margin-left: 100% } }

  .toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; flex-wrap: wrap; }
  input[type=search], select {
    background: var(--panel); color: var(--text);
    border: 1px solid var(--border); border-radius: 7px;
    padding: 6px 10px; font: inherit; font-size: 12px;
  }
  label.chk { font-size: 12px; color: var(--muted); display: inline-flex; align-items: center; gap: 6px; }

  .log { border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
  .row {
    display: grid; grid-template-columns: 86px 92px 1fr auto;
    gap: 12px; padding: 9px 14px; align-items: baseline;
    border-top: 1px solid var(--border); background: var(--panel);
  }
  .row:first-child { border-top: none; }
  .row .time {
    color: var(--muted); font-size: 11px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-variant-numeric: tabular-nums;
  }
  .row .kind {
    font-size: 10px; text-transform: uppercase; letter-spacing: .07em;
    font-weight: 700;
  }
  .kind.queued    { color: var(--muted); }
  .kind.started   { color: var(--accent); }
  .kind.progress  { color: var(--accent); }
  .kind.completed { color: var(--ok); }
  .kind.error,
  .kind.timeout   { color: var(--err); }
  .kind.connection{ color: var(--warn); }
  .kind.note      { color: var(--muted); }
  .row .msg { word-break: break-word; }
  .row .meta {
    color: var(--muted); font-size: 11px; white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .nodes {
    display: block; color: var(--muted); font-size: 11px; margin-top: 3px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .empty { padding: 34px; text-align: center; color: var(--muted); background: var(--panel); }
  @media (max-width: 640px) {
    .row { grid-template-columns: 66px 1fr; }
    .row .kind, .row .meta { grid-column: 2; }
  }
</style>
</head>
<body>
<header>
  <div>
    <h1>Claude → Figma · Live Activity</h1>
    <div class="sub">Every change the AI makes, as it happens</div>
  </div>
  <div class="spacer"></div>
  <span class="pill"><span id="conn-dot" class="dot"></span><span id="conn-text">connecting…</span></span>
  <span class="pill"><span id="evt-count">0</span>&nbsp;events</span>
</header>

<main>
  <section>
    <h2>Channels</h2>
    <div id="channels" class="channels"></div>
  </section>

  <section>
    <h2>Activity log</h2>
    <div class="toolbar">
      <input type="search" id="filter" placeholder="Filter by command, message or node id…" style="min-width:260px">
      <select id="kind-filter">
        <option value="">All events</option>
        <option value="started">Started</option>
        <option value="completed">Completed</option>
        <option value="error">Errors</option>
        <option value="connection">Connections</option>
      </select>
      <label class="chk"><input type="checkbox" id="autoscroll" checked> Follow</label>
    </div>
    <div id="log" class="log"><div class="empty">Waiting for activity…</div></div>
  </section>
</main>

<script>
(function () {
  var MAX_ROWS = 500;
  var events = [];
  var channels = [];
  var latestSeq = 0;
  var es = null;
  var pollTimer = null;

  var el = {
    log: document.getElementById('log'),
    channels: document.getElementById('channels'),
    connDot: document.getElementById('conn-dot'),
    connText: document.getElementById('conn-text'),
    evtCount: document.getElementById('evt-count'),
    filter: document.getElementById('filter'),
    kindFilter: document.getElementById('kind-filter'),
    autoscroll: document.getElementById('autoscroll')
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function time(ts) {
    var d = new Date(ts);
    return d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0');
  }

  function duration(ms) {
    if (ms == null) return '';
    return ms < 1000 ? ms + 'ms' : (ms / 1000).toFixed(ms < 10000 ? 2 : 1) + 's';
  }

  function setConn(state, text) {
    el.connDot.className = 'dot ' + state;
    el.connText.textContent = text;
  }

  function matches(e) {
    var kind = el.kindFilter.value;
    if (kind === 'error') {
      if (e.kind !== 'error' && e.kind !== 'timeout') return false;
    } else if (kind && e.kind !== kind) {
      return false;
    }
    var q = el.filter.value.trim().toLowerCase();
    if (!q) return true;
    var hay = [e.message, e.command, e.channel, (e.nodeIds || []).join(' '), (e.nodeNames || []).join(' ')]
      .join(' ').toLowerCase();
    return hay.indexOf(q) !== -1;
  }

  function renderChannels() {
    if (!channels.length) {
      el.channels.innerHTML = '<div class="card"><div class="state">No channel connected yet. '
        + 'Open the Figma plugin and connect Claude to its channel.</div></div>';
      return;
    }
    el.channels.innerHTML = channels.map(function (c) {
      var elapsed = c.working && c.startedAt ? duration(Date.now() - c.startedAt) : '';
      return '<div class="card' + (c.working ? ' working' : '') + '">'
        + '<div class="card-top">'
          + '<span class="dot ' + (c.working ? 'live' : '') + '"></span>'
          + '<span class="chan">' + esc(c.channel) + '</span>'
          + '<span class="spacer"></span>'
          + '<span class="state' + (c.working ? ' working' : '') + '">'
            + (c.working ? 'AI working' + (elapsed ? ' · ' + elapsed : '') : 'idle')
          + '</span>'
        + '</div>'
        + (c.working && c.currentCommand
            ? '<div class="cur">' + esc(c.currentCommand) + '</div><div class="bar"><i></i></div>'
            : '')
        + '<div class="counts">'
          + '<span>queued <b>' + c.queueDepth + '</b></span>'
          + '<span>done <b>' + c.completed + '</b></span>'
          + '<span>failed <b>' + c.failed + '</b></span>'
        + '</div>'
      + '</div>';
    }).join('');
  }

  function rowHtml(e) {
    var nodes = '';
    if (e.nodeNames && e.nodeNames.length) {
      nodes = '<span class="nodes">' + esc(e.nodeNames.slice(0, 6).join(', '))
        + (e.nodeNames.length > 6 ? ' +' + (e.nodeNames.length - 6) + ' more' : '') + '</span>';
    } else if (e.nodeIds && e.nodeIds.length) {
      nodes = '<span class="nodes">' + esc(e.nodeIds.slice(0, 6).join(', '))
        + (e.nodeIds.length > 6 ? ' +' + (e.nodeIds.length - 6) + ' more' : '') + '</span>';
    }
    var meta = [];
    if (e.durationMs != null) meta.push(duration(e.durationMs));
    if (e.progress != null) meta.push(e.progress + '%');
    meta.push(e.channel);

    return '<div class="row">'
      + '<span class="time">' + time(e.ts) + '</span>'
      + '<span class="kind ' + esc(e.kind) + '">' + esc(e.kind) + '</span>'
      + '<span class="msg">' + esc(e.message) + nodes + '</span>'
      + '<span class="meta">' + esc(meta.join(' · ')) + '</span>'
    + '</div>';
  }

  function renderLog() {
    var visible = events.filter(matches);
    el.evtCount.textContent = events.length;
    if (!visible.length) {
      el.log.innerHTML = '<div class="empty">'
        + (events.length ? 'No events match the filter.' : 'Waiting for activity…') + '</div>';
      return;
    }
    // Newest last so the log reads top-to-bottom like a terminal.
    el.log.innerHTML = visible.slice(-MAX_ROWS).map(rowHtml).join('');
    if (el.autoscroll.checked) {
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    }
  }

  function ingest(list) {
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.seq <= latestSeq) continue;
      latestSeq = e.seq;
      events.push(e);
    }
    if (events.length > MAX_ROWS * 2) events.splice(0, events.length - MAX_ROWS * 2);
  }

  function applySnapshot(snap) {
    if (snap.events) ingest(snap.events);
    if (snap.channels) channels = snap.channels;
    renderChannels();
    renderLog();
  }

  function poll() {
    fetch('/activity?since=' + latestSeq)
      .then(function (r) { return r.json(); })
      .then(function (snap) {
        setConn('live', 'polling');
        applySnapshot(snap);
      })
      .catch(function () { setConn('off', 'disconnected'); });
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(poll, 1500);
    poll();
  }

  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  function connect() {
    // Seed with history first so a dashboard opened mid-session is not empty.
    fetch('/activity').then(function (r) { return r.json(); }).then(applySnapshot).catch(function () {});

    try {
      es = new EventSource('/activity/stream');
    } catch (err) {
      startPolling();
      return;
    }

    es.onopen = function () { stopPolling(); setConn('live', 'live'); };

    es.onmessage = function (msg) {
      try {
        var payload = JSON.parse(msg.data);
        if (payload.type === 'event') {
          ingest([payload.event]);
          if (payload.channels) channels = payload.channels;
          renderChannels();
          renderLog();
        } else if (payload.type === 'snapshot') {
          applySnapshot(payload);
        }
      } catch (err) { /* ignore malformed frame */ }
    };

    es.onerror = function () {
      setConn('off', 'reconnecting…');
      // EventSource retries on its own; poll meanwhile so the page stays useful.
      startPolling();
    };
  }

  el.filter.addEventListener('input', renderLog);
  el.kindFilter.addEventListener('change', renderLog);
  // Keeps the "AI working · 4.2s" elapsed timer ticking between events.
  setInterval(renderChannels, 1000);

  connect();
})();
</script>
</body>
</html>`;
