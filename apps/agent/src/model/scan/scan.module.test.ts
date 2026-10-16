import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { ModelFormat } from '@libs/agent-protocol';

import { MODEL_FORMAT_READERS } from '@/model/scan/format-registry';
import { GgufHeaderParserService } from '@/model/scan/gguf/gguf-header-parser.service';
import { ModelScannerService } from '@/model/scan/model-scanner.service';
import { ScanModule } from '@/model/scan/scan.module';
import { ShardGrouperService } from '@/model/scan/shard-grouper.service';
import { IModelFormatReader } from '@/model/scan/types/format-reader';

describe('ScanModule', () => {
  const compile = async () => Test.createTestingModule({ imports: [ScanModule] }).compile();

  it('resolves the scanner and the shard grouper, which is all the module offers', async () => {
    const moduleRef = await compile();

    expect(moduleRef.get(ModelScannerService)).toBeInstanceOf(ModelScannerService);
    expect(moduleRef.get(ShardGrouperService)).toBeInstanceOf(ShardGrouperService);
  });

  it('registers one reader per format, each with its collaborators wired', async () => {
    const moduleRef = await compile();
    const readers = moduleRef.get<readonly IModelFormatReader[]>(MODEL_FORMAT_READERS);

    expect(readers.map(reader => reader.format)).toEqual([
      ModelFormat.GGUF,
      ModelFormat.SAFETENSORS,
      ModelFormat.GGML,
      ModelFormat.PYTORCH,
    ]);

    for (const reader of readers) {
      expect(reader.group({ directories: [], errors: [] })).toEqual({ sets: [], gaps: [] });
    }
  });

  it('keeps the machinery a reader uses inside the module', async () => {
    const moduleRef = await compile();

    expect(() => moduleRef.get(GgufHeaderParserService, { strict: true })).toThrow();
  });
});
