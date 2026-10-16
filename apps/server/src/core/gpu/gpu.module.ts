import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Gpu } from './entities/gpu.entity';

import { GpuService } from './gpu.service';

import { AgentModule } from '../agent/agent.module';

import { GpuGateway } from './gpu.gateway';

@Module({
  imports: [TypeOrmModule.forFeature([Gpu]), AgentModule],
  providers: [GpuGateway, GpuService],
  exports: [GpuService],
})
export class GpuModule {}
