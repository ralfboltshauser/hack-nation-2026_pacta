const slides = [...document.querySelectorAll(".slide")];
const chapter = document.querySelector("#chapter");
const counter = document.querySelector("#counter");
const progress = document.querySelector("#progress");
const notes = document.querySelector("#speakerNotes");
const notesCopy = document.querySelector("#notesCopy");
let current = 0;

function render(next) {
  current = Math.max(0, Math.min(slides.length - 1, next));
  slides.forEach((slide, index) => {
    slide.classList.toggle("active", index === current);
    slide.setAttribute("aria-hidden", index === current ? "false" : "true");
  });
  const active = slides[current];
  chapter.textContent = active.dataset.chapter ?? "Pacta";
  counter.textContent = `${String(current + 1).padStart(2, "0")} / ${String(slides.length).padStart(2, "0")}`;
  progress.style.transform = `scaleX(${(current + 1) / slides.length})`;
  notesCopy.textContent = active.dataset.notes ?? "";
  history.replaceState(null, "", `#${current + 1}`);
}

function next() { render(current + 1); }
function previous() { render(current - 1); }
function toggleNotes(force) {
  notes.classList.toggle("open", typeof force === "boolean" ? force : undefined);
}
async function toggleFullscreen() {
  if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
  else await document.exitFullscreen();
}

document.querySelector("#nextButton").addEventListener("click", next);
document.querySelector("#previousButton").addEventListener("click", previous);
document.querySelector("#notesButton").addEventListener("click", () => toggleNotes());
document.querySelector("#closeNotes").addEventListener("click", () => toggleNotes(false));
document.querySelector("#fullscreenButton").addEventListener("click", toggleFullscreen);
document.querySelectorAll("[data-go]").forEach((button) => button.addEventListener("click", () => render(Number(button.dataset.go))));

document.addEventListener("keydown", (event) => {
  if (["ArrowRight", "PageDown", " "].includes(event.key)) { event.preventDefault(); next(); }
  if (["ArrowLeft", "PageUp", "Backspace"].includes(event.key)) { event.preventDefault(); previous(); }
  if (event.key.toLowerCase() === "n") toggleNotes();
  if (event.key.toLowerCase() === "f") toggleFullscreen();
  if (event.key === "Home") render(0);
  if (event.key === "End") render(slides.length - 1);
  if (event.key === "Escape") toggleNotes(false);
});

let pointerStart = null;
document.addEventListener("pointerdown", (event) => { pointerStart = { x: event.clientX, time: performance.now() }; });
document.addEventListener("pointerup", (event) => {
  if (!pointerStart) return;
  const distance = event.clientX - pointerStart.x;
  const velocity = Math.abs(distance) / Math.max(1, performance.now() - pointerStart.time);
  if (Math.abs(distance) > 80 || velocity > 0.65) distance < 0 ? next() : previous();
  pointerStart = null;
});

const hashSlide = Number(location.hash.slice(1));
render(Number.isFinite(hashSlide) && hashSlide > 0 ? hashSlide - 1 : 0);
