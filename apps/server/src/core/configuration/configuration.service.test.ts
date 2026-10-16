import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { backendDefinitions, BackendId, CONFIGURATION_SCHEMA_VERSION } from '@libs/backends';

import { ConfigurationService } from '@/core/configuration/configuration.service';

import { FLEET_FIELDS } from '@/core/configuration/schema/fleet';
import { issuePathsFrom, issuesFrom } from '@/test/validation';

const BASE_DOCUMENT = `# The image every replica runs
image: ghcr.io/ggml-org/llama.cpp:server
contextSize: 8192
threads: 16
`;

describe('ConfigurationService', () => {
  let configurationService: ConfigurationService;

  const derive = (document: string) => configurationService.derive(document, BackendId.LLAMA_CPP);

  beforeEach(() => {
    configurationService = new ConfigurationService();
  });

  describe('derive', () => {
    it('keeps the document as authored and derives the structured form from it', () => {
      const stored = derive(BASE_DOCUMENT);

      expect(stored.document).toBe(BASE_DOCUMENT);
      expect(stored.configuration).toEqual({
        image: 'ghcr.io/ggml-org/llama.cpp:server',
        contextSize: 8192,
        threads: 16,
      });
    });

    it('stamps the schema version the document was written at', () => {
      expect(derive(BASE_DOCUMENT).schemaVersion).toBe(CONFIGURATION_SCHEMA_VERSION);
    });

    it('keeps a key the declaration does not model rather than dropping it', () => {
      const stored = derive(`image: llama:latest\nsomeFutureFlag: on\n`);

      expect(stored.configuration.someFutureFlag).toBe('on');
    });

    it('refuses an unmodelled key holding a value the column cannot store', () => {
      expect(() => derive(`image: llama:latest\nsomeFutureFlag: .nan\n`)).toThrow(BadRequestException);
      expect(() => derive(`image: llama:latest\nsomeFutureFlag: .inf\n`)).toThrow(BadRequestException);
      expect(() => derive(`image: llama:latest\nsomeFutureFlag: !!binary R0lGODlh\n`)).toThrow(BadRequestException);
    });

    it('reads an empty document as a configuration holding nothing', () => {
      expect(derive('').configuration).toEqual({});
    });

    it('refuses a document that is not valid YAML', () => {
      expect(() => derive('image: [unclosed\n')).toThrow(BadRequestException);
    });

    it('refuses a document that is not a mapping', () => {
      expect(() => derive('- image\n')).toThrow('The configuration must contain settings as key-value pairs');
    });

    it('refuses a value of the wrong type for a declared field', async () => {
      await expect(issuePathsFrom(() => derive(`image: llama:latest\ncontextSize: plenty\n`))).resolves.toEqual([
        'contextSize',
      ]);
    });

    it('refuses a value outside a declared bound', async () => {
      const issues = await issuesFrom(() => derive(`image: llama:latest\nthreads: 0\n`));

      expect(issues.map(issue => issue.path)).toEqual(['threads']);
      expect(issues[0]).toEqual({ path: 'threads', name: 'Threads', message: 'Must be at least 1.' });
    });

    it('refuses a choice the declaration does not list', async () => {
      await expect(issuePathsFrom(() => derive(`image: llama:latest\nsplitMode: sideways\n`))).resolves.toEqual([
        'splitMode',
      ]);
    });

    it('names every offending key in one refusal, so the form can mark them all', async () => {
      const properties = await issuePathsFrom(() => derive(`image: llama:latest\nthreads: 0\ncontextSize: plenty\n`));

      expect(properties).toEqual(expect.arrayContaining(['threads', 'contextSize']));
    });

    it('takes null as a real value for a field the backend leaves unset', () => {
      expect(derive(`image: llama:latest\nthreads: null\n`).configuration.threads).toBeNull();
    });
  });

  describe('fleet keys', () => {
    it("leaves the image out, so the backend's tested one stands", () => {
      expect(derive('contextSize: 4096\n').configuration).toEqual({ contextSize: 4096 });
    });

    it('refuses an image that names nothing', async () => {
      await expect(issuePathsFrom(() => derive("image: ''\n"))).resolves.toEqual(['image']);
    });

    it('reads replicas as a fleet-wide total', () => {
      expect(derive(`image: llama:latest\nreplicas: 3\n`).configuration.replicas).toBe(3);
    });

    it('refuses fewer than one replica', async () => {
      await expect(issuePathsFrom(() => derive(`image: llama:latest\nreplicas: 0\n`))).resolves.toEqual(['replicas']);
    });

    it('reads a declared VRAM figure as GiB, and refuses one of nothing', async () => {
      expect(derive(`image: llama:latest\nvramGib: 7.5\n`).configuration.vramGib).toBe(7.5);
      await expect(issuePathsFrom(() => derive(`image: llama:latest\nvramGib: 0\n`))).resolves.toEqual(['vramGib']);
    });

    it('reads an idle timeout as the duration it was written as', () => {
      expect(derive(`image: llama:latest\nidleTimeout: 30m\n`).configuration.idleTimeout).toBe('30m');
    });

    it('refuses an idle timeout shorter than the last-used stamp, which would read a busy deployment as idle', async () => {
      await expect(issuePathsFrom(() => derive(`image: llama:latest\nidleTimeout: 30s\n`))).resolves.toEqual([
        'idleTimeout',
      ]);
    });

    it('refuses an idle timeout of zero rather than reading it as never', async () => {
      await expect(issuePathsFrom(() => derive(`image: llama:latest\nidleTimeout: 0s\n`))).resolves.toEqual([
        'idleTimeout',
      ]);
    });

    it('refuses an idle timeout that is not a duration', async () => {
      await expect(issuePathsFrom(() => derive(`image: llama:latest\nidleTimeout: soon\n`))).resolves.toEqual([
        'idleTimeout',
      ]);
    });

    it('reads placement constraints, pinning a GPU by node and device key', () => {
      const stored = derive(`
image: llama:latest
placement:
  nodeIds: [1, 2]
  gpus:
    - nodeId: 1
      deviceKey: GPU-2f4c9a
  spreadAcrossNodes: true
`);

      expect(stored.configuration.placement).toEqual({
        nodeIds: [1, 2],
        gpus: [{ nodeId: 1, deviceKey: 'GPU-2f4c9a' }],
        spreadAcrossNodes: true,
      });
    });

    it('names a nested placement issue by its dotted path, worded for the placement field', async () => {
      const issues = await issuesFrom(() =>
        derive(`
image: llama:latest
placement:
  gpus:
    - nodeId: 1
      deviceOrdinal: 0
`)
      );

      expect(issues.map(issue => issue.path)).toEqual(['placement.gpus.deviceKey', 'placement.gpus']);
      expect(issues.map(issue => issue.message)).toEqual([
        expect.stringMatching(/^gpus\[0\]\.deviceKey /),
        expect.stringMatching(/^gpus\[0\] /),
      ]);
    });
  });

  describe('pins a backend cannot run on', () => {
    const deriveFor = (backend: BackendId, placement: string) =>
      configurationService.derive(`placement:\n${placement}`, backend);

    it('refuses several GPUs on one node for a backend that runs on one', async () => {
      const issues = await issuesFrom(() =>
        deriveFor(
          BackendId.WHISPER_CPP,
          '  gpus:\n    - { nodeId: 1, deviceKey: GPU-a }\n    - { nodeId: 1, deviceKey: GPU-b }\n'
        )
      );

      expect(issues).toEqual([
        expect.objectContaining({
          path: 'placement',
          message: 'Pins several GPUs on one node, and this backend runs on a single GPU.',
        }),
      ]);
    });

    it("refuses a node's CPU beside its GPU for a backend that cannot offload", async () => {
      const issues = await issuesFrom(() =>
        deriveFor(BackendId.KOKORO, '  nodeIds: [1]\n  gpus:\n    - { nodeId: 1, deviceKey: GPU-a }\n')
      );

      expect(issues.map(issue => issue.message)).toEqual([
        "Pins a node's CPU beside its GPUs, and this backend cannot offload to host memory.",
      ]);
    });

    it('takes one GPU per node, or a CPU on its own, across several nodes', () => {
      expect(() =>
        deriveFor(
          BackendId.KOKORO,
          '  nodeIds: [2]\n  gpus:\n    - { nodeId: 1, deviceKey: GPU-a }\n    - { nodeId: 3, deviceKey: GPU-a }\n'
        )
      ).not.toThrow();
    });

    it('takes any pins for a backend that offloads across several cards', () => {
      expect(() =>
        deriveFor(
          BackendId.LLAMA_CPP,
          '  nodeIds: [1]\n  gpus:\n    - { nodeId: 1, deviceKey: GPU-a }\n    - { nodeId: 1, deviceKey: GPU-b }\n'
        )
      ).not.toThrow();
    });
  });

  describe('reserved keys', () => {
    it('leaves every fleet key free of a backend field of the same name', () => {
      for (const { declaration } of Object.values(backendDefinitions)) {
        const clashing = declaration.fields.filter(field => FLEET_FIELDS.includes(field.name));

        expect(clashing).toEqual([]);
      }
    });
  });
});
