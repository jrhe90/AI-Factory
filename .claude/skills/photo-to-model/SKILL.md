---
name: photo-to-model
description: Turn a phone capture in captures/<slug>/ (uploaded from capture.html) into a procedural three.js model in the Line Builder library, using the img2threejs skill for the reconstruction. Use when the user asks to model, build or reconstruct a captured object, process pending captures, or turn a photo of line equipment into a 3D/three.js object.
---

# Photo → Line Builder model

The glue between this repo and [img2threejs](https://github.com/img2threejs/img2threejs).
img2threejs does the reconstruction (agent vision + its Python gates → a TypeScript factory that
returns a `THREE.Group`). This skill decides what to reconstruct, how big it is, and how the result
is registered so `builder.html` can place it.

## 0. Pick the capture

- `ls captures/*/capture.json`; a capture is pending when its `status` is `pending` and
  `models/captured/<slug>/` does not exist. If the user named none and several are pending, list
  them and do them one at a time, starting with the oldest.
- Read `capture.json` (`name`, `role`, `size` = `[width, height, depth]` in metres, `notes`,
  `photos[]` with a `view` label each) and look at every photo.
- If no photo shows a clear, mostly unobstructed object, stop and say what to reshoot. Don't model
  the background or a crowd of parts.

## 1. Make sure img2threejs is installed

Look for `~/.claude/skills/img2threejs/SKILL.md` (or `$IMG2THREEJS_HOME/SKILL.md`). If it is
missing, install it (needs Node ≥ 18, Git, Python ≥ 3.10):

```bash
npx --yes img2threejs@latest install --host claude
```

Call its root `$I2T` below. Read `$I2T/SKILL.md` in full before starting. It is the authority on
order of operations, gates and stop conditions, and this skill doesn't override any of them.

## 2. Run the img2threejs pipeline

Keep everything for one capture in `captures/<slug>/work/`. Run img2threejs's scripts from `$I2T`
and pass absolute paths into the work folder:

```bash
REPO="$PWD"; W="$REPO/captures/<slug>/work"; mkdir -p "$W"
cd "$I2T"
python3 forge/state.py init --state "$W/.img2threejs/state.json" --reference "$REPO/captures/<slug>/photo-1.jpg" --profile generic --spec "$W/object-sculpt-spec.json"
python3 forge/next.py --state "$W/.img2threejs/state.json"
```

Then follow `next.py` step by step as img2threejs's SKILL.md says. These inputs are specific to
this repo. Put them in the assessment and spec:

- **Intended use:** a real-time browser prop in a factory layout, seen from 5–40 m and next to
  dozens of other objects. Not a hero render.
- **Budget:** `performanceBudget.targetTriangles` ≤ 20000 (≤ 6000 for simple objects). Use
  shared materials, and no post-processing or environment maps inside the model. The builder
  provides the lights and environment.
- **Complexity:** usually `simple` or `moderate`. Keep identity-defining features (guarding,
  fixtures, HMI, light curtains, conveyor rollers, colour blocking) and leave out micro detail
  that won't read from 10 m.
- **Scale and orientation:** model in metres, Y up, base on y = 0. If `size` is given, match its
  proportions (the builder rescales to `size` exactly, so proportions matter more than absolute
  numbers). The operator side or front should face +Z, and if the object has a flow direction,
  parts should travel along +X.
- **Extra photos:** when there are two or more views, use them as img2threejs suggests
  (orthographic silhouettes for `geometryDescriptor.visualHull`, and evidence for hidden sides)
  rather than guessing the back. Record what no photo shows as low-confidence.
- **Notes** from `capture.json` are user evidence. Feed them into the spec.

Generate the factory into the work folder, e.g.
`forge/stage3_build/generate_threejs_factory.py "$W/object-sculpt-spec.json" --out "$W/src/create<Name>Model.ts"`.
img2threejs's screenshot/review gates need a page that renders the factory on its own. Use
`$I2T/scripts/capture_threejs_playwright.py` or Playwright directly against a scratch HTML page that
imports the factory (Chromium is preinstalled in cloud sessions). If img2threejs hard-stops
(`next.py` exit 3), report its reason to the user and don't skip ahead.

## 3. Register it with the Line Builder

```bash
node tools/register-model.mjs <slug> captures/<slug>/work/src/create<Name>Model.ts
# optional: --rotate 90 (if the front isn't +Z) · --size w,h,d · --role station|equipment · --factory name
```

This strips the TypeScript (esbuild via npx), writes `models/captured/<slug>/model.js` and
`model.json`, adds the model to `models/captured/index.json` and marks the capture `modelled`.
If the model's work position isn't sensible (the item should sit on a fixture, not on the roof),
add `"workPoint": [x, y, z]` (metres, model-local, after scaling) to `model.json`.

## 4. Check it in the builder

Serve the repo (`node tools/capture-server.mjs` or `python3 -m http.server 8000`) and load
`builder.html` with a layout that uses the model. For a station that's
`{ "type": "processor", "model": "<slug>", ... }` wired between a source and a sink; for equipment
it's `{ "type": "captured", "model": "<slug>" }`. Take a Playwright screenshot from the 3D view and
look at it. Check that:

- it stands on the floor at a believable size next to the operators (1.75 m tall)
- the front faces the operator and items arrive at the work point
- there are no console errors, and no orange placeholder box (orange box = load or build failure)

Fix with `--rotate`, `workPoint` or a spec change, then re-register.

## 5. Report

Tell the user what was built, which photo views it used, and what is approximate or guessed (hidden
sides, internal parts, exact dimensions). Say how to add it: Edit layout → Captured section in the
library. The capture photos stay in `captures/`, which git ignores by default. Ask before
committing them, because factory photos are often confidential.
