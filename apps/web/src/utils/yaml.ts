import { Document, isMap, parse, parseDocument } from 'yaml';

import type { ConfigurationDocument, ConfigurationValue, IConfigurationObject } from '@libs/dto';

/** A key mapped to `undefined` is removed from the document. */
export type DocumentEdits = Record<string, ConfigurationValue | undefined>;

/** Rewrites the authored YAML, so comments, key order and every key `edits` does not name survive. */
export const applyToDocument = (document: string, edits: DocumentEdits): string => {
  const parsed: Document = parseDocument(document);

  if (!isMap(parsed.contents)) {
    parsed.contents = parsed.createNode({});
  }

  for (const [key, value] of Object.entries(edits)) {
    if (value === undefined) {
      parsed.delete(key);
    } else {
      parsed.set(key, value);
    }
  }

  return String(parsed);
};

/** `null` where the text is not a mapping. */
export const readDocument = (document: string): ConfigurationDocument | null => {
  let parsed: unknown;

  try {
    parsed = parse(document);
  } catch {
    return null;
  }

  if (parsed === null || parsed === undefined) {
    return {};
  }

  return isRecord(parsed) ? readRecord(parsed) : null;
};

const isList = (value: unknown): value is unknown[] => Array.isArray(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !isList(value);

const readRecord = (value: Record<string, unknown>): IConfigurationObject => {
  const document: IConfigurationObject = {};

  for (const [key, entry] of Object.entries(value)) {
    document[key] = readValue(entry);
  }

  return document;
};

/** Anything YAML produces that a configuration value cannot hold reads as null. */
const readValue = (value: unknown): ConfigurationValue => {
  if (isList(value)) {
    return value.map(readValue);
  }

  if (isRecord(value)) {
    return readRecord(value);
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  return null;
};
