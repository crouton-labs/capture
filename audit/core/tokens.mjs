// Deterministic stdout/stderr volume estimator for audit route budgets.
// Not a real tokenizer: one estimated token per 4 UTF-8 bytes. Route budgets are
// relative ratios against a reference route measured with this same function, so
// the estimator only has to be stable and monotonic in output size.
export function estimateTokens(input) {
  const bytes =
    typeof input === "number"
      ? input
      : Buffer.byteLength(typeof input === "string" ? input : String(input), "utf8");
  return Math.ceil(bytes / 4);
}
