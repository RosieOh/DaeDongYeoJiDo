"""Shrink CC0 Poly Haven HDRIs into ambient light probes for the journey.

    python3 scripts/pack-hdri.py day=<alps_field_1k.hdr> sunset=<...> night=<...>

Each panorama is halved to 512x256, the sun disc is clamped (the scene's own
directional light already supplies direct sun, so the probe only carries sky
and ground bounce), it is graded toward the matching procedural sky, and it is
written as flat RGBE to public/env/<name>.hdr.
The sun's azimuth in each panorama is printed so the engine can turn the
probe to match its sky.
"""
import math
import struct
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "public" / "env"
# Grade each probe toward its procedural sky so the mood survives: the sunset
# panorama is warmed, the moonlit one dimmed and cooled.
GRADE = {"day": (1.0, 1.0, 1.0), "sunset": (1.35, 0.74, 0.62), "night": (0.32, 0.4, 0.62)}


def read_hdr(path):
    data = Path(path).read_bytes()
    end = data.index(b"\n\n") + 2
    header = data[:end].decode("ascii", "replace")
    assert "32-bit_rle_rgbe" in header, path
    line_end = data.index(b"\n", end)
    _, h, _, w = data[end:line_end].split()
    w, h = int(w), int(h)
    pos = line_end + 1
    pixels = []
    for _ in range(h):
        assert data[pos] == 2 and data[pos + 1] == 2, "only new-style RLE"
        pos += 4
        channels = []
        for _ in range(4):
            row = bytearray()
            while len(row) < w:
                count = data[pos]
                pos += 1
                if count > 128:
                    row.extend(bytes([data[pos]]) * (count - 128))
                    pos += 1
                else:
                    row.extend(data[pos : pos + count])
                    pos += count
            channels.append(row)
        r, g, b, e = channels
        line = []
        for x in range(w):
            if e[x] == 0:
                line.append((0.0, 0.0, 0.0))
            else:
                f = math.ldexp(1.0, e[x] - 136)
                line.append((r[x] * f, g[x] * f, b[x] * f))
        pixels.append(line)
    return w, h, pixels


def rgbe(r, g, b):
    m = max(r, g, b)
    if m < 1e-32:
        return b"\0\0\0\0"
    mantissa, exponent = math.frexp(m)
    f = mantissa * 256.0 / m
    return bytes((int(r * f), int(g * f), int(b * f), exponent + 128))


def write_hdr(path, w, h, pixels):
    out = bytearray(b"#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n")
    out += f"-Y {h} +X {w}\n".encode()
    for line in pixels:
        for p in line:
            out += rgbe(*p)
    Path(path).write_bytes(out)
    print(f"{path}: {len(out) / 1e3:.0f} kB")


def pack(name, src):
    w, h, px = read_hdr(src)
    lum = lambda p: 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]
    # Sun: the brightest pixel. Azimuth uses three.js' equirect convention,
    # u = atan2(z, x) / 2π + 0.5 with the first row at the top.
    best, at = -1.0, (0, 0)
    for y in range(h):
        for x in range(w):
            v = lum(px[y][x])
            if v > best:
                best, at = v, (x, y)
    azimuth = ((at[0] + 0.5) / w - 0.5) * 2 * math.pi
    elevation = (0.5 - (at[1] + 0.5) / h) * math.pi
    sky = sorted(lum(p) for line in px[: h // 2] for p in line)
    cap = sky[int(len(sky) * 0.995)] * 1.5
    small = []
    for y in range(0, h, 2):
        line = []
        for x in range(0, w, 2):
            acc = [0.0, 0.0, 0.0]
            for dy in (0, 1):
                for dx in (0, 1):
                    p = px[y + dy][x + dx]
                    k = min(1.0, cap / max(lum(p), 1e-9))
                    for c in range(3):
                        acc[c] += p[c] * k * GRADE.get(name, (1, 1, 1))[c] / 4
            line.append(tuple(acc))
        small.append(line)
    write_hdr(OUT / f"{name}.hdr", w // 2, h // 2, small)
    print(f"  {name}: sun azimuth {azimuth:.3f} rad, elevation {elevation:.3f} rad, peak {best:.0f}, cap {cap:.1f}")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for arg in sys.argv[1:]:
        name, src = arg.split("=", 1)
        pack(name, src)
