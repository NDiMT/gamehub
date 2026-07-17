// DOM HUD + οθόνες. Κρατάει όλα τα element lookups σε ένα μέρος.
export function createHud() {
  const $ = (id) => document.getElementById(id);
  const el = {
    hud: $("hud"), score: $("score"), stars: $("stars"), best: $("best"),
    start: $("start-screen"), gameover: $("gameover-screen"),
    finalScore: $("final-score"), finalBest: $("final-best"),
    vignette: $("void-vignette"), loading: $("loading-screen"),
    warning: $("void-warning"),
  };

  let lastScore = -1, lastStars = -1;

  return {
    el,
    showLoading(on) { el.loading.classList.toggle("hidden", !on); },
    showStart() {
      el.start.classList.remove("hidden");
      el.gameover.classList.add("hidden");
      el.hud.classList.add("hidden");
    },
    showPlaying() {
      el.start.classList.add("hidden");
      el.gameover.classList.add("hidden");
      el.hud.classList.remove("hidden");
    },
    showGameOver(score, stars, best, isRecord) {
      el.finalScore.textContent = `${score}`;
      el.finalBest.textContent = isRecord ? "ΝΕΟ ΡΕΚΟΡ! 🎉" : `Ρεκόρ: ${best}`;
      el.gameover.classList.remove("hidden");
    },
    setBest(best) { el.best.textContent = `BEST ${best}`; },
    update(score, stars) {
      if (score !== lastScore) { el.score.textContent = score; lastScore = score; }
      if (stars !== lastStars) { el.stars.textContent = `✦ ${stars}`; lastStars = stars; }
    },
    // 0 → αόρατο, 1 → το κενό είναι πάνω σου
    setVoidIntensity(v) {
      el.vignette.style.opacity = (v * 0.9).toFixed(2);
      el.warning.classList.toggle("hidden", v < 0.35);
    },
  };
}
