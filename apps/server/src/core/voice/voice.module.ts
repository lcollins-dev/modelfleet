import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { VoiceList } from './entities/voice-list.entity';

import { VoiceListService } from './voice-list.service';

@Module({
  imports: [TypeOrmModule.forFeature([VoiceList])],
  providers: [VoiceListService],
  exports: [VoiceListService],
})
export class VoiceModule {}
