# Third-Party Notices

The source code in this repository is distributed under the MIT licence (see
`LICENSE`). The bundled assets under `textures/` and the runtime dependency
on Three.js are covered by separate licences, all of which permit
redistribution for any purpose (including commercial) provided their
attributions are preserved. This file is the canonical inventory.

## Runtime dependency

| Package | Version | Source | Licence |
|---------|---------|--------|---------|
| Three.js | r170 (CDN) | <https://threejs.org/> | MIT |

## Planet textures

| Body | File | Source | Licence |
|------|------|--------|---------|
| Earth | `earth_2k.jpg` | NASA Blue Marble Next Generation (December 2004) | Public domain (US Government work) |
| Moon | `moon_2k.jpg` | NASA Lunar Reconnaissance Orbiter Camera | Public domain (US Government work) |
| Mars | `mars_2k.jpg` | USGS Viking MDIM21 mosaic (via Wikimedia Commons) | Public domain (US Government work) |
| Jupiter | `jupiter_2k.jpg` | NASA/JPL/SSI Cassini cylindrical map [PIA07782](https://photojournal.jpl.nasa.gov/catalog/PIA07782) | Public domain (NASA) |
| Pluto | `pluto_2k.jpg` | NASA/JHUAPL/SwRI New Horizons colour map | Public domain (US Government work) |
| Mercury | `mercury_2k.jpg` | [Solar System Scope](https://www.solarsystemscope.com/textures/) | CC-BY 4.0 |
| Venus | `venus_2k.jpg` | [Solar System Scope](https://www.solarsystemscope.com/textures/) | CC-BY 4.0 |
| Saturn | `saturn_2k.jpg` | [Solar System Scope](https://www.solarsystemscope.com/textures/) | CC-BY 4.0 |
| Saturn rings | `saturn_rings.png` | [Solar System Scope](https://www.solarsystemscope.com/textures/) | CC-BY 4.0 |
| Uranus | `uranus_2k.jpg` | [Solar System Scope](https://www.solarsystemscope.com/textures/) | CC-BY 4.0 |
| Neptune | `neptune_2k.jpg` | [Solar System Scope](https://www.solarsystemscope.com/textures/) | CC-BY 4.0 |
| Io | `io_2k.jpg` | [Björn Jónsson](https://bjj.mmedia.is/data/io/io.html), from NASA/JPL Voyager + Galileo data | "Publicly available, please mention origin" (CC-BY-equivalent) |
| Europa | `europa_2k.jpg` | NASA/JPL Voyager/Galileo mosaic (via Wikimedia Commons) | Public domain (NASA) |
| Ganymede | `ganymede_2k.jpg` | [Björn Jónsson](https://bjj.mmedia.is/data/ganymede/), from NASA/JPL Voyager + Galileo data | "Publicly available, please mention origin" (CC-BY-equivalent) |
| Callisto | `callisto_2k.jpg` | [Björn Jónsson](https://bjj.mmedia.is/data/callisto/), from NASA/JPL Voyager + Galileo data | "Publicly available, please mention origin" (CC-BY-equivalent) |

## Star catalogue

| File | Source | Licence |
|------|--------|---------|
| `stars.csv` | Yale Bright Star Catalog, 5th Revised Ed. (Hoffleit & Warren, 1991), prepared at NASA Goddard NSSDC/ADC. Distributed via VizieR catalogue [V/50](https://cdsarc.cds.unistra.fr/viz-bin/cat/V/50). 8,404 stars at V ≤ 6.5. | Public domain (US Government work) |

Star proper names (Sirius, Vega, Aldebaran, …) are traditional / IAU-standardised
designations. Such names are factual references and are not subject to
copyright. The build script `tools/build_stars.py` is reproducible from the
PD BSC5 source.

## Mission data

All mission timelines, launch dates, trajectory waypoints, and orbital
parameters are sourced from NASA mission documents (Apollo Flight Journals,
JPL mission pages, NASA HORIZONS-derived data) and are in the public domain
as US Government works. Specific sources:

- Artemis II — NASA Artemis programme planning documents
- Apollo 8, 11, 13 — NASA Apollo Flight Journal
- Cassini-Huygens — NASA/JPL Cassini mission timeline
- Voyager 1 & 2 — NASA/JPL Voyager mission data
- New Horizons — NASA/JHUAPL mission data
- Perseverance — NASA/JPL Mars 2020 mission data
- Parker Solar Probe — NASA/JHUAPL mission data
- BepiColombo — ESA/JAXA mission data (factual mission timeline data)
- ISS orbital elements — NASA

## Orbital elements

Planetary Keplerian orbital elements (J2000.0 epoch) are from NASA/JPL
publications (Standish & Williams, "Keplerian Elements for Approximate
Positions of the Major Planets"). Public domain (US Government work).

## Procedural / generated content

The Sun's surface texture and the four-layer corona glow textures are
generated procedurally at runtime in `js/textureGenerator.js` and are
covered by this project's MIT licence.

## Licence summary

- **Public domain (no attribution legally required, but preserved as a
  courtesy):** NASA imagery, USGS imagery, BSC5 catalogue.
- **CC-BY 4.0 (attribution required):** Solar System Scope textures
  (Mercury, Venus, Saturn body, Saturn rings, Uranus, Neptune).
- **"Publicly available, please mention origin" (CC-BY-equivalent):**
  Björn Jónsson's Galilean moon textures (Io, Ganymede, Callisto).
- **MIT:** Three.js, project source code.

To redistribute this project, preserve this file alongside the source. The
in-app Credits panel (top-right of the date bar) also surfaces these
attributions to end users.
