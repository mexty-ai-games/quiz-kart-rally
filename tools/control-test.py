"""Headless checks of the player's controls: steering side, drift mini-turbo, bonus use, pause."""
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/opt/google/chrome/chrome", args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
    page = b.new_page(viewport={"width": 1000, "height": 600})
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto("http://127.0.0.1:5299/?qkdebug")
    page.wait_for_function("() => !!window.__qk", timeout=90000)
    page.get_by_role("button", name="Play", exact=True).click()
    page.locator(".qk-cup").first.click()
    page.get_by_role("button", name="Start!").click()
    r = page.evaluate("""() => {
      const e = window.__qk, k = e.player.kart, out = {};
      e.advance(3.2); out.phase = e.phase;
      e.advance(2); out.speedAfter2s = +k.speed.toFixed(1);
      const center = () => { const sp = k.speed, s = k.s, lap = k.lap, hw = k.halfway; k.reset(s, 0); k.speed = sp; k.lap = lap; k.halfway = hw; };
      const turn = (key) => { center(); const y0 = k.yaw; e.input.keys[key] = true; e.advance(0.4); e.input.keys[key] = false; let d = k.yaw - y0; while (d > Math.PI) d -= 2*Math.PI; while (d < -Math.PI) d += 2*Math.PI; return d; };
      // forward = (-sin yaw, 0, -cos yaw): turning left increases yaw
      out.leftTurnsLeft = turn('arrowleft') > 0.1;
      out.rightTurnsRight = turn('arrowright') < -0.1;
      // drift: hold shift + right for 2 s, release → orange mini-turbo
      center(); k.speed = 22; k.boostT = 0;
      e.input.keys['arrowright'] = true; e.input.keys['shift'] = true; e.advance(0.3); out.drifting = k.drifting; out.onGrass = k.onGrass; out.trace = []; for (let i = 0; i < 18; i++) { e.advance(0.1); const S = e.track.samples[k.idx]; k.p.addScaledVector(S.R, -k.lat); k.yaw = S.yaw; if (i % 3 === 2) out.trace.push([+k.driftT.toFixed(2), k.drifting, +k.speed.toFixed(1)]); }
      e.input.keys['shift'] = false; e.advance(1/30); out.boostAfterDrift = k.boostT > 0; e.input.keys['arrowright'] = false; e.advance(0.5);
      // bonus: give one and use it with Space
      e.player.bonus = 'turbo'; window.dispatchEvent(new KeyboardEvent('keydown', {key: ' '})); window.dispatchEvent(new KeyboardEvent('keyup', {key: ' '}));
      out.turboUsed = e.player.bonus === null && k.boostT > 0;
      e.player.bonus = 'peel'; e.useBonus(); out.peelDropped = e.peels.length === 1;
      // the barrier: drive into it at 45° and check the kart keeps going
      center(); k.speed = 22; const S0 = e.track.samples[k.idx]; k.yaw = S0.yaw - 0.8; e.advance(1.2); out.speedAfterWall = +k.speed.toFixed(1);
      return out;
    }""")
    print(r)
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    print("pause menu shown:", page.locator("text=Paused").count() > 0, "engine paused:", page.evaluate("() => window.__qk.paused"))
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    print("resumed:", not page.evaluate("() => window.__qk.paused"))
    print("errors:", errs)
    b.close()
