import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { IVoice } from '@libs/backends';

import { VoiceList } from './entities/voice-list.entity';

@Injectable()
export class VoiceListService {
  constructor(@InjectRepository(VoiceList) private readonly voiceListRepository: Repository<VoiceList>) {}

  async findFor(deploymentIds: number[]): Promise<Map<number, VoiceList>> {
    if (deploymentIds.length === 0) {
      return new Map();
    }

    const lists = await this.voiceListRepository.findBy({ deploymentId: In(deploymentIds) });

    return new Map(lists.map(list => [list.deploymentId, list]));
  }

  async remember(deploymentId: number, configurationRevision: string, voices: IVoice[]): Promise<void> {
    await this.voiceListRepository.upsert(new VoiceList({ deploymentId, configurationRevision, voices }), [
      'deploymentId',
    ]);
  }
}
