/** Pure specification-help assembly from Capture's descriptor tree. */
import { type RegistryNode } from './registry.js';

const usage = (node: RegistryNode): string => `capture${node.path ? ` ${node.path}` : ''}`;
const parameter = (name: string, grammar: string, required: boolean, variadic = false): string => `  ${required ? '<' : '['}${name}${required ? '>' : ']'}  ${grammar}${variadic ? ' (variadic)' : ''}`;

/** Renders only descriptor-owned content; help never parses inputs or performs effects. */
export function assembleHelp(node: RegistryNode): string {
  const { help } = node;
  const lines = [usage(node), '', help.description, '', `When to use: ${help.whenToUse}`, `Model: ${help.model ?? help.rubric}`];
  if (help.globals) lines.push('', 'Globals:', help.globals);
  if (help.ioContract) lines.push('', `I/O contract: ${help.ioContract}`);
  if (node.kind === 'branch') {
    const children = node.children.filter((child) => child.visibility === 'public');
    if (children.length) {
      lines.push('', 'Commands:');
      for (const child of children) lines.push(`  ${child.path.split(' ').at(-1)}  ${child.help.description} When to use: ${child.help.whenToUse}`);
    }
  } else {
    if (node.positionals.length || node.flags.length) {
      lines.push('', 'Parameters:');
      for (const positional of node.positionals) lines.push(parameter(positional.name, positional.grammar, positional.required, positional.variadic));
      for (const flag of node.flags) lines.push(`  ${flag.name}${flag.grammar === 'boolean' ? '' : ` <${flag.grammar}>`}${flag.required ? ' required' : ''}${flag.repeatable ? ' repeatable' : ''}${flag.default === undefined ? '' : ` default=${flag.default}`}${flag.values ? ` values=${flag.values.join('|')}` : ''}${flag.units ? ` units=${flag.units}` : ''}`);
    }
    lines.push('', `Constraints: ${help.constraints}`, `Output: ${help.orderedOutput}`, `Artifact ownership: ${help.artifactOwnership}`, `Effects: browser=${node.effects.browser}, session=${node.effects.session}, artifact=${node.effects.artifact}, environment=${node.effects.environment}`, `Recovery: ${node.recovery}`);
  }
  lines.push('', `Next action: ${help.followUp}`);
  return `${lines.join('\n')}\n`;
}
