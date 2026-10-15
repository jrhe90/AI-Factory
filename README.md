# AI Factory

Real-time 3D digital twins of manufacturing plants, built with [three.js](https://threejs.org).
There is no build step and there are no external assets: every model is generated procedurally
in the browser.

| Page | What it is |
|------|------------|
| `index.html` | Demo hub |
| `motors.html` | **Electric Motor Plant**: an AI digital twin modelled on ABB's Baldor-Reliance motor manufacturing |
| `megafactory.html` | **Megafactory Twin**: utility-scale battery plant, modelled on Tesla's Lathrop Megafactory (see [Megafactory Twin](#megafactory-twin)) |
| `builder.html` | Line Builder: generic FlexSim-style objects and a layout editor |
| `capture.html` | Phone capture for the photo → 3D model pipeline (needs `node tools/capture-server.mjs`, see [Photo → 3D model](#photo--3d-model-img2threejs)) |
| `factory-builder/` | **Sim Factory Builder**: import your own layout (image, PDF or DXF), build the twin from a reusable library, draw AGV routes, staff stations and simulate (React + Vite, see [its README](factory-builder/README.md); a prebuilt copy is at `factory-builder/dist/`) |

## Run it

ES modules need to be served over HTTP (opening the files from disk won't work):

```bash
python3 -m http.server 8000
# or: npx serve .
```

Then open <http://localhost:8000>.

---

# Electric Motor Plant (AI digital twin)

![motor plant](assets/motors.jpg)

A live 3D twin of an industrial electric-motor plant, modelled on ABB's Baldor-Reliance motor
manufacturing (Fort Smith, AR). The layout follows a reference floor plan with three bands:

- **North:** office & QC lab, bracket machining, maintenance shop, press shop, **East Lines 1–3**,
  sub-assembly & kitting, raw material and the **General Warehouse**.
- **Middle:** the transformer yard, **Secondary Processes** (stator winding & VPI, orange dashed
  boundary) and the **Assembly Process** area (two final-assembly lines, blue dashed boundary).
- **South:** receiving dock, tool crib, **finished-goods staging** with three shipping docks,
  restrooms, lockers, kitchen and first aid, **Warehouse 2 & Rewinding**, and FG racking.

Zone areas on the yellow plan labels are computed from the model. **Plan colours** turns on the
plan legend: rack/storage green, workstation/machine blue, raw material orange, finished goods
yellow, fire extinguishers red.

### Process

```
Press shop ──► stator cores ─► Stator winding & VPI (U-line) ──► wound stators ─┐
   (laminations) └► rotor cores ─► East Line 1 · Rotors ◄── shafts ◄── East Line 2   │
East Line 3 · Frames ──► frames ─────────────────────────────────────────────────────┤
Bracket machining ──► end brackets ──────────────────────────────────────────────────┤
                                                                                      ▼
   Line A (NEMA) / Line B (IEC): stator shrink-fit → rotor → bearings & brackets → fan & cover →
   conduit box → run test → paint → vision QC (AI) → nameplate & pack
                                                                                      │
   line-end pallets ─► forklift ─► FG racking ─► tugger train ─► staging ─► forklift ─► trucks
```

- **9 lines, 48 stations** (including the rewind service shop) with purpose-built animated machines. Examples: a straight-side
  stamping press with flywheel and ram, rotor die-casting with a molten-aluminium furnace, CNC
  lathes and machining centres with sliding doors and coolant mist, twin-flyer coil winders, a
  VPI tank with a hoist and lifting lid, cure ovens, an induction shrink-fit heater, a dynamometer
  run-test stand, a paint booth with a robot, a vision arch and a laser marker.
- **The product is built visibly.** A primer-grey finned frame receives copper windings, a shaft,
  end brackets, a fan and cover, and a conduit box. It is painted (NEMA blue or IEC grey),
  nameplated and boxed, then stacked on pallets.
- **Feeder lines** fill stock racks (each item on the racks is one part in stock). Assembly
  stations consume that stock, so a feeder that stops starves assembly.
- **Logistics:** line-end pallets go by forklift to FG racking or directly onto a 5-cart tugger
  train. The train runs the main aisle to staging, where forklifts fill the drive-in lanes and
  load trucks that back into the dock doors. There are also AGVs, a receiving forklift and reach
  trucks.
- **People:** operators at every station, walkers who head to the kitchen and restrooms at break
  times, office staff, and maintenance technicians who walk out to the machines.

### AI layer

- **Predictive maintenance.** Each machine has a health model with simulated vibration
  (mm/s RMS), temperature and power signals. Random anomalies (bearing wear, hydraulic leaks,
  heater drift…) speed up wear. The AI raises an alert with the failure mode, remaining useful
  life and confidence. You can schedule the work order, and a technician walks to the machine
  for a short planned stop. If you don't, the machine breaks down and needs a longer repair.
  **AI autopilot** schedules work orders automatically when a machine is idle or its predicted
  failure is close. The plant tracks failures avoided and downtime saved.
- **Vision QC.** A live camera feed from the inspection arch, rendered in the corner, shows
  detection boxes projected from the real part geometry (housing, conduit box, fan cover,
  bracket, shaft) and a PASS/REJECT verdict. Defects (missing bracket bolt, fan-cover dent,
  missing conduit gasket, paint run…) are visible on the 3D motor. Their rate rises as the
  upstream machine wears, so a quality problem traces back to a maintenance problem.
- **Heatmaps.** Floor overlays for utilisation, power draw, blocking and failure risk.
- **Recommendations.** Bottlenecks, quality root cause, and energy idle-waste suggestions.
- **Copilot.** Ask "why is output below plan?", "what will fail next?" and similar. Built-in
  answers are computed from live plant data and come with action buttons (schedule, show
  heatmap, enable autopilot). Optionally, paste your own Anthropic API key under
  *Connect Claude* and Claude (`claude-opus-5-5`, via the official `@anthropic-ai/sdk`) answers
  open-ended questions from a JSON snapshot of the plant. Server-side refusal fallbacks are
  enabled. The key stays in your browser's localStorage and is sent only to api.anthropic.com.

**Time scale:** 1 simulated second = 20 factory seconds. The plan is 50 motors/hour across both
lines; the run-test stations are the constraint.

**Controls:** drag/scroll to orbit and zoom. Click a station for its card, which shows live
condition monitoring, a health/vibration trend, its prediction, *Schedule maintenance* and
*Inject fault*. Space pauses. Speeds run from ½× to 8×. Camera presets: Overview, Plan
(top-down, like the drawing), Assembly, Stator & VPI, East lines, Press, Logistics, Rewinding,
Shipping, Follow motor and a looping **Tour**. `window.motorPlant` exposes the model in the
console (`motorPlant.snapshot()`, `motorPlant.advance(seconds)`, `motorPlant.jump('assembly')`).

All figures are illustrative and simulated. This demo is not affiliated with or endorsed by ABB.

---

# Megafactory Twin

![megafactory](assets/megafactory.jpg)

A whole-plant digital twin of a utility-scale battery factory, modelled on Tesla's Megafactory in
Lathrop, CA. Open `megafactory.html`. The build plan and its decisions are in
[`docs/megafactory-v2-plan.md`](docs/megafactory-v2-plan.md).

## Process

```
Rail stock → Body in White (4) → Load & Hang ──┐                      Door & panel kits ─┐
                                               ▼                                         ▼
   Pretreatment (5-stage wash) → Dry-off oven → Primer booth → Primer touch-up → Gel oven → Cool
   → Topcoat booth → Topcoat touch-up → Cure oven → Cooling tunnel → Inspection ─┬─ pass ──┐
                                        Strip & recoat ◄── Paint repair ◄── reject ┘        │
   Coated frame buffer ◄────────────────────────────────────────────────────────────────────┘
   → Drop & Unload ─┬─ frames → Pack line: Chassis Load → HV Busbar → Module Install → Thermal
                    │                      → Enclosure & Doors → Coolant Fill → End-of-Line Test
                    │                      → Final QA → Gantry crane → Pickup pad
                    └─ door kits → Coated doors buffer ─(tugger)→ Enclosure & Doors
Cells → Battery modules (6) → Module racks (56 trays) ─(AGVs, 4 trays per pack)→ Module Install
Pickup pad ─(straddle-carrier pair)→ Storage lot (60) ─(pair)→ Truck bay → shipped
```

## Simulation

`src/megafactory/sim.js` and `plant.js` are an event-driven simulation in minutes. The state is plain
data and every random draw is keyed by (seed, stream, entity, index), so the same seed always gives
the same run and a running plant can be forked with `structuredClone` (ready for a future
multiverse view).

- **Nodes:** stations (one unit, manual work lognormal ±15 %, automatic ±3 %), accumulating
  conveyors (units keep their spacing and glide up when the one ahead leaves), buffers, a sink.
- **Behaviour:** breakdowns (MTBF/MTTR, booths separately), test re-runs at Module EOL (3 %) and
  End-of-Line Test (6 %), paint inspection with film thickness, gloss and a reject reason, spot repair
  or strip and recoat, 14 paint carriers, frames and door kits kept in balance on the shared rail,
  four trays and one door kit consumed per pack, three straddle-carrier pairs, trucks booked by lot
  stock.
- **Calibration:** End-of-Line Test is the constraint at about 67 min per pack (≈ 30.5 GWh/yr).
  `node tools/sim-check.mjs [days]` checks determinism, forking, takt and the bottleneck over 5 seeds.

## In the 3D view

- **Body in White:** rail stock, red weld cells with yellow robots throwing weld sparks, frames
  welded up piece by piece (base rails, posts, top rails), a laser geometry arch.
- **Powder coat shop:** power-and-free rail with empty carriers returning to Load & Hang; cut-away
  wash tunnel spraying only the stage a part is in; dry-off, gel and cure ovens with burners, fans,
  vapour and heat haze; primer and topcoat booths with reciprocating gun bars, powder that wraps onto
  the part and overspray that drifts to the cartridge wall. A finish shader sweeps the powder on from
  the gun line (bare steel → wet → epoxy primer → white topcoat → gloss after cure) and makes parts glow
  in the ovens. Painters in hooded coveralls touch up by hand; an inspector gauges every part and a
  live readout shows primer and topcoat thickness, gloss and PASS / REJECT.
- **Battery modules:** guarded robot cells with light curtains, laser-weld sparks, a potting gantry,
  trays filling with cells, welds, potting, lids and BMS boards; a stacker crane puts trays in the racks.
- **Pack line:** the HV busbar spine goes in piece by piece, modules slide in from both sides with
  lift-assist arms, the hoist lowers the thermal roof, sixteen doors swing shut, the coolant hose drops,
  a scanner sweeps the pack at End-of-Line Test (red light on a failed test), crews work each station.
- **Outbound:** the gantry crane lifts each pack onto the pickup pad; straddle-carrier pairs drive in,
  carry it out of the south door, along the lanes and into a lot slot, and later onto a flatbed truck
  that queues on the road, loads at the bay and leaves with the pack.
- **Site:** boulevard and north parking, west office, parking and substation, truck road with gate,
  drop trailers, trees and light poles. Employee cars (Model Y / Model 3) fill the lots for the day
  shift and thin out in the evening, following the factory clock.
- **Rendering:** ACES tone mapping, soft shadows, GTAO, bloom and vignette; static geometry merged per
  material; moving rigs (people, robots, carriers, trucks…) drawn as one instanced mesh per part;
  floor stencils and grid labels on texture atlases; andon lamps instanced with per-lamp colour.

## Controls

- **Drag / scroll** to orbit and zoom. **Space** pauses. Speeds: 1 s = 1, 4, 15 or 60 factory minutes.
- **Camera presets** (keys 1–0): plant, paint shop and outbound views, including the booths, cure
  oven, inspection, crane, storage lot, truck bay, parking and the whole site.
- **Follow a frame** (F) rides along through the paint shop; **Follow a pack** (G) from Chassis Load to
  the truck. You can orbit while following.
- **Click a station** in 3D, or open **Stations** (L) for a list by line, to see its status, current
  unit, plan vs measured cycle and time split, and to **inject or clear a fault**. A red dot on a
  line tab marks a line with a station down. **Random faults** turns breakdowns on and off.
- **KPIs:** packs built and shipped (MWh), takt, run-rate, the live bottleneck, paint and end-of-line
  first-pass yield, coated frames waiting, module trays in the racks, packs in the lot and trucks waiting.
- **Director tour** (D) plays a scripted cinematic tour under letterbox bars: thirteen shots from the
  whole site through Body in White, pretreatment, the booths (riding along with the part being
  sprayed), the ovens, modules, the pack line, End-of-Line Test, outbound and shipping, with captions
  that read live numbers (first-pass yield, takt, packs shipped, GWh/yr). Cuts dip to black; Esc or D exits.
- **Orbit** (C) slowly circles the current view; **4K still** (P) saves a 3840 × 2160 PNG of the 3D view.
- **H** hides the panels; **Quality** switches GTAO and pixel ratio for slower GPUs. If the frame rate
  stays under 30 fps for a few seconds the page drops to low quality once and says so.
- **Phones:** the ☰ button opens all views and controls as a sheet; the KPI strip scrolls sideways.
- URL options: `?seed=`, `?speed=`, `?view=`, `?quality=low`, `?clean=1`, `?follow=1` or
  `?follow=pack`, `?director=1`, `?paused=1`, and `?until=PRIMER` (run on until a part is at the guns or part-way
  through any section; add `&unit=frame` for a frame rather than a door kit).
- `window.megafactory` exposes the sim, `injectFault`, the views and `megafactory.perf` (CPU time per frame).

All figures are illustrative and simulated; this is not affiliated with or endorsed by Tesla.

## Line Builder (generic objects, FlexSim-style)

`builder.html` is a separate page for presenting any line without 3D modelling. It has a library of
generic objects: Source, Queue, Station, Conveyor, Sink, Operator, Robot, Rack, Cart, AGV, Forklift,
Table, Pallet, Tank, Fence and Zone. You place them from a JSON layout, connect them, and items
flow through:

- Stations have three styles (`bench`, `machine` for enclosed test rigs and ovens, `cell` for a
  robot behind a fence), animated operators, and a light tower: green working, amber blocked,
  red down.
- The side panel shows output, throughput, the busiest station, and each station's
  working / blocked / starved split.
- **Edit layout** opens the library and the property panel. Click an object to select it, then:
  drag to move, **R** rotate, **C** connect to the next object, **D** duplicate, **Delete** remove.
  Use Export / Import to copy a layout as JSON. Edits are kept in your browser.

A layout is a list of objects (see `layouts/pack-line.json`):

```json
{ "name": "My line", "item": { "size": [1.4, 0.55, 0.7], "color": "#eef0f2" },
  "objects": [
    { "id": "SRC", "type": "source", "x": -20, "z": 0, "interarrival": 60, "next": ["ST10"] },
    { "id": "ST10", "type": "processor", "label": "Assembly", "x": -14, "z": 0, "time": 55, "operators": 2, "next": ["C1"] },
    { "id": "C1", "type": "conveyor", "from": [-12.4, 0], "to": [-7.6, 0], "speed": 1, "next": ["SNK"] },
    { "id": "SNK", "type": "sink", "x": -5, "z": 0 },
    { "id": "AGV1", "type": "agv", "path": [[-20, -4], [0, -4], [0, -8], [-20, -8]] }
  ] }
```

Positions are in metres. `rot` is in degrees; flow runs along the object's local x axis, and
`rot: 90` points it toward +z. Times are simulated seconds. Movers (AGV, forklift, operator) follow
a `path`, either looping or back and forth with `"pingpong": true`.

## Photo → 3D model (img2threejs)

Photograph a piece of equipment on the line with your phone and get a procedural three.js model of it
in the Line Builder library. The reconstruction is done by
[img2threejs](https://github.com/img2threejs/img2threejs), an agent skill: Claude Code looks at the
photo and writes code that builds the object from primitives (no photogrammetry, no mesh files).
It runs on your computer in Claude Code, not on the phone.

```
Phone ──capture.html──► tools/capture-server.mjs ──► captures/<slug>/  (photos + size + role)
                                                          │  Claude Code: photo-to-model skill
                                                          ▼  (runs img2threejs → TypeScript factory)
builder.html ◄── models/captured/index.json ◄── tools/register-model.mjs
```

1. **Serve the repo with the capture server** (Node 18+, no dependencies):
   ```bash
   node tools/capture-server.mjs
   ```
   It prints a LAN address. Open `http://<computer-ip>:8000/capture.html` on a phone on the same Wi-Fi.
   There is no authentication, so only run it on a network you trust.
2. **Capture**: take one or more photos (front, side and three-quarter views give a much better
   model), name the object, enter its approximate size in metres (a photo alone has no scale), and
   choose **Station** (items stop there for a cycle) or **Equipment** (static prop). Uploads go to
   `captures/<slug>/`, which git ignores by default because factory photos are often confidential.
3. **Model it**: in Claude Code, in this repo, ask *"model the pending captures"* (or run
   `/photo-to-model`). The project skill in `.claude/skills/photo-to-model/` installs img2threejs if
   needed (`npx --yes img2threejs@latest install --host claude`). It then runs img2threejs's staged,
   screenshot-checked pipeline with this repo's constraints (metres, real-time budget, front facing
   +Z) and registers the result.
4. **Use it**: in `builder.html`, choose **Edit layout**. Captured models appear under **Captured**
   in the library. Any station can also switch its body to a captured model in the property panel.

In a layout, a captured station is a normal processor with a `model` field, so cycle times, faults
and blocked/starved stats all work as usual. Equipment uses the `captured` type:

```json
{ "id": "ST20", "type": "processor", "label": "Torque station", "model": "torque-station-3", "x": 0, "z": 0, "time": 55, "next": ["SNK"] },
{ "id": "CAP1", "type": "captured", "label": "Parts washer", "model": "parts-washer", "x": 4, "z": -5 }
```

`tools/register-model.mjs <slug> <factory.ts>` can also register any hand-written factory that returns a
`THREE.Group`. It strips the TypeScript with esbuild and records the name, role, size and yaw in
`models/captured/<slug>/model.json`. The builder scales each model to fit that size and stands it on
the floor. A model that fails to load shows as an orange placeholder box. Models built from one
photo are approximate: sides the camera didn't see are guessed.

## Project layout

```
index.html       demo hub
motors.html      Electric Motor Plant (AI digital twin)
megafactory.html Megafactory Twin page (megafactory-v2.html redirects here)
builder.html     Line Builder page (generic objects + layout editor)
capture.html     phone page for photographing equipment (served by tools/capture-server.mjs)
assets/          hub preview images
src/motors/      motor plant: main.js (lines, logistics, people, UI), models.js (motors, machines,
                 people, vehicles), plant.js (building, rooms, labels, walk graph), ai.js
                 (predictive maintenance, vision QC, heatmaps, copilot), fx.js, motors.css
layouts/         example layouts for the Line Builder
models/captured/ models generated from photos, plus index.json (the registry the builder loads)
tools/           capture-server.mjs (LAN upload + static server), register-model.mjs (TS factory → builder)
.claude/skills/  photo-to-model: Claude Code skill that runs img2threejs on a capture
src/builder/     Line Builder object library, flow engine and editor; captured.js loads captured models
src/capture/     capture page script and styles
src/megafactory/ Megafactory Twin: plant.js (process graph + layout), sim.js (event-driven sim),
                 app.js, hud.js, director.js, style.css; render/ (stage, building, paintshop, equipment,
                 logistics, site, items, packmodel, finish shader, particles, people, instancer)
src/cars.js      Model Y / Model 3 car models (instanced) and parking-lot driving
src/models.js    shared procedural meshes: robot, lift-assist, truck, straddle carrier, trailer,
                 forklift, module tray, finished pack (also used by the motor plant and Line Builder)
tools/sim-check.mjs  Megafactory sim checks: determinism, forking, takt, bottleneck
```

