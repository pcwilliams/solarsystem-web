
# Web Development Conventions

Browser-based apps built with vanilla JS and standard web APIs. No build tooling unless the project genuinely requires it.

## Stack

- **Language:** JavaScript (ES2020+, ES modules)
- **Dependencies:** Prefer CDN-loaded libraries over npm for simple projects (no bundler needed)
- **No build step:** ES modules with import maps. `python3 -m http.server` is the only tooling required for local dev.
- **UI:** Vanilla HTML/CSS — no framework required for most projects

## Local Development

A local HTTP server is **required** — `file://` URLs block ES module imports and `fetch()` due to CORS restrictions:

```bash
python3 -m http.server 8080
# Open http://localhost:8080
```

## Browser Developer Tools

- **Console:** Check for JS errors, failed imports, asset load failures
- **Performance tab:** Profile frame rate for rendering-heavy features — should sustain 60fps on modern hardware
- **Network tab:** Verify all assets load correctly; check for unexpected cache hits
- **Device toolbar:** Test responsive layout and touch events in mobile simulation mode

## Cross-Browser Testing

Test in at least **Chrome** and **Safari** (different WebGL/rendering implementations). Firefox is a useful third check. Key differences:

- **Texture colour space (WebGL):** Always set `texture.colorSpace = THREE.SRGBColorSpace` on loaded JPEG textures to avoid washed-out colours
- **Touch events:** Safari handles `passive` touch listeners differently — use `{ passive: false }` on touch handlers that call `preventDefault()`
- **Import maps:** Require Safari 16.4+, Chrome 89+, Firefox 108+
- **WebGL2:** Required for PBR materials — supported by virtually all browsers since 2020

## iOS Safari Gotchas

- **`touch-action: none` on body/container:** Prevents ALL touch interactions on overlaid UI elements, even those with higher z-index. Only apply `touch-action: none` to the `<canvas>` or interactive element itself, never to full-screen containers.
- **`-webkit-user-select: none` on body:** Suppresses click event synthesis from touches. Scope to the canvas container only.
- **Click events don't fire:** iOS Safari may not synthesize `click` from `touchend` in certain stacking contexts. Use a dual `touchend` + `click` handler with a flag to prevent double-firing. The `touchend` handler calls `preventDefault()` to fire immediately.
- **Portrait zoom framing:** Phone portrait viewports are much taller than wide. Camera or layout framing must account for aspect ratio or content appears tiny in the narrow width.
- **Emoji icons unreliable:** Some mobile browsers render emoji as tofu boxes. Use inline SVGs with `currentColor` fill instead of unicode emoji for toolbar icons.
- **HTML caching:** Mobile Safari aggressively caches HTML. Set `Cache-Control: no-cache, no-store, must-revalidate` plus `Pragma: no-cache` and `Expires: 0` meta tags to force revalidation. Static assets (textures, scripts) can still cache normally.

## Performance

- **Cap `devicePixelRatio` at 2x** via `setPixelRatio(Math.min(devicePixelRatio, 2))` — 3x Retina devices render 9x the pixels for marginal quality gain
- **Throttle DOM updates:** Updating innerHTML with many elements every frame kills performance. Throttle to every 3rd frame or use change-only updates.
- **`sizeAttenuation: false` for point sprites:** So sizes are in screen pixels, not world units (avoids perspective scaling of UI elements like star labels)

## CORS and Module Support

- `file://` URLs block ES module imports and `fetch()` — always use a local HTTP server
- Import maps require modern browser versions (Safari 16.4+, Chrome 89+, Firefox 108+)
- WebGL2 is required for `MeshStandardMaterial` PBR — check support if targeting older browsers

## Deployment

- Exclude developer files (CLAUDE.md, architecture.html, tutorial.html, dev scripts) from production deploys
- Immutable assets (textures, fonts) can be cached aggressively; HTML should not be cached

---


# Space Mechanics & Celestial Rendering

Conventions for any app that simulates planet / moon / spacecraft motion and renders it in 3D — distilled from a multi-platform SceneKit solar-system port.

## Constants (single source of truth)

Keep these as named constants on a single `OrbitalMechanics` (or equivalent) namespace; never inline the literals:

| Name | Value | Notes |
|------|-------|-------|
| J2000.0 | `2451545.0` | Reference Julian Date for all element epochs |
| Days/Julian century | `36525.0` | For `T = (JD - J2000) / 36525` |
| AU in km | `149_597_870.7` | IAU 2012 definition |
| Earth equatorial radius | `6378.137` km (or `6371` mean) | Used in geocentric scene scaling |

If the IAU revises any of these, you change one place.

## Orbital mechanics pipeline (Keplerian, CPU)

For tens of bodies the cost is microseconds per frame — no GPU compute benefit. Pipeline:

1. `julianDate(from: Date) -> Double` — Meeus algorithm, Gregorian → JD.
2. `julianCenturies(from: Date) -> Double` — `(JD - 2451545.0) / 36525.0`.
3. `elements.elements(at: T) -> CurrentElements` — base value + rate × T (per JPL).
4. `meanAnomaly = L - varpi`, normalised to `[0, 2π)` via `truncatingRemainder`.
5. `solveKepler(M, e) -> E` — Newton-Raphson with initial guess `E0 = M + e·sin(M)`, tolerance `1e-8`, max 50 iterations.
6. `trueAnomaly(E, e) -> ν = 2·atan2(sqrt(1+e)·sin(E/2), sqrt(1-e)·cos(E/2))`.
7. `r = a · (1 - e·cos(E))` — heliocentric distance.
8. Rotate by Ω, I, ω to ecliptic `(x, y, z)`.

**Numerical gotchas:**
- Use `Double` for Julian dates and elements. `Float` precision is insufficient.
- For high eccentricity (`e > 0.9`), the `M + e·sin(M)` initial guess still converges but bound iterations defensively.
- Always wrap angles via `truncatingRemainder(dividingBy: 2·π)` to keep `M` in `[0, 2π)`.

For moons, simplified circular orbits with period-based mean motion are usually accurate enough: `M = longitudeAtEpoch + (2π / period) · daysSinceJ2000`.

## IAU rotation model (every body)

Each body gets `RotationProperties(periodHours, obliquity, w0, tidallyLocked)`. Apply per frame with **quaternion composition**, not Euler angles:

```
finalRotation = tiltQuat(around X axis) * spinQuat(around Y axis)
```

**Why quaternions, not Euler:** SceneKit applies Euler angles in Y-X-Z order, so writing `eulerAngles = (tilt, spin, 0)` causes the tilt axis itself to rotate with the spin and you get a wobble per spin cycle. With quaternion composition, tilt is fixed in space and spin is around the tilted pole — physically correct.

Tidally locked moons just match their orbital period. A ring system (e.g. Saturn's) needs to **counter-rotate in local frame** to cancel the parent planet's spin so the ring stays in the equatorial plane.

## Coordinate system mapping

Common Apple-3D convention:

- **Orbital mechanics**: heliocentric ecliptic — x, y in the ecliptic plane, z perpendicular.
- **SceneKit / RealityKit**: y is up. Map `scene.x = ecliptic.x`, `scene.y = ecliptic.z`, `scene.z = -ecliptic.y`.

This means when you compute angles in the scene, "horizontal position" is `(x, z)`, not `(x, y)`. Using `(x, y)` for an azimuth like `atan2(x, y)` will silently place things below the ecliptic plane.

## Distance / radius scene scaling

Real distances span 4+ orders of magnitude. Pure realism makes the inner system invisible. Three formulas keep ordering correct while bringing everything into view:

```
sceneDistance(au)        = log(1 + au / 0.5) * 15            // planets, heliocentric
sceneRadius(km)          = sqrt(km) * 0.00125                // planet radii (floor 0.012)
moonSceneDistance(ratio) = pow(realRatio, 0.6) * 1.5         // moon distance from parent
```

- `0.5` is the "knee" — distances under that AU compress less aggressively. Tune for inner-system visibility.
- `sqrt` (rather than linear or log) gives Jupiter ~3.3× Earth (real is 11.2×) — readable without overwhelming.
- Moon compression: with exponent `0.6` and scale `1.5`, the Moon sits at ~17.6 Earth radii (real 60.3). Exponent `0.4` collapses it too far (~8.8). `0.6` is the sweet spot.

**Centralise these.** Any mission/trajectory rendering code must use the *same* formulas as the body-positioning code, otherwise vehicles drift away from the bodies they should hug. Mark static helpers `nonisolated` so they're callable from `@MainActor` and pure-math contexts alike.

Geocentric mission scaling matches moon scaling:
```
geocentricSceneR(km) = earthSceneR * pow(distKm / earthRadiusKm, 0.6) * 1.5
```

Use the parent's **semi-major axis** (not its instantaneous distance) when placing satellites/orbiters near a body — actual distance fluctuates with eccentricity (Moon: ±21,000 km) and makes vehicles miss the rendered mesh.

## Star catalogue rendering

Bundle the **Yale Bright Star Catalog, 5th Rev. (BSC5)** — Hoffleit & Warren (1991), prepared at NASA Goddard NSSDC/ADC, public domain. Available via VizieR catalogue [V/50](https://cdsarc.cds.unistra.fr/viz-bin/cat/V/50) as `catalog.gz` (197-byte fixed-width records, 9,110 stars). Filter to naked-eye visibility (`mag ≤ 6.5`) — that's roughly 8,400 stars. Map RA/Dec to a celestial sphere at large radius (`r = 500` scene units works well).

Avoid the **HYG database** unless the project tolerates CC-BY-SA. HYG v3+ is licensed CC-BY-SA 4.0 (was 2.5 in earlier versions) — the share-alike clause is incompatible with permissive (MIT/BSD) project licences. BSC5 is a clean PD substitute that preserves the same RA/Dec/Vmag/B-V columns; rebuild from the raw VizieR file with a small parser script.

Star *names* (Sirius, Vega, Aldebaran …) are traditional / IAU-standardised — factual references, not subject to copyright, so they can be embedded freely or cross-referenced from the IAU-CSN list regardless of catalogue licence.

Use **4 brightness tiers** with different point sizes (mag < 1.5 → 3–8 px; mag 5–6.5 → 0.8–2 px) and **per-vertex B-V colour** for spectral type (blue-white O/B → white A → yellow G → orange K → red M).

Label only the brightest ~120 named stars (Sirius, Vega, Betelgeuse, …). The label-occlusion check (hide a star label when a planet's screen disc covers it) is `O(stars × bodies)` per frame — keeping labels at ~120 stays cheap.

## Saturn-style rings: use custom disc geometry

`SCNTube` UV-maps caps **linearly**, not radially, so a ring-strip texture stretches and warps. Build a custom flat disc:

- 72 radial segments × 4 ring segments
- `u` maps 0 (inner radius) to 1 (outer radius) — radially across the texture
- Apply ring colour map + alpha transparency for density
- `lightingModel = .constant` so it stays visible without a normal map
- Counter-rotate each frame to cancel parent's spin (see IAU rotation note)

## Mission / trajectory rendering

Each mission is a `SCNNode` group child of the scene. Geocentric missions (Apollo, Artemis) reposition the group to Earth's scene location every frame; heliocentric missions (Voyager, Cassini) stay at the origin. **Trajectory line shape is pre-computed at init** — only the group position updates per frame.

### Centripetal Catmull-Rom (alpha = 0.5)

Smooth waypoint sequences with centripetal Catmull-Rom (alpha = 0.5, matching Three.js's `CatmullRomCurve3`). **Sample by uniform time, not arc length**, so the marker advances linearly with mission time.

Knot-clamp guard: minimum knot delta `1e-8` prevents division-by-zero when two adjacent waypoints coincide (anchored waypoints at similar timestamps can collide).

### Moon-aligned waypoint frames

Lunar-mission waypoints are usually authored with `+X toward the Moon at flyby time`, in km. At init:

1. Compute the Moon's ecliptic angle at the flyby instant.
2. Rotate all waypoints by that angle to ecliptic.
3. Now any launch date yields a physically aligned trajectory.

`anchorMoon: true` on a waypoint replaces it with the Moon's actual ecliptic direction × **semi-major-axis distance** (not instantaneous distance, which is eccentric — see scene-scaling note).

`anchorBody: "planet_id"` on a heliocentric waypoint replaces it with that planet's `heliocentricPosition(...)` at time `t`.

### Runtime lunar orbit / landing phases

Don't try to express tight close-up motion as waypoints. Add explicit phase descriptors:

| Phase | Behaviour |
|-------|-----------|
| `moonOrbit(start, end, period, radiusKm)` | Each frame: `phase = (t - start) / period · 2π`, position = `moonScenePos + tangent·cos·r + normal·sin·r` where tangent/normal are perpendicular to the Earth-Moon line |
| `moonLanding(start, end)` | Marker snaps to `moonScenePos` for the entire window |
| `moonOrbitReturn` | Same as `moonOrbit` for post-landing ascent |

Orbit radius in scene units: `sceneDistance(sma + radiusKm) - sceneDistance(sma)` so the close-orbit shrinks proportionally with the same `pow(0.6)` compression as the body itself.

### `autoTrajectory: "transfer"` (Hohmann arcs)

For interplanetary transfers (e.g. Earth→Mars), expand 2–3 anchor waypoints into an elliptical arc:
- Prograde (CCW) sweep between anchor angles
- Linear radius interpolation with a `sin(π · frac)` outward bulge
- 12 intermediate samples per segment

**Order matters**: resolve `anchorBody` waypoints to real planet positions *first*, then expand the transfer arc, then CatmullRom-sample. The transfer-arc generator expects already-resolved x/y/z, not anchor sentinels.

### Line geometry

`SCNGeometryElement(primitiveType: .line, ...)` takes **pairs** of indices, not a strip. Build `[0,1, 1,2, 2,3, …]` for a connected polyline.

**Trajectory lines should bypass the depth buffer:** set both `writesToDepthBuffer = false` and `readsFromDepthBuffer = false`. Without `readsFromDepthBuffer = false`, the half of an Apollo flyby behind the Moon disappears into the lunar mesh and the trajectory appears to terminate at the lunar horizon.

### Event detection

Each mission has a list of `MissionEvent(t, name, detail, showLabel)`. `checkEventTrigger(simulatedDate)` returns the next unfired event whose timestamp was just crossed. Each event fires once via a `lastTriggeredEvent[missionId]` cursor; a rewind past the cursor-pointed event resets it so replays work.

**The rewind-reset check must run unconditionally** — even when simulation time is outside the mission's active window — so jumping far before launch still clears the cursor.

## Camera framing math

### Sun-side framing (planet picks, mission selection)

Place the camera between the Sun (at scene origin) and the target so the day side faces the camera, then offset slightly so the terminator falls on the far side for a two-thirds-lit view:

```swift
azimuth   = atan2(-targetPos.x, -targetPos.z) + 0.55  // ~31° off Sun direction
elevation = 0.3                                       // ~17°
```

**Sign matters.** The camera's spherical offset is *from* the target, so the direction toward the Sun is `-targetPos / |targetPos|`. Using `atan2(targetPos.x, targetPos.z)` (positive args) places the camera on the anti-Sun side and the target renders unlit.

Distance:
```swift
distance = extent * baseMultiplier * (0.5 + 0.5 * min(aspect, 1))
```

- `baseMultiplier = 0.8` for moon-hosting bodies (Earth, Mars, Jupiter, Saturn) — frame includes moons.
- `baseMultiplier = 6.0` for moonless ones (Mercury, Venus, Uranus, Neptune, Pluto, Sun) — pull back to give context.
- The aspect-scaled portrait factor tightens the frame on phones where the constraining dimension is much smaller than landscape.

### Lazy-follow mission camera (geocentric only)

For Apollo/Artemis-style missions that orbit Earth:

1. Compute `missionBounds(missionId)` — the trajectory's local AABB (Earth-relative). Returns `nil` for heliocentric missions (use overview reset instead).
2. Apply Sun-side framing as above, with `distance = radius / tan(30°) * 1.4` to fit the trajectory's local radius into a portrait viewport.
3. Per-frame, lerp the camera target toward `earthScenePos + localCenter` at `0.02/frame` so the trajectory stays centred as Earth drifts.
4. Hook the gesture coordinator's `.began` callback (not `.changed`) to clear the lazy-follow flag — user touches anywhere → full manual control for the rest of the session.

Heliocentric missions span AU; framing them tightly breaks because the trajectory overlaps the Sun. Skip framing and do an overview reset.

### Framing reads node positions, not init defaults

Before any camera-framing math reads `node.position`, run the per-frame `updatePositions(...)` once for the current simulated date. Otherwise nodes are still at their default origin and you'll frame on `(0, 0, 0)` (the Sun). Same gotcha applies to launch-arg `-focus` handling — defer until the camera coordinator connects, then run positions, then frame.

## SceneKit gotchas (everything below has bitten this domain)

### `allowsCameraControl` conflicts with programmatic camera

SceneKit's built-in `allowsCameraControl` maintains internal state that fights any programmatic camera moves. **Disable it entirely** and implement custom gestures with explicit spherical state (`target`, `distance`, `azimuth`, `elevation`).

### `SCNText` can't hold constant screen size

3D text labels grow/shrink with zoom. For HUD-style labels that must stay readable at all zoom levels, project 3D positions to screen coords each frame and render with SwiftUI `Text` views overlaid on the SCNView.

### `SCNView.projectPoint` blocks the render thread on macOS

Each call waits ~16.7 ms (one 60 Hz frame) for a render-thread sync. Projecting 26 bodies per UI-update frame at high time-scales = 230–280 ms stutter every ~1 s. **Bypass it**: build the view × projection matrix once per frame, then do the world → clip → screen maths with SIMD (sub-millisecond for dozens of points). Same code path on iOS is also ~100× faster than `projectPoint`.

### `camera.projectionTransform`'s aspect term doesn't track viewport on macOS

The matrix it returns has a `[0][0]` term that doesn't match the live `view.bounds` aspect, so labels drift horizontally from their bodies. Construct the projection matrix yourself from `camera.fieldOfView` + live aspect each frame.

```
horizontal FOV (macOS default):  xScale = f,         yScale = f * aspect
vertical   FOV (iOS default):    xScale = f / aspect, yScale = f
where f = 1 / tan(fov/2)
```

### `SCNCameraProjectionDirection` has no `.automatic` case

Only `.horizontal` and `.vertical`. macOS defaults to horizontal, iOS to vertical. Applying the wrong formula stretches one axis.

### Label screen-radius needs the real projection factor

To offset labels just above each body's on-screen disc:

```
cachedPixelsPerUnit = yScale * (viewportHeight / 2)   // cached per frame
screenR             = worldRadius * cachedPixelsPerUnit / clip.w
offsetY             = max(8, screenR + 4)             // 8 pt floor for non-sphere nodes
```

A rough `r / clip.w * 300` formula undershoots on widescreen Mac windows by 3–4× — labels land *inside* the planet disc.

### SwiftUI label overhead

100+ labels re-rendered via `@Published` every frame kills performance. Throttle re-projection to every 3rd frame, hide labels entirely during zoom-slider drags.

## Performance debugging

For real-time scenes, ship a `-frameLog` launch arg that prints per-frame timing with sub-phase breakdown (e.g. `bodies`, `stars`, `decon`, `mm`, `mui`):

- Print every tick > 20 ms or work > 5 ms (individual STUTTER lines)
- Print a once-per-second summary (fps, worst tick, worst work)

When a single sub-phase column spikes while others stay flat, the stutter is localised — that's how `projectPoint` blocking was tracked down (bodies ballooned to 230 ms, everything else stayed under 1 ms, pointing straight at per-label projection).

Recipe (macOS):
```bash
APP=$(find ~/Library/Developer/Xcode/DerivedData/<Project>-*/Build/Products/Debug/<Project>.app -maxdepth 0 | head -1)
"$APP/Contents/MacOS/<Project>" -frameLog > /tmp/frame.log 2>&1 &
sleep 10
grep STUTTER /tmp/frame.log | head -20   # individual slow frames, with sub-phase breakdown
grep summary  /tmp/frame.log | head -10   # once-per-second roll-up
pkill -f "Contents/MacOS/<Project>"
```

Healthy output: `fps~60 worst-dt=16.8ms worst-work=3.3ms` per second.

## Testing

Pure-math helpers (scaling, Catmull-Rom sampling, Kepler solver, rotation math) belong in `internal static` (or `nonisolated`) functions taking explicit parameters. They run identically on iOS Simulator and macOS — and macOS is much faster for CI since there's no simulator boot.

Test specifically:
- Log distance monotonicity, moon compression formula, sqrt radius clamps/floors.
- CatmullRom endpoint hits, interior uniform-u hits, two-point linearity, time-parameterised sampling, out-of-range clamping, degenerate-waypoint safety.
- Mission rotation, anchor resolution, autoTimeScale preset snap, transfer-arc monotonic timeline.
- Event fire-once + rewind reset (cursor must reset even when sim time is outside the active window, so jumping pre-launch still clears it).

## Texture / data sources (MIT-redistributable)

These sources have worked, are easy to fetch, and stay clear of share-alike (CC-BY-SA) and non-commercial (CC-BY-NC) licences that would block bundling under a permissive project licence:

- Earth: NASA Blue Marble Next Generation — public domain
- Moon: NASA LRO Camera — public domain
- Mars: USGS Viking MDIM21 via Wikimedia — public domain
- Mercury / Venus / Saturn (body + rings) / Uranus / Neptune: [Solar System Scope](https://www.solarsystemscope.com/textures/) — CC-BY 4.0
- Jupiter: NASA/JPL/SSI Cassini [PIA07782](https://photojournal.jpl.nasa.gov/catalog/PIA07782) — public domain
- Pluto: NASA/JHUAPL/SwRI New Horizons — public domain
- Galilean moons (Io, Ganymede, Callisto): [Björn Jónsson](https://bjj.mmedia.is/) from NASA/JPL Voyager + Galileo data — "publicly available, please mention origin" (CC-BY-equivalent)
- Europa: NASA/JPL Voyager/Galileo mosaic via Wikimedia — public domain
- Stars: Yale Bright Star Catalog 5th Rev. (BSC5), Hoffleit & Warren 1991 / NASA Goddard NSSDC/ADC, via [VizieR V/50](https://cdsarc.cds.unistra.fr/viz-bin/cat/V/50) — public domain

**Avoid for MIT-redistributable projects:**
- Planet Pixel Emporium (James Hastings-Trew) — "free non-commercial" only
- HYG Database v3+ (astronexus) — CC-BY-SA 4.0 (share-alike is viral copyleft)
- Steve Albers' planetary maps — page declares "personal non-commercial use only" despite being derived from public-domain NASA data

NASA, USGS, and PDS-hosted Cassini data are public domain (US Government works). Solar System Scope textures are CC-BY 4.0 — credit them. Björn Jónsson's terms ("publicly available, please mention origin") are functionally CC-BY. All three categories can be bundled with a permissive (MIT/BSD/Apache) project licence as long as the attributions are preserved (typically via a `THIRDPARTY.md` notice file and an in-app credits panel).

---

# SolarSystem Web - Claude Code Developer Reference

## Overview

A browser-based solar system simulation using Three.js, ported from the iOS SolarSystem app. Uses real Keplerian orbital mechanics (JPL J2000.0 elements) to calculate planet, moon, and Sun positions based on the current date and time. Three.js renders the 3D scene with PBR materials and NASA/public-domain texture maps on all planets and major moons. 8,404 real stars from the Yale Bright Star Catalog (BSC5) form the backdrop, with correct positions, magnitudes, and B-V colours. All bodies rotate at their real IAU sidereal rates with correct axial tilts.

Physics runs on the main thread (lightweight trig per body per frame). Rendering runs on the GPU via WebGL through Three.js with PBR materials, multi-layer Sun corona sprites, and Saturn's rings with Cassini colour/transparency maps.

11 space missions are rendered as trajectory trails with multi-vehicle support, real-time telemetry, and event banners: Artemis II, Apollo 8, Apollo 11, Apollo 13, Cassini-Huygens, Voyager 1, Voyager 2, Perseverance, New Horizons, Parker Solar Probe, and BepiColombo. Geocentric missions use Moon-aligned waypoints; heliocentric missions use AU-scale ecliptic coordinates with anchor points snapped to real planet positions. The ISS is modelled as an Earth satellite with a procedural 3D cross-shaped structure (truss + solar panels + radiators).

Zero external dependencies beyond Three.js (loaded from CDN). No build step, no bundler — pure ES modules served as static files.

## Architecture

### Data Flow

```
Real Time (Date)
    -> Julian Centuries from J2000.0
        -> Keplerian Elements (JPL data)
            -> Heliocentric Ecliptic Coordinates
                -> Logarithmic Distance Scaling
                    -> Three.js Mesh Positions (GPU/WebGL)
                        -> IAU Rotation (quaternion axial tilt + spin)
                            -> WebGLRenderer
                                -> HTML/CSS Overlay (Labels, HUD, Zoom, Controls)
                                    -> CameraController (mouse + touch)

Mission Trajectories (parallel path):
    Real Time (Date)
        -> Mission Elapsed Time / Timeline Slider Scrub
            -> Geocentric or Heliocentric Waypoint Interpolation (CatmullRom)
                -> Moon-Aligned Frame Rotation (geocentric) / eclipticToScene() (heliocentric)
                    -> pow(0.6) Distance Compression (geocentric) / log scale (heliocentric)
                        -> Vehicle Markers + Trajectory Lines (camera-distance scaled)
                            -> Telemetry Panel (MET, distance, speed)
                                -> Event Banner System
```

### Key Design Decisions

- **Three.js over raw WebGL**: PBR materials (`MeshStandardMaterial`), lighting, camera, raycasting out of the box. GPU-accelerated via WebGL2. Direct analogue to the iOS app's SceneKit.
- **No build tooling**: ES modules with import maps. Three.js loaded from CDN. `python3 -m http.server` is the only tooling needed.
- **CPU for orbital mechanics**: ~20 trig ops per body per frame = microseconds. No WebWorker benefit.
- **Custom camera controller**: Three.js's built-in `OrbitControls` doesn't match the iOS app's gesture model (one-finger pan, two-finger/right-click orbit). Wrote a custom `CameraController` with explicit spherical state.
- **DOM overlay labels**: Three.js `CSS2DRenderer` exists but adds a dependency. Simple DOM elements positioned via `Vector3.project()` give the same result — pixel-perfect, clickable, constant size at all zoom levels. Star labels are occluded behind planet discs.
- **Logarithmic distance scaling**: Real distances span 4 orders of magnitude. `log(1 + AU/0.5) * 15` preserves ordering while keeping everything visible. Identical formula to the iOS app.
- **Sqrt radius scaling**: `sqrt(km) * 0.00125` for planet radii. Jupiter 3.3x Earth (real 11.2x) while keeping small planets visible. Moons use real ratio to parent with 0.012 minimum floor.
- **Moon distance compression**: `pow(realRatio, 0.6) * 1.5` preserves relative ordering. Constants `MOON_DIST_EXPONENT` (0.6) and `MOON_DIST_SCALE` (1.5) are exported from `sceneBuilder.js` and imported by `main.js` and `missions.js` — a single-constant change tunes all moon/satellite/mission distance compression.
- **Sprites for Sun corona**: The iOS app uses nested glow spheres with additive blending. Three.js `Sprite` with additive blending achieves the same billboard glow effect more efficiently.
- **Throttled label updates**: Labels only re-project every 3rd frame to reduce DOM manipulation overhead.
- **Real star catalogue**: 8,404 stars from Yale Bright Star Catalog 5th Rev. (BSC5, Hoffleit & Warren 1991, NASA Goddard NSSDC/ADC, public domain). All entries at V ≤ 6.5 (naked-eye). ~370 named stars labelled. Build script at `tools/build_stars.py` regenerates `textures/stars.csv` from the raw VizieR catalogue.
- **Tone mapping**: `ACESFilmicToneMapping` at exposure 1.2 gives the PBR materials a natural, film-like look matching the iOS app's SceneKit rendering.
- **Multi-vehicle mission architecture**: Each mission has a `vehicles` array, each with independent trajectory, colour, and time window. The `primary` vehicle is tracked by the camera. This supports Apollo-style CSM/LM separation at the Moon.
- **Dual reference frames**: Geocentric missions (Artemis II, Apollo) use Moon-aligned waypoints in km. Heliocentric missions (Voyager, Cassini, New Horizons, etc.) use `referenceFrame: 'heliocentric'` with waypoints in AU ecliptic coordinates, positioned via `eclipticToScene()` directly. Heliocentric mission groups are placed at the origin rather than Earth.
- **anchorBody system**: Heliocentric waypoints with `anchorBody: 'planet_id'` are snapped to the real planet position at initialization via `heliocentricPosition()`. Ensures trajectories start/end at actual planet locations regardless of date precision.
- **anchorMoon system**: Geocentric waypoints with `anchorMoon: true` are resolved to the Moon's actual ecliptic position at that time using `moonPosition()`, converting AU to km and using the semi-major axis for distance matching. Used for Apollo 11 Columbia's LOI, TEI, and early return waypoints so the trajectory line departs smoothly from where the Moon actually is. This is the geocentric equivalent of `anchorBody` for heliocentric missions.
- **autoTrajectory: 'transfer'**: For simple transfer orbits (e.g. Perseverance Earth-Mars), generates smooth elliptical arcs between anchor points automatically via `_generateTransferArc()`.
- **Moon-aligned waypoint frame**: Geocentric mission waypoints are defined in a frame where +X points toward the Moon at flyby time. At initialization, the code computes the Moon's ecliptic direction and rotates all waypoints to match.
- **CatmullRom time-parameterised paths**: Waypoints are smoothed with CatmullRom splines for visual quality, but sampled at uniform time steps so the line progresses in sync with mission elapsed time.
- **Auto-speed per mission**: On mission selection, timeScale snaps to the nearest preset targeting ~45s replay. Formula: `idealSpeed = durationHours * 80`, snapped to nearest of [100, 1000, 10000, 100000, 1000000, 10000000].
- **Camera-distance marker scaling**: Vehicle markers scale with `max(0.04, camDist * 0.012)` so they remain visible at all zoom levels, from Earth-Moon scale to outer solar system.

## Tech Stack

- **Language**: JavaScript (ES2020+, ES modules)
- **3D Framework**: Three.js r170 (via CDN import map)
- **UI**: Vanilla HTML/CSS with backdrop-filter glass-morphism
- **Minimum Target**: Any browser with WebGL2 and import map support (Chrome 89+, Firefox 108+, Safari 16.4+, Edge 89+)
- **Dependencies**: Zero (Three.js from CDN, no npm, no bundler)

## Project Structure

```
solarsystem-web/
├── CLAUDE.md                    # This developer reference
├── MISSIONS.md                  # Mission system technical reference (for iOS port)
├── README.md                    # User-facing documentation
├── architecture.html            # Interactive architecture diagrams
├── tutorial.html                # Build narrative
├── index.html                   # Single-page application (HTML + CSS + UI)
├── web-server.sh                # Launch script: python3 local server on port 8080
├── js/
│   ├── main.js                  # Entry point, animation loop, UI event wiring (~1100 lines)
│   ├── missions.js              # 11 missions, trajectories, vehicles, telemetry (~1200 lines)
│   ├── solarSystemData.js       # JPL elements: 9 planets + 17 moons + ISS + Sun (~270 lines)
│   ├── orbitalMechanics.js      # Julian dates, Kepler solver, positions (~190 lines)
│   ├── sceneBuilder.js          # Scene graph, materials, rings, glow, starfield, ISS model (~500 lines)
│   ├── textureGenerator.js      # Procedural Sun texture, glow textures (102 lines)
│   └── cameraController.js      # Orbital camera with mouse + touch gestures (~320 lines)
└── textures/
    ├── earth_2k.jpg             # NASA Blue Marble (5400x2700, 2.4 MB)
    ├── moon_2k.jpg              # NASA LRO (1024x512, 136 KB)
    ├── jupiter_2k.jpg           # NASA Cassini PIA07782 (3601x1801, 431 KB)
    ├── saturn_2k.jpg            # Cassini composite (1800x900, 69 KB)
    ├── mars_2k.jpg              # Viking MDIM21 mosaic (4096x2048, 2.6 MB)
    ├── mercury_2k.jpg           # MESSENGER (2048x1024, 852 KB)
    ├── venus_2k.jpg             # Atmosphere map (2048x1024, 224 KB)
    ├── uranus_2k.jpg            # Voyager-based (2048x1024, 76 KB)
    ├── neptune_2k.jpg           # Voyager-based (2048x1024, 236 KB)
    ├── pluto_2k.jpg             # NASA New Horizons (5926x2963, 3.8 MB)
    ├── io_2k.jpg                # Voyager/Galileo (4096x2048, 997 KB)
    ├── europa_2k.jpg            # Voyager/Galileo (1024x512, 133 KB)
    ├── ganymede_2k.jpg          # Voyager/Galileo (4096x2048, 938 KB)
    ├── callisto_2k.jpg          # Voyager/Galileo (1800x900, 430 KB)
    ├── saturn_rings.png         # Ring colour + alpha (2048x125 RGBA, 12 KB)
    └── stars.csv                # Yale BSC5: 8,404 stars (258 KB)
```

**Total: 7 JavaScript files, ~3,680 lines of code. 17 texture/data files. 1 HTML file.**

## Celestial Bodies

### Planets (JPL J2000.0 Keplerian Elements)

| Body | a (AU) | e | I (deg) | Scene Radius | Rotation Period | Axial Tilt |
|------|--------|---|---------|-------------|-----------------|-----------|
| Mercury | 0.387 | 0.206 | 7.00 | 0.062 | 58.65 days | 0.03° |
| Venus | 0.723 | 0.007 | 3.39 | 0.097 | 243 days (retro) | 177.4° |
| Earth | 1.000 | 0.017 | 0.00 | 0.100 | 23.93 hours | 23.4° |
| Mars | 1.524 | 0.093 | 1.85 | 0.073 | 24.62 hours | 25.2° |
| Jupiter | 5.203 | 0.048 | 1.30 | 0.331 | 9.93 hours | 3.1° |
| Saturn | 9.537 | 0.054 | 2.49 | 0.302 | 10.66 hours | 26.7° |
| Uranus | 19.189 | 0.047 | 0.77 | 0.199 | 17.24 hours (retro) | 97.8° |
| Neptune | 30.070 | 0.009 | 1.77 | 0.196 | 16.11 hours | 28.3° |
| Pluto | 39.482 | 0.249 | 17.14 | 0.043 | 6.39 days (retro) | 122.5° |

### Moons (17 total) and Satellites

- **Earth**: Moon (27.32d, obliquity 6.7°), ISS (408 km altitude, 92-min orbit, 51.6° inclination — off by default, toggled via Satellites menu)
- **Mars**: Phobos (0.32d), Deimos (1.26d)
- **Jupiter**: Io (1.77d), Europa (3.55d), Ganymede (7.15d), Callisto (16.69d)
- **Saturn**: Mimas (0.94d), Enceladus (1.37d), Tethys (1.89d), Dione (2.74d), Rhea (4.52d), Titan (15.95d), Iapetus (79.32d)

### Texture Sources

| Body | Source | Licence |
|------|--------|---------|
| Earth | NASA Blue Marble Next Generation | Public domain (US govt) |
| Moon | NASA LRO Camera | Public domain (US govt) |
| Mars | USGS Viking MDIM21 via Wikimedia | Public domain |
| Mercury | MESSENGER via Solar System Scope | CC-BY 4.0 |
| Venus | Atmosphere map, Solar System Scope | CC-BY 4.0 |
| Uranus | Voyager-based, Solar System Scope | CC-BY 4.0 |
| Neptune | Voyager-based, Solar System Scope | CC-BY 4.0 |
| Jupiter | NASA/JPL/SSI Cassini PIA07782 | Public domain |
| Saturn (+rings) | Solar System Scope | CC-BY 4.0 |
| Pluto | NASA/JHUAPL/SwRI New Horizons | Public domain |
| Io, Ganymede, Callisto | Björn Jónsson, from NASA/JPL Voyager + Galileo data | Publicly available, attribution requested |
| Europa | NASA/JPL Voyager/Galileo via Wikimedia | Public domain |
| Stars | Yale Bright Star Catalog 5th Rev. (BSC5, NASA Goddard NSSDC/ADC) via VizieR V/50 | Public domain |

## Orbital Mechanics

The full Keplerian pipeline (Julian dates, Newton-Raphson Kepler solver, true anomaly, ecliptic rotation), IAU rotation via quaternion composition, moon position formula, and the J2000.0 / AU constants live in the `astro` skill. Three.js's coordinate convention matches the skill's "Apple-3D" mapping: `scene.x = ecliptic.x`, `scene.y = ecliptic.z` (up), `scene.z = -ecliptic.y`. The standard distance scaling (`log(1 + AU/0.5) * 15`) and moon compression (`pow(realRatio, 0.6) * 1.5`) are also in the skill — `MOON_DIST_EXPONENT` and `MOON_DIST_SCALE` are exported from `sceneBuilder.js` so `main.js` and `missions.js` can reuse them.

## Missions

### Architecture

Missions are managed by `MissionManager` in `js/missions.js`. Each mission has:
- **Metadata**: id, name, launchDate, durationHours, flybyTimeHours, `referenceFrame` ('geocentric' or 'heliocentric')
- **Vehicles array**: each with id, name, colour, `primary` flag, waypoints, optional `autoTrajectory`, optional `moonLanding`, and optional `moonOrbit`
- **Events array**: timestamped mission events with name and detail text

### 11 Missions

| Mission | Type | Reference Frame | Duration |
|---------|------|----------------|----------|
| Artemis II | Lunar flyby | Geocentric | ~210 hours |
| Apollo 8 | Lunar orbit | Geocentric | ~147 hours |
| Apollo 11 | Lunar landing | Geocentric | ~195 hours |
| Apollo 13 | Lunar free-return | Geocentric | ~143 hours |
| Cassini-Huygens | Saturn orbiter | Heliocentric | ~57,000 hours |
| Voyager 1 | Jupiter-Saturn flyby | Heliocentric | ~28,000 hours |
| Voyager 2 | Grand tour | Heliocentric | ~105,000 hours |
| Perseverance | Mars transfer | Heliocentric (autoTrajectory) | ~4,900 hours |
| New Horizons | Pluto flyby | Heliocentric | ~78,000 hours |
| Parker Solar Probe | Solar orbiter | Heliocentric | ~43,800 hours |
| BepiColombo | Mercury orbiter | Heliocentric | ~52,000 hours |

### Multi-Vehicle Support

Each vehicle has independent waypoints, a trajectory line, glow points, and a marker sprite. The `primary` flag designates which vehicle the camera autotrack follows. For Artemis II: SLS (launch to MECO), SRBs (separate and fall back), Orion (MECO to splashdown). Vehicles can have a `moonOrbit` property with `{ startTime, endTime, periodHours, radiusKm }` for runtime circular orbit around the Moon (computed as cos/sin motion around the Moon's actual scene position each frame, orbit plane perpendicular to the Earth-Moon line). After `moonOrbit` ends, a 5-hour lerp transitions the marker from the Moon's vicinity to the waypoint-based return trajectory, preventing a jump. Vehicles can also have `moonLanding` and `moonOrbitReturn` properties for multi-phase lifecycles. Apollo 11's Eagle has three phases: `moonOrbit` (orbits with Columbia pre-descent), `moonLanding` (tracks Moon surface during EVA), `moonOrbitReturn` (orbits post-ascent). Eagle undocks from Columbia's orbit position, not from a fixed waypoint. Columbia orbits the Moon for the full duration via `moonOrbit`. Moon landing and orbit positions use the Moon's semi-major axis distance (matching how the Moon mesh is rendered) rather than the varying actual distance from `moonPosition()`, which fluctuates +/-21,000 km due to eccentricity.

### Heliocentric Missions

Missions with `referenceFrame: 'heliocentric'` define waypoints in AU ecliptic coordinates. These are converted to scene positions via `eclipticToScene()` directly (using the same log-scale formula as planets). The mission group is placed at the scene origin rather than at Earth. Waypoints can specify `anchorBody: 'planet_id'` to be snapped to the real planet position at initialization via `heliocentricPosition()`, ensuring trajectories start/end at actual planets.

### Auto-Generated Transfer Arcs

Missions with `autoTrajectory: 'transfer'` (e.g. Perseverance) automatically generate smooth elliptical arcs between anchor points via `_generateTransferArc()`. This avoids manually defining dozens of intermediate waypoints for simple Hohmann-like transfers.

### Trajectory Rendering (Geocentric)

1. **Waypoints** defined in a Moon-aligned geocentric frame (X toward Moon at flyby, Y perpendicular, Z out-of-ecliptic) in km
2. At initialization, compute Moon's ecliptic direction at flyby time via `moonPosition()`, rotate all waypoints to ecliptic frame
3. **CatmullRom smoothing** with time-parameterised sampling — waypoint index maps to curve parameter, sampled at uniform time steps
4. **Distance compression**: `earthSceneR * pow(distKm / 6371, MOON_DIST_EXPONENT) * MOON_DIST_SCALE` — same centralised constants as moon positioning (0.6, 1.5)
5. **Ecliptic-to-scene axis swap**: x stays, ecliptic z → scene y, ecliptic y → -scene z
6. Scene objects are children of a `THREE.Group` positioned at Earth's scene location each frame

### Distance Compression Gotcha

The `pow(ratio, 0.6)` compression means points near the Moon's distance (~384,400 km) have similar compressed distances, though less severely than the previous 0.4 exponent. Artemis II flyby waypoints are at ~398,000 km (close to the real 395,000 km). The higher exponent gives more realistic proportions: the Moon now appears at 17.6 Earth radii (was 7.7 with 0.4, real is 60.3).

### Telemetry Panel

`getTelemetry()` computes from the primary vehicle's interpolated position:
- **MET** (Mission Elapsed Time): formatted as T+Dd HH:MM:SS
- **Distance from Earth**: in km and miles
- **Speed**: computed as position delta over 0.01-hour step, shown in km/s and mph

### Event Banners

`checkEventTrigger()` detects when simulation time crosses an event timestamp. Returns the event once, tracked by `_lastTriggeredEvent` index. Resets on time jumps backwards. The banner animates in (slide + fade) and fades out after 4 seconds.

### UI

- **Missions menu**: rocket icon in toolbar, dropdown listing all 11 missions with coloured dots
- **Mission timeline slider**: orange slider above zoom slider. Live scrub (pauses playback, drags simulation time). Shows T+0 to mission duration. Syncs during playback. Updates all UI (positions, telemetry, events) during scrub.
- **Tracking badge**: top bar, shows mission name. Filled dot = autotracking, hollow = paused. Tap to resume.
- **Telemetry panel**: glass-morphism overlay bottom-left with MET, distance, speed. On phones (portrait), max-width 160px, positioned at bottom: 155px to clear the timeline slider, with reduced font sizes (title 9px, labels 8px, values 10px)
- **Event banners**: animated overlay bottom-left (bottom: 225px), above the telemetry panel, left-aligned, compact styling. Fires at each mission event
- **Event labels**: faint orange labels along trajectory at key positions. Timed visibility: each label appears for ~3% of mission duration around its event timestamp (clamped to 1–500 hours), so at the default replay speed each label is visible for about 2 seconds of screen time then fades
- **Lazy-follow mission camera**: Geocentric (lunar) missions get tight Earth-Moon framing with Sun-side lighting and lazy follow: the camera snaps to Earth's current position + the trajectory's local center, zoomed to fit just the trajectory extent (using `localRadius` from `getMissionBounds()`). Azimuth is set ~31 degrees off the Sun direction (0.55 radians) for a dramatic two-thirds illuminated view; elevation 0.3 radians (~17 degrees). During playback, the camera target lerps toward Earth's current position + trajectory center each frame at `lerp(0.02)`, keeping the trajectory large and centered while Earth visibly drifts through space. Interplanetary (heliocentric) missions use the default overview camera via `resetToOverview()` — the standard solar system view shows the trajectory cleanly across the full system. User interaction (drag/scroll) clears `activeMissionId`, breaking the lazy follow and giving full manual control
- **"Hide/Show trajectories"**: toggle in missions menu
- **"Stop replay (1x)"**: cancels the active mission, keeps current simulation time, resets to 1x speed, clears all mission state. Also triggered by clicking any planet preset or double-click reset
- **URL parameters**: `?mission=apollo11` auto-selects a mission on load; `?focus=saturn` auto-focuses the camera on a body (any planet or moon by id, e.g. `?focus=titan`, `?focus=io`)
- **Auto-speed**: On mission selection, timeScale snaps to nearest preset targeting ~45s replay
- **End-of-mission speed reset**: When elapsed time exceeds the mission's durationHours and timeScale > 1, it automatically resets to 1x to prevent the simulation racing onward after completion
- All mission UI uses faint orange (#ffaa50) to differentiate from celestial object labels

## Rendering

### Scene Graph

```
THREE.Scene (black background)
├── PointLight (warm white, intensity 50, decay 1, at origin)
├── AmbientLight (0x262626)
├── Starfield Tier 0 (Points, ~20 stars, size 4.0)
├── Starfield Tier 1 (Points, ~200 stars, size 2.5)
├── Starfield Tier 2 (Points, ~1500 stars, size 1.5)
├── Starfield Tier 3 (Points, ~7000 stars, size 0.8)
├── Sun (MeshBasicMaterial, procedural texture, r=0.8)
│   ├── Sprite Inner Glow (1.3x, additive)
│   ├── Sprite Mid Glow (1.8x, additive)
│   ├── Sprite Outer Glow (2.8x, additive)
│   └── Sprite Corona (4.0x, additive)
├── [Planet] (MeshStandardMaterial, NASA texture, IAU rotation)
│   └── [Saturn Rings] (BufferGeometry disc, radial UVs, Cassini textures)
├── [Orbit Path] (LineLoop, 180 segments)
├── [Moon] (MeshStandardMaterial, texture or colour, tidally locked)
├── [ISS] (Procedural 3D model: cross-shaped truss + 4 solar panel pairs + 2 radiators, off by default)
└── [Mission Group] (positioned at Earth or origin depending on referenceFrame)
    ├── [Vehicle Trail] (Line, vertex colours, faint orange)
    ├── [Vehicle Glow] (Points, additive blending, primary only)
    ├── [Vehicle Marker] (Group: core Sprite + glow Sprite, depthTest: false)
    └── [Event Marker] (Sprite, depthTest: false, for TLI/Flyby)
```

### Three.js Material Mapping (from SceneKit)

| SceneKit | Three.js | Notes |
|----------|----------|-------|
| PBR `lightingModel` | `MeshStandardMaterial` | Same roughness/metalness model |
| `.constant` lighting | `MeshBasicMaterial` | For Sun (emissive), orbit lines |
| `.add` blend mode | `AdditiveBlending` | Sun corona sprites |
| `SCNSphere` | `SphereGeometry` | Identical UV mapping |
| `SCNGeometrySource` | `BufferGeometry` | Custom ring geometry, star points |
| `projectPoint()` | `Vector3.project()` | Label screen projection |
| `SCNView` hit test | `Raycaster` | Body selection on click |

### Star Rendering

- 8,404 stars parsed from `textures/stars.csv` (BSC5)
- RA/Dec mapped to celestial sphere at r=500
- 4 brightness tiers with different `PointsMaterial.size` values (non-attenuated)
- Per-vertex B-V colour via `vertexColors: true`
- ~120 brightest named stars labelled
- Star labels occluded behind planet screen discs

### Saturn's Rings

Custom flat disc `BufferGeometry` with radial UV mapping:
- 72 radial segments x 4 ring segments
- `u` maps 0 (inner) to 1 (outer) — radially across the ring strip texture
- Cassini colour map + alpha transparency for ring density
- `MeshBasicMaterial` with `DoubleSide` for visibility
- Counter-rotated each frame via quaternion to cancel parent planet's spin

### Procedural Textures

- **Sun surface** (1024x512 canvas): 800 granulation cells + 40 supergranulation patches + radial limb-darkening gradient
- **Corona glow** (256x256 canvas, x4 layers): Radial gradient from colour to transparent, used on `SpriteMaterial` with `AdditiveBlending`

## Custom Camera Controller

### State

- `target: Vector3` — look-at point
- `distance: number` — distance from target (clamped 0.5–250)
- `azimuth: number` — horizontal orbit angle (radians)
- `elevation: number` — vertical orbit angle (clamped ±85°)

### `setCamera()` Method

`setCamera({ target, distance, azimuth, elevation })` — all parameters optional. Used by `focusCamera()` and mission camera positioning to set the camera state programmatically. The optional `azimuth` and `elevation` parameters allow callers to specify an exact viewing angle (e.g. Sun-side positioning for missions) rather than preserving the user's current orbit angles.

### Gestures

| Input | Action | Speed |
|-------|--------|-------|
| Left-drag (mouse) / 1-finger (touch) | Pan target in camera-local plane | `distance * 0.002` |
| Right-drag (mouse) / 2-finger (touch) | Orbit (azimuth/elevation) | `0.005 rad/px` |
| Scroll wheel / pinch | Zoom (clamped 0.5–250) | 1.1x / 0.9x per tick |
| Click / tap | Raycast → select body | — |
| Double-click / double-tap | Reset to overview | — |

### Zoom Slider

Horizontal custom slider above the toolbar. Logarithmically mapped (0.5–250 scene units): `distance = exp(logMin + zoom * (logMax - logMin))`. Syncs with scroll/pinch via `syncZoomSlider()`. Immediate sync after `focusCamera()` and `resetCamera()` to prevent slider/camera mismatch.

### Mission Timeline Slider

Orange slider that appears above the zoom slider when a mission is active. Maps T+0 to mission duration. Scrubbing pauses playback and drags simulation time, updating vehicle positions, telemetry, and event banners in real time. Syncs automatically during normal playback.

## UI Controls

### Toolbar (bottom)

The toolbar combines playback controls on the left with the planet strip on the right:

| Control | Icon | Action |
|---------|------|--------|
| Play/Pause | Pause/Play symbol | Toggle simulation |
| Speed menu | Timer icon | 0.1x to 10Mx, reverse (incl. -1Mx), Reset to Now |
| Orbits | Circle | Toggle orbital paths |
| Labels menu | Tag icon | Planets / Moons / Stars (independent toggles) |
| Satellites | SVG ISS icon | Toggle ISS visibility |
| Missions | Rocket icon | Select from 11 missions, toggle trajectories |
| Planet strip | Textured circles | Overview + Sun + 9 planets with NASA textures |

### Planet Strip

A row of 32px circular thumbnails using the actual NASA texture maps as CSS background images. Each planet is clickable to fly the camera there. Saturn includes a CSS ring overlay (`border-radius: 50%` ellipse with `rotateX(65deg)` 3D transform). A divider separates inner planets (Mercury–Mars) from outer planets (Jupiter–Pluto). The overview button uses a star glyph on a dark gradient. Selected planet shows an orange border; hovering scales to 1.15x and reveals the name label beneath.

### Credits Overlay

Accessible via a "Credits" button in the top-right of the date bar. The date display uses `font-variant-numeric: tabular-nums` and `min-width: 180px` to prevent top bar wobble as digits change width. Opens a glass-morphism modal (`backdrop-filter: blur(10px)`, z-index 50) listing all texture sources, star data, orbital data, and technology credits. Dismissible via X button or clicking the backdrop.

### Dropdown Menus

CSS dropdown menus that open upward from the toolbar with glass-morphism (`backdrop-filter: blur(20px)`). Closed on outside click via document-level listeners.

### Adaptive Planet Strip Layout

On wide screens (>700px), the planet strip sits inline in the toolbar alongside the playback controls. On narrow screens (phones in portrait), it breaks into its own row above the controls via a CSS `flex-direction: column` media query. The thumbnails remain evenly spaced across the full width in both layouts.

### Focus Zoom

When selecting a planet, `focusCamera()` calculates the visual extent including the moon system and positions the camera to fill the viewport. Planets with moons use a 0.8x base multiplier (reduced from 1.5 to compensate for larger moon system extent under the 0.6 distance exponent); moonless planets use 6.0x so they appear at a similar visual scale. On portrait viewports, the multiplier is reduced by the aspect ratio (`0.5 + 0.5 * min(aspect, 1.0)`) to account for the narrower constraining dimension. `syncZoomSlider()` is called immediately after any programmatic camera change.

## Development and Testing

### Running Locally

```bash
./web-server.sh
# Or manually:
cd /Users/pwilliams/appledev/solarsystem-web
python3 -m http.server 8080
# Open http://localhost:8080
```

A local HTTP server is required — `file://` URLs block ES module imports and fetch() due to CORS restrictions.

### Browser Developer Tools

- **Console**: Check for Three.js warnings, texture load failures, JS errors
- **Performance tab**: Profile frame rate — should sustain 60fps on any modern GPU
- **Network tab**: Verify all 17 texture files load (total ~14 MB)
- **Device toolbar**: Test responsive layout and touch events in mobile simulation mode

### Testing Across Browsers

Test in at least Chrome and Safari, as they use different WebGL implementations (ANGLE vs native). Firefox is a useful third check. Key differences to watch:
- **Texture colour space**: Ensure `texture.colorSpace = THREE.SRGBColorSpace` is set on all JPEG textures to avoid washed-out colours
- **Touch events**: Safari handles `passive` touch listeners differently — all touch handlers use `{ passive: false }` to allow `preventDefault()`
- **Import maps**: Safari 16.4+ required for native import map support

### Visual Verification Checklist

1. All 9 planets visible with correct textures
2. Sun has granulation texture and 4-layer corona glow
3. Saturn's rings display with correct colour banding and transparency
4. Earth, Jupiter, Mars visibly rotating at high time scales (1000x+)
5. Venus, Uranus, Pluto rotate retrograde (backwards)
6. Orbital paths visible as grey loops
7. Stars visible as coloured points with named labels
8. Labels deconflict (don't overlap) and occlude behind planets
9. Camera: left-drag pans, right-drag orbits, scroll zooms
10. Planet strip thumbnails fly camera to each body, selected planet highlighted
11. Zoom slider tracks camera distance accurately after presets
12. Time controls: pause, speed up to 1Mx, reverse, Reset to Now
13. All buttons functional on iOS Safari (touch targets fire immediately)
14. Planet strip adaptive: inline on desktop, separate row on phone
15. Portrait mode: planets fill viewport width appropriately
16. Credits panel opens and dismisses on all platforms
17. Missions: rocket menu opens, all 11 missions listed, clicking one jumps to launch and frames trajectory
18. Missions: geocentric trajectories (Artemis, Apollo) loop around Moon; heliocentric (Voyager, Cassini) span solar system
19. Missions: vehicle markers appear/disappear at correct times, scale with camera distance
20. Missions: telemetry panel shows MET, distance (km/mi), speed (km/s/mph)
21. Missions: event banners appear at key events
22. Missions: timeline slider scrubs through mission, syncs during playback
23. Missions: `?mission=apollo11` URL parameter auto-selects mission on load
24. ISS: visible when toggled via Satellites menu, orbits Earth with correct inclination
25. ISS: procedural 3D model (cross shape with solar panels) visible at close zoom

## Known Gotchas

The cross-browser / iOS Safari / generic web performance gotchas (CORS on file://, import map browser support, WebGL2 requirement, `touch-action: none` scoping, click-event synthesis, portrait viewport framing, emoji-icon unreliability, HTML cache headers, devicePixelRatio cap, throttled DOM updates, `sizeAttenuation: false` for screen-pixel sprite sizing) all live in the `web` skill. Generic orbital-mechanics numerical gotchas (Kepler divergence at high `e`, angle wrap to `[0, 2π)`, double-precision Julian dates) live in `astro`. The sections below are the bits that aren't in either skill.

### Three.js
- **PointLight intensity**: Three.js uses physically correct lighting by default. Intensity values are much lower than SceneKit's (50 vs 2000) due to different falloff models.
- **Tone mapping exposure**: `ACESFilmicToneMapping` darkens the scene — compensate with `toneMappingExposure: 1.2`
- **GIF alpha maps**: Three.js `TextureLoader` handles GIF files (Saturn ring alpha), but ensure the image has loaded before relying on it
- **Sprite vs Mesh for glow**: Sprites always face the camera (billboard), which is ideal for the Sun's corona glow. Nested spheres (iOS approach) would require `DoubleSide` and show seams at certain angles.

### Camera (project-specific)
- **Zoom range consistency**: All zoom controls (slider, scroll, pinch, presets, `setDistance`) must clamp to the same 0.5–250 range. Call `syncZoomSlider()` after any programmatic camera change.
- **Touch gesture disambiguation**: One-finger drag needs a 5px dead zone before starting pan, to distinguish from taps.
- **Touch-to-mouse transition**: When a two-finger gesture ends with one finger still down, smoothly transition to one-finger pan mode.

### Missions
- **Distance compression hides flyby**: `pow(ratio, 0.6)` is less severe than the old 0.4 exponent. Flyby waypoints at ~398,000 km (close to real 395,000 km) now produce visible separation from the Moon.
- **Z-component amplification**: The `pow(0.6)` compression still amplifies out-of-plane (Z) motion relative to in-plane (X/Y), though less than 0.4. Waypoints with constant Z (e.g. 4,500 km throughout) make the trajectory appear to pass over the Moon's pole instead of behind the far side. Fix: reduce Z to near-zero at closest approach (~0-150 km), with slight values during coast phases (~200-650 km). The trajectory should be nearly in the Moon's orbital plane at periapsis.
- **Flyby speed symmetry**: In a free-return trajectory, speed in the Earth frame should be roughly symmetric around periapsis — what the spacecraft gains falling into the Moon's gravity well, it loses climbing out. If hand-crafted waypoints show 2.5x acceleration between approach and departure (e.g. 0.9 km/s to 2.5 km/s), the post-flyby waypoints are spaced too closely in time or too far apart in distance. Fix: space post-flyby waypoints wider in time and closer in distance to match the approach speed profile (~1.0 km/s). The brief peak at periapsis (~1.5 km/s) is physically correct.
- **CatmullRom overshooting**: If waypoint Y-values reverse direction (e.g. -105k → -98k → -115k), CatmullRom creates visible kinks. Keep coordinate values monotonic within each trajectory segment.
- **Autotracking overrides camera**: The overview camera framing must not be immediately overridden by autotracking on the next frame. `jumpToMission` sets `trackingMissionId = null` so the overview holds until the user explicitly enables tracking.
- **Moon landing lerp timing**: The `moonLanding` lerp windows must have adequate duration for the descent/ascent to be visible at the mission's auto-speed. If the window is too short, the vehicle teleports.
- **Moon position matching**: `moonLanding` and `moonOrbit` must use the Moon's semi-major axis distance (matching the rendered Moon mesh) rather than the varying actual distance from `moonPosition()`, which fluctuates +/-21,000 km due to eccentricity and causes vehicles to miss the Moon surface.
- **LEM descent scale**: At trajectory scale, the real 45 km LEM descent is invisible after compression. Eagle's descent is computed at runtime by lerping from Columbia's orbit position to the Moon's actual position, creating visible separation rather than trying to render the true descent path.
- **Planet preset zoom with moons**: The zoom multiplier for planets with moon systems was reduced from 1.5 to 0.8 to compensate for the larger moon system extent under the 0.6 exponent.
- **Event detection on time jumps**: If the user jumps backwards in time, `_lastTriggeredEvent` must reset or events won't re-fire. Currently resets when elapsed time goes before the last triggered event.
- **`getMissionBounds()` dual return values**: Returns both wide absolute bounds (`center`/`radius` — Earth start+end + trajectory at both, for safety) and tight trajectory-only bounds (`localCenter`/`localRadius` — relative to Earth, used for initial camera framing and lazy follow target). The lazy-follow camera uses `localCenter`/`localRadius` so the trajectory fills the view tightly rather than framing the wider bounding box.
- **Heliocentric anchor precision**: `anchorBody` positions are computed once at initialization. If waypoints are hand-tuned for a specific date, the anchor snap may shift them slightly. Always verify trajectory visually after changing launch dates.
- **Interplanetary speed consistency**: Anchored waypoints (where the trajectory snaps to a planet) can cause speed spikes because adjacent waypoints may be far apart in distance but close in time. Always add transition waypoints ~1,000-2,000 hours before and after anchored points to smooth the speed profile. Applied across Cassini (near Venus/Saturn), New Horizons (near Jupiter/Pluto), Voyager 1 (post-Jupiter tightened from 30+ km/s to ~17 km/s), and Voyager 2 (consistent 12-17 km/s throughout).
- **Moon orbit-to-return transition**: After `moonOrbit` ends, the marker must lerp over ~5 hours from the Moon's vicinity to the waypoint-based return trajectory. Without this, the vehicle jumps visibly when orbit mode ends.
- **Timeline slider scrub**: Must pause playback before adjusting simulation time to avoid fighting with the animation loop. Resume on release.
- **Moon proportional sizing**: Moons use `sceneRadius(km, type, parentRadiusKm)` — true ratio to parent. Minimum floor 0.006.

## Relationship to iOS App

This is a faithful port of the [iOS SolarSystem app](../solarsystem/). The orbital mechanics, scaling formulae, body data, rotation models, and visual design are identical. Key mapping:

| iOS (SceneKit) | Web (Three.js) |
|----------------|----------------|
| `SCNScene` | `THREE.Scene` |
| `SCNSphere` | `THREE.SphereGeometry` |
| `SCNMaterial` (PBR) | `THREE.MeshStandardMaterial` |
| `SCNMaterial` (.constant) | `THREE.MeshBasicMaterial` |
| `SCNView.projectPoint()` | `Vector3.project()` |
| `UIViewRepresentable` | `WebGLRenderer` on canvas |
| `CADisplayLink` | `requestAnimationFrame` |
| `UIGraphicsImageRenderer` | `CanvasRenderingContext2D` |
| `UIPanGestureRecognizer` | `mousedown/move/up`, `touchstart/move/end` |
| `UserDefaults` | (not persisted — future: `localStorage`) |
| `Bundle.main.path()` | `fetch()` / `TextureLoader` |
| `simd_quatf` | `THREE.Quaternion` |
| `SIMD3<Double>` | `THREE.Vector3` / `{x, y, z}` objects |

## Licence

Source code is MIT (see `LICENSE`). Bundled assets each carry their own
licence — see `THIRDPARTY.md` for the full inventory. All bundled assets
permit redistribution including commercial use when their attributions are
preserved. The Credits panel in `index.html` (top-right of the date bar)
also surfaces these to end users at runtime.

Replacing assets must keep the project MIT-redistributable: avoid CC-BY-SA
(viral/share-alike) and "non-commercial only" sources. Acceptable additions:
NASA/USGS public-domain works, CC-BY 4.0 (e.g. Solar System Scope), and
"publicly available, please mention origin" assets like Björn Jónsson's
maps. The star catalogue is reproducible from `tools/build_stars.py` against
the public-domain VizieR BSC5 (V/50) source — re-run it if you change the
filter cutoff or want fresher names.

## Deployment

`./update-for-web.sh` is a thin wrapper that delegates the standard pipeline (rsync to git mirror, copy dev pages, assemble CLAUDE.md from `@`-refs, rewrite README links) to `~/appledev/tools/update-for-web-core.sh`, then performs one project-specific extra step: deploying the runnable web app to its public folder. End result is three destinations:

1. **Git clone**: `~/dev/git/solarsystem-web` (for GitHub) — produced by the core's rsync step
2. **Dev pages**: `~/${DEPLOY_HOST}-azure/wwwroot/dev/solarsystem-web` — produced by the core's HTML/PNG copy step (architecture.html, tutorial.html, screenshot)
3. **Full web app**: `~/${DEPLOY_HOST}-azure/wwwroot/solarsystem` — added by the wrapper (index.html, js/, textures/, excluding CLAUDE.md / README.md / MISSIONS.md / architecture.html / tutorial.html / dev scripts)

The README in the git clone has image/HTML links rewritten to point at the dev-pages URL. The wrapper is the only project file that's aware of the live-app deploy; the core is shared with every other appledev project.

## Future Roadmap

- Persist settings to `localStorage`
- Asteroid belt visualisation
- Constellation lines connecting named stars
- URL hash parameters for sharing views (e.g. `#focus=saturn&speed=10000`)
- Progressive texture loading with low-res placeholders
- WebGPU renderer path for modern browsers
- Responsive mobile UI refinements
- Loading progress bar for texture downloads
- NASA 3D models for spacecraft (Orion .glb via GLTFLoader)
- Mission trajectory data from NASA HORIZONS API or SPICE kernels
- Acceleration telemetry (requires second-derivative of position)
- More satellites (Hubble, JWST, Starlink constellation)
- Additional missions (Mars rovers timeline, Juno, OSIRIS-REx)
