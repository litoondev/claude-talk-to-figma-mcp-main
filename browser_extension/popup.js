/**
 * Web-to-Figma popup. A thin view over the service worker, which owns the
 * connection so it survives the popup closing.
 */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var els = {
    dot: $("dot"), status: $("status"), channel: $("channel"), relay: $("relay"),
    connect: $("connect"), pick: $("pick"), save: $("save"), send: $("send"), log: $("log"), version: $("version"),
  };
  var current = null;

  function send(msg) {
    return chrome.runtime.sendMessage(msg).then(function (res) {
      if (res && res.error) throw new Error(res.error);
      return res;
    });
  }

  function render(state) {
    current = state;
    els.version.textContent = "v" + state.version;
    els.dot.className = "dot " + (state.connected ? "dot-on" : state.connecting ? "dot-wait" : "dot-off");
    els.status.textContent = state.busy
      ? state.busy
      : state.connected
        ? "Connected · channel " + state.channel
        : state.connecting
          ? "Connecting to " + state.relay + "…"
          : "Disconnected";
    els.connect.textContent = state.connected || state.connecting ? "Disconnect" : "Connect";
    if (document.activeElement !== els.channel && state.channel) els.channel.value = state.channel;
    if (document.activeElement !== els.relay) els.relay.value = state.relay || "";
    els.save.disabled = !!state.busy;
    els.send.disabled = !!state.busy || !state.connected;
    els.send.title = state.connected ? "Capture this page (or the picked element) and build it in Figma" : "Connect to the Figma plugin's channel first";
    els.log.innerHTML = "";
    (state.log || []).forEach(function (entry) {
      var li = document.createElement("li");
      li.className = entry.level;
      li.textContent = new Date(entry.at).toLocaleTimeString() + "  " + entry.text;
      els.log.appendChild(li);
    });
  }

  function note(text, level) {
    var li = document.createElement("li");
    li.className = level || "";
    li.textContent = text;
    els.log.insertBefore(li, els.log.firstChild);
  }

  els.connect.addEventListener("click", function () {
    if (current && (current.connected || current.connecting)) {
      send({ type: "disconnect" }).then(render, function (e) { note(e.message, "error"); });
      return;
    }
    var channel = els.channel.value.trim();
    if (!channel) { note("Enter the channel ID shown in Claude, then connect.", "error"); return; }
    send({ type: "connect", channel: channel, relay: els.relay.value.trim() || "ws://localhost:3055" })
      .then(render, function (e) { note(e.message, "error"); });
  });

  els.send.addEventListener("click", function () {
    els.send.disabled = true;
    note("Sending to Figma… (keep this tab open)");
    var width = parseInt($("width").value, 10) || 1440;
    try { localStorage.setItem("w2f-width", String(width)); } catch (e) { /* storage blocked */ }
    send({ type: "sendToFigma", width: width }).then(function (res) {
      note(res.summary, "ok");
    }, function (e) {
      note(e.message, "error");
    });
  });

  els.pick.addEventListener("click", function () {
    send({ type: "pick" }).then(function () { window.close(); }, function (e) { note(e.message, "error"); });
  });

  els.save.addEventListener("click", function () {
    els.save.disabled = true;
    note("Capturing…");
    send({ type: "captureLocal", scope: "page" }).then(function (res) {
      var capture = res.result;
      var host = "";
      try { host = new URL(capture.url).hostname.replace(/[^a-z0-9.-]/gi, "_"); } catch (e) { host = "page"; }
      var blob = new Blob([JSON.stringify(capture, null, 2)], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = host + "-" + new Date().toISOString().replace(/[:.]/g, "-") + ".web-to-figma.json";
      a.click();
      note("Saved " + capture.stats.nodes + " elements.", "ok");
    }, function (e) {
      note(e.message, "error");
    }).then(function () { els.save.disabled = false; });
  });

  chrome.runtime.onMessage.addListener(function (msg) {
    if (msg && msg.type === "state") render(msg.state);
  });

  try { var savedWidth = localStorage.getItem("w2f-width"); if (savedWidth) $("width").value = savedWidth; } catch (e) { /* storage blocked */ }
  send({ type: "getState" }).then(render, function (e) { note(e.message, "error"); });
})();
