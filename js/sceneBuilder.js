// sceneBuilder.js
// Constructs and configures the Three.js scene graph. Creates sphere meshes
// for celestial bodies, orbital path lines, Saturn's ring disc,
// the Sun's multi-layered glow corona, a real starfield from the HYG
// catalogue (with per-vertex B-V colour), and scene lighting.

import * as THREE from 'three';
import { BodyType, planetTextures, moonTextures } from './solarSystemData.js';
import { generateSunTexture, generateGlowTexture } from './textureGenerator.js';
import { orbitPath } from './orbitalMechanics.js';

// Scale constants (matching iOS app)
const DISTANCE_SCALE_BASE = 0.5;       // AU base for log compression
const DISTANCE_SCALE_FACTOR = 15.0;    // multiplier for log compression
const PLANET_SCALE_BASE = 0.00125;     // sqrt(km) * this = scene radius
const MINIMUM_BODY_RADIUS = 0.006;     // smallest visible body

// Moon/satellite distance compression
// Compressed distance = parentSceneR * pow(realRatio, MOON_DIST_EXPONENT) * MOON_DIST_SCALE
// Also used for mission trajectories relative to Earth
export const MOON_DIST_EXPONENT = 0.6;
export const MOON_DIST_SCALE = 1.5;

/**
 * Convert real AU distance to scene units using logarithmic compression.
 */
export function sceneDistance(au) {
    return Math.log(1.0 + au / DISTANCE_SCALE_BASE) * DISTANCE_SCALE_FACTOR;
}

/**
 * Convert real radius in km to scene units.
 * For moons, pass parentRadiusKm to compute proportional to parent planet.
 */
export function sceneRadius(km, type, parentRadiusKm = 0) {
    if (type === BodyType.STAR) return 0.8;
    if (type === BodyType.MOON && parentRadiusKm > 0) {
        // True proportional sizing relative to parent planet
        const parentSceneR = Math.max(0.03, Math.min(0.35, Math.sqrt(parentRadiusKm) * PLANET_SCALE_BASE));
        const realRatio = km / parentRadiusKm;
        return Math.max(MINIMUM_BODY_RADIUS, parentSceneR * realRatio);
    }
    const scaled = Math.sqrt(km) * PLANET_SCALE_BASE;
    if (type === BodyType.MOON) {
        return Math.max(MINIMUM_BODY_RADIUS, scaled);
    }
    return Math.max(0.03, Math.min(0.35, scaled));
}

/**
 * Convert ecliptic (x, y, z) AU to Three.js scene position with log compression.
 */
export function eclipticToScene(pos) {
    const dist = Math.sqrt(pos.x * pos.x + pos.y * pos.y + pos.z * pos.z);
    const sceneDist = sceneDistance(dist);
    const scale = dist > 0 ? sceneDist / dist : 0;
    // Ecliptic to Three.js: x stays x, ecliptic z maps to scene y, ecliptic y flips to -z
    return new THREE.Vector3(
        pos.x * scale,
        pos.z * scale,
        -pos.y * scale
    );
}

export class SceneBuilder {
    constructor() {
        this.namedStars = [];
        this.textureLoader = new THREE.TextureLoader();
    }

    /**
     * Build the root scene with starfield background and lighting.
     */
    buildScene() {
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x000000);

        this.addLighting(scene);

        return scene;
    }

    /**
     * Create a Three.js sphere mesh for a celestial body.
     * For moons, pass parentBody to compute proportional sizing.
     */
    createBodyMesh(body, parentBody = null) {
        const parentRadiusKm = parentBody ? parentBody.physical.radiusKm : 0;
        const radius = sceneRadius(body.physical.radiusKm, body.type, parentRadiusKm);
        const segments = body.type === BodyType.STAR ? 48 : 36;
        const geometry = new THREE.SphereGeometry(Math.max(radius, 0.02), segments, segments);

        let material;

        if (body.physical.emissive) {
            // Sun: procedural texture with constant lighting
            const sunTexture = generateSunTexture();
            material = new THREE.MeshBasicMaterial({
                map: sunTexture
            });
        } else {
            // Planets and moons: PBR
            const [r, g, b] = body.physical.color;
            material = new THREE.MeshStandardMaterial({
                color: new THREE.Color(r, g, b),
                roughness: body.physical.roughness || 0.7,
                metalness: body.physical.metalness || 0.1
            });
        }

        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = body.id;
        mesh.userData.body = body;

        return mesh;
    }

    /**
     * Load and apply a JPEG texture to a body mesh.
     */
    applyTexture(mesh, filename) {
        this.textureLoader.load(`textures/${filename}`, (texture) => {
            texture.colorSpace = THREE.SRGBColorSpace;
            mesh.material.map = texture;
            mesh.material.needsUpdate = true;
        });
    }

    /**
     * Apply all planet and moon textures.
     */
    applyAllTextures(bodyNodes, moonNodes) {
        for (const [id, filename] of Object.entries(planetTextures)) {
            if (bodyNodes[id]) {
                this.applyTexture(bodyNodes[id], filename);
            }
        }
        for (const [id, filename] of Object.entries(moonTextures)) {
            if (moonNodes[id]) {
                this.applyTexture(moonNodes[id], filename);
            }
        }
    }

    /**
     * Build a simplified procedural ISS model and attach to the ISS moon node.
     * Cross-shaped: central truss with 4 pairs of solar panels.
     * Recognisable silhouette at any zoom, zero external files.
     */
    buildISSModel(moonNodes) {
        const issMesh = moonNodes['iss'];
        if (!issMesh) return;

        const s = 0.012; // overall scale in scene units
        const model = new THREE.Group();

        // Central truss (long horizontal bar)
        const trussGeo = new THREE.BoxGeometry(s * 2.4, s * 0.06, s * 0.06);
        const trussMat = new THREE.MeshBasicMaterial({ color: 0xcccccc });
        model.add(new THREE.Mesh(trussGeo, trussMat));

        // Pressurised modules (cross-bar, shorter)
        const moduleGeo = new THREE.BoxGeometry(s * 0.06, s * 0.06, s * 0.8);
        model.add(new THREE.Mesh(moduleGeo, trussMat));

        // Solar panels — 4 pairs along the truss
        const panelGeo = new THREE.PlaneGeometry(s * 0.35, s * 0.9);
        const panelMat = new THREE.MeshBasicMaterial({
            color: 0x1a3a6a,
            side: THREE.DoubleSide
        });

        const panelPositions = [-0.9, -0.35, 0.35, 0.9];
        for (const xOff of panelPositions) {
            const panel = new THREE.Mesh(panelGeo, panelMat);
            panel.position.set(s * xOff, 0, 0);
            panel.rotation.x = Math.PI / 2; // lay flat in orbital plane
            model.add(panel);
        }

        // Radiator panels (smaller, white, perpendicular)
        const radGeo = new THREE.PlaneGeometry(s * 0.15, s * 0.4);
        const radMat = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            side: THREE.DoubleSide
        });
        for (const xOff of [-0.6, 0.6]) {
            const rad = new THREE.Mesh(radGeo, radMat);
            rad.position.set(s * xOff, s * 0.15, 0);
            model.add(rad);
        }

        model.name = 'iss_model';

        // Attach to ISS mesh node and hide the placeholder sphere
        issMesh.add(model);
        issMesh.geometry.dispose();
        issMesh.material.dispose();
        issMesh.geometry = new THREE.BufferGeometry();
        issMesh.material = new THREE.MeshBasicMaterial({ visible: false });
    }

    /**
     * Add Sun corona glow using billboard sprites with additive blending.
     */
    addSunGlow(sunMesh) {
        const radius = sunMesh.geometry.parameters.radius;

        const layers = [
            { scale: 1.3, r: 1.0, g: 0.95, b: 0.7, a: 0.4 },
            { scale: 1.8, r: 1.0, g: 0.8, b: 0.3, a: 0.2 },
            { scale: 2.8, r: 1.0, g: 0.7, b: 0.2, a: 0.08 },
            { scale: 4.0, r: 1.0, g: 0.6, b: 0.15, a: 0.03 }
        ];

        for (const layer of layers) {
            const texture = generateGlowTexture(layer.r, layer.g, layer.b, layer.a);
            const spriteMaterial = new THREE.SpriteMaterial({
                map: texture,
                blending: THREE.AdditiveBlending,
                transparent: true,
                depthWrite: false
            });
            const sprite = new THREE.Sprite(spriteMaterial);
            const size = radius * layer.scale * 2;
            sprite.scale.set(size, size, 1);
            sunMesh.add(sprite);
        }
    }

    /**
     * Build Saturn's ring system as a custom disc geometry with radial UV mapping.
     */
    addRings(planetMesh, body) {
        const planetR = sceneRadius(body.physical.radiusKm, body.type);
        const innerScale = body.physical.ringInnerRadiusKm / body.physical.radiusKm;
        const outerScale = body.physical.ringOuterRadiusKm / body.physical.radiusKm;

        const innerR = planetR * innerScale;
        const outerR = planetR * outerScale;

        const radialSegments = 72;
        const ringSegments = 4;

        const positions = [];
        const normals = [];
        const uvs = [];
        const indices = [];

        for (let ring = 0; ring <= ringSegments; ring++) {
            const t = ring / ringSegments;
            const r = innerR + (outerR - innerR) * t;

            for (let seg = 0; seg <= radialSegments; seg++) {
                const angle = (seg / radialSegments) * 2.0 * Math.PI;
                positions.push(r * Math.cos(angle), 0, r * Math.sin(angle));
                normals.push(0, 1, 0);
                uvs.push(t, seg / radialSegments);
            }
        }

        const vertsPerRing = radialSegments + 1;
        for (let ring = 0; ring < ringSegments; ring++) {
            for (let seg = 0; seg < radialSegments; seg++) {
                const a = ring * vertsPerRing + seg;
                const b = a + 1;
                const c = (ring + 1) * vertsPerRing + seg;
                const d = c + 1;
                indices.push(a, c, b, b, c, d);
            }
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geometry.setIndex(indices);

        // Load ring textures
        const ringMaterial = new THREE.MeshBasicMaterial({
            side: THREE.DoubleSide,
            transparent: true,
            depthWrite: false
        });

        this.textureLoader.load('textures/saturn_ring_color.jpg', (tex) => {
            tex.colorSpace = THREE.SRGBColorSpace;
            ringMaterial.map = tex;
            ringMaterial.needsUpdate = true;
        });

        this.textureLoader.load('textures/saturn_ring_alpha.gif', (tex) => {
            ringMaterial.alphaMap = tex;
            ringMaterial.needsUpdate = true;
        });

        const ringMesh = new THREE.Mesh(geometry, ringMaterial);
        ringMesh.name = 'saturn_rings';
        planetMesh.add(ringMesh);

        return ringMesh;
    }

    /**
     * Create orbital path line geometry.
     */
    createOrbitLine(body, date) {
        if (!body.orbitalElements) return null;

        const pathPoints = orbitPath(body.orbitalElements, date, 180);
        const positions = [];

        for (const point of pathPoints) {
            const scenePos = eclipticToScene(point);
            positions.push(scenePos.x, scenePos.y, scenePos.z);
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

        const material = new THREE.LineBasicMaterial({
            color: 0x737373,
            transparent: true,
            opacity: 0.8
        });

        const line = new THREE.LineLoop(geometry, material);
        line.name = `${body.id}_orbit`;
        return line;
    }

    /**
     * Load the HYG star catalogue and create a point cloud with per-vertex colour
     * and brightness-tiered point sizes.
     */
    async loadStarfield(scene) {
        let csvText;
        try {
            const response = await fetch('textures/stars.csv');
            csvText = await response.text();
        } catch {
            console.warn('Could not load star catalogue');
            return;
        }

        const lines = csvText.split('\n').slice(1); // skip header
        const R = 500.0; // celestial sphere radius

        // Tier definitions: maxMag, pointSize
        const tiers = [
            { maxMag: 1.5, size: 4.0 },
            { maxMag: 3.5, size: 2.5 },
            { maxMag: 5.0, size: 1.5 },
            { maxMag: 6.5, size: 0.8 }
        ];

        const tierPositions = [[], [], [], []];
        const tierColors = [[], [], [], []];

        for (const line of lines) {
            const cols = line.split(',');
            if (cols.length < 4) continue;

            const raHours = parseFloat(cols[0]);
            const decDeg = parseFloat(cols[1]);
            const mag = parseFloat(cols[2]);
            const bv = parseFloat(cols[3]);

            if (isNaN(raHours) || isNaN(decDeg) || isNaN(mag) || isNaN(bv)) continue;

            const ra = raHours * (Math.PI / 12.0);
            const dec = decDeg * (Math.PI / 180.0);

            const cosDec = Math.cos(dec);
            const x = R * cosDec * Math.cos(ra);
            const y = R * Math.sin(dec);
            const z = -R * cosDec * Math.sin(ra);

            const rgb = bvToRGB(bv);

            // Determine tier
            let tier;
            if (mag < 1.5) tier = 0;
            else if (mag < 3.5) tier = 1;
            else if (mag < 5.0) tier = 2;
            else tier = 3;

            tierPositions[tier].push(x, y, z);
            tierColors[tier].push(rgb[0], rgb[1], rgb[2]);

            // Collect named stars for label projection
            if (cols.length >= 5) {
                const name = cols[4].trim();
                if (name && mag < 4.0) {
                    this.namedStars.push({
                        name,
                        position: new THREE.Vector3(x, y, z),
                        magnitude: mag
                    });
                }
            }
        }

        // Create one Points object per tier with different sizes
        for (let t = 0; t < 4; t++) {
            if (tierPositions[t].length === 0) continue;

            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.Float32BufferAttribute(tierPositions[t], 3));
            geometry.setAttribute('color', new THREE.Float32BufferAttribute(tierColors[t], 3));

            const material = new THREE.PointsMaterial({
                size: tiers[t].size,
                sizeAttenuation: false,
                vertexColors: true,
                transparent: true,
                depthWrite: false
            });

            const points = new THREE.Points(geometry, material);
            points.name = `starfield_tier${t}`;
            points.renderOrder = -1;
            scene.add(points);
        }
    }

    /**
     * Add point light at Sun and dim ambient fill.
     */
    addLighting(scene) {
        const sunLight = new THREE.PointLight(
            new THREE.Color(1.0, 0.97, 0.9),
            50,  // intensity (scene is relatively small)
            0,   // distance (0 = no limit)
            1    // decay (physically correct)
        );
        sunLight.position.set(0, 0, 0);
        sunLight.name = 'sun_light';
        scene.add(sunLight);

        const ambient = new THREE.AmbientLight(0x262626, 1.0);
        ambient.name = 'ambient_light';
        scene.add(ambient);
    }

    /**
     * Update a body node's position from ecliptic AU coordinates.
     */
    updateNodePosition(mesh, pos) {
        const scenePos = eclipticToScene(pos);
        mesh.position.copy(scenePos);
    }

    /**
     * Position a moon relative to its parent planet with compressed spacing.
     */
    updateMoonPosition(moonMesh, moonOffset, parentPosition, parentRadiusKm, moonSemiMajorKm) {
        const moonDist = Math.sqrt(
            moonOffset.x * moonOffset.x +
            moonOffset.y * moonOffset.y +
            moonOffset.z * moonOffset.z
        );
        const parentSceneRadius = sceneRadius(parentRadiusKm, BodyType.PLANET);

        const realRatio = moonSemiMajorKm / parentRadiusKm;
        const compressedRatio = Math.pow(realRatio, MOON_DIST_EXPONENT) * MOON_DIST_SCALE;
        const moonSceneDist = moonDist > 0 ? parentSceneRadius * compressedRatio : 0;

        let dirX, dirY, dirZ;
        if (moonDist > 0) {
            dirX = moonOffset.x / moonDist;
            dirY = moonOffset.y / moonDist;
            dirZ = moonOffset.z / moonDist;
        } else {
            dirX = 1; dirY = 0; dirZ = 0;
        }

        const scaledOffX = dirX * moonSceneDist;
        const scaledOffY = dirY * moonSceneDist;
        const scaledOffZ = dirZ * moonSceneDist;

        const parentDist = Math.sqrt(
            parentPosition.x * parentPosition.x +
            parentPosition.y * parentPosition.y +
            parentPosition.z * parentPosition.z
        );
        const parentSceneDist = sceneDistance(parentDist);
        const parentScale = parentDist > 0 ? parentSceneDist / parentDist : 0;

        const parentSceneX = parentPosition.x * parentScale;
        const parentSceneY = parentPosition.y * parentScale;
        const parentSceneZ = parentPosition.z * parentScale;

        const finalX = parentSceneX + scaledOffX;
        const finalY = parentSceneY + scaledOffY;
        const finalZ = parentSceneZ + scaledOffZ;

        // Ecliptic to Three.js
        moonMesh.position.set(finalX, finalZ, -finalY);
    }
}

/**
 * Convert B-V colour index to RGB for star rendering.
 * Piecewise linear approximation of the Planckian locus.
 */
function bvToRGB(bv) {
    bv = Math.max(-0.4, Math.min(2.0, bv));

    let r, g, b;

    if (bv < 0.0) {
        r = 0.7 + bv * 0.3;
        g = 0.8 + bv * 0.2;
        b = 1.0;
    } else if (bv < 0.4) {
        r = 1.0;
        g = 1.0 - bv * 0.3;
        b = 1.0 - bv * 0.8;
    } else if (bv < 0.8) {
        r = 1.0;
        g = 0.95 - (bv - 0.4) * 0.5;
        b = 0.7 - (bv - 0.4) * 0.7;
    } else if (bv < 1.2) {
        r = 1.0;
        g = 0.7 - (bv - 0.8) * 0.4;
        b = 0.4 - (bv - 0.8) * 0.35;
    } else {
        r = 1.0;
        g = Math.max(0.3, 0.55 - (bv - 1.2) * 0.3);
        b = Math.max(0.15, 0.22 - (bv - 1.2) * 0.15);
    }

    return [r, g, b];
}
