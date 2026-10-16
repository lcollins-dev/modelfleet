import { VNodeChild, h } from 'vue';

/** Renders `**bold**`, `*italic*` and `` `code` `` as elements, and every other character as text. */
export const renderInlineMarkdown = (text: string): VNodeChild[] => {
  const token = /`[^`]+`|\*\*[\s\S]+?\*\*|\*[^*]+\*/g;
  const rendered: VNodeChild[] = [];

  let cursor = 0;
  let match = token.exec(text);

  while (match !== null) {
    if (match.index > cursor) {
      rendered.push(text.slice(cursor, match.index));
    }

    const [matched] = match;

    if (matched.startsWith('`')) {
      rendered.push(h('code', { class: 'rounded-xs bg-emphasis px-1 font-mono' }, matched.slice(1, -1)));
    } else if (matched.startsWith('**')) {
      rendered.push(h('strong', { class: 'font-medium' }, renderInlineMarkdown(matched.slice(2, -2))));
    } else {
      rendered.push(h('em', {}, renderInlineMarkdown(matched.slice(1, -1))));
    }

    cursor = match.index + matched.length;
    match = token.exec(text);
  }

  if (cursor < text.length) {
    rendered.push(text.slice(cursor));
  }

  return rendered;
};
