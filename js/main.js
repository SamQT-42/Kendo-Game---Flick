// =====================================================================
//  Game flow: screens, camera, phases, trail and debug drawing.
//
//  Game-screen phases (driven from one requestAnimationFrame loop):
//    loading -> pick -> ready -> count -> play -> (result screen)
// =====================================================================
(() => {
  const $ = (id) => document.getElementById(id);

  const screens = { menu: $("screen-menu"), game: $("screen-game"), result: $("screen-result") };
  const video = $("video");
  const frame = $("cam-frame");
  const overlay = $("overlay");
  const octx = overlay.getContext("2d");
  const timerEl = $("timer");
  const counterEl = $("counter");
  const hintEl = $("hint");
  const messageEl = $("message");
  const errorBtn = $("btn-error-menu");
  const finalEl = $("final-count");

  const tracker = new ColorTracker(CONFIG);
  const flicks = new FlickCounter(CONFIG);

  let stream = null;
  let session = 0;          // bumps every time we enter/leave the game, cancels stale async work
  let rafId = 0;
  let phase = "off";
  let phaseStart = 0;
  let trail = [];           // {x, y, t} points, or null to break the line after a lost frame
  let debug = false;
  let lastTip = null;

  // ---------------------------------------------------------------- screens
  function showScreen(name) {
    for (const key in screens) screens[key].classList.toggle("active", key === name);
  }

  function setPhase(p) {
    phase = p;
    phaseStart = performance.now();
  }

  let shownMessage = null;
  function setMessage(text, { zoom = false, small = false } = {}) {
    if (text === shownMessage) return;
    shownMessage = text;
    messageEl.textContent = text;
    messageEl.classList.toggle("small", small);
    messageEl.classList.remove("zoom");
    if (zoom && text) {
      void messageEl.offsetWidth; // restart the CSS animation
      messageEl.classList.add("zoom");
    }
  }

  function setCounter(n, pop) {
    counterEl.textContent = n;
    if (pop) {
      counterEl.classList.remove("pop");
      void counterEl.offsetWidth;
      counterEl.classList.add("pop");
    }
  }

  // ---------------------------------------------------------------- camera
  async function startCamera(mySession) {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
    if (mySession !== session) { stopCamera(); return false; } // player left meanwhile
    video.srcObject = stream;
    await video.play();
    if (!video.videoWidth) {
      await new Promise((res) => video.addEventListener("loadedmetadata", res, { once: true }));
    }
    if (mySession !== session) { stopCamera(); return false; }
    document.documentElement.style.setProperty("--ar", `${video.videoWidth} / ${video.videoHeight}`);
    tracker.resize(video.videoWidth, video.videoHeight);
    return true;
  }

  function stopCamera() {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    video.srcObject = null;
  }

  // ---------------------------------------------------------------- enter / leave game
  async function enterGame({ needPick }) {
    const mySession = ++session;
    showScreen("game");
    errorBtn.hidden = true;
    hintEl.textContent = "";
    trail = [];
    lastTip = null;
    flicks.reset();
    setCounter(0, false);
    timerEl.textContent = CONFIG.gameDurationSec;
    if (needPick) tracker.target = null;
    setPhase("loading");
    setMessage("STARTING CAMERA...", { small: true });

    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);

    try {
      if (!(await startCamera(mySession))) return;
    } catch (err) {
      if (mySession !== session) return;
      console.error(err);
      setPhase("error");
      setMessage(`CAMERA ERROR\n${err.name || err.message}\nUSE LOCALHOST OR HTTPS AND ALLOW THE CAMERA`, { small: true });
      messageEl.style.whiteSpace = "pre-line";
      errorBtn.hidden = false;
      return;
    }

    setMessage("");
    if (tracker.target) {
      setPhase("ready");
    } else {
      setPhase("pick");
      hintEl.textContent = "TAP THE WHITE TIP OF YOUR SHINAI";
    }
  }

  function leaveGame() {
    session++;
    cancelAnimationFrame(rafId);
    stopCamera();
    setPhase("off");
    setMessage("");
    messageEl.style.whiteSpace = "";
  }

  function finishGame() {
    const finalCount = flicks.count;
    leaveGame();
    finalEl.textContent = finalCount;
    showScreen("result");
  }

  // ---------------------------------------------------------------- picking the tip color
  frame.addEventListener("pointerdown", (e) => {
    if (phase !== "pick") return;
    const r = video.getBoundingClientRect();
    const u = (e.clientX - r.left) / r.width;
    const v = (e.clientY - r.top) / r.height;
    if (u < 0 || u > 1 || v < 0 || v > 1) return;
    if (!tracker.pickAt(u, v)) return;
    hintEl.textContent = "";
    trail = [];
    setPhase("ready");
  });

  // ---------------------------------------------------------------- main loop
  function loop() {
    rafId = requestAnimationFrame(loop);
    const now = performance.now();

    // 1. tracking (runs in every phase once the camera is live, so the player sees the trail)
    if (stream && video.readyState >= 2 && tracker.w) {
      tracker.grab(video);
      const tip = tracker.update(now);
      lastTip = tip;
      if (tip) {
        trail.push({ x: tip.x, y: tip.y, t: now });
        if (phase === "play" && flicks.update(tip.y, now)) setCounter(flicks.count, true);
      } else if (trail.length && trail[trail.length - 1] !== null) {
        trail.push(null);
      }
    }

    // 2. phase timing
    const t = now - phaseStart;
    switch (phase) {
      case "ready":
        setMessage("ARE YOU READY?", { zoom: true });
        if (t >= CONFIG.readyMs) setPhase("count");
        break;
      case "count": {
        const step = Math.floor(t / CONFIG.countdownStepMs);
        if (step >= 3) {
          flicks.reset();
          setCounter(0, false);
          setPhase("play"); // timer starts at GO
          setMessage("GO!", { zoom: true });
        } else {
          setMessage(String(3 - step), { zoom: true });
        }
        break;
      }
      case "play": {
        if (t >= CONFIG.goMs) setMessage("");
        const remaining = Math.max(0, CONFIG.gameDurationSec * 1000 - t);
        timerEl.textContent = Math.ceil(remaining / 1000);
        if (remaining <= 0) { finishGame(); return; }
        break;
      }
    }

    // 3. drawing
    draw(now);
  }

  // ---------------------------------------------------------------- drawing
  function fitOverlay() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(overlay.clientWidth * dpr);
    const h = Math.round(overlay.clientHeight * dpr);
    if (overlay.width !== w || overlay.height !== h) {
      overlay.width = w;
      overlay.height = h;
    }
    return dpr;
  }

  function draw(now) {
    const dpr = fitOverlay();
    const W = overlay.width, H = overlay.height;
    octx.clearRect(0, 0, W, H);

    if (debug) drawDebugMask(W, H);
    drawTrail(now, W, H, dpr);
    if (debug) drawDebugInfo(W, H, dpr);
  }

  function drawTrail(now, W, H, dpr) {
    // drop old points (and leading breaks)
    while (trail.length && (trail[0] === null || now - trail[0].t > CONFIG.trailMs)) trail.shift();
    if (trail.length < 2) return;

    octx.lineCap = "round";
    octx.lineJoin = "round";
    const base = CONFIG.trailWidth * dpr;

    // two passes: white outline underneath, red line on top
    for (const pass of ["outline", "red"]) {
      for (let i = 1; i < trail.length; i++) {
        const a = trail[i - 1], b = trail[i];
        if (!a || !b) continue;
        const life = 1 - (now - b.t) / CONFIG.trailMs;   // 1 = fresh, 0 = gone
        if (life <= 0) continue;
        const width = base * (0.35 + 0.65 * life);
        octx.globalAlpha = life;
        octx.strokeStyle = pass === "outline" ? "#ffffff" : "#ff2a4d";
        octx.lineWidth = pass === "outline" ? width + 6 * dpr : width;
        octx.beginPath();
        octx.moveTo(a.x * W, a.y * H);
        octx.lineTo(b.x * W, b.y * H);
        octx.stroke();
      }
    }
    octx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- debug (press D)
  const maskCanvas = document.createElement("canvas");
  const maskCtx = maskCanvas.getContext("2d");

  function drawDebugMask(W, H) {
    if (!tracker.mask || !tracker.target) return;
    const { w, h, mask } = tracker;
    if (maskCanvas.width !== w || maskCanvas.height !== h) {
      maskCanvas.width = w;
      maskCanvas.height = h;
    }
    const img = maskCtx.createImageData(w, h);
    for (let m = 0, i = 0; m < mask.length; m++, i += 4) {
      if (mask[m]) {
        img.data[i] = 77; img.data[i + 1] = 225; img.data[i + 2] = 255; img.data[i + 3] = 190;
      } else {
        img.data[i + 3] = 90; // darken non-matching pixels so the mask stands out
      }
    }
    maskCtx.putImageData(img, 0, 0);
    octx.imageSmoothingEnabled = false;
    octx.drawImage(maskCanvas, 0, 0, W, H);
  }

  function drawDebugInfo(W, H, dpr) {
    // search radius around last raw position
    if (tracker.raw && CONFIG.searchRadius > 0) {
      octx.strokeStyle = "rgba(255,255,255,0.5)";
      octx.lineWidth = 1 * dpr;
      octx.beginPath();
      octx.arc(tracker.raw.x * W, tracker.raw.y * H, CONFIG.searchRadius * H, 0, Math.PI * 2);
      octx.stroke();
    }
    // flick extremes
    const hline = (y, color) => {
      if (y === null) return;
      octx.strokeStyle = color;
      octx.lineWidth = 2 * dpr;
      octx.beginPath();
      octx.moveTo(0, y * H);
      octx.lineTo(W, y * H);
      octx.stroke();
    };
    if (phase === "play") {
      hline(flicks.low, "#ffd84d");
      if (flicks.state === "WAIT_DOWN") hline(flicks.high, "#ff4f7b");
    }
    // detected tip
    if (lastTip) {
      const x = lastTip.x * W, y = lastTip.y * H, s = 12 * dpr;
      octx.strokeStyle = "#00ff66";
      octx.lineWidth = 3 * dpr;
      octx.beginPath();
      octx.moveTo(x - s, y); octx.lineTo(x + s, y);
      octx.moveTo(x, y - s); octx.lineTo(x, y + s);
      octx.stroke();
    }
    // text
    const c = tracker.target;
    const lines = [
      `DEBUG (D)  phase:${phase}`,
      `color: ${c ? `${c.r | 0},${c.g | 0},${c.b | 0}` : "-"}  tol:${CONFIG.colorTolerance}`,
      `matches: ${tracker.matchCount}  min:${CONFIG.minPixels}  ${lastTip ? "FOUND" : "LOST"}`,
      `tip y: ${lastTip ? lastTip.y.toFixed(3) : "-"}  state:${flicks.state}`,
      `low: ${flicks.low === null ? "-" : flicks.low.toFixed(3)}  high: ${flicks.high === null ? "-" : flicks.high.toFixed(3)}`,
    ];
    const fs = 11 * dpr;
    octx.font = `${fs}px monospace`;
    octx.fillStyle = "rgba(10,22,40,0.8)";
    octx.fillRect(0, H - lines.length * fs * 1.4 - 8 * dpr, W, lines.length * fs * 1.4 + 8 * dpr);
    octx.fillStyle = "#4de1ff";
    lines.forEach((l, i) => octx.fillText(l, 6 * dpr, H - (lines.length - i - 0.6) * fs * 1.4));
  }

  window.addEventListener("keydown", (e) => {
    if (e.key === "d" || e.key === "D") debug = !debug;
  });

  // ---------------------------------------------------------------- buttons
  $("btn-start").addEventListener("click", () => enterGame({ needPick: true }));
  $("btn-retry").addEventListener("click", () => enterGame({ needPick: false }));
  $("btn-menu").addEventListener("click", () => showScreen("menu"));
  errorBtn.addEventListener("click", () => { leaveGame(); showScreen("menu"); });
})();
