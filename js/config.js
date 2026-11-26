// =====================================================================
//  CONFIG — every tunable number lives here.
//  Distances are fractions of the camera frame HEIGHT (0 = top, 1 = bottom),
//  so they stay the same whatever the camera resolution is.
// =====================================================================
const CONFIG = {
  // ---- Game ----
  gameDurationSec: 30,
  readyMs: 1500,          // how long "ARE YOU READY?" stays up
  countdownStepMs: 1000,  // each of 3, 2, 1
  goMs: 700,              // how long "GO!" stays visible (timer is already running)

  // ---- Color tracking ----
  procWidth: 160,         // hidden processing canvas width (height follows camera aspect)
  pickPatch: 2,           // tap samples a (2*n+1)^2 patch around the tap point and averages it
  colorTolerance: 70,     // max RGB distance from the picked color to count as a match (0..441)
  minPixels: 6,           // fewer matching pixels than this = "tip not found" this frame
  searchRadius: 0.25,     // prefer matches within this distance of the last tip position (0 = off)
  smoothing: 0.55,        // 0..1 — lerp factor per frame (1 = no smoothing, lower = smoother but laggier)

  // ---- Flick detection (one flick = up past a threshold, then down past a threshold) ----
  upThreshold: 0.08,      // tip must rise this far above its lowest point to arm "UP"
  downThreshold: 0.08,    // then fall this far below its highest point to complete the flick
  minAmplitude: 0.12,     // full low-to-high travel must be at least this, or the cycle is ignored
  minFlickIntervalMs: 120,// two flicks can't be counted closer together than this
  lostResetMs: 400,       // if the tip is lost longer than this, the up/down state restarts

  // ---- Trail ----
  trailMs: 280,           // how long a point stays on the trail before it fades out
  trailWidth: 10,         // red line width in CSS pixels (white outline is drawn wider)
};
