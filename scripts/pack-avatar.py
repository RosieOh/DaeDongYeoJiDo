"""Repack the CC0 VRoid avatar and the CC0 Quaternius animation library for the web.

    python3 scripts/pack-avatar.py <Base_Male.vrm> <AnimationLibrary_Godot_Standard.glb>

Writes public/models/hero.glb and public/models/moves.glb. The VRM extension
(humanoid bone map, expressions) is kept intact; only images are resized and
re-encoded, the hair is darkened to black, and the animation file keeps just
the skeleton and the clips the journey uses.
"""
import io
import json
import struct
import sys
from pathlib import Path

import os

from PIL import Image, ImageFilter, ImageOps

OUT = Path(__file__).resolve().parent.parent / "public" / "models"
# Set PACK_DEBUG=<dir> to also write the repainted garment textures there.
DEBUG = os.environ.get("PACK_DEBUG")
CLIPS = [
    "A_TPose",
    "Idle_Loop",
    "Walk_Loop",
    "Jog_Fwd_Loop",
    "Sprint_Loop",
    "Jump_Start",
    "Jump_Loop",
    "Jump_Land",
    "Roll",
]


def read_glb(path):
    data = Path(path).read_bytes()
    assert data[:4] == b"glTF", path
    json_len = struct.unpack("<I", data[12:16])[0]
    gltf = json.loads(data[20 : 20 + json_len])
    start = 20 + json_len
    bin_len = struct.unpack("<I", data[start : start + 4])[0]
    return gltf, data[start + 8 : start + 8 + bin_len]


def view_bytes(gltf, binary, index):
    view = gltf["bufferViews"][index]
    offset = view.get("byteOffset", 0)
    return binary[offset : offset + view["byteLength"]]


def write_glb(path, gltf, blobs):
    """blobs: list of bytes, one per bufferView in gltf['bufferViews'] order."""
    binary = bytearray()
    for view, blob in zip(gltf["bufferViews"], blobs):
        while len(binary) % 4:
            binary.append(0)
        view["byteOffset"] = len(binary)
        view["byteLength"] = len(blob)
        view["buffer"] = 0
        binary.extend(blob)
    while len(binary) % 4:
        binary.append(0)
    gltf["buffers"] = [{"byteLength": len(binary)}]
    text = json.dumps(gltf, separators=(",", ":"), ensure_ascii=False).encode()
    while len(text) % 4:
        text += b" "
    out = bytearray(b"glTF")
    out += struct.pack("<II", 2, 12 + 8 + len(text) + 8 + len(binary))
    out += struct.pack("<I", len(text)) + b"JSON" + text
    out += struct.pack("<I", len(binary)) + b"BIN\0" + binary
    Path(path).write_bytes(out)
    print(f"{path}: {len(out) / 1e6:.1f} MB")


def prune(gltf, binary):
    """Drop accessors and buffer views nothing references any more."""
    used_accessors = set()
    for mesh in gltf.get("meshes", []):
        for prim in mesh["primitives"]:
            used_accessors.update(prim["attributes"].values())
            if "indices" in prim:
                used_accessors.add(prim["indices"])
            for target in prim.get("targets", []):
                used_accessors.update(target.values())
    for skin in gltf.get("skins", []):
        if "inverseBindMatrices" in skin:
            used_accessors.add(skin["inverseBindMatrices"])
    for anim in gltf.get("animations", []):
        for sampler in anim["samplers"]:
            used_accessors.update((sampler["input"], sampler["output"]))
    accessor_map = {}
    accessors = []
    for i, accessor in enumerate(gltf.get("accessors", [])):
        if i in used_accessors:
            accessor_map[i] = len(accessors)
            accessors.append(accessor)
    used_views = {a["bufferView"] for a in accessors if "bufferView" in a}
    used_views.update(img["bufferView"] for img in gltf.get("images", []) if "bufferView" in img)
    view_map = {}
    views, blobs = [], []
    for i, view in enumerate(gltf["bufferViews"]):
        if i in used_views:
            view_map[i] = len(views)
            views.append(dict(view))
            blobs.append(view_bytes(gltf, binary, i))
    for accessor in accessors:
        if "bufferView" in accessor:
            accessor["bufferView"] = view_map[accessor["bufferView"]]
    for img in gltf.get("images", []):
        if "bufferView" in img:
            img["bufferView"] = view_map[img["bufferView"]]
    for mesh in gltf.get("meshes", []):
        for prim in mesh["primitives"]:
            prim["attributes"] = {k: accessor_map[v] for k, v in prim["attributes"].items()}
            if "indices" in prim:
                prim["indices"] = accessor_map[prim["indices"]]
            prim["targets"] = [
                {k: accessor_map[v] for k, v in t.items()} for t in prim.get("targets", [])
            ]
            if not prim["targets"]:
                del prim["targets"]
    for skin in gltf.get("skins", []):
        if "inverseBindMatrices" in skin:
            skin["inverseBindMatrices"] = accessor_map[skin["inverseBindMatrices"]]
    for anim in gltf.get("animations", []):
        for sampler in anim["samplers"]:
            sampler["input"] = accessor_map[sampler["input"]]
            sampler["output"] = accessor_map[sampler["output"]]
    gltf["accessors"] = accessors
    gltf["bufferViews"] = views
    return blobs


def encode(image, has_alpha):
    buf = io.BytesIO()
    if has_alpha:
        image.save(buf, "PNG", optimize=True)
        return buf.getvalue(), "image/png"
    image.convert("RGB").save(buf, "JPEG", quality=86, optimize=True)
    return buf.getvalue(), "image/jpeg"


ROBE = (244, 241, 234)
INNER = (214, 226, 236)
TRIM = (40, 56, 90)
PANTS = (226, 223, 215)


def recolor(image, pick):
    """Repaint a garment: keep its painted folds (local contrast), swap the colours."""
    rgba = image.convert("RGBA")
    lum = ImageOps.grayscale(rgba.convert("RGB"))
    blur = lum.filter(ImageFilter.GaussianBlur(14))
    w = rgba.width
    out = []
    for i, ((r, g, b, a), l, m) in enumerate(zip(rgba.get_flattened_data(), lum.get_flattened_data(), blur.get_flattened_data())):
        shade = max(0.62, min(1.18, (l + 24) / (m + 24)))
        color = pick(r, g, b, l, (i % w) / w, (i // w) / rgba.height)
        out.append(tuple(min(255, int(c * shade)) for c in color) + (a,))
    rgba.putdata(out)
    return rgba


def tops(r, g, b, l, u, v):
    # The school vest and shirt become a white silk robe with indigo trim.
    if v < 0.34:
        if 0.3 < u < 0.7:
            # The shirt collar becomes an indigo band, the tie a pale inner layer.
            return TRIM if l > 140 else INNER
        return ROBE
    if v > 0.9:
        return TRIM
    if l > 95:
        # The shirt showing inside the V-neck stays pale; piping turns indigo.
        return INNER if abs(u - 0.5) < (0.5 - v) * 0.6 else TRIM
    return ROBE


def bottoms(r, g, b, l, u, v):
    return TRIM if v < 0.055 else PANTS


def pack_avatar(src):
    gltf, binary = read_glb(src)
    blobs = prune(gltf, binary)
    for img in gltf["images"]:
        index = img["bufferView"]
        name = img.get("name", "")
        image = Image.open(io.BytesIO(blobs[index]))
        image.load()
        if name == "Thumbnail":
            image = image.resize((64, 64))
        limit = 1024 if image.width > 1024 else image.width
        if image.width > limit:
            image = image.resize((limit, round(image.height * limit / image.width)), Image.LANCZOS)
        if "HairBack_00" in name and not name.endswith("_nml"):
            # Teal sample hair becomes glossy black for a wuxia topknot.
            rgba = image.convert("RGBA")
            gray = ImageOps.grayscale(rgba).point(lambda v: int(14 + v * 0.18))
            image = Image.merge("RGBA", (gray, gray, gray.point(lambda v: min(255, v + 4)), rgba.getchannel("A")))
        if name.endswith("EyeIris_00"):
            # Blue anime irises become dark brown.
            rgba = image.convert("RGBA")
            l = ImageOps.grayscale(rgba)
            image = Image.merge(
                "RGBA",
                (l.point(lambda v: int(8 + v * 0.42)), l.point(lambda v: int(5 + v * 0.29)), l.point(lambda v: int(4 + v * 0.22)), rgba.getchannel("A")),
            )
        if name.endswith("Tops_01"):
            image = recolor(image, tops)
        if name.endswith("Bottoms_01"):
            image = recolor(image, bottoms)
        if DEBUG and ("Tops" in name or "Bottoms" in name) and not name.endswith("_nml"):
            image.save(Path(DEBUG) / f"{name}.png")
        rgba = image.convert("RGBA")
        has_alpha = rgba.getchannel("A").getextrema()[0] < 250
        normal = name.endswith("_nml")
        blobs[index], mime = encode(rgba if has_alpha else rgba.convert("RGB"), has_alpha and not normal)
        img["mimeType"] = mime
    write_glb(OUT / "hero.glb", gltf, blobs)


def pack_moves(src):
    gltf, binary = read_glb(src)
    gltf["animations"] = [a for a in gltf["animations"] if a["name"] in CLIPS]
    missing = set(CLIPS) - {a["name"] for a in gltf["animations"]}
    assert not missing, missing
    # Keep the skeleton only: no mesh, skin, materials or images.
    for node in gltf["nodes"]:
        node.pop("mesh", None)
        node.pop("skin", None)
    for key in ("meshes", "skins", "materials", "textures", "images", "samplers"):
        gltf.pop(key, None)
    blobs = prune(gltf, binary)
    write_glb(OUT / "moves.glb", gltf, blobs)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    pack_avatar(sys.argv[1])
    pack_moves(sys.argv[2])
