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
Body in White ──► Powder Coat (overhead conveyor) ──► Pack line ──► Crane ──► Pickup pad
                                                                                  │ straddle carriers
                                                       Outbound trucks ◄── Storage lot ◄┘
                                                         ▲
Battery Modules ──► Rack warehouse ──► AGVs ─────────────┘ (4 trays per pack)
```

### Modelled on the Lathrop Megafactory video

The look and process details follow Tesla's *Meet Megafactory* video of the Lathrop, CA plant:

- Bright white building with a white column grid (with grid labels like G13), polished concrete floor,
  open steel roof joists and dense LED high-bays. The roof hides when you orbit above it.
- Yellow 6-axis robots. Body-in-White welding happens inside red translucent welding-curtain cells
  with red fixtures and welders. Yellow bridge cranes with blue hoists run over the pack line and BIW.
- Paint shop on a blue overhead conveyor: a stainless wash tunnel with nozzle risers spraying water,
  and a booth lit by tall light panels.
- On the pack line, packs ride low floor rails and the work is mostly manual. Technicians build an
  orange HV busbar spine first; operators then use lift-assist arms to slide orange-faced modules
  in from both sides. Doors swing shut as they're hung, and the thermal roof has two rows of fans
  and side louvres.
- The module line has silver aluminium guarding and light curtains, and a robot with a red gripper
  places the green BMS boards.
- Takt is calibrated to the video's "1 Megapack every 68 minutes". Finished units are staged in a yard
  outside the east wall.

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
| 02 | Cell Insertion | 144 cells loaded into twelve module carriers |
| 03 | Interconnect Weld | Laser welding to copper collector plates (sparks) |
| 04 | Adhesive & Potting | Dispensing head fills the gaps with potting compound |
| 05 | Module Lid & BMS Board | Robot with a red gripper places lids and green BMS boards |
| 06 | Module EOL Test | Isolation and BMS checks; ~3% re-tested |

Finished trays (12 modules each) go into the rack warehouse. Each crate on the racks is one tray in
stock, up to 56. When the racks are full the module line backs up. The pack line's Module Install
station takes 4 trays (48 modules) per pack and is starved if stock runs out.

### Pack line
| # | Station | What happens |
|---|---------|--------------|
| 01 | Chassis Load | Coated frame is lowered off the paint rail onto a steel skid |
| 02 | HV Busbar & Harness | Technicians build the orange HV busbar spine down the centre |
| 03 | Module Install | AGVs bring trays; lift-assist arms slide 48 modules in from both sides |
| 04 | Thermal & Inverter | Hoist sets the thermal roof with fans and power electronics |
| 05 | Enclosure & Doors | 16 doors are hung and swing shut, then the end caps go on |
| 06 | Coolant Fill | Hose drops in, coolant loop is filled and leak-checked |
| 07 | End-of-Line Test | Scanner sweeps the pack; ~6% fail and are re-tested |
| 08 | Final QA | Inspection arch, release to shipping |

A gantry crane then sets each finished pack on a pickup pad inside the building.

### Site, storage lot and outbound logistics

The site layout follows the MFTX aerial view:

- **North:** employee parking along the boulevard, with passing traffic.
- **West:** an office block, a second parking lot and a fenced substation yard.
- **South:** dock doors along the wall, with drop trailers backed in, and a large concrete court
  that holds the **Megapack storage lot**.

Finished packs move like this:

1. **Three tandem pairs of red straddle carriers** (six machines, styled on the units in the site
   photos) pick each pack up from the pad and carry it out through the south door. They drive
   crab-style down the lot's aisles and set it in a free slot (60 slots).
2. **Outbound flatbed trucks** arrive on the south road and stop at the loading bay. A carrier pair
   brings the oldest stored pack and lowers it onto the trailer, and the truck leaves. A pack counts
   as shipped when its truck leaves the site.
3. **Truck bookings follow stock:** more trucks come when the lot is above 40 packs, fewer when it
   drops below 12.

If the lot fills up, the pad stays occupied, the crane has to wait and the pack line backs up.

**Time scale**: 1 simulated second = 5 factory minutes. The pack line's End-of-Line test is the
plant bottleneck, giving a takt of about 68 minutes per pack, the figure quoted in the Megafactory
video. At ~3.9 MWh per pack that is roughly a 30 GWh/year run-rate before downtime. The feeder lines run a little faster, so they fill
their buffers and then wait.

## Controls

- **Drag / scroll** — orbit and zoom
- **Click a station** (in 3D or in the list) — focus the camera and open its stats card;
  inject or clear a fault from there
- **Space** — pause / resume
- **½× … 8×** — simulation speed
- **Camera presets** — Overview, Follow pack (follows a pack all the way onto its truck), Module line, Body in White, Powder coat, Crane, Storage lot, Site
- **Line tabs** in the station panel switch between the four lines; a red dot marks a line with a fault
- **Random faults** — toggle random station breakdowns

`window.megafactory` exposes `{ sim, lines, stations, moduleStock }` in the browser console for poking at the model.

## Project layout

```
index.html       HUD markup + import map (three.js from jsDelivr)
src/main.js      plant layout, shared line engine, the four lines, crane & trucks, camera, UI
src/site.js      exterior site: roads, parking lots and cars, office, substation, docks, trailers, landscaping
src/models.js    procedural meshes: pack, frame, module tray, paint carrier, robot, lift-assist, truck, AGV, worker, straddle carrier, trailer, yard vehicles
src/style.css    HUD styles
```

All figures are illustrative; this is not affiliated with or endorsed by Tesla.
