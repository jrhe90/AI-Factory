# Megafactory Line Simulator

A real-time 3D simulation of a utility-scale battery pack production line, inspired by
Tesla's Megafactory (Lathrop, CA). Built with [three.js](https://threejs.org) — no build step,
no external assets; every model is generated procedurally.

![stations](https://img.shields.io/badge/stations-23-e82127) ![lines](https://img.shields.io/badge/lines-4-e82127) ![three.js](https://img.shields.io/badge/three.js-r160-black)

## Run it

ES modules need to be served over HTTP (opening `index.html` from disk won't work):

```bash
python3 -m http.server 8000
# or: npx serve .
```

Then open <http://localhost:8000>.

## What's simulated

Four connected lines share one flow engine. Each station holds one unit, and units keep a minimum
spacing, so a slow or broken station leaves the stations after it with no work (**Starved**) and
makes the ones before it wait (**Blocked**). Lines hand units to each other, so a problem upstream
works its way through the plant.

```
Body in White ──► Powder Coat (overhead conveyor) ──► Pack line ──► Shipping crane ──► Trucks
                                                         ▲
Battery Modules ──► Rack warehouse ──► AGVs ─────────────┘ (3 trays per pack)
```

### Body in White (back of plant)
| # | Station | What happens |
|---|---------|--------------|
| 01 | Base Frame Weld | Robots weld roll-formed rails into the base frame |
| 02 | Side Post Weld | 14 vertical posts are welded on |
| 03 | Roof Rail Weld | Top rails close the frame into a rigid box |
| 04 | Geometry Check | Laser arch scans the frame against CAD |

### Powder Coat (overhead power-and-free conveyor)
| # | Station | What happens |
|---|---------|--------------|
| 01 | Load & Hang | Frame is lifted off the BIW conveyor onto a carrier |
| 02 | Pre-treatment Wash | Degrease and conversion coat (spray mist) |
| 03 | Powder Booth | Spray robots coat the frame white |
| 04 | Cure Oven | Powder cures at ~200 °C (frame glows while inside) |
| 05 | Cool & Inspect | Fans cool the frame, then it rides the rail across the plant |

The rail climbs over the warehouse and drops coated frames straight onto the pack line's Chassis Load station.
Frames waiting on the rail act as the buffer.

### Battery Modules
| # | Station | What happens |
|---|---------|--------------|
| 01 | Cell Intake & Test | Cells are scanned and tested; a tray is indexed onto the line |
| 02 | Cell Insertion | 144 cells loaded into six module carriers |
| 03 | Interconnect Weld | Laser welding to copper collector plates (sparks) |
| 04 | Adhesive & Potting | Dispensing head fills the gaps with potting compound |
| 05 | Module Enclosure | Lids and sense boards fitted |
| 06 | Module EOL Test | Isolation and BMS checks; ~3% re-tested |

Finished trays go into the rack warehouse. Each crate on the racks is one tray in stock, up to 56.
When the racks are full the module line backs up. The pack line's Module Install station takes
3 trays (18 modules) per pack and is starved if stock runs out.

### Pack line
| # | Station | What happens |
|---|---------|--------------|
| 01 | Chassis Load | Coated frame is lowered off the paint rail onto a steel skid |
| 02 | Module Install | AGVs bring trays; two robots load 18 modules |
| 03 | Busbar & HV Wiring | Robots weld copper busbars (sparks) |
| 04 | Thermal & Inverter | Hoist sets the thermal roof with fans and power electronics |
| 05 | Enclosure & Doors | Doors and end caps are fitted and welded |
| 06 | Coolant Fill | Hose drops in, coolant loop is filled and leak-checked |
| 07 | End-of-Line Test | Scanner sweeps the pack; ~6% fail and are re-tested |
| 08 | Final QA | Inspection arch, release to shipping |

A gantry crane then lifts each finished pack onto a flatbed truck in a drive-through convoy.

**Time scale**: 1 simulated second = 4 factory minutes. The pack line's End-of-Line test is the
plant bottleneck, at roughly 1.1 packs/hour. At ~3.9 MWh per pack that is a ~35–40 GWh/year
run-rate, the same order as the real factory. The feeder lines run a little faster, so they fill
their buffers and then wait.

## Controls

- **Drag / scroll** — orbit and zoom
- **Click a station** (in 3D or in the list) — focus the camera and open its stats card;
  inject or clear a fault from there
- **Space** — pause / resume
- **½× … 8×** — simulation speed
- **Camera presets** — Overview, Follow pack, Module line, Body in White, Powder coat, Shipping
- **Line tabs** in the station panel switch between the four lines; a red dot marks a line with a fault
- **Random faults** — toggle random station breakdowns

`window.megafactory` exposes `{ sim, lines, stations, moduleStock }` in the browser console for poking at the model.

## Project layout

```
index.html       HUD markup + import map (three.js from jsDelivr)
src/main.js      plant layout, shared line engine, the four lines, crane & trucks, camera, UI
src/models.js    procedural meshes: pack, frame, module tray, paint carrier, robot, truck, AGV, worker
src/style.css    HUD styles
```

All figures are illustrative; this is not affiliated with or endorsed by Tesla.
