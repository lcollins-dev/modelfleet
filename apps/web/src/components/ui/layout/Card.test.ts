import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import Card from './Card.vue';

const bodyOf = (props: Record<string, unknown>) =>
  mount(Card, { props, slots: { default: '<div data-testid="first" /><div />' } }).get('[data-testid="first"]').element
    .parentElement!;

describe('UiCard', () => {
  it('pads its body on every side by default', () => {
    expect(bodyOf({}).className).toBe('flex-auto px-6 py-5');
  });

  it('runs a flush body to the edges', () => {
    expect(bodyOf({ flush: true }).className).toBe('flex-auto');
  });

  it('grows its body to fill a stretched card, keeping the footer at the bottom', () => {
    const card = mount(Card, {
      props: { title: 'Nodes' },
      slots: { default: '<div data-testid="first" />', footer: '<div data-testid="footer" />' },
    });

    const body = card.get('[data-testid="first"]').element.parentElement!;
    const footer = card.get('[data-testid="footer"]').element.parentElement!;

    expect(card.classes()).toEqual(expect.arrayContaining(['flex', 'flex-col']));
    expect(body.classList).toContain('flex-auto');
    expect(footer.classList).not.toContain('flex-auto');
    expect(body.nextElementSibling).toBe(footer);
  });

  it('pads a rows body at the sides only, with a divider between rows', () => {
    const className = bodyOf({ rows: true }).className;

    expect(className).toContain('px-6');
    expect(className).not.toContain('py-5');
    expect(className).toContain('[&>*+*]:border-t');
  });
});
