# Kendo Shinai Flicker Count

A small browser minigame: flick your shinai up and down in front of the camera as many times as you can in 30 seconds.

Plain HTML, CSS and JavaScript. No framework, no build step.

```
index.html
css/style.css
js/config.js    <- every tunable number
js/tracker.js   <- color tracking of the tip
js/flick.js     <- up/down flick counter
js/main.js      <- screens, camera, countdown, trail, debug view
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

## How to play

1. **START**.
2. Tap or click the **white tip** of the shinai in the video. This saves its color.
3. "ARE YOU READY?", then 3, 2, 1, then **GO!** The 30 s timer starts at GO.
4. Flick up and down. One full up-then-down counts as 1 flick.
5. On the result screen, **RETRY** reuses the saved color and goes straight to the countdown. **MAIN MENU** asks for a new tap next time.

Press **D** at any time to show the debug view:

- Cyan pixels are pixels that match the saved color.
- The green cross is the detected tip.
- The white circle is the search area.
- The yellow and pink lines are the current low and high points of the flick.
- The text panel shows the match count and the flick state.

Tracking works best when nothing else in view is white or very bright (white walls, lamps, windows).

## Tuning (`js/config.js`)

Positions are fractions of the frame **height**: `0` is the top, `1` is the bottom, and `0.10` means "10 % of the frame height". The values work the same at any camera resolution.

### Flick detection

| Concept | Config key | What it does in the code (`js/flick.js`) |
|---|---|---|
| **Hysteresis, first threshold** | `upThreshold` | In `WAIT_UP` the code tracks the lowest point. Once the tip rises this far above it, the state switches to `WAIT_DOWN`. |
| **Hysteresis, second threshold** | `downThreshold` | In `WAIT_DOWN` the code tracks the highest point. Once the tip falls this far below it, one flick is counted and the state goes back to `WAIT_UP`. |
| **Minimum vertical distance** | `minAmplitude` | `low - high` (the full travel) must be at least this much, or the cycle is ignored. |
| Debounce | `minFlickIntervalMs` | Two flicks closer together than this count as one. |
| Losing the tip | `lostResetMs` | If the tip disappears for longer than this, the up/down cycle starts over. |

Why there are two thresholds: if you used one line ("above the line = up"), a tip shaking right on the line would cross it many times and count fake flicks. With two thresholds, each switch needs a real move away from the last extreme, so jitter in the gap between them can't flip the state. In code this is just a `state` variable plus two `if` comparisons.

Tuning tips:

- **Small shakes are counted:** raise `minAmplitude`, or raise `upThreshold` and `downThreshold`.
- **Real flicks are missed:** lower those three values. Check in debug view that the tip stays FOUND during fast moves.
- **Fast flicks merge into one:** lower `minFlickIntervalMs`, and raise `smoothing` (closer to `1` means less lag).

### Tracking

| Key | Meaning |
|---|---|
| `colorTolerance` | How close (RGB distance, 0 to 441) a pixel must be to the saved color. Raise it if the mask is patchy. Lower it if the background lights up. |
| `minPixels` | Fewer matches than this means "not found" for that frame. |
| `searchRadius` | Prefers matches near the last tip position, which ignores white things elsewhere. `0` turns it off. |
| `smoothing` | Lerp factor per frame. `1` means raw position, lower values are smoother but lag more. |
| `procWidth` | Width of the hidden processing canvas (default 160). |

### Game and trail

`gameDurationSec`, `readyMs`, `countdownStepMs`, `goMs`, `trailMs`, `trailWidth`.
