#!/usr/bin/env python3
"""
Build textures/stars.csv from the Yale Bright Star Catalog 5th Rev. (BSC5).

BSC5 was prepared at NASA Goddard NSSDC/ADC (Hoffleit & Warren, 1991) and is
in the public domain. Catalog source: VizieR V/50.

  https://cdsarc.cds.unistra.fr/ftp/V/50/catalog.gz

Usage:
  curl -sLO https://cdsarc.cds.unistra.fr/ftp/V/50/catalog.gz
  gunzip catalog.gz
  python3 tools/build_stars.py catalog OLD_STARS.csv > textures/stars.csv

The optional second argument is a coord-keyed name lookup with the same
ra,dec,mag,ci,name shape. Only the proper-name column is used; all numeric
data is taken from BSC5. Star proper names (Sirius, Vega, etc.) are
traditional / IAU-standardised — factual references, not creative content.
"""

import csv
import sys


def parse_bsc5_record(line: str):
    """Parse a single 197-byte fixed-width BSC5 record.

    Returns a dict with ra (hours), dec (degrees), vmag, bv, or None if the
    record has no J2000 position (the 14 retained novae/extragalactic objects).
    """
    line = line.rstrip("\n").ljust(197)

    ra_h_s = line[75:77].strip()
    ra_m_s = line[77:79].strip()
    ra_s_s = line[79:83].strip()
    if not ra_h_s or not ra_m_s or not ra_s_s:
        return None

    de_sign = line[83]
    de_d_s = line[84:86].strip()
    de_m_s = line[86:88].strip()
    de_s_s = line[88:90].strip()
    vmag_s = line[102:107].strip()
    bv_s = line[109:114].strip()

    try:
        ra_h = int(ra_h_s)
        ra_m = int(ra_m_s)
        ra_s = float(ra_s_s)
        de_d = int(de_d_s)
        de_m = int(de_m_s)
        de_s = int(de_s_s)
        vmag = float(vmag_s)
    except ValueError:
        return None

    ra_hours = ra_h + ra_m / 60.0 + ra_s / 3600.0
    dec_deg = de_d + de_m / 60.0 + de_s / 3600.0
    if de_sign == "-":
        dec_deg = -dec_deg

    try:
        bv = float(bv_s)
    except ValueError:
        bv = 0.0

    return {"ra": ra_hours, "dec": dec_deg, "mag": vmag, "ci": bv}


def load_name_lookup(path: str):
    """Build {(ra_rounded, dec_rounded): name} from a coord-keyed CSV."""
    lookup = {}
    with open(path, newline="") as f:
        for row in csv.DictReader(f):
            name = (row.get("name") or "").strip()
            if not name:
                continue
            try:
                ra = float(row["ra"])
                dec = float(row["dec"])
            except (KeyError, ValueError):
                continue
            # Round to 0.001 hours RA (~0.5 arcmin) and 0.01° Dec for matching.
            lookup[(round(ra, 3), round(dec, 2))] = name
    return lookup


def find_name(star, lookup):
    key = (round(star["ra"], 3), round(star["dec"], 2))
    if key in lookup:
        return lookup[key]
    # Tiny tolerance sweep to absorb rounding-edge mismatches.
    for dra in (-0.001, 0.0, 0.001):
        for ddec in (-0.01, 0.0, 0.01):
            k = (round(star["ra"] + dra, 3), round(star["dec"] + ddec, 2))
            if k in lookup:
                return lookup[k]
    return ""


def main(argv):
    if len(argv) < 2:
        print(__doc__, file=sys.stderr)
        sys.exit(1)

    catalog_path = argv[1]
    name_lookup = load_name_lookup(argv[2]) if len(argv) > 2 else {}

    sys.stdout.reconfigure(newline="")
    out = csv.writer(sys.stdout, lineterminator="\n")
    out.writerow(["ra", "dec", "mag", "ci", "name"])

    kept = 0
    with open(catalog_path) as f:
        for line in f:
            star = parse_bsc5_record(line)
            if star is None:
                continue
            if star["mag"] > 6.5:
                continue
            name = find_name(star, name_lookup)
            out.writerow([
                f"{star['ra']:.6f}",
                f"{star['dec']:.5f}",
                f"{star['mag']:.2f}",
                f"{star['ci']:.3f}",
                name,
            ])
            kept += 1

    print(f"BSC5 → {kept} stars (mag ≤ 6.5)", file=sys.stderr)


if __name__ == "__main__":
    main(sys.argv)
