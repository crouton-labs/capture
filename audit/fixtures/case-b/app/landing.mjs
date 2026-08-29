const hero = document.querySelector("[data-hero]");

async function fillHero() {
  const response = await fetch("/profile", { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("We could not finish setting up this page.");
  const { image: source } = await response.json();
  const image = new Image();
  image.alt = "Friends gathering outside on a clear afternoon";
  image.decoding = "async";
  image.width = 1600;
  image.height = 900;
  image.src = source;
  hero.replaceChildren(image);
}

fillHero().catch(() => { hero.setAttribute("aria-live", "off"); });
