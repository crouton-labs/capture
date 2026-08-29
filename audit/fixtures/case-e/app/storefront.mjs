import { attachReviewPanel } from "/partner-panel.mjs";

const root = document.querySelector("#modal-root");
const trigger = document.querySelector("#quick-view");
let activePanel;

function closePanel(shell) {
  return async () => {
    if (activePanel) await activePanel.destroy();
    activePanel = undefined;
    shell.remove();
    trigger.focus();
  };
}

trigger.addEventListener("click", () => {
  const shell = document.createElement("section");
  shell.className = "quick-view";
  shell.setAttribute("role", "dialog");
  shell.setAttribute("aria-modal", "true");
  shell.setAttribute("aria-labelledby", "quick-view-title");
  shell.innerHTML = '<div class="quick-view__card"><div class="quick-view__top"><h2 id="quick-view-title">Orbit insulated bottle</h2><button id="close-view" type="button" disabled>Close</button></div><iframe title="Customer reviews" src="/review-frame.html"></iframe></div>';
  root.append(shell);

  const frame = shell.querySelector("iframe");
  const closer = shell.querySelector("#close-view");
  frame.addEventListener("load", async () => {
    await frame.contentWindow.reviewPayloadReady;
    activePanel = await attachReviewPanel(frame);
    closer.disabled = false;
  }, { once: true });
  closer.addEventListener("click", closePanel(shell));
});
