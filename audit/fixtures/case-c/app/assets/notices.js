(() => {
  "use strict";

  const dayFormat = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric" });
  const day = (iso) => dayFormat.format(new Date(`${iso}T12:00:00`));

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function renderPolicies(mount, notices) {
    const policies = element("div", "policies");
    for (const policy of notices.policies) {
      const item = element("div", "policy");
      item.dataset.policy = policy.id;
      item.append(element("h3", "policy__heading", policy.heading), element("p", "fineprint", policy.body));
      policies.append(item);
    }
    mount.replaceChildren(policies);
  }

  function renderHoursChange(mount, notices) {
    const { headline, body, effective } = notices.hoursChange;
    const notice = element("div", "notice");
    notice.append(
      element("p", "notice__headline", headline),
      element("p", "fineprint", `${body} Effective ${day(effective)}.`),
    );
    mount.replaceChildren(notice);
  }

  function renderClosures(mount, notices) {
    const { headline, body, window: closureWindow } = notices.closures;
    const span = `${day(closureWindow.from)} through ${day(closureWindow.to)}`;
    const notice = element("div", "notice");
    notice.append(
      element("p", "notice__headline", headline),
      element("p", "fineprint", `${body} The pool is closed ${span}.`),
    );
    mount.replaceChildren(notice);
  }

  const SLOTS = [
    { name: "rules", render: renderPolicies },
    { name: "hours", render: renderHoursChange },
    { name: "closures", render: renderClosures },
  ];

  async function start() {
    const response = await fetch("/api/notices", { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`/api/notices responded ${response.status}`);
    const notices = await response.json();
    for (const slot of SLOTS) {
      const mount = document.querySelector(`[data-slot="${slot.name}"]`);
      if (!mount) continue;
      try {
        slot.render(mount, notices);
      } catch (error) {
        console.error(`The ${slot.name} notice was left off this page.`, error);
        mount.replaceChildren();
      }
    }
  }

  start();
})();
