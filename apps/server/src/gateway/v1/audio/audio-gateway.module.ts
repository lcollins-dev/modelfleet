import { Module } from '@nestjs/common';

import { AudioService } from './audio.service';

import { AudioController } from './audio.controller';

import { ProxyModule } from '../../proxy/proxy.module';
import { InferenceModule } from '@/core/inference/inference.module';
import { VoiceModule } from '@/core/voice/voice.module';

@Module({
  imports: [InferenceModule, ProxyModule, VoiceModule],
  providers: [AudioService],
  controllers: [AudioController],
})
export class AudioGatewayModule {}
