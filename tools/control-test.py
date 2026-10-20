"""Headless checks of the player's controls: gas, rocket start, steering side, drift feel and
mini-turbo, bonus use, the barrier, pause. Needs the dev server (cd game && npx vite --port 5299)."""
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/opt/google/chrome/chrome", args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
    page = b.new_page(viewport={"width": 1000, "height": 600})
    page.set_default_timeout(90000)
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.add_init_script("try { localStorage.setItem('qk-tier', 'low') } catch (e) {}")
    page.goto("http://127.0.0.1:5299/?qkdebug")
    page.wait_for_function("() => !!window.__qk")
    page.get_by_role("button", name="Solo race").first.click()
    page.locator(".qk-cup").first.click()
    page.get_by_role("button", name="Start!").first.click()
    r = page.evaluate("""() => {
      const e = window.__qk, k = e.player.kart, out = {};
      const step = (s) => { for (let i = 0; i < Math.round(s * 30); i++) e.advance(1 / 30); };
      // rocket start: press the gas during the last count and hold it through GO
      for (let i = 0; i < 3000 && !(e.phase === 'countdown' && e.toGo() < 0.7); i++) e.advance(1 / 30);
      out.countdownLeft = +e.toGo().toFixed(2);
      e.input.keys['arrowup'] = true;
      for (let i = 0; i < 600 && e.phase !== 'racing'; i++) e.advance(1 / 60);
      out.rocketStart = k.boostT > 0.5;
      e.input.keys['arrowup'] = false;
      // no gas: the kart rolls to a stop
      step(4); out.speedNoGas = +k.speed.toFixed(1);
      // gas: it drives
      e.input.keys['arrowup'] = true; step(2); out.speedWithGas2s = +k.speed.toFixed(1);
      const center = () => { const sp = k.speed, s = k.s, lap = k.lap, hw = k.halfway; k.reset(s, 0); k.speed = sp; k.lap = lap; k.halfway = hw; };
      const turn = (key) => { center(); const y0 = k.yaw; e.input.keys[key] = true; e.advance(0.4); e.input.keys[key] = false; let d = k.yaw - y0; while (d > Math.PI) d -= 2*Math.PI; while (d < -Math.PI) d += 2*Math.PI; return d; };
      // forward = (-sin yaw, 0, -cos yaw): turning left increases yaw
      out.leftTurnsLeft = turn('arrowleft') > 0.1;
      out.rightTurnsRight = turn('arrowright') < -0.1;
      // drift feel: yaw turned and sideways speed during the first second of a drift, vs plain full steering
      const yawOver = (drift) => { center(); k.speed = 22; k.boostT = 0; k.vlat = 0; const y0 = k.yaw; let maxLat = 0;
        e.input.keys['arrowright'] = true; if (drift) e.input.keys['shift'] = true;
        for (let i = 0; i < 30; i++) { e.advance(1 / 30); maxLat = Math.max(maxLat, Math.abs(k.vlat)); }
        e.input.keys['shift'] = false; e.input.keys['arrowright'] = false;
        let d = y0 - k.yaw; while (d > Math.PI) d -= 2*Math.PI; while (d < -Math.PI) d += 2*Math.PI; return [+d.toFixed(2), +maxLat.toFixed(1)]; };
      out.steerYawLat1s = yawOver(false);
      e.advance(0.5);
      out.driftYawLat1s = yawOver(true);
      e.advance(0.5);
      // drift: hold shift + right for 2 s, release → orange mini-turbo
      center(); k.speed = 22; k.boostT = 0;
      e.input.keys['arrowright'] = true; e.input.keys['shift'] = true; e.advance(0.3); out.drifting = k.drifting; out.trace = [];
      for (let i = 0; i < 18; i++) { e.advance(0.1); const S = e.track.samples[k.idx]; k.p.addScaledVector(S.R, -k.lat); k.yaw = S.yaw; if (i % 3 === 2) out.trace.push([+k.driftT.toFixed(2), k.drifting, +k.speed.toFixed(1)]); }
      e.input.keys['shift'] = false; e.advance(1/30); out.boostAfterDrift = k.boostT > 0; e.input.keys['arrowright'] = false; e.advance(0.5);
      // bonus: give one and use it with Space
      e.player.bonus = 'turbo'; window.dispatchEvent(new KeyboardEvent('keydown', {key: ' '})); window.dispatchEvent(new KeyboardEvent('keyup', {key: ' '}));
      out.turboUsed = e.player.bonus === null && k.boostT > 0;
      e.player.bonus = 'peel'; e.useBonus(); out.peelDropped = e.peels.length === 1;
      // the barrier: drive into it at 45° and check the kart keeps going
      center(); k.speed = 22; const S0 = e.track.samples[k.idx]; k.yaw = S0.yaw - 0.8; e.advance(1.2); out.speedAfterWall = +k.speed.toFixed(1);
      e.input.keys['arrowup'] = false;
      return out;
    }""")
    for key, v in r.items():
        print(f"  {key}: {v}")
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    print("pause menu shown:", page.locator("text=Paused").count() > 0, "engine paused:", page.evaluate("() => window.__qk.paused"))
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    print("resumed:", not page.evaluate("() => window.__qk.paused"))
    print("errors:", errs)
    b.close()
