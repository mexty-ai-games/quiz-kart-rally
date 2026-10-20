// Dev only (not part of the EdVerse block): ?shot=title|race|answer|results drives the game to a scene
// so a headless browser can screenshot it for the README (load with ?qkdebug).
const shot = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('shot') : null;
export function setupShots() {
  if (!shot) return;
  (window as any).__qkShot = shot;
}
