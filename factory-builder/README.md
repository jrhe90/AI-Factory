# Sim Factory Builder

A "Sim City for factories": import your plant layout, build a 3D digital twin of it from a
reusable object library, and simulate the flow of parts, vehicles and people.

React + three.js, built with Vite. The 3D library is shared with the static demos in this repo
(`../src/builder/objects.js`, `../src/motors/models.js`).

```bash
cd factory-builder
npm install
npm run dev        # http://localhost:5173
npm run build      # static site in dist/ (open with `npm run preview`)
```

On first launch it opens a **reference plant**: the sample floor plan rebuilt with walls,
zones, aisles, AGV routes, four connected lines, vehicles and operators. **New** starts an
empty factory; **Sample** reloads the reference.

## Workflow

1. **Import layout.** Drop in a PNG/JPG/WebP drawing, a PDF (first page) or a DXF.
   - Images and PDFs become a see-through floor. Use **Calibrate scale** (M): click two points
     whose real distance you know (a column bay, a door) and type the distance.
   - DXF keeps its geometry and units (`$INSUNITS`). Toggle layers in Properties and turn any
     layer into walls with **→ walls**. DWG has to be saved as DXF first.
   - No drawing? Sketch the building directly with the tools below.
2. **Sketch the building.** Walls (W), zones (Z), aisles (A). Zone types include production,
   assembly, secondary processes, warehouse, storage, dock, office, welfare and **break area**,
   and every zone shows its area in m².
3. **Auto-build** (optional). Fills every zone from a template for its kind and wires the
   result into one flow, so you get a working mid-size plant from a sketch in one click:
   - *Warehouse* and *dock* zones get receiving doors and an ASRS or raw-material racks.
   - *Production*, *secondary* and *assembly* zones get parallel lines along their long side
     (machining, stator and motor assembly), with line-side buffers and conveyors.
   - *Storage* zones get finished-goods racks and a shipping door on the outside wall.
   - Manual stations are staffed, break areas get tables, and an AGV loop with a main aisle,
     cross aisles and a spur to every pick-up point is laid out, with AGVs and forklifts.

   Auto-build is rule-based, not AI. Everything it creates is ordinary objects, links and
   routes that you can edit.
4. **Place equipment** from the library. Drag a card onto the floor, or click it and then click
   the floor. Objects snap to the grid (Alt bypasses snapping). Overlapping footprints turn red.
5. **Connect the flow** (C): click an upstream object, then a downstream one. Links can be a
   **conveyor** (with accumulation), a **manual hand-off** or **vehicle transport**.
6. **Draw AGV routes** (P). All routes form one network; crossing routes are joined. Vehicles
   serve transport links along the shortest path.
7. **Staff it.** Set *Operators needed* per station. Either place real operators (*Add operator
   here*) or leave a virtual crew. Crews stop for the shift breaks and walk to the nearest
   break area.
8. **Simulate.** Throughput, WIP, lead time, bottleneck, per-station working / blocked /
   starved / down split and vehicle utilisation, with light towers and status discs in 3D.
   Speeds go up to 1200× so you can run a whole shift in under a minute.
9. **Dashboard.** Opens live KPIs over the 3D view: units shipped, rolling hourly throughput,
   WIP, lead time, station and fleet utilisation, breakdowns, trends over the run, station
   states over time, each station's time split with the bottleneck flagged, and an event log.

Use the **Plant** tab for the tree of zones → lines → stations, storage, vehicles, operators and
routes. Use **Save** / **Open** for the `.json` project file. The project also autosaves in the
browser.

## Object library

| Category | Objects |
|---|---|
| Flow | Source, Sink, Buffer, Receiving dock, Shipping dock |
| Workstations | Manual workbench, Assembly bench, Wiring bench, Lift-assist, Inspection bench, Pack & label |
| Robots | Robot cell, Robot load cell, Robot stack & weld, Robot paint booth, Vision QC arch |
| Machines | CNC lathe, Machining centre, Stamping press, Hydraulic press, Bar saw, Grinder, Die-casting cell, Parts washer, Cure oven, Run-test stand, CMM, Coil winder, VPI tank, Induction heater, Generic machine |
| Battery modules | Cell loading & OCV/IR, Plasma cleaning, Cell gluing, Stacking & compression, Side plate laser welding, Busbar / CCS placement, Busbar laser welding, Module EOL test, Module pallet conveyor, Cell tray rack, Module rack |
| Battery packs | Housing loading, Thermal paste dispensing, Module install (gantry), Module bolting, HV / LV wiring & BMS, Lid installation, Leak test, Pack EOL test, Pack unloading, Pack pallet conveyor |
| Storage | Pallet rack, **ASRS** (stacker crane), Shelving, Pallet stack, Tank |
| Vehicles | AGV, Forklift, Straddle carrier, Tugger |
| People | Operator |
| Site | Safety fence, Kit cart, Table, Building column |

Add an object type by adding an entry to `src/library/catalog.js`. An entry is a `build(props)`
function returning a three.js group plus entry/exit points, a simulation `role` and editable
`fields`.

## Keys

| Key | Action |
|---|---|
| V W Z A P C M | Select, wall, zone, aisle, route, connect, calibrate |
| R / Shift+R | Rotate selection (or the object being placed) ±90° |
| Q / E | Rotate ±15° |
| Ctrl+D | Duplicate |
| Del | Delete |
| Ctrl+Z / Ctrl+Shift+Z | Undo / redo |
| Arrows | Nudge (Shift = ×5) |
| Enter / double-click | Finish a wall, aisle or route |
| Esc | Cancel / back to select |
| F | Focus the selection |

Mouse: left-drag on empty floor pans, right-drag orbits, the wheel zooms. In drawing tools,
right-drag pans.

## Project file

```jsonc
{
  "floor":   { "source": { "kind": "image|pdf|dxf", ... }, "mpp": 0.082, "center": [0, 4.2], "rotation": 0 },
  "walls":   [{ "id": "W1", "points": [[x, z], ...], "height": 3, "thickness": 0.2 }],
  "zones":   [{ "id": "Z1", "name": "Assembly", "kind": "assembly", "points": [[x, z] x4] }],
  "aisles":  [{ "id": "A1", "points": [...], "width": 3 }],
  "lines":   [{ "id": "L1", "name": "Assembly Line A", "color": "#7c5cff" }],
  "objects": [{ "id": "CNC1", "type": "cnc-lathe", "name": "CNC turning", "x": -14, "z": -36, "rot": 0,
                "lineId": "L1", "props": { "cycleTime": 110, "operators": 1, "mtbf": 0, "mttr": 15 } }],
  "links":   [{ "id": "K1", "from": "CNC1", "to": "MAC1", "kind": "conveyor|manual|transport" }],
  "routes":  [{ "id": "R1", "name": "Main loop", "points": [...], "oneWay": false }],
  "shifts":  { "start": 6, "length": 8, "breaks": [{ "at": 2, "minutes": 15 }] }
}
```

Metres, seconds and degrees; x is east, z is south. The format is plain JSON, so AI layout
recognition (phase 2) can write it directly.

## Roadmap (phase 2)

- AI layout review: read an image or DXF and propose zones, lines and stations for approval.
- AI scene generation: map recognised stations to library objects and propose flows and routes.
- Import real cycle times and downtime from CSV/MES exports, then live data (OPC UA, MQTT).
