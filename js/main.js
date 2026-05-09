// main.js
// Entry point for the Solar System web application.
// Creates the Three.js scene, loads all bodies, and runs the animation loop.

import * as THREE from 'three';
import { SceneBuilder, sceneDistance, sceneRadius, eclipticToScene, MOON_DIST_EXPONENT, MOON_DIST_SCALE } from './sceneBuilder.js';
import { CameraController } from './cameraController.js';
import { allPlanets, sun, BodyType } from './solarSystemData.js';
import {
    julianDate, J2000, DEG_TO_RAD,
    heliocentricPosition, moonPosition
} from './orbitalMechanics.js';
import { MissionManager } from './missions.js';

// --- State ---

const sceneBuilder = new SceneBuilder();
let renderer, scene, camera, cameraController;
let bodyNodes = {};    // planet id -> mesh
let moonNodes = {};    // moon id -> mesh
let orbitLines = {};   // planet id -> line
let ringNode = null;   // Saturn's ring mesh
let missionManager = null;

let simulatedDate = new Date();
let timeScale = 1.0;
let isPaused = false;
let lastFrameTime = performance.now();
let frameCount = 0;

let selectedBody = null;
let trackingMissionId = null; // autotrack spacecraft when set
let activeMissionId = null;   // mission currently displayed (even if not tracking)
let showOrbits = true;
let showPlanetLabels = true;
let showMoonLabels = true;
let showStarLabels = true;
let showISS = false;

let bodies = [...allPlanets]; // mutable copy for position tracking
let earthHelioPos = { x: 0, y: 0, z: 0 }; // cached for missions

// --- Initialisation ---

function init() {
    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    document.getElementById('canvas-container').appendChild(renderer.domElement);

    // Scene
    scene = sceneBuilder.buildScene();

    // Camera
    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 1000);
    const earthDist = sceneDistance(1.0);
    camera.position.set(0, earthDist * 1.5, earthDist * 2.0);
    camera.lookAt(0, 0, 0);

    // Camera controller
    cameraController = new CameraController(camera, renderer.domElement, {
        onBodyClicked: (x, y) => {
            const body = cameraController.hitTest(x, y, scene);
            if (body) {
                selectBody(body);
            }
        },
        onDoubleClick: () => {
            resetCamera();
        },
        onUserInteraction: () => {
            trackingMissionId = null;
            activeMissionId = null;
        }
    });

    // Build celestial bodies
    setupBodies();

    // Load starfield asynchronously
    sceneBuilder.loadStarfield(scene);

    // Apply textures
    sceneBuilder.applyAllTextures(bodyNodes, moonNodes);

    // Build procedural ISS model (hidden by default)
    sceneBuilder.buildISSModel(moonNodes);
    if (moonNodes['iss']) moonNodes['iss'].visible = false;

    // Missions
    missionManager = new MissionManager(scene);
    missionManager.initialize();

    // Initial positions
    updatePositions();

    // UI setup
    setupUI();

    // Handle resize
    window.addEventListener('resize', onResize);

    // Check URL parameters for mission auto-select or body focus
    const urlParams = new URLSearchParams(window.location.search);
    const missionParam = urlParams.get('mission');
    if (missionParam && missionManager) {
        const mission = missionManager.getMissions().find(m => m.id === missionParam);
        if (mission) {
            setTimeout(() => jumpToMission(missionParam), 100);
        }
    }
    const focusParam = urlParams.get('focus');
    if (focusParam) {
        const id = focusParam.toLowerCase();
        let target = bodies.find(b => b.id === id);
        if (!target) {
            for (const planet of bodies) {
                if (!planet.moons) continue;
                const moon = planet.moons.find(m => m.id === id);
                if (moon) { target = moon; break; }
            }
        }
        if (target) {
            setTimeout(() => selectBody(target), 100);
        }
    }

    // Start animation
    requestAnimationFrame(animate);
}

function setupBodies() {
    // Sun
    const sunMesh = sceneBuilder.createBodyMesh(sun);
    sunMesh.position.set(0, 0, 0);
    scene.add(sunMesh);
    bodyNodes['sun'] = sunMesh;
    sceneBuilder.addSunGlow(sunMesh);

    // Planets
    for (const body of bodies) {
        const mesh = sceneBuilder.createBodyMesh(body);
        scene.add(mesh);
        bodyNodes[body.id] = mesh;

        // Orbital paths
        const orbitLine = sceneBuilder.createOrbitLine(body, simulatedDate);
        if (orbitLine) {
            scene.add(orbitLine);
            orbitLines[body.id] = orbitLine;
        }

        // Rings
        if (body.physical.hasRings) {
            ringNode = sceneBuilder.addRings(mesh, body);
        }

        // Moons (sized proportionally to parent planet)
        for (const moon of body.moons) {
            const moonMesh = sceneBuilder.createBodyMesh(moon, body);
            scene.add(moonMesh);
            moonNodes[moon.id] = moonMesh;
        }
    }
}

// --- Animation Loop ---

function animate(time) {
    requestAnimationFrame(animate);

    if (!isPaused) {
        const now = performance.now();
        const dt = (now - lastFrameTime) / 1000.0; // seconds
        lastFrameTime = now;
        frameCount++;

        // Advance simulated date
        const scaledMs = dt * timeScale * 1000;
        simulatedDate = new Date(simulatedDate.getTime() + scaledMs);

        updatePositions();

        // Update missions
        if (missionManager) {
            missionManager.update(simulatedDate, earthHelioPos, camera);
        }

        // Check if selected mission has ended — reset to 1x
        if (missionManager && missionManager.selectedMissionId && timeScale > 1) {
            const m = missionManager.getMissions().find(m => m.id === missionManager.selectedMissionId);
            if (m) {
                const elapsed = (simulatedDate.getTime() - m.launchDate.getTime()) / 3600000;
                if (elapsed > m.durationHours) {
                    timeScale = 1;
                    updateSpeedDisplay();
                }
            }
        }

        // Check for mission events
        if (missionManager) {
            const triggered = missionManager.checkEventTrigger(simulatedDate);
            if (triggered) {
                showMissionBanner(triggered.event);
            }
        }

        // Autotrack: spacecraft or lazy-follow mission overview
        if (trackingMissionId && missionManager) {
            const pos = missionManager.getSpacecraftPosition(trackingMissionId, simulatedDate);
            if (pos) {
                cameraController.setCamera(pos, cameraController.currentDistance);
            } else {
                trackingMissionId = null;
            }
        } else if (activeMissionId && missionManager) {
            // Lazy follow: camera pans with Earth at ~70% of its speed
            // Earth's movement is visible but trajectory stays large in view
            const bounds = missionManager.getMissionBounds(activeMissionId);
            const earthMesh = bodyNodes['earth'];
            if (earthMesh && !bounds.isHelio) {
                const trajectoryCenter = earthMesh.position.clone().add(bounds.localCenter || bounds.center);
                const currentTarget = cameraController.target.clone();
                currentTarget.lerp(trajectoryCenter, 0.02); // smooth follow
                cameraController.target.copy(currentTarget);
                cameraController.updateCamera();
            }
        }

        // Throttle UI/label updates to every 3rd frame
        if (frameCount % 3 === 0) {
            updateDateDisplay();
            updateLabels();
            syncZoomSlider();
            updateTrackingBadge();
            syncTimelineSlider();
            updateMissionPanel();
        }
    } else {
        lastFrameTime = performance.now();
    }

    renderer.render(scene, camera);
}

// --- Position Updates ---

function updatePositions() {
    const JD = julianDate(simulatedDate);
    const daysSinceJ2000 = JD - J2000;

    // Rotate the Sun
    if (bodyNodes['sun']) {
        applyRotation(bodyNodes['sun'], sun, daysSinceJ2000);
    }

    for (let i = 0; i < bodies.length; i++) {
        const body = bodies[i];
        if (!body.orbitalElements) continue;
        const mesh = bodyNodes[body.id];
        if (!mesh) continue;

        // Compute heliocentric position
        const pos = heliocentricPosition(body.orbitalElements, simulatedDate);
        bodies[i].position = pos;
        if (body.id === 'earth') earthHelioPos = pos;
        sceneBuilder.updateNodePosition(mesh, pos);
        applyRotation(mesh, body, daysSinceJ2000);

        // Update moons
        for (const moon of body.moons) {
            if (!moon.moonElements) continue;
            const moonMesh = moonNodes[moon.id];
            if (!moonMesh) continue;

            const moonOffset = moonPosition(moon.moonElements, simulatedDate);
            sceneBuilder.updateMoonPosition(
                moonMesh, moonOffset, pos,
                body.physical.radiusKm,
                moon.moonElements.semiMajorAxisKm
            );
            applyRotation(moonMesh, moon, daysSinceJ2000);
        }
    }
}

// --- Rotation ---

function applyRotation(mesh, body, daysSinceJ2000) {
    if (!body.rotation) return;

    const tilt = body.rotation.obliquity * DEG_TO_RAD;
    const spin = rotationAngle(body.rotation, daysSinceJ2000);

    // Compose: first tilt around X, then spin around tilted Y
    const tiltQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), tilt);
    const spinQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), spin);

    const finalQuat = tiltQuat.clone().multiply(spinQuat);
    mesh.quaternion.copy(finalQuat);

    // Saturn's rings: cancel spin to keep rings in equatorial plane
    if (body.physical.hasRings && ringNode) {
        const cancelSpin = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -spin);
        ringNode.quaternion.copy(cancelSpin);
    }
}

function rotationAngle(rotation, daysSinceJ2000) {
    const periodDays = Math.abs(rotation.periodHours) / 24.0;
    if (periodDays <= 0) return 0;
    const rotations = daysSinceJ2000 / periodDays;
    const sign = rotation.periodHours < 0 ? -1.0 : 1.0;
    const w0 = (rotation.w0 || 0) * DEG_TO_RAD;
    return (w0 + sign * rotations * 2.0 * Math.PI) % (2.0 * Math.PI);
}

// --- Label Projection ---

function updateLabels() {
    const labelsContainer = document.getElementById('labels');
    labelsContainer.innerHTML = '';

    const labels = [];
    const w = window.innerWidth;
    const h = window.innerHeight;

    if (showPlanetLabels) {
        // Sun label
        if (bodyNodes['sun']) {
            const sp = projectToScreen(bodyNodes['sun'].position);
            if (sp && sp.z < 1.0 && sp.x > -50 && sp.x < w + 50 && sp.y > -50 && sp.y < h + 50) {
                labels.push({ name: 'Sun', x: sp.x, y: sp.y, type: 'planet', priority: 10000, bodyRef: sun });
            }
        }

        for (const body of bodies) {
            const mesh = bodyNodes[body.id];
            if (!mesh) continue;
            const sp = projectToScreen(mesh.position);
            if (!sp || sp.z >= 1.0) continue;
            if (sp.x < -50 || sp.x > w + 50 || sp.y < -50 || sp.y > h + 50) continue;
            labels.push({
                name: body.name, x: sp.x, y: sp.y,
                type: 'planet', priority: 100 + Math.floor(body.physical.radiusKm / 100),
                bodyRef: body
            });
        }
    }

    if (showMoonLabels) {
        for (const body of bodies) {
            for (const moon of body.moons) {
                if (moon.id === 'iss' && !showISS) continue;
                const mesh = moonNodes[moon.id];
                if (!mesh) continue;
                const sp = projectToScreen(mesh.position);
                if (!sp || sp.z >= 1.0) continue;
                if (sp.x < -50 || sp.x > w + 50 || sp.y < -50 || sp.y > h + 50) continue;
                labels.push({
                    name: moon.name, x: sp.x, y: sp.y,
                    type: 'moon', priority: Math.floor(moon.physical.radiusKm / 100),
                    bodyRef: moon
                });
            }
        }
    }

    if (showStarLabels) {
        // Build body screen positions for occlusion
        const bodyScreenPositions = [];
        for (const id in bodyNodes) {
            const mesh = bodyNodes[id];
            const sp = projectToScreen(mesh.position);
            if (!sp || sp.z >= 1.0) continue;
            const radius = mesh.geometry?.parameters?.radius || 0.1;
            const screenR = Math.max(radius / Math.max(sp.z, 0.001) * 300, 15);
            bodyScreenPositions.push({ x: sp.x, y: sp.y, screenRadius: screenR });
        }

        for (const star of sceneBuilder.namedStars) {
            const sp = projectToScreen(star.position);
            if (!sp || sp.z >= 1.0) continue;
            if (sp.x < -50 || sp.x > w + 50 || sp.y < -50 || sp.y > h + 50) continue;

            // Skip if occluded by a planet disc
            const occluded = bodyScreenPositions.some(body => {
                const dx = sp.x - body.x;
                const dy = sp.y - body.y;
                return Math.sqrt(dx * dx + dy * dy) < body.screenRadius;
            });
            if (occluded) continue;

            labels.push({
                name: star.name, x: sp.x, y: sp.y,
                type: 'star', priority: Math.floor(star.magnitude * -10 + 40),
                bodyRef: null
            });
        }
    }

    // Mission labels (active spacecraft)
    if (missionManager) {
        for (const ml of missionManager.getActiveLabels(simulatedDate)) {
            const sp = projectToScreen(ml.worldPosition);
            if (!sp || sp.z >= 1.0) continue;
            if (sp.x < -50 || sp.x > w + 50 || sp.y < -50 || sp.y > h + 50) continue;
            labels.push({
                name: ml.name, x: sp.x, y: sp.y,
                type: ml.type, priority: ml.priority,
                bodyRef: null
            });
        }
    }

    // De-conflict: planets always shown, then others by priority
    const planets = labels.filter(l => l.type === 'planet');
    const others = labels.filter(l => l.type !== 'planet').sort((a, b) => b.priority - a.priority);
    const placed = [...planets];

    for (const label of others) {
        const tooClose = placed.some(existing => {
            const dx = label.x - existing.x;
            const dy = label.y - existing.y;
            return Math.sqrt(dx * dx + dy * dy) < 35;
        });
        if (!tooClose) placed.push(label);
    }

    // Render labels as DOM elements
    for (const label of placed) {
        const el = document.createElement('div');
        el.className = `label label-${label.type}`;
        el.textContent = label.name;
        el.style.left = `${label.x}px`;
        el.style.top = `${label.y - 16}px`;
        if (label.bodyRef) {
            onTap(el, () => selectBody(label.bodyRef));
            el.style.cursor = 'pointer';
        }
        labelsContainer.appendChild(el);
    }
}

function projectToScreen(worldPos) {
    const v = worldPos.clone().project(camera);
    if (v.z > 1.0) return null;
    return {
        x: (v.x * 0.5 + 0.5) * window.innerWidth,
        y: (-v.y * 0.5 + 0.5) * window.innerHeight,
        z: v.z
    };
}

// --- Body Selection ---

function selectBody(body) {
    if (missionManager && missionManager.selectedMissionId) cancelMission();
    selectedBody = body;
    showInfoPanel(body);

    // Sync planet strip selection
    document.querySelectorAll('#planet-strip .planet-thumb-wrapper').forEach(t => t.classList.remove('selected'));
    const thumb = document.querySelector(`#planet-strip .planet-thumb-wrapper[data-body="${body.name}"]`);
    if (thumb) thumb.classList.add('selected');

    // Focus camera on the body
    const id = body.id;
    const mesh = bodyNodes[id] || moonNodes[id];
    if (mesh) {
        focusCamera(mesh, body);
    }
}

function focusCamera(mesh, body) {
    // Calculate extent including moon system
    let extent = mesh.geometry?.parameters?.radius || 0.1;

    if (body.moons && body.moons.length > 0) {
        const parentRadius = sceneRadius(body.physical.radiusKm, body.type);
        for (const moon of body.moons) {
            if (!moon.moonElements) continue;
            const realRatio = moon.moonElements.semiMajorAxisKm / body.physical.radiusKm;
            const compressedRatio = Math.pow(realRatio, MOON_DIST_EXPONENT) * MOON_DIST_SCALE;
            const moonSceneDist = parentRadius * compressedRatio;
            const moonR = sceneRadius(moon.physical.radiusKm, BodyType.MOON, body.physical.radiusKm);
            extent = Math.max(extent, moonSceneDist + moonR);
        }
    }

    // Moonless bodies: zoom out more so they appear a similar visual size
    // to planets with moon systems. Portrait viewports need a closer camera
    // since the constraining dimension (width) is much smaller.
    const hasMoons = body.moons && body.moons.length > 0;
    const aspect = window.innerWidth / window.innerHeight;
    const portraitFactor = Math.min(aspect, 1.0); // 1.0 on landscape, <1 on portrait
    const baseMultiplier = hasMoons ? 0.8 : 6.0;
    const multiplier = baseMultiplier * (0.5 + 0.5 * portraitFactor);
    const cameraDistance = Math.max(extent * multiplier, 0.5);
    // Position camera ~31° off Sun direction for dramatic 2/3 lit view
    const pos = mesh.position;
    const sunAzimuth = Math.atan2(-pos.x, -pos.z) + 0.55;
    cameraController.setCamera(pos.clone(), cameraDistance, sunAzimuth, 0.3);
    syncZoomSlider();
}

function resetCamera() {
    if (missionManager && missionManager.selectedMissionId) cancelMission();
    const earthDist = sceneDistance(1.0);
    cameraController.resetToOverview(earthDist);
    selectedBody = null;
    hideInfoPanel();
    syncZoomSlider();
}

/** Cancel active mission replay — keeps current time, resets to 1x */
function cancelMission() {
    trackingMissionId = null;
    activeMissionId = null;
    if (missionManager) missionManager.selectedMissionId = null;
    timeScale = 1;
    updateSpeedDisplay();
    document.getElementById('tracking-badge').classList.add('hidden');
    document.getElementById('mission-panel').classList.add('hidden');
}

// --- Mission Navigation ---

function jumpToMission(missionId) {
    if (!missionManager) return;
    const mission = missionManager.getMissions().find(m => m.id === missionId);
    if (!mission) return;

    // Jump to launch time
    simulatedDate = new Date(mission.launchDate.getTime());
    lastFrameTime = performance.now();

    // Snap to nearest preset speed that plays the mission in ~30-60 seconds
    const idealSpeed = mission.durationHours * 80;
    const presets = [100, 1000, 10000, 100000, 1000000, 10000000];
    timeScale = presets.reduce((best, p) =>
        Math.abs(Math.log(p) - Math.log(idealSpeed)) < Math.abs(Math.log(best) - Math.log(idealSpeed)) ? p : best
    );
    updateSpeedDisplay();

    // Unpause
    isPaused = false;
    document.getElementById('btn-play-pause').textContent = '\u23F8';

    // Update positions at new date
    updatePositions();
    missionManager.update(simulatedDate, earthHelioPos, camera);

    // Frame the mission view
    const bounds = missionManager.getMissionBounds(missionId);
    if (bounds.isHelio) {
        // Interplanetary: use default solar system overview
        const earthDist = sceneDistance(1.0);
        cameraController.resetToOverview(earthDist);
    } else {
        // Lunar: tight frame on Earth + trajectory, lazy-follows during playback
        const earthMesh = bodyNodes['earth'];
        let target;
        if (earthMesh && bounds.localCenter) {
            target = earthMesh.position.clone().add(bounds.localCenter);
        } else {
            target = bounds.center.clone();
        }
        const tightRadius = bounds.localRadius || bounds.radius;
        const aspect = window.innerWidth / window.innerHeight;
        const fovRad = camera.fov * DEG_TO_RAD;
        const fitDim = Math.min(aspect, 1.0);
        const portraitPad = aspect < 1.0 ? 1.4 : 1.1;
        const cameraDistance = Math.max(tightRadius * portraitPad / (Math.tan(fovRad / 2) * fitDim), 0.5);
        // Position camera ~31° off Sun direction for dramatic 2/3 lit view
        const sunAzimuth = Math.atan2(-target.x, -target.z) + 0.55;
        cameraController.setCamera(target, cameraDistance, sunAzimuth, 0.3);
    }
    syncZoomSlider();

    // Clear planet selection UI
    selectedBody = null;
    hideInfoPanel();
    document.querySelectorAll('#planet-strip .planet-thumb-wrapper').forEach(t => t.classList.remove('selected'));

    trackingMissionId = null; // start in overview, user can tap badge to track
    activeMissionId = missionId;
    missionManager.selectedMissionId = missionId;
    missionManager.resetEventTriggers(missionId);
    showMissions();
}

function resumeTracking(missionId) {
    if (!missionManager) return;
    const mission = missionManager.getMissions().find(m => m.id === missionId);
    if (!mission) return;

    const elapsed = (simulatedDate.getTime() - mission.launchDate.getTime()) / 3600000;
    if (elapsed >= 0 && elapsed <= mission.durationHours) {
        trackingMissionId = missionId;
        activeMissionId = missionId;
    }
}

// --- UI ---

/**
 * Bind a tap/click handler that works reliably on iOS Safari.
 * Uses touchend with preventDefault to fire immediately on touch,
 * plus click as fallback for mouse. Prevents double-firing.
 */
function onTap(element, handler) {
    let touchFired = false;
    element.addEventListener('touchend', (e) => {
        e.preventDefault();
        touchFired = true;
        handler(e);
    });
    element.addEventListener('click', (e) => {
        if (touchFired) {
            touchFired = false;
            return;
        }
        handler(e);
    });
}

function setupUI() {
    // Play/Pause
    onTap(document.getElementById('btn-play-pause'), () => {
        isPaused = !isPaused;
        document.getElementById('btn-play-pause').textContent = isPaused ? '\u25B6' : '\u23F8';
    });

    // Time scale menu
    onTap(document.getElementById('btn-speed'), () => {
        document.getElementById('speed-menu').classList.toggle('hidden');
    });

    document.querySelectorAll('#speed-menu [data-speed]').forEach(item => {
        onTap(item, () => {
            const speed = parseFloat(item.dataset.speed);
            if (item.dataset.speed === 'now') {
                simulatedDate = new Date();
                timeScale = 1.0;
                isPaused = false;
                document.getElementById('btn-play-pause').textContent = '\u23F8';
            } else {
                timeScale = speed;
            }
            updateSpeedDisplay();
            document.getElementById('speed-menu').classList.add('hidden');
        });
    });

    // Close speed menu on outside tap
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#speed-control')) {
            document.getElementById('speed-menu').classList.add('hidden');
        }
    });

    // Orbits toggle
    onTap(document.getElementById('btn-orbits'), () => {
        showOrbits = !showOrbits;
        for (const id in orbitLines) {
            orbitLines[id].visible = showOrbits;
        }
        document.getElementById('btn-orbits').classList.toggle('active', showOrbits);
    });

    // Labels menu
    onTap(document.getElementById('btn-labels'), () => {
        document.getElementById('labels-menu').classList.toggle('hidden');
    });

    onTap(document.getElementById('toggle-planet-labels'), () => {
        showPlanetLabels = !showPlanetLabels;
        document.getElementById('toggle-planet-labels').classList.toggle('checked', showPlanetLabels);
    });
    onTap(document.getElementById('toggle-moon-labels'), () => {
        showMoonLabels = !showMoonLabels;
        document.getElementById('toggle-moon-labels').classList.toggle('checked', showMoonLabels);
    });
    onTap(document.getElementById('toggle-star-labels'), () => {
        showStarLabels = !showStarLabels;
        document.getElementById('toggle-star-labels').classList.toggle('checked', showStarLabels);
    });

    // Satellites menu
    onTap(document.getElementById('btn-satellites'), () => {
        document.getElementById('satellites-menu').classList.toggle('hidden');
    });
    onTap(document.getElementById('toggle-iss'), () => {
        showISS = !showISS;
        document.getElementById('toggle-iss').classList.toggle('checked', showISS);
        if (moonNodes['iss']) moonNodes['iss'].visible = showISS;
        document.getElementById('btn-satellites').classList.toggle('active', showISS);
    });
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#satellites-control')) {
            document.getElementById('satellites-menu').classList.add('hidden');
        }
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('#labels-control')) {
            document.getElementById('labels-menu').classList.add('hidden');
        }
    });

    // Tracking badge — tap to resume tracking
    onTap(document.getElementById('tracking-badge'), () => {
        if (trackingMissionId) return; // already tracking
        if (missionManager) {
            for (const m of missionManager.getMissions()) {
                const elapsed = (simulatedDate.getTime() - m.launchDate.getTime()) / 3600000;
                if (elapsed >= 0 && elapsed <= m.durationHours) {
                    trackingMissionId = m.id;
                    activeMissionId = m.id;
                    break;
                }
            }
        }
    });

    // Missions menu
    onTap(document.getElementById('btn-missions'), () => {
        document.getElementById('missions-menu').classList.toggle('hidden');
    });

    document.querySelectorAll('#missions-menu .mission-item').forEach(item => {
        onTap(item, () => {
            const missionId = item.dataset.mission;
            showMissions();
            jumpToMission(missionId);
            document.getElementById('missions-menu').classList.add('hidden');
        });
    });

    onTap(document.getElementById('btn-stop-mission'), () => {
        cancelMission();
        document.getElementById('missions-menu').classList.add('hidden');
    });

    onTap(document.getElementById('btn-dismiss-missions'), () => {
        if (missionManager && missionManager.visible) {
            dismissMission();
        } else {
            showMissions();
        }
        document.getElementById('missions-menu').classList.add('hidden');
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('#missions-control')) {
            document.getElementById('missions-menu').classList.add('hidden');
        }
    });

    // Planet strip thumbnails
    document.querySelectorAll('#planet-strip .planet-thumb-wrapper[data-body]').forEach(wrapper => {
        onTap(wrapper, () => {
            const name = wrapper.dataset.body;
            const body = findBodyByName(name);
            if (body) selectBody(body);
        });
    });

    // Overview thumbnail
    onTap(document.getElementById('thumb-overview'), () => {
        resetCamera();
    });

    // Credits overlay
    onTap(document.getElementById('btn-credits'), () => {
        document.getElementById('credits-overlay').classList.remove('hidden');
    });
    onTap(document.getElementById('credits-dismiss'), () => {
        document.getElementById('credits-overlay').classList.add('hidden');
    });
    onTap(document.getElementById('credits-overlay'), (e) => {
        if (e.target === document.getElementById('credits-overlay')) {
            document.getElementById('credits-overlay').classList.add('hidden');
        }
    });

    // Zoom slider
    const zoomSlider = document.getElementById('zoom-slider');
    const zoomThumb = document.getElementById('zoom-thumb');
    const zoomFill = document.getElementById('zoom-fill');

    let zoomDragging = false;

    function updateZoomFromEvent(clientX) {
        const rect = zoomSlider.getBoundingClientRect();
        const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        // Left = close (zoom 0), Right = far (zoom 1)
        const zoomLevel = 1.0 - fraction;
        applyZoom(zoomLevel);
    }

    zoomSlider.addEventListener('mousedown', (e) => {
        zoomDragging = true;
        updateZoomFromEvent(e.clientX);
    });
    document.addEventListener('mousemove', (e) => {
        if (zoomDragging) updateZoomFromEvent(e.clientX);
    });
    document.addEventListener('mouseup', () => { zoomDragging = false; });

    zoomSlider.addEventListener('touchstart', (e) => {
        e.preventDefault();
        zoomDragging = true;
        updateZoomFromEvent(e.touches[0].clientX);
    }, { passive: false });
    document.addEventListener('touchmove', (e) => {
        if (zoomDragging) updateZoomFromEvent(e.touches[0].clientX);
    });
    document.addEventListener('touchend', () => { zoomDragging = false; });

    // Mission timeline slider
    const timelineSlider = document.getElementById('timeline-slider');
    let timelineDragging = false;
    let timelineWasPaused = false;

    function updateTimelineFromEvent(clientX) {
        const mId = missionManager ? missionManager.selectedMissionId : null;
        if (!missionManager || !mId) return;
        const mission = missionManager.getMissions().find(m => m.id === mId);
        if (!mission) return;
        const rect = timelineSlider.getBoundingClientRect();
        const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        const elapsedHours = fraction * mission.durationHours;
        simulatedDate = new Date(mission.launchDate.getTime() + elapsedHours * 3600000);
        lastFrameTime = performance.now();
        updatePositions();
        missionManager.update(simulatedDate, earthHelioPos, camera);

        // Respect current camera mode during scrub
        if (trackingMissionId) {
            const pos = missionManager.getSpacecraftPosition(trackingMissionId, simulatedDate);
            if (pos) cameraController.setCamera(pos, cameraController.currentDistance);
        }
        // No overview camera lock during scrub — camera stays still, Earth drifts

        // Update UI during scrub (animation loop is paused)
        syncTimelineSlider();
        updateDateDisplay();
        updateLabels();
        updateMissionPanel();

        // Fire event banners
        const triggered = missionManager.checkEventTrigger(simulatedDate);
        if (triggered) showMissionBanner(triggered.event);
    }

    timelineSlider.addEventListener('mousedown', (e) => {
        timelineDragging = true;
        timelineWasPaused = isPaused;
        isPaused = true;
        updateTimelineFromEvent(e.clientX);
    });
    document.addEventListener('mousemove', (e) => {
        if (timelineDragging) updateTimelineFromEvent(e.clientX);
    });
    document.addEventListener('mouseup', () => {
        if (timelineDragging) {
            timelineDragging = false;
            isPaused = timelineWasPaused;
            document.getElementById('btn-play-pause').textContent = isPaused ? '\u25B6' : '\u23F8';
            lastFrameTime = performance.now();
        }
    });

    timelineSlider.addEventListener('touchstart', (e) => {
        e.preventDefault();
        timelineDragging = true;
        timelineWasPaused = isPaused;
        isPaused = true;
        updateTimelineFromEvent(e.touches[0].clientX);
    }, { passive: false });
    document.addEventListener('touchmove', (e) => {
        if (timelineDragging) updateTimelineFromEvent(e.touches[0].clientX);
    });
    document.addEventListener('touchend', () => {
        if (timelineDragging) {
            timelineDragging = false;
            isPaused = timelineWasPaused;
            document.getElementById('btn-play-pause').textContent = isPaused ? '\u25B6' : '\u23F8';
            lastFrameTime = performance.now();
        }
    });

    // Info panel dismiss
    onTap(document.getElementById('info-dismiss'), () => {
        selectedBody = null;
        hideInfoPanel();
    });

    // Initial UI state
    updateSpeedDisplay();
    updateDateDisplay();
}

function findBodyByName(name) {
    const id = name.toLowerCase().replace(/ /g, '_');
    if (id === 'sun') return sun;
    for (const body of bodies) {
        if (body.id === id) return body;
        for (const moon of body.moons) {
            if (moon.id === id) return moon;
        }
    }
    return null;
}

// --- Zoom ---

const ZOOM_MIN_DIST = 0.5;
const ZOOM_MAX_DIST = 250.0;

function distanceToZoom(dist) {
    const logMin = Math.log(ZOOM_MIN_DIST);
    const logMax = Math.log(ZOOM_MAX_DIST);
    const logDist = Math.log(Math.max(dist, ZOOM_MIN_DIST));
    return (logDist - logMin) / (logMax - logMin);
}

function zoomToDistance(zoom) {
    const logMin = Math.log(ZOOM_MIN_DIST);
    const logMax = Math.log(ZOOM_MAX_DIST);
    return Math.exp(logMin + zoom * (logMax - logMin));
}

function applyZoom(level) {
    const dist = zoomToDistance(level);
    cameraController.setDistance(dist);
    syncZoomSlider();
}

function syncZoomSlider() {
    const zoom = distanceToZoom(cameraController.currentDistance);
    const fraction = 1.0 - zoom; // left = close
    const thumb = document.getElementById('zoom-thumb');
    const fill = document.getElementById('zoom-fill');
    thumb.style.left = `calc(${fraction * 100}% - 5px)`;
    fill.style.width = `${fraction * 100}%`;
}

// --- Info Panel ---

function showInfoPanel(body) {
    const panel = document.getElementById('info-panel');
    panel.classList.remove('hidden');

    const [r, g, b] = body.physical.color;
    document.getElementById('info-color').style.backgroundColor =
        `rgb(${Math.floor(r * 255)}, ${Math.floor(g * 255)}, ${Math.floor(b * 255)})`;
    document.getElementById('info-name').textContent = body.name;

    const typeName = body.type === BodyType.DWARF_PLANET ? 'Dwarf Planet' : body.type.charAt(0).toUpperCase() + body.type.slice(1);
    const radiusStr = body.physical.radiusKm >= 10000
        ? `${Math.floor(body.physical.radiusKm / 1000)}k km`
        : body.physical.radiusKm >= 100
            ? `${Math.floor(body.physical.radiusKm)} km`
            : `${body.physical.radiusKm.toFixed(1)} km`;

    let details = `${typeName} \u00B7 r: ${radiusStr}`;
    if (body.type !== BodyType.STAR) {
        const dist = Math.sqrt(body.position.x ** 2 + body.position.y ** 2 + body.position.z ** 2);
        details += ` \u00B7 ${dist.toFixed(2)} AU`;
    }
    document.getElementById('info-details').textContent = details;
}

function hideInfoPanel() {
    document.getElementById('info-panel').classList.add('hidden');
}

// --- Date/Speed Display ---

function updateDateDisplay() {
    const options = { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
    document.getElementById('date-display').textContent = simulatedDate.toLocaleDateString('en-GB', options);
    updateSpeedDisplay();
}

function updateSpeedDisplay() {
    const badge = document.getElementById('speed-badge');
    if (timeScale === 1.0) {
        badge.classList.add('hidden');
    } else {
        badge.classList.remove('hidden');
        badge.textContent = formatTimeScale(timeScale);
    }

    // Update speed button text
    document.getElementById('speed-text').textContent = formatTimeScale(timeScale);
}

function formatTimeScale(scale) {
    const abs = Math.abs(scale);
    const prefix = scale < 0 ? '-' : '';
    if (abs >= 1000000) return `${prefix}${(abs / 1000000).toFixed(0)}Mx`;
    if (abs >= 1000) return `${prefix}${(abs / 1000).toFixed(0)}kx`;
    if (abs < 1) return `${prefix}${abs.toFixed(1)}x`;
    return `${prefix}${abs.toFixed(0)}x`;
}

// --- Mission Event Banner ---

let bannerTimeout = null;

function showMissionBanner(event) {
    const banner = document.getElementById('mission-banner');
    const nameEl = document.getElementById('mission-banner-name');
    const detailEl = document.getElementById('mission-banner-detail');

    // Clear any existing timeout
    if (bannerTimeout) clearTimeout(bannerTimeout);

    nameEl.textContent = event.name;
    detailEl.textContent = event.detail || '';

    banner.classList.remove('hidden', 'fade-out');
    // Force reflow so animation restarts
    banner.offsetHeight;

    // Fade out after 4 seconds
    bannerTimeout = setTimeout(() => {
        banner.classList.add('fade-out');
        setTimeout(() => banner.classList.add('hidden'), 600);
    }, 4000);
}

// --- Mission Timeline Slider ---

function syncTimelineSlider() {
    const container = document.getElementById('timeline-container');
    const missionId = missionManager ? missionManager.selectedMissionId : null;
    if (!missionManager || !missionId) {
        container.classList.add('hidden');
        return;
    }
    const mission = missionManager.getMissions().find(m => m.id === missionId);
    if (!mission) { container.classList.add('hidden'); return; }

    const elapsedHours = (simulatedDate.getTime() - mission.launchDate.getTime()) / 3600000;
    const fraction = Math.max(0, Math.min(1, elapsedHours / mission.durationHours));

    container.classList.remove('hidden');
    document.getElementById('timeline-thumb').style.left = `calc(${fraction * 100}% - 5px)`;
    document.getElementById('timeline-fill').style.width = `${fraction * 100}%`;

    // Update end label
    const dur = mission.durationHours;
    const endLabel = dur >= 8760 ? `${(dur / 8760).toFixed(1)}y`
        : dur >= 720 ? `${Math.round(dur / 24)}d`
        : dur >= 24 ? `${(dur / 24).toFixed(1)}d`
        : `${Math.round(dur)}h`;
    document.getElementById('timeline-end').textContent = endLabel;
}

// --- Mission Telemetry Panel ---

function updateMissionPanel() {
    const panel = document.getElementById('mission-panel');
    const missionId = missionManager ? missionManager.selectedMissionId : null;
    if (!missionManager || !missionId) {
        panel.classList.add('hidden');
        return;
    }

    const telem = missionManager.getTelemetry(missionId, simulatedDate);
    if (!telem) {
        panel.classList.add('hidden');
        return;
    }

    panel.classList.remove('hidden');
    document.getElementById('mission-panel-title').textContent = telem.missionName;

    // MET (Mission Elapsed Time)
    const met = telem.met;
    const metNeg = met < 0;
    const absMet = Math.abs(met);
    const days = Math.floor(absMet / 24);
    const hrs = Math.floor(absMet % 24);
    const mins = Math.floor((absMet * 60) % 60);
    const secs = Math.floor((absMet * 3600) % 60);
    const sign = metNeg ? '-' : '+';
    const metStr = days > 0
        ? `T${sign}${days}d ${String(hrs).padStart(2,'0')}:${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`
        : `T${sign}${String(hrs).padStart(2,'0')}:${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
    document.getElementById('telem-met').textContent = metStr;

    // Distance
    if (telem.isHelio && telem.distAU !== null) {
        document.getElementById('telem-dist').textContent = `${telem.distAU.toFixed(2)} AU from Sun`;
    } else {
        const distKm = telem.distKm;
        const distMi = distKm * 0.621371;
        const fmtDist = (d, unit) => {
            if (d < 1000) return `${Math.floor(d)} ${unit}`;
            if (d < 100000) return `${(d / 1000).toFixed(1)}k ${unit}`;
            return `${Math.floor(d / 1000).toLocaleString()}k ${unit}`;
        };
        document.getElementById('telem-dist').textContent = `${fmtDist(distKm, 'km')} / ${fmtDist(distMi, 'mi')}`;
    }

    // Speed (km/s and mph)
    const speedKmS = telem.speedKmS;
    const speedMph = speedKmS * 2236.936;
    document.getElementById('telem-speed').textContent = `${speedKmS.toFixed(2)} km/s / ${Math.floor(speedMph).toLocaleString()} mph`;
}

// --- Tracking Badge ---

function updateTrackingBadge() {
    const badge = document.getElementById('tracking-badge');
    if (!missionManager) { badge.classList.add('hidden'); return; }

    // Find if any mission is currently active
    let activeId = null;
    for (const m of missionManager.getMissions()) {
        const elapsed = (simulatedDate.getTime() - m.launchDate.getTime()) / 3600000;
        if (elapsed >= 0 && elapsed <= m.durationHours) {
            activeId = m.id;
            break;
        }
    }

    // Also show badge if we have an active mission set (even outside time window for dismissing)
    if (!activeId && !activeMissionId) {
        badge.classList.add('hidden');
        return;
    }

    const missionId = activeId || activeMissionId;
    const mission = missionManager.getMissions().find(m => m.id === missionId);
    if (!mission) { badge.classList.add('hidden'); return; }

    badge.classList.remove('hidden');
    if (trackingMissionId === missionId) {
        badge.textContent = `\u25CF ${mission.name}`;
    } else if (activeId) {
        badge.textContent = `\u25CB ${mission.name}`;
    } else {
        badge.textContent = `${mission.name} ended`;
        activeMissionId = null;
    }
}

function dismissMission() {
    trackingMissionId = null;
    activeMissionId = null;
    if (missionManager) {
        missionManager.selectedMissionId = null;
        missionManager.setVisible(false);
    }
    document.getElementById('tracking-badge').classList.add('hidden');
    document.getElementById('mission-panel').classList.add('hidden');
    document.getElementById('btn-missions').classList.remove('active');
    document.getElementById('btn-dismiss-missions').textContent = 'Show trajectories';
}

function showMissions() {
    if (missionManager) missionManager.setVisible(true);
    document.getElementById('btn-missions').classList.add('active');
    document.getElementById('btn-dismiss-missions').textContent = 'Hide trajectories';
}

// --- Resize ---

function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// --- Loading Screen ---

function hideLoadingScreen() {
    const loading = document.getElementById('loading');
    if (loading) {
        loading.style.opacity = '0';
        setTimeout(() => loading.remove(), 500);
    }
}

// Start
window.addEventListener('DOMContentLoaded', () => {
    init();
    // Hide loading screen after textures begin loading
    setTimeout(hideLoadingScreen, 1500);
});
