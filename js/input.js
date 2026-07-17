// Είσοδος: swipe (κινητό) + πληκτρολόγιο (desktop).
// Το swipe αναγνωρίζεται ήδη στο touchmove μόλις περαστεί το κατώφλι,
// όχι στο touchend — αισθητά πιο άμεσο σε runner.
const SWIPE_THRESHOLD = 24; // px

export function createInput(handlers) {
  const { onLeft, onRight, onJump, onRoll, onAnyKey } = handlers;

  addEventListener("keydown", (e) => {
    onAnyKey?.(e.code);
    switch (e.code) {
      case "ArrowLeft": case "KeyA": onLeft(); break;
      case "ArrowRight": case "KeyD": onRight(); break;
      case "ArrowUp": case "KeyW": case "Space": e.preventDefault(); onJump(); break;
      case "ArrowDown": case "KeyS": onRoll(); break;
    }
  });

  let start = null;     // αρχή ενεργού touch
  let consumed = false; // έχει ήδη μετρήσει swipe αυτό το touch;

  addEventListener("touchstart", (e) => {
    start = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: performance.now() };
    consumed = false;
  }, { passive: true });

  addEventListener("touchmove", (e) => {
    if (!start || consumed) return;
    const dx = e.touches[0].clientX - start.x;
    const dy = e.touches[0].clientY - start.y;
    if (Math.abs(dx) < SWIPE_THRESHOLD && Math.abs(dy) < SWIPE_THRESHOLD) return;
    consumed = true;
    if (Math.abs(dx) > Math.abs(dy)) (dx > 0 ? onRight : onLeft)();
    else (dy < 0 ? onJump : onRoll)();
  }, { passive: true });

  addEventListener("touchend", (e) => {
    if (start && !consumed) {
      // Σκέτο tap χωρίς μετακίνηση = άλμα (πιο εύκολο για νέους παίκτες)
      const quick = performance.now() - start.t < 250;
      if (quick) onJump();
      onAnyKey?.("tap");
    }
    start = null;
    consumed = false;
  }, { passive: true });
}

export function vibrate(pattern) {
  try { navigator.vibrate?.(pattern); } catch { /* όχι παντού διαθέσιμο */ }
}
