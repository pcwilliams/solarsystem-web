// cameraController.js
// Orbital camera controller managing spherical coordinates around a target.
// Handles mouse/touch input: left-drag to pan, right-drag/two-finger to orbit,
// scroll/pinch to zoom, click to select, double-click to reset.

import * as THREE from 'three';

export class CameraController {
    constructor(camera, domElement, callbacks = {}) {
        this.camera = camera;
        this.domElement = domElement;
        this.onBodyClicked = callbacks.onBodyClicked || (() => {});
        this.onDoubleClick = callbacks.onDoubleClick || (() => {});

        // Camera orbital state (spherical coordinates)
        this.distance = 40.0;
        this.azimuth = 0.0;       // radians
        this.elevation = 0.4;     // radians
        this.target = new THREE.Vector3(0, 0, 0);

        // Min/max distance matching iOS app
        this.minDistance = 0.5;
        this.maxDistance = 250.0;

        // Gesture tracking state
        this._isDragging = false;
        this._isOrbiting = false;
        this._lastMouse = { x: 0, y: 0 };
        this._lastTouches = [];
        this._lastPinchDist = 0;
        this._clickStartTime = 0;
        this._clickStartPos = { x: 0, y: 0 };
        this._lastClickTime = 0;

        // Raycaster for hit testing
        this._raycaster = new THREE.Raycaster();
        this._mouse = new THREE.Vector2();

        this._bindEvents();
        this.updateCamera();
    }

    /**
     * Recompute camera position from spherical coordinates and look at target.
     */
    updateCamera() {
        this.elevation = Math.max(-Math.PI / 2 * 0.95, Math.min(Math.PI / 2 * 0.95, this.elevation));
        this.distance = Math.max(this.minDistance, Math.min(this.maxDistance, this.distance));

        const x = this.target.x + this.distance * Math.cos(this.elevation) * Math.sin(this.azimuth);
        const y = this.target.y + this.distance * Math.sin(this.elevation);
        const z = this.target.z + this.distance * Math.cos(this.elevation) * Math.cos(this.azimuth);

        this.camera.position.set(x, y, z);
        this.camera.lookAt(this.target);
    }

    setCamera(target, distance) {
        this.target.copy(target);
        this.distance = distance;
        this.updateCamera();
    }

    setDistance(distance) {
        this.distance = Math.max(this.minDistance, Math.min(this.maxDistance, distance));
        this.updateCamera();
    }

    get currentDistance() { return this.distance; }

    resetToOverview(earthDist) {
        this.target.set(0, 0, 0);
        this.distance = earthDist * 2.5;
        this.azimuth = 0;
        this.elevation = 0.5;
        this.updateCamera();
    }

    /**
     * Perform a raycast hit test at the given screen coordinates.
     */
    hitTest(x, y, scene) {
        const rect = this.domElement.getBoundingClientRect();
        this._mouse.x = ((x - rect.left) / rect.width) * 2 - 1;
        this._mouse.y = -((y - rect.top) / rect.height) * 2 + 1;

        this._raycaster.setFromCamera(this._mouse, this.camera);
        const intersects = this._raycaster.intersectObjects(scene.children, true);

        for (const hit of intersects) {
            // Walk up to find a mesh with body data
            let obj = hit.object;
            while (obj) {
                if (obj.userData && obj.userData.body) {
                    return obj.userData.body;
                }
                obj = obj.parent;
            }
        }
        return null;
    }

    _bindEvents() {
        const el = this.domElement;

        // Mouse events
        el.addEventListener('mousedown', (e) => this._onMouseDown(e));
        el.addEventListener('mousemove', (e) => this._onMouseMove(e));
        el.addEventListener('mouseup', (e) => this._onMouseUp(e));
        el.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
        el.addEventListener('contextmenu', (e) => e.preventDefault());

        // Touch events
        el.addEventListener('touchstart', (e) => this._onTouchStart(e), { passive: false });
        el.addEventListener('touchmove', (e) => this._onTouchMove(e), { passive: false });
        el.addEventListener('touchend', (e) => this._onTouchEnd(e));
    }

    // --- Mouse handlers ---

    _onMouseDown(e) {
        this._clickStartTime = performance.now();
        this._clickStartPos = { x: e.clientX, y: e.clientY };

        if (e.button === 0) {
            // Left click: pan (translate target)
            this._isDragging = true;
        } else if (e.button === 2) {
            // Right click: orbit
            this._isOrbiting = true;
        }
        this._lastMouse = { x: e.clientX, y: e.clientY };
    }

    _onMouseMove(e) {
        const dx = e.clientX - this._lastMouse.x;
        const dy = e.clientY - this._lastMouse.y;
        this._lastMouse = { x: e.clientX, y: e.clientY };

        if (this._isDragging) {
            // Translate target in camera-local right/up plane
            const speed = this.distance * 0.002;
            const right = new THREE.Vector3();
            const up = new THREE.Vector3();
            this.camera.getWorldDirection(new THREE.Vector3());
            right.setFromMatrixColumn(this.camera.matrixWorld, 0);
            up.setFromMatrixColumn(this.camera.matrixWorld, 1);

            this.target.addScaledVector(right, -dx * speed);
            this.target.addScaledVector(up, dy * speed);
            this.updateCamera();
        } else if (this._isOrbiting) {
            this.azimuth -= dx * 0.005;
            this.elevation += dy * 0.005;
            this.updateCamera();
        }
    }

    _onMouseUp(e) {
        const elapsed = performance.now() - this._clickStartTime;
        const movedX = Math.abs(e.clientX - this._clickStartPos.x);
        const movedY = Math.abs(e.clientY - this._clickStartPos.y);

        // Detect click vs drag
        if (elapsed < 300 && movedX < 5 && movedY < 5 && e.button === 0) {
            const now = performance.now();
            if (now - this._lastClickTime < 350) {
                // Double click
                this.onDoubleClick();
                this._lastClickTime = 0;
            } else {
                this._lastClickTime = now;
                // Defer single click to allow double-click detection
                this._pendingClickX = e.clientX;
                this._pendingClickY = e.clientY;
                this._pendingClickTimeout = setTimeout(() => {
                    if (this._lastClickTime > 0) {
                        this.onBodyClicked(this._pendingClickX, this._pendingClickY);
                    }
                }, 350);
            }
        }

        this._isDragging = false;
        this._isOrbiting = false;
    }

    _onWheel(e) {
        e.preventDefault();
        const factor = e.deltaY > 0 ? 1.1 : 0.9;
        this.distance = Math.max(this.minDistance, Math.min(this.maxDistance, this.distance * factor));
        this.updateCamera();
    }

    // --- Touch handlers ---

    _onTouchStart(e) {
        e.preventDefault();
        this._clickStartTime = performance.now();

        if (e.touches.length === 1) {
            this._clickStartPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
            this._isDragging = false;
            this._isOrbiting = false;
            this._lastTouches = [{ x: e.touches[0].clientX, y: e.touches[0].clientY }];
        } else if (e.touches.length === 2) {
            this._isDragging = false;
            this._isOrbiting = true;
            this._lastTouches = [
                { x: e.touches[0].clientX, y: e.touches[0].clientY },
                { x: e.touches[1].clientX, y: e.touches[1].clientY }
            ];
            this._lastPinchDist = Math.hypot(
                e.touches[1].clientX - e.touches[0].clientX,
                e.touches[1].clientY - e.touches[0].clientY
            );
        }
    }

    _onTouchMove(e) {
        e.preventDefault();

        if (e.touches.length === 1 && !this._isOrbiting) {
            // One-finger: pan
            const dx = e.touches[0].clientX - this._lastTouches[0].x;
            const dy = e.touches[0].clientY - this._lastTouches[0].y;
            this._lastTouches = [{ x: e.touches[0].clientX, y: e.touches[0].clientY }];

            // If barely moved, don't start dragging yet
            if (!this._isDragging) {
                const totalDx = e.touches[0].clientX - this._clickStartPos.x;
                const totalDy = e.touches[0].clientY - this._clickStartPos.y;
                if (Math.abs(totalDx) > 5 || Math.abs(totalDy) > 5) {
                    this._isDragging = true;
                } else {
                    return;
                }
            }

            const speed = this.distance * 0.002;
            const right = new THREE.Vector3();
            const up = new THREE.Vector3();
            right.setFromMatrixColumn(this.camera.matrixWorld, 0);
            up.setFromMatrixColumn(this.camera.matrixWorld, 1);

            this.target.addScaledVector(right, -dx * speed);
            this.target.addScaledVector(up, dy * speed);
            this.updateCamera();
        } else if (e.touches.length === 2) {
            // Two-finger: orbit + pinch zoom
            const t0 = { x: e.touches[0].clientX, y: e.touches[0].clientY };
            const t1 = { x: e.touches[1].clientX, y: e.touches[1].clientY };

            // Orbit from midpoint delta
            const midX = (t0.x + t1.x) / 2;
            const midY = (t0.y + t1.y) / 2;
            const lastMidX = (this._lastTouches[0].x + this._lastTouches[1].x) / 2;
            const lastMidY = (this._lastTouches[0].y + this._lastTouches[1].y) / 2;

            this.azimuth -= (midX - lastMidX) * 0.005;
            this.elevation += (midY - lastMidY) * 0.005;

            // Pinch zoom
            const pinchDist = Math.hypot(t1.x - t0.x, t1.y - t0.y);
            if (this._lastPinchDist > 0) {
                const scaleDelta = this._lastPinchDist / pinchDist;
                this.distance = Math.max(this.minDistance, Math.min(this.maxDistance, this.distance * scaleDelta));
            }
            this._lastPinchDist = pinchDist;

            this._lastTouches = [t0, t1];
            this.updateCamera();
        }
    }

    _onTouchEnd(e) {
        if (e.touches.length === 0) {
            const elapsed = performance.now() - this._clickStartTime;

            if (!this._isDragging && !this._isOrbiting && elapsed < 300) {
                const now = performance.now();
                if (now - this._lastClickTime < 350) {
                    this.onDoubleClick();
                    this._lastClickTime = 0;
                } else {
                    this._lastClickTime = now;
                    const cx = this._clickStartPos.x;
                    const cy = this._clickStartPos.y;
                    setTimeout(() => {
                        if (this._lastClickTime > 0) {
                            this.onBodyClicked(cx, cy);
                        }
                    }, 350);
                }
            }

            this._isDragging = false;
            this._isOrbiting = false;
        } else if (e.touches.length === 1) {
            // Switched from two fingers to one
            this._isOrbiting = false;
            this._isDragging = true;
            this._lastTouches = [{ x: e.touches[0].clientX, y: e.touches[0].clientY }];
        }
    }
}
