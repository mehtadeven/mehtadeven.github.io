// Page behaviour (everything except the 3D scene).

// ---- Your links: fill these in and the buttons appear automatically ----
export const PROFILE = {
  linkedin: "", // e.g. "https://www.linkedin.com/in/your-handle/"
  email: "",    // e.g. "you@example.com"
};

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Show the LinkedIn / email buttons once a link is set above.
for (const el of document.querySelectorAll("[data-profile]")) {
  const key = el.dataset.profile;
  const value = PROFILE[key];
  if (!value) continue;
  el.href = key === "email" ? `mailto:${value}` : value;
  el.hidden = false;
}

// Nav background after scrolling a little.
const nav = document.getElementById("nav");
const onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 24);
window.addEventListener("scroll", onScroll, { passive: true });
onScroll();

// Fade content in as it enters the viewport.
const io = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add("in-view");
        if (entry.target.classList.contains("reveal")) io.unobserve(entry.target);
      } else if (entry.target.classList.contains("layer")) {
        entry.target.classList.remove("in-view");
      }
    }
  },
  { threshold: 0.35 }
);
document.querySelectorAll(".reveal, .layer").forEach((el) => io.observe(el));

// Layer progress dots (desktop).
const hud = document.getElementById("hud");
const hudLinks = [...hud.querySelectorAll("a")];
const layers = hudLinks.map((a) => document.querySelector(a.getAttribute("href")));
const journey = document.getElementById("journey");
function updateHud() {
  const mid = window.innerHeight / 2;
  const box = journey.getBoundingClientRect();
  hud.classList.toggle("show", box.top < mid && box.bottom > mid);
  let active = -1;
  layers.forEach((layer, i) => {
    if (layer.getBoundingClientRect().top < mid) active = i;
  });
  hudLinks.forEach((a, i) => {
    a.classList.toggle("active", i === active);
    a.classList.toggle("done", i < active);
  });
}
window.addEventListener("scroll", updateHud, { passive: true });
window.addEventListener("resize", updateHud);
updateHud();

// Gentle 3D tilt on project cards.
if (!reduceMotion && window.matchMedia("(hover: hover)").matches) {
  for (const card of document.querySelectorAll(".project")) {
    card.addEventListener("pointermove", (e) => {
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      card.style.setProperty("--ry", `${(x - 0.5) * 8}deg`);
      card.style.setProperty("--rx", `${(0.5 - y) * 8}deg`);
      card.style.setProperty("--mx", `${x * 100}%`);
      card.style.setProperty("--my", `${y * 100}%`);
    });
    card.addEventListener("pointerleave", () => {
      card.style.setProperty("--rx", "0deg");
      card.style.setProperty("--ry", "0deg");
    });
  }
}

// Type out the terminal line once.
const typed = document.getElementById("typed");
if (typed && !reduceMotion) {
  const full = typed.textContent;
  typed.textContent = "";
  let i = 0;
  const tick = () => {
    typed.textContent = full.slice(0, ++i);
    if (i < full.length) setTimeout(tick, full[i - 1] === " " ? 90 : 45);
  };
  setTimeout(tick, 500);
}
