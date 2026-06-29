function compiles(source: string): boolean {
  try {
    new Function(source);
    return true;
  } catch {
    return false;
  }
}

export function buildExecExpression(code: string, prebuilt?: string): string {
  if (prebuilt) return prebuilt;

  if (compiles(`return (${code});`)) {
    return code;
  }

  const expression = `return (async () => (${code}))();`;
  if (compiles(expression)) {
    return `(async () => (${code}))()`;
  }

  return `(async () => { ${code} })()`;
}
