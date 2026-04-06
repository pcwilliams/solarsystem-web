# Mission System — Technical Reference

Detailed reference for the space missions feature in SolarSystem Web. Written to enable porting the same system to the iOS SolarSystem app using SceneKit.

## Architecture Overview

The mission system renders spacecraft trajectories as faint orange trails through the Earth-Moon system, with multiple independently-tracked vehicles per mission, live telemetry, and timed event notifications.

### Key Files

| File | Purpose | Lines |
|------|---------|-------|
| `js/missions.js` | MissionManager class, mission data, trajectory rendering, telemetry | 630 |
| `js/main.js` | Integration: animation loop, UI wiring, camera tracking, event banners | 991 |
| `index.html` | Mission menu, telemetry panel, event banner, tracking badge (HTML + CSS) | — |

### Class: MissionManager

```
MissionManager(scene)
├── initialize()           — build scene objects for all missions
├── update(date, earthPos) — per-frame position updates
├── getMissions()           — mission data for UI
├── getMissionBounds(id)    — bounding box for camera framing
├── getSpacecraftPosition() — primary vehicle world position
├── getActiveLabels()       — label data for overlay system
├── getTelemetry()          — MET, distance, speed
├── checkEventTrigger()     — detect event timestamp crossings
└── resetEventTriggers()    — reset for time jumps
```

## Mission Data Format

```javascript
{
    id: 'artemis2',
    name: 'Artemis II',
    subtitle: 'Crewed lunar flyby',
    launchDate: new Date(Date.UTC(2026, 3, 1, 22, 35, 0)),
    durationHours: 210,
    flybyTimeHours: 112,

    events: [
        { t: 0,    name: 'Launch',     detail: '...', showLabel: false },
        { t: 1.8,  name: 'TLI',        detail: '...' },  // showLabel defaults to true
        { t: 112,  name: 'Lunar Flyby', detail: '...' },
        // ...
    ],

    vehicles: [
        {
            id: 'sls',
            name: 'SLS',
            color: [1.0, 0.6, 0.3],  // faint orange RGB 0-1
            primary: false,
            waypoints: [
                { t: 0,     x: 0,  y: 0,  z: 0 },   // geocentric km, Moon-aligned frame
                { t: 0.135, x: 90, y: 190, z: 16 },  // core stage separation
            ]
        },
        {
            id: 'orion',
            name: 'Orion',
            color: [1.0, 0.6, 0.3],
            primary: true,   // camera tracks this vehicle
            waypoints: [
                { t: 0.135, x: 90,     y: 190,    z: 16 },
                // ... 25+ waypoints through flyby and return
                { t: 210,   x: 0,      y: 0,      z: 0 },
            ]
        },
        {
            id: 'columbia',
            name: 'Columbia',
            color: [1.0, 0.6, 0.3],
            primary: true,
            moonOrbit: { startTime: 75.5, endTime: 195, periodHours: 4.0, radiusKm: 25000 },
            waypoints: [ /* ... */ ]
        },
        {
            id: 'eagle',
            name: 'Eagle',
            color: [1.0, 0.8, 0.4],
            primary: false,
            moonOrbit: { startTime: 75.5, endTime: 100.2, periodHours: 4.0, radiusKm: 25000 },
            moonLanding: { startTime: 101.5, endTime: 124.2 },
            moonOrbitReturn: { startTime: 128.0, endTime: 195, periodHours: 4.0, radiusKm: 25000 },
            waypoints: [ /* ... */ ]
        }
    ]
}
```

### anchorMoon for Geocentric Missions

Geocentric waypoints can have `anchorMoon: true`. At initialization, these are resolved to the Moon's actual ecliptic position at that time using `moonPosition()`, converting AU to km and using the semi-major axis for distance matching. This is the geocentric equivalent of `anchorBody` for heliocentric missions. Used for Apollo 11 Columbia's LOI, TEI, and early return waypoints so the trajectory line departs smoothly from where the Moon actually is.

### Waypoint Coordinate Frame

Waypoints are **geocentric** (Earth-centred) in a **Moon-aligned frame**:

| Axis | Direction |
|------|-----------|
| X | Toward Moon's position at flyby time |
| Y | Perpendicular in the ecliptic plane |
| Z | Out of ecliptic (north) |

**Units**: kilometres from Earth's centre, hours from launch.

At initialization, the Moon's ecliptic direction at flyby time is computed via `moonPosition()`, and all waypoints are rotated by `atan2(moonPos.y, moonPos.x)` to align with the actual Moon. This means:
- Any launch date works — trajectory always aligns with the Moon
- The rotation is computed once and cached
- All vehicles in a mission share the same rotation

### Moon Orbit Property

Vehicles can have an optional `moonOrbit: { startTime, endTime, periodHours, radiusKm }` property. During the active window, the vehicle's position is computed at runtime as smooth cos/sin circular motion around the Moon's actual scene position each frame:

```javascript
const phase = ((elapsedHours - startTime) / periodHours) * 2 * Math.PI;
const orbitX = moonScenePos.x + radiusCompressed * Math.cos(phase);
const orbitZ = moonScenePos.z + radiusCompressed * Math.sin(phase);
```

The orbit plane is perpendicular to the Earth-Moon line. The `periodHours` is typically 2x the real orbital period (e.g. 4 hours vs ~2 hours for lunar orbit) for visual comfort at replay speeds. Columbia uses this for the full lunar orbit phase of Apollo 11. After `moonOrbit` ends, a 5-hour lerp transitions the marker from the Moon's vicinity to the waypoint-based return trajectory, preventing a visible jump.

### Moon Landing Property and Eagle's 3-Phase Lifecycle

Vehicles can have `moonLanding: { startTime, endTime }` and `moonOrbitReturn: { startTime, endTime, periodHours, radiusKm }` properties. Combined with `moonOrbit`, this enables a multi-phase lifecycle. Apollo 11's Eagle has three runtime phases:

1. **`moonOrbit`** (pre-descent): Eagle orbits with Columbia around the Moon
2. **`moonLanding`** (descent + surface + ascent): Eagle undocks from Columbia's orbit position, lerps to the Moon's surface, tracks it during EVA, then lerps back to orbit
3. **`moonOrbitReturn`** (post-ascent): Eagle resumes orbiting the Moon until rendezvous

Eagle undocks from Columbia's computed orbit position (not from a fixed waypoint), ensuring smooth visual separation.

**Moon position matching**: Both `moonLanding` and `moonOrbit` use the Moon's actual direction but semi-major axis distance, matching how `updateMoonPosition` renders the Moon mesh. Using the varying actual distance from `moonPosition()` causes +/-21,000 km eccentricity drift, making vehicles miss the Moon surface.

This pattern is reusable for any future lunar landing mission (Apollo 12, 14-17, Chandrayaan-3, etc.).

### Vehicle Lifecycle

Each vehicle is only visible between its first and last waypoint times:

| Vehicle | Start | End | Duration |
|---------|-------|-----|----------|
| SLS | T+0 | T+0.135h (~8 min) | Core stage separation |
| SRBs | T+0.036h | T+0.13h | Separation to ocean splashdown |
| Orion | T+0.135h | T+210h | Core sep to Pacific splashdown |

The **marker sprite** (glowing dot) is visible only while the vehicle is moving. The **trajectory line** is visible for the entire mission duration.

### Event System

Events have a timestamp `t` (hours from launch) and trigger:
1. **Event banner**: animated glass-morphism overlay bottom-left (bottom: 225px), above the telemetry panel, visible for 4 seconds
2. **Event marker**: small sprite dot along the trajectory (if `showLabel !== false`)
3. **Event label**: text label in the 3D overlay (if `showLabel !== false`)

Events near Earth (Launch, SRB Sep, etc.) have `showLabel: false` since they'd pile up on Earth's surface at the trajectory scale.

Event labels are timed: each label only appears for ~3% of the mission duration around its event's timestamp (clamped to a minimum of 1 hour and maximum of 500 hours). At the default auto-speed, this gives roughly 2 seconds of screen time per label before it fades. Previously labels were visible for the entire mission, cluttering the view.

Detection uses `_lastTriggeredEvent` index — each event fires once. Resets when time goes backwards.

## Rendering Pipeline

### 1. Waypoint Rotation

```javascript
const flybyDate = new Date(launchDate.getTime() + flybyTimeHours * 3600000);
const moonPos = moonPosition(earthMoon.moonElements, flybyDate);
const moonAngle = Math.atan2(moonPos.y, moonPos.x);

// Rotate each waypoint from Moon-aligned to ecliptic frame
const rotatedX = wp.x * cos(moonAngle) - wp.y * sin(moonAngle);
const rotatedY = wp.x * sin(moonAngle) + wp.y * cos(moonAngle);
const rotatedZ = wp.z;  // unchanged
```

### 2. CatmullRom Smoothing with Time Parameterisation

The curve is built from waypoint positions using `CatmullRomCurve3`, but sampled at **uniform time steps**:

```javascript
// For each time sample:
// 1. Find which waypoints bracket this time
// 2. Compute fractional position within that segment
// 3. Map to curve parameter: u = (waypointIndex + frac) / (N - 1)
// 4. Get smooth position: curve.getPoint(u)
```

This ensures the trajectory line progresses linearly with mission time, not arc length. Without this, the early near-Earth portion (tiny distances) would consume most of the line while the lunar coast (vast distances) would be compressed into a few pixels.

### 3. Distance Compression

```javascript
const earthSceneR = sceneRadius(6371, 'planet');  // ~0.0998
const compressedDist = earthSceneR * Math.pow(distKm / 6371, MOON_DIST_EXPONENT) * MOON_DIST_SCALE;
```

`MOON_DIST_EXPONENT` (0.6) and `MOON_DIST_SCALE` (1.5) are centralised constants exported from `sceneBuilder.js` and imported by `missions.js`. This is the **same formula** used for moon positioning. The 0.6 exponent (changed from 0.4) gives more realistic proportions: the Moon appears at 17.6 Earth radii (was 7.7, real is 60.3). Less flyby exaggeration is needed — Artemis II waypoints use ~398,000 km (close to real 395,000 km, previously exaggerated to 430,000 km).

### 4. Scene Coordinate Conversion

```javascript
// Ecliptic to Three.js axes (same as planet positions)
sceneX = dirX * compressedDist;       // ecliptic X stays
sceneY = dirZ * compressedDist;       // ecliptic Z -> scene Y (up)
sceneZ = -dirY * compressedDist;      // ecliptic Y -> scene -Z
```

### 5. Scene Graph Positioning

All mission objects are children of a `THREE.Group` positioned at Earth's scene location each frame. This means:
- Trajectory line positions are in **local Earth-centred** scene coordinates
- Only the group position updates per frame (one vector copy)
- The trajectory shape never changes — it's pre-computed at initialization

### 6. Rendering Details

| Element | Material | Notes |
|---------|----------|-------|
| Trajectory line | `LineBasicMaterial`, vertexColors, opacity 0.5 | Gradient from white at launch to orange |
| Glow points | `PointsMaterial`, additive, size 3px, opacity 0.08 | Primary vehicle only |
| Vehicle marker | 2x `SpriteMaterial`, additive, `depthTest: false` | Core dot + subtle halo |
| Event marker | `SpriteMaterial`, additive, `depthTest: false` | Small dot at TLI, Flyby positions |

**`depthTest: false`** on markers prevents them from being occluded by or casting visual artefacts on the Moon and other bodies.

## Telemetry Computation

```javascript
getTelemetry(missionId, simulatedDate) {
    // Position from interpolated waypoints (geocentric km)
    const pos = interpolate(waypoints, elapsedHours);
    const distKm = pos.length();

    // Speed via finite difference
    const pos2 = interpolate(waypoints, elapsedHours + 0.01);
    const speedKmS = distance(pos, pos2) / (0.01 * 3600);

    return { met: elapsedHours, distKm, speedKmS };
}
```

Displayed as:
- **MET**: T+2d 14:32:08 (days if > 24 hours)
- **Distance**: 245k km / 152k mi
- **Speed**: 1.02 km/s / 2,282 mph

## Camera Behaviour

### Mission Overview (lazy-follow camera)

When a **geocentric** (lunar) mission is selected:
1. Time jumps to launch, speed set to auto-speed preset
2. **Initial snap**: Camera snaps to Earth's current position + the trajectory's local center, zoomed to fit just the trajectory extent. `getMissionBounds()` returns both wide absolute bounds (`center`/`radius`) and tight trajectory-only bounds (`localCenter`/`localRadius`). The initial framing uses `localRadius` (not the wide start+end bounding box) so the trajectory fills the view tightly. Distance is `localRadius / (tan(fov/2) * fitDim)`.
3. The camera azimuth is set ~31 degrees off the Sun direction (0.55 radians) for a dramatic two-thirds illuminated view of Earth/Moon. Elevation is set to 0.3 radians (~17 degrees) for slight perspective above the ecliptic. The `setCamera()` method in CameraController accepts optional azimuth and elevation parameters for this.
4. **Lazy follow during playback**: Each frame, the camera target lerps toward Earth's current position + trajectory local center at `lerp(0.02)`. This keeps the trajectory large and centered while Earth visibly drifts through space — stars move in the background. The initial snap position matches the lazy-follow target, so there is no animation glitch at start.
5. **User interaction breaks lazy follow**: Drag/scroll clears `activeMissionId`, giving full manual control. The camera stops following and stays wherever the user left it.
6. When simulation time passes the mission's end (elapsed > durationHours) and timeScale > 1, speed auto-resets to 1x to prevent the simulation racing onward after completion

**Interplanetary** (heliocentric) missions call `resetToOverview()` instead of computing a custom bounding box. The standard solar system view shows the trajectory cleanly across the full system.

### Cancel Mission

`cancelMission()` keeps the current simulation time, resets to 1x speed, and clears all mission state (active mission, tracking, timeline slider, telemetry). Triggered from: the "Stop replay (1x)" menu item in the missions dropdown, clicking any planet preset, or double-click reset.

### Vehicle Autotracking

Tapping the tracking badge or mission menu enables `trackingMissionId`. The camera target follows the primary vehicle's world position each frame, preserving the user's current zoom distance.

## iOS Port Notes

### SceneKit Equivalents

| Web (Three.js) | iOS (SceneKit) |
|----------------|----------------|
| `THREE.Group` at Earth position | `SCNNode` child of Earth node |
| `THREE.Line` with vertex colours | `SCNGeometrySource` + `SCNGeometryElement(.line)` |
| `THREE.Sprite` (additive) | `SCNPlane` with `SCNBillboardConstraint` + `.add` blend |
| `CatmullRomCurve3` | Custom CatmullRom implementation or `UIBezierPath` |
| `depthTest: false` | `SCNMaterial.readsFromDepthBuffer = false` |
| DOM overlay labels | `SCNView.projectPoint()` + UIKit overlay |

### Key Differences for iOS

1. **No vertex colours on SCNGeometry lines** — use multiple line segments with different materials, or a custom shader
2. **Billboard sprites** — use `SCNBillboardConstraint` on a plane node instead of Three.js Sprite
3. **Event banners** — use UIKit `UIView` animations (UIView.animate with spring damping) instead of CSS animations
4. **Telemetry panel** — SwiftUI overlay with `@Published` properties from a MissionViewModel
5. **Waypoint data** — identical JSON format, parse with `Codable`
6. **Moon position** — use the existing `moonPosition()` function (already in the iOS app)
7. **Distance compression** — use centralised constants `MOON_DIST_EXPONENT` (0.6) and `MOON_DIST_SCALE` (1.5) for both moon positioning and mission trajectory compression
8. **Moon orbit** — implement runtime cos/sin circular motion around the Moon's scene position for `moonOrbit` vehicles. Use `periodHours` and `radiusKm` from the vehicle data. Match the Moon's semi-major axis distance (not the varying actual distance) to stay aligned with the rendered Moon mesh.
9. **Moon landing lerp** — implement the `moonLanding` runtime interpolation: during descent, lerp the vehicle from Columbia's orbit position to the Moon's computed scene position; during the landing window, track the Moon exactly; during ascent, lerp back. Use the Moon's semi-major axis distance for position matching. This avoids needing to model the real 45 km descent path, which is invisible at trajectory scale.

### Data Flow on iOS

```
MissionData.json (bundled resource)
    -> MissionManager (actor, thread-safe)
        -> Waypoint rotation (same math)
            -> CatmullRom interpolation
                -> SCNNode positioning
                    -> SCNView overlay (telemetry)
                        -> UIView animations (banners)
```

## Adding New Missions

To add a new mission (e.g., Apollo 11):

1. Define the mission object in `ALL_MISSIONS` array with:
   - Launch date, duration, flyby time
   - Events array with timestamps and descriptions
   - Vehicles array — for Apollo 11: Saturn V, CSM, LM (with LM separating at the Moon!)

2. Define waypoints in the Moon-aligned frame:
   - X toward Moon at flyby/arrival time
   - Y perpendicular in orbital plane
   - Z out of ecliptic
   - Keep coordinate changes monotonic within each trajectory leg to avoid CatmullRom kinks
   - With the 0.6 exponent, flyby distances close to real values (~398k km) now produce visible separation

3. Add a menu item in `index.html` with `data-mission="apollo11"`

4. The `MissionManager` handles everything else automatically — rotation, rendering, telemetry, events.

### Trajectory Tuning Guide

Six lessons learned from iteratively tuning waypoint data, particularly for Artemis II:

**1. Z-component amplification by distance compression.** The `pow(0.6)` distance compression amplifies out-of-plane (Z) motion relative to in-plane (X/Y), though less severely than the previous 0.4 exponent. At 400,000 km from Earth, X and Y coordinates get compressed, but Z stays relatively large in the scene. Waypoints with constant Z throughout (e.g. Z=4,500 km) make the trajectory appear to pass over the Moon's pole rather than behind the far side. Fix: reduce Z to near-zero at the flyby (~0-150 km), with slight values during coast phases (~200-650 km). The trajectory should be nearly in the Moon's orbital plane at closest approach.

**2. Flyby speed symmetry.** Hand-crafted waypoints can inadvertently have the spacecraft accelerating 2.5x between approach and departure (0.9 km/s to 2.5 km/s). In a free-return trajectory, speed in the Earth frame should be roughly symmetric — what you gain falling into the Moon's gravity well, you lose climbing out. Departure speed should approximate approach speed (~1.0 km/s). The brief peak at periapsis (~1.5 km/s) is physically correct. Fix: space post-flyby waypoints wider in time and closer in distance to match the approach speed profile.

**3. CatmullRom monotonicity.** CatmullRom splines overshoot when coordinate values reverse direction within a segment (e.g., Y going -105k -> -98k -> -115k). This creates visible kinks in the trajectory. Fix: keep X, Y, Z values monotonically changing within each leg (outbound, flyby, return).

**4. Distance compression hiding flyby geometry.** With the 0.6 exponent (changed from 0.4), the compression is less severe. Flyby waypoints at ~398,000 km (close to real 395,000 km) now produce visible separation from the Moon, whereas the old 0.4 exponent required exaggeration to ~430,000 km.

**5. anchorMoon for geocentric missions.** The geocentric equivalent of `anchorBody`: waypoints with `anchorMoon: true` are resolved to the Moon's actual ecliptic position at that time. Used for Apollo 11 departure waypoints so the trajectory line connects smoothly to the Moon's rendered position.

**6. anchorBody for planet alignment.** Approximate heliocentric waypoints (e.g., "Mars at x=0.56, y=-1.05") don't match computed planet positions because Keplerian elements shift over time. The `anchorBody` system snaps key waypoints to real planet positions at initialization via `heliocentricPosition()`. For transfer orbits, `autoTrajectory` generates smooth arcs between anchored endpoints.

**7. Speed auto-scaling.** Each mission's replay speed is computed as `durationHours * 80` then snapped to the nearest preset (100 to 10,000,000x), targeting ~45 seconds per mission regardless of duration. A 210-hour Artemis II mission and a 12-year Voyager mission both play through in roughly the same time.

**8. Interplanetary speed consistency.** Anchored waypoints (where the trajectory snaps to a planet) can cause speed spikes because adjacent waypoints may be far in distance but close in time. Always add transition waypoints ~1,000-2,000 hours before and after anchored points to smooth the speed profile. Applied across Cassini (near Venus/Saturn), New Horizons (near Jupiter/Pluto), Voyager 1 (post-Jupiter tightened from 30+ km/s to ~17 km/s), and Voyager 2 (consistent 12-17 km/s throughout).

**9. LEM descent requires runtime Moon tracking.** At trajectory scale, the real 45 km LEM descent is invisible after compression. Rather than exaggerating the descent waypoints (which would misplace the landing relative to the Moon), the solution is runtime interpolation: Eagle undocks from Columbia's computed orbit position and lerps to the Moon's actual scene position during descent, tracks the Moon during surface operations, and lerps back during ascent. Both `moonOrbit` and `moonLanding` use the Moon's semi-major axis distance (matching the rendered mesh) rather than the varying actual distance, which fluctuates +/-21,000 km due to eccentricity.

### Data Sources for Trajectory Waypoints

| Source | Format | Best For |
|--------|--------|----------|
| NASA HORIZONS API | JSON (text tables) | Spacecraft with NAIF IDs (Voyager, Cassini, etc.) |
| SPICE kernels (via SpiceyPy) | Binary .bsp | Highest accuracy, all NASA missions |
| NASA Technical Reports (NTRS) | PDF tables | Pre-launch reference trajectories |
| GMAT (open source) | Text ephemeris | Custom trajectory computation |

For a ~10-day mission at 10-minute intervals: ~1,440 waypoints, ~60 KB JSON. Trivial file size.

## Artemis II Mission Data

### Timeline (Real)

| Event | Time | Altitude |
|-------|------|----------|
| Launch | T+0 (Apr 1, 22:35 UTC) | 0 km |
| SRB Separation | T+2:08 | ~45 km |
| LAS Jettison | T+3:18 | ~60 km |
| Core Stage MECO | T+8:06 | ~200 km |
| Perigee Raise | T+49 min | LEO |
| Trans-Lunar Injection | T+1:48 | LEO apogee |
| Lunar Flyby | T+~112h (Apr 6) | 8,900 km above far side |
| Splashdown | T+~210h (Apr 10) | Pacific, off San Diego |

### Crew

Reid Wiseman (Commander), Victor Glover (Pilot), Christina Koch (Mission Specialist), Jeremy Hansen (Mission Specialist, CSA).

### Vehicle Separation Sequence

```
T+0          SLS full stack (SRBs + Core + ICPS + Orion)
T+2:08       SRBs separate, fall to Atlantic
T+8:06       Core stage MECO + separation → ICPS + Orion
T+1:48       TLI burn → ICPS separates → Orion alone
T+112h       Lunar flyby (free-return, no propulsive manoeuvre)
T+210h       Entry + splashdown
```
