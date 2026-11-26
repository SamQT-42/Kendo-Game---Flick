// =====================================================================
//  CONFIG — every tunable number lives here.
//  Positions/distances are fractions of the camera frame HEIGHT
//  (0 = top, 1 = bottom), so they mean the same at any resolution.
//  Brightness values are 0 (black) .. 255 (white).
// =====================================================================
const CONFIG = {
  // ---- Game ----
  gameDurationSec: 30,
  readyMs: 1500,           // how long "ARE YOU READY?" stays up
  countdownStepMs: 1000,   // each of 3, 2, 1
  goMs: 700,               // how long "GO!" stays visible (timer is already running)

  // ---- Camera (browser picks the closest it can do) ----
  cameraWidth: 1280,
  cameraHeight: 720,
  cameraFps: 60,           // more frames per second = less blur and more samples per flick

  // ---- Position check + automatic tip detection ----
  guideZone: { x: 0.28, y: 0.06, w: 0.44, h: 0.68 }, // TIP ZONE: hold the tip in here (fractions of frame width/height)
  minBrightness: 70,       // average frame brightness must be at least this
  maxGlare: 0.12,          // at most this fraction of the frame may be blown-out white (window / lamp behind you)
  darkLevel: 60,           // anything darker than this counts as "black" (the tape, or something confusing)
  minTapePixels: 10,       // a dark spot must be at least this big (processing pixels) to be the tape
  maxTapeArea: 0.03,       // ...and at most this fraction of the frame (bigger = hair, clothes, a dark wall...)
  maxDarkInZone: 0.03,     // apart from the tape, at most this fraction of the zone may be dark
  positionHoldMs: 1500,    // all checks must stay green this long, then the tip is locked automatically
  positionGraceMs: 250,    // a check may blink red this long without restarting the hold (e.g. motion blur)
  lockMaxMove: 0.01,       // lock on only when the tape moved less than this since the previous frame

  // ---- Lock-on (measuring the tape once it is found) ----
  procWidth: 320,          // hidden processing canvas width (height follows camera aspect)
  lockSnapRadius: 0.05,    // lock-on snaps to the darkest spot within this distance of the detected tape
  growLumaTol: 28,         // when measuring the tape: neighbor brightness must be within this of its darkest spot
  growChromaTol: 18,       // ...and its color tint within this
  minPixels: 6,            // blobs smaller than this are ignored (noise)

  // ---- Tracking ----
  lumaTol: 32,             // brightness tolerance around the tape's measured brightness (minimum)
  chromaTol: 20,           // color-tint tolerance (minimum)
  tolFromSpread: 2.5,      // tolerances grow to this many standard deviations of the tape's own variation
  searchRadius: 0.2,       // look for the tape within this distance of where it is predicted to be
  areaMin: 0.25,           // accepted blob size, relative to the tape's size at lock-on
  areaMax: 4,
  modelAdapt: 0.03,        // how fast the remembered tape color/size follows lighting changes (0 = never)
  adaptMaxSpeed: 0.5,      // ...only learned while the tip moves slower than this (frame heights per second)

  // ---- One Euro smoothing filter (low jitter when slow, low lag when fast) ----
  filterMinCutoff: 2.0,    // lower = smoother when the tip is still
  filterBeta: 4.0,         // higher = less lag when the tip moves fast
  filterDCutoff: 1.0,

  // ---- Flick detection (one flick = up past a threshold, then down past a threshold) ----
  upThreshold: 0.03,       // tip must rise this far above its lowest point to arm "UP"
  downThreshold: 0.03,     // then fall this far below its highest point to complete the flick
  minAmplitude: 0.05,      // full low-to-high travel must be at least this, or the cycle is ignored
  minFlickIntervalMs: 90,  // two flicks can't be counted closer together than this
  lostResetMs: 500,        // if the tip is lost longer than this, the up/down state restarts

  // ---- Trail ----
  trailMs: 280,            // how long a point stays on the trail before it fades out
  trailWidth: 10,          // red line width in CSS pixels (white outline is drawn wider)
};
