import { describe, expect, it } from 'vitest';

import { buildDeclaration } from '../test/declaration.factory';
import { ConfigurationIssueReason, validateConfiguration } from './validation';

const declaration = buildDeclaration();

describe('validateConfiguration', () => {
  it('accepts a document setting every field', () => {
    const result = validateConfiguration(declaration, {
      contextSize: 8192,
      ropeScale: 1.5,
      mlock: true,
      chatTemplate: 'chatml',
      splitMode: 'row',
      tensorSplit: [0.6, 0.4],
      extraFlags: ['--no-warmup'],
    });

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.unmodelledFields).toEqual([]);
  });

  it('reports the field and the reason for a wrong type', () => {
    const result = validateConfiguration(declaration, { mlock: 'yes' });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual([
      { field: 'mlock', reason: ConfigurationIssueReason.WRONG_TYPE, message: 'mlock must be true or false' },
    ]);
  });

  it('reports every failing field rather than stopping at the first', () => {
    const result = validateConfiguration(declaration, { contextSize: 'big', mlock: 4, chatTemplate: [] });

    expect(result.issues.map(issue => issue.field)).toEqual(['contextSize', 'mlock', 'chatTemplate']);
  });

  it('rejects a fractional value for an integer field', () => {
    const result = validateConfiguration(declaration, { contextSize: 4096.5 });

    expect(result.issues).toEqual([
      {
        field: 'contextSize',
        reason: ConfigurationIssueReason.NOT_AN_INTEGER,
        message: 'contextSize must be a whole number',
      },
    ]);
  });

  it('accepts a fractional value for a number field', () => {
    expect(validateConfiguration(declaration, { ropeScale: 1.25 }).valid).toBe(true);
  });

  it("rejects a value outside a field's bounds", () => {
    const below = validateConfiguration(declaration, { contextSize: 0 });
    const above = validateConfiguration(declaration, { contextSize: 262144 });

    expect(below.issues[0]).toEqual({
      field: 'contextSize',
      reason: ConfigurationIssueReason.BELOW_MINIMUM,
      message: 'contextSize must be at least 1',
    });
    expect(above.issues[0]).toEqual({
      field: 'contextSize',
      reason: ConfigurationIssueReason.ABOVE_MAXIMUM,
      message: 'contextSize must be at most 131072',
    });
  });

  it('rejects a value a choice field does not offer, naming the choices', () => {
    const result = validateConfiguration(declaration, { splitMode: 'diagonal' });

    expect(result.issues).toEqual([
      {
        field: 'splitMode',
        reason: ConfigurationIssueReason.NOT_A_CHOICE,
        message: 'splitMode must be one of none, layer, row',
      },
    ]);
  });

  it('rejects a list entry of the wrong type, naming its position', () => {
    const result = validateConfiguration(declaration, { tensorSplit: [0.5, 'half'] });

    expect(result.issues).toEqual([
      { field: 'tensorSplit', reason: ConfigurationIssueReason.WRONG_TYPE, message: 'tensorSplit[1] must be a number' },
    ]);
  });

  it('bounds each entry of a number list rather than its length', () => {
    const result = validateConfiguration(declaration, { tensorSplit: [0.5, -1] });

    expect(result.issues).toEqual([
      {
        field: 'tensorSplit',
        reason: ConfigurationIssueReason.BELOW_MINIMUM,
        message: 'tensorSplit[1] must be at least 0',
      },
    ]);
  });

  it('rejects a list where a field takes a single value', () => {
    const result = validateConfiguration(declaration, { tensorSplit: 0.5 });

    expect(result.issues[0]?.reason).toBe(ConfigurationIssueReason.WRONG_TYPE);
  });

  it('carries extra flags through without judging what they say', () => {
    const result = validateConfiguration(declaration, {
      extraFlags: ['--no-warmup', '--invented-flag', '-ctv', 'q4_0'],
    });

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('rejects extra flags that are not a list of text', () => {
    const result = validateConfiguration(declaration, { extraFlags: '--no-warmup' });

    expect(result.issues).toEqual([
      {
        field: 'extraFlags',
        reason: ConfigurationIssueReason.WRONG_TYPE,
        message: 'extraFlags must be a list of text entries',
      },
    ]);
  });

  it('validates a document holding keys the declaration does not model, and lists them', () => {
    const result = validateConfiguration(declaration, { contextSize: 8192, draftModel: 'qwen', cacheReuse: 256 });

    expect(result.valid).toBe(true);
    expect(result.unmodelledFields).toEqual(['draftModel', 'cacheReuse']);
  });
});
