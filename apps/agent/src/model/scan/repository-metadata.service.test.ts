import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ModelTask } from '@libs/agent-protocol';

import { RepositoryMetadataService } from '@/model/scan/repository-metadata.service';

describe('RepositoryMetadataService', () => {
  const service = new RepositoryMetadataService();

  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'modelfleet-repository-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const card = (frontMatter: string, body = '# A model\n'): Promise<void> =>
    writeFile(join(directory, 'README.md'), `---\n${frontMatter}\n---\n\n${body}`);

  const config = (json: string): Promise<void> => writeFile(join(directory, 'config.json'), json);

  describe('the task', () => {
    it.each([
      ['automatic-speech-recognition', ModelTask.TRANSCRIPTION],
      ['text-to-speech', ModelTask.SPEECH],
      ['text-to-audio', ModelTask.SPEECH],
      ['text-generation', ModelTask.CHAT],
      ['image-text-to-text', ModelTask.CHAT],
      ['feature-extraction', ModelTask.EMBEDDING],
      ['sentence-similarity', ModelTask.EMBEDDING],
      ['audio-text-to-text', ModelTask.CHAT, ModelTask.TRANSCRIPTION],
    ])('reads %s from the card as %s', async (tag, ...tasks) => {
      await card(`pipeline_tag: ${tag}`);

      expect((await service.read(directory)).tasks).toEqual(tasks);
    });

    it('takes the card over a config naming only a causal language model', async () => {
      await card('pipeline_tag: automatic-speech-recognition');
      await config('{"architectures":["LlamaForCausalLM"]}');

      expect((await service.read(directory)).tasks).toEqual([ModelTask.TRANSCRIPTION]);
    });

    it("reads Kokoro's config, which names no architecture, as speech where there is no card", async () => {
      await config('{"istftnet":{"upsample_rates":[10,6]},"plbert":{"hidden_size":768},"n_token":178}');

      expect((await service.read(directory)).tasks).toEqual([ModelTask.SPEECH]);
    });

    it('reads a whisper config as transcription where there is no card', async () => {
      await config('{"architectures":["WhisperForConditionalGeneration"],"model_type":"whisper"}');

      expect((await service.read(directory)).tasks).toEqual([ModelTask.TRANSCRIPTION]);
    });

    it('reads a Qwen3-TTS config as speech where there is no card', async () => {
      await config('{"architectures":["Qwen3TTSForConditionalGeneration"],"model_type":"qwen3_tts"}');

      expect((await service.read(directory)).tasks).toEqual([ModelTask.SPEECH]);
    });

    it('falls back to the config where the card names a tag it does not map', async () => {
      await card('pipeline_tag: any-to-any');
      await config('{"architectures":["Qwen3ForCausalLM"]}');

      expect((await service.read(directory)).tasks).toEqual([ModelTask.CHAT]);
    });

    it("reads an omni model's architecture as chat, transcription and speech", async () => {
      await card('pipeline_tag: any-to-any');
      await config('{"architectures":["Qwen3OmniMoeForConditionalGeneration"]}');

      expect((await service.read(directory)).tasks).toEqual([
        ModelTask.CHAT,
        ModelTask.TRANSCRIPTION,
        ModelTask.SPEECH,
      ]);
    });

    it('takes an architecture the table names over a card naming one of its tasks', async () => {
      await card('pipeline_tag: image-text-to-text');
      await config('{"architectures":["Gemma3nForConditionalGeneration"]}');

      expect((await service.read(directory)).tasks).toEqual([ModelTask.CHAT, ModelTask.TRANSCRIPTION]);
    });

    it('reads any causal language model as chat', async () => {
      await config('{"architectures":["Qwen3ForCausalLM"]}');

      expect((await service.read(directory)).tasks).toEqual([ModelTask.CHAT]);
    });

    it('reads the model type where no architecture is known', async () => {
      await config('{"architectures":["SomethingNew"],"model_type":"vits"}');

      expect((await service.read(directory)).tasks).toEqual([ModelTask.SPEECH]);
    });

    it('reads a sentence-transformers repository as embedding, over a causal language model config', async () => {
      await config('{"architectures":["Qwen3ForCausalLM"]}');
      await writeFile(join(directory, 'modules.json'), '[]');

      expect((await service.read(directory)).tasks).toEqual([ModelTask.EMBEDDING]);
    });

    it('states no task where nothing on disk says', async () => {
      await config('{"architectures":["BertModel"],"model_type":"bert"}');

      expect(await service.read(directory)).toEqual({ tasks: [], licence: null, architecture: 'bert' });
    });

    it('states nothing for an empty directory', async () => {
      expect(await service.read(directory)).toEqual({ tasks: [], licence: null, architecture: null });
    });
  });

  describe('the licence', () => {
    it('reads the identifier a card states', async () => {
      await card('license: cc-by-nc-4.0\npipeline_tag: text-to-speech');

      expect((await service.read(directory)).licence).toEqual({ id: 'cc-by-nc-4.0', name: null, link: null });
    });

    it('reads the name and link a custom licence carries', async () => {
      await card('license: other\nlicense_name: fish-audio-research\nlicense_link: https://example.com/LICENSE');

      expect((await service.read(directory)).licence).toEqual({
        id: 'other',
        name: 'fish-audio-research',
        link: 'https://example.com/LICENSE',
      });
    });

    it('states none where the licence is not a single identifier', async () => {
      await card('license:\n  - mit\n  - apache-2.0');

      expect((await service.read(directory)).licence).toBeNull();
    });
  });

  describe('the architecture', () => {
    it("reads the config's model type, the key vLLM-Omni chooses a pipeline by", async () => {
      await config('{"architectures":["Qwen3TTSForConditionalGeneration"],"model_type":"qwen3_tts"}');

      expect((await service.read(directory)).architecture).toBe('qwen3_tts');
    });

    it('states none past the protocol cap, so one config cannot fail the whole inventory', async () => {
      await config(`{"model_type":"${'x'.repeat(65)}"}`);

      expect((await service.read(directory)).architecture).toBeNull();
    });
  });

  describe('a card written by another editor', () => {
    it('reads front matter behind a byte order mark', async () => {
      await writeFile(join(directory, 'README.md'), '\uFEFF---\nlicense: mit\n---\n');

      expect((await service.read(directory)).licence?.id).toBe('mit');
    });

    it('reads front matter with Windows line endings and trailing spaces on its fences', async () => {
      await writeFile(join(directory, 'README.md'), '---  \r\npipeline_tag: text-to-speech\r\n--- \r\n# Model\r\n');

      expect((await service.read(directory)).tasks).toEqual([ModelTask.SPEECH]);
    });
  });

  describe('a card it cannot read', () => {
    it('reads a card with no front matter as stating nothing', async () => {
      await writeFile(join(directory, 'README.md'), '# Whisper\n\npipeline_tag: automatic-speech-recognition\n');

      expect(await service.read(directory)).toEqual({ tasks: [], licence: null, architecture: null });
    });

    it('reads malformed front matter as stating nothing, falling back to the config', async () => {
      await card('pipeline_tag: [unclosed');
      await config('{"architectures":["WhisperForConditionalGeneration"]}');

      expect(await service.read(directory)).toEqual({
        tasks: [ModelTask.TRANSCRIPTION],
        licence: null,
        architecture: null,
      });
    });

    it('reads front matter that does not close inside the cap as stating nothing', async () => {
      await card(`license: mit\nnotes: "${'x'.repeat(70 * 1024)}"`);

      expect((await service.read(directory)).licence).toBeNull();
    });

    it('reads a config past the cap as stating nothing', async () => {
      await config(`{"architectures":["WhisperForConditionalGeneration"],"padding":"${'x'.repeat(1024 * 1024)}"}`);

      expect((await service.read(directory)).tasks).toEqual([]);
    });

    it('reads a config that is not JSON as stating nothing', async () => {
      await writeFile(join(directory, 'config.json'), '{ "architectures": [');

      expect((await service.read(directory)).tasks).toEqual([]);
    });

    it('refuses a YAML alias, so a card cannot expand past its own size', async () => {
      await card('base: &base text-generation\npipeline_tag: *base\nlicense: mit');

      expect(await service.read(directory)).toEqual({ tasks: [], licence: null, architecture: null });
    });
  });
});
