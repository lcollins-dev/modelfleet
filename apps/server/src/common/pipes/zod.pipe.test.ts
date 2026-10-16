import { ArgumentMetadata, BadRequestException, PipeTransform } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ValidationResponseDto, PageParamDto } from '@libs/dto';

import { ZodPipe } from '@/common/pipes/zod.pipe';

const BODY: ArgumentMetadata = { type: 'body' };
const PARAM: ArgumentMetadata = { type: 'param', data: 'nodeId' };

const UNACCEPTED = "This field isn't accepted.";

const bodyPipe = new ZodPipe(
  z.strictObject(
    {
      name: z.string().min(2, { error: 'Enter between 2 and 128 characters.' }),
      presetId: z.string().max(8).optional(),
      desc: z.string().max(8).optional(),
      nodeIds: z.array(z.int({ error: 'Enter a whole number.' })).optional(),
      placement: z.strictObject({ gpus: z.array(z.strictObject({ deviceKey: z.string() })) }).optional(),
    },
    { error: issue => (issue.code === 'unrecognized_keys' ? UNACCEPTED : 'Send the fields as a JSON object.') }
  )
);

const refusalOf = (pipe: PipeTransform, value: unknown, metadata: ArgumentMetadata): unknown => {
  try {
    pipe.transform(value, metadata);
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);

    return (error as BadRequestException).getResponse();
  }

  throw new Error('The pipe accepted the value');
};

const fieldErrors = (value: unknown) => (refusalOf(bodyPipe, value, BODY) as ValidationResponseDto).message;

describe('ZodPipe', () => {
  it('returns the parsed value', () => {
    expect(bodyPipe.transform({ name: 'rig-01' }, BODY)).toEqual({ name: 'rig-01' });
  });

  it('answers a body refusal with the field list the web app reads', () => {
    expect(refusalOf(bodyPipe, { name: 'x' }, BODY)).toEqual({
      statusCode: 400,
      message: [{ path: 'name', name: 'Name', message: 'Enter between 2 and 128 characters.' }],
      error: 'Bad Request',
    });
  });

  it('names a field after its property, without a trailing id', () => {
    expect(fieldErrors({ name: 'rig-01', presetId: 'x'.repeat(9) })[0].name).toBe('Preset');
  });

  it('expands a bare desc property to Description', () => {
    expect(fieldErrors({ name: 'rig-01', desc: 'x'.repeat(9) })[0].name).toBe('Description');
  });

  it('lands a refusal inside a list on the list', () => {
    expect(fieldErrors({ name: 'rig-01', nodeIds: [1, 1.5] })).toEqual([
      { path: 'nodeIds', name: 'Nodes', message: 'Enter a whole number.' },
    ]);
  });

  it('names a nested field by its dotted path', () => {
    const errors = fieldErrors({ name: 'rig-01', placement: { gpus: [{ deviceKey: 7 }] } });

    expect(errors.map(error => [error.path, error.name])).toEqual([['placement.gpus.deviceKey', 'Device key']]);
  });

  it('refuses each field the schema does not name', () => {
    expect(fieldErrors({ name: 'rig-01', extra: 1, other: 2 })).toEqual([
      { path: 'extra', name: 'Extra', message: UNACCEPTED },
      { path: 'other', name: 'Other', message: UNACCEPTED },
    ]);
  });

  it('answers a body that is not an object with a plain message', () => {
    expect(refusalOf(bodyPipe, undefined, BODY)).toMatchObject({ message: 'Send the fields as a JSON object.' });
  });

  it('answers a named param with a plain message', () => {
    const pipe = new ZodPipe(PageParamDto);

    expect(pipe.transform('42', PARAM)).toBe(42);
    expect(refusalOf(pipe, '0', PARAM)).toMatchObject({ message: 'Enter a number from 1 to 2147483647.' });
  });
});
