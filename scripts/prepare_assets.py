#!/usr/bin/env python3
"""Prepare unpacked Dead Cells assets for the Vite/TypeScript web port."""

from __future__ import annotations

import json
import shutil
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT_SRC = ROOT / "output"
WEB_ROOT = ROOT / "web-port"
PUB_ASSETS = WEB_ROOT / "public" / "assets"
SRC_DATA = WEB_ROOT / "src" / "data"


def parse_batl(path: Path) -> dict[str, list[dict]]:
    data = path.read_bytes()
    if not data.startswith(b"BATL"):
        raise ValueError(f"Not a BATL file: {path}")
    pos = 4
    nlen = data[pos]
    pos += 1
    tex = data[pos : pos + nlen].decode("utf-8")
    pos += nlen

    anims: dict[str, list[dict]] = {}
    while pos < len(data):
        flen = data[pos]
        pos += 1
        if flen == 0:
            if pos >= len(data):
                break
            tlen = data[pos]
            pos += 1
            if tlen == 0:
                break
            tex = data[pos : pos + tlen].decode("utf-8")
            pos += tlen
            continue
        name = data[pos : pos + flen].decode("utf-8")
        pos += flen
        idx, x, y, w, h, dx, dy, orig_w, orig_h = struct.unpack_from("<HHHHHhhHH", data, pos)
        pos += 18

        # Normalize frame group name: strip trailing _00 / _01 etc.
        base = name
        if "_" in name and name.rsplit("_", 1)[-1].isdigit():
            base = name.rsplit("_", 1)[0]
        anims.setdefault(base, []).append(
            {
                "tex": tex,
                "idx": idx,
                "x": x,
                "y": y,
                "w": w,
                "h": h,
                "dx": dx,
                "dy": dy,
                "ow": orig_w,
                "oh": orig_h,
            }
        )

    for k in anims:
        anims[k].sort(key=lambda f: f["idx"])
    return anims


def main() -> None:
    img_dir = PUB_ASSETS / "images"
    atlas_dir = PUB_ASSETS / "atlases"
    sfx_dir = PUB_ASSETS / "sfx"
    data_dir = PUB_ASSETS / "data"
    for d in (img_dir, atlas_dir, sfx_dir, data_dir, SRC_DATA):
        d.mkdir(parents=True, exist_ok=True)

    # 1. Copy texture sheets
    images_to_copy = {
        "beheaded0": OUT_SRC / "atlas" / "beheaded0.png",
        "beheaded1": OUT_SRC / "atlas" / "beheaded1.png",
        "beheaded2": OUT_SRC / "atlas" / "beheaded2.png",
        "beheadedPal": OUT_SRC / "atlas" / "beheaded_default_s.png",
        "agressiveZombi0": OUT_SRC / "atlas" / "AgressiveZombi0.png",
        "skeletonArcher": OUT_SRC / "atlas" / "skeletonArcher.png",
        "behemoth0": OUT_SRC / "atlas" / "behemoth0.png",
        "behemothPal": OUT_SRC / "atlas" / "behemoth_default_s.png",
        "prison": OUT_SRC / "atlas" / "prison.png",
        "bridge": OUT_SRC / "atlas" / "bridge.png",
        "common": OUT_SRC / "atlas" / "common.png",
        "ui": OUT_SRC / "atlas" / "ui.png",
        "cardIcons": OUT_SRC / "cardIcons.png",
        "mobIcons": OUT_SRC / "mobIcons.png",
        "prisonScrollerA": OUT_SRC / "scroller" / "prison" / "prisonScrollerA.png",
        "prisonScrollerB": OUT_SRC / "scroller" / "prison" / "prisonScrollerB.png",
        "prisonStartScrollerA": OUT_SRC / "scroller" / "prison" / "prisonStartScrollerA.png",
        "prisonStartScrollerB": OUT_SRC / "scroller" / "prison" / "prisonStartScrollerB.png",
        "victorPixel8": OUT_SRC / "fonts" / "victor_pixel_8.png",
    }
    image_manifest: dict[str, str] = {}
    for key, src in images_to_copy.items():
        if src.is_file():
            dst = img_dir / src.name
            shutil.copy2(src, dst)
            image_manifest[key] = f"assets/images/{src.name}"

    # 2. Parse & export atlases
    beheaded_keep = (
        "idle", "run", "jump", "fall", "roll", "dodge", "climb", "dive", "slam",
        "hit", "death", "die", "stun", "heal", "drink", "atkSword", "atkSaber",
        "atkBroadSword", "atkBackStabber", "HeavyBow", "block", "parry", "ledge",
    )
    atlases_to_export = {
        "beheaded": OUT_SRC / "atlas" / "beheaded.atlas",
        "zombie": OUT_SRC / "atlas" / "AgressiveZombi.atlas",
        "skeletonArcher": OUT_SRC / "atlas" / "skeletonArcher.atlas",
        "behemoth": OUT_SRC / "atlas" / "behemoth.atlas",
        "prison": OUT_SRC / "atlas" / "prison.atlas",
        "bridge": OUT_SRC / "atlas" / "bridge.atlas",
        "common": OUT_SRC / "atlas" / "common.atlas",
        "ui": OUT_SRC / "atlas" / "ui.atlas",
    }
    atlas_manifest: dict[str, str] = {}
    for key, src in atlases_to_export.items():
        parsed = parse_batl(src)
        if key == "beheaded":
            parsed = {
                k: v
                for k, v in parsed.items()
                if any(p.lower() in k.lower() for p in beheaded_keep)
            }
        dst = atlas_dir / f"{key}.json"
        dst.write_text(json.dumps(parsed, separators=(",", ":")), encoding="utf-8")
        atlas_manifest[key] = f"assets/atlases/{key}.json"
        print(f"Atlas {key}: {len(parsed)} animation groups -> {dst.name}")

    # 3. Copy curated SFX
    sfx_candidates = {
        "step1": "hero/armor_step1.wav",
        "step2": "hero/armor_step2.wav",
        "climb1": "hero/climb1.wav",
        "hitBlade": "weapon/hit_blade.wav",
        "swingShort": "weapon/weapon_shortsw_release.wav",
        "bowShot": "weapon/bow_shot1.wav",
        "absorb": "weapon/absorb.wav",
        "dropGold": "weapon/drop_gold_1.wav",
        "glassBreak": "weapon/glass_break.wav",
        "zombieCharge": "enm/enm_zmb_cc.wav",
        "zombieHit": "enm/enm_zmb_release1.wav",
    }
    # Add first matching sfx for jump, roll, parry, heal, door, stomp if present
    for key, pattern in [
        ("jump", "hero/*jump*.wav"),
        ("roll", "hero/*roll*.wav"),
        ("dodge", "hero/*dodge*.wav"),
        ("land", "hero/*land*.wav"),
        ("parry", "weapon/*parry*.wav"),
        ("heal", "hero/*heal*.wav"),
        ("flask", "hero/*flask*.wav"),
        ("stomp", "hero/*stomp*.wav"),
        ("door", "inter/*door*.wav"),
        ("chest", "inter/*chest*.wav"),
        ("teleport", "inter/*tp*.wav"),
        ("bossRoar", "enm/*behemoth*.wav"),
    ]:
        matches = sorted((OUT_SRC / "sfx").glob(pattern))
        if matches:
            sfx_candidates[key] = str(matches[0].relative_to(OUT_SRC / "sfx"))

    sfx_manifest: dict[str, str] = {}
    for key, rel in sfx_candidates.items():
        src = OUT_SRC / "sfx" / rel
        if src.is_file():
            dst_name = f"{key}.wav"
            shutil.copy2(src, sfx_dir / dst_name)
            sfx_manifest[key] = f"assets/sfx/{dst_name}"

    # 4. Extract clean data.cdb subset
    with (OUT_SRC / "data.cdb").open("r", encoding="utf-8") as f:
        cdb = json.load(f)
    sheets = {s["name"]: s["lines"] for s in cdb["sheets"]}

    truelle_map = {
        r["id"]: {"v0": r.get("value0"), "v1": r.get("value1")}
        for r in sheets["truelle"]
        if r.get("value0") is not None or r.get("value1") is not None
    }
    cdb_out = {
        "truelle": truelle_map,
        "hero": sheets["hero"],
        "tier": sheets["tier"],
        "difficulty": [
            {
                "id": d["id"],
                "difficultyLevel": d.get("difficultyLevel", 0),
                "cellDropMultiplier": d.get("cellDropMultiplier", 1),
                "extraMobDensity": d.get("extraMobDensity", 0),
                "eliteExtraLife": d.get("eliteExtraLife", 0),
                "bossExtraLife": d.get("bossExtraLife", 0),
                "forgeCaps": d.get("forgeCaps", [1, 0.5, 0]),
            }
            for d in sheets["difficulty"]
        ],
        "weapon": sheets["weapon"],
        "item": [
            {
                "id": it["id"],
                "name": it.get("name", it["id"]),
                "tier1": it.get("tier1"),
                "tier2": it.get("tier2"),
                "moneyCost": it.get("moneyCost", 1000),
                "cellCost": it.get("cellCost", 0),
                "castCD": it.get("castCD", 0),
                "icon": it.get("icon"),
                "tags": [t.get("tag") for t in it.get("tags", [])],
                "props": it.get("props", {}),
                "gameplayDesc": it.get("gameplayDesc", ""),
            }
            for it in sheets["item"]
        ],
        "mob": [
            {
                "id": m["id"],
                "name": m.get("name", m["id"]),
                "life": m.get("life", [100]),
                "score": m.get("score", 2),
                "volteDelay": m.get("volteDelay", 0.5),
                "canBeElite": m.get("canBeElite", False),
                "props": m.get("props", {}),
                "skill": m.get("skill", []),
            }
            for m in sheets["mob"]
            if m.get("active", True)
        ],
        "level": [
            {
                "id": lv["id"],
                "name": lv.get("name", lv["id"]),
                "worldDepth": lv.get("worldDepth", 0),
                "baseLootLevel": lv.get("baseLootLevel", 1),
                "tripleUps": lv.get("tripleUps", 0),
                "doubleUps": lv.get("doubleUps", 0),
                "nextLevels": [n.get("level") for n in lv.get("nextLevels", [])],
            }
            for lv in sheets["level"]
        ],
    }
    (data_dir / "cdb.json").write_text(json.dumps(cdb_out, separators=(",", ":")), encoding="utf-8")

    # 4b. Parse BFNT bitmap font (victor_pixel_8.fnt)
    fnt_bytes = (OUT_SRC / "fonts" / "victor_pixel_8.fnt").read_bytes()
    if fnt_bytes.startswith(b"BFNT"):
        p = 6
        nlen = struct.unpack_from("<H", fnt_bytes, p)[0]; p += 2 + nlen
        fsize = struct.unpack_from("<H", fnt_bytes, p)[0]; p += 2
        tlen = struct.unpack_from("<H", fnt_bytes, p)[0]; p += 2 + tlen
        line_h, base_line, _fb = struct.unpack_from("<HHi", fnt_bytes, p); p += 8
        glyphs: dict[str, dict] = {}
        while p + 4 <= len(fnt_bytes):
            code = struct.unpack_from("<I", fnt_bytes, p)[0]; p += 4
            if code == 0 or code > 0x10FFFF or p + 18 > len(fnt_bytes):
                break
            gx, gy, gw, gh, gdx, gdy, gadv, nkern = struct.unpack_from("<HHHHhhHI", fnt_bytes, p)
            p += 18 + nkern * 6
            glyphs[chr(code)] = {"x": gx, "y": gy, "w": gw, "h": gh, "dx": gdx, "dy": gdy, "adv": gadv}
        (data_dir / "victor_pixel_8.json").write_text(
            json.dumps({"tex": "victor_pixel_8.png", "size": fsize, "lineH": line_h, "glyphs": glyphs}, separators=(",", ":")),
            encoding="utf-8",
        )
        print(f"Font victor_pixel_8: {len(glyphs)} glyphs")

    # 5. Generate src/data/assetManifest.ts
    manifest_ts = f"""// Auto-generated by scripts/prepare_assets.py
export const ASSET_MANIFEST = {{
  images: {json.dumps(image_manifest, indent=4)},
  atlases: {json.dumps(atlas_manifest, indent=4)},
  sfx: {json.dumps(sfx_manifest, indent=4)},
  cdb: "assets/data/cdb.json",
}} as const;
"""
    (SRC_DATA / "assetManifest.ts").write_text(manifest_ts, encoding="utf-8")
    print(f"Prepared {len(image_manifest)} images, {len(atlas_manifest)} atlases, {len(sfx_manifest)} sfx, and cdb.json")


if __name__ == "__main__":
    main()
