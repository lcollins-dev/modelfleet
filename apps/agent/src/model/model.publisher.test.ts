import { Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentMessageType, AgentModelInventory, ModelFormat, ModelType } from '@libs/agent-protocol';

import { ModelPublisher } from '@/model/model.publisher';
import { ModelService } from '@/model/model.service';
import { ServerConnectionService } from '@/server/server-connection.service';

const INVENTORY: AgentModelInventory = {
  scannedAt: '2026-08-20T12:00:00.000Z',
  directories: ['/var/lib/modelfleet/weights'],
  models: [
    {
      fingerprint: 'a'.repeat(64),
      format: ModelFormat.GGUF,
      type: ModelType.MODEL,
      sizeBytes: 4_920_000_000,
      path: '/var/lib/modelfleet/weights/llama.gguf',
      shardCount: 1,
      name: 'Llama 3 8B Instruct',
      ggufMetadata: {
        architecture: 'llama',
        quantisation: 'Q4_K',
        quantisationMixed: true,
        layerCount: 32,
        embeddingLength: 4096,
        headCount: 32,
        headCountKv: 8,
        contextLength: 8192,
      },
      safetensorsMetadata: null,
    },
  ],
  errors: [],
};

describe('ModelPublisher', () => {
  let inventoryChanges: Subject<AgentModelInventory>;
  let welcomes: Subject<void>;
  let send: ReturnType<typeof vi.fn>;
  let currentInventory: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    inventoryChanges = new Subject<AgentModelInventory>();
    welcomes = new Subject<void>();
    send = vi.fn();
    currentInventory = vi.fn().mockReturnValue(INVENTORY);

    const publisher = new ModelPublisher(
      { changes: () => inventoryChanges.asObservable(), currentInventory } as unknown as ModelService,
      { sessionOpened: () => welcomes.asObservable(), send } as unknown as ServerConnectionService
    );

    publisher.onModuleInit();
  });

  it('sends the model set whenever a scan finishes', () => {
    inventoryChanges.next(INVENTORY);

    expect(send).toHaveBeenCalledWith(AgentMessageType.MODEL_INVENTORY, INVENTORY);
  });

  it('states the model set again on every welcome', () => {
    welcomes.next();

    expect(send).toHaveBeenCalledWith(AgentMessageType.MODEL_INVENTORY, INVENTORY);
  });

  it('sends no model set on a welcome before the first scan finishes', () => {
    currentInventory.mockReturnValue(null);

    welcomes.next();

    expect(send).not.toHaveBeenCalled();
  });
});
