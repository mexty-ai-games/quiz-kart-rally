"""
Drives the local dev build in headless Chrome and saves screenshots (and console errors).

  python3 tools/shots.py <outdir> [scene ...]
Scenes: title, cups, racer, race, answer, mobile, results, intro, jump  (env: TIER=low|medium|high|ultra, CUP=0..3)
Needs the dev server (cd game && npx vite --port 5299) and Chrome.
"""
import os
import sys
import time

from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:5299/?qkdebug"
CHROME = os.environ.get("CHROME", "/opt/google/chrome/chrome")


def click(page, text):
    page.get_by_role("button", name=text).first.click()


def run(out, scenes):
    os.makedirs(out, exist_ok=True)
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=CHROME, args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"])
        for sc in scenes:
            mobile = sc == "mobile"
            ctx = b.new_context(viewport={"width": 844, "height": 390} if mobile else {"width": 1280, "height": 720}, has_touch=mobile, is_mobile=mobile, device_scale_factor=1)
            page = ctx.new_page()
            if os.environ.get("TIER"):
                page.add_init_script(f"try {{ localStorage.setItem('qk-tier', '{os.environ['TIER']}') }} catch (e) {{}}")
            errs = []
            page.on("console", lambda m: errs.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
            page.on("pageerror", lambda e: errs.append(f"pageerror: {e}"))
            page.goto(URL)
            page.wait_for_function("() => !!window.__qk", timeout=90000)
            page.wait_for_timeout(1500 if sc != "title" else 5000)
            if sc != "title":
                page.get_by_role("button", name="Solo race").first.click()
                page.wait_for_timeout(400)
            if sc in ("racer", "race", "answer", "mobile", "results", "intro", "jump"):
                page.locator(".qk-cup").nth(int(os.environ.get("CUP", "0"))).click()
                page.wait_for_timeout(600)
            if sc in ("race", "answer", "mobile", "results", "intro", "jump"):
                click(page, "Start!")
                # an autopilot steers the player's kart for the screenshots
                page.evaluate("() => { const e = window.__qk; e.player.driver = new (e.racers.find(r => r.driver).driver.constructor)(e.player.kart, 0.8); e.input.read = () => e.player.driver.drive(e.track, 1/120, e.player.kart.progress()); }")
                # fast-forward the race in fixed steps
                page.evaluate("() => window.__qk.advance(%s)" % ("1.4" if sc == "intro" else "7"))  # intro flyover + countdown
                secs = {"race": 26, "answer": 0, "mobile": 24, "results": 0, "intro": 0, "jump": 0}[sc]
                if sc == "jump":
                    page.evaluate("""() => { const e = window.__qk; for (let i = 0; i < 9000; i++) { e.advance(1/30); const k = e.player.kart; if (k.air && k.airT > 0.22) break; } }""")
                page.evaluate(f"() => window.__qk.advance({secs})")
                if sc == "answer":
                    # drive until the first question shows, then until the row is crossed
                    page.evaluate("""() => { const e = window.__qk; for (let i = 0; i < 4000; i++) { e.advance(1/30); const h = e.track; const k = e.player.kart; const r = h.rows[0]; let d = r.s - k.s; if (d < -h.length/2) d += h.length; if (k.lap >= 0 && d > 0 && d < 38) break; } }""")
                if sc == "results":
                    page.evaluate("() => window.__qk.advance(400)")
                page.wait_for_timeout(1200)
            page.screenshot(path=os.path.join(out, f"{sc}{os.environ.get('CUP', '')}{os.environ.get('TIER', '')}.png"))
            print(sc, "errors:", errs[:8])
            ctx.close()
        b.close()


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "shots"
    scenes = sys.argv[2:] or ["title", "cups", "racer", "race"]
    run(out, scenes)
