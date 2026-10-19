import { Fragment, type ReactNode } from 'react';

/**
 * Fills `{name}` slots with React nodes, so a translated sentence can carry a
 * bold product name or a badge without being split into fragments per locale.
 * Empty slots collapse the whitespace around them.
 */
export function fillTemplate(template: string, vars: Record<string, ReactNode>): ReactNode {
  const parts = template.split(/(\{\w+\})/g);
  const out: ReactNode[] = [];
  parts.forEach((part, i) => {
    const m = part.match(/^\{(\w+)\}$/);
    if (m) {
      const v = vars[m[1]];
      if (v !== '' && v != null && v !== false) out.push(<Fragment key={i}>{v}</Fragment>);
      return;
    }
    const text = part.replace(/\s+/g, ' ');
    if (text) out.push(text);
  });
  // Joining "Someone " + "" + " opened" leaves a double space; normalise.
  return out.map((n, i) =>
    typeof n === 'string'
      ? n.replace(/^\s+/, i === 0 ? '' : ' ').replace(/\s+$/, i === out.length - 1 ? '' : ' ')
      : n,
  );
}
