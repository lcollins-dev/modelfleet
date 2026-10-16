import { Module } from '@nestjs/common';

import { DeviceReaderService } from './device-reader.service';
import { MfGpuService } from './mf-gpu.service';

@Module({
  providers: [DeviceReaderService, MfGpuService],
  exports: [DeviceReaderService],
})
export class DeviceReaderModule {}
