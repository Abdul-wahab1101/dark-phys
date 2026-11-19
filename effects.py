#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
effects.py - FFmpeg effects library for Agent 8 (YouTubeFactory)

Pure-Python module (standard library only). It does NOT render anything by
itself: every function returns an FFmpeg filter string / filtergraph fragment /
ASS subtitle text that Agent 8 plugs into its own FFmpeg command.
`python effects.py selftest` and `python effects.py demo` run real FFmpeg.

Categories
  1. Transitions : crossfade, dissolve, dips, wipes, slides, smooth, circle,
                   pixelize ... (native xfade) + custom: glitch, zoom_burst, whip
  2. Motion      : zoom_in / zoom_out, pan_*, shake, speed_ramp, beat_punch,
                   glitch_hit, flash
  3. Color grade : cinematic, teal_orange, documentary, vibrant, noir,
                   warm_vintage, cool_tech, hype, news_clean (+ intensity, grain,
                   vignette) and .cube LUT support
  4. Text        : ASS captions (fade, pop, slide_up, typewriter, word_highlight),
                   kinetic titles, lower thirds
  5. Overlay/VFX : screen/add/multiply/... blend, alpha overlay, green-screen key,
                   procedural light leaks / dust / flash pulses (no assets needed)

Conventions
  * All single-clip effects assume the clip is ALREADY scaled/cropped to W x H
    and constant fps. They return a comma-separated -vf chain that outputs
    W x H again and never changes the frame count (speed_ramp keeps duration).
  * Transitions take two streams of exactly `frames` frames each (tail of clip A
    and head of clip B) and return exactly `frames` frames.
  * Every expression is wrapped in single quotes; pass the filter string as ONE
    argv item (subprocess list), never through a shell.
"""
from __future__ import annotations

import argparse
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

LIB_VERSION = "1.0.0"


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def _n(x: float) -> str:
    """compact number for filter strings"""
    s = f"{x:.6f}".rstrip("0").rstrip(".")
    return s if s else "0"


def ease(p: str, kind: str = "inout") -> str:
    """Return an FFmpeg expression that eases progress expression `p` (0..1)."""
    if kind == "linear":
        return f"({p})"
    if kind == "in":
        return f"pow({p},3)"
    if kind == "out":
        return f"(1-pow(1-({p}),3))"
    if kind == "expo_out":
        return f"(1-pow(2,-10*({p})))"
    return f"(0.5-0.5*cos(PI*({p})))"  # inout


def ff_path(p: str) -> str:
    """Escape a file path for use INSIDE a filter option (works on Windows too).
    Example: C:\\a\\b.ass  ->  C\\:/a/b.ass  (put inside single quotes)."""
    p = str(p).replace("\\", "/")
    p = p.replace(":", "\\:").replace("'", "\\'")
    return p


def _even(x: float) -> int:
    return max(2, int(round(x / 2.0)) * 2)


# --------------------------------------------------------------------------- #
# color grading presets (numbers are interpolated by `intensity`)
# --------------------------------------------------------------------------- #
_NEUTRAL = dict(contrast=1.0, saturation=1.0, brightness=0.0, gamma=1.0,
                shadows=(0, 0, 0), mids=(0, 0, 0), highs=(0, 0, 0),
                scurve=0.0, sharpen=0.0, vignette=0.0, lift=0.0)

GRADES: Dict[str, dict] = {
    "cinematic":    dict(contrast=1.08, saturation=0.95, gamma=1.0, shadows=(-0.04, 0.0, 0.05),
                         mids=(-0.01, 0.0, 0.02), highs=(0.06, 0.01, -0.05), scurve=0.6,
                         vignette=0.35, lift=0.015),
    "teal_orange":  dict(contrast=1.12, saturation=1.05, shadows=(-0.08, -0.01, 0.09),
                         mids=(0.0, 0.0, 0.03), highs=(0.10, 0.03, -0.08), scurve=0.7,
                         vignette=0.30),
    "documentary":  dict(contrast=1.05, saturation=0.82, gamma=1.0, shadows=(-0.01, 0.0, 0.02),
                         highs=(0.02, 0.0, -0.01), scurve=0.3, vignette=0.15),
    "vibrant":      dict(contrast=1.10, saturation=1.35, scurve=0.4, sharpen=0.5, vignette=0.10),
    "noir":         dict(contrast=1.30, saturation=0.0, brightness=-0.03, scurve=0.8,
                         vignette=0.55),
    "warm_vintage": dict(contrast=0.98, saturation=0.88, shadows=(0.03, 0.0, -0.03),
                         mids=(0.04, 0.01, -0.04), highs=(0.07, 0.02, -0.07), scurve=0.3,
                         vignette=0.35, lift=0.05),
    "cool_tech":    dict(contrast=1.10, saturation=1.05, shadows=(-0.03, 0.0, 0.07),
                         mids=(-0.02, 0.0, 0.05), highs=(-0.03, 0.0, 0.05), scurve=0.5,
                         vignette=0.20),
    "hype":         dict(contrast=1.25, saturation=1.50, scurve=0.8, sharpen=0.8, vignette=0.40,
                         brightness=-0.01),
    "news_clean":   dict(contrast=1.04, saturation=1.02, scurve=0.2, sharpen=0.3),
}


def grade_names() -> List[str]:
    return sorted(GRADES)


def _lerp(a, b, t):
    if isinstance(a, tuple):
        return tuple(_lerp(x, y, t) for x, y in zip(a, b))
    return a + (b - a) * t


def grade(preset: str, intensity: float = 1.0, grain: float = 0.0, fast: bool = False) -> str:
    """Return a -vf chain for a grading preset.
    intensity 0..1.5 (0 = untouched, 1 = preset), grain 0..1 (film grain, costs CPU),
    fast=True skips vignette + sharpening (cheaper on slow CPUs).
    Implementation note: tinting + S-curve are done in ONE `curves` filter because
    `colorbalance` was ~4x slower at 2560x1440 (forces an RGB conversion)."""
    if preset not in GRADES:
        raise ValueError(f"unknown grade '{preset}'. choices: {', '.join(grade_names())}")
    full = dict(_NEUTRAL)
    full.update(GRADES[preset])
    t = max(0.0, min(1.5, float(intensity)))
    v = {k: _lerp(_NEUTRAL[k], full[k], t) for k in _NEUTRAL}
    chain = [f"eq=contrast={_n(v['contrast'])}:saturation={_n(v['saturation'])}"
             f":brightness={_n(v['brightness'])}:gamma={_n(v['gamma'])}"]
    sh, mi, hi = v["shadows"], v["mids"], v["highs"]
    sc, lift = v["scurve"], v["lift"]
    tinted = any(abs(x) > 1e-4 for x in (*sh, *mi, *hi))
    if tinted or sc > 1e-3 or lift > 1e-3:
        def pts(i: int) -> str:
            clamp = lambda y: max(0.0, min(1.0, y))
            y = [lift,
                 0.25 - 0.06 * sc + lift * 0.5 + 0.6 * sh[i],
                 0.50 + 0.6 * mi[i],
                 0.75 + 0.06 * sc + 0.6 * hi[i],
                 1.0 - lift * 0.5]
            return " ".join(f"{x}/{_n(clamp(yy))}" for x, yy in zip((0, 0.25, 0.5, 0.75, 1), y))
        if tinted:
            chain.append(f"curves=r='{pts(0)}':g='{pts(1)}':b='{pts(2)}'")
        else:
            chain.append(f"curves=all='{pts(0)}'")
    if not fast:
        if v["sharpen"] > 1e-3:
            chain.append(f"unsharp=5:5:{_n(0.9 * v['sharpen'])}:5:5:0")
        if v["vignette"] > 1e-3:
            ang = min(math.pi / 3.2, v["vignette"] * math.pi / 3.6)   # bigger angle = STRONGER vignette
            chain.append(f"vignette=angle={_n(ang)}:mode=forward")
    if grain > 1e-3:
        chain.append(f"noise=alls={int(round(3 + 22 * grain))}:allf=t")
    return ",".join(chain)


def grade_lut(cube_path: str, intensity_mix: float = 1.0) -> str:
    """Apply a .cube LUT file. intensity_mix<1 is not supported by lut3d itself,
    so this simply returns the lut3d filter (use grade() for adjustable looks)."""
    return f"lut3d=file='{ff_path(cube_path)}':interp=tetrahedral"


# --------------------------------------------------------------------------- #
# the Effects class
# --------------------------------------------------------------------------- #
class Effects:
    def __init__(self, w: int, h: int, fps: int = 24, xfade_available: Optional[Sequence[str]] = None):
        self.w, self.h, self.fps = int(w), int(h), int(fps)
        self.xfade_available = set(xfade_available) if xfade_available else None

    # ------------------------------ MOTION ---------------------------------- #
    def motion(self, name: str, frames: int, **opts) -> str:
        """Single-clip motion. name: zoom_in, zoom_out, pan_left, pan_right, pan_up,
        pan_down, shake, drift (very slow zoom), none."""
        name = name.lower()
        if name in ("none", "static", ""):
            return "null"
        if name == "zoom_in":
            return self._zoom(frames, 1.0, 1.0 + opts.get("amount", 0.10), opts.get("ease", "inout"),
                              opts.get("cx", 0.5), opts.get("cy", 0.5))
        if name == "zoom_out":
            return self._zoom(frames, 1.0 + opts.get("amount", 0.10), 1.0, opts.get("ease", "inout"),
                              opts.get("cx", 0.5), opts.get("cy", 0.5))
        if name == "drift":
            return self._zoom(frames, 1.0, 1.0 + opts.get("amount", 0.03), "linear", 0.5, 0.5)
        if name.startswith("pan_"):
            return self._pan(frames, name[4:], opts.get("amount", 0.08), opts.get("ease", "inout"))
        if name == "shake":
            return self.shake(frames, opts.get("intensity", 0.5), opts.get("start", 0.0),
                              opts.get("dur"), opts.get("decay", True))
        raise ValueError(f"unknown motion '{name}'")

    def _zoom(self, frames, z0, z1, ease_kind, cx, cy) -> str:
        N = max(1, frames - 1)
        e = ease(f"min(1,n/{N})", ease_kind)
        z = f"({_n(z0)}+({_n(z1)}-{_n(z0)})*{e})"
        return (f"scale=w='2*trunc(iw*{z}/2)':h='2*trunc(ih*{z}/2)':eval=frame:flags=bicubic,"
                f"crop={self.w}:{self.h}:'(iw-{self.w})*{_n(cx)}':'(ih-{self.h})*{_n(cy)}'")

    def _pan(self, frames, direction, amount, ease_kind) -> str:
        N = max(1, frames - 1)
        e = ease(f"min(1,n/{N})", ease_kind)
        W, H = _even(self.w * (1 + amount)), _even(self.h * (1 + amount))
        # 'pan_left' = the camera moves left, so the visible window slides 1 -> 0
        x, y = "(iw-ow)/2", "(ih-oh)/2"
        if direction == "left":
            x = f"(iw-ow)*(1-{e})"
        elif direction == "right":
            x = f"(iw-ow)*{e}"
        elif direction == "up":
            y = f"(ih-oh)*(1-{e})"
        elif direction == "down":
            y = f"(ih-oh)*{e}"
        else:
            raise ValueError("pan direction must be left/right/up/down")
        return f"scale={W}:{H}:flags=bicubic,crop={self.w}:{self.h}:'{x}':'{y}'"

    def shake(self, frames: int, intensity: float = 0.5, start: float = 0.0,
              dur: Optional[float] = None, decay: bool = True) -> str:
        """Handheld / impact shake. intensity 0..1 (1 = about 2.5% of the frame).
        start/dur (seconds) limit the shake to a window; decay fades it out."""
        amp = max(0.0, min(1.0, intensity)) * 0.025
        ax, ay = self.w * amp, self.h * amp
        pad_w, pad_h = _even(self.w + 2 * ax + 2), _even(self.h + 2 * ay + 2)
        total = frames / self.fps
        d = dur if dur is not None else max(0.05, total - start)
        if decay:
            env = f"if(between(t,{_n(start)},{_n(start + d)}),exp(-3*(t-{_n(start)})/{_n(d)}),0)"
        else:
            env = f"between(t,{_n(start)},{_n(start + d)})"
        wob_x = f"(sin(n*2.1+1)+0.55*sin(n*4.7+2))/1.55"
        wob_y = f"(cos(n*2.7)+0.55*sin(n*5.3+1))/1.55"
        x = f"(iw-ow)/2+{_n(ax)}*{env}*{wob_x}"
        y = f"(ih-oh)/2+{_n(ay)}*{env}*{wob_y}"
        return f"scale={pad_w}:{pad_h}:flags=bicubic,crop={self.w}:{self.h}:'{x}':'{y}'"

    def speed_ramp(self, duration: float, kind: str = "slow_fast_slow", strength: float = 0.6) -> str:
        """Smooth speed ramp that KEEPS the clip duration (so narration sync is safe).
        The clip fed in must be exactly `duration` seconds long.
        kind: slow_fast_slow (slow start/end, fast middle)
              fast_slow_fast (fast start/end, slow-motion middle = 'hero' moment)
        strength 0..0.9. Slow parts duplicate frames (no interpolation)."""
        a = max(0.0, min(0.9, strength))
        if kind == "fast_slow_fast":
            a = -a
        elif kind != "slow_fast_slow":
            raise ValueError("kind must be slow_fast_slow or fast_slow_fast")
        D = max(0.1, duration)
        k = a * D / (2 * math.pi)
        return (f"setpts=PTS-STARTPTS,"
                f"setpts='(T+({_n(k)})*sin(2*PI*T/{_n(D)}))/TB',fps={self.fps}")

    def beat_punch(self, times: Sequence[float], amount: float = 0.06, decay: float = 9.0) -> str:
        """Quick punch-in zoom on every beat time (seconds, clip-relative)."""
        ts = [t for t in times if t >= 0][:60]
        if not ts:
            return "null"
        pulses = "+".join(f"{_n(amount)}*exp(-{_n(decay)}*(t-{_n(t)}))*gte(t,{_n(t)})" for t in ts)
        z = f"(1+{pulses})"
        return (f"scale=w='2*trunc(iw*{z}/2)':h='2*trunc(ih*{z}/2)':eval=frame:flags=bicubic,"
                f"crop={self.w}:{self.h}")

    def flash(self, at: float, dur: float = 0.18, strength: float = 0.8) -> str:
        """White flash (exponential falloff) starting at `at` seconds."""
        return (f"eq=brightness='if(gte(t,{_n(at)}),{_n(strength)}*exp(-{_n(5.0 / max(dur, 0.04))}"
                f"*(t-{_n(at)})),0)':eval=frame")

    def glitch_hit(self, at: float, dur: float = 0.35, intensity: float = 0.6) -> str:
        """Single-clip glitch burst (RGB split + noise + contrast kick)."""
        i = max(0.1, min(1.0, intensity))
        r = max(2, int(self.w * 0.012 * i))
        v = max(1, int(self.h * 0.004 * i))
        a, b, c = at, at + dur * 0.35, at + dur * 0.7
        e = at + dur
        return ",".join([
            f"rgbashift=rh={r}:bh=-{r}:rv={v}:bv=-{v}:enable='between(t,{_n(a)},{_n(b)})'",
            f"rgbashift=rh=-{int(r * 1.7)}:bh={int(r * 1.7)}:gv={v * 2}:enable='between(t,{_n(b)},{_n(c)})'",
            f"noise=alls={int(25 + 40 * i)}:allf=t:enable='between(t,{_n(a)},{_n(e)})'",
            f"eq=contrast={_n(1 + 0.4 * i)}:saturation={_n(1 + 0.5 * i)}:enable='between(t,{_n(b)},{_n(c)})'",
        ])

    # ---------------------------- TRANSITIONS -------------------------------- #
    NATIVE = {
        "crossfade": "fade", "fade": "fade", "dissolve": "dissolve",
        "dip_black": "fadeblack", "dip_white": "fadewhite", "dip_gray": "fadegrays",
        "wipe_left": "wipeleft", "wipe_right": "wiperight", "wipe_up": "wipeup", "wipe_down": "wipedown",
        "slide_left": "slideleft", "slide_right": "slideright", "slide_up": "slideup", "slide_down": "slidedown",
        "smooth_left": "smoothleft", "smooth_right": "smoothright", "smooth_up": "smoothup",
        "smooth_down": "smoothdown", "cover_left": "coverleft", "cover_right": "coverright",
        "reveal_left": "revealleft", "reveal_right": "revealright",
        "circle_open": "circleopen", "circle_close": "circleclose", "radial": "radial",
        "pixelize": "pixelize", "squeeze_h": "squeezeh", "squeeze_v": "squeezev",
        "diag_tl": "diagtl", "diag_br": "diagbr", "horz_open": "horzopen", "vert_open": "vertopen",
        "slice_left": "hlslice", "slice_right": "hrslice", "blur_h": "hblur", "distance": "distance",
    }
    CUSTOM = ("glitch", "zoom_burst", "whip")

    @classmethod
    def transition_names(cls) -> List[str]:
        return sorted(list(cls.NATIVE) + list(cls.CUSTOM))

    def transition(self, name: str, a: str, b: str, out: str, frames: int, **opts) -> str:
        """Filtergraph fragment: [a][b] -> [out], exactly `frames` frames.
        a = last `frames` frames of the outgoing clip, b = first `frames` of the incoming clip
        (labels WITHOUT brackets). Both must already be W x H."""
        frames = max(2, int(frames))
        name = name.lower()
        norm_a, norm_b = f"{out}_na", f"{out}_nb"
        pre = (f"[{a}]fps={self.fps},format=yuv420p,setsar=1,settb=1/{self.fps},setpts=N,trim=end_frame={frames},setpts=N[{norm_a}];"
               f"[{b}]fps={self.fps},format=yuv420p,setsar=1,settb=1/{self.fps},setpts=N,trim=end_frame={frames},setpts=N[{norm_b}];")
        dur = frames / self.fps
        tail = f",trim=end_frame={frames},setpts=N"
        if name in self.NATIVE:
            x = self.NATIVE[name]
            if self.xfade_available is not None and x not in self.xfade_available:
                x = "fade"
            return (pre + f"[{norm_a}][{norm_b}]xfade=transition={x}:duration={_n(dur)}:offset=0"
                    f"{tail}[{out}]")
        if name == "whip":
            x = "hblur" if (self.xfade_available is None or "hblur" in self.xfade_available) else "slideleft"
            return (pre + f"[{norm_a}][{norm_b}]xfade=transition={x}:duration={_n(dur)}:offset=0"
                    f"{tail}[{out}]")
        if name == "glitch":
            return pre + self._glitch(norm_a, norm_b, out, frames, dur, opts)
        if name == "zoom_burst":
            return pre + self._zoom_burst(norm_a, norm_b, out, frames, dur, opts)
        raise ValueError(f"unknown transition '{name}'. choices: {', '.join(self.transition_names())}")

    def _glitch(self, a, b, out, frames, dur, o) -> str:
        inten = max(0.2, min(1.0, o.get("intensity", 0.7)))
        base = o.get("base", "hrslice")
        if self.xfade_available is not None and base not in self.xfade_available:
            base = "fade"
        r = max(2, int(self.w * 0.016 * inten))
        v = max(1, int(self.h * 0.005 * inten))
        D = dur
        win = lambda p, q: f"between(t,{_n(D * p)},{_n(D * q)})"
        chain = ",".join([
            f"rgbashift=rh={r}:bh=-{r}:rv={v}:bv=-{v}:enable='{win(0.05, 0.28)}'",
            f"rgbashift=rh=-{int(r * 1.8)}:bh={int(r * 1.8)}:gv={v * 2}:enable='{win(0.28, 0.50)}'",
            f"rgbashift=rh={int(r * 1.2)}:bh=-{int(r * 1.2)}:rv=-{v}:enable='{win(0.55, 0.78)}'",
            f"noise=alls={int(30 + 45 * inten)}:allf=t:enable='{win(0.15, 0.62)}'",
            f"eq=contrast={_n(1 + 0.5 * inten)}:saturation={_n(1 + 0.6 * inten)}:enable='{win(0.30, 0.46)}'",
            f"eq=brightness={_n(0.10 * inten)}:enable='{win(0.50, 0.56)}'",
        ])
        return (f"[{a}][{b}]xfade=transition={base}:duration={_n(dur)}:offset=0,"
                f"trim=end_frame={frames},setpts=N,{chain}[{out}]")

    def _zoom_burst(self, a, b, out, frames, dur, o) -> str:
        Z = o.get("zoom", 0.9)           # extra zoom at the peak (0.9 = 1.9x)
        blur = o.get("blur", 0.07)       # radial-blur spread of the fake zoom blur
        flash = o.get("flash", 0.35)     # white flash strength at the cut (0 = none)
        N = max(1, frames - 1)
        p = f"min(1,n/{N})"
        W, H = self.w, self.h
        za = f"(1+{_n(Z)}*pow({p},2.2))"
        zb = f"(1+{_n(Z)}*pow(1-{p},2.2))"
        k = f"({_n(blur)}*sin(PI*{p}))"

        def zoomed(src, z, label):
            sc = lambda extra: (f"scale=w='2*trunc(iw*{z}*(1+{extra})/2)':h='2*trunc(ih*{z}*(1+{extra})/2)'"
                                f":eval=frame:flags=bicubic,crop={W}:{H}")
            return (f"[{src}]split=3[{label}0][{label}1][{label}2];"
                    f"[{label}0]{sc('0')}[{label}z0];"
                    f"[{label}1]{sc(k + '*0.5')}[{label}z1];"
                    f"[{label}2]{sc(k)}[{label}z2];"
                    f"[{label}z0][{label}z1][{label}z2]mix=inputs=3:weights='1 1 1',setsar=1[{label}o]")

        g = zoomed(a, za, f"{out}_a") + ";" + zoomed(b, zb, f"{out}_b") + ";"
        g += (f"[{out}_ao][{out}_bo]xfade=transition=fade:duration={_n(dur)}:offset=0,"
              f"trim=end_frame={frames},setpts=N")
        if flash > 0:
            g += f",eq=brightness='{_n(flash)}*pow(sin(PI*min(1,n/{N})),12)':eval=frame"
        return g + f"[{out}]"

    # ------------------------- OVERLAY / VFX BLENDING ------------------------- #
    BLEND_MODES = ("screen", "add", "lighten", "overlay", "softlight", "hardlight", "multiply",
                   "darken", "dodge", "difference", "normal")

    def blend_overlay(self, base: str, ov: str, out: str, mode: str = "screen", opacity: float = 1.0,
                      start: float = 0.0, fade_in: float = 0.25, fade_out_at: Optional[float] = None,
                      fade_out: float = 0.35, frames: Optional[int] = None, key: Optional[str] = None,
                      rgb: bool = True) -> str:
        """Filtergraph fragment that blends an overlay clip onto `base`.
        base, ov, out are labels without brackets. `ov` is a second input (use
        `-stream_loop -1` before its -i if it is shorter than the base, and give
        `frames` so the graph trims the result to the base length).
        mode  : screen/add/lighten (black background overlays: light leaks, fire, sparks),
                multiply/darken (white background), overlay/softlight/hardlight,
                'alpha' (overlay has transparency), 'normal'
        key   : 'green' -> chroma-key a green-screen overlay, 'black' -> key out black.
        start : seconds before the overlay appears; fade_in/fade_out in seconds
                (fade_out_at = absolute second where the fade-out starts)."""
        W, H, fps = self.w, self.h, self.fps
        mode = {"add": "addition"}.get(mode.lower(), mode.lower())
        op = max(0.0, min(1.0, opacity))
        white = mode in ("multiply", "darken")
        fcol = "white" if white else "black"
        alpha_mode = mode in ("alpha", "normal") or key is not None

        chain = [f"fps={fps}", f"scale={W}:{H}:force_original_aspect_ratio=increase", f"crop={W}:{H}", "setsar=1"]
        if key == "green":
            chain.append("chromakey=0x00ff00:0.18:0.08")
        elif key == "black":
            chain.append("colorkey=0x000000:0.18:0.12")
        if alpha_mode:
            chain.append("format=rgba")
            if start > 0:
                chain.append(f"tpad=start_duration={_n(start)}:color=black@0")
            chain.append(f"fade=t=in:st={_n(start)}:d={_n(fade_in)}:alpha=1")
            if fade_out_at is not None:
                chain.append(f"fade=t=out:st={_n(fade_out_at)}:d={_n(fade_out)}:alpha=1")
            if op < 0.999:
                chain.append(f"colorchannelmixer=aa={_n(op)}")
        else:
            chain.append("format=yuv420p")
            if start > 0:
                chain.append(f"tpad=start_duration={_n(start)}:color={fcol}")
            chain.append(f"fade=t=in:st={_n(start)}:d={_n(fade_in)}:color={fcol}")
            if fade_out_at is not None:
                chain.append(f"fade=t=out:st={_n(fade_out_at)}:d={_n(fade_out)}:color={fcol}")
        g = f"[{ov}]" + ",".join(chain) + f"[{out}_ov];"
        trim = f",trim=end_frame={int(frames)},setpts=N" if frames else ""
        if alpha_mode:
            g += f"[{base}][{out}_ov]overlay=format=auto:eof_action=repeat{trim}[{out}]"
        elif rgb:
            g += (f"[{base}]format=gbrp[{out}_b];[{out}_ov]format=gbrp[{out}_o];"
                  f"[{out}_b][{out}_o]blend=all_mode={mode}:all_opacity={_n(op)}:repeatlast=1{trim},"
                  f"format=yuv420p[{out}]")
        else:
            g += (f"[{base}][{out}_ov]blend=all_mode={mode}:all_opacity={_n(op)}:repeatlast=1{trim}[{out}]")
        return g

    def procedural_overlay(self, kind: str, duration: float, seed: int = 1, **o) -> str:
        """Asset-free overlay generated by FFmpeg (use as `-f lavfi -i "<returned>"`,
        then blend with mode 'screen' or 'add').
        kinds: light_leak_warm, light_leak_cool, dust, flash_pulses (times=[...])"""
        W, H, fps = self.w, self.h, self.fps
        qw, qh = _even(W / 4), _even(H / 4)
        d = max(0.5, duration)
        fio = f"fade=t=in:st=0:d={_n(min(0.6, d / 3))},fade=t=out:st={_n(max(0.0, d - 0.8))}:d={_n(min(0.8, d / 3))}"
        if kind in ("light_leak_warm", "light_leak_cool"):
            if kind == "light_leak_warm":
                cols = ("0xff5a00", "0x000000", "0xffb030")
            else:
                cols = ("0x2a6bff", "0x000000", "0xd23cff")
            # soft diagonal glow bands (a radial gradient produced a visible ring)
            return (f"gradients=s={qw}x{qh}:r={fps}:d={_n(d)}:c0={cols[0]}:c1={cols[1]}:c2={cols[2]}"
                    f":nb_colors=3:type=linear:x0=0:y0={qh}:x1={qw}:y1=0:speed=0.06,gblur=sigma=14,"
                    f"scale={W}:{H}:flags=bicubic,eq=contrast=1.3:brightness=-0.10:saturation=1.3,{fio},format=yuv420p")
        if kind == "dust":
            return (f"color=c=black:s={qw * 2}x{qh * 2}:r={fps}:d={_n(d)},noise=alls=100:allf=t+u,"
                    f"curves=all='0/0 0.80/0 0.92/1 1/1',gblur=sigma=0.6,scale={W}:{H}:flags=bilinear,{fio},format=yuv420p")
        if kind == "flash_pulses":
            times = [t for t in o.get("times", [0.0]) if 0 <= t < d][:40]
            if not times:
                times = [0.0]
            pulses = "+".join(f"exp(-14*(t-{_n(t)}))*gte(t,{_n(t)})" for t in times)
            return (f"color=c=black:s={qw}x{qh}:r={fps}:d={_n(d)},"
                    f"eq=brightness='min(1,{pulses})':eval=frame,scale={W}:{H}:flags=bilinear,format=yuv420p")
        raise ValueError("kinds: light_leak_warm, light_leak_cool, dust, flash_pulses")

    @staticmethod
    def film_grain(strength: float = 0.4) -> str:
        return f"noise=alls={int(round(3 + 22 * max(0.0, min(1.0, strength))))}:allf=t"

    @staticmethod
    def scanlines(opacity: float = 0.15, spacing: int = 4) -> str:
        return f"drawgrid=w=iw:h={int(spacing)}:t=1:c=black@{_n(max(0.0, min(1.0, opacity)))}"

    @staticmethod
    def chromatic_aberration(px: int = 3) -> str:
        return f"rgbashift=rh=-{int(px)}:bh={int(px)}"


# --------------------------------------------------------------------------- #
# TEXT / CAPTIONS (ASS subtitles rendered by FFmpeg's libass `ass` filter)
# --------------------------------------------------------------------------- #
def _bgr(hex_rgb: str) -> str:
    h = hex_rgb.lstrip("#")
    r, g, b = h[0:2], h[2:4], h[4:6]
    return f"{b}{g}{r}".upper()


def _ass_time(sec: float) -> str:
    sec = max(0.0, sec)
    cs = int(round(sec * 100))
    h, rem = divmod(cs, 360000)
    m, rem = divmod(rem, 6000)
    s, c = divmod(rem, 100)
    return f"{h}:{m:02d}:{s:02d}.{c:02d}"


def _esc(text: str) -> str:
    return text.replace("\\", "").replace("{", "(").replace("}", ")").replace("\n", "\\N")


class AssBuilder:
    """Builds an .ass file. Styles scale with the video size.
    caption anims : fade, pop, slide_up, typewriter, word_highlight
    title anims   : rise, blur_in, pop
    Fonts: libass uses installed fonts by *name* (Poppins, Segoe UI, Arial ...).
    Put .ttf files in a folder and pass fontsdir= to ass_filter() to be independent
    of what is installed."""

    def __init__(self, w: int, h: int, font: str = "Poppins", primary: str = "#FFFFFF",
                 accent: str = "#FFC400", outline: str = "#000000", caption_size: float = 0.040,
                 title_size: float = 0.075, align: int = 2, margin_v: float = 0.12,
                 bold: bool = True, uppercase: bool = False, shorts_safe: bool = False):
        self.w, self.h = int(w), int(h)
        self.font, self.primary, self.accent, self.outline = font, primary, accent, outline
        self.cs, self.ts = caption_size, title_size
        self.align, self.bold, self.upper = align, bold, uppercase
        self.margin_v = max(margin_v, 0.22) if shorts_safe else margin_v
        self.events: List[str] = []

    # ---- positions ---------------------------------------------------------- #
    def _xy(self, align: Optional[int] = None) -> Tuple[int, int]:
        a = align or self.align
        x = self.w // 2
        if a in (1, 4, 7):
            x = int(self.w * 0.06)
        elif a in (3, 6, 9):
            x = int(self.w * 0.94)
        if a in (1, 2, 3):
            y = int(self.h * (1 - self.margin_v))
        elif a in (4, 5, 6):
            y = self.h // 2
        else:
            y = int(self.h * self.margin_v)
        return x, y

    def _fs(self, frac: float) -> int:
        return max(12, int(self.h * frac * (1.0 if self.h > self.w else 1.5)))

    # ---- events ------------------------------------------------------------- #
    def _dlg(self, start, end, text, style="Cap", layer=0):
        self.events.append(f"Dialogue: {layer},{_ass_time(start)},{_ass_time(end)},{style},,0,0,0,,{text}")

    def caption(self, start: float, end: float, text: str, anim: str = "pop",
                words: Optional[Sequence[Tuple[str, float, float]]] = None,
                max_words: int = 3, pop: bool = False) -> None:
        """Add a caption. For word_highlight pass `words` [(word,start,end)...]
        (absolute seconds) or leave None to spread the words evenly."""
        text = text.upper() if self.upper else text
        dur_ms = int(max(0.2, end - start) * 1000)
        x, y = self._xy()
        if anim == "fade":
            self._dlg(start, end, "{\\fad(160,140)}" + _esc(text))
        elif anim == "pop":
            tags = ("{\\fscx72\\fscy72\\alpha&HFF&\\t(0,140,\\fscx108\\fscy108\\alpha&H00&)"
                    f"\\t(140,250,\\fscx100\\fscy100)\\t({max(0, dur_ms - 120)},{dur_ms},\\alpha&HFF&)}}")
            self._dlg(start, end, tags + _esc(text))
        elif anim == "slide_up":
            off = int(self.h * 0.03)
            self._dlg(start, end, f"{{\\move({x},{y + off},{x},{y},0,260)\\fad(140,120)}}" + _esc(text))
        elif anim == "typewriter":
            chars = list(text)
            total_cs = int(max(0.2, (end - start) * 0.65) * 100)
            per = max(1, total_cs // max(1, len(chars)))
            body = "".join(f"{{\\k{per}}}{_esc(c)}" for c in chars)
            self._dlg(start, end, body, style="Type")
        elif anim == "word_highlight":
            toks = text.split()
            if not words:
                weights = [max(1, len(t)) for t in toks]
                tot = float(sum(weights))
                t0, words = start, []
                for tk, wgt in zip(toks, weights):
                    t1 = t0 + (end - start) * wgt / tot
                    words.append((tk, t0, t1))
                    t0 = t1
            words = [(w_.upper() if self.upper else w_, a, b) for (w_, a, b) in words]
            for i in range(0, len(words), max_words):
                chunk = words[i:i + max_words]
                c_end = chunk[-1][2] if i + max_words < len(words) else end
                for j, (wd, a, b) in enumerate(chunk):
                    nxt = chunk[j + 1][1] if j + 1 < len(chunk) else c_end
                    parts = []
                    for k, (w2, _, _) in enumerate(chunk):
                        if k == j:
                            sc = "\\fscx110\\fscy110" if pop else ""
                            parts.append(f"{{\\c&H{_bgr(self.accent)}&{sc}}}{_esc(w2)}{{\\c&H{_bgr(self.primary)}&\\fscx100\\fscy100}}")
                        else:
                            parts.append(_esc(w2))
                    self._dlg(chunk[0][1] if j == 0 else a, nxt, " ".join(parts))
        else:
            raise ValueError("caption anim: fade, pop, slide_up, typewriter, word_highlight")

    def title(self, start: float, end: float, text: str, anim: str = "blur_in", align: int = 5) -> None:
        """Big kinetic title. anim: rise, blur_in, pop"""
        text = text.upper() if self.upper else text
        dur_ms = int(max(0.3, end - start) * 1000)
        x, y = self._xy(align)
        out = f"\\t({max(0, dur_ms - 200)},{dur_ms},\\alpha&HFF&)"
        if anim == "rise":
            tag = (f"{{\\an{align}\\move({x},{y + int(self.h * 0.03)},{x},{y},0,450)\\blur6"
                   f"\\alpha&HFF&\\t(0,380,\\blur0\\alpha&H00&){out}}}")
        elif anim == "pop":
            tag = (f"{{\\an{align}\\pos({x},{y})\\fscx60\\fscy60\\alpha&HFF&\\t(0,180,\\fscx118\\fscy118\\alpha&H00&)"
                   f"\\t(180,320,\\fscx100\\fscy100){out}}}")
        else:
            tag = (f"{{\\an{align}\\pos({x},{y})\\blur30\\alpha&HFF&\\t(0,500,\\blur0\\alpha&H00&){out}}}")
        self._dlg(start, end, tag + _esc(text), style="Title", layer=1)

    def lower_third(self, start: float, end: float, line1: str, line2: str = "",
                    y_frac: float = 0.74, bar: str = "#FFC400") -> None:
        """Animated lower third: accent bar grows, text slides in."""
        x = int(self.w * 0.07)
        y = int(self.h * y_frac)
        s1, s2 = self._fs(0.030), self._fs(0.021)
        bw, bh = max(6, int(self.w * 0.008)), int(s1 * 1.35 + (s2 * 1.5 if line2 else 0))
        dur = int((end - start) * 1000)
        shape = f"m 0 0 l {bw} 0 {bw} {bh} 0 {bh}"
        fo = f"\\t({max(0, dur - 220)},{dur},\\alpha&HFF&)"
        self._dlg(start, end, f"{{\\an7\\pos({x},{y})\\p1\\bord0\\shad0\\c&H{_bgr(bar)}&\\fscy0"
                              f"\\t(0,260,\\fscy100){fo}}}{shape}{{\\p0}}", style="Cap", layer=1)
        tx = x + bw + int(self.w * 0.018)
        self._dlg(start, end, f"{{\\an7\\move({tx - 40},{y},{tx},{y},60,380)\\alpha&HFF&\\t(60,380,\\alpha&H00&)"
                              f"\\fs{s1}{fo}}}{_esc(line1)}", style="Cap", layer=2)
        if line2:
            self._dlg(start, end, f"{{\\an7\\move({tx - 40},{y + int(s1 * 1.25)},{tx},{y + int(s1 * 1.25)},160,480)"
                                  f"\\alpha&HFF&\\t(160,480,\\alpha&H00&)\\fs{s2}\\b0\\c&H{_bgr('#DDDDDD')}&{fo}}}{_esc(line2)}",
                      style="Cap", layer=2)

    # ---- output ------------------------------------------------------------- #
    def render(self) -> str:
        fs_cap, fs_title = self._fs(self.cs), self._fs(self.ts)
        bold = -1 if self.bold else 0
        outl = max(2, int(fs_cap * 0.085))
        prim, acc, olc = _bgr(self.primary), _bgr(self.accent), _bgr(self.outline)
        mv = int(self.h * self.margin_v)
        mh = int(self.w * 0.07)
        st = ("Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, "
              "Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, "
              "Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n")
        st += (f"Style: Cap,{self.font},{fs_cap},&H00{prim},&H00{acc},&H00{olc},&H80000000,{bold},0,0,0,100,100,0,0,1,"
               f"{outl},{max(1, outl // 3)},{self.align},{mh},{mh},{mv},1\n")
        st += (f"Style: Type,{self.font},{fs_cap},&H00{prim},&HFF{prim},&H00{olc},&H80000000,{bold},0,0,0,100,100,0,0,1,"
               f"{outl},{max(1, outl // 3)},{self.align},{mh},{mh},{mv},1\n")
        st += (f"Style: Title,{self.font},{fs_title},&H00{prim},&H00{acc},&H00{olc},&H80000000,{bold},0,0,0,100,100,0,0,1,"
               f"{int(outl * 1.2)},{max(1, outl // 2)},5,{mh},{mh},{mv},1\n")
        head = ("[Script Info]\nScriptType: v4.00+\n"
                f"PlayResX: {self.w}\nPlayResY: {self.h}\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n"
                "[V4+ Styles]\n" + st + "\n[Events]\n"
                "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n")
        return head + "\n".join(self.events) + "\n"

    def save(self, path: str) -> str:
        Path(path).write_text(self.render(), encoding="utf-8")
        return str(path)


def ass_filter(ass_path: str, fontsdir: Optional[str] = None) -> str:
    """-vf fragment that burns the .ass file in (path is escaped for Windows too)."""
    f = f"ass='{ff_path(ass_path)}'"
    if fontsdir:
        f += f":fontsdir='{ff_path(fontsdir)}'"
    return f


def split_words_evenly(text: str, start: float, end: float) -> List[Tuple[str, float, float]]:
    toks = text.split()
    wts = [max(1, len(t)) for t in toks]
    tot, t0, out = float(sum(wts)), start, []
    for tk, wg in zip(toks, wts):
        t1 = t0 + (end - start) * wg / tot
        out.append((tk, t0, t1))
        t0 = t1
    return out


# --------------------------------------------------------------------------- #
# FFmpeg helpers + selftest + demo
# --------------------------------------------------------------------------- #
def find_ffmpeg() -> Tuple[str, str]:
    ff = os.environ.get("FFMPEG_PATH") or shutil.which("ffmpeg")
    fp = os.environ.get("FFPROBE_PATH") or shutil.which("ffprobe")
    if not ff or not fp:
        raise SystemExit("ffmpeg/ffprobe not found on PATH")
    return ff, fp


def detect_xfade(ffmpeg: str) -> List[str]:
    try:
        out = subprocess.run([ffmpeg, "-hide_banner", "-h", "filter=xfade"], capture_output=True,
                             text=True, errors="replace").stdout
        names = re.findall(r"^\s{4,}(\w+)\s+\d+\s+\.\.FV", out, flags=re.M)
        return names or ["fade"]
    except Exception:
        return ["fade"]


def _run(ffmpeg: str, args: List[str]) -> Tuple[bool, str]:
    p = subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-y"] + [str(a) for a in args],
                       capture_output=True, text=True, errors="replace")
    return p.returncode == 0, (p.stderr or "")[-600:]


def _frames(ffprobe: str, path: str) -> int:
    p = subprocess.run([ffprobe, "-v", "error", "-count_frames", "-select_streams", "v:0",
                        "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", str(path)],
                       capture_output=True, text=True)
    try:
        return int(p.stdout.strip().split(",")[0])
    except Exception:
        return -1


def _write_identity_cube(path: str, size: int = 9) -> None:
    lines = [f"LUT_3D_SIZE {size}"]
    for b in range(size):
        for g in range(size):
            for r in range(size):
                lines.append(f"{r / (size - 1):.6f} {g / (size - 1):.6f} {b / (size - 1):.6f}")
    Path(path).write_text("\n".join(lines) + "\n")


def _psnr_differs(ffmpeg: str, a: str, b: str) -> bool:
    p = subprocess.run([ffmpeg, "-hide_banner", "-nostdin", "-i", a, "-i", b, "-lavfi", "psnr", "-f", "null", "-"],
                       capture_output=True, text=True, errors="replace")
    m = re.search(r"average:([\w.]+)", p.stderr or "")
    return bool(m) and m.group(1) != "inf"


def selftest(w: int = 640, h: int = 360, fps: int = 24, keep: Optional[str] = None) -> int:
    ffmpeg, ffprobe = find_ffmpeg()
    xf = detect_xfade(ffmpeg)
    fx = Effects(w, h, fps, xf)
    work = Path(keep) if keep else Path(tempfile.mkdtemp(prefix="fxtest_"))
    work.mkdir(parents=True, exist_ok=True)
    results: List[Tuple[str, bool, str]] = []
    N = fps * 2

    def src(label: str, dur: float = 2.0) -> List[str]:
        if label == "a":
            return ["-f", "lavfi", "-i", f"testsrc2=s={w}x{h}:r={fps}:d={dur}"]
        # deterministic pattern (the `gradients` source is random per run, which breaks comparisons)
        return ["-f", "lavfi", "-i", f"rgbtestsrc=s={w}x{h}:r={fps}:d={dur}"]

    def check(name: str, ok: bool, msg: str = ""):
        results.append((name, ok, msg))

    # --- motion / single-clip effects
    single = {
        "motion:zoom_in": fx.motion("zoom_in", N), "motion:zoom_out": fx.motion("zoom_out", N),
        "motion:drift": fx.motion("drift", N),
        "motion:pan_left": fx.motion("pan_left", N), "motion:pan_right": fx.motion("pan_right", N),
        "motion:pan_up": fx.motion("pan_up", N), "motion:pan_down": fx.motion("pan_down", N),
        "motion:shake": fx.motion("shake", N, intensity=0.7, start=0.3, dur=1.0),
        "fx:beat_punch": fx.beat_punch([0.2, 0.7, 1.2, 1.7]),
        "fx:flash": fx.flash(0.8), "fx:glitch_hit": fx.glitch_hit(0.6),
    }
    for name, vf in single.items():
        out = work / (name.replace(":", "_") + ".mp4")
        ok, err = _run(ffmpeg, src("a") + ["-vf", vf + ",format=yuv420p", "-frames:v", N, str(out)])
        n = _frames(ffprobe, out) if ok else -1
        check(name, ok and n == N, err.strip().splitlines()[-1] if err.strip() else f"frames={n}/{N}")
    for kind in ("slow_fast_slow", "fast_slow_fast"):
        out = work / f"ramp_{kind}.mp4"
        vf = fx.speed_ramp(2.0, kind, 0.6)
        ok, err = _run(ffmpeg, src("a") + ["-vf", vf + ",format=yuv420p", "-frames:v", N, str(out)])
        n = _frames(ffprobe, out) if ok else -1
        check(f"motion:speed_ramp/{kind}", ok and abs(n - N) <= 1, err.strip()[-120:] or f"frames={n}/{N}")

    # --- color grades
    cube = work / "identity.cube"
    _write_identity_cube(str(cube))
    for name in grade_names():
        out = work / f"grade_{name}.mp4"
        ok, err = _run(ffmpeg, src("b") + ["-vf", grade(name, 1.0, grain=0.3) + ",format=yuv420p", "-frames:v", fps, str(out)])
        check(f"grade:{name}", ok and _frames(ffprobe, out) == fps, err.strip()[-120:])
    out = work / "grade_lut.mp4"
    ok, err = _run(ffmpeg, src("b") + ["-vf", grade_lut(str(cube)) + ",format=yuv420p", "-frames:v", fps, str(out)])
    check("grade:lut3d(.cube)", ok and _frames(ffprobe, out) == fps, err.strip()[-120:])

    # --- transitions (A tail + B head = exactly T frames)
    T = 14
    for name in Effects.transition_names():
        out = work / f"tr_{name}.mp4"
        g = (f"[0:v]format=yuv420p[a];[1:v]format=yuv420p[b];" + fx.transition(name, "a", "b", "x", T))
        ok, err = _run(ffmpeg, src("a") + src("b") + ["-filter_complex", g, "-map", "[x]", "-frames:v", T + 6,
                                                      "-pix_fmt", "yuv420p", str(out)])
        n = _frames(ffprobe, out) if ok else -1
        check(f"transition:{name}", ok and n == T, err.strip()[-160:] or f"frames={n}/{T}")

    # --- captions / titles / lower thirds
    plain = work / "plain.mp4"
    _run(ffmpeg, src("b") + ["-pix_fmt", "yuv420p", "-frames:v", N, str(plain)])
    ab = AssBuilder(w, h, font="Poppins")
    ab.caption(0.1, 1.9, "this is a caption test", anim="pop")
    for anim in ("fade", "slide_up", "typewriter", "word_highlight"):
        ab2 = AssBuilder(w, h, font="Poppins")
        ab2.caption(0.1, 1.9, "this is a caption test", anim=anim)
        ass = work / f"cap_{anim}.ass"
        ab2.save(str(ass))
        out = work / f"cap_{anim}.mp4"
        ok, err = _run(ffmpeg, ["-i", str(plain), "-vf", ass_filter(str(ass)), "-pix_fmt", "yuv420p", str(out)])
        check(f"text:caption/{anim}", ok and _psnr_differs(ffmpeg, str(plain), str(out)), err.strip()[-120:] or "no visible change")
    ass = work / "cap_pop.ass"
    ab.save(str(ass))
    out = work / "cap_pop.mp4"
    ok, err = _run(ffmpeg, ["-i", str(plain), "-vf", ass_filter(str(ass)), "-pix_fmt", "yuv420p", str(out)])
    check("text:caption/pop", ok and _psnr_differs(ffmpeg, str(plain), str(out)), err.strip()[-120:] or "no visible change")
    for anim in ("rise", "blur_in", "pop"):
        t = AssBuilder(w, h)
        t.title(0.1, 1.9, "BIG TITLE", anim=anim)
        ass = work / f"title_{anim}.ass"
        t.save(str(ass))
        out = work / f"title_{anim}.mp4"
        ok, err = _run(ffmpeg, ["-i", str(plain), "-vf", ass_filter(str(ass)), "-pix_fmt", "yuv420p", str(out)])
        check(f"text:title/{anim}", ok and _psnr_differs(ffmpeg, str(plain), str(out)), err.strip()[-120:] or "no visible change")
    lt = AssBuilder(w, h)
    lt.lower_third(0.1, 1.9, "Name Surname", "Economist")
    ass = work / "lt.ass"
    lt.save(str(ass))
    out = work / "lt.mp4"
    ok, err = _run(ffmpeg, ["-i", str(plain), "-vf", ass_filter(str(ass)), "-pix_fmt", "yuv420p", str(out)])
    check("text:lower_third", ok and _psnr_differs(ffmpeg, str(plain), str(out)), err.strip()[-120:] or "no visible change")

    # --- overlay / VFX
    for kind in ("light_leak_warm", "light_leak_cool", "dust", "flash_pulses"):
        ovsrc = fx.procedural_overlay(kind, 2.0, times=[0.3, 1.0])
        out = work / f"ov_{kind}.mp4"
        g = "[0:v]format=yuv420p[b];" + fx.blend_overlay("b", "1:v", "x", "screen", 0.8, frames=N)
        ok, err = _run(ffmpeg, src("b") + ["-f", "lavfi", "-i", ovsrc, "-filter_complex", g, "-map", "[x]",
                                           "-frames:v", N, "-pix_fmt", "yuv420p", str(out)])
        n = _frames(ffprobe, out) if ok else -1
        check(f"vfx:procedural/{kind}", ok and n == N and _psnr_differs(ffmpeg, str(plain), str(out)),
              err.strip()[-120:] or f"frames={n}/{N}")
    ovfile = work / "ov_src.mp4"
    _run(ffmpeg, ["-f", "lavfi", "-i", f"gradients=s={w}x{h}:r={fps}:d=1:speed=0.1:seed=3", "-pix_fmt", "yuv420p", str(ovfile)])
    for mode in Effects.BLEND_MODES:
        out = work / f"blend_{mode}.mp4"
        g = "[0:v]format=yuv420p[b];" + fx.blend_overlay("b", "1:v", "x", mode, 0.7, frames=N)
        ok, err = _run(ffmpeg, src("a") + ["-stream_loop", "-1", "-i", str(ovfile), "-filter_complex", g,
                                           "-map", "[x]", "-frames:v", N, "-pix_fmt", "yuv420p", str(out)])
        n = _frames(ffprobe, out) if ok else -1
        check(f"vfx:blend/{mode}", ok and n == N, err.strip()[-120:] or f"frames={n}/{N}")
    for key in ("green", "black"):
        out = work / f"key_{key}.mp4"
        g = "[0:v]format=yuv420p[b];" + fx.blend_overlay("b", "1:v", "x", "alpha", 1.0, key=key, frames=N)
        ok, err = _run(ffmpeg, src("a") + ["-stream_loop", "-1", "-i", str(ovfile), "-filter_complex", g,
                                           "-map", "[x]", "-frames:v", N, "-pix_fmt", "yuv420p", str(out)])
        n = _frames(ffprobe, out) if ok else -1
        check(f"vfx:key/{key}", ok and n == N, err.strip()[-120:] or f"frames={n}/{N}")
    for name, vf in (("grain", Effects.film_grain(0.5)), ("scanlines", Effects.scanlines()),
                     ("chroma_ab", Effects.chromatic_aberration(3))):
        out = work / f"misc_{name}.mp4"
        ok, err = _run(ffmpeg, src("a") + ["-vf", vf + ",format=yuv420p", "-frames:v", fps, str(out)])
        check(f"vfx:{name}", ok and _frames(ffprobe, out) == fps, err.strip()[-120:])

    # --- report
    bad = [r for r in results if not r[1]]
    print(f"effects.py {LIB_VERSION} selftest  ({w}x{h} @ {fps} fps, {len(results)} checks)")
    for name, ok, msg in results:
        print(("PASS  " if ok else "FAIL  ") + name + ("" if ok else f"   -> {msg}"))
    print(f"\n{len(results) - len(bad)}/{len(results)} passed.  Output files: {work}")
    return 1 if bad else 0


def demo(out_dir: str, w: int = 720, h: int = 1280, fps: int = 24, source: Optional[str] = None) -> int:
    """Render one short labelled clip per effect + a contact sheet so you can LOOK at them.
    source = optional video file (your own footage); otherwise a synthetic test pattern."""
    ffmpeg, ffprobe = find_ffmpeg()
    fx = Effects(w, h, fps, detect_xfade(ffmpeg))
    od = Path(out_dir)
    od.mkdir(parents=True, exist_ok=True)
    cover = f"scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},setsar=1,fps={fps}"

    def inp(offset: float, dur: float) -> List[str]:
        if source:
            return ["-ss", _n(offset), "-t", _n(dur), "-i", source]
        pat = "testsrc2" if offset < 5 else "rgbtestsrc"
        return ["-f", "lavfi", "-i", f"{pat}=s={w}x{h}:r={fps}:d={_n(dur)}"]

    clips: List[Path] = []

    def label_ass(text: str) -> str:
        b = AssBuilder(w, h, font="Poppins", align=8, margin_v=0.06, caption_size=0.028)
        b.caption(0.0, 99.0, text, anim="fade")
        p = od / ("lbl_" + re.sub(r"\W+", "_", text) + ".ass")
        b.save(str(p))
        return ass_filter(str(p))

    def render_single(name: str, vf: str, dur: float = 2.5):
        out = od / f"{len(clips):02d}_{re.sub(r'[^A-Za-z0-9]+', '_', name)}.mp4"
        ok, err = _run(ffmpeg, inp(0, dur) + ["-vf", f"{cover},{vf},{label_ass(name)},format=yuv420p",
                                              "-frames:v", int(dur * fps), "-an", str(out)])
        print(("ok   " if ok else "FAIL ") + name + ("" if ok else "  " + err.strip()[-200:]))
        if ok:
            clips.append(out)

    n = int(2.5 * fps)
    for g in grade_names():
        render_single(f"grade {g}", grade(g, 1.0, 0.2))
    for m in ("zoom_in", "zoom_out", "pan_left", "pan_right", "shake"):
        render_single(f"motion {m}", fx.motion(m, n, intensity=0.8, start=0.2, dur=2.0))
    render_single("speed ramp fast_slow_fast", fx.speed_ramp(2.5, "fast_slow_fast", 0.7))
    render_single("glitch hit", fx.glitch_hit(0.8, 0.5, 0.8))
    render_single("flash", fx.flash(0.8, 0.25))
    for k in ("light_leak_warm", "light_leak_cool", "dust"):
        out = od / f"{len(clips):02d}_vfx_{k}.mp4"
        g = (f"[0:v]{cover},{label_ass('vfx ' + k)},format=yuv420p[b];" +
             fx.blend_overlay("b", "1:v", "x", "screen", 0.9, frames=n))
        ok, err = _run(ffmpeg, inp(0, 2.5) + ["-f", "lavfi", "-i", fx.procedural_overlay(k, 2.5),
                                              "-filter_complex", g, "-map", "[x]", "-frames:v", n, "-an", str(out)])
        print(("ok   " if ok else "FAIL ") + "vfx " + k + ("" if ok else "  " + err.strip()[-200:]))
        if ok:
            clips.append(out)
    for anim in ("fade", "pop", "slide_up", "typewriter", "word_highlight"):
        b = AssBuilder(w, h, font="Poppins", shorts_safe=True)
        b.caption(0.2, 2.3, "Economy ka asli sach yeh hai", anim=anim)
        p = od / f"cap_{anim}.ass"
        b.save(str(p))
        render_single(f"caption {anim}", ass_filter(str(p)))
    for anim in ("rise", "blur_in", "pop"):
        b = AssBuilder(w, h, font="Poppins")
        b.title(0.2, 2.3, "BIG TITLE", anim=anim)
        p = od / f"title_{anim}.ass"
        b.save(str(p))
        render_single(f"title {anim}", ass_filter(str(p)))
    lt = AssBuilder(w, h, font="Poppins")
    lt.lower_third(0.2, 2.3, "Dr. Name Surname", "Economist")
    p = od / "lt.ass"
    lt.save(str(p))
    render_single("lower third", ass_filter(str(p)))

    T = int(0.6 * fps)
    for name in Effects.transition_names():
        out = od / f"{len(clips):02d}_transition_{name}.mp4"
        g = (f"[0:v]{cover},split[a0][a1];[1:v]{cover},split[b0][b1];"
             f"[a0]trim=start_frame=0:end_frame={fps},setpts=N[ahold];"
             f"[a1]trim=start_frame={fps}:end_frame={fps + T},setpts=N[atail];"
             f"[b0]trim=start_frame=0:end_frame={T},setpts=N[bhead];"
             f"[b1]trim=start_frame={T}:end_frame={T + fps},setpts=N[brest];"
             + fx.transition(name, "atail", "bhead", "tr", T) + ";"
             f"[ahold][tr][brest]concat=n=3:v=1:a=0,{label_ass('transition ' + name)},format=yuv420p[x]")
        ok, err = _run(ffmpeg, inp(0, 3) + inp(6, 3) + ["-filter_complex", g, "-map", "[x]", "-an", str(out)])
        print(("ok   " if ok else "FAIL ") + "transition " + name + ("" if ok else "  " + err.strip()[-200:]))
        if ok:
            clips.append(out)

    if clips:
        lst = od / "reel_list.txt"
        lst.write_text("".join(f"file '{c.name}'\n" for c in clips), encoding="utf-8")
        ok, err = _run(ffmpeg, ["-f", "concat", "-safe", "0", "-i", str(lst), "-c:v", "libx264", "-preset", "veryfast",
                                "-crf", "20", "-pix_fmt", "yuv420p", "-r", fps, str(od / "effects_reel.mp4")])
        print(("reel written: " + str(od / "effects_reel.mp4")) if ok else "reel FAILED " + err)
    return 0 if clips else 1


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="Agent 8 effects library")
    sub = ap.add_subparsers(dest="cmd")
    s = sub.add_parser("selftest", help="run every effect through FFmpeg and verify frame counts")
    s.add_argument("--size", default="640x360")
    s.add_argument("--keep", default=None, help="folder to keep the test clips in")
    d = sub.add_parser("demo", help="render a labelled demo clip per effect + a combined reel")
    d.add_argument("--out", default="effects_demo")
    d.add_argument("--size", default="720x1280")
    d.add_argument("--input", default=None, help="your own footage to show the effects on")
    sub.add_parser("list", help="list all effect names")
    a = ap.parse_args(argv)
    if a.cmd == "selftest":
        w, h = (int(x) for x in a.size.lower().split("x"))
        return selftest(w, h, 24, a.keep)
    if a.cmd == "demo":
        w, h = (int(x) for x in a.size.lower().split("x"))
        return demo(a.out, w, h, 24, a.input)
    print("transitions:", ", ".join(Effects.transition_names()))
    print("motion     : zoom_in zoom_out drift pan_left pan_right pan_up pan_down shake speed_ramp beat_punch flash glitch_hit")
    print("grades     :", ", ".join(grade_names()))
    print("captions   : fade pop slide_up typewriter word_highlight | titles: rise blur_in pop | lower_third")
    print("vfx        :", ", ".join(Effects.BLEND_MODES), "| keys: green black | procedural: light_leak_warm light_leak_cool dust flash_pulses")
    return 0


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(errors="replace")
    except Exception:
        pass
    sys.exit(main())
