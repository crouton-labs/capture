(() => {
  "use strict";

  const root = document.documentElement;
  const one = (selector) => document.querySelector(selector);
  const field = (name) => document.querySelector(`[data-field="${name}"]`);
  const propertyName = (token) => `--${token.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;

  const dayFormat = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" });
  const day = (iso) => dayFormat.format(new Date(`${iso}T12:00:00`));

  async function readJson(path, init = {}) {
    const response = await fetch(path, { ...init, headers: { Accept: "application/json", ...init.headers } });
    if (!response.ok) throw new Error(`${path} responded ${response.status}`);
    return response.json();
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function applyTheme({ tokens, densityScale }) {
    for (const [token, value] of Object.entries(tokens)) root.style.setProperty(propertyName(token), value);
    root.style.setProperty("--density", String(densityScale));
  }

  function renderPassOptions({ season, onSaleFrom, onSaleTo, intro, note, tiers }) {
    field("sale-window").textContent = `${season} passes are on sale from ${day(onSaleFrom)} through ${day(onSaleTo)}.`;
    field("pass-intro").textContent = intro;
    field("pass-note").textContent = note;
    one("#request-tier").append(...tiers.map((tier) => new Option(tier.name, tier.id)));
  }

  function renderHours({ periods, staffed }) {
    const rows = periods.flatMap((period) => [
      element("dt", null, period.label),
      element("dd", "fineprint", period.hours),
    ]);
    field("hours-periods").replaceChildren(...rows);
    field("staffed-hours").textContent = staffed;
  }

  function bindRequestForm() {
    const form = one("[data-request-form]");
    const status = one("[data-request-status]");
    const submit = form.querySelector("button[type=submit]");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      submit.disabled = true;
      status.textContent = "Sending your request\u2026";
      try {
        const body = JSON.stringify(Object.fromEntries(new FormData(form).entries()));
        const { reference } = await readJson("/api/requests", { method: "POST", headers: { "Content-Type": "application/json" }, body });
        form.reset();
        status.textContent = `Request received. Your reference number is ${reference}. The desk will email you when the cards are ready.`;
      } finally {
        submit.disabled = false;
      }
    });
  }

  async function start() {
    applyTheme(await readJson("/api/palette"));
    renderPassOptions(await readJson("/api/pass-tiers"));
    renderHours(await readJson("/api/hours"));
    bindRequestForm();
  }

  start();
})();
