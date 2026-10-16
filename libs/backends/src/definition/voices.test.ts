import { describe, expect, it } from 'vitest';

import { readVoices } from './voices';

const LISTING = { path: '/v1/audio/voices', list: 'voices' };

describe('readVoices', () => {
  it("reads a name as the voice's id and name", () => {
    const body: unknown = JSON.parse('{"voices":["vivian","default"],"uploaded_voices":[]}');

    expect(readVoices(LISTING, body)).toEqual([
      { id: 'vivian', name: 'vivian' },
      { id: 'default', name: 'default' },
    ]);
  });

  it('reads an object by its id and name, and names a voice with no name by its id', () => {
    const body: unknown = JSON.parse(
      '{"voices":[{"id":"af_heart","name":"Heart","overall_grade":"A"},{"id":"am_adam"}]}'
    );

    expect(readVoices(LISTING, body)).toEqual([
      { id: 'af_heart', name: 'Heart' },
      { id: 'am_adam', name: 'am_adam' },
    ]);
  });

  it('follows a dot path to a nested list', () => {
    expect(readVoices({ ...LISTING, list: 'data.voices' }, { data: { voices: ['eric'] } })).toEqual([
      { id: 'eric', name: 'eric' },
    ]);
  });

  it('drops an entry that names no voice', () => {
    const body = { voices: ['', 7, null, { name: 'no id' }, { id: '' }, { id: 3 }, 'ryan'] };

    expect(readVoices(LISTING, body)).toEqual([{ id: 'ryan', name: 'ryan' }]);
  });

  it.each([undefined, 'voices', { voices: 'vivian' }, { other: [] }])('answers no voices from %j', body => {
    expect(readVoices(LISTING, body)).toEqual([]);
  });
});
