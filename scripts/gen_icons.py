"""Generate PicVault PNG icons without third-party deps."""
from __future__ import annotations

import struct
import zlib
from pathlib import Path


def png(width: int, height: int, rgba_rows: list[bytes]) -> bytes:
    raw = b"".join(rgba_rows)
    compressed = zlib.compress(raw, 9)

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", compressed) + chunk(b"IEND", b"")


def clamp(v: float) -> int:
    return max(0, min(255, int(round(v))))


def rounded_rect_mask(nx: float, ny: float, radius: float = 0.22) -> float:
    """Return coverage 0..1 for rounded square in unit space."""
    # map to -1..1
    x = (nx - 0.5) * 2
    y = (ny - 0.5) * 2
    ax, ay = abs(x), abs(y)
    # inset for corner
    qx = max(ax - (1 - radius), 0)
    qy = max(ay - (1 - radius), 0)
    dist = (qx * qx + qy * qy) ** 0.5 - radius
    # soft AA
    return clamp((0.02 - dist) / 0.04) / 255 * 255  # 0..1 roughly via clamp misuse fix below


def coverage(nx: float, ny: float, radius: float = 0.22) -> float:
    x = (nx - 0.5) * 2
    y = (ny - 0.5) * 2
    ax, ay = abs(x), abs(y)
    qx = max(ax - (1 - radius), 0.0)
    qy = max(ay - (1 - radius), 0.0)
    dist = (qx * qx + qy * qy) ** 0.5 - radius
    # outside positive
    if dist >= 0.03:
        return 0.0
    if dist <= -0.03:
        return 1.0
    return (0.03 - dist) / 0.06


def box_hit(nx: float, ny: float, x0: float, y0: float, x1: float, y1: float, r: float = 0.0) -> bool:
    if r <= 0:
        return x0 <= nx <= x1 and y0 <= ny <= y1
    # rounded
    cx = min(max(nx, x0 + r), x1 - r)
    cy = min(max(ny, y0 + r), y1 - r)
    dx, dy = nx - cx, ny - cy
    return dx * dx + dy * dy <= r * r or (x0 + r <= nx <= x1 - r and y0 <= ny <= y1) or (x0 <= nx <= x1 and y0 + r <= ny <= y1 - r)


def pixel(x: int, y: int, size: int) -> tuple[int, int, int, int]:
    nx = (x + 0.5) / size
    ny = (y + 0.5) / size
    a_bg = coverage(nx, ny, 0.28)
    if a_bg <= 0:
        return (0, 0, 0, 0)

    # ink gradient
    t = ny
    R = 20 * (1 - t) + 12 * t
    G = 26 * (1 - t) + 16 * t
    B = 36 * (1 - t) + 24 * t

    amber = (232, 160, 74)
    amber_d = (196, 120, 42)
    cream = (255, 236, 210)

    # vault body
    body = box_hit(nx, ny, 0.28, 0.36, 0.72, 0.76, 0.06)
    inner = box_hit(nx, ny, 0.36, 0.44, 0.64, 0.66, 0.04)
    lid = box_hit(nx, ny, 0.26, 0.28, 0.74, 0.40, 0.05)
    latch = box_hit(nx, ny, 0.46, 0.18, 0.54, 0.30, 0.02)
    spark = ((nx - 0.72) ** 2 + (ny - 0.30) ** 2) ** 0.5 < 0.035

    if latch:
        R, G, B = amber
    elif lid:
        R, G, B = amber if ny < 0.34 else amber_d
    elif body and not inner:
        # side shading
        if nx < 0.34 or nx > 0.66:
            R, G, B = amber_d
        else:
            R, G, B = amber
    elif spark:
        R, G, B = cream

    return (clamp(R), clamp(G), clamp(B), clamp(a_bg * 255))


def make(size: int) -> bytes:
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            row.extend(pixel(x, y, size))
        rows.append(bytes(row))
    return png(size, size, rows)


def main() -> None:
    out = Path(__file__).resolve().parents[1] / "extension" / "icons"
    out.mkdir(parents=True, exist_ok=True)
    web = Path(__file__).resolve().parents[1] / "website" / "assets"
    web.mkdir(parents=True, exist_ok=True)
    for size in (16, 32, 48, 128):
        data = make(size)
        path = out / f"icon{size}.png"
        path.write_bytes(data)
        print(f"wrote {path} ({len(data)} bytes)")
    (web / "favicon.png").write_bytes(make(32))
    print("wrote favicon")


if __name__ == "__main__":
    main()
