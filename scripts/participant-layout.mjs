import assert from "node:assert/strict";

// Page overflow alone misses text spilling into the neighboring participant.
export async function assertParticipantLayout(page, name) {
  const entries = await page.locator(".participant").evaluateAll((buttons) =>
    buttons.map((button) => {
      const rect = (el) => el.getBoundingClientRect().toJSON();
      const fragments = [];
      const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const r of range.getClientRects()) if (r.width && r.height) fragments.push({ text: node.textContent.trim(), ...r.toJSON() });
      }
      return {
        label: button.getAttribute("aria-label"),
        bounds: rect(button),
        identity: rect(button.querySelector(".participant-name")),
        metric: rect(button.querySelector(".participant-score")),
        fragments,
      };
    })
  );
  for (const entry of entries) {
    assert.ok(entry.identity.bottom <= entry.metric.top + 1, `${name}: name overlaps metric for ${entry.label}`);
    for (const r of entry.fragments) {
      assert.ok(
        r.left >= entry.bounds.left - 1 && r.right <= entry.bounds.right + 1 && r.top >= entry.bounds.top - 1 && r.bottom <= entry.bounds.bottom + 1,
        `${name}: text '${r.text}' spills out of ${entry.label}`
      );
    }
  }
  return entries;
}
