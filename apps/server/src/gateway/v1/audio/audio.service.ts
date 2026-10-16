import { Injectable, Logger } from '@nestjs/common';
import { Request, Response } from 'express';

import { BackendOperation, IVoice, readVoices } from '@libs/backends';
import { SPEECH_STREAM_FORMAT_SSE, SpeechRequest } from '@libs/backends/openai';

import { ApiKey } from '@/core/api-key/entities/api-key.entity';
import { VoiceList } from '@/core/voice/entities/voice-list.entity';

import { InferenceRequestService, JSON_TYPE } from '../../proxy/inference-request.service';
import { MultipartUploadService } from '../../proxy/multipart-upload.service';
import { RelayProxyService } from '../../proxy/relay-proxy.service';
import { DeploymentResolverService, IResolvedDeployment } from '@/core/inference/deployment-resolver.service';
import { VoiceListService } from '@/core/voice/voice-list.service';

import { IAudioModelList, IVoiceList } from './audio-lists';

const RESPONSE_FORMAT_FIELD = 'response_format';
const STREAM_FIELD = 'stream';

/** What pydantic, which vLLM and OpenAI's own server parse a form with, reads as true. */
const TRUE_FORM_VALUES = new Set(['true', '1', 'yes', 'on', 't', 'y']);
const STREAM_FORMAT_PARAMETER = 'stream_format';

export type TranscriptionOperation = BackendOperation.TRANSCRIPTION | BackendOperation.TRANSLATION;

@Injectable()
export class AudioService {
  private readonly logger = new Logger(AudioService.name);

  constructor(
    private readonly deploymentResolverService: DeploymentResolverService,
    private readonly inferenceRequestService: InferenceRequestService,
    private readonly multipartUploadService: MultipartUploadService,
    private readonly relayProxyService: RelayProxyService,
    private readonly voiceListService: VoiceListService
  ) {}

  async transcribe(
    operation: TranscriptionOperation,
    request: Request,
    apiKey: ApiKey,
    response: Response
  ): Promise<void> {
    const upload = await this.multipartUploadService.read(request, response);
    const resolved = await this.inferenceRequestService.resolve(upload.model, operation);
    const streaming = TRUE_FORM_VALUES.has(upload.fields.get(STREAM_FIELD)?.toLowerCase() ?? '');

    this.inferenceRequestService.checkResponseFormat(resolved, upload.fields.get(RESPONSE_FORMAT_FIELD));
    this.inferenceRequestService.checkStreaming(resolved, streaming);

    await this.relayProxyService.proxy({
      resolved,
      apiKey,
      response,
      operation,
      upstreamBody: upload.body,
      contentType: upload.contentType,
      streaming,
      mapBody: operation === BackendOperation.TRANSCRIPTION ? resolved.mapping.transcription?.response : undefined,
    });
  }

  async speak(body: unknown, apiKey: ApiKey, response: Response): Promise<void> {
    const request = this.inferenceRequestService.parse(SpeechRequest, body);
    const resolved = await this.inferenceRequestService.resolve(request.model, BackendOperation.SPEECH);
    const streaming = request.stream_format === SPEECH_STREAM_FORMAT_SSE;
    const mapping = resolved.mapping.speech;

    this.inferenceRequestService.checkResponseFormat(resolved, request.response_format);
    this.inferenceRequestService.checkStreaming(resolved, streaming, STREAM_FORMAT_PARAMETER);

    await this.relayProxyService.proxy({
      resolved,
      apiKey,
      response,
      operation: BackendOperation.SPEECH,
      upstreamBody: this.inferenceRequestService.jsonBody(resolved, request, mapping?.request),
      contentType: JSON_TYPE,
      streaming,
    });
  }

  /** Open WebUI reads this shape. */
  async listModels(): Promise<IAudioModelList> {
    const serving = await this.deploymentResolverService.findServing(BackendOperation.SPEECH);

    return { models: serving.map(resolved => ({ id: resolved.deployment.name })) };
  }

  /** Open WebUI reads this shape. */
  async listVoices(): Promise<IVoiceList> {
    const speaking = await this.deploymentResolverService.findServing(BackendOperation.SPEECH);
    const serving = speaking.filter(
      resolved => resolved.deployment.enabled && resolved.capability.voices !== undefined
    );

    const remembered = await this.voiceListService.findFor(serving.map(resolved => resolved.deployment.id));
    const lists = await Promise.all(serving.map(resolved => this.voicesOf(resolved, remembered)));
    const voices = new Map<string, IVoice>();

    for (const voice of lists.flat()) {
      if (!voices.has(voice.id)) {
        voices.set(voice.id, voice);
      }
    }

    return { voices: [...voices.values()] };
  }

  private async voicesOf(resolved: IResolvedDeployment, remembered: Map<number, VoiceList>): Promise<IVoice[]> {
    const { deployment } = resolved;
    const listing = resolved.capability.voices;

    if (listing === undefined) {
      return [];
    }

    const stored = remembered.get(deployment.id);

    if (stored?.configurationRevision === deployment.configurationRevision) {
      return stored.voices;
    }

    const answer = await this.relayProxyService.queryIfReady(deployment, listing.path);

    if (answer === undefined) {
      return [];
    }

    const voices = readVoices(listing, answer.body);

    if (voices.length > 0 && answer.configurationRevision === deployment.configurationRevision) {
      await this.voiceListService
        .remember(deployment.id, answer.configurationRevision, voices)
        .catch((error: unknown) => {
          this.logger.warn({ error, deploymentId: deployment.id }, 'voicesOf(): Storing a voice list failed');
        });
    }

    return voices;
  }
}
