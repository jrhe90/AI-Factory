# Megafactory Line Simulator

A real-time 3D simulation of a utility-scale battery pack production line, inspired by
Tesla's Megafactory (Lathrop, CA). Built with [three.js](https://threejs.org) — no build step,
no external assets; every model is generated procedurally.

![stations](https://img.shields.io/badge/stations-8-e82127) ![three.js](https://img.shields.io/badge/three.js-r160-black)

## Run it

ES modules need to be served over HTTP (opening `index.html` from disk won't work):

```bash
python3 -m http.server 8000
# or: npx serve .
```

Then open <http://localhost:8000>.

## What's simulated

Packs flow down a roller conveyor through eight stations. Each pack is visibly assembled as it goes:

| # | Station | What happens |
|---|---------|--------------|
| 01 | Chassis Load | Overhead hoist lowers a steel skid/frame onto the line |
| 02 | Module Install | AGVs ferry modules from the rack warehouse; two robots load 18 modules |
| 03 | Busbar & HV Wiring | Robots weld copper busbars (sparks) linking modules into HV strings |
| 04 | Thermal & Inverter | Hoist sets the thermal roof with fans and power electronics |
| 05 | Enclosure & Doors | Doors and end caps are fitted and welded |
| 06 | Coolant Fill | Hose drops in, coolant loop is filled and leak-checked |
| 07 | End-of-Line Test | Scanner sweeps the pack; ~6% fail and are re-tested |
| 08 | Final QA | Inspection arch, release to shipping |

A gantry crane then lifts each finished pack onto a flatbed truck in a drive-through convoy.

**Flow logic** — each station holds one pack; packs keep a minimum spacing on the conveyor, so a slow
or faulted station starves the stations downstream and blocks the ones upstream. Station status is
shown live (Working / Blocked / Starved / Fault) in the side panel and on each gantry beacon.

**Time scale** — 1 simulated second = 4 factory minutes. The End-of-Line test is the bottleneck,
pacing the line at roughly 1 pack/hour, which at ~3.9 MWh per pack is a ~35–40 GWh/year
run-rate — the same order as the real factory.

## Controls

- **Drag / scroll** — orbit and zoom
- **Click a station** (in 3D or in the list) — focus the camera and open its stats card;
  inject or clear a fault from there
- **Space** — pause / resume
- **½× … 8×** — simulation speed
- **Camera presets** — Overview, Follow pack, Module bay, Test bay, Shipping
- **Random faults** — toggle random station breakdowns

`window.megafactory` exposes `{ sim, stations }` in the browser console for poking at the model.

## Project layout

```
index.html       HUD markup + import map (three.js from jsDelivr)
src/main.js      scene, line/flow simulation, crane & trucks, camera, UI
src/models.js    procedural meshes: pack, robot arm, truck, AGV, worker, textures
src/style.css    HUD styles
```

All figures are illustrative; this is not affiliated with or endorsed by Tesla.
