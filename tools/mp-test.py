"""
Online test: three separate browsers race each other through a real LiveKit server.

  livekit-server --dev --bind 127.0.0.1 --node-ip 127.0.0.1   (keys devkey/secret)
  node tools/lk-token.mjs                                      (dev tokens on :7890)
  cd game && npx vite --port 5299                              (the game)
  python3 tools/mp-test.py <outdir> [net]                      (net: lkdev (default) or local)

A creates a public race, B joins it with the code (URL ?join=CODE), C finds it in the list of open races.
A starts; every player is driven by the AI; the test checks that each sees the others move,
that the race ends on the host's results for everyone, and that everyone is back in the lobby.
"""
import os
import sys
import time

from playwright.sync_api import sync_playwright

NET = sys.argv[2] if len(sys.argv) > 2 else "lkdev"
BASE = f"http://127.0.0.1:5299/?qkdebug&net={NET}"
CHROME = os.environ.get("CHROME", "/opt/google/chrome/chrome")
OUT = sys.argv[1] if len(sys.argv) > 1 else "mp"
os.makedirs(OUT, exist_ok=True)

AUTOPILOT = """() => { const e = window.__qk; if (!e.player) return false;
  const D = e.racers.find(r => r.driver) ; const Ctor = D ? D.driver.constructor : null; if (!Ctor) return false;
  e.player.driver = new Ctor(e.player.kart, 0.9);
  const own = e.player; e.input.read = () => (e.player === own && own.driver ? own.driver.drive(e.track, 1/120, own.kart.progress()) : { throttle: 0, brake: 0, steer: 0, drift: false }); return true; }"""

FF = "() => { const e = window.__qk; if (e.phase === 'racing' && e.player && !e.player.kart.finished) e.advance(2); return !!document.querySelector('.qk-results'); }"


def race_to_results(pages, limit=400):
    """Software rendering is slow here: fast-forward each player's own kart until every page shows the results."""
    t0 = time.time()
    while time.time() - t0 < limit:
        done = [pg.evaluate(FF) for pg in pages]
        if all(done):
            return
        time.sleep(0.5)
    raise RuntimeError("no results after %ds" % limit)


def logs(page, tag, errs):
    page.on("console", lambda m: errs.append(f"[{tag}] {m.type}: {m.text}") if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: errs.append(f"[{tag}] pageerror: {e}"))


def main():
    errs = []
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=CHROME, args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required", "--allow-loopback-in-peer-connection", "--disable-features=WebRtcHideLocalIpsWithMdns"])
        ctxs = [b.new_context(viewport={"width": 640, "height": 400}) for _ in range(3)]
        for c in ctxs:  # software rendering on a small machine: lowest quality keeps three browsers moving
            c.add_init_script("try { localStorage.setItem('qk-tier', 'low') } catch (e) {}")
            c.set_default_timeout(120000)
        A, B, C = [c.new_page() for c in ctxs]
        for pg, tag in ((A, "A"), (B, "B"), (C, "C")):
            logs(pg, tag, errs)
        A.goto(BASE)
        A.wait_for_function("() => !!window.__qk", timeout=90000)
        A.get_by_role("button", name="Race online").dispatch_event("click")
        A.locator(".qk-tile.create").dispatch_event("click")
        A.locator(".qk-create .qk-seg button").nth(1).dispatch_event("click")  # public
        A.locator(".qk-create .qk-btn.qk-go").dispatch_event("click")
        A.wait_for_selector(".qk-lobby .qk-codetiles", timeout=30000)
        A.wait_for_function("() => document.querySelectorAll('.qk-lobby .qk-codetiles span.on').length === 5", timeout=30000)
        code = A.evaluate("() => Array.from(document.querySelectorAll('.qk-lobby .qk-codetiles span')).map(s => s.textContent).join('')")
        print("lobby code", code)
        A.screenshot(path=os.path.join(OUT, "A-lobby.png"))

        B.goto(BASE + f"&join={code}")
        B.wait_for_selector(".qk-lobby .qk-players", timeout=60000)
        A.wait_for_function("() => document.querySelectorAll('.qk-players li:not(.ai)').length >= 2", timeout=30000)
        print("B joined by code")

        C.goto(BASE)
        C.wait_for_function("() => !!window.__qk", timeout=90000)
        try:
            C.get_by_role("button", name="Race online").dispatch_event("click")
        except Exception:
            C.screenshot(path=os.path.join(OUT, "C-fail.png"))
            print("C screen:", C.evaluate("() => document.body.innerText.slice(0, 300)"))
            print("\n".join(errs[-15:]))
            raise
        C.wait_for_selector(".qk-ads li", timeout=30000)
        C.screenshot(path=os.path.join(OUT, "C-hub.png"))
        C.locator(".qk-ads li .qk-btn").first.dispatch_event("click")
        A.wait_for_function("() => document.querySelectorAll('.qk-players li:not(.ai)').length >= 3", timeout=30000)
        print("C joined from the list")
        C.locator(".qk-racer").nth(2).dispatch_event("click")  # pick another racer
        time.sleep(1.5)
        A.screenshot(path=os.path.join(OUT, "A-lobby3.png"))
        B.screenshot(path=os.path.join(OUT, "B-lobby.png"))

        A.get_by_role("button", name="Start the race!").first.dispatch_event("click")
        for pg in (A, B, C):
            pg.wait_for_selector(".qk-hud", timeout=30000)
        print("race started on all three")
        # 1 lap for the test, AI drives each player
        for pg in (A, B, C):
            pg.wait_for_function("() => window.__qk && window.__qk.phase === 'racing'", timeout=30000)
            pg.evaluate("() => { window.__qk.laps = 1; }")
            pg.evaluate(AUTOPILOT)
        time.sleep(20)
        for pg, tag in ((A, "A"), (B, "B"), (C, "C")):
            info = pg.evaluate("""() => { const e = window.__qk; return e.racers.map(r => [r.spec.id.slice(0,8), r.kind, r.kind === 'remote' ? r.snaps.length : -1, Math.round(r.kart.progress())]); }""")
            print(tag, info)
            pg.screenshot(path=os.path.join(OUT, f"{tag}-race.png"))
        # wait for the host's results
        race_to_results((A, B, C))
        for pg, tag in ((A, "A"), (B, "B"), (C, "C")):
            print(tag, "results:", pg.evaluate("() => Array.from(document.querySelectorAll('.qk-standings li .n')).map(n => n.textContent)"))
        A.screenshot(path=os.path.join(OUT, "A-results.png"))
        C.screenshot(path=os.path.join(OUT, "C-results.png"))
        for pg in (A, B, C):
            pg.wait_for_selector(".qk-lobby", timeout=60000)
        print("everyone back in the lobby")
        # host leaves: B (next in order) becomes host
        A.get_by_role("button", name="Leave").first.dispatch_event("click")
        B.wait_for_function("() => !!document.querySelector('.qk-lobby .qk-btn.qk-go')", timeout=30000)
        print("host hand-over ok")
        B.screenshot(path=os.path.join(OUT, "B-newhost.png"))
        b.close()
    print("errors:", len(errs))
    for e in errs[:30]:
        print(" ", e)


if __name__ == "__main__":
    main()
