#!/usr/bin/env python3
"""Gera tokens.css e tailwind.preset.js a partir de tokens.json. Só stdlib.

    python3 -I replica/design/build_tokens.py

tokens.json é a fonte da verdade. Os dois arquivos gerados não são editados à mão.
Tema: <html data-theme="dark|light">. Sem o atributo, segue o sistema (padrão escuro).
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def px(v):
    return "%dpx" % v if isinstance(v, (int, float)) else str(v)


def theme_block(selector, colors):
    lines = ["%s {" % selector]
    lines += ["  --color-%s: %s;" % (k, v) for k, v in colors.items()]
    lines.append("}")
    return "\n".join(lines)


def build_css(t):
    out = ["/* Gerado por build_tokens.py a partir de tokens.json. Não edite. */", ""]
    dark, light = t["color"]["dark"], t["color"]["light"]
    out.append(theme_block(':root,\n[data-theme="dark"]', dark))
    out.append("")
    out.append(theme_block('[data-theme="light"]', light))
    out.append("")
    inner = theme_block(':root:not([data-theme="dark"])', light).replace("\n", "\n  ")
    out.append("@media (prefers-color-scheme: light) {\n  %s\n}" % inner)
    out.append("")
    out.append(':root { color-scheme: dark; }\n[data-theme="light"] { color-scheme: light; }')
    out.append("")
    out.append(":root {")
    out.append("  --font-sans: %s;" % t["font"]["sans"])
    out.append("  --font-mono: %s;" % t["font"]["mono"])
    for name, s in t["type"].items():
        out.append("  --text-%s: %dpx;" % (name, s["size"]))
        out.append("  --leading-%s: %dpx;" % (name, s["line"]))
        out.append("  --weight-%s: %d;" % (name, s["weight"]))
    for v in t["space"]:
        out.append("  --space-%s: %dpx;" % (v, v))
    for k, v in t["size"].items():
        out.append("  --size-%s: %s;" % (k, px(v)))
    for k, v in t["layout"].items():
        if isinstance(v, (int, float)):
            out.append("  --layout-%s: %s;" % (k, px(v)))
    for k, v in t["radius"].items():
        out.append("  --radius-%s: %s;" % (k, px(v)))
    for k, v in t["shadow"].items():
        out.append("  --shadow-%s: %s;" % (k, v))
    out.append("  --motion-fast: %s;" % t["motion"]["fast"])
    out.append("  --motion-base: %s;" % t["motion"]["base"])
    out.append("  --motion-ease: %s;" % t["motion"]["ease"])
    for k, v in t["z"].items():
        out.append("  --z-%s: %s;" % (k, v))
    for k, v in t.get("effect", {}).items():
        out.append("  --effect-%s: %s;" % (k, v))
    out.append("}")
    out.append("")
    out.append("html, body {\n  background: var(--color-surface);\n  color: var(--color-text);\n"
               "  font: var(--weight-base) var(--text-base)/var(--leading-base) var(--font-sans);\n}")
    out.append(":focus-visible { outline: 2px solid var(--color-focus); outline-offset: 1px; }")
    out.append("@media (prefers-reduced-motion: reduce) {\n  :root { --motion-fast: 0ms; --motion-base: 0ms; }\n}")
    return "\n".join(out) + "\n"


def build_preset(t):
    colors = {k: "var(--color-%s)" % k for k in t["color"]["dark"]}
    colors.update({k: "var(--effect-%s)" % k for k in t.get("effect", {})})
    font_size = {k: ["var(--text-%s)" % k, {"lineHeight": "var(--leading-%s)" % k,
                                            "fontWeight": "var(--weight-%s)" % k}]
                 for k in t["type"]}
    spacing = {str(v / 4).rstrip("0").rstrip(".") if v % 4 else str(v // 4): "var(--space-%s)" % v
               for v in t["space"]}
    spacing.update({k: "var(--size-%s)" % k for k in t["size"]})
    spacing.update({k: "var(--layout-%s)" % k for k, v in t["layout"].items()
                    if isinstance(v, (int, float))})
    preset = {
        "darkMode": ["selector", '[data-theme="dark"]'],
        "theme": {
            "colors": dict(colors, transparent="transparent", current="currentColor"),
            "fontFamily": {"sans": "var(--font-sans)", "mono": "var(--font-mono)"},
            "fontSize": font_size,
            "spacing": spacing,
            "borderRadius": dict({k: "var(--radius-%s)" % k for k in t["radius"]},
                                 none="0", DEFAULT="var(--radius-sm)"),
            "boxShadow": dict({k: "var(--shadow-%s)" % k for k in t["shadow"]}, none="none"),
            "zIndex": {k: "var(--z-%s)" % k for k in t["z"]},
            "extend": {
                "transitionDuration": {"fast": "var(--motion-fast)", "base": "var(--motion-base)"},
                "transitionTimingFunction": {"ide": "var(--motion-ease)"},
                "height": {k: "var(--size-%s)" % k for k in t["size"]},
            },
        },
    }
    body = json.dumps(preset, indent=2, ensure_ascii=False)
    return ("// Gerado por build_tokens.py a partir de tokens.json. Não edite.\n"
            "// Tailwind v3: presets: [require('./replica/design/tailwind.preset.js')]\n"
            "// Tailwind v4: @config \"./replica/design/tailwind.preset.js\";\n"
            "// Paleta fechada: só as cores dos tokens existem (bg-surface, text-muted...), sem hex solto.\n"
            "module.exports = %s;\n" % body)


def main():
    with open(os.path.join(HERE, "tokens.json"), encoding="utf-8") as fh:
        t = json.load(fh)
    missing = set(t["color"]["dark"]) ^ set(t["color"]["light"])
    if missing:
        print("build_tokens: papéis só num dos temas: %s" % ", ".join(sorted(missing)), file=sys.stderr)
        return 1
    with open(os.path.join(HERE, "tokens.css"), "w", encoding="utf-8") as fh:
        fh.write(build_css(t))
    with open(os.path.join(HERE, "tailwind.preset.js"), "w", encoding="utf-8") as fh:
        fh.write(build_preset(t))
    print("tokens.css e tailwind.preset.js gerados (%d papéis de cor por tema)" % len(t["color"]["dark"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
