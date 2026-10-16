import { describe, expect, it } from 'vitest';

import { METER_TONE_CLASSES, MeterTone, PROCESS_METER_TONES } from './meterTone';

const RESERVED: MeterTone[] = ['primary', 'success', 'warning', 'error', 'muted', 'strong', 'pending'];

describe('meterTone', () => {
  it('takes every tone from a colour token, never a literal colour', () => {
    for (const classes of Object.values(METER_TONE_CLASSES)) {
      expect(classes).not.toMatch(/#[0-9a-f]{3,8}\b|rgb|hsl/i);
    }
  });

  it('cycles processes through distinct tones, so neighbours differ even once it wraps', () => {
    expect(PROCESS_METER_TONES.length).toBeGreaterThanOrEqual(6);
    expect(new Set(PROCESS_METER_TONES).size).toBe(PROCESS_METER_TONES.length);
    expect(new Set(PROCESS_METER_TONES.map(tone => METER_TONE_CLASSES[tone])).size).toBe(PROCESS_METER_TONES.length);
  });

  it('keeps the process palette apart from the status and structural tones', () => {
    const reserved = new Set(RESERVED.map(tone => METER_TONE_CLASSES[tone]));

    expect(PROCESS_METER_TONES.some(tone => reserved.has(METER_TONE_CLASSES[tone]))).toBe(false);
  });
});
