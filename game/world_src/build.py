"""Assemble world.html from head.html + baked.js + js/*.js.  Run: python3 build.py"""
import glob, os
here = os.path.dirname(os.path.abspath(__file__))
rd = lambda p: open(os.path.join(here, p), encoding="utf-8").read()
js = "\n".join(rd(p) for p in sorted(glob.glob(os.path.join(here, "js", "*.js"))) if True) if False else "\n".join(open(p, encoding="utf-8").read() for p in sorted(glob.glob(os.path.join(here, "js", "*.js"))))
out = rd("head.html") + '\n<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>\n<script>\n' + rd("baked.js") + '</script>\n<script>\n(() => {\n' + js + '\n})();\n</script>\n'
open(os.path.join(here, "..", "world.html"), "w", encoding="utf-8").write(out)
print("world.html", len(out) // 1024, "KB")
