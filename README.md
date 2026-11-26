# Kendo Shinai Flicker Count

A small browser minigame: flick your shinai up and down in front of the camera as many times as you can in 30 seconds.

Plain HTML, CSS and JavaScript. No framework, no build step.

```
index.html
css/style.css
js/config.js    <- every tunable number
js/tracker.js   <- black-tape tip tracking + position check
js/flick.js     <- up/down flick counter
js/main.js      <- screens, camera, phases, trail, debug view
assets/main.png <- game screen background
```

## Run it locally

The camera only works on `localhost` or HTTPS, so serve the folder instead of opening the file directly.

```bash
python3 -m http.server 8000
```

or

```bash
npx serve .
```

Then open http://localhost:8000 (or the URL `serve` prints) and allow camera access.

## Setup: mark the tip

Wrap a band of **black tape** around the shinai, right at the tip. The tracker follows that black band.

## How to play

1. **START**.
2. **Get in position.** A dashed **TIP ZONE** box appears with three live checks:
   - **LIGHT**: the room is bright enough.
   - **NO GLARE**: there is no window or lamp right behind you.
   - **BOX IS CLEAR**: nothing dark is inside the box. Dark pixels in the box are painted **pink**. Usually that's hair or dark clothes, so step aside until the tip moves in front of a light background.

   Once all three stay green for 1.5 s, the game moves on by itself.
3. **Tap the black tape.** The tap snaps to the darkest spot nearby, so it doesn't need to be exact. If you tap something too large or too dark (for example the tape is in front of your hair), you'll be asked to move and tap again.
4. "ARE YOU READY?", then 3, 2, 1, then **GO!** The 30 s timer starts at GO.
5. Flick. One up-then-down counts as 1 flick, and small wrist flicks count too.
6. Result screen: **RETRY** goes back to the position check and asks for a new tap. **MAIN MENU** returns to the title screen.

Press **D** at any time to show the debug view:

- Pink pixels look like the tape.
- The cyan blob is the one chosen as the tip.
- The green cross is the detected tip.
- The yellow square is the predicted position, and the white circle is the search area.
- The yellow and pink lines are the current low and high points of the flick.
- The top panel shows brightness, the tape's color, blob sizes and the flick state.

## How the tracker works (concept → code)

| Concept | Where in the code (`js/tracker.js`) |
|---|---|
| **Separate brightness from color.** Black is "very low brightness", and its hue is just noise. | Each pixel becomes `Y` (brightness) plus `Cb, Cr` (tint) in `grab()`. Matching checks `\|Y - tape.y\| <= tolY` and the tint distance `<= tolC` separately. |
| **Learn the tape's real color at tap time.** | `pickAt()` snaps to the darkest spot, then flood-fills similar pixels: that region *is* the tape. Its average color, spread and size are stored in `target`. |
| **Blobs instead of "all matching pixels".** One dark sleeve no longer drags the average. | `update()` groups touching matching pixels with a flood fill (connected components) into `blobs[]`. |
| **Pick the right blob.** | `update()` keeps only blobs whose size is `areaMin`–`areaMax` × the tape's size, then picks the one closest to the **predicted** position (`last position + velocity × time`). |
| **Sub-pixel precision.** | The blob's center is an average of many pixel positions, so it's finer than one pixel. Processing runs at `procWidth: 320`, and each camera frame is processed exactly once (`requestVideoFrameCallback`). |
| **Smoothing without lag** (One Euro filter) | `OneEuro.filter()` smooths heavily when the tip is still and lightly when it moves fast. This smoothed point draws the trail. The flick counter uses the raw blob center, which is already precise and has zero lag, so small flicks aren't shrunk. |
| **Follow lighting changes.** | When the chosen blob looks normal, `target` slowly moves toward its color and size (`modelAdapt`). |

## Tuning (`js/config.js`)

Positions are fractions of the frame **height**: `0` is the top, `1` is the bottom, and `0.05` means "5 % of the frame height".

### Flick detection (`js/flick.js`)

| Concept | Config key | What it does |
|---|---|---|
| Hysteresis, first threshold | `upThreshold` (0.03) | In `WAIT_UP` the code tracks the lowest point. Once the tip rises this far above it, the state switches to `WAIT_DOWN`. |
| Hysteresis, second threshold | `downThreshold` (0.03) | In `WAIT_DOWN` the code tracks the highest point. Once the tip falls this far below it, one flick is counted and the state goes back to `WAIT_UP`. |
| Minimum vertical distance | `minAmplitude` (0.05) | `low - high` (the full travel) must be at least this much. |
| Debounce | `minFlickIntervalMs` (90) | Two flicks closer together than this count as one. |
| Losing the tip | `lostResetMs` (500) | If the tip disappears for longer than this, the cycle starts over. |

- **Even smaller flicks should count:** lower `minAmplitude`, `upThreshold` and `downThreshold`. Keep the thresholds above the jitter you see in the debug "tip y" while holding still.
- **Wobbles are counted:** raise them.

Fast flicks blur the tape, so the tip is often LOST in the middle of a fast stroke. That's fine: a flick only needs the top and bottom points, where the tip is slowest and sharpest.

### Position check

| Key | Meaning |
|---|---|
| `guideZone` | The TIP ZONE box `{x, y, w, h}` as fractions of the frame. |
| `minBrightness` | Average brightness needed (0–255). |
| `maxGlare` | Largest allowed fraction of blown-out pixels. |
| `darkLevel` | Pixels darker than this count as "dark" for the zone check. |
| `maxDarkInZone` | Largest allowed fraction of dark pixels in the zone. |
| `positionHoldMs` | How long all checks must stay green. |

### Tracking

| Key | Meaning |
|---|---|
| `lumaTol`, `chromaTol` | Minimum brightness and tint tolerances. Raise them if the tape mask is patchy. Lower them if other things turn pink in debug view. |
| `tolFromSpread` | Tolerances also grow to this many standard deviations of the tape's own measured variation. |
| `searchRadius` | How far from the predicted position the tape may be. |
| `areaMin`, `areaMax` | Accepted blob size relative to the tape's size at tap time. |
| `tapSnapRadius`, `maxTapeArea` | How far a tap snaps, and the size at which a tap is rejected as "blends into the background". |
| `filterMinCutoff`, `filterBeta` | One Euro smoothing for the trail: lower cutoff = smoother when still, higher beta = less lag when fast. |
| `cameraWidth`, `cameraHeight`, `cameraFps` | Requested camera mode. Higher fps means less motion blur. |
