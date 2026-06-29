import * as ts from 'typescript';

function compiles(source: string): boolean {
  try {
    new Function(source);
    return true;
  } catch {
    return false;
  }
}

function wrapAsyncBody(code: string): string {
  return `(async () => { ${code} })()`;
}

function wrapFinalExpression(code: string, source: ts.SourceFile): string {
  const lastStatement = source.statements[source.statements.length - 1];
  if (!ts.isExpressionStatement(lastStatement)) {
    return wrapAsyncBody(code);
  }

  const expressionStart = lastStatement.expression.getStart(source);
  const expressionEnd = lastStatement.expression.end;
  return `(async () => { ${code.slice(0, lastStatement.getStart(source))}return (${code.slice(expressionStart, expressionEnd)}); })()`;
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

  const source = ts.createSourceFile('exec.js', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  if (
    source.statements.length > 0 &&
    !source.statements.some(ts.isReturnStatement) &&
    ts.isExpressionStatement(source.statements[source.statements.length - 1])
  ) {
    return wrapFinalExpression(code, source);
  }

  return wrapAsyncBody(code);
}
