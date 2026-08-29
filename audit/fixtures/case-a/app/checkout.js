(() => {
  "use strict";

  const FREE_SHIPPING_THRESHOLD = 75;
  const SUMMARY_LINES = [
    ["subtotal", "summary-subtotal"],
    ["shipping", "summary-shipping"],
    ["tax", "summary-tax"],
    ["total", "summary-total"],
  ];
  const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
  const cents = (value) => Math.round(value * 100) / 100;
  const el = (id) => document.getElementById(id);

  const summary = el("summary");
  const badge = el("free-shipping-badge");
  const postalCode = el("postal-code");
  const recalculate = el("recalculate");
  const status = el("status");
  const note = el("summary-note");

  function readCart() {
    return Array.from(document.querySelectorAll("#cart-lines .line"), (line) => ({
      sku: line.dataset.sku,
      quantity: Number(line.dataset.quantity),
      unitPrice: Number(line.dataset.unitPrice),
    }));
  }

  const subtotalOf = (lines) => cents(lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0));
  const unitsOf = (lines) => lines.reduce((sum, line) => sum + line.quantity, 0);

  function setAmount(target, value) {
    const amount = Number(value);
    if (Number.isFinite(amount)) {
      target.textContent = money.format(amount);
      target.dataset.amount = amount.toFixed(2);
    } else {
      target.textContent = "\u2014";
      delete target.dataset.amount;
    }
  }

  function renderBadge(subtotal) {
    const eligible = subtotal >= FREE_SHIPPING_THRESHOLD;
    badge.dataset.eligible = String(eligible);
    badge.textContent = eligible
      ? "Free shipping applied"
      : `Add ${money.format(cents(FREE_SHIPPING_THRESHOLD - subtotal))} for free shipping`;
  }

  async function requestFragment(path, params) {
    const url = new URL(path, window.location.origin);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`${path} responded ${response.status}`);
    return response.json();
  }

  function combineTotals(base, fragments) {
    const combined = { ...base };
    for (const fragment of fragments) {
      if (fragment && typeof fragment === "object") Object.assign(combined, fragment);
    }
    return combined;
  }

  function deliveryNote(totals) {
    const parts = [totals.carrier, totals.serviceLevel].filter((part) => typeof part === "string" && part.length > 0);
    const days = Number(totals.estimatedDays);
    if (Number.isFinite(days)) parts.push(`${days} business day${days === 1 ? "" : "s"}`);
    return parts.join(" \u00b7 ");
  }

  function renderSummary(totals) {
    const parts = ["subtotal", "shipping", "tax"].map((key) => Number(totals[key]));
    const complete = parts.every(Number.isFinite);
    const amounts = { ...totals, total: complete ? cents(parts.reduce((sum, part) => sum + part, 0)) : undefined };
    for (const [key, id] of SUMMARY_LINES) setAmount(el(id), amounts[key]);
    note.textContent = deliveryNote(totals);
    summary.dataset.state = complete ? "ready" : "incomplete";
    status.textContent = complete ? "Totals updated." : "Some totals are still unavailable.";
  }

  function setBusy(busy) {
    recalculate.disabled = busy;
    summary.setAttribute("aria-busy", String(busy));
    if (busy) {
      summary.dataset.state = "busy";
      status.textContent = "Recalculating\u2026";
    }
  }

  async function runRecalculation() {
    const lines = readCart();
    const subtotal = subtotalOf(lines);
    const params = {
      postalCode: postalCode.value.trim(),
      subtotal: subtotal.toFixed(2),
      units: String(unitsOf(lines)),
    };
    setBusy(true);
    try {
      const fragments = await Promise.all([
        requestFragment("/api/shipping-quote", params),
        requestFragment("/api/tax-estimate", params),
      ]);
      renderSummary(combineTotals({ subtotal }, fragments));
    } catch {
      summary.dataset.state = "error";
      status.textContent = "We couldn't update your totals. The amounts below are unchanged.";
    } finally {
      setBusy(false);
    }
  }

  function renderInitialState() {
    const subtotal = subtotalOf(readCart());
    renderBadge(subtotal);
    setAmount(el("summary-subtotal"), subtotal);
    setAmount(el("summary-shipping"), subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : undefined);
    setAmount(el("summary-tax"), undefined);
    setAmount(el("summary-total"), undefined);
    note.textContent = "";
    summary.dataset.state = "pending";
    status.textContent = "Recalculate to update delivery and tax for this ZIP code.";
  }

  recalculate.addEventListener("click", runRecalculation);
  el("continue").addEventListener("click", () => {
    status.textContent = "Payment is unavailable in this order preview.";
  });
  renderInitialState();
})();
