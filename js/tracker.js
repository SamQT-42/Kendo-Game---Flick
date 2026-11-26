// =====================================================================
//  Tip tracking for a shinai tip marked with black tape.
//
//  Each new camera frame:
//   1. draw the video, MIRRORED, onto a small hidden canvas (so every
//      coordinate already matches what the player sees)
//   2. convert pixels to brightness (Y) + color tint (Cb, Cr); a dark
//      tape is mostly "low Y", so brightness and tint get separate tolerances
//   3. mark pixels that look like the tape (the mask)
//   4. group touching marked pixels into blobs (connected components)
//   5. keep the blob that is near where the tape is PREDICTED to be and
//      about the same SIZE as the tape was at lock-on. Hair, clothes and
//      other dark things form other blobs and are ignored.
//   6. its center (sub-pixel) is the tip. The flick counter uses that raw
//      center (it averages many pixels, so it is already precise and has no
//      lag); a One Euro filter smooths it for the drawn trail
//
//  All returned positions are normalized: x and y in 0..1.
// =====================================================================

// ---- One Euro filter: a low-pass filter whose cutoff rises with speed ----
class OneEuro {
  constructor(minCutoff, beta, dCutoff) {
    this.minCutoff = minCutoff; this.beta = beta; this.dCutoff = dCutoff;
    this.x = null; this.dx = 0; this.t = 0;
  }
  static alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }
  reset() { this.x = null; this.dx = 0; }
  filter(x, tMs) {
    if (this.x === null) { this.x = x; this.t = tMs; return x; }
    const dt = Math.max(1e-3, (tMs - this.t) / 1000);
    this.t = tMs;
    const rawDx = (x - this.x) / dt;
    this.dx += (rawDx - this.dx) * OneEuro.alpha(this.dCutoff, dt);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += (x - this.x) * OneEuro.alpha(cutoff, dt);
    return this.x;
  }
}

class TipTracker {
  constructor(cfg) {
    this.cfg = cfg;
    this.canvas = document.createElement("canvas");
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    this.w = 0;
    this.h = 0;
    this.fx = new OneEuro(cfg.filterMinCutoff, cfg.filterBeta, cfg.filterDCutoff);
    this.fy = new OneEuro(cfg.filterMinCutoff, cfg.filterBeta, cfg.filterDCutoff);
    this.reset();
  }

  /** Forget the tape (it must be detected and locked again). */
  reset() {
    this.target = null;   // {y, cb, cr, area, tolY, tolC}
    this.raw = null;      // last unfiltered tip {x, y} (normalized)
    this.pos = null;      // filtered tip {x, y}
    this.vel = { x: 0, y: 0 };   // normalized units per ms, for prediction
    this.pred = null;
    this.lastSeen = -Infinity;
    this.lostFrames = 0;
    this.blobs = [];
    this.selected = 0;    // label of the chosen blob (0 = none)
    this.matchCount = 0;
    this.fx.reset(); this.fy.reset();
  }

  /** Match the processing canvas to the camera's aspect ratio. */
  resize(videoW, videoH) {
    const w = this.cfg.procWidth;
    const h = Math.max(1, Math.round(w * (videoH / videoW)));
    this.w = w; this.h = h;
    this.canvas.width = w; this.canvas.height = h;
    const n = w * h;
    this.Y = new Uint8Array(n);
    this.Cb = new Int16Array(n);
    this.Cr = new Int16Array(n);
    this.mask = new Uint8Array(n);
    this.labels = new Int32Array(n);
    this.stack = new Int32Array(n);
  }

  /** Draw the current video frame (mirrored) and convert it to Y / Cb / Cr. */
  grab(video) {
    const { ctx, w, h, Y, Cb, Cr } = this;
    ctx.setTransform(-1, 0, 0, 1, w, 0);
    ctx.drawImage(video, 0, 0, w, h);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const d = ctx.getImageData(0, 0, w, h).data;
    for (let p = 0, i = 0; p < Y.length; p++, i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const y = (77 * r + 150 * g + 29 * b) >> 8;
      Y[p] = y; Cb[p] = b - y; Cr[p] = r - y;
    }
  }

  // ------------------------------------------------------------------ position check + auto-detect
  /**
   * Scene checks before lock-on, and automatic tape detection.
   * zone is normalized {x,y,w,h}.
   *
   * Inside the zone, dark pixels (Y < darkLevel) are grouped into blobs.
   * A blob between minTapePixels and maxTapeArea is a tape candidate.
   * The scene is good when there is exactly ONE candidate and almost
   * nothing else in the zone is dark, so the tape can't be confused.
   * After this call, mask[p] = 1 for dark zone pixels and labels[p] ===
   * result.tapeLabel for the tape's pixels (used for drawing).
   */
  sceneCheck(zone) {
    const { w, h, Y, mask, labels, stack, cfg } = this;
    let sum = 0, glare = 0;
    for (let p = 0; p < Y.length; p++) { sum += Y[p]; if (Y[p] > 245) glare++; }

    const x0 = Math.max(0, Math.floor(zone.x * w)), x1 = Math.min(w, Math.ceil((zone.x + zone.w) * w));
    const y0 = Math.max(0, Math.floor(zone.y * h)), y1 = Math.min(h, Math.ceil((zone.y + zone.h) * h));
    mask.fill(0);
    labels.fill(0);
    let dark = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const p = y * w + x;
        if (Y[p] < cfg.darkLevel) { mask[p] = 1; dark++; }
      }
    }
    const zoneCount = Math.max(1, (x1 - x0) * (y1 - y0));

    // dark blobs inside the zone (4-neighbor flood fill, kept within the zone)
    const candidates = [];
    const maxArea = cfg.maxTapeArea * w * h;
    let next = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const start = y * w + x;
        if (!mask[start] || labels[start]) continue;
        const label = ++next;
        let sp = 0, area = 0, sx = 0, sy = 0;
        stack[sp++] = start; labels[start] = label;
        while (sp > 0) {
          const p = stack[--sp];
          const px = p % w, py = (p / w) | 0;
          area++; sx += px; sy += py;
          if (px > x0 && mask[p - 1] && !labels[p - 1]) { labels[p - 1] = label; stack[sp++] = p - 1; }
          if (px < x1 - 1 && mask[p + 1] && !labels[p + 1]) { labels[p + 1] = label; stack[sp++] = p + 1; }
          if (py > y0 && mask[p - w] && !labels[p - w]) { labels[p - w] = label; stack[sp++] = p - w; }
          if (py < y1 - 1 && mask[p + w] && !labels[p + w]) { labels[p + w] = label; stack[sp++] = p + w; }
        }
        if (area >= cfg.minTapePixels && area <= maxArea) {
          candidates.push({ label, area, x: (sx / area + 0.5) / w, y: (sy / area + 0.5) / h });
        }
      }
    }

    const tape = candidates.length === 1 ? candidates[0] : null;
    const brightness = sum / Y.length;
    const glareFrac = glare / Y.length;
    const otherDarkFrac = (dark - (tape ? tape.area : 0)) / zoneCount;
    return {
      brightness, glareFrac, otherDarkFrac,
      candidates: candidates.length,
      tape,                                   // {x, y, area, label} or null
      tapeLabel: tape ? tape.label : 0,
      lightOk: brightness >= cfg.minBrightness,
      glareOk: glareFrac <= cfg.maxGlare,
      tapeOk: !!tape,
      zoneOk: otherDarkFrac <= cfg.maxDarkInZone,
    };
  }

  // ------------------------------------------------------------------ lock-on
  /**
   * Lock on to the tape at normalized (u, v) (the auto-detected spot).
   * Snap to the darkest spot nearby, grow a region of similar color from
   * there = the tape, and remember its color, color spread and size.
   * Returns {ok:true} or {ok:false, reason:"small"|"blend"|"notdark"}.
   */
  lockAt(u, v, now) {
    const { w, h, Y, Cb, Cr, cfg } = this;
    const cx = Math.round(u * (w - 1)), cy = Math.round(v * (h - 1));

    // 1. snap: darkest 3x3 average within the snap radius
    const rad = Math.max(2, Math.round(cfg.lockSnapRadius * h));
    let best = -1, bestY = Infinity;
    for (let y = Math.max(1, cy - rad); y <= Math.min(h - 2, cy + rad); y++) {
      for (let x = Math.max(1, cx - rad); x <= Math.min(w - 2, cx + rad); x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 > rad * rad) continue;
        let s = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += Y[(y + dy) * w + x + dx];
        if (s < bestY) { bestY = s; best = y * w + x; }
      }
    }
    if (best < 0) return { ok: false, reason: "small" };

    // 2. seed color = 3x3 average around the snapped spot
    let sY = 0, sCb = 0, sCr = 0;
    const bx = best % w, by = (best / w) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const p = (by + dy) * w + bx + dx;
      sY += Y[p]; sCb += Cb[p]; sCr += Cr[p];
    }
    sY /= 9; sCb /= 9; sCr /= 9;

    // 3. region grow (flood fill) from the seed with the "grow" tolerances
    const maxArea = cfg.maxTapeArea * w * h;
    const lt = cfg.growLumaTol, ct2 = cfg.growChromaTol ** 2;
    const seen = this.labels; seen.fill(0);
    const stack = this.stack;
    let sp = 0, area = 0;
    let mY = 0, mCb = 0, mCr = 0, qY = 0, qC = 0, sumX = 0, sumY = 0;
    stack[sp++] = best; seen[best] = 1;
    while (sp > 0) {
      const p = stack[--sp];
      area++;
      if (area > maxArea) return { ok: false, reason: "blend" };
      const x = p % w, y = (p / w) | 0;
      sumX += x; sumY += y;
      mY += Y[p]; mCb += Cb[p]; mCr += Cr[p];
      qY += Y[p] * Y[p]; qC += Cb[p] * Cb[p] + Cr[p] * Cr[p];
      const nbrs = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (const q of nbrs) {
        if (q < 0 || seen[q]) continue;
        const dCb = Cb[q] - sCb, dCr = Cr[q] - sCr;
        if (Math.abs(Y[q] - sY) <= lt && dCb * dCb + dCr * dCr <= ct2) {
          seen[q] = 1; stack[sp++] = q;
        }
      }
    }
    if (area < cfg.minPixels) return { ok: false, reason: "small" };

    mY /= area; mCb /= area; mCr /= area;
    if (mY >= cfg.darkLevel) return { ok: false, reason: "notdark" }; // blurred or not the tape
    const sdY = Math.sqrt(Math.max(0, qY / area - mY * mY));
    const sdC = Math.sqrt(Math.max(0, qC / area - mCb * mCb - mCr * mCr));
    this.target = {
      y: mY, cb: mCb, cr: mCr, area,
      tolY: Math.max(cfg.lumaTol, cfg.tolFromSpread * sdY),
      tolC: Math.max(cfg.chromaTol, cfg.tolFromSpread * sdC),
    };
    this.target.lock = { y: mY, cb: mCb, cr: mCr, area }; // values at lock-on (adaptation stays near these)

    const tip = { x: (sumX / area + 0.5) / w, y: (sumY / area + 0.5) / h };
    this.fx.reset(); this.fy.reset();
    this.raw = tip;
    this.pos = { x: this.fx.filter(tip.x, now), y: this.fy.filter(tip.y, now) };
    this.vel = { x: 0, y: 0 };
    this.lastSeen = now;
    this.lostFrames = 0;
    return { ok: true };
  }

  // ------------------------------------------------------------------ per-frame tracking
  /**
   * Find the tape in the last grabbed frame.
   * Returns null, or {x, y} = filtered (for drawing) and {rx, ry} = raw blob center (for counting).
   */
  update(now) {
    this.selected = 0;
    if (!this.target) return null;
    const { w, h, Y, Cb, Cr, mask, labels, stack, cfg, target: t } = this;

    // 1. mask: pixels that look like the tape
    const tolY = t.tolY, tolC2 = t.tolC * t.tolC;
    let matches = 0;
    for (let p = 0; p < Y.length; p++) {
      const dCb = Cb[p] - t.cb, dCr = Cr[p] - t.cr;
      const m = Math.abs(Y[p] - t.y) <= tolY && dCb * dCb + dCr * dCr <= tolC2 ? 1 : 0;
      mask[p] = m; matches += m;
    }
    this.matchCount = matches;

    // 2. connected components (4-neighbor flood fill)
    labels.fill(0);
    const blobs = [];
    let next = 0;
    for (let start = 0; start < mask.length; start++) {
      if (!mask[start] || labels[start]) continue;
      const label = ++next;
      let sp = 0, area = 0, sx = 0, sy = 0, sY = 0, sCb = 0, sCr = 0;
      stack[sp++] = start; labels[start] = label;
      while (sp > 0) {
        const p = stack[--sp];
        const x = p % w, y = (p / w) | 0;
        area++; sx += x; sy += y; sY += Y[p]; sCb += Cb[p]; sCr += Cr[p];
        if (x > 0 && mask[p - 1] && !labels[p - 1]) { labels[p - 1] = label; stack[sp++] = p - 1; }
        if (x < w - 1 && mask[p + 1] && !labels[p + 1]) { labels[p + 1] = label; stack[sp++] = p + 1; }
        if (y > 0 && mask[p - w] && !labels[p - w]) { labels[p - w] = label; stack[sp++] = p - w; }
        if (y < h - 1 && mask[p + w] && !labels[p + w]) { labels[p + w] = label; stack[sp++] = p + w; }
      }
      if (area >= cfg.minPixels) {
        blobs.push({
          label, area,
          x: (sx / area + 0.5) / w, y: (sy / area + 0.5) / h,
          meanY: sY / area, meanCb: sCb / area, meanCr: sCr / area,
        });
      }
    }
    this.blobs = blobs;

    // 3. predict where the tape should be now (constant velocity)
    const sinceSeen = now - this.lastSeen;
    const recentlySeen = this.raw && sinceSeen < cfg.lostResetMs;
    const dt = Math.min(sinceSeen, 100);
    const pred = this.raw
      ? { x: this.raw.x + this.vel.x * dt, y: this.raw.y + this.vel.y * dt }
      : null;
    this.pred = pred;

    // 4. pick the right blob: right size, closest to the prediction
    const aspect = w / h;
    const radius = recentlySeen ? Math.min(1, cfg.searchRadius * (1 + 0.5 * this.lostFrames)) : Infinity;
    let best = null, bestD = Infinity;
    for (const b of blobs) {
      const ratio = b.area / t.area;
      if (ratio < cfg.areaMin || ratio > cfg.areaMax) continue;
      const ref = pred || this.raw;
      const d = ref ? Math.hypot((b.x - ref.x) * aspect, b.y - ref.y) : 0;
      if (d <= radius && d < bestD) { best = b; bestD = d; }
    }

    if (!best) { this.lostFrames++; return null; }

    // 5. accept it
    this.selected = best.label;
    if (recentlySeen && sinceSeen > 0) {
      const vx = (best.x - this.raw.x) / sinceSeen, vy = (best.y - this.raw.y) / sinceSeen;
      this.vel.x += (vx - this.vel.x) * 0.6;
      this.vel.y += (vy - this.vel.y) * 0.6;
    } else {
      this.vel = { x: 0, y: 0 };
      this.fx.reset(); this.fy.reset();
    }
    this.raw = { x: best.x, y: best.y };
    this.lastSeen = now;
    this.lostFrames = 0;

    // Slowly follow lighting / distance changes. Only learn from a SHARP view
    // (tip moving slowly: a fast tip is motion-blurred grey, and learning from
    // that would make the tracker drift away from the real black tape), and
    // never stray far from what was measured at lock-on.
    const ratio = best.area / t.area;
    const speed = Math.hypot(this.vel.x * aspect, this.vel.y) * 1000; // frame heights per second
    if (cfg.modelAdapt > 0 && speed < cfg.adaptMaxSpeed && ratio > 0.6 && ratio < 1.6) {
      const a = cfg.modelAdapt, L = t.lock;
      const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
      t.y = clamp(t.y + (best.meanY - t.y) * a, L.y - t.tolY / 2, L.y + t.tolY / 2);
      t.cb = clamp(t.cb + (best.meanCb - t.cb) * a, L.cb - t.tolC / 2, L.cb + t.tolC / 2);
      t.cr = clamp(t.cr + (best.meanCr - t.cr) * a, L.cr - t.tolC / 2, L.cr + t.tolC / 2);
      t.area = clamp(t.area + (best.area - t.area) * a, L.area / 2, L.area * 2);
    }

    this.pos = { x: this.fx.filter(best.x, now), y: this.fy.filter(best.y, now) };
    return { x: this.pos.x, y: this.pos.y, rx: best.x, ry: best.y };
  }
}
