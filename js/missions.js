// missions.js
// Space mission trajectories rendered as glowing trails through the solar system.
// Supports multiple vehicles per mission (e.g., SLS rocket, SRBs, Orion capsule)
// with independent trajectories, colours, and time windows.

import * as THREE from 'three';
import { sceneRadius, eclipticToScene, MOON_DIST_EXPONENT, MOON_DIST_SCALE } from './sceneBuilder.js';
import { moonPosition, heliocentricPosition } from './orbitalMechanics.js';
import { earthMoon, BodyType, allPlanets } from './solarSystemData.js';
import { generateGlowTexture } from './textureGenerator.js';

const EARTH_RADIUS_KM = 6371;

// ---------------------------------------------------------------------------
// Mission definitions
// ---------------------------------------------------------------------------
// Waypoints are geocentric in a Moon-aligned frame:
//   X = toward Moon at flyby time
//   Y = perpendicular (in orbital plane)
//   Z = out of ecliptic plane
// Positions in km, time in hours from launch.
//
// Each mission has a `vehicles` array. Each vehicle has its own trajectory,
// colour, and time window. The `primary` vehicle is used for camera tracking.
// ---------------------------------------------------------------------------

const ARTEMIS_2 = {
    id: 'artemis2',
    name: 'Artemis II',
    subtitle: 'Crewed lunar flyby',
    description: 'First crewed mission beyond low-Earth orbit since Apollo 17 (1972). Crew: Reid Wiseman, Victor Glover, Christina Koch, Jeremy Hansen.',
    launchDate: new Date(Date.UTC(2026, 3, 1, 22, 35, 0)), // April 1, 2026 22:35 UTC
    durationHours: 210,  // ~8.75 days, splashdown ~April 10
    flybyTimeHours: 112, // ~April 6 evening EDT

    events: [
        { t: 0,      name: 'Launch',              detail: 'SLS lifts off from LC-39B, Kennedy Space Center', showLabel: false },
        { t: 0.036,  name: 'SRB Separation',      detail: 'Solid rocket boosters jettisoned at 45 km altitude', showLabel: false },
        { t: 0.055,  name: 'LAS Jettison',        detail: 'Launch abort system tower jettisoned', showLabel: false },
        { t: 0.135,  name: 'Core Stage Sep',      detail: 'SLS core stage MECO and separation', showLabel: false },
        { t: 0.82,   name: 'Perigee Raise',       detail: 'ICPS burn raises orbital perigee', showLabel: false },
        { t: 1.8,    name: 'Trans-Lunar Injection', detail: 'ICPS burn sends Orion toward the Moon' },
        { t: 112,    name: 'Lunar Flyby',          detail: 'Closest approach: ~8,900 km above the lunar far side' },
        { t: 210,    name: 'Splashdown',            detail: 'Pacific Ocean recovery off San Diego', showLabel: false },
    ],

    vehicles: [
        // --- SLS full stack (launch to core stage separation) ---
        {
            id: 'sls',
            name: 'SLS',
            color: [1.0, 0.6, 0.3],
            primary: false,
            waypoints: [
                { t: 0,     x: 0,   y: 0,    z: 0  },
                { t: 0.02,  x: 5,   y: 20,   z: 2  },
                { t: 0.036, x: 12,  y: 38,   z: 4  },   // SRB sep, ~45 km
                { t: 0.055, x: 25,  y: 60,   z: 6  },   // LAS jettison
                { t: 0.1,   x: 60,  y: 140,  z: 12 },
                { t: 0.135, x: 90,  y: 190,  z: 16 },   // MECO / core sep
            ]
        },

        // --- SRBs (separate and fall back) ---
        {
            id: 'srbs',
            name: 'SRBs',
            color: [1.0, 0.6, 0.3],
            primary: false,
            waypoints: [
                { t: 0.036, x: 12,   y: 38,   z: 4  },  // separation
                { t: 0.05,  x: 8,    y: 52,   z: 8  },  // coast up briefly
                { t: 0.07,  x: -2,   y: 48,   z: 6  },  // arcing back
                { t: 0.1,   x: -15,  y: 30,   z: 2  },  // falling
                { t: 0.13,  x: -20,  y: 10,   z: 0  },  // splashdown
            ]
        },

        // --- Orion (core sep through splashdown) ---
        {
            id: 'orion',
            name: 'Orion',
            color: [1.0, 0.6, 0.3],
            primary: true,
            waypoints: [
                // Parking orbit & TLI
                { t: 0.135,  x: 90,      y: 190,     z: 5     },  // core sep
                { t: 0.5,    x: 400,     y: 1200,    z: 20    },  // parking orbit
                { t: 0.82,   x: 800,     y: 2000,    z: 30    },  // perigee raise
                { t: 1.8,    x: 3000,    y: 3500,    z: 80    },  // TLI burn
                // Trans-lunar coast — Z kept small (trajectory is near ecliptic plane)
                { t: 6,      x: 22000,   y: 13000,   z: 200   },
                { t: 12,     x: 55000,   y: 26000,   z: 350   },
                { t: 24,     x: 110000,  y: 44000,   z: 500   },
                { t: 36,     x: 165000,  y: 53000,   z: 600   },
                { t: 48,     x: 220000,  y: 55000,   z: 650   },
                { t: 60,     x: 272000,  y: 50000,   z: 600   },
                { t: 72,     x: 318000,  y: 40000,   z: 500   },
                { t: 84,     x: 356000,  y: 26000,   z: 400   },
                { t: 96,     x: 380000,  y: 12000,   z: 300   },
                // Lunar flyby — near-real distances; pow(0.6) preserves enough separation
                { t: 104,    x: 390000,  y: 5000,    z: 150   },  // approaching far side
                { t: 108,    x: 396000,  y: -5000,   z: 50    },  // behind Moon (periapsis)
                { t: 112,    x: 398000,  y: -18000,  z: 0     },  // closest approach (~8,900 km past Moon)
                { t: 116,    x: 393000,  y: -30000,  z: -50   },  // departing
                { t: 122,    x: 405000,  y: -45000,  z: -100  },  // heading home
                // Return coast — mirror the approach speed profile
                { t: 132,    x: 370000,  y: -62000,  z: -200  },
                { t: 144,    x: 320000,  y: -78000,  z: -300  },
                { t: 156,    x: 255000,  y: -85000,  z: -350  },
                { t: 168,    x: 175000,  y: -80000,  z: -300  },
                { t: 180,    x: 100000,  y: -65000,  z: -200  },
                { t: 190,    x: 45000,   y: -42000,  z: -100  },
                { t: 198,    x: 15000,   y: -22000,  z: -40   },
                { t: 206,    x: 2500,    y: -5000,   z: -10   },
                // Entry & splashdown
                { t: 209,    x: 300,     y: -800,    z: 3     },
                { t: 210,    x: 0,       y: 0,       z: 0     },
            ]
        }
    ]
};

// ---------------------------------------------------------------------------
// Apollo 11 — First crewed lunar landing (July 16–24, 1969)
// ---------------------------------------------------------------------------

const APOLLO_11 = {
    id: 'apollo11',
    name: 'Apollo 11',
    subtitle: 'First Moon landing',
    description: 'First crewed lunar landing. Crew: Neil Armstrong, Buzz Aldrin, Michael Collins.',
    launchDate: new Date(Date.UTC(1969, 6, 16, 13, 32, 0)),
    durationHours: 195,
    flybyTimeHours: 76,

    events: [
        { t: 0,      name: 'Launch',         detail: 'Saturn V lifts off from LC-39A', showLabel: false },
        { t: 2.83,   name: 'TLI',            detail: 'S-IVB trans-lunar injection burn', showLabel: false },
        { t: 75.8,   name: 'LOI',            detail: 'Lunar orbit insertion — SPS retrograde burn' },
        { t: 100.2,  name: 'LM Undock',      detail: 'Eagle separates from Columbia' },
        { t: 102.75, name: 'Eagle Landing',   detail: 'Sea of Tranquility — "The Eagle has landed"' },
        { t: 109.4,  name: 'First Step',      detail: '"One small step for man..."' },
        { t: 124.3,  name: 'LM Ascent',       detail: 'Eagle ascent stage lifts off from Moon' },
        { t: 135.6,  name: 'TEI',             detail: 'Trans-Earth injection — heading home' },
        { t: 195.3,  name: 'Splashdown',      detail: 'Pacific Ocean recovery by USS Hornet', showLabel: false },
    ],

    vehicles: [
        {
            id: 'saturn_v',
            name: 'Saturn V',
            color: [1.0, 0.6, 0.3],
            primary: false,
            waypoints: [
                { t: 0,    x: 0,   y: 0,   z: 0 },
                { t: 0.05, x: 60,  y: 150, z: 10 },
            ]
        },
        {
            id: 'csm_columbia',
            name: 'Columbia',
            color: [1.0, 0.6, 0.3],
            primary: true,
            // Columbia orbits the Moon between LOI and TEI
            moonOrbit: { startTime: 75.8, endTime: 135.6, periodHours: 4.0, radiusKm: 25000 },
            waypoints: [
                // TLI and trans-lunar coast — Z kept small (near ecliptic)
                { t: 0.05,  x: 60,      y: 150,     z: 5     },
                { t: 2.83,  x: 3000,    y: 3200,    z: 80    },
                { t: 8,     x: 25000,   y: 15000,   z: 200   },
                { t: 20,    x: 80000,   y: 38000,   z: 400   },
                { t: 36,    x: 160000,  y: 52000,   z: 500   },
                { t: 52,    x: 250000,  y: 50000,   z: 400   },
                { t: 68,    x: 340000,  y: 30000,   z: 300   },
                // Lunar orbit — marker computed at runtime, waypoints define trajectory line
                { t: 75.8,  x: 0, y: 0, z: 0, anchorMoon: true },   // LOI — snaps to Moon
                { t: 135.6, x: 0, y: 0, z: 0, anchorMoon: true },   // TEI — snaps to Moon
                // Return — departs from Moon's position, curves back to Earth
                { t: 140,   x: 0, y: 0, z: 0, anchorMoon: true },
                { t: 150,   x: 280000,  y: 50000,   z: -150  },
                { t: 168,   x: 170000,  y: 62000,   z: -250  },
                { t: 178,   x: 85000,   y: 48000,   z: -150  },
                { t: 188,   x: 25000,   y: 20000,   z: -50   },
                { t: 195,   x: 0,       y: 0,       z: 0     },
            ]
        },
        {
            id: 'lm_eagle',
            name: 'Eagle',
            color: [0.9, 0.8, 0.4],
            primary: false,
            // Eagle orbits with Columbia, descends to Moon surface, then ascends back
            moonOrbit: { startTime: 100.2, endTime: 102.75, periodHours: 4.0, radiusKm: 25000 },
            moonLanding: { startTime: 102.75, endTime: 124.3 },
            // moonOrbit also covers ascent back to orbit after landing
            moonOrbitReturn: { startTime: 124.3, endTime: 126.5, periodHours: 4.0, radiusKm: 25000 },
            waypoints: [
                { t: 100.2,  x: 390000,  y: 0,       z: 0     },
                { t: 126.5,  x: 390000,  y: 0,       z: 0     },
            ]
        }
    ]
};

// ---------------------------------------------------------------------------
// Apollo 13 — "Successful failure" free-return (April 11–17, 1970)
// ---------------------------------------------------------------------------

const APOLLO_13 = {
    id: 'apollo13',
    name: 'Apollo 13',
    subtitle: 'Successful failure',
    description: 'Aborted lunar landing after O2 tank explosion. Free-return trajectory around the Moon. Crew: Jim Lovell, Jack Swigert, Fred Haise.',
    launchDate: new Date(Date.UTC(1970, 3, 11, 19, 13, 0)),
    durationHours: 143,
    flybyTimeHours: 77,

    events: [
        { t: 0,     name: 'Launch',           detail: 'Saturn V lifts off from LC-39A', showLabel: false },
        { t: 2.6,   name: 'TLI',              detail: 'S-IVB trans-lunar injection burn', showLabel: false },
        { t: 55.9,  name: 'O\u2082 Tank Explosion', detail: '"Houston, we\'ve had a problem" — 320,000 km from Earth' },
        { t: 77,    name: 'Lunar Flyby',       detail: 'Free-return trajectory — closest approach to Moon' },
        { t: 79.3,  name: 'PC+2 Burn',         detail: 'LM engine burn to speed up return' },
        { t: 142.9, name: 'Splashdown',         detail: 'Pacific Ocean recovery by USS Iwo Jima', showLabel: false },
    ],

    vehicles: [
        {
            id: 'saturn_v_13',
            name: 'Saturn V',
            color: [1.0, 0.6, 0.3],
            primary: false,
            waypoints: [
                { t: 0,    x: 0,   y: 0,   z: 0 },
                { t: 0.05, x: 60,  y: 150, z: 10 },
            ]
        },
        {
            id: 'odyssey_aquarius',
            name: 'Odyssey',
            color: [1.0, 0.6, 0.3],
            primary: true,
            waypoints: [
                { t: 0.05,  x: 60,      y: 150,     z: 10    },
                { t: 2.6,   x: 2800,    y: 3000,    z: 180   },
                { t: 8,     x: 22000,   y: 14000,   z: 700   },
                { t: 20,    x: 75000,   y: 36000,   z: 2000  },
                { t: 36,    x: 155000,  y: 50000,   z: 3000  },
                { t: 48,    x: 220000,  y: 52000,   z: 3500  },
                { t: 55.9,  x: 280000,  y: 42000,   z: 3800  },  // explosion
                { t: 64,    x: 340000,  y: 28000,   z: 4100  },
                { t: 72,    x: 378000,  y: 12000,   z: 4400  },
                // Flyby
                { t: 77,    x: 420000,  y: -8000,   z: 4500  },
                { t: 79.3,  x: 425000,  y: -20000,  z: 4450  },  // PC+2
                { t: 84,    x: 400000,  y: -45000,  z: 4200  },
                // Return
                { t: 96,    x: 320000,  y: -85000,  z: 3500  },
                { t: 110,   x: 210000,  y: -95000,  z: 2500  },
                { t: 122,   x: 110000,  y: -78000,  z: 1500  },
                { t: 134,   x: 35000,   y: -40000,  z: 500   },
                { t: 141,   x: 5000,    y: -8000,   z: 50    },
                { t: 143,   x: 0,       y: 0,       z: 0     },
            ]
        }
    ]
};

// ---------------------------------------------------------------------------
// Cassini-Huygens — VVEJGA to Saturn (Oct 1997 – Jul 2004)
// ---------------------------------------------------------------------------

const CASSINI = {
    id: 'cassini',
    name: 'Cassini-Huygens',
    subtitle: 'Saturn orbiter',
    description: 'Interplanetary mission to Saturn via Venus-Venus-Earth-Jupiter gravity assists. Carried the Huygens probe to Titan.',
    launchDate: new Date(Date.UTC(1997, 9, 15, 8, 43, 0)),
    durationHours: 59064,  // ~6.7 years to Saturn orbit insertion
    referenceFrame: 'heliocentric',

    events: [
        { t: 0,      name: 'Launch',        detail: 'Titan IV-B/Centaur from Cape Canaveral', showLabel: false },
        { t: 4608,   name: 'Venus Flyby 1',  detail: 'First Venus gravity assist — 284 km altitude' },
        { t: 12888,  name: 'Venus Flyby 2',  detail: 'Second Venus gravity assist — 623 km' },
        { t: 15528,  name: 'Earth Flyby',     detail: 'Earth gravity assist — 1,171 km altitude' },
        { t: 25560,  name: 'Jupiter Flyby',   detail: 'Jupiter gravity assist — 9.7M km' },
        { t: 59064,  name: 'Saturn Arrival',  detail: 'Saturn orbit insertion — SOI burn' },
    ],

    vehicles: [{
        id: 'cassini',
        name: 'Cassini',
        color: [1.0, 0.6, 0.3],
        primary: true,
        waypoints: [
            { t: 0,     x: 0, y: 0, z: 0, anchorBody: 'earth' },
            { t: 1440,  x: 0.52,  y: 0.62,  z: 0 },
            { t: 2880,  x: -0.10, y: 0.78,  z: 0 },
            { t: 4608,  x: 0, y: 0, z: 0, anchorBody: 'venus' },    // Venus 1
            { t: 6000,  x: -0.85, y: 0.15,  z: 0 },
            { t: 7500,  x: -0.75, y: -0.45, z: 0 },
            { t: 9000,  x: -0.20, y: -0.80, z: 0 },
            { t: 10500, x: 0.40,  y: -0.65, z: 0 },
            { t: 11500, x: 0.55,  y: -0.35, z: 0 },
            { t: 12888, x: 0, y: 0, z: 0, anchorBody: 'venus' },    // Venus 2
            { t: 14208, x: 0.65,  y: -0.02, z: 0 },
            { t: 15528, x: 0, y: 0, z: 0, anchorBody: 'earth' },    // Earth flyby
            { t: 18000, x: 1.50,  y: -1.20, z: 0 },
            { t: 21000, x: 2.50,  y: -2.30, z: 0 },
            { t: 24000, x: 3.80,  y: -3.50, z: 0 },
            { t: 25560, x: 0, y: 0, z: 0, anchorBody: 'jupiter' },  // Jupiter flyby
            { t: 30000, x: 5.00,  y: -1.50, z: 0 },
            { t: 36000, x: 6.20,  y: 1.00,  z: 0 },
            { t: 42000, x: 7.50,  y: 3.50,  z: 0 },
            { t: 48000, x: 8.20,  y: 4.80,  z: 0 },
            { t: 53000, x: 8.60,  y: 5.30,  z: 0 },
            { t: 59064, x: 0, y: 0, z: 0, anchorBody: 'saturn' },   // Saturn arrival
        ]
    }]
};

// ---------------------------------------------------------------------------
// Voyager 1 — Jupiter/Saturn flybys (Sep 1977 – Nov 1980)
// ---------------------------------------------------------------------------

const VOYAGER_1 = {
    id: 'voyager1',
    name: 'Voyager 1',
    subtitle: 'Grand tour',
    description: 'Interplanetary mission with Jupiter and Saturn gravity assists. Now the most distant human-made object.',
    launchDate: new Date(Date.UTC(1977, 8, 5, 12, 56, 0)),
    durationHours: 28200,  // ~3.2 years to Saturn flyby
    referenceFrame: 'heliocentric',

    events: [
        { t: 0,      name: 'Launch',         detail: 'Titan IIIE/Centaur from Cape Canaveral', showLabel: false },
        { t: 13104,  name: 'Jupiter Flyby',   detail: 'Closest approach 348,890 km from Jupiter centre' },
        { t: 27720,  name: 'Saturn Flyby',    detail: 'Closest approach 184,300 km from Saturn centre' },
    ],

    vehicles: [{
        id: 'voyager1',
        name: 'Voyager 1',
        color: [1.0, 0.6, 0.3],
        primary: true,
        waypoints: [
            // ~15 km/s cruise, consistent speed
            { t: 0,     x: 0, y: 0, z: 0, anchorBody: 'earth' },
            { t: 2000,  x: 1.15,  y: -0.75, z: 0 },
            { t: 4000,  x: 1.80,  y: -1.45, z: 0 },
            { t: 6000,  x: 2.40,  y: -2.10, z: 0 },
            { t: 8000,  x: 3.00,  y: -2.65, z: 0 },
            { t: 10000, x: 3.55,  y: -3.15, z: 0 },
            { t: 12000, x: 4.10,  y: -3.55, z: 0 },
            { t: 13104, x: 0, y: 0, z: 0, anchorBody: 'jupiter' },  // Jupiter flyby
            { t: 14500, x: 5.00,  y: -3.10, z: 0.05 },
            { t: 17000, x: 5.50,  y: -2.20, z: 0.10 },
            { t: 20000, x: 6.10,  y: -1.10, z: 0.15 },
            { t: 23000, x: 6.80,  y: 0.20,  z: 0.20 },
            { t: 26000, x: 7.50,  y: 1.60,  z: 0.25 },
            { t: 28200, x: 0, y: 0, z: 0, anchorBody: 'saturn' },   // Saturn flyby
        ]
    }]
};

// ---------------------------------------------------------------------------
// BepiColombo — Mercury orbiter (Oct 2018 – Nov 2026)
// ---------------------------------------------------------------------------

const BEPICOLOMBO = {
    id: 'bepicolombo',
    name: 'BepiColombo',
    subtitle: 'Mercury orbiter',
    description: 'ESA/JAXA mission spiralling inward to Mercury via Earth, Venus, and Mercury gravity assists.',
    launchDate: new Date(Date.UTC(2018, 9, 20, 1, 45, 0)),
    durationHours: 70800,  // ~8 years to Mercury orbit insertion
    referenceFrame: 'heliocentric',

    events: [
        { t: 0,      name: 'Launch',          detail: 'Ariane 5 from Kourou, French Guiana', showLabel: false },
        { t: 12240,  name: 'Earth Flyby',      detail: 'Earth gravity assist' },
        { t: 16800,  name: 'Venus Flyby 1',    detail: 'First Venus gravity assist — 10,720 km' },
        { t: 24000,  name: 'Venus Flyby 2',    detail: 'Second Venus gravity assist — 552 km' },
        { t: 26040,  name: 'Mercury Flyby 1',   detail: 'First Mercury flyby — 200 km' },
        { t: 44000,  name: 'Mercury Flyby 6',   detail: 'Sixth and final Mercury flyby' },
        { t: 70800,  name: 'Mercury Orbit',     detail: 'Mercury orbit insertion' },
    ],

    vehicles: [{
        id: 'bepicolombo',
        name: 'BepiColombo',
        color: [1.0, 0.6, 0.3],
        primary: true,
        waypoints: [
            { t: 0,     x: 0, y: 0, z: 0, anchorBody: 'earth' },
            { t: 2400,  x: 0.30,  y: 0.85,  z: 0 },
            { t: 4800,  x: -0.50, y: 0.80,  z: 0 },
            { t: 7200,  x: -0.90, y: 0.10,  z: 0 },
            { t: 9600,  x: -0.45, y: -0.60, z: 0 },
            { t: 12240, x: 0, y: 0, z: 0, anchorBody: 'earth' },    // Earth flyby
            { t: 14400, x: 0.65,  y: -0.30, z: 0 },
            { t: 16800, x: 0, y: 0, z: 0, anchorBody: 'venus' },    // Venus 1
            { t: 20400, x: -0.55, y: -0.45, z: 0 },
            { t: 24000, x: 0, y: 0, z: 0, anchorBody: 'venus' },    // Venus 2
            { t: 25200, x: 0.35,  y: -0.15, z: 0 },
            { t: 26040, x: 0, y: 0, z: 0, anchorBody: 'mercury' },  // Mercury 1
            { t: 30000, x: -0.30, y: -0.25, z: 0.02 },
            { t: 34000, x: 0.32,  y: 0.20,  z: 0.03 },
            { t: 38000, x: -0.25, y: 0.30,  z: 0.02 },
            { t: 42000, x: 0.20,  y: -0.32, z: 0.03 },
            { t: 44000, x: -0.28, y: -0.28, z: 0.02 }, // Mercury 6
            { t: 50000, x: 0.15,  y: 0.35,  z: 0.02 },
            { t: 56000, x: -0.20, y: 0.33,  z: 0.03 },
            { t: 62000, x: 0.30,  y: -0.18, z: 0.05 },
            { t: 70800, x: 0.35,  y: 0.15,  z: 0.06 }, // Mercury orbit insertion
        ]
    }]
};

// ---------------------------------------------------------------------------
// Apollo 8 — First crewed lunar orbit (Dec 21–27, 1968)
// ---------------------------------------------------------------------------

const APOLLO_8 = {
    id: 'apollo8',
    name: 'Apollo 8',
    subtitle: 'First lunar orbit',
    description: 'First crewed spacecraft to orbit the Moon. Famous "Earthrise" photograph. Crew: Frank Borman, Jim Lovell, William Anders.',
    launchDate: new Date(Date.UTC(1968, 11, 21, 12, 51, 0)),
    durationHours: 147,
    flybyTimeHours: 69,

    events: [
        { t: 0,    name: 'Launch',    detail: 'Saturn V from LC-39A', showLabel: false },
        { t: 2.8,  name: 'TLI',       detail: 'S-IVB trans-lunar injection', showLabel: false },
        { t: 69,   name: 'LOI',       detail: 'Lunar orbit insertion — first humans to orbit the Moon' },
        { t: 89,   name: 'TEI',       detail: 'Trans-Earth injection — heading home' },
        { t: 147,  name: 'Splashdown', detail: 'Pacific Ocean recovery', showLabel: false },
    ],

    vehicles: [{
        id: 'apollo8_csm',
        name: 'Apollo 8',
        color: [1.0, 0.6, 0.3],
        primary: true,
        waypoints: [
            { t: 0,    x: 0,       y: 0,       z: 0 },
            { t: 2.8,  x: 2500,    y: 3000,    z: 180 },
            { t: 8,    x: 20000,   y: 14000,   z: 700 },
            { t: 20,   x: 75000,   y: 36000,   z: 2000 },
            { t: 36,   x: 160000,  y: 52000,   z: 3200 },
            { t: 52,   x: 260000,  y: 48000,   z: 3800 },
            { t: 64,   x: 350000,  y: 28000,   z: 4200 },
            { t: 69,   x: 400000,  y: 8000,    z: 4400 },
            { t: 78,   x: 425000,  y: -15000,  z: 4400 },
            { t: 85,   x: 420000,  y: -10000,  z: 4350 },
            { t: 89,   x: 400000,  y: 5000,    z: 4300 },
            { t: 102,  x: 300000,  y: 55000,   z: 3500 },
            { t: 118,  x: 175000,  y: 68000,   z: 2200 },
            { t: 132,  x: 70000,   y: 50000,   z: 1000 },
            { t: 143,  x: 12000,   y: 15000,   z: 200 },
            { t: 147,  x: 0,       y: 0,       z: 0 },
        ]
    }]
};

// ---------------------------------------------------------------------------
// Voyager 2 — Grand Tour: Jupiter, Saturn, Uranus, Neptune (1977–1989)
// ---------------------------------------------------------------------------

const VOYAGER_2 = {
    id: 'voyager2',
    name: 'Voyager 2',
    subtitle: 'Grand Tour',
    description: 'Only spacecraft to visit all four gas giants. Flew past Jupiter, Saturn, Uranus, and Neptune.',
    launchDate: new Date(Date.UTC(1977, 7, 20, 14, 29, 0)),
    durationHours: 105000,
    referenceFrame: 'heliocentric',

    events: [
        { t: 0,      name: 'Launch',          detail: 'Titan IIIE/Centaur from Cape Canaveral', showLabel: false },
        { t: 16800,  name: 'Jupiter Flyby',    detail: 'Closest approach Jul 9, 1979' },
        { t: 35400,  name: 'Saturn Flyby',     detail: 'Closest approach Aug 26, 1981' },
        { t: 74000,  name: 'Uranus Flyby',     detail: 'Closest approach Jan 24, 1986 — first visit' },
        { t: 105000, name: 'Neptune Flyby',    detail: 'Closest approach Aug 25, 1989 — first visit' },
    ],

    vehicles: [{
        id: 'voyager2',
        name: 'Voyager 2',
        color: [1.0, 0.6, 0.3],
        primary: true,
        waypoints: [
            // ~14 km/s average, consistent speed with slight boost at each flyby
            { t: 0,      x: 0, y: 0, z: 0, anchorBody: 'earth' },
            { t: 2500,   x: 1.30,  y: -1.10,  z: 0 },
            { t: 5000,   x: 1.90,  y: -2.00,  z: 0 },
            { t: 8000,   x: 2.40,  y: -2.90,  z: 0.01 },
            { t: 11000,  x: 2.85,  y: -3.70,  z: 0.02 },
            { t: 14000,  x: 3.25,  y: -4.40,  z: 0.03 },
            { t: 16800,  x: 0, y: 0, z: 0, anchorBody: 'jupiter' },  // Jupiter
            { t: 19000,  x: 4.00,  y: -5.40,  z: 0.04 },
            { t: 23000,  x: 5.00,  y: -6.20,  z: 0.07 },
            { t: 27000,  x: 6.10,  y: -6.80,  z: 0.10 },
            { t: 31000,  x: 7.20,  y: -7.20,  z: 0.14 },
            { t: 35400,  x: 0, y: 0, z: 0, anchorBody: 'saturn' },   // Saturn
            { t: 39000,  x: 9.00,  y: -7.00,  z: -0.20 },
            { t: 46000,  x: 10.80, y: -6.00,  z: -0.80 },
            { t: 54000,  x: 12.80, y: -4.80,  z: -1.80 },
            { t: 62000,  x: 14.80, y: -3.30,  z: -3.00 },
            { t: 70000,  x: 16.50, y: -1.80,  z: -4.20 },
            { t: 74000,  x: 0, y: 0, z: 0, anchorBody: 'uranus' },   // Uranus
            { t: 78000,  x: 18.50, y: -0.20,  z: -5.50 },
            { t: 86000,  x: 20.50, y: 2.00,   z: -7.00 },
            { t: 94000,  x: 23.00, y: 4.50,   z: -8.50 },
            { t: 101000, x: 25.50, y: 7.00,   z: -10.00 },
            { t: 105000, x: 0, y: 0, z: 0, anchorBody: 'neptune' },  // Neptune
        ]
    }]
};

// ---------------------------------------------------------------------------
// Perseverance — Mars rover (Jul 2020 – Feb 2021)
// ---------------------------------------------------------------------------

const PERSEVERANCE = {
    id: 'perseverance',
    name: 'Perseverance',
    subtitle: 'Mars rover',
    description: 'Mars 2020 rover with Ingenuity helicopter. Landed in Jezero Crater, Feb 18, 2021.',
    launchDate: new Date(Date.UTC(2020, 6, 30, 11, 50, 0)),
    durationHours: 4920,
    referenceFrame: 'heliocentric',

    events: [
        { t: 0,    name: 'Launch',        detail: 'Atlas V from Cape Canaveral', showLabel: false },
        { t: 4920, name: 'Mars Landing',   detail: 'Jezero Crater — "Percy" and Ingenuity' },
    ],

    vehicles: [{
        id: 'perseverance',
        name: 'Perseverance',
        color: [1.0, 0.6, 0.3],
        primary: true,
        autoTrajectory: 'transfer',
        waypoints: [
            { t: 0,    x: 0, y: 0, z: 0, anchorBody: 'earth' },
            { t: 4920, x: 0, y: 0, z: 0, anchorBody: 'mars' },
        ]
    }]
};

// ---------------------------------------------------------------------------
// New Horizons — Pluto flyby (Jan 2006 – Jul 2015)
// ---------------------------------------------------------------------------

const NEW_HORIZONS = {
    id: 'newhorizons',
    name: 'New Horizons',
    subtitle: 'Pluto flyby',
    description: 'Fastest spacecraft ever launched. Jupiter gravity assist to Pluto. First close-up images of Pluto and Charon.',
    launchDate: new Date(Date.UTC(2006, 0, 19, 19, 0, 0)),
    durationHours: 83000,
    referenceFrame: 'heliocentric',

    events: [
        { t: 0,     name: 'Launch',          detail: 'Atlas V from Cape Canaveral — fastest launch ever', showLabel: false },
        { t: 9720,  name: 'Jupiter Flyby',    detail: 'Gravity assist — closest approach 2.3M km' },
        { t: 83000, name: 'Pluto Flyby',      detail: 'Closest approach 12,500 km — Jul 14, 2015' },
    ],

    vehicles: [{
        id: 'newhorizons',
        name: 'New Horizons',
        color: [1.0, 0.6, 0.3],
        primary: true,
        waypoints: [
            { t: 0,     x: 0, y: 0, z: 0, anchorBody: 'earth' },
            { t: 1500,  x: -1.20, y: 1.60,  z: 0 },
            { t: 3000,  x: -2.00, y: 2.40,  z: 0.01 },
            { t: 5000,  x: -2.90, y: 3.40,  z: 0.02 },
            { t: 7000,  x: -3.60, y: 4.20,  z: 0.03 },
            { t: 8500,  x: -4.20, y: 4.80,  z: 0.04 },
            { t: 9720,  x: 0, y: 0, z: 0, anchorBody: 'jupiter' },  // Jupiter
            { t: 11000, x: -5.20, y: 6.00,  z: 0.06 },
            { t: 15000, x: -6.50, y: 7.50,  z: 0.10 },
            { t: 22000, x: -9.00, y: 10.50, z: 0.18 },
            { t: 30000, x: -11.50,y: 13.50, z: 0.25 },
            { t: 40000, x: -14.50,y: 17.00, z: 0.35 },
            { t: 50000, x: -17.50,y: 20.50, z: 0.45 },
            { t: 60000, x: -20.50,y: 23.50, z: 0.55 },
            { t: 72000, x: -24.00,y: 27.00, z: 0.65 },
            { t: 78000, x: -26.00,y: 29.00, z: 0.70 },
            { t: 83000, x: 0, y: 0, z: 0, anchorBody: 'pluto' },    // Pluto
        ]
    }]
};

// ---------------------------------------------------------------------------
// Parker Solar Probe — closest to Sun (Aug 2018 – 2025)
// ---------------------------------------------------------------------------

const PARKER = {
    id: 'parker',
    name: 'Parker Solar Probe',
    subtitle: 'Closest to Sun',
    description: 'Closest-ever approach to the Sun (0.046 AU). Spiralling orbit with Venus gravity assists.',
    launchDate: new Date(Date.UTC(2018, 7, 12, 7, 31, 0)),
    durationHours: 58000,
    referenceFrame: 'heliocentric',

    events: [
        { t: 0,     name: 'Launch',       detail: 'Delta IV Heavy from Cape Canaveral', showLabel: false },
        { t: 1250,  name: 'Venus Flyby 1', detail: 'First Venus gravity assist' },
        { t: 2100,  name: 'Perihelion 1',  detail: 'First solar approach — 0.17 AU' },
        { t: 55000, name: 'Perihelion 22', detail: 'Record closest approach — 0.046 AU from Sun' },
    ],

    vehicles: [{
        id: 'parker',
        name: 'Parker',
        color: [1.0, 0.6, 0.3],
        primary: true,
        waypoints: [
            { t: 0,     x: 0, y: 0, z: 0, anchorBody: 'earth' },
            { t: 600,   x: 0.60,  y: -0.55, z: 0 },
            { t: 1250,  x: 0, y: 0, z: 0, anchorBody: 'venus' },    // Venus 1
            { t: 1700,  x: 0.25,  y: -0.30, z: 0 },
            { t: 2100,  x: 0.10,  y: -0.14, z: 0 },     // Perihelion 1
            { t: 2800,  x: 0.40,  y: 0.20,  z: 0 },
            { t: 4000,  x: 0.65,  y: 0.30,  z: 0 },
            { t: 5500,  x: 0.35,  y: 0.45,  z: 0 },
            { t: 6500,  x: 0.05,  y: 0.15,  z: 0 },     // Perihelion 2
            { t: 8000,  x: 0.50,  y: -0.35, z: 0 },
            { t: 12000, x: -0.10, y: -0.13, z: 0 },     // Perihelion
            { t: 18000, x: 0.45,  y: 0.40,  z: 0 },
            { t: 22000, x: -0.08, y: 0.10,  z: 0 },     // Perihelion
            { t: 30000, x: 0.35,  y: -0.30, z: 0 },
            { t: 35000, x: 0.06,  y: -0.08, z: 0 },     // Perihelion
            { t: 42000, x: -0.30, y: 0.35,  z: 0 },
            { t: 48000, x: -0.04, y: 0.04,  z: 0 },     // Perihelion (~0.06 AU)
            { t: 52000, x: 0.25,  y: -0.25, z: 0 },
            { t: 55000, x: 0.03,  y: -0.03, z: 0 },     // Record perihelion 0.046 AU
            { t: 58000, x: -0.20, y: 0.30,  z: 0 },
        ]
    }]
};

const ALL_MISSIONS = [ARTEMIS_2, APOLLO_8, APOLLO_11, APOLLO_13, CASSINI, VOYAGER_1, VOYAGER_2, PERSEVERANCE, NEW_HORIZONS, PARKER, BEPICOLOMBO];

// ---------------------------------------------------------------------------
// MissionManager
// ---------------------------------------------------------------------------

export class MissionManager {
    constructor(scene) {
        this.scene = scene;
        this.missions = ALL_MISSIONS;
        this.visible = true;
        this.selectedMissionId = null; // only this mission's trajectory is shown
        this._groups = new Map();      // mission.id -> THREE.Group
        this._vehicleData = new Map(); // `${mission.id}/${vehicle.id}` -> { rotatedWaypoints, marker }
        this._eventPositions = new Map(); // mission.id -> THREE.Vector3[]
        this._lastTriggeredEvent = new Map(); // mission.id -> index of last triggered event
    }

    /** Build all mission scene objects. Call once after scene is ready. */
    initialize() {
        for (const mission of this.missions) {
            this._buildMission(mission);
        }
    }

    // --- Scene construction --------------------------------------------------

    _buildMission(mission) {
        const group = new THREE.Group();
        group.name = `mission_${mission.id}`;
        this.scene.add(group);
        this._groups.set(mission.id, group);

        const isHelio = mission.referenceFrame === 'heliocentric';

        // Resolve anchor waypoints — snap to actual planet positions
        if (isHelio) {
            for (const vehicle of mission.vehicles) {
                // First pass: resolve anchors
                for (const wp of vehicle.waypoints) {
                    if (!wp.anchorBody) continue;
                    const planet = allPlanets.find(p => p.id === wp.anchorBody);
                    if (planet && planet.orbitalElements) {
                        const date = new Date(mission.launchDate.getTime() + wp.t * 3600000);
                        const pos = heliocentricPosition(planet.orbitalElements, date);
                        wp.x = pos.x;
                        wp.y = pos.y;
                        wp.z = pos.z;
                    }
                }

                // Second pass: auto-generate transfer arcs between anchors
                if (vehicle.autoTrajectory === 'transfer') {
                    vehicle.waypoints = this._generateTransferArc(vehicle.waypoints, mission.launchDate);
                }
            }
        }

        // For geocentric missions, compute Moon direction at flyby time
        let cosA = 1, sinA = 0;
        if (!isHelio && mission.flybyTimeHours) {
            const flybyDate = new Date(mission.launchDate.getTime() + mission.flybyTimeHours * 3600000);
            const moonPos = moonPosition(earthMoon.moonElements, flybyDate);
            const moonAngle = Math.atan2(moonPos.y, moonPos.x);
            cosA = Math.cos(moonAngle);
            sinA = Math.sin(moonAngle);
        }

        // Build each vehicle
        for (const vehicle of mission.vehicles) {
            this._buildVehicle(mission, vehicle, group, cosA, sinA, isHelio);
        }

        // Build event markers along the primary vehicle's path
        const primary = mission.vehicles.find(v => v.primary) || mission.vehicles[mission.vehicles.length - 1];
        const primaryKey = `${mission.id}/${primary.id}`;
        const primaryData = this._vehicleData.get(primaryKey);

        // Pre-compute event label positions along the primary vehicle's path
        const eventPositions = mission.events.map(event => {
            if (event.showLabel === false) return null;
            if (!primaryData) return null;
            const pos = this._interpolateEcliptic(primaryData.rotatedWaypoints, event.t);
            return primaryData.toScene(pos);
        });
        this._eventPositions.set(mission.id, eventPositions);
        this._lastTriggeredEvent.set(mission.id, -1);
    }

    _buildVehicle(mission, vehicle, group, cosA, sinA, isHelio) {
        const key = `${mission.id}/${vehicle.id}`;

        // For geocentric: rotate waypoints from Moon-aligned to ecliptic frame
        // For heliocentric: waypoints are already in ecliptic AU — use as-is
        const rotatedWaypoints = isHelio
            ? vehicle.waypoints.map(wp => ({ t: wp.t, x: wp.x, y: wp.y, z: wp.z }))
            : vehicle.waypoints.map(wp => {
                const rw = {
                    t: wp.t,
                    x: wp.x * cosA - wp.y * sinA,
                    y: wp.x * sinA + wp.y * cosA,
                    z: wp.z
                };
                // Resolve Moon-anchored waypoints to Moon's actual ecliptic position
                if (wp.anchorMoon && mission.launchDate) {
                    const date = new Date(mission.launchDate.getTime() + wp.t * 3600000);
                    const mp = moonPosition(earthMoon.moonElements, date);
                    // moonPosition returns AU offset — use direction but sma for distance
                    const dist = Math.sqrt(mp.x * mp.x + mp.y * mp.y + mp.z * mp.z);
                    const scale = dist > 0 ? earthMoon.moonElements.semiMajorAxisKm / (dist * 149597870.7) : 0;
                    rw.x = mp.x * 149597870.7 * scale;
                    rw.y = mp.y * 149597870.7 * scale;
                    rw.z = mp.z * 149597870.7 * scale;
                }
                return rw;
            });

        // Build smooth time-parameterised path using CatmullRom for shape,
        // sampled at uniform time steps so the line progresses with mission time.
        const curveVectors = rotatedWaypoints.map(p => new THREE.Vector3(p.x, p.y, p.z));
        const curve = new THREE.CatmullRomCurve3(curveVectors, false, 'centripetal', 0.5);
        const N = rotatedWaypoints.length;

        const startT = rotatedWaypoints[0].t;
        const endT = rotatedWaypoints[N - 1].t;
        const numSamples = vehicle.primary ? 400 : Math.max(40, N * 15);
        const pathSamples = [];
        for (let i = 0; i <= numSamples; i++) {
            const t = startT + (endT - startT) * (i / numSamples);
            // Map elapsed time to curve parameter via waypoint index
            let wi = 0;
            while (wi < N - 1 && rotatedWaypoints[wi + 1].t <= t) wi++;
            if (wi >= N - 1) wi = N - 2;
            const frac = rotatedWaypoints[wi + 1].t > rotatedWaypoints[wi].t
                ? (t - rotatedWaypoints[wi].t) / (rotatedWaypoints[wi + 1].t - rotatedWaypoints[wi].t) : 0;
            const u = (wi + frac) / (N - 1);
            pathSamples.push(curve.getPoint(u));
        }

        // Convert to scene coordinates
        const toScene = isHelio
            ? p => eclipticToScene({ x: p.x, y: p.y, z: p.z })
            : p => this._toLocalScene(p);
        const scenePoints = pathSamples.map(toScene);

        // --- Trajectory line with gradient ---
        const positions = new Float32Array(scenePoints.length * 3);
        const colors = new Float32Array(scenePoints.length * 3);
        const [cr, cg, cb] = vehicle.color;

        for (let i = 0; i < scenePoints.length; i++) {
            positions[i * 3]     = scenePoints[i].x;
            positions[i * 3 + 1] = scenePoints[i].y;
            positions[i * 3 + 2] = scenePoints[i].z;

            const frac = i / (scenePoints.length - 1);
            let brightness;
            if (vehicle.primary) {
                // Gradient: bright near flyby, dimmer at ends
                if (frac < 0.05) {
                    const t = frac / 0.05;
                    colors[i * 3]     = 1.0 - t * (1.0 - cr);
                    colors[i * 3 + 1] = 1.0 - t * (1.0 - cg);
                    colors[i * 3 + 2] = 1.0 - t * (1.0 - cb);
                    continue;
                } else if (frac < 0.45) {
                    brightness = 0.9;
                } else if (frac < 0.55) {
                    brightness = 1.0;
                } else {
                    brightness = 0.9 - (frac - 0.55) * 0.5;
                }
            } else {
                // Non-primary vehicles: uniform brightness
                brightness = 0.85;
            }
            colors[i * 3]     = cr * brightness;
            colors[i * 3 + 1] = cg * brightness;
            colors[i * 3 + 2] = cb * brightness;
        }

        const lineGeometry = new THREE.BufferGeometry();
        lineGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        lineGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const lineMaterial = new THREE.LineBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity: vehicle.primary ? 0.5 : 0.35,
            depthWrite: false
        });
        const line = new THREE.Line(lineGeometry, lineMaterial);
        line.renderOrder = 1;
        group.add(line);

        // --- Glow points (primary vehicle only) ---
        let glowPoints = null;
        if (vehicle.primary) {
            const glowColors = new Float32Array(colors.length);
            for (let i = 0; i < colors.length; i += 3) {
                glowColors[i]     = colors[i]     * 0.6;
                glowColors[i + 1] = colors[i + 1] * 0.6;
                glowColors[i + 2] = colors[i + 2] * 0.6;
            }
            const glowGeometry = new THREE.BufferGeometry();
            glowGeometry.setAttribute('position', new THREE.BufferAttribute(positions.slice(), 3));
            glowGeometry.setAttribute('color', new THREE.BufferAttribute(glowColors, 3));
            const glowMaterial = new THREE.PointsMaterial({
                size: 3.0,
                sizeAttenuation: false,
                vertexColors: true,
                transparent: true,
                opacity: 0.08,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            });
            glowPoints = new THREE.Points(glowGeometry, glowMaterial);
            group.add(glowPoints);
        }

        // --- Vehicle marker ---
        const marker = this._createVehicleMarker(vehicle);
        marker.visible = false;
        group.add(marker);

        // Store everything needed for updates
        this._vehicleData.set(key, {
            rotatedWaypoints,
            marker,
            line,
            glowPoints,
            isHelio,
            toScene,
            startTime: vehicle.waypoints[0].t,
            endTime: vehicle.waypoints[vehicle.waypoints.length - 1].t
        });
    }

    _createVehicleMarker(vehicle) {
        const group = new THREE.Group();
        const [r, g, b] = vehicle.color;

        // Solid coloured core dot
        const core = new THREE.Sprite(new THREE.SpriteMaterial({
            map: generateGlowTexture(r, g, b, 0.9),
            blending: THREE.AdditiveBlending,
            transparent: true,
            depthWrite: false,
            depthTest: false
        }));
        const scale = vehicle.primary ? 0.04 : 0.025;
        core.scale.set(scale, scale, 1);
        core.renderOrder = 10;
        group.add(core);

        // Subtle glow halo
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({
            map: generateGlowTexture(r, g, b, 0.2),
            blending: THREE.AdditiveBlending,
            transparent: true,
            depthWrite: false,
            depthTest: false
        }));
        const glowScale = vehicle.primary ? 0.1 : 0.06;
        glow.scale.set(glowScale, glowScale, 1);
        glow.renderOrder = 9;
        group.add(glow);

        return group;
    }


    // --- Transfer arc generation ---------------------------------------------

    /**
     * Generate a smooth transfer orbit between anchor waypoints.
     * Fills in intermediate points along an elliptical arc, respecting
     * the actual planet positions and prograde (CCW) orbital direction.
     */
    _generateTransferArc(anchors, launchDate) {
        const result = [];

        for (let seg = 0; seg < anchors.length - 1; seg++) {
            const wp0 = anchors[seg];
            const wp1 = anchors[seg + 1];

            const r0 = Math.sqrt(wp0.x * wp0.x + wp0.y * wp0.y);
            const r1 = Math.sqrt(wp1.x * wp1.x + wp1.y * wp1.y);
            const a0 = Math.atan2(wp0.y, wp0.x);
            let a1 = Math.atan2(wp1.y, wp1.x);

            // Prograde = counter-clockwise. Ensure positive sweep.
            let sweep = a1 - a0;
            if (sweep <= 0) sweep += 2 * Math.PI;
            // If sweep > π, the transfer likely goes the short way (retrograde)
            // For most missions, sweep < π is correct
            if (sweep > Math.PI * 1.5) sweep -= 2 * Math.PI;

            // Generate 12 intermediate points per segment
            const n = 12;
            for (let i = 0; i <= n; i++) {
                if (i === n && seg < anchors.length - 2) continue; // avoid duplicates
                const frac = i / n;
                const t = wp0.t + (wp1.t - wp0.t) * frac;
                const angle = a0 + sweep * frac;

                // Transfer orbit radius: smooth interpolation with outward bulge
                // The bulge simulates the elliptical transfer being wider than a straight line
                const isOutward = r1 > r0;
                const bulge = isOutward ? 0.05 : -0.03;
                const r = r0 + (r1 - r0) * frac + bulge * (r0 + r1) * Math.sin(Math.PI * frac);

                const z = wp0.z + (wp1.z - wp0.z) * frac;

                result.push({ t, x: r * Math.cos(angle), y: r * Math.sin(angle), z });
            }
        }

        return result;
    }

    // --- Coordinate transforms -----------------------------------------------

    _toLocalScene(eclipticKmVec) {
        const dist = eclipticKmVec.length();
        if (dist < 10) return new THREE.Vector3(0, 0, 0);

        const earthSceneR = sceneRadius(EARTH_RADIUS_KM, BodyType.PLANET);
        const compressedDist = earthSceneR * Math.pow(dist / EARTH_RADIUS_KM, MOON_DIST_EXPONENT) * MOON_DIST_SCALE;
        const dir = eclipticKmVec.clone().normalize();

        return new THREE.Vector3(
            dir.x * compressedDist,
            dir.z * compressedDist,
            -dir.y * compressedDist
        );
    }

    _interpolateEcliptic(waypoints, timeHours) {
        const first = waypoints[0].t;
        const last = waypoints[waypoints.length - 1].t;
        const t = Math.max(first, Math.min(last, timeHours));

        let i = 0;
        while (i < waypoints.length - 1 && waypoints[i + 1].t <= t) i++;
        if (i >= waypoints.length - 1) i = waypoints.length - 2;

        const wp0 = waypoints[i];
        const wp1 = waypoints[i + 1];
        const frac = wp1.t > wp0.t ? (t - wp0.t) / (wp1.t - wp0.t) : 0;

        return new THREE.Vector3(
            wp0.x + (wp1.x - wp0.x) * frac,
            wp0.y + (wp1.y - wp0.y) * frac,
            wp0.z + (wp1.z - wp0.z) * frac
        );
    }

    // --- Per-frame update ----------------------------------------------------

    update(simulatedDate, earthHelioPos, camera) {
        const earthScenePos = eclipticToScene(earthHelioPos);

        for (const mission of this.missions) {
            const group = this._groups.get(mission.id);
            if (!group) continue;

            // Only show the selected mission
            const isSelected = this.visible && mission.id === this.selectedMissionId;
            group.visible = isSelected;
            if (!isSelected) continue;

            // Geocentric missions track Earth; heliocentric are at origin
            const isHelio = mission.referenceFrame === 'heliocentric';
            if (isHelio) {
                group.position.set(0, 0, 0);
            } else {
                group.position.copy(earthScenePos);
            }

            const elapsedHours = (simulatedDate.getTime() - mission.launchDate.getTime()) / 3600000;
            const missionActive = elapsedHours >= 0 && elapsedHours <= mission.durationHours;

            // Update each vehicle
            for (const vehicle of mission.vehicles) {
                const key = `${mission.id}/${vehicle.id}`;
                const data = this._vehicleData.get(key);
                if (!data) continue;

                const { startTime, endTime } = data;
                const isMoving = elapsedHours >= startTime && elapsedHours < endTime;

                // Marker: only visible while vehicle is actively moving
                data.marker.visible = isMoving;
                if (isMoving) {
                    let markerPos;

                    // Moon-relative overrides (orbit, landing, ascent)
                    if (!isHelio && (vehicle.moonOrbit || vehicle.moonLanding || vehicle.moonOrbitReturn)) {
                        const missionDate = new Date(mission.launchDate.getTime() + elapsedHours * 3600000);
                        const moonOffset = moonPosition(earthMoon.moonElements, missionDate);
                        const moonKm = new THREE.Vector3(
                            moonOffset.x * 149597870.7,
                            moonOffset.y * 149597870.7,
                            moonOffset.z * 149597870.7
                        );
                        const moonDir = moonKm.length() > 0 ? moonKm.clone().normalize() : new THREE.Vector3(1, 0, 0);
                        const smaKm = moonDir.clone().multiplyScalar(earthMoon.moonElements.semiMajorAxisKm);
                        const moonScenePos = this._toLocalScene(smaKm);

                        // Helper: compute orbit position at a given time
                        const orbitAt = (orb, t) => {
                            const angle = (t - orb.startTime) / orb.periodHours * 2 * Math.PI;
                            const orbitR = this._toLocalScene(
                                moonDir.clone().multiplyScalar(earthMoon.moonElements.semiMajorAxisKm + orb.radiusKm)
                            ).length() - moonScenePos.length();
                            const up = new THREE.Vector3(0, 1, 0);
                            const tangent = new THREE.Vector3().crossVectors(moonDir, up).normalize();
                            const normal = new THREE.Vector3().crossVectors(tangent, moonDir).normalize();
                            return moonScenePos.clone()
                                .addScaledVector(tangent, Math.cos(angle) * orbitR)
                                .addScaledVector(normal, Math.sin(angle) * orbitR);
                        };

                        const mo = vehicle.moonOrbit;
                        const ml = vehicle.moonLanding;
                        const mr = vehicle.moonOrbitReturn;

                        if (mo && elapsedHours >= mo.startTime && elapsedHours <= mo.endTime) {
                            if (ml && elapsedHours > mo.endTime - 0.001) {
                                markerPos = moonScenePos.clone();
                            } else {
                                markerPos = orbitAt(mo, elapsedHours);
                            }
                        } else if (ml && elapsedHours >= ml.startTime && elapsedHours <= ml.endTime) {
                            markerPos = moonScenePos.clone();
                        } else if (mr && elapsedHours >= mr.startTime && elapsedHours <= mr.endTime) {
                            if (elapsedHours < mr.startTime + 0.001) {
                                markerPos = moonScenePos.clone();
                            } else {
                                markerPos = orbitAt(mr, elapsedHours);
                            }
                        }
                        // After all moon phases, markerPos is null → falls through
                        // to waypoint interpolation which now has anchorMoon waypoints
                    }
                    if (!markerPos) {
                        const pos = this._interpolateEcliptic(data.rotatedWaypoints, elapsedHours);
                        markerPos = data.toScene(pos);
                    }

                    data.marker.position.copy(markerPos);

                    // Scale marker based on camera distance so it's always visible
                    if (camera) {
                        const worldPos = data.marker.position.clone().add(group.position);
                        const camDist = camera.position.distanceTo(worldPos);
                        const minScale = Math.max(0.04, camDist * 0.012);
                        for (const child of data.marker.children) {
                            child.scale.setScalar(minScale);
                        }
                    }
                }

                // Trail: fully visible for the entire mission duration
                data.line.visible = missionActive;
                if (data.glowPoints) data.glowPoints.visible = missionActive;
            }

            // (Event labels are computed in getActiveLabels, no scene objects needed)
        }
    }

    // --- Public API ----------------------------------------------------------

    setVisible(visible) {
        this.visible = visible;
        for (const group of this._groups.values()) {
            group.visible = visible;
        }
    }

    getMissions() {
        return this.missions;
    }

    /** Get the primary vehicle's world position, or null if not active. */
    getSpacecraftPosition(missionId, simulatedDate) {
        const mission = this.missions.find(m => m.id === missionId);
        if (!mission) return null;

        const elapsedHours = (simulatedDate.getTime() - mission.launchDate.getTime()) / 3600000;
        if (elapsedHours < 0 || elapsedHours > mission.durationHours) return null;

        // Find the active vehicle closest to primary
        const primary = mission.vehicles.find(v => v.primary) || mission.vehicles[mission.vehicles.length - 1];
        const key = `${missionId}/${primary.id}`;
        const data = this._vehicleData.get(key);
        const group = this._groups.get(missionId);
        if (!data || !group) return null;

        const pos = this._interpolateEcliptic(data.rotatedWaypoints, elapsedHours);
        const localPos = data.toScene(pos);
        return localPos.add(group.position);
    }

    /** Return label data for active vehicles and event markers. */
    getActiveLabels(simulatedDate) {
        if (!this.visible || !this.selectedMissionId) return [];
        const labels = [];

        for (const mission of this.missions) {
            if (mission.id !== this.selectedMissionId) continue;
            const group = this._groups.get(mission.id);
            if (!group) continue;

            const elapsedHours = (simulatedDate.getTime() - mission.launchDate.getTime()) / 3600000;
            const missionActive = elapsedHours >= 0 && elapsedHours <= mission.durationHours;
            if (!missionActive) continue;

            // Vehicle labels (only while moving)
            for (const vehicle of mission.vehicles) {
                const firstT = vehicle.waypoints[0].t;
                const lastT = vehicle.waypoints[vehicle.waypoints.length - 1].t;
                if (elapsedHours < firstT || elapsedHours >= lastT) continue;

                const key = `${mission.id}/${vehicle.id}`;
                const data = this._vehicleData.get(key);
                if (!data) continue;

                const worldPos = data.marker.position.clone().add(group.position);
                labels.push({
                    name: vehicle.name,
                    worldPosition: worldPos,
                    type: 'mission',
                    priority: 200
                });
            }

            // Event labels — only visible within a few seconds of screen time around each event
            // Window scales with mission duration (~3% of total, min 1h, max 500h)
            if (missionActive) {
                const positions = this._eventPositions.get(mission.id);
                const window = Math.max(1, Math.min(500, mission.durationHours * 0.03));
                if (positions) {
                    for (let i = 0; i < mission.events.length; i++) {
                        if (!positions[i]) continue;
                        const dt = Math.abs(elapsedHours - mission.events[i].t);
                        if (dt > window) continue;
                        const worldPos = positions[i].clone().add(group.position);
                        labels.push({
                            name: mission.events[i].name,
                            worldPosition: worldPos,
                            type: 'mission-event',
                            priority: 150
                        });
                    }
                }
            }
        }
        return labels;
    }

    /**
     * Check for mission events that just triggered.
     * Returns the event object or null. Call each frame to detect crossings.
     */
    checkEventTrigger(simulatedDate) {
        for (const mission of this.missions) {
            const elapsedHours = (simulatedDate.getTime() - mission.launchDate.getTime()) / 3600000;
            if (elapsedHours < -1 || elapsedHours > mission.durationHours + 1) continue;

            const lastIdx = this._lastTriggeredEvent.get(mission.id);
            for (let i = 0; i < mission.events.length; i++) {
                if (i <= lastIdx) continue;
                const event = mission.events[i];
                if (elapsedHours >= event.t && elapsedHours < event.t + 2.0) {
                    this._lastTriggeredEvent.set(mission.id, i);
                    return { mission, event };
                }
            }

            // Reset if we've gone backwards in time (e.g. user jumped)
            if (lastIdx >= 0 && elapsedHours < mission.events[lastIdx].t - 1) {
                this._lastTriggeredEvent.set(mission.id, -1);
            }
        }
        return null;
    }

    /**
     * Get bounding box for framing the trajectory in the viewport.
     * For geocentric: bounds are in local scene coords (relative to Earth).
     * For heliocentric: bounds are in absolute scene coords.
     * Returns { center: THREE.Vector3, radius: number, isHelio: boolean }.
     * Result is cached since trajectory shape doesn't change.
     */
    getMissionBounds(missionId) {
        if (this._boundsCache && this._boundsCache.id === missionId) {
            return this._boundsCache.result;
        }

        const mission = this.missions.find(m => m.id === missionId);
        const isHelio = mission && mission.referenceFrame === 'heliocentric';

        const min = new THREE.Vector3(Infinity, Infinity, Infinity);
        const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);

        if (!isHelio && mission) {
            // Geocentric: compute bounds in absolute scene coords.
            // The trajectory group follows Earth, so include the full trajectory
            // extent at BOTH Earth's start and end positions to ensure nothing
            // drifts out of frame during playback.
            const earthElements = allPlanets.find(p => p.id === 'earth').orbitalElements;
            const startDate = mission.launchDate;
            const endDate = new Date(startDate.getTime() + mission.durationHours * 3600000);
            const earthStart = eclipticToScene(heliocentricPosition(earthElements, startDate));
            const earthEnd = eclipticToScene(heliocentricPosition(earthElements, endDate));

            // Compute local trajectory extent (relative to Earth)
            const localMin = new THREE.Vector3(Infinity, Infinity, Infinity);
            const localMax = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
            for (const [key, data] of this._vehicleData) {
                if (!key.startsWith(missionId + '/')) continue;
                for (const wp of data.rotatedWaypoints) {
                    const local = data.toScene(new THREE.Vector3(wp.x, wp.y, wp.z));
                    localMin.min(local);
                    localMax.max(local);
                }
            }
            // Store local center and radius for tight camera framing + lazy follow
            this._localCenter = new THREE.Vector3().addVectors(localMin, localMax).multiplyScalar(0.5);
            this._localRadius = new THREE.Vector3().subVectors(localMax, localMin).multiplyScalar(0.5).length();

            // Include trajectory extent at both Earth positions
            min.min(earthStart.clone().add(localMin)); max.max(earthStart.clone().add(localMax));
            min.min(earthEnd.clone().add(localMin));   max.max(earthEnd.clone().add(localMax));
        } else {
            // Heliocentric: waypoints already in absolute coords
            for (const [key, data] of this._vehicleData) {
                if (!key.startsWith(missionId + '/')) continue;
                for (const wp of data.rotatedWaypoints) {
                    const pt = data.toScene(new THREE.Vector3(wp.x, wp.y, wp.z));
                    min.min(pt); max.max(pt);
                }
            }
        }

        const center = new THREE.Vector3().addVectors(min, max).multiplyScalar(0.5);
        const halfSize = new THREE.Vector3().subVectors(max, min).multiplyScalar(0.5);
        const radius = halfSize.length();

        const localCenter = this._localCenter || null;
        const localRadius = this._localRadius || null;
        const result = { center, radius, isHelio, localCenter, localRadius };
        this._boundsCache = { id: missionId, result };
        return result;
    }

    /**
     * Get telemetry for a mission at the current time.
     * Returns { met, distKm, speedKmS } or null if not active.
     */
    getTelemetry(missionId, simulatedDate) {
        const mission = this.missions.find(m => m.id === missionId);
        if (!mission) return null;

        const elapsedHours = (simulatedDate.getTime() - mission.launchDate.getTime()) / 3600000;
        if (elapsedHours < 0 || elapsedHours > mission.durationHours) return null;

        const primary = mission.vehicles.find(v => v.primary);
        if (!primary) return null;

        const key = `${missionId}/${primary.id}`;
        const data = this._vehicleData.get(key);
        if (!data) return null;

        const isHelio = mission.referenceFrame === 'heliocentric';
        const pos = this._interpolateEcliptic(data.rotatedWaypoints, elapsedHours);

        // Distance: geocentric in km, heliocentric in AU from Sun
        const distKm = isHelio ? pos.length() * 149597870.7 : pos.length();
        const distAU = isHelio ? pos.length() : null;

        // Speed via finite difference
        const dt = isHelio ? 1.0 : 0.01; // hours (larger step for AU-scale)
        const pos2 = this._interpolateEcliptic(data.rotatedWaypoints, elapsedHours + dt);
        const dx = pos2.x - pos.x;
        const dy = pos2.y - pos.y;
        const dz = pos2.z - pos.z;
        const distDelta = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const speedKmS = isHelio
            ? (distDelta * 149597870.7) / (dt * 3600)
            : distDelta / (dt * 3600);

        return { met: elapsedHours, distKm, distAU, speedKmS, missionName: mission.name, isHelio };
    }

    /** Reset event triggers (call when jumping to mission start). */
    resetEventTriggers(missionId) {
        this._lastTriggeredEvent.set(missionId, -1);
    }
}
