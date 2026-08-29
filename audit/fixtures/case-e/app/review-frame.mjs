const container = document.querySelector("#reviews");

window.reviewPayloadReady = fetch("/review-feed", { cache: "no-store" })
  .then((response) => {
    if (!response.ok) throw new Error("Reviews are unavailable.");
    return response.json();
  })
  .then((payload) => {
    window.reviewPayload = payload;
    for (const item of payload.items) {
      const review = document.createElement("article");
      review.innerHTML = `<p class="stars" aria-label="${item.rating} out of 5 stars">★★★★★</p><strong>${item.author}</strong><p>${item.body.slice(0, 220)}</p>`;
      container.append(review);
    }
    return payload;
  });
