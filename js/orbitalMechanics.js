// orbitalMechanics.js
// Core orbital mechanics engine. Converts dates to Julian dates, solves
// Kepler's equation via Newton-Raphson iteration, and computes heliocentric
// ecliptic positions for planets and parent-relative positions for moons.

const DEG_TO_RAD = Math.PI / 180.0;
const J2000 = 2451545.0;

/**
 * Convert a JavaScript Date to Julian Date Number.
 * Algorithm from Meeus, "Astronomical Algorithms" (Chapter 7).
 */
export function julianDate(date) {
    let year = date.getUTCFullYear();
    let month = date.getUTCMonth() + 1;
    const day = date.getUTCDate();
    const hour = date.getUTCHours();
    const minute = date.getUTCMinutes();
    const second = date.getUTCSeconds();

    const dayFraction = (hour + minute / 60.0 + second / 3600.0) / 24.0;

    if (month <= 2) {
        year -= 1;
        month += 12;
    }

    const A = Math.floor(year / 100.0);
    const B = 2.0 - A + Math.floor(A / 4.0);

    return Math.floor(365.25 * (year + 4716.0)) +
           Math.floor(30.6001 * (month + 1.0)) +
           day + dayFraction + B - 1524.5;
}

/**
 * Julian centuries (36525 days each) elapsed since J2000.0.
 */
export function julianCenturies(date) {
    return (julianDate(date) - J2000) / 36525.0;
}

/**
 * Normalise an angle to [0, 2*PI).
 */
function normalizeAngle(angle) {
    let a = angle % (2.0 * Math.PI);
    if (a < 0) a += 2.0 * Math.PI;
    return a;
}

/**
 * Solve Kepler's equation E - e*sin(E) = M via Newton-Raphson.
 */
export function solveKepler(M, e, tolerance = 1e-8) {
    let E = M + e * Math.sin(M);
    for (let i = 0; i < 50; i++) {
        const dE = (E - e * Math.sin(E) - M) / (1.0 - e * Math.cos(E));
        E -= dE;
        if (Math.abs(dE) < tolerance) break;
    }
    return E;
}

/**
 * Convert eccentric anomaly E to true anomaly using the half-angle formula.
 */
export function trueAnomaly(E, e) {
    return 2.0 * Math.atan2(
        Math.sqrt(1.0 + e) * Math.sin(E / 2.0),
        Math.sqrt(1.0 - e) * Math.cos(E / 2.0)
    );
}

/**
 * Compute osculating elements at a given number of Julian centuries since J2000.
 */
function elementsAt(elements, T) {
    const a = elements.a0 + elements.aRate * T;
    const e = elements.e0 + elements.eRate * T;
    const I = (elements.I0 + elements.IRate * T) * DEG_TO_RAD;
    const L = (elements.L0 + elements.LRate * T) * DEG_TO_RAD;
    const wBar = (elements.wBar0 + elements.wBarRate * T) * DEG_TO_RAD;
    const omega = (elements.omega0 + elements.omegaRate * T) * DEG_TO_RAD;

    const meanAnomaly = normalizeAngle(L - wBar);
    const argumentOfPerihelion = normalizeAngle(wBar - omega);

    return { a, e, I, L, wBar, omega, meanAnomaly, argumentOfPerihelion };
}

/**
 * Compute heliocentric ecliptic (x, y, z) position in AU from orbital elements at a date.
 */
export function heliocentricPosition(elements, date) {
    const T = julianCenturies(date);
    const current = elementsAt(elements, T);

    const E = solveKepler(current.meanAnomaly, current.e);
    const nu = trueAnomaly(E, current.e);

    const r = current.a * (1.0 - current.e * Math.cos(E));

    const w = current.argumentOfPerihelion;
    const cosOmega = Math.cos(current.omega);
    const sinOmega = Math.sin(current.omega);
    const cosI = Math.cos(current.I);
    const sinI = Math.sin(current.I);
    const cosWNu = Math.cos(w + nu);
    const sinWNu = Math.sin(w + nu);

    const x = r * (cosOmega * cosWNu - sinOmega * sinWNu * cosI);
    const y = r * (sinOmega * cosWNu + cosOmega * sinWNu * cosI);
    const z = r * (sinWNu * sinI);

    return { x, y, z };
}

/**
 * Compute a moon's position relative to its parent planet.
 * Returns an offset vector in AU from the parent body's centre.
 */
export function moonPosition(moonElements, date) {
    const JD = julianDate(date);
    const daysSinceEpoch = JD - J2000;

    const meanMotion = 2.0 * Math.PI / moonElements.period;
    const M = normalizeAngle(
        moonElements.longitudeAtEpoch * DEG_TO_RAD + meanMotion * daysSinceEpoch
    );

    const e = moonElements.eccentricity;
    const E = solveKepler(M, e);
    const nu = trueAnomaly(E, e);

    const r = moonElements.semiMajorAxisKm * (1.0 - e * Math.cos(E));
    const rAU = r / 149597870.7;

    const incl = moonElements.inclination * DEG_TO_RAD;
    const cosNu = Math.cos(nu);
    const sinNu = Math.sin(nu);

    return {
        x: rAU * cosNu,
        y: rAU * sinNu * Math.cos(incl),
        z: rAU * sinNu * Math.sin(incl)
    };
}

/**
 * Generate evenly-spaced points around a full orbit for drawing orbital path lines.
 */
export function orbitPath(elements, date, points = 360) {
    const T = julianCenturies(date);
    const current = elementsAt(elements, T);
    const w = current.argumentOfPerihelion;

    const cosOmega = Math.cos(current.omega);
    const sinOmega = Math.sin(current.omega);
    const cosI = Math.cos(current.I);
    const sinI = Math.sin(current.I);

    const path = [];
    for (let i = 0; i <= points; i++) {
        const nu = (i / points) * 2.0 * Math.PI;
        const r = current.a * (1.0 - current.e * current.e) / (1.0 + current.e * Math.cos(nu));

        const cosWNu = Math.cos(w + nu);
        const sinWNu = Math.sin(w + nu);

        path.push({
            x: r * (cosOmega * cosWNu - sinOmega * sinWNu * cosI),
            y: r * (sinOmega * cosWNu + cosOmega * sinWNu * cosI),
            z: r * (sinWNu * sinI)
        });
    }

    return path;
}

export { J2000, DEG_TO_RAD };
