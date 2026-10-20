"""
Online test 2: quick races and late joiners (same servers as tools/mp-test.py).

A taps Quick race (nothing open: a quick lobby is created and starts on its own after a short wait),
B taps Quick race and lands in A's lobby, the race starts by itself, C arrives mid-race and watches,
then C races in the next race.
"""
import os
import sys
import time

from playwright.sync_api import sync_playwright

NET = sys.argv[2] if len(sys.argv) > 2 else "lkdev"
BASE = f"http://127.0.0.1:5299/?qkdebug&net={NET}"
OUT = sys.argv[1] if len(sys.argv) > 1 else "mp2"
os.makedirs(OUT, exist_ok=True)
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--allow-loopback-in-peer-connection", "--disable-features=WebRtcHideLocalIpsWithMdns"]
AUTOPILOT = """() => { const e = window.__qk; if (!e.player) return false;
  const D = e.racers.find(r => r.driver); if (!D) return false;
  e.player.driver = new D.driver.constructor(e.player.kart, 0.9);
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


def main():
    errs = []
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path="/opt/google/chrome/chrome", args=ARGS)
        ctxs = [b.new_context(viewport={"width": 640, "height": 400}) for _ in range(3)]
        for c in ctxs:  # software rendering on a small machine: lowest quality keeps three browsers moving
            c.add_init_script("try { localStorage.setItem('qk-tier', 'low') } catch (e) {}")
            c.set_default_timeout(120000)
        A, B, C = [c.new_page() for c in ctxs]
        for pg, tag in ((A, "A"), (B, "B"), (C, "C")):
            pg.on("pageerror", lambda e, tag=tag: errs.append(f"[{tag}] {e}"))
            pg.on("console", lambda m, tag=tag: errs.append(f"[{tag}] {m.text}") if m.type == "error" else None)
            pg.goto(BASE)
            pg.wait_for_function("() => !!window.__qk", timeout=90000)
        A.get_by_role("button", name="Race online").click()
        time.sleep(2)
        A.locator(".qk-tile.quick").click()
        A.wait_for_function("() => window.__qkLobby && window.__qkLobby.state.info && window.__qkLobby.state.info.quick", timeout=30000)
        code = A.evaluate("() => window.__qkLobby.code")
        print("A made quick lobby", code)
        B.get_by_role("button", name="Race online").click()
        B.wait_for_selector(".qk-ads li", timeout=30000)
        B.locator(".qk-tile.quick").click()
        B.wait_for_function(f"() => window.__qkLobby && window.__qkLobby.code === '{code}'", timeout=30000)
        print("B quick-joined the same lobby")
        A.screenshot(path=os.path.join(OUT, "A-quick-lobby.png"))
        # no button press: the quick lobby starts by itself
        A.wait_for_function("() => window.__qk.setup && window.__qk.setup.mode === 'online'", timeout=60000)
        B.wait_for_function("() => window.__qk.setup && window.__qk.setup.mode === 'online'", timeout=30000)
        print("quick race started by itself")
        for pg in (A, B):
            pg.wait_for_function("() => window.__qk.phase === 'racing'", timeout=30000)
            pg.evaluate("() => { window.__qk.laps = 1; }")
            pg.evaluate(AUTOPILOT)
        # C arrives mid-race
        C.goto(BASE + f"&join={code}")
        C.wait_for_function("() => window.__qk && window.__qk.setup && window.__qk.setup.mode === 'online' && !window.__qk.player", timeout=60000)
        time.sleep(4)
        C.screenshot(path=os.path.join(OUT, "C-spectating.png"))
        print("C is watching:", C.evaluate("() => document.querySelector('.qk-spectate') ? document.querySelector('.qk-spectate').innerText : 'no banner'"))
        ST = "() => { const e = window.__qk, L = window.__qkLobby, i = L && L.state.info; return JSON.stringify({ph: e.phase, fin: e.player ? e.player.kart.finished : null, lap: e.player ? e.player.kart.lap : null, laps: e.laps, lob: i && i.phase, host: L && L.isHost, res: !!document.querySelector('.qk-results')}) }"
        race_to_results((A, B, C))
        print("results on all three (C watched)")
        for pg in (A, B, C):
            pg.wait_for_selector(".qk-lobby", timeout=60000)
        # next race: C now has a kart
        C.wait_for_function("() => window.__qk && window.__qk.setup && window.__qk.setup.mode === 'online' && !!window.__qk.player", timeout=90000)
        n = C.evaluate("() => window.__qk.racers.filter(r => r.spec.kind !== 'ai').length")
        print("C races the next one; humans on the grid:", n)
        C.screenshot(path=os.path.join(OUT, "C-next-race.png"))
        b.close()
    print("errors:", len(errs))
    for e in errs[:20]:
        print(" ", e)


if __name__ == "__main__":
    main()
