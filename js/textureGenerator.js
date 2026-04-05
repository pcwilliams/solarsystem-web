// textureGenerator.js
// Procedural texture generation for the Sun and glow effects.
// Planet textures are bundled NASA/public-domain JPGs loaded by the scene builder;
// only the Sun's surface and corona glow spheres use runtime-generated textures.

import * as THREE from 'three';

/**
 * Generate a procedural Sun surface texture with granulation, supergranulation
 * cells, and radial limb darkening. Produces a 1024x512 equirectangular map.
 */
export function generateSunTexture(size = 1024) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size / 2;
    const ctx = canvas.getContext('2d');

    const width = canvas.width;
    const height = canvas.height;

    // Base bright yellow-white fill
    ctx.fillStyle = 'rgb(255, 235, 166)';
    ctx.fillRect(0, 0, width, height);

    // Small bright/dark granulation spots simulating convection cells
    for (let i = 0; i < 800; i++) {
        const x = Math.random() * width;
        const y = Math.random() * height;
        const s = 3 + Math.random() * 9;
        const brightness = 0.85 + Math.random() * 0.15;
        const r = Math.min(255, Math.floor((brightness + (Math.random() - 0.5) * 0.1) * 255));
        const g = Math.min(255, Math.floor((brightness * 0.92 + (Math.random() - 0.5) * 0.1) * 255));
        const b = Math.max(0, Math.floor((brightness * 0.55 + (Math.random() - 0.5) * 0.2) * 255));

        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.6)`;
        ctx.beginPath();
        ctx.ellipse(x, y, s / 2, s / 2, 0, 0, Math.PI * 2);
        ctx.fill();
    }

    // Larger darker patches simulating supergranulation
    for (let i = 0; i < 40; i++) {
        const x = Math.random() * width;
        const y = Math.random() * height;
        const s = 20 + Math.random() * 40;
        const darkness = 0.7 + Math.random() * 0.15;
        const r = Math.floor(darkness * 255);
        const g = Math.floor(darkness * 0.85 * 255);
        const b = Math.floor(darkness * 0.45 * 255);

        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.3)`;
        ctx.beginPath();
        ctx.ellipse(x, y, s / 2, (s * (0.6 + Math.random() * 0.8)) / 2, 0, 0, Math.PI * 2);
        ctx.fill();
    }

    // Radial limb darkening gradient
    const centerX = width / 2;
    const centerY = height / 2;
    const maxR = Math.max(width, height);
    const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, maxR);
    gradient.addColorStop(0.0, 'rgba(0, 0, 0, 0)');
    gradient.addColorStop(0.6, 'rgba(0, 0, 0, 0)');
    gradient.addColorStop(1.0, 'rgba(204, 128, 38, 0.3)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

/**
 * Generate a radial gradient texture for smooth corona glow falloff on sprites.
 * @param {number} r - Red 0-1
 * @param {number} g - Green 0-1
 * @param {number} b - Blue 0-1
 * @param {number} a - Alpha 0-1
 */
export function generateGlowTexture(r, g, b, a, size = 256) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    const center = size / 2;

    const ri = Math.floor(r * 255);
    const gi = Math.floor(g * 255);
    const bi = Math.floor(b * 255);

    const gradient = ctx.createRadialGradient(center, center, 0, center, center, center);
    gradient.addColorStop(0.0, `rgba(${ri}, ${gi}, ${bi}, ${a})`);
    gradient.addColorStop(0.3, `rgba(${ri}, ${gi}, ${bi}, ${a * 0.5})`);
    gradient.addColorStop(0.65, `rgba(${ri}, ${gi}, ${bi}, ${a * 0.1})`);
    gradient.addColorStop(1.0, `rgba(${ri}, ${gi}, ${bi}, 0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    const texture = new THREE.CanvasTexture(canvas);
    return texture;
}
