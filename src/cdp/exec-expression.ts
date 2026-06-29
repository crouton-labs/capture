export function buildExecExpression(code: string, prebuilt?: string): string {
  if (prebuilt) return prebuilt;
  if (/\bawait\b/.test(code) || /\breturn\b/.test(code)) {
    return `(async () => { ${code} })()`;
  }
  return code;
}
