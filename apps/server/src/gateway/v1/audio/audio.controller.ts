import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';

import { BackendOperation } from '@libs/backends';

import { GetApiKey } from '../../auth/api-key.decorator';

import { ApiKey } from '@/core/api-key/entities/api-key.entity';

import { AudioService } from './audio.service';

import { GATEWAY_ROUTE_PREFIX } from '../../gateway-routes';
import { IAudioModelList, IVoiceList } from './audio-lists';

@Controller(`${GATEWAY_ROUTE_PREFIX}/audio`)
export class AudioController {
  constructor(private readonly audioService: AudioService) {}

  @Post('transcriptions')
  transcribe(@Req() request: Request, @GetApiKey() apiKey: ApiKey, @Res() response: Response): Promise<void> {
    return this.audioService.transcribe(BackendOperation.TRANSCRIPTION, request, apiKey, response);
  }

  @Post('translations')
  translate(@Req() request: Request, @GetApiKey() apiKey: ApiKey, @Res() response: Response): Promise<void> {
    return this.audioService.transcribe(BackendOperation.TRANSLATION, request, apiKey, response);
  }

  @Post('speech')
  speak(@Body() body: unknown, @GetApiKey() apiKey: ApiKey, @Res() response: Response): Promise<void> {
    return this.audioService.speak(body, apiKey, response);
  }

  @Get('models')
  listModels(): Promise<IAudioModelList> {
    return this.audioService.listModels();
  }

  @Get('voices')
  listVoices(): Promise<IVoiceList> {
    return this.audioService.listVoices();
  }
}
