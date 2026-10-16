import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { GPU_SNAPSHOT_SCHEMA_VERSION, gpuSnapshotSchema } from '@/telemetry/device-reader/gpu-snapshot';

interface IField {
  type: string;
  required: boolean;
  enum?: string[];
}

interface IContract {
  version: number;
  fields: Record<string, IField>;
}

/** The parts of a JSON Schema node this file reads. */
interface ISchemaNode {
  type?: string;
  const?: unknown;
  enum?: string[];
  properties?: Record<string, ISchemaNode>;
  required?: string[];
  items?: ISchemaNode;
}

/**
 * `crates/mf-gpu/src/snapshot.rs` asserts against the same file from the other side. Vitest roots
 * this suite at `apps/agent`, which is what the path is relative to.
 */
const contract = JSON.parse(
  readFileSync(resolve(process.cwd(), '../../crates/mf-gpu/snapshot.contract.json'), 'utf8')
) as IContract;

/** A literal integer reaches the schema as a `number` with a `const`, where the crate has an integer. */
function typeOf(node: ISchemaNode): string {
  if (Number.isInteger(node.const)) {
    return 'integer';
  }

  if (node.type === undefined) {
    throw new Error('a field with no type');
  }

  return node.type;
}

function fieldOf(node: ISchemaNode, required: boolean): IField {
  const field: IField = { type: typeOf(node), required };

  return node.enum === undefined ? field : { ...field, enum: node.enum };
}

function walk(node: ISchemaNode, path: string, fields: Record<string, IField>): void {
  if (typeOf(node) === 'object') {
    const required = node.required ?? [];

    Object.entries(node.properties ?? {}).forEach(([key, child]) => {
      const childPath = path === '' ? key : `${path}.${key}`;

      fields[childPath] = fieldOf(child, required.includes(key));
      walk(child, childPath, fields);
    });
  }

  if (typeOf(node) === 'array' && node.items !== undefined) {
    const itemPath = `${path}[]`;

    fields[itemPath] = fieldOf(node.items, true);
    walk(node.items, itemPath, fields);
  }
}

function projected(): Record<string, IField> {
  const fields: Record<string, IField> = {};

  walk(z.toJSONSchema(gpuSnapshotSchema) as ISchemaNode, '', fields);

  return fields;
}

describe('the mf-gpu snapshot contract', () => {
  it('states every field this schema describes, and no field it does not', () => {
    expect(projected()).toEqual(contract.fields);
  });

  it('states the schema version this agent reads', () => {
    expect(GPU_SNAPSHOT_SCHEMA_VERSION).toBe(contract.version);
  });
});
