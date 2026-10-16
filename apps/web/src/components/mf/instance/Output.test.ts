import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import type { InstanceOutputFrameDto } from '@libs/dto';
import { InstanceOutputEndReason } from '@libs/dto';

import { IInstanceOutput, OUTPUT_LINE_CAP, applyOutputFrame, emptyInstanceOutput } from '@/utils/instanceOutput';

import Output from './Output.vue';

const OPENED: InstanceOutputFrameDto = { kind: 'opened', tailLines: 1000, complete: false };

const outputOf = (...frames: InstanceOutputFrameDto[]): IInstanceOutput =>
  frames.reduce(applyOutputFrame, emptyInstanceOutput());

const linesFrame = (texts: string[]): InstanceOutputFrameDto => ({
  kind: 'lines',
  lines: texts.map(text => ({ date: null, text, cut: false })),
});

const mountOutput = (output: IInstanceOutput, connected = true, waiting = false) =>
  mount(Output, { props: { output, connected, waiting } });

/** jsdom lays nothing out, so the pane's heights are stubbed. */
const layOut = (pane: HTMLElement, scrollHeight: number) => {
  Object.defineProperty(pane, 'clientHeight', { configurable: true, value: 100 });
  Object.defineProperty(pane, 'scrollHeight', { configurable: true, value: scrollHeight });
};

describe('MfInstanceOutput', () => {
  it('reads as live while the stream is up, and as ended once the output has', () => {
    expect(mountOutput(outputOf(OPENED)).get('[data-testid="output-status"]').text()).toBe('Live');
    expect(mountOutput(outputOf(OPENED), false).get('[data-testid="output-status"]').text()).toBe('Reconnecting');
    expect(mountOutput(emptyInstanceOutput(), false).get('[data-testid="output-status"]').text()).toBe('Connecting');

    const ended = mountOutput(outputOf(OPENED, { kind: 'ended', reason: InstanceOutputEndReason.EXITED }), false);

    expect(ended.get('[data-testid="output-status"]').text()).toBe('Ended');
    expect(ended.find('[data-testid="output-ended"]').exists()).toBe(true);
    expect(ended.find('[data-testid="output-lost"]').exists()).toBe(false);
  });

  it('tells a lost node connection from an exit, offering to reconnect', async () => {
    const lost = mountOutput(outputOf(OPENED, { kind: 'ended', reason: InstanceOutputEndReason.LOST }), false);

    expect(lost.get('[data-testid="output-status"]').text()).toBe('Lost');
    expect(lost.find('[data-testid="output-ended"]').exists()).toBe(false);

    await lost.get('[data-testid="output-lost"] button').trigger('click');

    expect(lost.emitted('reconnect')).toHaveLength(1);
  });

  it('reads as waiting while the node has no container yet', () => {
    const waiting = mountOutput(emptyInstanceOutput(), false, true);

    expect(waiting.get('[data-testid="output-status"]').text()).toBe('Waiting');
    expect(waiting.get('[data-testid="output-span"]').text()).toBe('Waiting for the container');
    expect(waiting.find('[data-testid="output-waiting"]').exists()).toBe(true);
  });

  it('heads the pane with how far back it reaches', () => {
    expect(mountOutput(emptyInstanceOutput()).get('[data-testid="output-span"]').text()).toBe(
      'Reading the latest lines'
    );
    expect(mountOutput(outputOf(OPENED)).get('[data-testid="output-span"]').text()).toBe('Last 1,000 lines');
  });

  it('shows each line with its time and a cut marker', () => {
    const output = outputOf(OPENED, {
      kind: 'lines',
      lines: [
        { date: new Date(2026, 9, 15, 14, 2, 11).toISOString(), text: 'main: build = 5123', cut: false },
        { date: null, text: 'x'.repeat(10), cut: true },
      ],
    });
    const wrapper = mountOutput(output);

    const lines = wrapper.findAll('[data-testid="output-line"]');

    expect(lines[0].text()).toContain('14:02:11');
    expect(lines[0].text()).toContain('main: build = 5123');
    expect(lines[1].find('[data-testid="output-cut"]').exists()).toBe(true);
  });

  it('shows a coloured line in the theme colours, without its escape sequences', () => {
    const wrapper = mountOutput(
      outputOf(OPENED, linesFrame(['\u001b[0;36m(EngineCore pid=220)\u001b[0;0m \u001b[1;32mINFO\u001b[0m loaded']))
    );

    const line = wrapper.get('[data-testid="output-line"]');
    const parts = line.findAll('.whitespace-pre-wrap > span');

    expect(line.text()).not.toContain('\u001b');
    expect(parts.map(part => part.element.textContent)).toEqual(['(EngineCore pid=220)', ' ', 'INFO', ' loaded']);
    expect(parts[0].classes()).toEqual(['text-accent']);
    expect(parts[2].classes()).toEqual(['text-success', 'font-semibold']);
    expect(parts[3].classes()).toEqual([]);
  });

  it('notes once the cap has dropped the oldest lines', () => {
    const texts = Array.from({ length: OUTPUT_LINE_CAP + 1 }, (_, index) => `line ${index}`);

    expect(mountOutput(outputOf(OPENED)).find('[data-testid="output-dropped"]').exists()).toBe(false);
    expect(
      mountOutput(outputOf(OPENED, linesFrame(texts)))
        .get('[data-testid="output-dropped"]')
        .text()
    ).toContain('5,000');
  });

  it('follows new lines while at the bottom, and offers to jump back with a count once scrolled up', async () => {
    const wrapper = mountOutput(outputOf(OPENED, linesFrame(['one'])));
    const pane = wrapper.get<HTMLElement>('[data-testid="output-pane"]').element;

    layOut(pane, 500);
    await wrapper.setProps({ output: outputOf(OPENED, linesFrame(['one', 'two'])) });

    expect(pane.scrollTop).toBe(500);
    expect(wrapper.find('[data-testid="output-jump"]').exists()).toBe(false);

    pane.scrollTop = 200;
    await wrapper.get('[data-testid="output-pane"]').trigger('scroll');

    expect(wrapper.get('[data-testid="output-jump"]').text()).toBe('Jump to latest');

    layOut(pane, 600);
    await wrapper.setProps({ output: outputOf(OPENED, linesFrame(['one', 'two']), linesFrame(['three', 'four'])) });

    const jump = wrapper.get('[data-testid="output-jump"]');

    expect(pane.scrollTop).toBe(200);
    expect(jump.element.tagName).toBe('BUTTON');
    expect(jump.text()).toBe('Jump to latest · 2 new');

    await jump.trigger('click');

    expect(pane.scrollTop).toBe(600);
    expect(wrapper.find('[data-testid="output-jump"]').exists()).toBe(false);
  });

  it('drops the jump control once scrolled back to the bottom by hand', async () => {
    const wrapper = mountOutput(outputOf(OPENED, linesFrame(['one'])));
    const pane = wrapper.get<HTMLElement>('[data-testid="output-pane"]').element;

    layOut(pane, 500);
    pane.scrollTop = 200;
    await wrapper.get('[data-testid="output-pane"]').trigger('scroll');

    expect(wrapper.find('[data-testid="output-jump"]').exists()).toBe(true);

    pane.scrollTop = 400;
    await wrapper.get('[data-testid="output-pane"]').trigger('scroll');

    expect(wrapper.find('[data-testid="output-jump"]').exists()).toBe(false);
  });
});
