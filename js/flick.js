// =====================================================================
//  FlickCounter — counts full up-then-down cycles of the tip.
//
//  Screen y grows DOWNWARD (0 = top), so "up" means y gets smaller.
//
//  Two-state machine with hysteresis:
//
//    WAIT_UP    remember the lowest point seen (largest y).
//               When the tip rises upThreshold above it   -> WAIT_DOWN
//
//    WAIT_DOWN  remember the highest point seen (smallest y).
//               When the tip falls downThreshold below it -> one flick
//               (if the full travel >= minAmplitude and it isn't too
//               soon after the last flick), then back to WAIT_UP.
//
//  Because each switch needs a real move AWAY from the last extreme,
//  small shakes around any point never flip the state back and forth.
// =====================================================================
class FlickCounter {
  constructor(cfg) {
    this.cfg = cfg;
    this.reset();
  }

  reset() {
    this.count = 0;
    this.state = "WAIT_UP";
    this.low = null;       // lowest tip point (max y) in the current cycle
    this.high = null;      // highest tip point (min y) in the current cycle
    this.lastFlick = -Infinity;
    this.lastSeen = -Infinity;
  }

  /** Feed the smoothed tip y (0..1). Returns true when a flick was just counted. */
  update(y, now) {
    const c = this.cfg;

    // First sample, or tip was lost for a while: start a fresh cycle from here.
    if (this.low === null || now - this.lastSeen > c.lostResetMs) {
      this.state = "WAIT_UP";
      this.low = y;
      this.high = y;
    }
    this.lastSeen = now;

    if (this.state === "WAIT_UP") {
      if (y > this.low) this.low = y;               // still going down: follow it
      if (this.low - y >= c.upThreshold) {          // rose enough -> armed
        this.state = "WAIT_DOWN";
        this.high = y;
      }
      return false;
    }

    // WAIT_DOWN
    if (y < this.high) this.high = y;               // still going up: follow it
    if (y - this.high >= c.downThreshold) {         // came back down enough
      const amplitude = this.low - this.high;
      const counted = amplitude >= c.minAmplitude && now - this.lastFlick >= c.minFlickIntervalMs;
      if (counted) {
        this.count++;
        this.lastFlick = now;
      }
      this.state = "WAIT_UP";
      this.low = y;
      return counted;
    }
    return false;
  }
}
