// =====================================================================
//  ColorTracker — finds the shinai tip by color.
//
//  Each frame:
//   1. draw the video, MIRRORED, onto a small hidden canvas (so every
//      coordinate here already matches what the player sees on screen)
//   2. mark pixels whose RGB is close to the picked color (the "mask")
//   3. the tip = center (average x, y) of the marked pixels
//   4. smooth that point a little to cut jitter
//
//  All returned positions are normalized: x and y in 0..1.
// =====================================================================
class ColorTracker {
  constructor(cfg) {
    this.cfg = cfg;
    this.canvas = document.createElement("canvas");
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    this.w = 0;
    this.h = 0;
    this.pixels = null;   // last frame's RGBA data
    this.mask = null;     // Uint8Array, 1 = pixel matches the target color
    this.target = null;   // {r, g, b} picked by the player
    this.raw = null;      // last unsmoothed tip position {x, y}
    this.pos = null;      // smoothed tip position {x, y}
    this.matchCount = 0;
    this.lastSeen = -Infinity;
  }

  /** Match the processing canvas to the camera's aspect ratio. */
  resize(videoW, videoH) {
    this.w = this.cfg.procWidth;
    this.h = Math.max(1, Math.round(this.cfg.procWidth * (videoH / videoW)));
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    this.mask = new Uint8Array(this.w * this.h);
  }

  /** Draw the current video frame (mirrored) and keep its pixels. */
  grab(video) {
    const { ctx, w, h } = this;
    ctx.setTransform(-1, 0, 0, 1, w, 0); // flip horizontally
    ctx.drawImage(video, 0, 0, w, h);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.pixels = ctx.getImageData(0, 0, w, h).data;
  }

  /** Player tapped at normalized (u, v): average a small patch there as the target color. */
  pickAt(u, v) {
    if (!this.pixels) return null;
    const cx = Math.round(u * (this.w - 1));
    const cy = Math.round(v * (this.h - 1));
    const n = this.cfg.pickPatch;
    let r = 0, g = 0, b = 0, count = 0;
    for (let y = cy - n; y <= cy + n; y++) {
      for (let x = cx - n; x <= cx + n; x++) {
        if (x < 0 || y < 0 || x >= this.w || y >= this.h) continue;
        const i = (y * this.w + x) * 4;
        r += this.pixels[i]; g += this.pixels[i + 1]; b += this.pixels[i + 2];
        count++;
      }
    }
    this.target = { r: r / count, g: g / count, b: b / count };
    this.raw = { x: u, y: v };
    this.pos = { x: u, y: v };
    this.lastSeen = performance.now();
    return this.target;
  }

  /**
   * Find the tip in the last grabbed frame.
   * Returns the smoothed {x, y} or null if too few pixels matched.
   */
  update(now) {
    if (!this.target || !this.pixels) return null;
    const { w, h, pixels, mask, cfg } = this;
    const { r: tr, g: tg, b: tb } = this.target;
    const tol2 = cfg.colorTolerance * cfg.colorTolerance;

    // Optional "stay near where it was" window, in processing-canvas pixels.
    const useLocal = cfg.searchRadius > 0 && this.raw && now - this.lastSeen < cfg.lostResetMs;
    const lx = this.raw ? this.raw.x * w : 0;
    const ly = this.raw ? this.raw.y * h : 0;
    const rad = cfg.searchRadius * h;
    const rad2 = rad * rad;

    let sumX = 0, sumY = 0, count = 0;           // every match
    let locX = 0, locY = 0, locCount = 0;        // matches near the last position

    for (let y = 0, i = 0, m = 0; y < h; y++) {
      for (let x = 0; x < w; x++, i += 4, m++) {
        const dr = pixels[i] - tr, dg = pixels[i + 1] - tg, db = pixels[i + 2] - tb;
        if (dr * dr + dg * dg + db * db <= tol2) {
          mask[m] = 1;
          sumX += x; sumY += y; count++;
          if (useLocal) {
            const dx = x - lx, dy = y - ly;
            if (dx * dx + dy * dy <= rad2) { locX += x; locY += y; locCount++; }
          }
        } else {
          mask[m] = 0;
        }
      }
    }
    this.matchCount = count;

    let found = null;
    if (useLocal && locCount >= cfg.minPixels) {
      found = { x: (locX / locCount + 0.5) / w, y: (locY / locCount + 0.5) / h };
    } else if (count >= cfg.minPixels) {
      found = { x: (sumX / count + 0.5) / w, y: (sumY / count + 0.5) / h };
    }

    if (!found) return null;

    // Smoothing: lerp toward the new point. Snap if we had lost it for a while.
    if (!this.pos || now - this.lastSeen > cfg.lostResetMs) {
      this.pos = { ...found };
    } else {
      const a = cfg.smoothing;
      this.pos.x += (found.x - this.pos.x) * a;
      this.pos.y += (found.y - this.pos.y) * a;
    }
    this.raw = found;
    this.lastSeen = now;
    return { x: this.pos.x, y: this.pos.y };
  }
}
