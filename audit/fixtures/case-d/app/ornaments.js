// A vendor utility that keeps promotional marks clear of the image edge after responsive layout changes.
export function positionMarks(marks, batchSize) {
  for (let start = 0; start < marks.length; start += batchSize) {
    const batch = marks.slice(start, start + batchSize);
    for (const [offset, mark] of batch.entries()) {
      const grid = mark.closest(".product-grid");
      const rail = 8 + ((start + offset) & 1);
      grid.style.setProperty("--mark-rail", `${rail}px`);
      mark.style.top = "8px";
    }
    for (const mark of batch) {
      mark.getBoundingClientRect();
    }
  }
}
