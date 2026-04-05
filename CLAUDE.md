# SolarSystem Web - Claude Code Developer Reference

## Overview

A browser-based solar system simulation using Three.js, ported from the iOS SolarSystem app. Uses real Keplerian orbital mechanics (JPL J2000.0 elements) to calculate planet, moon, and Sun positions based on the current date and time. Three.js renders the 3D scene with PBR materials and NASA/public-domain texture maps on all planets and major moons. 8,920 real stars from the Hipparcos catalogue form the backdrop, with correct positions, magnitudes, and B-V colours. All bodies rotate at their real IAU sidereal rates with correct axial tilts.

Physics runs on the main thread (lightweight trig per body per frame). Rendering runs on the GPU via WebGL through Three.js with PBR materials, multi-layer Sun corona sprites, and Saturn's rings with Cassini colour/transparency maps.

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
```

### Key Design Decisions

- **Three.js over raw WebGL**: PBR materials (`MeshStandardMaterial`), lighting, camera, raycasting out of the box. GPU-accelerated via WebGL2. Direct analogue to the iOS app's SceneKit.
- **No build tooling**: ES modules with import maps. Three.js loaded from CDN. `python3 -m http.server` is the only tooling needed.
- **CPU for orbital mechanics**: ~20 trig ops per body per frame = microseconds. No WebWorker benefit.
- **Custom camera controller**: Three.js's built-in `OrbitControls` doesn't match the iOS app's gesture model (one-finger pan, two-finger/right-click orbit). Wrote a custom `CameraController` with explicit spherical state.
- **DOM overlay labels**: Three.js `CSS2DRenderer` exists but adds a dependency. Simple DOM elements positioned via `Vector3.project()` give the same result — pixel-perfect, clickable, constant size at all zoom levels. Star labels are occluded behind planet discs.
- **Logarithmic distance scaling**: Real distances span 4 orders of magnitude. `log(1 + AU/0.5) * 15` preserves ordering while keeping everything visible. Identical formula to the iOS app.
- **Sqrt radius scaling**: `sqrt(km) * 0.00125` for planet radii. Jupiter 3.3x Earth (real 11.2x) while keeping small planets visible. Moons use real ratio to parent with 0.012 minimum floor.
- **Moon distance compression**: `pow(realRatio, 0.4) * 1.5` preserves relative ordering.
- **Sprites for Sun corona**: The iOS app uses nested glow spheres with additive blending. Three.js `Sprite` with additive blending achieves the same billboard glow effect more efficiently.
- **Throttled label updates**: Labels only re-project every 3rd frame to reduce DOM manipulation overhead.
- **Real star catalogue**: 8,920 stars from HYG v38 database, filtered to naked-eye visibility (mag <= 6.5). ~120 brightest named stars labelled.
- **Tone mapping**: `ACESFilmicToneMapping` at exposure 1.2 gives the PBR materials a natural, film-like look matching the iOS app's SceneKit rendering.

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
├── README.md                    # User-facing documentation
├── architecture.html            # Interactive architecture diagrams
├── tutorial.html                # Build narrative
├── index.html                   # Single-page application (HTML + CSS + UI)
├── web-server.sh                # Launch script: python3 local server on port 8080
├── js/
│   ├── main.js                  # Entry point, animation loop, UI event wiring (698 lines)
│   ├── solarSystemData.js       # JPL elements: 9 planets + 16 moons + Sun (254 lines)
│   ├── orbitalMechanics.js      # Julian dates, Kepler solver, positions (181 lines)
│   ├── sceneBuilder.js          # Scene graph, materials, rings, glow, starfield (462 lines)
│   ├── textureGenerator.js      # Procedural Sun texture, glow textures (102 lines)
│   └── cameraController.js      # Orbital camera with mouse + touch gestures (306 lines)
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
    ├── saturn_ring_color.jpg    # Ring colour map (915x64, 9 KB)
    ├── saturn_ring_alpha.gif    # Ring transparency (915x64, 28 KB)
    └── stars.csv                # HYG catalogue: 8,920 stars (274 KB)
```

**Total: 6 JavaScript files, ~2,003 lines of code. 17 texture/data files. 1 HTML file.**

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

### Moons (16 total, all tidally locked)

- **Earth**: Moon (27.32d, obliquity 6.7°)
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
| Saturn (+rings) | Cassini composite, Planet Pixel Emporium | Free non-commercial |
| Pluto | NASA/JHUAPL/SwRI New Horizons | Public domain |
| Io, Europa, Ganymede | Voyager/Galileo, Steve Albers | Public domain data |
| Callisto | Voyager/Galileo, Bjorn Jonsson | Public domain data |
| Stars | HYG Database v38 (Hipparcos/Yale/Gliese) | Public domain |

## Orbital Mechanics

### Calculation Pipeline

1. `julianDate(date) -> number` — Meeus algorithm, Gregorian to JD
2. `julianCenturies(date) -> number` — `(JD - 2451545.0) / 36525.0`
3. `elementsAt(elements, T)` — Base + rate * T
4. `meanAnomaly = L - wBar` (normalised to [0, 2pi))
5. `solveKepler(M, e) -> E` — Newton-Raphson, initial guess `E0 = M + e*sin(M)`, tolerance 1e-8, max 50 iterations
6. `trueAnomaly(E, e) -> nu` — `2*atan2(sqrt(1+e)*sin(E/2), sqrt(1-e)*cos(E/2))`
7. `r = a * (1 - e*cos(E))` — heliocentric distance
8. Rotate by omega, I, w to ecliptic (x,y,z)

### Moon Positions

Simplified circular orbits with period-based mean motion: `M = longitudeAtEpoch + (2pi/period) * daysSinceJ2000`.

### IAU Rotation

Each body has `rotation: { periodHours, obliquity, w0, tidallyLocked }`. Applied per frame using quaternion composition: `tiltQuat.multiply(spinQuat)` where tilt is around the X axis (fixed in space) and spin is around Y (the tilted pole). Euler angles can't do this correctly — they compose in a fixed order, causing the tilt axis to wobble with each spin cycle. Saturn's rings cancel the spin quaternion in local frame to stay fixed in the equatorial plane.

### Coordinate System

- **Orbital mechanics**: Heliocentric ecliptic (x,y in ecliptic plane, z perpendicular)
- **Three.js**: x = ecliptic x, y = ecliptic z (up), z = -ecliptic y
- **Distance**: `log(1 + AU/0.5) * 15` scene units

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
└── [Moon] (MeshStandardMaterial, texture or colour, tidally locked)
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

- 8,920 stars parsed from `textures/stars.csv` (HYG v38)
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

## UI Controls

### Toolbar (bottom)

The toolbar combines playback controls on the left with the planet strip on the right:

| Control | Icon | Action |
|---------|------|--------|
| Play/Pause | Pause/Play symbol | Toggle simulation |
| Speed menu | Timer icon | 0.1x to 1Mx, reverse, Reset to Now |
| Orbits | Circle | Toggle orbital paths |
| Labels menu | Tag icon | Planets / Moons / Stars (independent toggles) |
| Planet strip | Textured circles | Overview + Sun + 9 planets with NASA textures |

### Planet Strip

A row of 32px circular thumbnails using the actual NASA texture maps as CSS background images. Each planet is clickable to fly the camera there. Saturn includes a CSS ring overlay (`border-radius: 50%` ellipse with `rotateX(65deg)` 3D transform). A divider separates inner planets (Mercury–Mars) from outer planets (Jupiter–Pluto). The overview button uses a star glyph on a dark gradient. Selected planet shows an orange border; hovering scales to 1.15x and reveals the name label beneath.

### Credits Overlay

Accessible via a "Credits" button in the top-right of the date bar. Opens a glass-morphism modal (`backdrop-filter: blur(10px)`, z-index 50) listing all texture sources, star data, orbital data, and technology credits. Dismissible via X button or clicking the backdrop.

### Dropdown Menus

CSS dropdown menus that open upward from the toolbar with glass-morphism (`backdrop-filter: blur(20px)`). Closed on outside click via document-level listeners.

### Adaptive Planet Strip Layout

On wide screens (>700px), the planet strip sits inline in the toolbar alongside the playback controls. On narrow screens (phones in portrait), it breaks into its own row above the controls via a CSS `flex-direction: column` media query. The thumbnails remain evenly spaced across the full width in both layouts.

### Focus Zoom

When selecting a planet, `focusCamera()` calculates the visual extent including the moon system and positions the camera to fill the viewport. Planets with moons use a 2.2x base multiplier; moonless planets use 6.0x so they appear at a similar visual scale. On portrait viewports, the multiplier is reduced by the aspect ratio (`0.5 + 0.5 * min(aspect, 1.0)`) to account for the narrower constraining dimension. `syncZoomSlider()` is called immediately after any programmatic camera change.

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

## Known Gotchas

### Orbital Mechanics
- **Kepler divergence**: For e > 0.9, use `E0 = M + e*sin(M)` as initial guess
- **Angle wrapping**: Normalise to [0, 2pi) via modulo — JS `%` can return negatives
- **Julian date precision**: JavaScript `Number` (64-bit float) has sufficient precision

### Three.js
- **PointLight intensity**: Three.js uses physically correct lighting by default. Intensity values are much lower than SceneKit's (50 vs 2000) due to different falloff models.
- **Tone mapping exposure**: `ACESFilmicToneMapping` darkens the scene — compensate with `toneMappingExposure: 1.2`
- **Texture colour space**: Always set `texture.colorSpace = THREE.SRGBColorSpace` on loaded JPEG textures, or colours appear washed out
- **GIF alpha maps**: Three.js `TextureLoader` handles GIF files (Saturn ring alpha), but ensure the image has loaded before relying on it
- **Sprite vs Mesh for glow**: Sprites always face the camera (billboard), which is ideal for the Sun's corona glow. Nested spheres (iOS approach) would require `DoubleSide` and show seams at certain angles.

### Performance
- **DOM label overhead**: Updating innerHTML with 100+ labels every frame kills performance. Throttle to every 3rd frame.
- **Pixel ratio**: Cap at 2x via `setPixelRatio(Math.min(devicePixelRatio, 2))` — 3x Retina devices render 9x the pixels for marginal quality gain.
- **Star point rendering**: Use `sizeAttenuation: false` so star sizes are in screen pixels, not world units.

### Camera
- **Zoom range consistency**: All zoom controls (slider, scroll, pinch, presets, `setDistance`) must clamp to the same 0.5–250 range. Call `syncZoomSlider()` after any programmatic camera change.
- **Touch gesture disambiguation**: One-finger drag needs a 5px dead zone before starting pan, to distinguish from taps.
- **Touch-to-mouse transition**: When a two-finger gesture ends with one finger still down, smoothly transition to one-finger pan mode.

### iOS Safari
- **touch-action: none on body/container**: Prevents ALL touch interactions on overlaid UI elements, even those with higher z-index. Only apply `touch-action: none` to the `<canvas>` element itself, never to full-screen containers.
- **-webkit-user-select: none on body**: Suppresses click event synthesis from touches. Scope to the canvas container only.
- **Click events don't fire**: iOS Safari may not synthesize `click` from `touchend` in certain stacking contexts. Use a dual `touchend` + `click` handler (the `onTap()` helper) with a flag to prevent double-firing. The `touchend` handler calls `preventDefault()` to fire immediately.
- **Portrait zoom framing**: Phone portrait viewports are much taller than wide. Camera framing multipliers must account for aspect ratio or planets appear tiny in the narrow width.

### Cross-Browser
- **CORS on file://**: Must use a local HTTP server — `file://` URLs block ES module imports and `fetch()` for CSV/textures
- **Import maps**: Require Safari 16.4+, Chrome 89+, Firefox 108+
- **WebGL2**: Required for `MeshStandardMaterial` PBR. Virtually all browsers since 2020 support it.

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

## Future Roadmap

- Persist settings to `localStorage`
- Asteroid belt visualisation
- Constellation lines connecting named stars
- URL hash parameters for sharing views (e.g. `#focus=saturn&speed=10000`)
- Progressive texture loading with low-res placeholders
- WebGPU renderer path for modern browsers
- Responsive mobile UI refinements
- Loading progress bar for texture downloads
