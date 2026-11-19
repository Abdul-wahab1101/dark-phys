#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
keyframes.py - After-Effects-style keyframe engine for Agent 8 (YouTubeFactory)

You describe a composition as JSON / a Python dict (layers + keyframes + easing);
this module turns it into ONE FFmpeg command and renders it.  Pillow is used only
to draw text / shape sprites (PNG).  No NumPy, no MoviePy, no browser.

What you get
  * Per-layer keyframes: x, y, dx, dy, scale, scale_x, scale_y, rotation, opacity, blur
  * Easing: linear, hold, ease, ease_in, ease_out, quad_in/out, sine, expo_in/out,
            back_in/out (overshoot), elastic_out, bounce_out, spring,
            cubic-bezier(x1,y1,x2,y2) (= the AE graph-editor curve)
  * Anchor points (rotate/scale around any point), wiggle(), AE-style layer time
  * Animation presets "in"/"out": fade, fade_up, fade_down, slide_*, pop, zoom_soft,
    drop_bounce, spin_in, grow_x, grow_y, blur_in
  * Layers: text (word/char/line stagger, stroke, shadow, glow, gradient), shape
    (rect / rounded / circle / ellipse, gradient), image, video, solid
  * Camera on the base clip: zoom, pan, rotation keyframes (Ken Burns, push-in, dutch tilt)

Layer time: keyframe times are relative to the layer's `start` (like AE layer time).
Positions: numbers are pixels, "50%" strings are fractions of the frame width/height.

Parenting: a layer may have "id" and "parent" (offsets are relative to the parent's anchor and follow its
rotation/scale); "null" layers are invisible controllers; "seq" layers play a PNG sequence from a concat list.
Image/seq sprites without "w" are in design pixels (scaled with the output size).

Not included (honest list): 3D layers/camera, masks/track mattes, motion
blur, optical flow, expressions language, AE plugins.  `blur` keyframes use FFmpeg
`sendcmd` and are marked EXPERIMENTAL.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import random
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

LIB_VERSION = "1.1.0"
Key = Tuple[float, float, Any]          # (time, value, ease)


# =========================================================================== #
# number / expression helpers
# =========================================================================== #
def _f(v: float) -> str:
    """number -> safe expression literal"""
    s = f"{float(v):.6f}".rstrip("0").rstrip(".")
    if s in ("", "-0"):
        s = "0"
    return f"({s})" if s.startswith("-") else s


def _even(x: float) -> int:
    return max(2, int(math.ceil(x / 2.0)) * 2)


# =========================================================================== #
# easing  (Python reference + FFmpeg expression, kept in sync and tested)
# =========================================================================== #
_C1 = 1.70158
_BOUNCE = (7.5625, 2.75)

EASE_NAMES = ("linear", "hold", "ease", "ease_in_out", "ease_in", "ease_out", "quad_in", "quad_out",
              "sine", "expo_in", "expo_out", "back_in", "back_out", "elastic_out", "bounce_out",
              "spring", "bezier")


def _bezier_table(x1: float, y1: float, x2: float, y2: float, n: int = 20) -> List[float]:
    def bx(s): return 3 * (1 - s) ** 2 * s * x1 + 3 * (1 - s) * s ** 2 * x2 + s ** 3
    def by(s): return 3 * (1 - s) ** 2 * s * y1 + 3 * (1 - s) * s ** 2 * y2 + s ** 3
    out = []
    for j in range(n + 1):
        x = j / n
        lo, hi = 0.0, 1.0
        for _ in range(40):
            mid = (lo + hi) / 2
            if bx(mid) < x:
                lo = mid
            else:
                hi = mid
        out.append(by((lo + hi) / 2))
    return out


def parse_ease(spec: Any) -> Tuple[str, Tuple[float, ...]]:
    """'ease_out' | 'bezier(.25,.1,.25,1)' | ['bezier',.25,.1,.25,1] | None -> (name, params)"""
    if spec is None:
        return ("ease", ())
    if isinstance(spec, (list, tuple)):
        if spec and spec[0] == "bezier":
            return ("bezier", tuple(float(x) for x in spec[1:5]))
        spec = spec[0]
    if isinstance(spec, dict):
        return parse_ease(spec.get("bezier") and ["bezier", *spec["bezier"]] or spec.get("name"))
    s = str(spec).strip().lower().replace("-", "_")
    m = re.match(r"^(?:cubic_)?bezier\(([^)]*)\)$", s)
    if m:
        p = [float(x) for x in m.group(1).split(",")]
        if len(p) != 4:
            raise ValueError("bezier needs 4 numbers")
        return ("bezier", tuple(p))
    m = re.match(r"^(back_out|back_in)\(([\d.]+)\)$", s)
    if m:
        return (m.group(1), (float(m.group(2)),))
    if s == "ease_in_out":
        s = "ease"
    if s not in EASE_NAMES:
        raise ValueError(f"unknown easing '{spec}'. choices: {', '.join(EASE_NAMES)}")
    return (s, ())


def ease_py(e: Tuple[str, Tuple[float, ...]], p: float) -> float:
    name, prm = e
    p = min(1.0, max(0.0, p))
    if name == "linear":
        return p
    if name == "hold":
        return 0.0
    if name == "ease":
        return 4 * p ** 3 if p < 0.5 else 1 - (2 - 2 * p) ** 3 / 2
    if name == "ease_in":
        return p ** 3
    if name == "ease_out":
        return 1 - (1 - p) ** 3
    if name == "quad_in":
        return p * p
    if name == "quad_out":
        return 1 - (1 - p) ** 2
    if name == "sine":
        return (1 - math.cos(math.pi * p)) / 2
    if name == "expo_in":
        return 2 ** (10 * (p - 1))
    if name == "expo_out":
        return 1 - 2 ** (-10 * p)
    if name in ("back_out", "back_in"):
        c1 = _C1 * (prm[0] if prm else 1.0)
        c3 = c1 + 1
        return 1 + c3 * (p - 1) ** 3 + c1 * (p - 1) ** 2 if name == "back_out" else c3 * p ** 3 - c1 * p ** 2
    if name == "elastic_out":
        return 2 ** (-10 * p) * math.sin((p * 10 - 0.75) * 2 * math.pi / 3) + 1
    if name == "bounce_out":
        n1, d1 = _BOUNCE
        if p < 1 / d1:
            return n1 * p * p
        if p < 2 / d1:
            q = p - 1.5 / d1
            return n1 * q * q + 0.75
        if p < 2.5 / d1:
            q = p - 2.25 / d1
            return n1 * q * q + 0.9375
        q = p - 2.625 / d1
        return n1 * q * q + 0.984375
    if name == "spring":
        return 1 - math.exp(-5.5 * p) * math.cos(2 * math.pi * 1.25 * p)
    if name == "bezier":
        tab = _bezier_table(*prm)
        n = len(tab) - 1
        j = min(n - 1, int(p * n))
        f = p * n - j
        return tab[j] + (tab[j + 1] - tab[j]) * f
    raise ValueError(name)


def ease_expr(e: Tuple[str, Tuple[float, ...]], P: str) -> str:
    """FFmpeg expression of the easing curve; P = progress expression (already 0..1)."""
    name, prm = e
    if name == "linear":
        return P
    if name == "hold":
        return "0"
    if name == "ease":
        return f"if(lt({P},0.5),4*({P})*({P})*({P}),1-pow(2-2*({P}),3)/2)"
    if name == "ease_in":
        return f"pow({P},3)"
    if name == "ease_out":
        return f"(1-pow(1-({P}),3))"
    if name == "quad_in":
        return f"({P})*({P})"
    if name == "quad_out":
        return f"(1-(1-({P}))*(1-({P})))"
    if name == "sine":
        return f"((1-cos(PI*({P})))/2)"
    if name == "expo_in":
        return f"pow(2,10*(({P})-1))"
    if name == "expo_out":
        return f"(1-pow(2,-10*({P})))"
    if name in ("back_out", "back_in"):
        c1 = _C1 * (prm[0] if prm else 1.0)
        c3 = c1 + 1
        if name == "back_out":
            return f"(1+{_f(c3)}*pow(({P})-1,3)+{_f(c1)}*pow(({P})-1,2))"
        return f"({_f(c3)}*pow({P},3)-{_f(c1)}*pow({P},2))"
    if name == "elastic_out":
        return f"(pow(2,-10*({P}))*sin((({P})*10-0.75)*2.0943951)+1)"
    if name == "bounce_out":
        n1, d1 = _BOUNCE
        q = lambda a: f"(({P})-{_f(a / d1)})"
        return (f"if(lt({P},{_f(1 / d1)}),{n1}*({P})*({P}),"
                f"if(lt({P},{_f(2 / d1)}),{n1}*{q(1.5)}*{q(1.5)}+0.75,"
                f"if(lt({P},{_f(2.5 / d1)}),{n1}*{q(2.25)}*{q(2.25)}+0.9375,"
                f"{n1}*{q(2.625)}*{q(2.625)}+0.984375)))")
    if name == "spring":
        return f"(1-exp(-5.5*({P}))*cos(7.8539816*({P})))"
    if name == "bezier":
        tab = _bezier_table(*prm)
        n = len(tab) - 1
        terms = []
        for j in range(n):
            slope = (tab[j + 1] - tab[j]) * n
            terms.append(f"{_f(slope)}*max(0,min(({P})-{_f(j / n)},{_f(1 / n)}))")
        return "(" + "+".join(terms) + ")"
    raise ValueError(name)


# =========================================================================== #
# tracks (keyframes of one property) and composable properties
# =========================================================================== #
class Track:
    """keys = [(time, value, ease), ...]  time in seconds (layer-local)."""

    def __init__(self, keys: Sequence[Key]):
        def as_ease(e):
            if isinstance(e, tuple) and len(e) == 2 and isinstance(e[0], str) and isinstance(e[1], tuple):
                return e
            return parse_ease(e)
        ks = sorted(((float(t), float(v), as_ease(e)) for t, v, e in keys), key=lambda k: k[0])
        if not ks:
            raise ValueError("empty track")
        self.keys = ks

    @staticmethod
    def parse(spec: Any, conv=float) -> "Track":
        """spec: number | [[t,v],[t,v,'ease_out'],...]"""
        if isinstance(spec, (int, float)) or isinstance(spec, str):
            return Track([(0.0, conv(spec), "linear")])
        keys = []
        for k in spec:
            t, v = k[0], conv(k[1])
            e = k[2] if len(k) > 2 else "ease"
            if len(k) > 3 and isinstance(e, str) and e.startswith("bezier"):
                e = ["bezier", *k[2:]]
            keys.append((t, v, e))
        return Track(keys)

    def shifted(self, dt: float) -> "Track":
        return Track([(t + dt, v, e) for t, v, e in self.keys])

    @property
    def const(self) -> Optional[float]:
        vs = {v for _, v, _ in self.keys}
        return self.keys[0][1] if len(vs) == 1 else None

    def value(self, t: float) -> float:
        ks = self.keys
        if t <= ks[0][0]:
            return ks[0][1]
        if t >= ks[-1][0]:
            return ks[-1][1]
        for (t0, v0, e), (t1, v1, _) in zip(ks, ks[1:]):
            if t0 <= t < t1:
                return v0 + (v1 - v0) * ease_py(e, (t - t0) / (t1 - t0))
        return ks[-1][1]

    def expr(self, tv: str) -> str:
        if self.const is not None:
            return _f(self.const)
        ks = self.keys
        parts = [f"lt({tv},{_f(ks[0][0])})*{_f(ks[0][1])}"]
        for (t0, v0, e), (t1, v1, _) in zip(ks, ks[1:]):
            if t1 <= t0:
                continue
            win = f"gte({tv},{_f(t0)})*lt({tv},{_f(t1)})"
            if e[0] == "hold" or v0 == v1:
                parts.append(f"{win}*{_f(v0)}")
            else:
                P = f"(({tv}-{_f(t0)})/{_f(t1 - t0)})"
                parts.append(f"{win}*({_f(v0)}+({_f(v1 - v0)})*{ease_expr(e, P)})")
        parts.append(f"gte({tv},{_f(ks[-1][0])})*{_f(ks[-1][1])}")
        return "(" + "+".join(parts) + ")"


class Wiggle:
    """smooth pseudo-random motion (two summed sines), like AE's wiggle()."""

    def __init__(self, freq: float, amp: float, seed: int = 1):
        r = random.Random(seed)
        self.freq, self.amp = freq, amp
        self.p1, self.p2 = r.uniform(0, 6.28), r.uniform(0, 6.28)

    def value(self, t: float) -> float:
        return self.amp * (math.sin(2 * math.pi * self.freq * t + self.p1)
                           + 0.5 * math.sin(2 * math.pi * self.freq * 2.3 * t + self.p2)) / 1.5

    def expr(self, tv: str) -> str:
        return (f"({_f(self.amp)}*(sin(2*PI*{_f(self.freq)}*{tv}+{_f(self.p1)})"
                f"+0.5*sin(2*PI*{_f(self.freq * 2.3)}*{tv}+{_f(self.p2)}))/1.5)")


class Prop:
    """A property = base value/track combined with extra tracks (mode 'mul' or 'add')."""

    def __init__(self, mode: str, default: float):
        self.mode, self.default = mode, default
        self.parts: List[Any] = []

    def add(self, part) -> None:
        self.parts.append(part)

    def _terms(self):
        return self.parts or [self.default]

    def value(self, tl: float, tabs: float) -> float:
        vals = []
        for p in self._terms():
            if isinstance(p, Track):
                vals.append(p.value(tl))
            elif isinstance(p, Wiggle):
                vals.append(p.value(tabs))
            else:
                vals.append(float(p))
        if self.mode == "mul":
            r = 1.0
            for v in vals:
                r *= v
            return r
        return sum(vals)

    def expr(self, tl: str, tabs: str) -> str:
        ex = []
        for p in self._terms():
            if isinstance(p, Track):
                ex.append(p.expr(tl))
            elif isinstance(p, Wiggle):
                ex.append(p.expr(tabs))
            else:
                ex.append(_f(p))
        return "(" + ("*" if self.mode == "mul" else "+").join(ex) + ")"

    @property
    def static(self) -> Optional[float]:
        """constant value if nothing animates"""
        vals = []
        for p in self._terms():
            if isinstance(p, Wiggle):
                return None
            if isinstance(p, Track):
                if p.const is None:
                    return None
                vals.append(p.const)
            else:
                vals.append(float(p))
        if self.mode == "mul":
            r = 1.0
            for v in vals:
                r *= v
            return r
        return sum(vals)


# =========================================================================== #
# animation presets  (modifier tracks, layer-local time, multiplicative/additive)
# =========================================================================== #
_OUT_EASE = {"ease_out": "ease_in", "back_out": "back_in", "bounce_out": "ease_in", "elastic_out": "ease_in",
             "expo_out": "expo_in", "quad_out": "quad_in", "spring": "ease_in", "ease_in": "ease_out"}

PRESET_NAMES = ("fade", "fade_up", "fade_down", "slide_in_left", "slide_in_right", "slide_in_up",
                "slide_in_down", "pop", "zoom_soft", "drop_bounce", "spin_in", "grow_x", "grow_y", "blur_in")


def preset_keys(name: str, d: float, W: int, H: int, dist: float = 0.07) -> Dict[str, List[Key]]:
    """Return {prop: [(t,v,ease)...]} for an IN animation of duration d starting at t=0."""
    o = "ease_out"
    if name == "fade":
        return {"opacity": [(0, 0, o), (d, 1, o)]}
    if name == "fade_up":
        return {"opacity": [(0, 0, o), (d, 1, o)], "dy": [(0, dist * H, o), (d, 0, o)]}
    if name == "fade_down":
        return {"opacity": [(0, 0, o), (d, 1, o)], "dy": [(0, -dist * H, o), (d, 0, o)]}
    if name == "slide_in_left":
        return {"opacity": [(0, 0, o), (d * 0.5, 1, o)], "dx": [(0, -0.35 * W, o), (d, 0, o)]}
    if name == "slide_in_right":
        return {"opacity": [(0, 0, o), (d * 0.5, 1, o)], "dx": [(0, 0.35 * W, o), (d, 0, o)]}
    if name == "slide_in_up":
        return {"opacity": [(0, 0, o), (d * 0.5, 1, o)], "dy": [(0, 0.35 * H, o), (d, 0, o)]}
    if name == "slide_in_down":
        return {"opacity": [(0, 0, o), (d * 0.5, 1, o)], "dy": [(0, -0.35 * H, o), (d, 0, o)]}
    if name == "pop":
        return {"opacity": [(0, 0, "linear"), (d * 0.35, 1, o)], "scale": [(0, 0.55, "back_out"), (d, 1, o)]}
    if name == "zoom_soft":
        return {"opacity": [(0, 0, o), (d, 1, o)], "scale": [(0, 1.14, o), (d, 1, o)]}
    if name == "drop_bounce":
        return {"opacity": [(0, 0, "linear"), (d * 0.15, 1, o)], "dy": [(0, -0.22 * H, "bounce_out"), (d, 0, o)]}
    if name == "spin_in":
        return {"opacity": [(0, 0, o), (d * 0.5, 1, o)], "rotation": [(0, -100, "back_out"), (d, 0, o)],
                "scale": [(0, 0.35, o), (d, 1, o)]}
    if name == "grow_x":
        return {"scale_x": [(0, 0.001, o), (d, 1, o)]}
    if name == "grow_y":
        return {"scale_y": [(0, 0.001, o), (d, 1, o)]}
    if name == "blur_in":
        return {"opacity": [(0, 0, o), (d * 0.7, 1, o)], "blur": [(0, 1, o), (d, 0, o)]}
    raise ValueError(f"unknown preset '{name}'. choices: {', '.join(PRESET_NAMES)}")


def preset_out_keys(name: str, d: float, total: float, W: int, H: int) -> Dict[str, List[Key]]:
    """OUT animation: the IN keys mirrored in time so it ENDS at `total` (layer duration)."""
    src = preset_keys(name, d, W, H)
    out: Dict[str, List[Key]] = {}
    for prop, keys in src.items():
        mirrored = []
        for t, v, e in keys:
            mirrored.append((total - t, v, e))
        mirrored.sort(key=lambda k: k[0])
        fixed = []
        # ease of segment [k_i, k_i+1] comes from key i; after mirroring the segment's
        # start key is the old LATER key -> use the inverse ease
        olds = sorted(keys, key=lambda k: -k[0])
        for (t, v, _), (_, _, oe) in zip(mirrored, olds):
            name_e = parse_ease(oe)[0]
            fixed.append((t, v, _OUT_EASE.get(name_e, name_e)))
        out[prop] = fixed
    return out


# =========================================================================== #
# fonts + sprites (Pillow)
# =========================================================================== #
ROOT = Path(os.environ.get("YF_ROOT") or Path(__file__).resolve().parent.parent)
_FONT_CACHE: Dict[str, List[Path]] = {}


def _font_files() -> List[Path]:
    if "all" in _FONT_CACHE:
        return _FONT_CACHE["all"]
    dirs = [ROOT / "assets" / "fonts", Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts",
            Path.home() / "AppData/Local/Microsoft/Windows/Fonts", Path("/usr/share/fonts"),
            Path("/usr/local/share/fonts"), Path.home() / ".fonts", Path("/Library/Fonts"),
            Path("/System/Library/Fonts")]
    files: List[Path] = []
    for d in dirs:
        try:
            if d.exists():
                files += [p for p in d.rglob("*") if p.suffix.lower() in (".ttf", ".otf")]
        except Exception:
            pass
    _FONT_CACHE["all"] = files
    return files


def find_font(name: Optional[str] = None, bold: bool = True) -> str:
    """Best font file for `name` (e.g. 'Poppins'); falls back to Segoe UI / Arial / DejaVu."""
    files = _font_files()
    want = [name] if name else []
    want += ["poppins", "segoe ui", "arial", "dejavusans", "liberation", "noto sans", "inter"]
    for w in want:
        key = re.sub(r"[\s_-]", "", w.lower())
        hits = [p for p in files if key in re.sub(r"[\s_-]", "", p.stem.lower())]
        if not hits:
            continue

        def score(p: Path) -> int:
            s = re.sub(r"[\s_-]", "", p.stem.lower())
            b = ("bold" in s or s.endswith("b") or "semibold" in s) and "italic" not in s and "oblique" not in s
            return (0 if b == bold else 2) + (1 if "italic" in s or "oblique" in s else 0)
        return str(sorted(hits, key=score)[0])
    raise RuntimeError("no usable font found; put a .ttf in <project>/assets/fonts")


def _hex(c: Any, alpha: int = 255) -> Tuple[int, int, int, int]:
    if isinstance(c, (list, tuple)):
        return (int(c[0]), int(c[1]), int(c[2]), int(c[3]) if len(c) > 3 else alpha)
    h = str(c).lstrip("#")
    if len(h) == 3:
        h = "".join(ch * 2 for ch in h)
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), int(h[6:8], 16) if len(h) >= 8 else alpha)


def _gradient(size: Tuple[int, int], c0, c1, direction: str = "v"):
    from PIL import Image, ImageOps
    w, h = size
    g = Image.linear_gradient("L")
    if direction == "h":
        g = g.rotate(90, expand=True).transpose(Image.FLIP_LEFT_RIGHT)
    elif direction == "d":
        g = g.rotate(45, expand=True, resample=Image.BICUBIC).resize((256, 256))
    g = g.resize((max(1, w), max(1, h)), Image.BILINEAR)
    rgb = ImageOps.colorize(g, _hex(c0)[:3], _hex(c1)[:3]).convert("RGBA")
    return rgb


class Sprite:
    def __init__(self, path: str, w: int, h: int):
        self.path, self.w, self.h = path, w, h


def _hash(obj: Any) -> str:
    return hashlib.sha1(json.dumps(obj, sort_keys=True, default=str).encode()).hexdigest()[:12]


def render_shape(spec: dict, w: int, h: int, outdir: Path) -> Sprite:
    from PIL import Image, ImageDraw
    SS = 3
    kind = spec.get("shape", "rect")
    key = _hash([spec, w, h])
    path = outdir / f"shape_{key}.png"
    if not path.exists():
        W, H = max(2, w) * SS, max(2, h) * SS
        mask = Image.new("L", (W, H), 0)
        d = ImageDraw.Draw(mask)
        r = int(spec.get("radius", min(w, h) * 0.2 if kind == "rounded" else 0) * SS)
        box = (0, 0, W - 1, H - 1)
        if kind in ("circle", "ellipse"):
            d.ellipse(box, fill=255)
        elif kind == "rounded":
            d.rounded_rectangle(box, radius=r, fill=255)
        else:
            d.rectangle(box, fill=255)
        mask = mask.resize((max(2, w), max(2, h)), Image.LANCZOS)
        fill = spec.get("fill", "#FFFFFF")
        if isinstance(fill, (list, tuple)) and len(fill) == 2 and not isinstance(fill[0], int):
            base = _gradient((max(2, w), max(2, h)), fill[0], fill[1], spec.get("gradient", "v"))
        else:
            base = Image.new("RGBA", (max(2, w), max(2, h)), _hex(fill))
        alpha = base.split()[3]
        from PIL import ImageChops
        base.putalpha(ImageChops.multiply(alpha, mask))
        base.save(path)
    return Sprite(str(path), max(2, w), max(2, h))


def _wrap(text: str, font, max_w: float, tracking: float) -> List[str]:
    adv = lambda s: font.getlength(s) + tracking * len(s)
    lines: List[str] = []
    for para in text.split("\n"):
        cur = ""
        for word in para.split(" "):
            trial = (cur + " " + word).strip()
            if cur and max_w and adv(trial) > max_w:
                lines.append(cur)
                cur = word
            else:
                cur = trial
        lines.append(cur)
    return lines


def render_text_units(spec: dict, ratio: float, outdir: Path) -> Tuple[List[dict], float, float]:
    """Returns (units, block_w, block_h) in LOGICAL px (already divided by ratio).
    unit = {path, w, h, cx, cy, index}  cx/cy = unit centre relative to block centre."""
    from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageChops
    size = max(8, int(spec.get("size", 96) * ratio))
    fpath = find_font(spec.get("font"), spec.get("bold", True))
    font = ImageFont.truetype(fpath, size)
    tr = float(spec.get("tracking", 0)) * ratio
    text = str(spec.get("text", ""))
    if spec.get("uppercase"):
        text = text.upper()
    max_w = float(spec.get("max_width", 0)) * ratio
    lines = _wrap(text, font, max_w, tr)
    asc, desc = font.getmetrics()
    lh = (asc + desc) * float(spec.get("line_spacing", 1.08))
    adv = lambda s: font.getlength(s) + tr * len(s)
    line_w = [adv(l) for l in lines]
    bw, bh = max(line_w + [1]), lh * (len(lines) - 1) + asc + desc
    align = spec.get("align", "center")
    split = spec.get("split", "none")

    # segments: list of (string, x, y) per unit
    units: List[Tuple[List[Tuple[str, float, float]], Tuple[float, float, float, float]]] = []
    for li, line in enumerate(lines):
        x0 = {"left": 0.0, "center": (bw - line_w[li]) / 2, "right": bw - line_w[li]}[align]
        y0 = li * lh
        if split == "lines" or split == "none":
            continue
        cursor = x0
        words = line.split(" ")
        for wi, word in enumerate(words):
            if split == "words":
                units.append(([(word, cursor, y0)], (cursor, y0, cursor + adv(word), y0 + asc + desc)))
            else:  # chars
                cx = cursor
                for ch in word:
                    units.append(([(ch, cx, y0)], (cx, y0, cx + adv(ch), y0 + asc + desc)))
                    cx += adv(ch)
            cursor += adv(word) + adv(" ")
    if split == "lines":
        for li, line in enumerate(lines):
            x0 = {"left": 0.0, "center": (bw - line_w[li]) / 2, "right": bw - line_w[li]}[align]
            units.append(([(line, x0, li * lh)], (x0, li * lh, x0 + line_w[li], li * lh + asc + desc)))
    if split == "none" or not units:
        segs = []
        for li, line in enumerate(lines):
            x0 = {"left": 0.0, "center": (bw - line_w[li]) / 2, "right": bw - line_w[li]}[align]
            segs.append((line, x0, li * lh))
        units = [(segs, (0.0, 0.0, bw, bh))]

    fill = spec.get("fill", spec.get("color", "#FFFFFF"))
    stroke = spec.get("stroke")                        # {"width":4,"color":"#000"}
    shadow = spec.get("shadow")                        # {"dx":0,"dy":6,"blur":10,"color":"#000","alpha":0.6}
    glow = spec.get("glow")                            # {"blur":18,"color":"#FFC400","alpha":0.8}
    sw = int((stroke or {}).get("width", 0) * ratio)
    pad = int(sw + 4 * ratio + max((shadow or {}).get("blur", 0) * 2 + abs((shadow or {}).get("dy", 0)) + abs((shadow or {}).get("dx", 0)), (glow or {}).get("blur", 0) * 2.2) * ratio)
    out_units = []
    for idx, (segs, (ux0, uy0, ux1, uy1)) in enumerate(units):
        w, h = int(math.ceil(ux1 - ux0)) + 2 * pad, int(math.ceil(uy1 - uy0)) + 2 * pad
        key = _hash([spec, ratio, idx, segs])
        path = outdir / f"text_{key}.png"
        if not path.exists():
            def mask_of(stroke_w: int):
                m = Image.new("L", (w, h), 0)
                dr = ImageDraw.Draw(m)
                for s, x, y in segs:
                    px_, py_ = x - ux0 + pad, y - uy0 + pad
                    if tr == 0:
                        dr.text((px_, py_), s, font=font, fill=255, anchor="la", stroke_width=stroke_w, stroke_fill=255)
                    else:
                        for ch in s:
                            dr.text((px_, py_), ch, font=font, fill=255, anchor="la", stroke_width=stroke_w, stroke_fill=255)
                            px_ += font.getlength(ch) + tr
                return m
            fill_mask = mask_of(0)
            sil = mask_of(sw) if sw else fill_mask
            canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
            if glow:
                gm = sil.filter(ImageFilter.GaussianBlur((glow.get("blur", 16)) * ratio))
                gm = gm.point(lambda v, a=glow.get("alpha", 0.8): min(255, int(v * a * 1.6)))
                g = Image.new("RGBA", (w, h), _hex(glow.get("color", "#FFFFFF")))
                g.putalpha(gm)
                canvas = Image.alpha_composite(canvas, g)
            if shadow:
                sm = ImageChops.offset(sil, int(shadow.get("dx", 0) * ratio), int(shadow.get("dy", 6) * ratio))
                sm = sm.filter(ImageFilter.GaussianBlur(shadow.get("blur", 8) * ratio))
                sm = sm.point(lambda v, a=shadow.get("alpha", 0.6): int(v * a))
                s = Image.new("RGBA", (w, h), _hex(shadow.get("color", "#000000")))
                s.putalpha(sm)
                canvas = Image.alpha_composite(canvas, s)
            if sw:
                st = Image.new("RGBA", (w, h), _hex(stroke.get("color", "#000000")))
                st.putalpha(sil)
                canvas = Image.alpha_composite(canvas, st)
            if isinstance(fill, (list, tuple)) and len(fill) == 2 and not isinstance(fill[0], int):
                fl = _gradient((w, h), fill[0], fill[1], spec.get("gradient", "v"))
            else:
                fl = Image.new("RGBA", (w, h), _hex(fill))
            fl.putalpha(ImageChops.multiply(fl.split()[3], fill_mask))
            canvas = Image.alpha_composite(canvas, fl)
            canvas.save(path)
        out_units.append(dict(path=str(path), w=w, h=h, index=idx,
                              cx=((ux0 + ux1) / 2 - bw / 2) / ratio, cy=((uy0 + uy1) / 2 - bh / 2) / ratio))
    return out_units, bw / ratio, bh / ratio


# =========================================================================== #
# composition compiler
# =========================================================================== #
ANCHORS = {"center": (0.5, 0.5), "top-left": (0.0, 0.0), "top": (0.5, 0.0), "top-right": (1.0, 0.0),
           "left": (0.0, 0.5), "right": (1.0, 0.5), "bottom-left": (0.0, 1.0), "bottom": (0.5, 1.0),
           "bottom-right": (1.0, 1.0)}


class Plan:
    """one drawable item (a layer, or one text unit of a split text layer)"""
    pass


def find_ffmpeg() -> Tuple[str, str]:
    ff = os.environ.get("FFMPEG_PATH") or shutil.which("ffmpeg")
    fp = os.environ.get("FFPROBE_PATH") or shutil.which("ffprobe")
    if not ff or not fp:
        raise SystemExit("ffmpeg/ffprobe not found on PATH")
    return ff, fp


class Comp:
    def __init__(self, tl: dict, workdir: Path, base_dir: Optional[Path] = None,
                 out_size: Optional[Tuple[int, int]] = None):
        self.tl = tl
        self.dW, self.dH = int(tl.get("width", 1080)), int(tl.get("height", 1920))
        self.W, self.H = (int(out_size[0]), int(out_size[1])) if out_size else (self.dW, self.dH)
        self.k = self.W / self.dW                       # design px -> output px
        self.fps = int(tl.get("fps", 24))
        self.dur = float(tl["duration"])
        self.N = int(round(self.dur * self.fps))
        self.wd = Path(workdir)
        self.assets = self.wd / "assets"
        self.assets.mkdir(parents=True, exist_ok=True)
        self.base_dir = Path(base_dir) if base_dir else Path.cwd()
        self.inputs: List[List[str]] = []
        self.parts: List[str] = []
        self.notes: List[str] = []
        self.cmdfiles: List[str] = []
        self.by_id: Dict[str, Any] = {}
        self.plans: List[Any] = []

    # ---- units ------------------------------------------------------------- #
    def px(self, v: Any, axis: str) -> float:
        """number = design pixels (scaled to output); '50%' = fraction of the output frame axis"""
        if isinstance(v, str) and v.strip().endswith("%"):
            return float(v.strip()[:-1]) / 100.0 * (self.W if axis == "x" else self.H)
        return float(v) * self.k

    def path(self, p: str) -> str:
        q = Path(p)
        if not q.is_absolute():
            q = (self.base_dir / q) if (self.base_dir / q).exists() else q
        if not q.exists():
            raise FileNotFoundError(f"file not found: {p}")
        return str(q.resolve())

    def add_input(self, args: List[str]) -> int:
        self.inputs.append(args)
        return len(self.inputs) - 1

    # ---- properties -------------------------------------------------------- #
    def props(self, layer: dict, delay: float, dl: float, seed: int) -> Dict[str, Prop]:
        parented = bool(layer.get("parent"))
        P = {"x": Prop("add", 0.0 if parented else self.W / 2), "y": Prop("add", 0.0 if parented else self.H / 2), "dx": Prop("add", 0.0),
             "dy": Prop("add", 0.0), "scale": Prop("mul", 1.0), "scale_x": Prop("mul", 1.0),
             "scale_y": Prop("mul", 1.0), "rotation": Prop("add", 0.0), "opacity": Prop("mul", 1.0),
             "blur": Prop("add", 0.0)}
        axis = {"x": "x", "y": "y", "dx": "x", "dy": "y"}
        for key, prop in P.items():
            if key in layer and layer[key] is not None:
                conv = (lambda v, a=axis[key]: self.px(v, a)) if key in axis else float
                if key in ("x", "y") and isinstance(layer[key], (int, float, str)):
                    prop.parts = [Track.parse(layer[key], conv)]
                else:
                    tr = Track.parse(layer[key], conv)
                    prop.parts.append(tr.shifted(delay) if key not in ("x", "y") else tr)
        # animation presets (modifiers)
        def spec_of(s):
            if s is None:
                return None
            return {"name": s, "dur": 0.5} if isinstance(s, str) else dict(s)
        ins, outs = spec_of(layer.get("in")), spec_of(layer.get("out"))
        if ins:
            d = float(ins.get("dur", 0.5))
            for prop, keys in preset_keys(ins["name"], d, self.W, self.H).items():
                P[prop].add(Track(keys).shifted(delay + float(ins.get("delay", 0))))
        if outs:
            d = float(outs.get("dur", 0.4))
            for prop, keys in preset_out_keys(outs["name"], d, dl - float(outs.get("delay", 0)), self.W, self.H).items():
                P[prop].add(Track(keys))
        wg = layer.get("wiggle")
        if wg:
            for w in (wg if isinstance(wg, list) else [wg]):
                tgt = {"x": "dx", "y": "dy"}.get(w.get("prop", "y"), w.get("prop", "y"))
                P[tgt].add(Wiggle(float(w.get("freq", 2)), float(w.get("amp", 6)) * (self.k if tgt in ("dx", "dy") else 1),
                                  int(w.get("seed", 1)) + seed))
        return P

    # ---- plans ------------------------------------------------------------- #
    def make_plans(self, layer: dict, li: int) -> List[Plan]:
        typ = layer.get("type", "text")
        start = float(layer.get("start", 0.0))
        end = float(layer.get("end", self.dur))
        end = min(end, self.dur)
        dl = max(0.05, end - start)
        anc = layer.get("anchor", "center")
        fx, fy = ANCHORS[anc] if isinstance(anc, str) else (float(anc[0]), float(anc[1]))
        plans: List[Plan] = []

        def finish(p: Plan, **kw):
            p.start, p.end, p.dl = start, end, dl
            p.fx, p.fy = fx, fy
            p.id = layer.get("id")
            p.parent = layer.get("parent")
            for a, b in kw.items():
                setattr(p, a, b)
            plans.append(p)

        if typ == "text":
            spec = dict(layer)
            kk = self.k
            for key in ("size", "max_width", "tracking"):
                if key in spec:
                    spec[key] = float(spec[key]) * kk
            for sub, keys in (("stroke", ("width",)), ("shadow", ("dx", "dy", "blur")), ("glow", ("blur",))):
                if spec.get(sub):
                    spec[sub] = dict(spec[sub])
                    for q in keys:
                        if q in spec[sub]:
                            spec[sub][q] = float(spec[sub][q]) * kk
            spec.setdefault("size", 96 * kk)
            # sprite supersampling so scale-ups stay sharp
            scale_probe = self.props(layer, 0, dl, 0)["scale"]
            mx = 1.0
            for part in scale_probe.parts:
                if isinstance(part, Track):
                    mx = max(mx, max(v for _, v, _ in part.keys))
            ratio = min(2.0, mx)
            units, bw, bh = render_text_units(spec, ratio, self.assets)
            n = len(units)
            stagger = float(layer.get("stagger", 0.0))
            order = layer.get("stagger_order", "forward")
            idxs = list(range(n))
            if order == "reverse":
                idxs = idxs[::-1]
            elif order == "center":
                idxs = sorted(idxs, key=lambda i: abs(i - (n - 1) / 2))
            elif order == "random":
                random.Random(int(layer.get("seed", 1))).shuffle(idxs)
            rank = {u: r for r, u in enumerate(idxs)}
            for u in units:
                p = Plan()
                delay = stagger * rank[u["index"]] if n > 1 else 0.0
                p.kind, p.src, p.pw, p.ph, p.ratio = "png", u["path"], u["w"], u["h"], ratio
                if n > 1:     # split text: each unit pivots around its own centre, block anchored at (fx, fy)
                    p.ox, p.oy = u["cx"] + (0.5 - fx) * bw, u["cy"] + (0.5 - fy) * bh
                else:
                    p.ox, p.oy = 0.0, 0.0
                p.props = self.props(layer, delay, dl, u["index"])
                finish(p)
                if n > 1:
                    p.fx, p.fy = 0.5, 0.5
            return plans
        if typ == "null":                       # invisible control layer (AE "null object") for parenting
            p = Plan()
            p.kind, p.src, p.pw, p.ph, p.ratio, p.ox, p.oy = "null", None, 2, 2, 1.0, 0.0, 0.0
            p.props = self.props(layer, 0.0, dl, li)
            finish(p)
            return plans
        if typ == "seq":                         # image sequence described by an ffmpeg concat list (see cartoon.py)
            p = Plan()
            p.kind, p.src, p.pw, p.ph, p.ratio, p.ox, p.oy = "seq", self.path(layer["src"]), int(layer["pw"]), int(layer["ph"]), 1.0 / self.k, 0.0, 0.0
            p.props = self.props(layer, 0.0, dl, li)
            finish(p)
            return plans
        if typ == "shape":
            w = int(round(self.px(layer.get("w", 200), "x")))
            h = int(round(self.px(layer.get("h", 200), "y")))
            spec = dict(layer)
            if "radius" in spec:
                spec["radius"] = float(spec["radius"]) * self.k
            sp = render_shape(spec, w, h, self.assets)
            p = Plan()
            p.kind, p.src, p.pw, p.ph, p.ratio, p.ox, p.oy = "png", sp.path, sp.w, sp.h, 1.0, 0.0, 0.0
            p.props = self.props(layer, 0.0, dl, li)
            finish(p)
            return plans
        if typ == "image":
            from PIL import Image
            path = self.path(layer["src"])
            with Image.open(path) as im:
                iw, ih = im.size
            disp_w = self.px(layer["w"], "x") if "w" in layer else iw * self.k      # no "w": native px = design px
            f = disp_w / iw
            p = Plan()
            p.kind, p.src, p.pw, p.ph, p.ratio, p.ox, p.oy = "png", path, iw, ih, 1.0 / f if f else 1.0, 0.0, 0.0
            p.props = self.props(layer, 0.0, dl, li)
            finish(p)
            return plans
        if typ == "video":
            w = int(round(self.px(layer.get("w", "100%"), "x")))
            h = int(round(self.px(layer.get("h", "100%"), "y")))
            p = Plan()
            p.kind, p.src, p.pw, p.ph, p.ratio, p.ox, p.oy = "video", self.path(layer["src"]), w, h, 1.0, 0.0, 0.0
            p.ss, p.loop = float(layer.get("ss", 0.0)), bool(layer.get("loop", True))
            p.props = self.props(layer, 0.0, dl, li)
            finish(p)
            return plans
        if typ == "solid":
            w = int(round(self.px(layer.get("w", "100%"), "x")))
            h = int(round(self.px(layer.get("h", "100%"), "y")))
            p = Plan()
            p.kind, p.src, p.pw, p.ph, p.ratio, p.ox, p.oy = "solid", layer.get("color", "#000000"), w, h, 1.0, 0.0, 0.0
            p.props = self.props(layer, 0.0, dl, li)
            finish(p)
            return plans
        raise ValueError(f"unknown layer type '{typ}' (text, shape, image, video, solid, null, seq)")

    # ---- base + camera ----------------------------------------------------- #
    def build_base(self) -> str:
        W, H, fps, D = self.W, self.H, self.fps, self.dur
        base = self.tl.get("base", {"type": "color", "color": "#000000"})
        kind = base.get("type", "color")
        if kind == "color":
            c = _hex(base.get("color", "#000000"))
            self.parts.append(f"color=c=0x{c[0]:02x}{c[1]:02x}{c[2]:02x}:s={W}x{H}:r={fps}:d={_f(D)},format=yuv420p,setsar=1[base0]")
        elif kind == "gradient":
            from PIL import Image
            g = _gradient((W, H), base.get("c0", "#0b1220"), base.get("c1", "#1c3a66"), base.get("direction", "v"))
            pth = self.assets / f"grad_{_hash(base)}_{W}x{H}.png"
            g.convert("RGB").save(pth)
            i = self.add_input(["-loop", "1", "-framerate", str(fps), "-t", _f(D + 0.2), "-i", str(pth)])
            self.parts.append(f"[{i}:v]fps={fps},format=yuv420p,setsar=1[base0]")
        elif kind in ("video", "image"):
            src = self.path(base["src"])
            if kind == "video":
                args = []
                if base.get("ss"):
                    args += ["-ss", str(base["ss"])]
                if base.get("loop", True):
                    args += ["-stream_loop", "-1"]
                args += ["-i", src]
            else:
                args = ["-loop", "1", "-framerate", str(fps), "-t", _f(D + 0.2), "-i", src]
            i = self.add_input(args)
            self.parts.append(f"[{i}:v]setpts=PTS-STARTPTS,fps={fps},scale={W}:{H}:force_original_aspect_ratio=increase:flags=bicubic,"
                              f"crop={W}:{H},setsar=1,format=yuv420p[base0]")
        else:
            raise ValueError("base.type: color, gradient, video, image")
        cam = base.get("camera")
        if not cam:
            return "base0"
        z, cx, cy, rot = Prop("mul", 1.0), Prop("add", 0.0), Prop("add", 0.0), Prop("add", 0.0)
        if "zoom" in cam:
            z.parts = [Track.parse(cam["zoom"], float)]
        if "x" in cam:
            cx.parts = [Track.parse(cam["x"], lambda v: self.px(v, "x"))]
        if "y" in cam:
            cy.parts = [Track.parse(cam["y"], lambda v: self.px(v, "y"))]
        if "rotation" in cam:
            rot.parts = [Track.parse(cam["rotation"], float)]
        zmin = 1.0
        if rot.static != 0.0:
            mx = max(abs(rot.value(t / 10.0, t / 10.0)) for t in range(int(D * 10) + 1))
            th = math.radians(mx)
            zmin = math.cos(th) + math.sin(th) * max(W / H, H / W)
        chain = []
        if rot.static != 0.0:
            chain.append(f"rotate=a='{rot.expr('t', 't')}*PI/180':ow=iw:oh=ih:c=black")
        zs, xs, ys = z.static, cx.static, cy.static
        if not (zs == 1.0 and zmin == 1.0 and xs == 0.0 and ys == 0.0):
            ze = f"(({z.expr('t', 't')})*{_f(zmin)})"
            chain.append(f"scale=w='2*trunc({W}*{ze}/2)':h='2*trunc({H}*{ze}/2)':eval=frame:flags=bicubic")
            chain.append(f"crop={W}:{H}:'max(0,min(iw-{W},(iw-{W})/2+{cx.expr('t', 't')}))':"
                         f"'max(0,min(ih-{H},(ih-{H})/2+{cy.expr('t', 't')}))'")
        if not chain:
            return "base0"
        self.parts.append("[base0]" + ",".join(chain) + ",setsar=1[base1]")
        return "base1"

    # ---- parenting ---------------------------------------------------------- #
    def _local(self, p: Plan):
        tl_, ta_ = f"(t-{_f(p.start)})", "t"
        P = p.props
        lx = f"({P['x'].expr(tl_, ta_)}+{P['dx'].expr(tl_, ta_)}+{_f(p.ox)})"
        ly = f"({P['y'].expr(tl_, ta_)}+{P['dy'].expr(tl_, ta_)}+{_f(p.oy)})"
        return lx, ly, P["rotation"].expr(tl_, ta_), P["scale"].expr(tl_, ta_)

    def world(self, p: Plan):
        """(X, Y, rotation_deg, scale) expressions of a plan including all its ancestors."""
        lx, ly, rot, sc = self._local(p)
        par = self.by_id.get(p.parent) if p.parent else None
        if p.parent and par is None:
            raise ValueError(f"parent '{p.parent}' not found (parents must be defined BEFORE their children)")
        if par is None:
            return lx, ly, rot, sc
        PX, PY, PR, PS = self.world(par)
        th = f"(({PR})*PI/180)"
        X = f"({PX}+({PS})*(({lx})*cos({th})-({ly})*sin({th})))"
        Y = f"({PY}+({PS})*(({lx})*sin({th})+({ly})*cos({th})))"
        return X, Y, f"(({rot})+({PR}))", f"(({sc})*({PS}))"

    def world_static(self, p: Plan):
        """(rotation, scale) if nothing animates in the chain, else None for that entry."""
        r, s_ = p.props["rotation"].static, p.props["scale"].static
        par = self.by_id.get(p.parent) if p.parent else None
        if par is not None:
            pr, ps = self.world_static(par)
            r = None if (r is None or pr is None) else r + pr
            s_ = None if (s_ is None or ps is None) else s_ * ps
        return r, s_

    def world_py(self, p: Plan, t: float):
        """Python reference of world(): (x, y, rotation, scale) at absolute time t."""
        P = p.props
        tl = t - p.start
        lx = P["x"].value(tl, t) + P["dx"].value(tl, t) + p.ox
        ly = P["y"].value(tl, t) + P["dy"].value(tl, t) + p.oy
        rot, sc = P["rotation"].value(tl, t), P["scale"].value(tl, t)
        par = self.by_id.get(p.parent) if p.parent else None
        if par is None:
            return lx, ly, rot, sc
        px, py, pr, ps = self.world_py(par, t)
        th = math.radians(pr)
        return (px + ps * (lx * math.cos(th) - ly * math.sin(th)),
                py + ps * (lx * math.sin(th) + ly * math.cos(th)), rot + pr, sc * ps)

    # ---- one layer --------------------------------------------------------- #
    def emit(self, p: Plan, k: int, below: str) -> str:
        fps = self.fps
        s, dl = p.start, p.dl
        pw, ph = p.pw, p.ph
        P = p.props
        tl_, ta_ = f"(t-{_f(s)})", "t"
        chain: List[str] = []
        pre: List[str] = []
        if p.kind == "png":
            i = self.add_input(["-loop", "1", "-framerate", str(fps), "-t", _f(dl + 0.1), "-i", p.src])
            head = f"[{i}:v]"
        elif p.kind == "seq":
            i = self.add_input(["-f", "concat", "-safe", "0", "-t", _f(dl + 0.1), "-i", p.src])
            head = f"[{i}:v]"
            chain.append(f"fps={fps}")
        elif p.kind == "video":
            args = []
            if p.ss:
                args += ["-ss", str(p.ss)]
            if p.loop:
                args += ["-stream_loop", "-1"]
            args += ["-t", _f(dl + 0.1), "-i", p.src]
            i = self.add_input(args)
            head = f"[{i}:v]"
            chain.append(f"fps={fps},scale={pw}:{ph}:force_original_aspect_ratio=increase:flags=bicubic,crop={pw}:{ph}")
        else:
            c = _hex(p.src)
            head = f"color=c=0x{c[0]:02x}{c[1]:02x}{c[2]:02x}:s={pw}x{ph}:r={fps}:d={_f(dl + 0.1)},"
        chain.append(f"setpts=PTS-STARTPTS+{_f(s)}/TB")
        chain.append("format=rgba")
        cw, ch, fxo, fyo = pw, ph, p.fx, p.fy

        # blur (experimental, sendcmd)
        blur_max = float(self.tl.get("blur_max", 24)) * self.k
        if P["blur"].static != 0.0:
            padb = int(blur_max * 1.5)
            chain.append(f"pad={pw + 2 * padb}:{ph + 2 * padb}:{padb}:{padb}:color=black@0")
            cw, ch = pw + 2 * padb, ph + 2 * padb
            lines, last = [], None
            frames = int(round(dl * fps)) + 2
            for n in range(frames):
                tabs = s + n / fps
                v = max(0.01, P["blur"].value(tabs - s, tabs) * blur_max)
                if last is None or abs(v - last) > 0.05:
                    lines.append(f"{max(0.0, tabs - 0.001):.4f} gblur@b{k} sigma {v:.3f};")
                    last = v
            name = f"blur_{k}.txt"
            (self.wd / name).write_text("\n".join(lines) + "\n")
            chain.append(f"sendcmd=f={name}")
            chain.append(f"gblur@b{k}=sigma=0.01")
            fxo, fyo = (p.fx * pw + padb) / cw, (p.fy * ph + padb) / ch
            self.notes.append("blur keyframes used (EXPERIMENTAL)")
        # rotation: put the anchor in the middle of a square canvas first
        WX, WY, WR, WS = self.world(p)
        wrot, wscale = self.world_static(p)
        if wrot != 0.0:
            ax, ay = fxo * cw, fyo * ch
            far = max(math.hypot(x - ax, y - ay) for x in (0, cw) for y in (0, ch))
            S = _even(2 * far + 4)
            chain.append(f"pad={S}:{S}:{int(S / 2 - ax)}:{int(S / 2 - ay)}:color=black@0")
            chain.append(f"rotate=a='({WR})*PI/180':ow={S}:oh={S}:c=black@0")
            cw = ch = S
            fxo = fyo = 0.5
        # opacity
        op = P["opacity"]
        sub: List[str] = []
        if op.static is None:
            gray = (f"color=c=white:s=16x16:r={fps}:d={_f(dl + 0.1)},setpts=PTS-STARTPTS+{_f(s)}/TB,format=gray,"
                    f"geq=lum='255*max(0,min(1,{op.expr('(T-' + _f(s) + ')', 'T')}))',scale={cw}:{ch}:flags=neighbor,format=gray[g{k}]")
            self.parts.append(f"{head}{','.join(chain)},split[c{k}][a{k}]")
            self.parts.append(f"[a{k}]alphaextract,format=gray[ae{k}]")
            self.parts.append(gray)
            self.parts.append(f"[ae{k}][g{k}]blend=all_mode=multiply[am{k}]")
            self.parts.append(f"[c{k}][am{k}]alphamerge[m{k}]")
            chain = []
            head = f"[m{k}]"
        elif op.static < 0.999:
            chain.append(f"colorchannelmixer=aa={_f(op.static)}")
        # scale
        inv = 1.0 / p.ratio
        sc, sx, sy = P["scale"], P["scale_x"], P["scale_y"]
        if wscale is not None and sx.static is not None and sy.static is not None:
            w_ = _even(cw * wscale * sx.static * inv)
            h_ = _even(ch * wscale * sy.static * inv)
            if (w_, h_) != (cw, ch):
                chain.append(f"scale={w_}:{h_}:flags=bicubic")
        else:
            fs = WS
            wex = f"2*trunc(max(2,{cw}*({fs})*({sx.expr(tl_, ta_)})*{_f(inv)})/2)"
            hex_ = f"2*trunc(max(2,{ch}*({fs})*({sy.expr(tl_, ta_)})*{_f(inv)})/2)"
            chain.append(f"scale=w='{wex}':h='{hex_}':eval=frame:flags=bicubic")
        lab = f"L{k}"
        body = ",".join(chain)
        self.parts.append(f"{head}{body}[{lab}]" if body else f"{head}null[{lab}]")
        # overlay
        X, Y = WX, WY
        out = f"o{k}"
        self.parts.append(f"[{below}][{lab}]overlay=x='{X}-{_f(fxo)}*w':y='{Y}-{_f(fyo)}*h':"
                          f"enable='between(t,{_f(s)},{_f(p.end)})':format=auto:eof_action=pass[{out}]")
        return out

    # ---- whole composition -------------------------------------------------- #
    def compile(self) -> Tuple[List[str], str]:
        cur = self.build_base()
        self.by_id: Dict[str, Plan] = {}
        self.plans: List[Plan] = []
        k = 0
        for li, layer in enumerate(self.tl.get("layers", [])):
            if layer.get("hidden"):
                continue
            for p in self.make_plans(layer, li):
                if p.id:
                    self.by_id[p.id] = p
                self.plans.append(p)
                if p.kind == "null":
                    continue
                k += 1
                cur = self.emit(p, k, cur)
        self.parts.append(f"[{cur}]format=yuv420p,setsar=1[vout]")
        flat: List[str] = []
        for a in self.inputs:
            flat += a
        return flat, ";".join(self.parts)


# =========================================================================== #
# render
# =========================================================================== #
QUALITY = {"draft": ("ultrafast", 26), "final": ("veryfast", 18), "high": ("medium", 16)}


def _ff_major(ffmpeg: str) -> int:
    try:
        o = subprocess.run([ffmpeg, "-version"], capture_output=True, text=True).stdout.splitlines()[0]
        m = re.search(r"version\s+[nN]?(\d+)", o)
        return int(m.group(1)) if m else 0
    except Exception:
        return 0


def render(tl: dict, out: str, *, quality: str = "final", out_size: Optional[Tuple[int, int]] = None,
           base_dir: Optional[str] = None, workdir: Optional[str] = None, keep: bool = False,
           ffmpeg: Optional[str] = None) -> dict:
    """Render a composition to a video-only H.264 mp4 (exactly round(duration*fps) frames)."""
    ff, _ = find_ffmpeg() if ffmpeg is None else (ffmpeg, "")
    out = str(Path(out).resolve())          # ffmpeg runs with cwd=workdir, so the output path must be absolute
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    wd = Path(workdir) if workdir else Path(tempfile.mkdtemp(prefix="kf_"))
    wd.mkdir(parents=True, exist_ok=True)
    comp = Comp(tl, wd, Path(base_dir) if base_dir else None, out_size)
    inputs, graph = comp.compile()
    preset, crf = QUALITY[quality]
    enc = ["-map", "[vout]", "-frames:v", str(comp.N), "-r", str(comp.fps), "-c:v", "libx264", "-preset", preset,
           "-crf", str(crf), "-pix_fmt", "yuv420p", "-color_primaries", "bt709", "-color_trc", "bt709",
           "-colorspace", "bt709", "-movflags", "+faststart", str(out)]
    base = [ff, "-hide_banner", "-loglevel", "error", "-nostdin", "-y"]
    attempts: List[List[str]] = []
    if len(graph) < 9000:
        attempts.append(base + inputs + ["-filter_complex", graph] + enc)
    else:
        gp = wd / "graph.txt"
        gp.write_text(graph, encoding="utf-8")
        newer = _ff_major(ff) >= 7
        a = ["-/filter_complex", str(gp)] if newer else ["-filter_complex_script", str(gp)]
        b = ["-filter_complex_script", str(gp)] if newer else ["-/filter_complex", str(gp)]
        attempts += [base + inputs + a + enc, base + inputs + b + enc]
    err = ""
    for cmd in attempts:
        p = subprocess.run(cmd, capture_output=True, text=True, errors="replace", cwd=str(wd))
        if p.returncode == 0:
            err = ""
            break
        err = p.stderr[-1500:]
        if "Unrecognized option" not in err and "Option not found" not in err:
            break
    if err:
        raise RuntimeError("FFmpeg failed:\n" + err + f"\n(graph length {len(graph)} chars, workdir {wd})")
    if not keep and not workdir:
        shutil.rmtree(wd, ignore_errors=True)
    return {"out": str(out), "frames": comp.N, "fps": comp.fps, "size": (comp.W, comp.H),
            "graph_chars": len(graph), "notes": sorted(set(comp.notes))}


# =========================================================================== #
# curves sheet, selftest, demo, CLI
# =========================================================================== #
def curves_sheet(out: str) -> str:
    """PNG with every easing curve (like AE's graph editor) so you can pick by eye."""
    from PIL import Image, ImageDraw
    names = [n for n in EASE_NAMES if n != "bezier"] + ["bezier(.25,.1,.25,1)", "bezier(.7,0,.3,1)", "bezier(.2,.9,.3,1.4)"]
    cols, cw, ch, pad = 5, 220, 170, 24
    rows = (len(names) + cols - 1) // cols
    im = Image.new("RGB", (cols * cw, rows * ch), (14, 20, 34))
    d = ImageDraw.Draw(im)
    for i, nm in enumerate(names):
        e = parse_ease(nm)
        x0, y0 = (i % cols) * cw + pad, (i // cols) * ch + pad
        w, h = cw - 2 * pad, ch - 2 * pad - 8
        d.rectangle((x0, y0, x0 + w, y0 + h), outline=(48, 62, 90))
        d.line((x0, y0 + h, x0 + w, y0), fill=(40, 52, 78))
        pts = []
        for s in range(61):
            p = s / 60
            v = ease_py(e, p)
            pts.append((x0 + p * w, y0 + h - max(-0.5, min(1.6, v)) * h))
        d.line(pts, fill=(255, 196, 0), width=2)
        d.text((x0, y0 + h + 6), nm, fill=(220, 228, 240))
    im.save(out)
    return out


def _gray_frames(ffmpeg: str, path: str, W: int, H: int):
    p = subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-i", path, "-f", "rawvideo", "-pix_fmt", "gray", "-"],
                       capture_output=True)
    data = p.stdout
    n = W * H
    for i in range(len(data) // n):
        yield data[i * n:(i + 1) * n]


def _bbox(frame: bytes, W: int, H: int, thr: int = 100):
    table = bytes(1 if v > thr else 0 for v in range(256))
    mask = frame.translate(table)
    if 1 not in mask:
        return None
    xmin, xmax, ymin, ymax = W, -1, H, -1
    for y in range(H):
        row = mask[y * W:(y + 1) * W]
        a = row.find(b"\x01")
        if a < 0:
            continue
        b = row.rfind(b"\x01")
        xmin, xmax = min(xmin, a), max(xmax, b)
        ymin, ymax = min(ymin, y), max(ymax, y)
    return xmin, xmax + 1, ymin, ymax + 1


def selftest(keep: Optional[str] = None) -> int:
    ff, fp = find_ffmpeg()
    W, H, fps, dur = 640, 360, 24, 2.0
    wd = Path(keep) if keep else Path(tempfile.mkdtemp(prefix="kftest_"))
    wd.mkdir(parents=True, exist_ok=True)
    res: List[Tuple[str, bool, str]] = []

    def rec(name: str, ok: bool, msg: str = ""):
        res.append((name, bool(ok), msg))

    def comp(layers, name, base=None, d=dur):
        tl = {"width": W, "height": H, "fps": fps, "duration": d, "layers": layers}
        if base:
            tl["base"] = base
        out = str(wd / f"{name}.mp4")
        info = render(tl, out, quality="draft", workdir=str(wd / ("w_" + name)), keep=True)
        return out, info

    def count(path):
        p = subprocess.run([fp, "-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries",
                            "stream=nb_read_frames", "-of", "csv=p=0", path], capture_output=True, text=True)
        try:
            return int(p.stdout.strip().split(",")[0])
        except Exception:
            return -1

    def track_test(name, layer, props, tol, measure):
        """render a white rect, measure it per frame, compare with the Python reference."""
        try:
            out, info = comp([layer], name)
        except Exception as e:                                  # noqa
            rec(name, False, str(e)[-200:])
            return
        n = count(out)
        worst, where = 0.0, 0
        for fi, fr in enumerate(_gray_frames(ff, out, W, H)):
            t = fi / fps
            bb = _bbox(fr, W, H, 100 if name != "opacity" else 8)
            exp = measure["expect"](t)
            got = measure["get"](bb, fr)
            if exp is None:
                continue
            if got is None:
                err = abs(exp) + 999
            else:
                err = abs(got - exp)
            if err > worst:
                worst, where = err, fi
        rec(name, n == int(dur * fps) and worst <= tol, f"frames={n}, worst error {worst:.2f} at frame {where} (tol {tol})")

    rect = lambda **kw: {"type": "shape", "shape": "rect", "w": 80, "h": 40, "fill": "#FFFFFF", **kw}
    cx = lambda bb, fr: None if bb is None else (bb[0] + bb[1]) / 2
    cy = lambda bb, fr: None if bb is None else (bb[2] + bb[3]) / 2
    wd_ = lambda bb, fr: None if bb is None else bb[1] - bb[0]

    # ---- position / easing, compared with the Python reference ------------------ #
    for nm, ease in (("x_linear", "linear"), ("x_ease", "ease"), ("x_back_out", "back_out"),
                     ("x_bounce_out", "bounce_out"), ("x_elastic_out", "elastic_out"),
                     ("x_bezier", "bezier(.7,0,.3,1)"), ("x_spring", "spring"), ("x_expo_out", "expo_out")):
        keys = [[0, 100, ease], [1.0, 300 if ease == "elastic_out" else 500]]   # elastic overshoots: keep it on-screen
        tr = Track.parse(keys, float)
        track_test(nm, rect(x=keys, y=180), None, 2.5, {"expect": lambda t, tr=tr: tr.value(t), "get": cx})
    ky = [[0.2, 60, "ease_in"], [1.4, 300, "ease_out"]]
    tr = Track.parse(ky, float)
    track_test("y_ease_in_out_keys", rect(x=320, y=ky), None, 2.5, {"expect": lambda t: tr.value(t), "get": cy})
    ks = [[0, 1.0, "ease"], [1.5, 2.0]]
    ts = Track.parse(ks, float)
    track_test("scale", rect(x=320, y=180, scale=ks), None, 2.5, {"expect": lambda t: 80 * ts.value(t), "get": wd_})
    ko = [[0, 0.0, "linear"], [1.0, 1.0]]
    to = Track.parse(ko, float)
    track_test("opacity", rect(x=320, y=180, opacity=ko), None, 6.0,
               {"expect": lambda t: 255 * to.value(t), "get": lambda bb, fr: fr[180 * W + 320]})
    kr = [[0, 0, "linear"], [1.5, 90]]
    tr_ = Track.parse(kr, float)

    def rot_w(t):
        a = math.radians(tr_.value(t))
        return 80 * abs(math.cos(a)) + 40 * abs(math.sin(a))
    track_test("rotation", rect(x=320, y=180, rotation=kr), None, 3.5, {"expect": rot_w, "get": wd_})
    kx = [[0, 1.0, "linear"], [1.0, 2.0]]
    tk = Track.parse(kx, float)
    track_test("anchor_top_left_scale", rect(x=100, y=100, anchor="top-left", scale=kx), None, 2.5,
               {"expect": lambda t: 100.0, "get": lambda bb, fr: None if bb is None else bb[0]})
    wl = Wiggle(3, 20, 5)
    track_test("wiggle_y", rect(x=320, y=180, wiggle={"prop": "y", "freq": 3, "amp": 20, "seed": 5}), None, 3.5,
               {"expect": lambda t: 180 + wl.value(t), "get": cy})
    # ---- parenting (AE-style null objects) --------------------------------------- #
    def pos_test(name, layers, expect_xy, tol, wh=None):
        try:
            out, _ = comp(layers, name)
        except Exception as e:                                  # noqa
            rec(name, False, str(e)[-200:])
            return
        worst, where = 0.0, 0
        for fi, fr in enumerate(_gray_frames(ff, out, W, H)):
            bb = _bbox(fr, W, H, 100)
            ex, ey, ew = expect_xy(fi / fps)
            if bb is None:
                err = 999.0
            else:
                err = max(abs((bb[0] + bb[1]) / 2 - ex), abs((bb[2] + bb[3]) / 2 - ey),
                          abs((bb[1] - bb[0]) - ew) if ew else 0.0)
            if err > worst:
                worst, where = err, fi
        rec(name, worst <= tol, f"worst error {worst:.2f}px at frame {where} (tol {tol})")

    rot_k = [[0, 0, "linear"], [1.5, 90]]
    trk = Track.parse(rot_k, float)
    pos_test("parent_orbit(rotation)", [
        {"type": "null", "id": "rig", "x": 320, "y": 180, "rotation": rot_k},
        {"type": "shape", "shape": "rect", "w": 30, "h": 30, "parent": "rig", "x": 100, "y": 0}],
        lambda t: (320 + 100 * math.cos(math.radians(trk.value(t))), 180 + 100 * math.sin(math.radians(trk.value(t))), 0), 3.0)
    sc_k = [[0, 1.0, "linear"], [1.5, 2.0]]
    tsc = Track.parse(sc_k, float)
    pos_test("parent_scale_inherit", [
        {"type": "null", "id": "rig", "x": 320, "y": 180, "scale": sc_k},
        {"type": "shape", "shape": "rect", "w": 30, "h": 30, "parent": "rig", "x": 100, "y": 0}],
        lambda t: (320 + 100 * tsc.value(t), 180, 30 * tsc.value(t)), 3.0)
    gx = [[0, 200, "linear"], [1.5, 400]]
    tgx = Track.parse(gx, float)
    rot2 = [[0, 0, "linear"], [1.5, 180]]
    tr2 = Track.parse(rot2, float)
    pos_test("parent_chain(3 levels)", [
        {"type": "null", "id": "g", "x": gx, "y": 180},
        {"type": "null", "id": "p", "parent": "g", "x": 50, "y": 0, "rotation": rot2},
        {"type": "shape", "shape": "rect", "w": 24, "h": 24, "parent": "p", "x": 50, "y": 0}],
        lambda t: (tgx.value(t) + 50 + 50 * math.cos(math.radians(tr2.value(t))), 180 + 50 * math.sin(math.radians(tr2.value(t))), 0), 3.0)
    # world_py (the Python reference used by cartoon.py tests) must equal the same numbers
    try:
        tl = {"width": W, "height": H, "fps": fps, "duration": 1.5, "layers": [
            {"type": "null", "id": "rig", "x": 320, "y": 180, "rotation": rot_k},
            {"type": "shape", "shape": "rect", "w": 30, "h": 30, "parent": "rig", "x": 100, "y": 0}]}
        c = Comp(tl, wd / "w_ref")
        c.compile()
        px, py, pr, ps = c.world_py(c.plans[1], 0.75)
        ok = abs(px - (320 + 100 * math.cos(math.radians(trk.value(0.75))))) < 1e-6
        rec("world_py reference", ok, f"{px:.2f},{py:.2f}")
    except Exception as e:                                      # noqa
        rec("world_py reference", False, str(e)[-200:])
    try:
        out, _ = comp([{"type": "null", "id": "rig", "x": 320, "y": 180, "rotation": rot_k},
                       {"type": "text", "text": "AB CD", "size": 50, "split": "words", "parent": "rig", "in": "pop"}], "parent_text_units")
        rec("parent_text_units", count(out) == int(dur * fps))
    except Exception as e:                                      # noqa
        rec("parent_text_units", False, str(e)[-200:])
    try:
        comp([{"type": "shape", "shape": "rect", "w": 30, "h": 30, "parent": "nobody"}], "parent_missing")
        rec("parent_missing_error", False, "should have raised")
    except ValueError as e:
        rec("parent_missing_error", "not found" in str(e))
    except Exception as e:                                      # noqa
        rec("parent_missing_error", False, str(e)[-200:])
    # ---- image sequence layer (concat list) ---------------------------------------- #
    try:
        from PIL import Image as _I
        _I.new("RGBA", (60, 40), (255, 255, 255, 255)).save(wd / "seq_a.png")
        _I.new("RGBA", (60, 40), (255, 255, 255, 0)).save(wd / "seq_b.png")
        (wd / "seq.txt").write_text("file 'seq_a.png'\nduration 0.5\nfile 'seq_b.png'\nduration 0.5\nfile 'seq_a.png'\nduration 1.0\nfile 'seq_a.png'\n")
        out, _ = comp([{"type": "seq", "src": str(wd / "seq.txt"), "pw": 60, "ph": 40, "x": 320, "y": 180}], "seq_layer")
        fr = list(_gray_frames(ff, out, W, H))
        lit = [1 if fr[i][180 * W + 320] > 100 else 0 for i in (3, 15, 30, 40)]
        rec("seq_layer(concat list)", len(fr) == int(dur * fps) and lit == [1, 0, 1, 1], f"lit at frames 3,15,30,40 = {lit} (expect [1,0,1,1])")
    except Exception as e:                                      # noqa
        rec("seq_layer(concat list)", False, str(e)[-250:])
    # ---- presets: every one must run and end fully visible ---------------------- #
    for pn in PRESET_NAMES:
        name = f"preset_{pn}"
        try:
            out, _ = comp([{"type": "text", "text": "PRESET", "size": 60, "in": {"name": pn, "dur": 0.6},
                            "out": {"name": "fade", "dur": 0.3}, "x": 320, "y": 180}], name)
            frames = list(_gray_frames(ff, out, W, H))
            lit_mid = sum(1 for v in frames[len(frames) // 2] if v > 100)
            lit_end = sum(1 for v in frames[-1] if v > 100)
            rec(name, len(frames) == int(dur * fps) and lit_mid > 200 and lit_end < lit_mid,
                f"lit pixels mid={lit_mid}, last frame={lit_end} (fade-out expected to reduce)")
        except Exception as e:                                  # noqa
            rec(name, False, str(e)[-200:])
    # ---- text: split + stagger --------------------------------------------------- #
    try:
        out, _ = comp([{"type": "text", "text": "HELLO WORLD", "size": 64, "split": "chars", "stagger": 0.07,
                        "in": {"name": "pop", "dur": 0.35}, "x": 320, "y": 180}], "text_stagger")
        frames = list(_gray_frames(ff, out, W, H))
        counts = [sum(1 for v in fr if v > 100) for fr in (frames[2], frames[10], frames[20], frames[40])]
        rec("text_char_stagger", counts[0] < counts[1] < counts[2] <= counts[3] * 1.02 and counts[3] > 500,
            f"lit pixels over time {counts}")
    except Exception as e:                                      # noqa
        rec("text_char_stagger", False, str(e)[-200:])
    # ---- text styling + shape + gradient + image + video layers + camera ---------- #
    src_vid = wd / "src.mp4"
    subprocess.run([ff, "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
                    f"testsrc2=s=1280x720:r=30:d=1.5", "-pix_fmt", "yuv420p", str(src_vid)])
    try:
        layers = [
            {"type": "shape", "shape": "rounded", "w": 300, "h": 70, "radius": 20, "fill": ["#FFC400", "#FF6A00"],
             "x": 200, "y": 300, "in": "grow_x", "anchor": "left"},
            {"type": "text", "text": "Styled\ntext", "size": 56, "fill": ["#FFFFFF", "#9AD1FF"],
             "stroke": {"width": 3, "color": "#001428"}, "shadow": {"dy": 6, "blur": 8, "alpha": 0.7},
             "glow": {"blur": 14, "color": "#4DA3FF", "alpha": 0.8}, "x": 160, "y": 120, "in": "slide_in_left"},
            {"type": "video", "src": str(src_vid), "w": 200, "h": 112, "x": 520, "y": 90, "in": "pop", "rotation": [[0, -8], [2, 8]]},
            {"type": "solid", "color": "#FF3B30", "w": 60, "h": 8, "x": 520, "y": 160, "start": 0.4, "in": "fade"},
        ]
        out, info = comp(layers, "layers_mix", base={"type": "video", "src": str(src_vid),
                                                     "camera": {"zoom": [[0, 1.0], [2, 1.25]], "x": [[0, 0], [2, 40]]}})
        rec("layers_mix(text style/shape/video/solid/camera)", count(out) == int(dur * fps), f"graph {info['graph_chars']} chars")
    except Exception as e:                                      # noqa
        rec("layers_mix(text style/shape/video/solid/camera)", False, str(e)[-300:])
    try:
        out, _ = comp([], "camera_rot", base={"type": "video", "src": str(src_vid), "camera": {"rotation": [[0, 0], [2, 6]]}})
        rec("camera_rotation", count(out) == int(dur * fps))
    except Exception as e:                                      # noqa
        rec("camera_rotation", False, str(e)[-200:])
    # ---- scaled render (design 640x360 -> output 320x180) --------------------------- #
    try:
        tl = {"width": W, "height": H, "fps": fps, "duration": 1.0,
              "layers": [rect(x="50%", y="50%")]}
        out = str(wd / "scaled.mp4")
        render(tl, out, quality="draft", out_size=(320, 180), workdir=str(wd / "w_scaled"), keep=True)
        fr = list(_gray_frames(ff, out, 320, 180))[10]
        bb = _bbox(fr, 320, 180)
        rec("design_size_scaling", bb is not None and abs((bb[1] - bb[0]) - 40) <= 2 and abs((bb[0] + bb[1]) / 2 - 160) <= 2,
            f"bbox={bb} (expected width 40 centred at 160)")
    except Exception as e:                                      # noqa
        rec("design_size_scaling", False, str(e)[-200:])
    # ---- long graph via script file ------------------------------------------------- #
    try:
        many = [rect(x=[[0, 20 + 3 * i, "bezier(.7,0,.3,1)"], [1, 600 - 3 * i, "back_out"], [1.8, 100 + 2 * i, "ease"]],
                     y=10 + 6 * (i % 55), opacity=[[0, 0], [0.4, 1]], w=12, h=4, scale=[[0, 1], [1, 1.5 + (i % 3) * 0.2]])
                for i in range(40)]
        out, info = comp(many, "long_graph")
        rec("long_graph_via_script_file", count(out) == int(dur * fps) and info["graph_chars"] > 9000,
            f"graph {info['graph_chars']} chars")
    except Exception as e:                                      # noqa
        rec("long_graph_via_script_file", False, str(e)[-300:])
    # ---- blur (experimental) ---------------------------------------------------------- #
    try:
        out, info = comp([{"type": "text", "text": "SHARP", "size": 90, "x": 320, "y": 180,
                           "blur": [[0, 1.0, "ease_out"], [1.0, 0.0]]}], "blur_exp")
        frames = list(_gray_frames(ff, out, W, H))
        edge = lambda fr: sum(abs(fr[i + 1] - fr[i]) for i in range(180 * W, 181 * W - 1))
        e0, e1 = edge(frames[1]), edge(frames[40])
        rec("blur_keyframes (EXPERIMENTAL)", e1 > e0 * 1.3, f"edge energy frame1={e0}, frame40={e1} (sharper later)")
    except Exception as e:                                      # noqa
        rec("blur_keyframes (EXPERIMENTAL)", False, str(e)[-200:])
    rec("curves_sheet", Path(curves_sheet(str(wd / "curves.png"))).exists())

    bad = [r for r in res if not r[1] and "EXPERIMENTAL" not in r[0]]
    print(f"keyframes.py {LIB_VERSION} selftest ({len(res)} checks)")
    for n, ok, m in res:
        print(("PASS  " if ok else ("WARN  " if "EXPERIMENTAL" in n else "FAIL  ")) + n + (f"   {m}" if m and not ok else ""))
    print(f"\n{len(res) - len([r for r in res if not r[1]])}/{len(res)} passed.  Files: {wd}")
    return 1 if bad else 0


def demo(out_dir: str, size: str = "1080x1920", source: Optional[str] = None) -> int:
    """Three ready-made compositions (JSON saved next to the video so you can edit them)."""
    W, H = (int(x) for x in size.lower().split("x"))
    od = Path(out_dir)
    od.mkdir(parents=True, exist_ok=True)
    portrait = H > W
    base = ({"type": "video", "src": str(Path(source).resolve()), "camera": {"zoom": [[0, 1.0, "ease_out"], [5, 1.15]]}}
            if source else {"type": "gradient", "c0": "#0a1428", "c1": "#1c4a8a"})
    ty = "36%" if portrait else "42%"
    hook = {
        "width": W, "height": H, "fps": 24, "duration": 5.0, "base": base,
        "layers": [
            {"type": "solid", "color": "#000000", "w": "100%", "h": "100%", "x": "50%", "y": "50%", "opacity": 0.35},
            {"type": "text", "text": "ECONOMY KA\nASLI SACH", "font": "Poppins", "size": 120 if portrait else 110, "align": "center",
             "split": "words", "stagger": 0.18, "x": "50%", "y": ty, "start": 0.3, "end": 4.6,
             "in": {"name": "pop", "dur": 0.5}, "out": {"name": "fade", "dur": 0.4},
             "stroke": {"width": 5, "color": "#00122A"}, "shadow": {"dy": 8, "blur": 10, "alpha": 0.6}},
            {"type": "shape", "shape": "rounded", "w": 520, "h": 14, "radius": 7, "fill": ["#FFC400", "#FF6A00"],
             "x": "50%", "y": "52%" if portrait else "58%", "anchor": "center", "start": 0.9, "end": 4.6,
             "in": {"name": "grow_x", "dur": 0.6}, "out": {"name": "fade", "dur": 0.4}},
            {"type": "text", "text": "Dr. Name Surname", "font": "Poppins", "size": 46, "x": "50%", "y": "70%" if portrait else "76%",
             "start": 1.4, "end": 4.6, "in": {"name": "fade_up", "dur": 0.5}, "out": {"name": "fade", "dur": 0.4},
             "wiggle": {"prop": "y", "freq": 1.2, "amp": 3}},
        ]}
    badge = {
        "width": W, "height": H, "fps": 24, "duration": 4.0, "base": {"type": "gradient", "c0": "#0b1220", "c1": "#1a2f57"},
        "layers": [
            {"type": "shape", "shape": "circle", "w": 360, "h": 360, "fill": ["#FFC400", "#FF6A00"], "x": "50%", "y": "42%",
             "start": 0.2, "in": {"name": "spin_in", "dur": 0.8}},
            {"type": "text", "text": "90+", "font": "Poppins", "size": 170, "fill": "#0B1220", "x": "50%", "y": "42%",
             "start": 0.5, "in": {"name": "drop_bounce", "dur": 0.9}},
            {"type": "text", "text": "Free Tools", "font": "Poppins", "size": 84, "x": "50%", "y": "62%", "split": "chars",
             "stagger": 0.04, "start": 1.0, "in": {"name": "fade_up", "dur": 0.4}, "glow": {"blur": 16, "color": "#4DA3FF", "alpha": 0.7}},
        ]}
    lower = {
        "width": W, "height": H, "fps": 24, "duration": 4.0, "base": base if source else {"type": "gradient", "c0": "#101a2e", "c1": "#27406e"},
        "layers": [
            {"type": "shape", "shape": "rounded", "w": 14, "h": 120, "radius": 4, "fill": "#FFC400", "anchor": "top-left",
             "x": "8%", "y": "72%" if portrait else "78%", "start": 0.3, "end": 3.7, "in": {"name": "grow_y", "dur": 0.4}, "out": {"name": "fade", "dur": 0.3}},
            {"type": "text", "text": "Name Surname", "font": "Poppins", "size": 52, "anchor": "left", "x": "10%",
             "y": "74.5%" if portrait else "80.5%", "start": 0.5, "end": 3.7, "in": {"name": "slide_in_left", "dur": 0.5}, "out": {"name": "fade", "dur": 0.3}},
            {"type": "text", "text": "Senior Economist", "font": "Poppins", "bold": False, "size": 34, "anchor": "left", "fill": "#C9D6EE",
             "x": "10%", "y": "78%" if portrait else "84%", "start": 0.7, "end": 3.7, "in": {"name": "slide_in_left", "dur": 0.5}, "out": {"name": "fade", "dur": 0.3}},
        ]}
    code = 0
    for name, tl in (("hook", hook), ("badge", badge), ("lower_third", lower)):
        (od / f"{name}.json").write_text(json.dumps(tl, indent=2), encoding="utf-8")
        try:
            info = render(tl, str(od / f"{name}.mp4"), quality="final", workdir=str(od / ("w_" + name)), keep=True)
            print(f"ok   {name}.mp4  ({info['frames']} frames, graph {info['graph_chars']} chars)")
        except Exception as e:                                  # noqa
            print(f"FAIL {name}: {e}")
            code = 1
    curves_sheet(str(od / "easing_curves.png"))
    print("easing curves sheet:", od / "easing_curves.png")
    return code


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="Agent 8 keyframe engine")
    sub = ap.add_subparsers(dest="cmd")
    r = sub.add_parser("render", help="render a timeline JSON to mp4")
    r.add_argument("timeline")
    r.add_argument("out")
    r.add_argument("--quality", default="final", choices=list(QUALITY))
    r.add_argument("--size", default=None, help="output size WxH (default: the JSON's width/height)")
    s = sub.add_parser("selftest")
    s.add_argument("--keep", default=None)
    d = sub.add_parser("demo")
    d.add_argument("--out", default="keyframes_demo")
    d.add_argument("--size", default="1080x1920")
    d.add_argument("--input", default=None, help="your footage for the base layer")
    c = sub.add_parser("curves")
    c.add_argument("--out", default="easing_curves.png")
    sub.add_parser("list")
    a = ap.parse_args(argv)
    if a.cmd == "render":
        tlp = Path(a.timeline)
        tl = json.loads(tlp.read_text(encoding="utf-8"))
        size = tuple(int(x) for x in a.size.lower().split("x")) if a.size else None
        info = render(tl, a.out, quality=a.quality, out_size=size, base_dir=str(tlp.parent))
        print(json.dumps(info, indent=2))
        return 0
    if a.cmd == "selftest":
        return selftest(a.keep)
    if a.cmd == "demo":
        return demo(a.out, a.size, a.input)
    if a.cmd == "curves":
        print(curves_sheet(a.out))
        return 0
    print("easing  :", ", ".join(EASE_NAMES), " + bezier(x1,y1,x2,y2)")
    print("presets :", ", ".join(PRESET_NAMES), "(use as \"in\"/\"out\")")
    print("layers  : text (split words/chars/lines + stagger), shape, image, video, solid")
    print("props   : x y dx dy scale scale_x scale_y rotation opacity blur(experimental) anchor wiggle")
    return 0


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(errors="replace")
    except Exception:
        pass
    sys.exit(main())
