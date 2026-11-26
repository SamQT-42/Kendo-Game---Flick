// =====================================================================
//  Game flow: screens, camera, phases, trail and debug drawing.
//
//  Game-screen phases (driven from one requestAnimationFrame loop):
//    loading -> position -> pick -> ready -> count -> play -> (result screen)
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

  const tracker = new TipTracker(CONFIG);
  const flicks = new FlickCounter(CONFIG);

  let stream = null;
  let session = 0;          // bumps every time we enter/leave the game, cancels stale async work
  let rafId = 0;
  let phase = "off";
  let phaseStart = 0;
  let trail = [];           // {x, y, t} points, or null to break the line after a lost frame
  let debug = false;
  let lastTip = null;
  let newFrame = false;     // set when the camera delivered a frame we haven't processed
  let lastVideoTime = -1;
  let scene = null;         // last position-check result
  let goodSince = null;     // when all position checks turned green

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

  let shownHint = null;
  function setHint(html) {
    if (html === shownHint) return;
    shownHint = html;
    hintEl.innerHTML = html;
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
      video: {
        facingMode: "user",
        width: { ideal: CONFIG.cameraWidth },
        height: { ideal: CONFIG.cameraHeight },
        frameRate: { ideal: CONFIG.cameraFps },
      },
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

    // Only process frames the camera actually delivered (no duplicate samples).
    if ("requestVideoFrameCallback" in video) {
      const onFrame = () => {
        if (mySession !== session) return;
        newFrame = true;
        video.requestVideoFrameCallback(onFrame);
      };
      video.requestVideoFrameCallback(onFrame);
    }
    return true;
  }

  function stopCamera() {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    video.srcObject = null;
  }

  function hasNewFrame() {
    if ("requestVideoFrameCallback" in video) {
      const n = newFrame;
      newFrame = false;
      return n;
    }
    if (video.currentTime !== lastVideoTime) { lastVideoTime = video.currentTime; return true; }
    return false;
  }

  // ---------------------------------------------------------------- enter / leave game
  async function enterGame() {
    const mySession = ++session;
    showScreen("game");
    errorBtn.hidden = true;
    setHint("");
    trail = [];
    lastTip = null;
    scene = null;
    goodSince = null;
    flicks.reset();
    tracker.reset();          // always tap the tip again (also after RETRY)
    setCounter(0, false);
    timerEl.textContent = CONFIG.gameDurationSec;
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
    setPhase("position");
  }

  function leaveGame() {
    session++;
    cancelAnimationFrame(rafId);
    stopCamera();
    setPhase("off");
    setMessage("");
    setHint("");
    messageEl.style.whiteSpace = "";
  }

  function finishGame() {
    const finalCount = flicks.count;
    leaveGame();
    finalEl.textContent = finalCount;
    showScreen("result");
  }

  // ---------------------------------------------------------------- position check UI
  function checkLine(ok, okText, badText) {
    return `<div class="${ok ? "ok" : "bad"}">${ok ? "[OK]" : "[!!]"} ${ok ? okText : badText}</div>`;
  }

  function updatePosition(now) {
    if (!scene) return;
    const allOk = scene.lightOk && scene.glareOk && scene.zoneOk;
    if (!allOk) goodSince = null;
    else if (goodSince === null) goodSince = now;
    const held = goodSince === null ? 0 : Math.min(1, (now - goodSince) / CONFIG.positionHoldMs);

    setHint(
      `<div class="hint-title">GET IN POSITION: THE TIP SHOULD MOVE INSIDE THE BOX</div>` +
      checkLine(scene.lightOk, "LIGHT", "TOO DARK - ADD LIGHT") +
      checkLine(scene.glareOk, "NO GLARE", "BRIGHT LIGHT BEHIND YOU - TURN AWAY FROM IT") +
      checkLine(scene.zoneOk, "BOX IS CLEAR", "DARK THINGS IN THE BOX (HAIR, CLOTHES...) - STEP ASIDE UNTIL NO PINK") +
      `<div class="bar"><div style="width:${Math.round(held * 100)}%"></div></div>`
    );

    if (held >= 1) {
      setPhase("pick");
      setHint(`<div class="hint-title">TAP THE BLACK TAPE ON YOUR SHINAI TIP</div>`);
    }
  }

  // ---------------------------------------------------------------- tapping the tape
  frame.addEventListener("pointerdown", (e) => {
    if (phase !== "pick" || !tracker.w) return;
    const r = video.getBoundingClientRect();
    const u = (e.clientX - r.left) / r.width;
    const v = (e.clientY - r.top) / r.height;
    if (u < 0 || u > 1 || v < 0 || v > 1) return;
    const res = tracker.pickAt(u, v, performance.now());
    if (!res.ok) {
      setHint(
        `<div class="hint-title bad">${
          res.reason === "blend"
            ? "THE TAPE BLENDS INTO THE BACKGROUND - MOVE TO A LIGHTER SPOT AND TAP AGAIN"
            : "MISSED - TAP RIGHT ON THE BLACK TAPE"
        }</div>`
      );
      return;
    }
    setHint(`<div class="hint-title ok">LOCKED ON!</div>`);
    trail = [];
    setPhase("ready");
  });

  // ---------------------------------------------------------------- main loop
  function loop() {
    rafId = requestAnimationFrame(loop);
    const now = performance.now();

    // 1. process each new camera frame once
    if (stream && video.readyState >= 2 && tracker.w && hasNewFrame()) {
      tracker.grab(video);
      if (phase === "position") scene = tracker.sceneCheck(CONFIG.guideZone);
      const tip = tracker.update(now);
      lastTip = tip;
      if (tip) {
        trail.push({ x: tip.x, y: tip.y, t: now });
        if (phase === "play" && flicks.update(tip.ry, now)) setCounter(flicks.count, true);
      } else if (trail.length && trail[trail.length - 1] !== null) {
        trail.push(null);
      }
    }

    // 2. phase timing
    const t = now - phaseStart;
    switch (phase) {
      case "position":
        updatePosition(now);
        break;
      case "ready":
        setMessage("ARE YOU READY?", { zoom: true });
        if (t >= CONFIG.readyMs) { setHint(""); setPhase("count"); }
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

    if (phase === "position") drawDarkInZone(W, H);
    if (phase === "position" || phase === "pick") drawGuideZone(W, H, dpr);
    if (debug) drawDebugMask(W, H);
    drawTrail(now, W, H, dpr);
    if (debug) drawDebugInfo(W, H, dpr);
  }

  function drawGuideZone(W, H, dpr) {
    const z = CONFIG.guideZone;
    const ok = phase === "pick" || (scene && scene.lightOk && scene.glareOk && scene.zoneOk);
    octx.save();
    octx.strokeStyle = ok ? "#4de1ff" : "#ff4f7b";
    octx.lineWidth = 3 * dpr;
    octx.setLineDash([10 * dpr, 8 * dpr]);
    octx.strokeRect(z.x * W, z.y * H, z.w * W, z.h * H);
    octx.setLineDash([]);
    octx.font = `${10 * dpr}px "Press Start 2P", monospace`;
    octx.fillStyle = octx.strokeStyle;
    octx.fillText("TIP ZONE", z.x * W + 6 * dpr, z.y * H + 16 * dpr);
    octx.restore();
  }

  // Paint the pixels that would confuse the black-tape tracker (pink), inside the zone.
  const maskCanvas = document.createElement("canvas");
  const maskCtx = maskCanvas.getContext("2d");

  function paintMask(W, H, colorOf) {
    const { w, h } = tracker;
    if (maskCanvas.width !== w || maskCanvas.height !== h) {
      maskCanvas.width = w;
      maskCanvas.height = h;
    }
    const img = maskCtx.createImageData(w, h);
    const d = img.data;
    for (let p = 0, i = 0; p < w * h; p++, i += 4) {
      const c = colorOf(p, p % w, (p / w) | 0);
      if (c) { d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = c[3]; }
    }
    maskCtx.putImageData(img, 0, 0);
    octx.imageSmoothingEnabled = false;
    octx.drawImage(maskCanvas, 0, 0, W, H);
  }

  const PINK = [255, 79, 123, 200];
  const CYAN = [77, 225, 255, 230];
  const SHADE = [0, 0, 0, 90];

  function drawDarkInZone(W, H) {
    if (!tracker.Y) return;
    const z = CONFIG.guideZone, { w, h, Y } = tracker;
    const x0 = z.x * w, x1 = (z.x + z.w) * w, y0 = z.y * h, y1 = (z.y + z.h) * h;
    paintMask(W, H, (p, x, y) =>
      x >= x0 && x < x1 && y >= y0 && y < y1 && Y[p] < CONFIG.darkLevel ? PINK : null
    );
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
  function drawDebugMask(W, H) {
    if (!tracker.target || !tracker.mask) return;
    const { mask, labels, selected } = tracker;
    // pink = looks like the tape, cyan = the blob chosen as the tip, dark = everything else
    paintMask(W, H, (p) => (!mask[p] ? SHADE : selected && labels[p] === selected ? CYAN : PINK));
  }

  function drawDebugInfo(W, H, dpr) {
    const cfg = CONFIG;
    // search circle around the prediction
    if (tracker.pred && tracker.target) {
      const r = Math.min(1, cfg.searchRadius * (1 + 0.5 * tracker.lostFrames)) * H;
      octx.strokeStyle = "rgba(255,255,255,0.6)";
      octx.lineWidth = 1 * dpr;
      octx.beginPath();
      octx.arc(tracker.pred.x * W, tracker.pred.y * H, r, 0, Math.PI * 2);
      octx.stroke();
      octx.fillStyle = "#ffd84d";
      octx.fillRect(tracker.pred.x * W - 3 * dpr, tracker.pred.y * H - 3 * dpr, 6 * dpr, 6 * dpr);
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
    const t = tracker.target;
    const sel = tracker.blobs.find((b) => b.label === tracker.selected);
    const f = (v, n = 3) => (v === null || v === undefined ? "-" : v.toFixed(n));
    const lines = [
      `DEBUG (D)  phase:${phase}  ${tracker.w}x${tracker.h}  cam:${video.videoWidth}x${video.videoHeight}`,
      scene && phase === "position"
        ? `light:${f(scene.brightness, 0)}  glare:${f(scene.glareFrac)}  dark in zone:${f(scene.darkFrac)}`
        : `tape Y:${t ? f(t.y, 0) : "-"} tolY:${t ? f(t.tolY, 0) : "-"} tolC:${t ? f(t.tolC, 0) : "-"} area:${t ? f(t.area, 0) : "-"}`,
      `blobs:${tracker.blobs.length}  matches:${tracker.matchCount}  chosen area:${sel ? sel.area : "-"}  ${lastTip ? "FOUND" : "LOST"}`,
      `tip y:${lastTip ? f(lastTip.y) : "-"}  state:${flicks.state}  low:${f(flicks.low)}  high:${f(flicks.high)}`,
    ];
    const fs = 11 * dpr;
    octx.font = `${fs}px monospace`;
    octx.fillStyle = "rgba(10,22,40,0.85)";
    octx.fillRect(0, 0, W, lines.length * fs * 1.4 + 8 * dpr);
    octx.fillStyle = "#4de1ff";
    lines.forEach((l, i) => octx.fillText(l, 6 * dpr, (i + 1) * fs * 1.4));
  }

  window.addEventListener("keydown", (e) => {
    if (e.key === "d" || e.key === "D") debug = !debug;
  });

  // ---------------------------------------------------------------- buttons
  $("btn-start").addEventListener("click", enterGame);
  $("btn-retry").addEventListener("click", enterGame);
  $("btn-menu").addEventListener("click", () => showScreen("menu"));
  errorBtn.addEventListener("click", () => { leaveGame(); showScreen("menu"); });
})();
