const subscriptions = new Map();

async function readChannel() {
  const response = await fetch("/widget-preferences", { cache: "no-store" });
  if (!response.ok) throw new Error("Review preferences are unavailable.");
  return response.json();
}

export async function attachReviewPanel(frame) {
  const channel = await readChannel();
  const documentRoot = frame.contentDocument;
  const reviews = frame.contentWindow.reviewPayload;
  const listener = (event) => {
    if (event.data?.channel !== channel.channel) return;
    documentRoot.documentElement.dataset.lastUpdate = String(reviews.items.length);
  };
  subscriptions.set(channel.channel, listener);
  window.addEventListener("message", listener);

  return {
    async destroy() {
      const channel = await readChannel();
      const listener = subscriptions.get(channel.channel);
      if (!listener) return;
      window.removeEventListener("message", listener);
      subscriptions.delete(channel.channel);
    },
  };
}
