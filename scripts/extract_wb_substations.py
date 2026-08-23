"""Extract 33/11 kV substations from the WB Department of Power page dump."""

from __future__ import annotations

import csv
import json
import math
import re
from pathlib import Path

SRC = Path(r"C:\Users\rouma\.cursor\projects\c-Dipankar-DRO\uploads\sub-stations-0.md")
OUT_DIR = Path(r"c:\Dipankar\DRO\data")

WB_LAT = (21.2, 27.4)
WB_LON = (85.6, 90.0)

HEMI_RE = re.compile(r"[NSEW]", re.I)


def clean_cell(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip().strip('"')


def split_table_row(line: str) -> list[str]:
    line = line.strip()
    if line.startswith("|"):
        line = line[1:]
    if line.endswith("|"):
        line = line[:-1]
    return [clean_cell(c) for c in line.split("|")]


def looks_like_separator(cells: list[str]) -> bool:
    return all(re.fullmatch(r":?-{3,}:?", c.replace(" ", "")) or c == "" for c in cells)


def extract_hemisphere(s: str) -> str | None:
    letters = HEMI_RE.findall(s.upper())
    if not letters:
        return None
    # Prefer last explicit letter (e.g. 21°59'54.85"N)
    return letters[-1]


def strip_noise(s: str) -> str:
    s = s.replace("\u00b0", "°").replace("º", "°")
    s = s.replace("′", "'").replace("’", "'").replace("`", "'")
    s = s.replace("″", '"').replace("”", '"').replace("“", '"')
    s = re.sub(r"[NSEW\-,\s]+", " ", s, flags=re.I)
    s = s.replace("°", " ").replace("'", " ").replace('"', " ")
    s = re.sub(r"[^0-9.\s]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def dms_to_decimal(parts: list[float]) -> float | None:
    if not parts:
        return None
    if len(parts) == 1:
        return parts[0]
    if len(parts) == 2:
        deg, minutes = parts
        # 22037.32 style compacted DMS without separators: 22°37'...
        if deg >= 100:
            text = f"{deg:.10g}"
            if "." not in text and len(text) in (5, 6):
                # 22037 -> 22 deg 037 min? unlikely. handled earlier
                pass
            if deg >= 1000:
                # compacted like 22037 (22 deg, 037 min fragment)
                s = f"{deg:.10g}"
                if "." in s:
                    whole, frac = s.split(".", 1)
                else:
                    whole, frac = s, ""
                if len(whole) >= 5:
                    d = int(whole[:2])
                    rest = whole[2:]
                    if frac:
                        m = float(f"{rest}.{frac}")
                    else:
                        m = float(rest)
                    return d + m / 60.0
        return deg + minutes / 60.0
    deg, minutes, seconds = parts[0], parts[1], parts[2]
    return deg + minutes / 60.0 + seconds / 3600.0


def parse_coord(raw: str, expected: str) -> tuple[float | None, list[str]]:
    """expected is 'lat' or 'lon'. Returns (decimal, flags)."""
    flags: list[str] = []
    if not raw:
        return None, ["missing"]

    hemi = extract_hemisphere(raw)
    s = raw.strip()

    # Compacted DMS missing degree mark: 22037'32.7"  or 88016'29.2"
    compact = re.match(
        r"^\s*([NSWE]?)?\s*(\d{5,6})(?:°)?\s*'?\s*(\d+(?:\.\d+)?)\s*\"?\s*([NSWE]?)?\s*$",
        s,
        re.I,
    )
    if compact:
        digits = compact.group(2)
        sec = float(compact.group(3))
        deg = int(digits[:2])
        minutes = int(digits[2:])
        val = deg + minutes / 60.0 + sec / 3600.0
        hemi = (compact.group(4) or compact.group(1) or hemi or "").upper() or None
        if hemi in ("S", "W"):
            val = -val
        flags.append("compacted_dms")
        return round(val, 7), flags

    # Degree + unpunctuated minutes like N26°57038'  (meant 57.038')
    unpunct = re.match(
        r"^\s*[NSWE]?\s*(\d{1,3})\s*°\s*(\d{4,})\s*'?\s*[NSWE]?\s*$",
        s,
        re.I,
    )
    if unpunct:
        deg = int(unpunct.group(1))
        rest = unpunct.group(2)
        minutes = float(f"{rest[:2]}.{rest[2:]}" if len(rest) > 2 else rest)
        val = deg + minutes / 60.0
        if hemi in ("S", "W"):
            val = -val
        flags.append("inferred_decimal_minutes")
        return round(val, 7), flags

    cleaned = strip_noise(s)
    if not cleaned:
        return None, ["unparseable"]

    parts = [float(p) for p in cleaned.split() if p.replace(".", "", 1).isdigit()]
    if not parts:
        return None, ["unparseable"]

    # Minutes overflow still converted arithmetically, but flagged
    if len(parts) >= 2 and parts[1] >= 60:
        flags.append("minutes_ge_60")
    if len(parts) >= 3 and parts[2] >= 60:
        flags.append("seconds_ge_60")

    val = dms_to_decimal(parts)
    if val is None:
        return None, ["unparseable"]

    if hemi in ("S", "W"):
        val = -abs(val)

    # Hemisphere letter disagrees with column (Alipurduar swapped N/E labels)
    if expected == "lat" and hemi in ("E", "W"):
        flags.append("hemi_label_swapped")
    if expected == "lon" and hemi in ("N", "S"):
        flags.append("hemi_label_swapped")

    return round(val, 7), flags


def in_wb(lat: float | None, lon: float | None) -> bool:
    if lat is None or lon is None:
        return False
    return WB_LAT[0] <= lat <= WB_LAT[1] and WB_LON[0] <= lon <= WB_LON[1]


def parse_markdown(text: str) -> list[dict]:
    lines = text.splitlines()
    district = None
    in_table = False
    rows: list[dict] = []

    i = 0
    while i < len(lines):
        line = lines[i].rstrip()
        m = re.match(r"^#{2,4}\s+(.+?)\s*$", line)
        if m:
            heading = m.group(1).strip()
            if heading.lower() not in {"news & updates", "important pages", "important links"}:
                if "district" not in heading.lower() and heading.upper() == heading:
                    district = re.sub(r"\s+", " ", heading)
            in_table = False
            i += 1
            continue

        if line.strip().startswith("|"):
            cells = split_table_row(line)
            header_joined = " ".join(c.upper() for c in cells)
            if "NAME OF INSTALLATION" in header_joined or "LATITUDE" in header_joined:
                in_table = True
                i += 1
                continue
            if in_table:
                if looks_like_separator(cells):
                    i += 1
                    continue
                sl = cells[0] if cells else ""
                if sl.upper() == "TOTAL" or sl == "":
                    i += 1
                    continue
                if len(cells) < 5:
                    i += 1
                    continue
                name = cells[1]
                cap_raw = cells[2]
                lat_raw = cells[3]
                lon_raw = cells[4]
                try:
                    sl_no = int(float(sl))
                except ValueError:
                    i += 1
                    continue
                try:
                    capacity = float(cap_raw) if cap_raw else None
                except ValueError:
                    capacity = None
                    flags_cap = ["capacity_unparseable"]
                else:
                    flags_cap = []

                lat, lat_flags = parse_coord(lat_raw, "lat")
                lon, lon_flags = parse_coord(lon_raw, "lon")

                # If both coords parsed but swapped (lat looks like lon)
                swapped = False
                if lat is not None and lon is not None:
                    if (not (WB_LAT[0] <= lat <= WB_LAT[1]) and WB_LAT[0] <= lon <= WB_LAT[1]
                            and WB_LON[0] <= lat <= WB_LON[1] and not (WB_LON[0] <= lon <= WB_LON[1])):
                        lat, lon = lon, lat
                        swapped = True
                    # Duplicate lat pasted into lon (NTAA-1D)
                    if abs(lat - lon) < 1e-6:
                        lon_flags.append("duplicate_of_latitude")

                flags = lat_flags + [f"lon_{f}" for f in lon_flags if f not in lat_flags]
                if swapped:
                    flags.append("lat_lon_values_swapped")
                flags.extend(flags_cap)
                if not in_wb(lat, lon):
                    flags.append("outside_wb_bbox")

                rows.append(
                    {
                        "district": district or "",
                        "sl_no": sl_no,
                        "name": name,
                        "capacity_mva": capacity,
                        "latitude_raw": lat_raw,
                        "longitude_raw": lon_raw,
                        "latitude": lat,
                        "longitude": lon,
                        "coord_flags": flags,
                    }
                )
        else:
            if line.strip() and in_table and not line.strip().startswith("|"):
                in_table = False
        i += 1
    return rows


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def main() -> None:
    text = SRC.read_text(encoding="utf-8")
    rows = parse_markdown(text)

    # District totals from TOTAL rows for checksum
    district_counts: dict[str, int] = {}
    district_mva: dict[str, float] = {}
    for r in rows:
        district_counts[r["district"]] = district_counts.get(r["district"], 0) + 1
        if r["capacity_mva"] is not None:
            district_mva[r["district"]] = district_mva.get(r["district"], 0.0) + r["capacity_mva"]

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    json_path = OUT_DIR / "wb_33_11kv_substations.json"
    csv_path = OUT_DIR / "wb_33_11kv_substations.csv"

    payload = {
        "source": "https://power.wb.gov.in/sub-stations/",
        "source_title": "District Wise 33/11 KV Sub Station of West Bengal",
        "publisher": "Department of Power, Government of West Bengal",
        "extracted_on": "2026-08-23",
        "count": len(rows),
        "district_count": len(district_counts),
        "total_capacity_mva": round(sum(r["capacity_mva"] or 0 for r in rows), 2),
        "stations": rows,
        "district_summary": [
            {
                "district": d,
                "stations": district_counts[d],
                "capacity_mva": round(district_mva.get(d, 0), 2),
            }
            for d in district_counts
        ],
    }
    json_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")

    with csv_path.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(
            f,
            fieldnames=[
                "district",
                "sl_no",
                "name",
                "capacity_mva",
                "latitude",
                "longitude",
                "latitude_raw",
                "longitude_raw",
                "coord_flags",
            ],
        )
        w.writeheader()
        for r in rows:
            w.writerow({**r, "coord_flags": ";".join(r["coord_flags"])})

    flagged = [r for r in rows if r["coord_flags"]]
    missing = [r for r in rows if r["latitude"] is None or r["longitude"] is None]
    outside = [r for r in rows if "outside_wb_bbox" in r["coord_flags"]]

    print(f"stations={len(rows)}")
    print(f"districts={len(district_counts)}")
    print(f"total_mva={payload['total_capacity_mva']}")
    print(f"flagged={len(flagged)} missing={len(missing)} outside_wb={len(outside)}")
    print("--- by district ---")
    for d, n in district_counts.items():
        print(f"{d}\t{n}\t{district_mva.get(d, 0):.2f}")
    print("--- outside / missing ---")
    for r in outside + missing:
        print(f"{r['district']}\t{r['name']}\t{r['latitude']}\t{r['longitude']}\t{r['coord_flags']}")


if __name__ == "__main__":
    main()
