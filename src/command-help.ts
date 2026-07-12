/** Pure help assembly from Capture's one descriptor tree. */
import { type RegistryNode } from './registry.js';

const usage = (node: RegistryNode): string => `capture${node.path ? ` ${node.path}` : ''}`;

/** Renders descriptor-owned help without parsing leaf inputs or performing effects. */
export function assembleHelp(node: RegistryNode): string {
  const lines = [usage(node), '', node.help.description, '', `When to use: ${node.help.whenToUse}`, `Model: ${node.help.rubric}`];
  if (node.kind === 'branch') {
    const children = node.children.filter((child) => child.visibility === 'public');
    if (children.length) {
      lines.push('', 'Commands:');
      for (const child of children) lines.push(`  ${child.path.split(' ').at(-1)}  ${child.help.description} When to use: ${child.help.whenToUse}`);
    }
  } else {
    if (node.positionals.length || node.flags.length) {
      lines.push('', 'Parameters:');
      for (const positional of node.positionals) lines.push(`  ${positional.required ? '<' : '['}${positional.name}${positional.required ? '>' : ']'}  ${positional.grammar}${positional.variadic ? ' (variadic)' : ''}`);
      for (const flag of node.flags) lines.push(`  ${flag.name}${flag.grammar === 'boolean' ? '' : ` <${flag.grammar}>`}`);
    }
    lines.push('', `Output: ${node.help.rubric}`, `Effects: browser=${node.effects.browser}, session=${node.effects.session}, artifact=${node.effects.artifact}, environment=${node.effects.environment}`, `Recovery: ${node.recovery}`);
  }
  lines.push('', `Next action: ${node.help.followUp}`);
  return `${lines.join('\n')}\n`;
}
