import { Module } from '@nestjs/common';

import { DirectoryWalkerService } from './directory-walker.service';
import { MODEL_FORMAT_READERS } from './format-registry';
import { GgmlReaderService } from './ggml/ggml-reader.service';
import { GgufHeaderParserService } from './gguf/gguf-header-parser.service';
import { GgufReaderService } from './gguf/gguf-reader.service';
import { ModelFingerprintService } from './model-fingerprint.service';
import { ModelScannerService } from './model-scanner.service';
import { PytorchReaderService } from './pytorch/pytorch-reader.service';
import { RepositoryMetadataService } from './repository-metadata.service';
import { SafetensorsHeaderParserService } from './safetensors/safetensors-header-parser.service';
import { SafetensorsReaderService } from './safetensors/safetensors-reader.service';
import { ShardGrouperService } from './shard-grouper.service';

@Module({
  providers: [
    ShardGrouperService,
    DirectoryWalkerService,
    ModelFingerprintService,
    GgufHeaderParserService,
    GgufReaderService,
    SafetensorsHeaderParserService,
    RepositoryMetadataService,
    SafetensorsReaderService,
    GgmlReaderService,
    PytorchReaderService,
    {
      provide: MODEL_FORMAT_READERS,
      useFactory: (
        gguf: GgufReaderService,
        safetensors: SafetensorsReaderService,
        ggml: GgmlReaderService,
        pytorch: PytorchReaderService
      ) => [gguf, safetensors, ggml, pytorch],
      inject: [GgufReaderService, SafetensorsReaderService, GgmlReaderService, PytorchReaderService],
    },
    ModelScannerService,
  ],
  exports: [ModelScannerService, ShardGrouperService],
})
export class ScanModule {}
