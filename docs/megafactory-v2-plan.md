# Megafactory v2: build plan

Goal: rebuild `megafactory.html` as a whole-plant digital twin with visual quality equal to or
better than the reference app (https://multiverse-factory-twin.web.app/), with the powder coat
line as the showcase.

## Decisions

| Topic | Decision |
|---|---|
| Scope | Whole plant: Body in White → powder coat → modules → pack line → yard. Paint shop built first and in most detail. |
| Multiverse (fork, 100-future grid, levers, commit/rewind) | **Parked.** The sim keeps its state as plain data with seeded randomness so it can be added later without a rewrite. |
| Booths | Automatic gun bars (reciprocators, both sides) plus a manual touch-up stage with hand guns. |
| Coats | Primer + white topcoat, **inline**: primer booth → gel oven → topcoat booth → cure oven. |
| Page | Replaces `megafactory.html`. New code lives in `src/megafactory/`; the page switches over once the new build has everything the current one has (end of Phase 3), then the old `src/main.js` is removed. |
| Stack | No build step, ES modules + import map, three.js 0.169. |

## What the reference does well (to match or beat)

- Overhead power-and-free rail with drop rods, a switch around the booths, and hanging carriers.
- Cutaway enclosures: near wall knee-high, translucent upper wall, so the process is visible.
- Booths with reciprocating gun bars, powder particles in the live colour, lit booth and powder
  cloud, cartridge filters, cyclone, powder feed centre.
- Ovens with burner boxes, stacks with vapour and a heated floor glow.
- Rendering: ACES tone mapping, soft shadows, room environment lighting, GTAO ambient occlusion,
  bloom, vignette; static geometry merged per material; procedural textures; CSS2D labels; floor
  stencils with planned vs measured cycle time; andon lamps; animated workers.
- Presentation: KPI bar, cinematic orbit, director mode with captions, 4K still capture.

Where we go further: coverage that builds up on the part as the guns sweep (instead of an
instant colour swap), powder wrap and overspray extraction, manual hand-gun operators, oven heat
shimmer, wash spray and mist, and HUD panels that cover less of the scene.

## Status

- **Phase 1: done.** Preview at `megafactory-v2.html`. Sim calibrated (≈ 67 min/pack, EOL constraint),
  deterministic and forkable; building, placeholder equipment for every area, units, HUD.
- **Phase 2: done.** Detailed powder coat shop: finish shader with gun-line coverage, booths with
  reciprocators and powder wrap, wash tunnel, ovens, touch-up painters, inspection readout, empty
  carrier return, paint-shop cameras and follow mode.
- **Phase 3: done.** BIW, modules, pack line, crane, straddle carriers, lot, trucks, AGVs and the site
  rebuilt; fault inject/clear, station list, bottleneck and energy KPIs. `megafactory.html` now runs the
  new build (`megafactory-v2.html` redirects) and the old `src/main.js`, `src/site.js` and `src/style.css`
  are removed.
- **Phase 4: done.** Director tour with letterbox captions and live numbers, cinematic orbit, 4K stills,
  phone layout (menu sheet, scrolling KPIs), automatic quality drop on slow devices.
- Next: the parked multiverse view.

## Phases

### Phase 1: Foundation
- Renderer: ACES, PCF soft shadows, PMREM room environment, GTAO, bloom, vignette, optional bokeh
  for close-ups.
- Geometry batching helper (merge static meshes per material), procedural textures (concrete with
  saw cuts, brushed metal, wall panels, signage, hazard stripes).
- CSS2D labels, HUD (top bar with clock and speed, KPI strip), camera presets with fly-to.
- Deterministic flow sim separated from rendering: plain-data state, seeded hash randomness,
  station / buffer / conveyor nodes, blocked and starved states, breakdowns. Calibrated to
  ~68 min per pack with End-of-Line Test as the constraint.
- New plant layout with a paint shop sized for ~9 m frames.

### Phase 2: Powder coat line
Process:
1. Load & hang (manual, lift table)
2. Pretreatment: 5-stage wash tunnel (alkaline degrease, rinse, zirconium conversion, rinse, DI rinse)
3. Dry-off oven
4. Primer booth: automatic gun bars on both sides
5. Primer touch-up: operators with hand guns on corners and door frames
6. Gel oven (partial cure)
7. Cool zone
8. Topcoat booth (white): automatic gun bars
9. Topcoat touch-up: hand guns
10. Cure oven, ~200 °C
11. Cooling tunnel
12. Inspection: film thickness and gloss
13. Touch-up or strip-and-recoat loop for rejects
14. Unload onto pack line Chassis Load

Visuals:
- Power-and-free rail (free + power track), drop rods, carriers with load bars, accumulation zones.
- Part finish shader: bare steel → wet sheen → matte grey primer → matte white powder → gloss white
  after cure, with coverage that follows the gun sweep along the frame.
- Booth: cutaway shell, light panels, reciprocators synced to the gun stroke, particle powder that
  wraps toward the part, overspray drawn into extraction, cartridge filter module, cyclone,
  powder feed centre with hoppers, gun control cabinet.
- Manual touch-up platforms with operators using hand guns.
- Ovens: burner boxes, ducts, stacks with vapour, heat shimmer, part temperature tint.
- Wash tunnel: spray risers, water particles, mist, drips.
- Andon lamps, floor stencils, film-thickness readout at inspection.
- Cameras: follow a carrier, booth close-ups.

### Phase 3: Rest of the plant
Port Body in White, battery modules + rack warehouse + AGVs, pack line, gantry crane, straddle
carriers, storage lot and trucks from the current sim into the new renderer at the same visual
standard. Then switch `megafactory.html` to the new build and remove the old code.

### Phase 4: Presentation
Camera tour, director mode with letterbox captions, 4K still capture, 60 fps target on a laptop,
small-screen layout, README and demo hub updates.

### Parked: Multiverse
Disruption → fork into 100 futures over a 10×10 lever grid → replications in Web Workers →
leaderboard with confidence ranges → commit, rewind and run beside a "do nothing" twin.

## Verification per phase
- Node test harness: same seed gives the same run; takt and bottleneck match the targets.
- Playwright screenshots of fixed camera views (including booths mid-spray).
- Frame-rate and draw-call check.
