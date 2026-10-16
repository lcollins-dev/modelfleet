import { HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BackendOperation, IVoice, VoiceListing, StreamDialect } from '@libs/backends';
import { BackendError } from '@libs/backends/openai';

import { ApiKey } from '@/core/api-key/entities/api-key.entity';
import { Deployment } from '@/core/deployment/entities/deployment.entity';
import { VoiceList } from '@/core/voice/entities/voice-list.entity';

import { InferenceRequestService } from '../../proxy/inference-request.service';
import { IUpload, MultipartUploadService } from '../../proxy/multipart-upload.service';
import { RelayProxyService } from '../../proxy/relay-proxy.service';
import { AudioService, TranscriptionOperation } from './audio.service';
import { DeploymentResolverService, IResolvedDeployment } from '@/core/inference/deployment-resolver.service';
import { VoiceListService } from '@/core/voice/voice-list.service';

import { OpenAiHttpException } from '../../errors/openai-http.exception';

const UPLOAD_TYPE = 'multipart/form-data; boundary=abc';

const uploadWith = (fields: Record<string, string>): IUpload => ({
  body: Buffer.from('--abc\r\n...'),
  contentType: UPLOAD_TYPE,
  model: 'asr-2b',
  fields: new Map(Object.entries({ model: 'asr-2b', ...fields })),
});

const resolvedFor = (streaming: StreamDialect, responseFormats: string[] | null): IResolvedDeployment =>
  ({
    deployment: { id: 4, name: 'asr-2b' } as Deployment,
    capability: { path: '/v1/audio/transcriptions', responseFormats, streaming },
    mapping: { error: vi.fn() },
  }) as unknown as IResolvedDeployment;

const REVISION = 'rev-1';

const speakingAs = (name: string, voices?: VoiceListing, configurationRevision = REVISION): IResolvedDeployment =>
  ({
    deployment: { id: name.length, name, configurationRevision, enabled: true } as Deployment,
    capability: { path: '/v1/audio/speech', responseFormats: null, streaming: StreamDialect.NONE, voices },
    mapping: { error: vi.fn() },
  }) as unknown as IResolvedDeployment;

const refusalFrom = async (run: () => Promise<unknown>): Promise<OpenAiHttpException> => {
  try {
    await run();
  } catch (error: unknown) {
    return error as OpenAiHttpException;
  }

  throw new Error('The request was expected to be refused');
};

const bodyOf = (error: OpenAiHttpException): BackendError => error.getResponse() as BackendError;

describe('AudioService', () => {
  let deploymentResolverService: { resolve: ReturnType<typeof vi.fn>; findServing: ReturnType<typeof vi.fn> };
  let multipartUploadService: { read: ReturnType<typeof vi.fn> };
  let relayProxyService: { proxy: ReturnType<typeof vi.fn>; queryIfReady: ReturnType<typeof vi.fn> };
  let storedLists: Map<number, VoiceList>;
  let rememberVoices: ReturnType<typeof vi.fn>;
  let audioService: AudioService;

  const resolveTo = (resolved: IResolvedDeployment): void => {
    deploymentResolverService.resolve.mockResolvedValue({ resolved, refusal: null });
  };

  beforeEach(() => {
    deploymentResolverService = { resolve: vi.fn(), findServing: vi.fn().mockResolvedValue([]) };
    multipartUploadService = { read: vi.fn().mockResolvedValue(uploadWith({})) };
    relayProxyService = { proxy: vi.fn().mockResolvedValue(undefined), queryIfReady: vi.fn() };
    storedLists = new Map();
    rememberVoices = vi.fn((deploymentId: number, configurationRevision: string, voices: IVoice[]) => {
      storedLists.set(deploymentId, new VoiceList({ deploymentId, configurationRevision, voices }));

      return Promise.resolve();
    });

    const voiceListService = {
      findFor: (deploymentIds: number[]) =>
        Promise.resolve(new Map([...storedLists].filter(([deploymentId]) => deploymentIds.includes(deploymentId)))),
      remember: rememberVoices,
    };

    resolveTo(resolvedFor(StreamDialect.NONE, ['json']));

    audioService = new AudioService(
      deploymentResolverService as unknown as DeploymentResolverService,
      new InferenceRequestService(deploymentResolverService as unknown as DeploymentResolverService),
      multipartUploadService as unknown as MultipartUploadService,
      relayProxyService as unknown as RelayProxyService,
      voiceListService as unknown as VoiceListService
    );
  });

  describe('transcribe', () => {
    it('relays the upload untouched under its own type, routed on its model', async () => {
      const upload = uploadWith({});

      multipartUploadService.read.mockResolvedValue(upload);

      await audioService.transcribe(BackendOperation.TRANSCRIPTION, {} as Request, { id: 1 } as ApiKey, {} as Response);

      expect(deploymentResolverService.resolve).toHaveBeenCalledWith('asr-2b', BackendOperation.TRANSCRIPTION);
      expect(relayProxyService.proxy).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: BackendOperation.TRANSCRIPTION,
          upstreamBody: upload.body,
          contentType: UPLOAD_TYPE,
          streaming: false,
        })
      );
      const [call] = relayProxyService.proxy.mock.calls[0] as [{ mapBody?: unknown; mapChunk?: unknown }];

      expect(call.mapBody).toBeUndefined();
      expect(call.mapChunk).toBeUndefined();
    });

    it.each<[TranscriptionOperation, boolean]>([
      [BackendOperation.TRANSCRIPTION, true],
      [BackendOperation.TRANSLATION, false],
    ])("reads %s's answer through the backend's transcription mapping: %s", async (operation, mapped) => {
      const response = vi.fn();

      resolveTo({
        ...resolvedFor(StreamDialect.NONE, ['json']),
        mapping: { error: vi.fn(), transcription: { response } },
      } as unknown as IResolvedDeployment);

      await audioService.transcribe(operation, {} as Request, { id: 1 } as ApiKey, {} as Response);

      expect(relayProxyService.proxy.mock.calls[0][0]).toMatchObject({ mapBody: mapped ? response : undefined });
    });

    it.each([
      [{ response_format: 'srt' }, 'response_format'],
      [{ stream: 'true' }, 'stream'],
      [{ stream: 'yes' }, 'stream'],
      [{ stream: 'On' }, 'stream'],
      [{ stream: 't' }, 'stream'],
      [{ stream: 'Y' }, 'stream'],
    ])('refuses %o on an operation that cannot serve it, and never relays', async (fields, param) => {
      multipartUploadService.read.mockResolvedValue(uploadWith(fields));

      const thrown = await refusalFrom(() =>
        audioService.transcribe(BackendOperation.TRANSCRIPTION, {} as Request, { id: 1 } as ApiKey, {} as Response)
      );

      expect(thrown.getStatus()).toBe(HttpStatus.BAD_REQUEST);
      expect(bodyOf(thrown).error).toMatchObject({ code: 'unsupported_parameter', param });
      expect(relayProxyService.proxy).not.toHaveBeenCalled();
    });

    it.each(['true', 'True', '1'])('relays stream=%s as an event stream where the operation streams', async stream => {
      resolveTo(resolvedFor(StreamDialect.OPENAI, null));
      multipartUploadService.read.mockResolvedValue(uploadWith({ stream }));

      await audioService.transcribe(BackendOperation.TRANSLATION, {} as Request, { id: 1 } as ApiKey, {} as Response);

      expect(relayProxyService.proxy).toHaveBeenCalledWith(
        expect.objectContaining({ operation: BackendOperation.TRANSLATION, streaming: true })
      );
    });
  });

  describe('speak', () => {
    const SPEECH_REQUEST = { model: 'tts-1b', input: 'Hello', voice: 'alloy' };

    it('relays the request as JSON, through no mapping where the backend has none', async () => {
      resolveTo(resolvedFor(StreamDialect.NONE, null));

      await audioService.speak(SPEECH_REQUEST, { id: 1 } as ApiKey, {} as Response);

      const [call] = relayProxyService.proxy.mock.calls[0] as [{ upstreamBody: Buffer; contentType: string }];

      expect(JSON.parse(call.upstreamBody.toString())).toEqual(SPEECH_REQUEST);
      expect(call.contentType).toBe('application/json');
      expect(deploymentResolverService.resolve).toHaveBeenCalledWith('tts-1b', BackendOperation.SPEECH);
    });

    it("relays the request through the backend's speech mapping where it has one", async () => {
      resolveTo({
        ...resolvedFor(StreamDialect.NONE, null),
        mapping: { error: vi.fn(), speech: { request: (request: object) => ({ ...request, speed: 1 }) } },
      } as unknown as IResolvedDeployment);

      await audioService.speak(SPEECH_REQUEST, { id: 1 } as ApiKey, {} as Response);

      const [call] = relayProxyService.proxy.mock.calls[0] as [{ upstreamBody: Buffer }];

      expect(JSON.parse(call.upstreamBody.toString())).toEqual({ ...SPEECH_REQUEST, speed: 1 });
    });

    it('sends the model name a backend insists on in place of the deployment name', async () => {
      const resolved = resolvedFor(StreamDialect.NONE, null);

      resolveTo({ ...resolved, capability: { ...resolved.capability, upstreamModel: 'kokoro' } });

      await audioService.speak(SPEECH_REQUEST, { id: 1 } as ApiKey, {} as Response);

      const [call] = relayProxyService.proxy.mock.calls[0] as [{ upstreamBody: Buffer }];

      expect(JSON.parse(call.upstreamBody.toString())).toEqual({ ...SPEECH_REQUEST, model: 'kokoro' });
    });

    it('refuses an SSE stream on an operation that does not stream, naming stream_format', async () => {
      const thrown = await refusalFrom(() =>
        audioService.speak({ ...SPEECH_REQUEST, stream_format: 'sse' }, { id: 1 } as ApiKey, {} as Response)
      );

      expect(bodyOf(thrown).error).toMatchObject({ code: 'unsupported_parameter', param: 'stream_format' });
      expect(relayProxyService.proxy).not.toHaveBeenCalled();
    });

    it('refuses a response_format the backend cannot write, and never relays', async () => {
      resolveTo(resolvedFor(StreamDialect.OPENAI, ['wav', 'mp3']));

      const thrown = await refusalFrom(() =>
        audioService.speak({ ...SPEECH_REQUEST, response_format: 'aac' }, { id: 1 } as ApiKey, {} as Response)
      );

      expect(bodyOf(thrown).error).toMatchObject({ code: 'unsupported_parameter', param: 'response_format' });
      expect(relayProxyService.proxy).not.toHaveBeenCalled();
    });

    it('lets the raw audio stream through, which is no event stream', async () => {
      resolveTo(resolvedFor(StreamDialect.NONE, null));

      await audioService.speak({ ...SPEECH_REQUEST, stream_format: 'audio' }, { id: 1 } as ApiKey, {} as Response);

      expect(relayProxyService.proxy).toHaveBeenCalledWith(expect.objectContaining({ streaming: false }));
    });
  });

  describe('listModels', () => {
    it('lists every deployment serving speech, in the shape Open WebUI reads', async () => {
      deploymentResolverService.findServing.mockResolvedValue([speakingAs('tts-1b')]);

      expect(await audioService.listModels()).toEqual({ models: [{ id: 'tts-1b' }] });
      expect(deploymentResolverService.findServing).toHaveBeenCalledWith(BackendOperation.SPEECH);
    });
  });

  describe('listVoices', () => {
    const LISTING = { path: '/v1/audio/voices', list: 'voices' };

    const answer = (body: unknown, configurationRevision = REVISION): unknown => ({ configurationRevision, body });

    it('lists the voices each ready instance answers with, in the shape Open WebUI reads', async () => {
      const qwen = speakingAs('qwen-tts', LISTING);
      const kokoro = speakingAs('kokoro', LISTING);

      deploymentResolverService.findServing.mockResolvedValue([qwen, kokoro]);
      relayProxyService.queryIfReady
        .mockResolvedValueOnce(answer({ voices: ['vivian', 'ryan'] }))
        .mockResolvedValueOnce(answer({ voices: [{ id: 'af_heart', name: 'Heart' }] }));

      expect(await audioService.listVoices()).toEqual({
        voices: [
          { id: 'vivian', name: 'vivian' },
          { id: 'ryan', name: 'ryan' },
          { id: 'af_heart', name: 'Heart' },
        ],
      });
      expect(relayProxyService.queryIfReady).toHaveBeenCalledWith(qwen.deployment, '/v1/audio/voices');
    });

    it('keeps the first voice of each id two deployments both list', async () => {
      deploymentResolverService.findServing.mockResolvedValue([
        speakingAs('first', LISTING),
        speakingAs('second', LISTING),
      ]);
      relayProxyService.queryIfReady
        .mockResolvedValueOnce(answer({ voices: [{ id: 'vivian', name: 'Vivian' }] }))
        .mockResolvedValueOnce(answer({ voices: ['vivian'] }));

      expect(await audioService.listVoices()).toEqual({ voices: [{ id: 'vivian', name: 'Vivian' }] });
    });

    it('reads nothing from a backend that lists no voices', async () => {
      deploymentResolverService.findServing.mockResolvedValue([speakingAs('silent')]);

      expect(await audioService.listVoices()).toEqual({ voices: [] });
      expect(relayProxyService.queryIfReady).not.toHaveBeenCalled();
    });

    it('answers a second listing of an unchanged deployment without querying it, ready or not', async () => {
      deploymentResolverService.findServing.mockResolvedValue([speakingAs('kokoro', LISTING)]);
      relayProxyService.queryIfReady.mockResolvedValueOnce(answer({ voices: ['af_heart'] }));

      await audioService.listVoices();

      expect(await audioService.listVoices()).toEqual({ voices: [{ id: 'af_heart', name: 'af_heart' }] });
      expect(relayProxyService.queryIfReady).toHaveBeenCalledTimes(1);
    });

    it('lists the voices it read though storing them fails', async () => {
      deploymentResolverService.findServing.mockResolvedValue([speakingAs('kokoro', LISTING)]);
      relayProxyService.queryIfReady.mockResolvedValueOnce(answer({ voices: ['af_heart'] }));
      rememberVoices.mockRejectedValueOnce(new Error('connection lost'));

      expect(await audioService.listVoices()).toEqual({ voices: [{ id: 'af_heart', name: 'af_heart' }] });
    });

    it('reads the voices afresh once the configuration revision changes', async () => {
      deploymentResolverService.findServing.mockResolvedValueOnce([speakingAs('kokoro', LISTING)]);
      relayProxyService.queryIfReady
        .mockResolvedValueOnce(answer({ voices: ['af_heart'] }))
        .mockResolvedValueOnce(answer({ voices: ['am_adam'] }, 'rev-2'));

      await audioService.listVoices();
      deploymentResolverService.findServing.mockResolvedValue([speakingAs('kokoro', LISTING, 'rev-2')]);

      expect(await audioService.listVoices()).toEqual({ voices: [{ id: 'am_adam', name: 'am_adam' }] });
      expect(await audioService.listVoices()).toEqual({ voices: [{ id: 'am_adam', name: 'am_adam' }] });
      expect(relayProxyService.queryIfReady).toHaveBeenCalledTimes(2);
    });

    it('lists but does not remember what an instance on another revision answers', async () => {
      deploymentResolverService.findServing.mockResolvedValue([speakingAs('kokoro', LISTING, 'rev-2')]);
      relayProxyService.queryIfReady.mockResolvedValue(answer({ voices: ['af_heart'] }, 'rev-1'));

      expect(await audioService.listVoices()).toEqual({ voices: [{ id: 'af_heart', name: 'af_heart' }] });

      await audioService.listVoices();

      expect(relayProxyService.queryIfReady).toHaveBeenCalledTimes(2);
    });

    it.each([
      ['a failed read', undefined],
      ['an answer holding no list', answer({ error: 'loading' })],
      ['an empty list', answer({ voices: [] })],
      ['a list naming no voice', answer({ voices: [7, { name: 'no id' }] })],
    ])('reads again after %s rather than remembering it', async (_case, failed) => {
      deploymentResolverService.findServing.mockResolvedValue([speakingAs('kokoro', LISTING)]);
      relayProxyService.queryIfReady
        .mockResolvedValueOnce(failed)
        .mockResolvedValueOnce(answer({ voices: ['af_heart'] }));

      expect(await audioService.listVoices()).toEqual({ voices: [] });
      expect(await audioService.listVoices()).toEqual({ voices: [{ id: 'af_heart', name: 'af_heart' }] });
    });

    it('serves a stored list without asking an instance, as after a restart', async () => {
      const kokoro = speakingAs('kokoro', LISTING);

      storedLists.set(
        kokoro.deployment.id,
        new VoiceList({
          deploymentId: kokoro.deployment.id,
          configurationRevision: REVISION,
          voices: [{ id: 'af_heart', name: 'Heart' }],
        })
      );
      deploymentResolverService.findServing.mockResolvedValue([kokoro]);

      expect(await audioService.listVoices()).toEqual({ voices: [{ id: 'af_heart', name: 'Heart' }] });
      expect(relayProxyService.queryIfReady).not.toHaveBeenCalled();
    });

    it('stores the list against its deployment and the revision it was read on', async () => {
      const kokoro = speakingAs('kokoro', LISTING);

      deploymentResolverService.findServing.mockResolvedValue([kokoro]);
      relayProxyService.queryIfReady.mockResolvedValueOnce(answer({ voices: ['af_heart'] }));

      await audioService.listVoices();

      expect(rememberVoices).toHaveBeenCalledWith(kokoro.deployment.id, REVISION, [
        { id: 'af_heart', name: 'af_heart' },
      ]);
    });

    it('lists nothing for a disabled deployment, though its voices were remembered', async () => {
      const kokoro = speakingAs('kokoro', LISTING);

      deploymentResolverService.findServing.mockResolvedValue([kokoro]);
      relayProxyService.queryIfReady.mockResolvedValueOnce(answer({ voices: ['af_heart'] }));

      await audioService.listVoices();
      kokoro.deployment.enabled = false;

      expect(await audioService.listVoices()).toEqual({ voices: [] });
    });
  });
});
