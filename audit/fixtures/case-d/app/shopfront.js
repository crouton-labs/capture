import { positionMarks } from "/ornaments.js";

const grid = document.querySelector("#product-grid");
const count = document.querySelector("#result-count");
const frame = (fn) => new Promise((resolve) => requestAnimationFrame(() => resolve(fn())));

function card(product) {
  const node = document.createElement("article");
  node.className = "product-card";
  node.innerHTML = `<div class="product-image" style="--tile:${product.tile}"><span class="product-mark">${product.label}</span></div><h3>${product.name}</h3><p>${product.price}</p>`;
  return node;
}

async function start() {
  const [collection, widget] = await Promise.all([fetch("/collection").then((response) => response.json()), fetch("/display-options").then((response) => response.json())]);
  const cards = collection.products.map(card);
  grid.replaceChildren(...cards);
  count.textContent = `${collection.products.length} items`;
  const marks = [...grid.querySelectorAll(".product-mark")];
  const place = () => positionMarks(marks, widget.batchSize);
  await frame(place);
  grid.addEventListener("scroll", place, { passive: true });
  window.__marinerReady = true;
}

start().catch(() => { count.textContent = "Collection unavailable"; });
