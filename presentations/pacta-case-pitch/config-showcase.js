const CONFIGS = {
  freight: {
    title: "Pacta Freight",
    badge: "IMPLEMENTED CONFIG",
    jobName: "Load definition",
    offerName: "Quote definition",
    job: [
      ["Route", "Zürich → Munich"],
      ["Equipment", "Dry van 53"],
      ["Weight", "8,000 kg"],
      ["Risk", "Critical load"],
    ],
    offer: [
      ["Price", "All-in total"],
      ["Line items", "Linehaul · fuel · tolls"],
      ["Service", "Pickup · delivery"],
      ["Coverage", "Cargo insurance"],
    ],
    behavior: "Missing tolls or coverage → not comparable",
    action: "wave",
  },
  contractor: {
    title: "Pacta Contractors",
    badge: "IMPLEMENTED CONFIG",
    jobName: "Scope definition",
    offerName: "Bid definition",
    job: [
      ["Site", "Commercial property"],
      ["Scope", "Electrical retrofit"],
      ["Schedule", "Start · deadline"],
      ["Terms", "Materials · permit"],
    ],
    offer: [
      ["Price", "Labor · materials"],
      ["Permits", "Included / excluded"],
      ["Schedule", "Start · completion"],
      ["Protection", "Warranty months"],
    ],
    behavior: "Unresolved permit cost → not comparable",
    action: "curious",
  },
  moving: {
    title: "Pacta Moving",
    badge: "ILLUSTRATIVE NEXT CONFIG",
    jobName: "Move definition",
    offerName: "Estimate definition",
    job: [
      ["Addresses", "Origin · destination"],
      ["Inventory", "Rooms · large items"],
      ["Access", "Stairs · long carry"],
      ["Service", "Date · packing"],
    ],
    offer: [
      ["Price", "Labor · truck · travel"],
      ["Materials", "Packing supplies"],
      ["Accessorials", "Stairs · carry"],
      ["Protection", "Coverage · quote type"],
    ],
    behavior: "Unknown accessorials → price is not trustworthy",
    action: "spin",
  },
};

const showcase = document.querySelector(".config-showcase");
const configSlide = showcase?.closest(".slide");
const keys = Object.keys(CONFIGS);
let activeKey = "freight";
let cycleTimer = null;

function fieldMarkup(fields) {
  return fields
    .map(
      ([label, value]) =>
        `<div class="config-field"><span>${label}</span><strong>${value}</strong></div>`,
    )
    .join("");
}

function renderConfig(key, animate = true) {
  if (!showcase || !CONFIGS[key]) return;
  const config = CONFIGS[key];
  activeKey = key;
  if (animate) showcase.classList.add("switching");

  window.setTimeout(
    () => {
      showcase.dataset.market = key;
      document.querySelector("#configTitle").textContent = config.title;
      document.querySelector("#jobName").textContent = config.jobName;
      document.querySelector("#offerName").textContent = config.offerName;
      document.querySelector("#jobFields").innerHTML = fieldMarkup(config.job);
      document.querySelector("#offerFields").innerHTML = fieldMarkup(
        config.offer,
      );
      document.querySelector("#configBadge").textContent = config.badge;
      document.querySelector("#configBehavior").textContent = config.behavior;
      document
        .querySelectorAll("[data-config]")
        .forEach((button) =>
          button.classList.toggle("active", button.dataset.config === key),
        );
      document
        .querySelector("#configMascot")
        ?.dispatchEvent(
          new CustomEvent("pacta:play", { detail: { action: config.action } }),
        );
      requestAnimationFrame(() => showcase.classList.remove("switching"));
    },
    animate ? 160 : 0,
  );
}

function nextConfig() {
  if (!configSlide?.classList.contains("active") || document.hidden) return;
  const nextIndex = (keys.indexOf(activeKey) + 1) % keys.length;
  renderConfig(keys[nextIndex]);
}

function startCycle() {
  window.clearInterval(cycleTimer);
  cycleTimer = window.setInterval(nextConfig, 3600);
}

document.querySelectorAll("[data-config]").forEach((button) => {
  button.addEventListener("click", () => {
    renderConfig(button.dataset.config);
    startCycle();
  });
});

renderConfig("freight", false);
startCycle();
