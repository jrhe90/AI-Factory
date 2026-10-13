# Demo video recorder

Records the one-minute Sim Factory demo: a new factory, the floor plan imported and scaled,
zones sketched, the plant auto-built, then simulated with the live dashboard open.

The app's render loop is paused and every frame is stepped and screenshotted, so the result is
smooth and repeatable even on a machine without a GPU. Timers and `Math.random` are virtualised
and seeded, so each run is identical.

```bash
cd factory-builder
npm run build && npx vite preview --port 4173 &
npm i -D playwright            # or use a global install
node scripts/demo-video/record.js            # writes scripts/demo-video/frames/f00000.jpg …
ffmpeg -framerate 30 -i scripts/demo-video/frames/f%05d.jpg \
  -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -movflags +faststart sim-factory-demo.mp4
```

| Variable | Default | Purpose |
|---|---|---|
| `URL` | `http://localhost:4173/` | App to record |
| `OUT` | `./frames` | Frame folder |
| `DSF` | `1.2` | Device scale (1600×900 CSS px × 1.2 = 1920×1080) |
| `CHROME_PATH` | Playwright's Chromium | Browser binary |
| `FROM` | `0` | Re-render from this frame, keeping the earlier frames |
| `DRY=1`, `EVERY=n`, `STOP_AT=s` | | Rehearse without saving every frame, save every n-th, stop early |

The zones drawn in the video are pixel boxes on the sample plan, in `zones.js`.
