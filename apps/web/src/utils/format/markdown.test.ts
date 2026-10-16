import { describe, expect, it } from 'vitest';
import { createApp, h } from 'vue';

import { renderInlineMarkdown } from './markdown';

const renderToHtml = (text: string): string => {
  const host = document.createElement('div');
  const app = createApp({ render: () => h('span', {}, renderInlineMarkdown(text)) });

  app.mount(host);

  const html = host.firstElementChild?.innerHTML ?? '';
  app.unmount();

  return html;
};

describe('renderInlineMarkdown', () => {
  it('renders text carrying no markup as it is written', () => {
    expect(renderToHtml('Node rig-01 connected')).toBe('Node rig-01 connected');
  });

  it('renders bold, italic and code as elements', () => {
    expect(renderToHtml('**rig-01**')).toContain('<strong');
    expect(renderToHtml('*maybe*')).toContain('<em>maybe</em>');
    expect(renderToHtml('`192.0.2.1`')).toContain('<code');
  });

  it('keeps the text around a marker', () => {
    expect(renderToHtml('Registered node **rig-01** today')).toBe(
      'Registered node <strong class="font-medium">rig-01</strong> today'
    );
  });

  it('renders a marker nested inside another', () => {
    expect(renderToHtml('**node `rig-01`**')).toContain('<code');
  });

  it('reads a marker with no partner as text', () => {
    expect(renderToHtml('Grew by 50% * the usual')).toBe('Grew by 50% * the usual');
    expect(renderToHtml('An unclosed `span')).toBe('An unclosed `span');
  });

  it('escapes markup rather than letting it reach the DOM', () => {
    const html = renderToHtml('Sign-in refused for `<img src=x onerror=alert(1)>`');

    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<img');
  });

  it('renders an empty message as nothing', () => {
    expect(renderToHtml('')).toBe('');
  });
});
