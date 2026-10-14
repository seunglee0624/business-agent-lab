"""Builds the trade ship model in a chunky, vanilla-block style.

Outputs ship.png (texture atlas, Venice red), the game's per-city textures, ship.bbmodel (Blockbench, modded entity) and preview_furled.png / preview_open.png.
Units are Blockbench pixels (16 = one block). The ship points north (-Z), about 12 blocks long.
Most boxes are at most one block in each direction so their faces map 1:1 onto 16x16 block-like tiles.
The sail exists twice: "sail_furled" (rolled on the yard, shown while docked) and "sail_open" (hidden in the
file; the game swaps them when the ship leaves).

Run: python make_ship.py  (needs Pillow; matplotlib for the previews)
"""
import base64
import io
import json
import math
import random
import uuid
from pathlib import Path

from PIL import Image

HERE = Path(__file__).parent
TEX = 128

# 16x16 block-like tiles, by top-left corner.
TILE = {
    "planks": (0, 0),      # oak-like planks: hull
    "log": (16, 0),        # stripped log side: mast, yard, rails
    "log_end": (32, 0),    # log rings: cut ends
    "dark": (48, 0),       # spruce-like planks: deck floor, trim
    "wool": (64, 0),       # sail-coloured wool: furled sail
    "rope": (80, 0),       # rope
    "iron": (96, 0),       # pulley blocks
}
SAIL_REGION = (0, 32, 120, 96)   # x, y, width, height of the open sail picture


# Sail cloth per city, matching the banners in the trader screen: (cloth, dark wool, hem).
SAIL_COLORS = {
    "venice": ((184, 40, 36), (140, 28, 28), (128, 24, 24)),
    "genoa": ((44, 74, 170), (32, 54, 130), (26, 44, 110)),
    "alexandria": ((214, 172, 44), (170, 132, 30), (150, 112, 24)),
}


def make_texture(city="venice"):
    cloth, dark_wool, hem = SAIL_COLORS[city]
    wool = tuple(int(c * 0.92) for c in cloth)
    rnd = random.Random(11)
    img = Image.new("RGBA", (TEX, TEX), (0, 0, 0, 0))
    px = img.load()

    def jitter(rgb, amount):
        return tuple(max(0, min(255, c + rnd.randint(-amount, amount))) for c in rgb) + (255,)

    def tile(name, fn):
        tx, ty = TILE[name]
        for y in range(16):
            for x in range(16):
                px[tx + x, ty + y] = fn(x, y)

    def planks(base, seam, end_shift):
        # Four boards, each 4px tall, with a dark seam and one board end per row like vanilla planks.
        def fn(x, y):
            row = y // 4
            if y % 4 == 3:
                return seam + (255,)
            if x == (row * end_shift) % 16:
                return seam + (255,)
            shade = (rnd.randint(-6, 6) + (6 if row % 2 else 0))
            return tuple(max(0, min(255, c + shade)) for c in base) + (255,)
        return fn

    tile("planks", planks((168, 132, 80), (110, 82, 46), 7))
    tile("dark", planks((112, 80, 48), (70, 48, 28), 5))
    tile("log", lambda x, y: jitter((150, 112, 62), 6) if x % 5 else jitter((120, 86, 46), 6))
    def rings(x, y):
        d = max(abs(x - 7.5), abs(y - 7.5))
        return jitter((176, 140, 86), 5) if int(d) % 3 else jitter((132, 98, 56), 5)
    tile("log_end", rings)
    tile("wool", lambda x, y: jitter(wool, 9) if (x + y) % 4 else jitter(dark_wool, 6))
    tile("rope", lambda x, y: (196, 176, 136, 255) if (x + y) % 4 < 2 else (150, 130, 96, 255))
    tile("iron", lambda x, y: jitter((52, 54, 64), 6) if 0 < x < 15 and 0 < y < 15 else (28, 28, 34, 255))

    # Open sail: red cloth with pale seams every 16px (horizontal) and 24px (vertical) and a darker hem.
    sx, sy, sw, sh = SAIL_REGION
    for y in range(sh):
        for x in range(sw):
            if x < 2 or x >= sw - 2 or y < 2 or y >= sh - 2:
                c = jitter(hem, 4)
            elif y % 16 == 0 or x % 24 == 0:
                c = (214, 188, 160, 255)
            else:
                c = jitter(cloth, 7)
            px[sx + x, sy + y] = c
    return img


# ---------------------------------------------------------------- model building
ELEMENTS = []
GROUPS = {}


def group(name, parent="ship", origin=(0, 0, 0), visible=True):
    g = {"name": name, "origin": list(origin), "rotation": [0, 0, 0], "color": 0, "uuid": str(uuid.uuid4()),
         "export": True, "isOpen": True, "locked": False, "visibility": visible, "autouv": 0, "children": []}
    GROUPS[name] = g
    if parent:
        GROUPS[parent]["children"].append(g)


def face_sizes(frm, to):
    sx, sy, sz = (abs(b - a) for a, b in zip(frm, to))
    return {"north": (sx, sy), "south": (sx, sy), "east": (sz, sy), "west": (sz, sy), "up": (sx, sz), "down": (sx, sz)}


def tile_uv(name, w, h):
    tx, ty = TILE[name]
    return [tx, ty, tx + min(w, 16), ty + min(h, 16)]


def cube(grp, name, frm, to, tex, ends=None, uv=None, rotation=None, origin=None):
    """A box textured with tile `tex`; `ends` overrides the faces across the box's longest axis (e.g. log rings)."""
    sizes = face_sizes(frm, to)
    longest = max(range(3), key=lambda i: abs(to[i] - frm[i]))
    end_faces = {0: ("east", "west"), 1: ("up", "down"), 2: ("north", "south")}[longest]
    faces = {}
    for f, (w, h) in sizes.items():
        t = ends if ends and f in end_faces else tex
        faces[f] = {"uv": (uv[f] if uv and f in uv else tile_uv(t, w, h)), "texture": 0}
    el = {"name": name, "box_uv": False, "rescale": False, "locked": False, "render_order": "default",
          "allow_mirror_modeling": True, "from": [round(v, 3) for v in frm], "to": [round(v, 3) for v in to],
          "autouv": 0, "color": 0, "origin": list(origin or [(a + b) / 2 for a, b in zip(frm, to)]),
          "faces": faces, "type": "cube", "uuid": str(uuid.uuid4())}
    if rotation:
        el["rotation"] = [round(r, 2) for r in rotation]
    ELEMENTS.append(el)
    GROUPS[grp]["children"].append(el["uuid"])
    return el


def blocks(grp, name, x0, x1, y0, y1, z0, z1, tex, ends=None):
    """Fills a box with boxes no bigger than one block, so every face shows whole planks."""
    def cuts(a, b):
        out, v = [], a
        while v < b:
            out.append((v, min(b, v + 16)))
            v += 16
        return out
    for xa, xb in cuts(x0, x1):
        for ya, yb in cuts(y0, y1):
            for za, zb in cuts(z0, z1):
                cube(grp, name, (xa, ya, za), (xb, yb, zb), tex, ends)


def rod(grp, name, p0, p1, thick, tex, pulley_at=None):
    """A rope or beam from p0 to p1 lying in the X-Y plane (same z) or the Y-Z plane (same x)."""
    x0, y0, z0 = p0
    x1, y1, z1 = p1
    length = math.dist(p0, p1)
    h = thick / 2
    if abs(x1 - x0) < 1e-6:
        # Tilt about X: three.js turns +Y towards +Z for positive angles.
        rotation = (math.degrees(math.atan2(z1 - z0, y1 - y0)), 0, 0)
    else:
        # Tilt about Z: positive angles turn +Y towards -X.
        rotation = (0, 0, math.degrees(math.atan2(-(x1 - x0), y1 - y0)))
    cube(grp, name, (x0 - h, y0, z0 - h), (x0 + h, y0 + length, z0 + h), tex, rotation=rotation, origin=(x0, y0, z0))
    if pulley_at is not None:
        t = pulley_at
        c = [a + (b - a) * t for a, b in zip(p0, p1)]
        cube(grp, f"{name}_pulley", (c[0] - 2, c[1] - 3, c[2] - 2), (c[0] + 2, c[1] + 3, c[2] + 2), "iron",
             rotation=rotation, origin=tuple(c))


def build():
    group("ship", parent=None)

    # Hull. Bottom: three blocks wide amidships, narrowing and lifting at bow and stern.
    group("hull")
    blocks("hull", "bottom", -24, 24, 0, 16, -64, 80, "planks")
    blocks("hull", "bottom_bow", -16, 16, 4, 20, -80, -64, "planks")
    blocks("hull", "bottom_bow_tip", -8, 8, 10, 26, -92, -80, "planks")
    blocks("hull", "bottom_stern", -16, 16, 4, 20, 80, 92, "planks")
    # Deck floor slightly inset so the planks read as a floor.
    blocks("hull", "deck", -24, 24, 16, 17, -64, 80, "dark")

    # Sides: one block of planks above the deck, stepping up at the ends.
    for sign, side in ((-1, "left"), (1, "right")):
        xa, xb = sorted((sign * 24, sign * 28))
        blocks("hull", f"side_{side}", xa, xb, 4, 32, -64, 80, "planks")
        xa, xb = sorted((sign * 16, sign * 20))
        blocks("hull", f"bow_side_{side}", xa, xb, 16, 40, -80, -64, "planks")
        blocks("hull", f"stern_side_{side}", xa, xb, 16, 40, 80, 92, "planks")
        # Log rail on top of each side.
        xa, xb = sorted((sign * 23, sign * 29))
        blocks("hull", f"rail_{side}", xa, xb, 32, 36, -64, 80, "log", ends="log_end")
    # Bow: a solid raised prow block and a transom across the stern.
    blocks("hull", "prow", -8, 8, 26, 44, -92, -80, "planks")
    blocks("hull", "bow_front", -16, 16, 20, 36, -80, -76, "planks")
    blocks("hull", "transom", -16, 16, 20, 40, 88, 92, "planks")
    # Bowsprit: a log beam leaning forward from the prow.
    rod("hull", "bowsprit", (0, 40, -86), (0, 66, -118), 6, "log")

    # Mast in the middle, with the yard near the top.
    group("rig")
    blocks("rig", "mast", -3, 3, 16, 140, -3, 3, "log", ends="log_end")
    blocks("rig", "yard", -64, 64, 124, 130, -3, 3, "log", ends="log_end")
    cube("rig", "mast_cap", (-4, 140, -4), (4, 144, 4), "dark")

    # Ropes with pulley blocks: forestay to the bowsprit, backstay to the stern, two shrouds per side.
    group("rigging")
    mast_top = (0, 136, 0)
    rod("rigging", "forestay", (0, 62, -114), mast_top, 1.5, "rope", pulley_at=0.35)
    rod("rigging", "backstay", (0, 40, 88), mast_top, 1.5, "rope", pulley_at=0.4)
    for sign, side in ((-1, "left"), (1, "right")):
        for z in (-12, 12):
            rod("rigging", f"shroud_{side}_{z}", (sign * 26, 36, z), (sign * 2, 116, z), 1.5, "rope", pulley_at=0.3)
        # Lines from the yard ends down to the rail, like the picture.
        rod("rigging", f"brace_{side}", (sign * 62, 126, -1), (sign * 26, 36, -1), 1.5, "rope", pulley_at=0.45)

    # Sail rolled up under the yard (docked).
    group("sail_furled")
    blocks("sail_furled", "furled", -60, 60, 114, 124, -5, 5, "wool")

    # Sail let down and filled with wind (sailing): strips bulge forward towards the middle.
    group("sail_open", visible=False)
    sx, sy, sw, sh = SAIL_REGION
    strips = 5
    for i in range(strips):
        y_top = 122 - i * 16
        t = (i + 0.5) / strips
        belly = 2 + 9 * math.sin(math.pi * t)
        uv_row = sy + i * 16
        uv = {"north": [sx, uv_row, sx + sw, uv_row + 16], "south": [sx + sw, uv_row, sx, uv_row + 16]}
        cube("sail_open", f"sail_{i}", (-60, y_top - 16, -belly - 1), (60, y_top, -belly), "wool", uv=uv)


def write():
    tex = make_texture()
    tex.save(HERE / "ship.png")
    buf = io.BytesIO()
    tex.save(buf, "PNG")
    model = {
        "meta": {"format_version": "4.10", "model_format": "modded_entity", "box_uv": False},
        "name": "trade_ship", "model_identifier": "trade_ship",
        "modded_entity_entity_class": "", "modded_entity_version": "Fabric 1.17+",
        "visible_box": [8, 12, 0], "variable_placeholders": "", "variable_placeholder_buttons": [],
        "timeline_setups": [], "unhandled_root_fields": {},
        "resolution": {"width": TEX, "height": TEX},
        "elements": ELEMENTS,
        "outliner": [GROUPS["ship"]],
        "textures": [{
            "path": "", "name": "ship.png", "folder": "", "namespace": "", "id": "0",
            "width": TEX, "height": TEX, "uv_width": TEX, "uv_height": TEX, "particle": False,
            "use_as_default": False, "layers_enabled": False, "sync_to_project": "", "render_mode": "default",
            "render_sides": "auto", "frame_time": 1, "frame_order_type": "loop", "frame_order": "",
            "frame_interpolate": False, "visible": True, "internal": True, "saved": False,
            "uuid": str(uuid.uuid4()),
            "source": "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode(),
        }],
    }
    (HERE / "ship.bbmodel").write_text(json.dumps(model, indent=1))


GAME_ASSETS = HERE.parent.parent / "src/main/resources/assets/harbortrade"


def write_game_model():
    """The model as the game reads it: boxes with per-face UVs, each tagged with its group (for the sail swap)."""
    owner = {}
    for g in GROUPS.values():
        for child in g["children"]:
            if isinstance(child, str):
                owner[child] = g["name"]
    elements = []
    for el in ELEMENTS:
        elements.append({
            "group": owner[el["uuid"]],
            "from": el["from"], "to": el["to"], "origin": el["origin"],
            "rotation": el.get("rotation", [0, 0, 0]),
            "faces": {f: face["uv"] for f, face in el["faces"].items()},
        })
    out = GAME_ASSETS / "models/entity/trade_ship.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"texture_size": TEX, "elements": elements}, separators=(",", ":")))
    for city in SAIL_COLORS:
        tex_out = GAME_ASSETS / f"textures/entity/trade_ship_{city}.png"
        tex_out.parent.mkdir(parents=True, exist_ok=True)
        make_texture(city).save(tex_out)


def preview(open_sail, path):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from mpl_toolkits.mplot3d.art3d import Poly3DCollection

    tex = make_texture().convert("RGB")
    hidden = GROUPS["sail_furled" if open_sail else "sail_open"]["children"]

    def color(el):
        u1, v1, u2, v2 = el["faces"]["north"]["uv"]
        r, g, b = tex.getpixel((int(min(u1, u2)) + 2, int(v1) + 2))
        return (r / 255, g / 255, b / 255)

    def rotate(p, origin, rot):
        x, y, z = (p[i] - origin[i] for i in range(3))
        ax, _, az = (math.radians(r) for r in rot)
        if ax:
            y, z = y * math.cos(ax) - z * math.sin(ax), y * math.sin(ax) + z * math.cos(ax)
        if az:
            x, y = x * math.cos(az) - y * math.sin(az), x * math.sin(az) + y * math.cos(az)
        return (x + origin[0], y + origin[1], z + origin[2])

    idx = [(0, 1, 3, 2), (4, 5, 7, 6), (0, 1, 5, 4), (2, 3, 7, 6), (0, 2, 6, 4), (1, 3, 7, 5)]
    views = [("front", 5, 0), ("three_quarter", 22, -55), ("side", 5, -90)]
    fig = plt.figure(figsize=(15, 5))
    for n, (name, elev, azim) in enumerate(views, 1):
        ax = fig.add_subplot(1, 3, n, projection="3d")
        for el in ELEMENTS:
            if el["uuid"] in hidden:
                continue
            (x1, y1, z1), (x2, y2, z2) = el["from"], el["to"]
            pts = [(x, y, z) for x in (x1, x2) for y in (y1, y2) for z in (z1, z2)]
            if "rotation" in el:
                pts = [rotate(p, el["origin"], el["rotation"]) for p in pts]
            poly = [[(pts[i][2], pts[i][0], pts[i][1]) for i in f] for f in idx]
            ax.add_collection3d(Poly3DCollection(poly, facecolor=color(el), edgecolor=(0, 0, 0, 0.3), linewidths=0.3))
        ax.set_xlim(-120, 120); ax.set_ylim(-120, 120); ax.set_zlim(0, 240)
        ax.set_box_aspect((1, 1, 1))
        ax.view_init(elev=elev, azim=azim)
        ax.set_axis_off()
        ax.set_title(name)
    fig.tight_layout()
    fig.savefig(path, dpi=110)


if __name__ == "__main__":
    build()
    write()
    write_game_model()
    preview(False, HERE / "preview_furled.png")
    preview(True, HERE / "preview_open.png")
    print(f"{len(ELEMENTS)} cubes written")
