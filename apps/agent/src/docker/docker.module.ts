import { Module } from '@nestjs/common';

import { ContainerLookupService } from './container-lookup.service';
import { ContainerService } from './container.service';
import { DockerSocketService } from './docker-socket.service';
import { dockerClientProvider } from './docker.client';

@Module({
  providers: [dockerClientProvider, DockerSocketService, ContainerService, ContainerLookupService],
  exports: [ContainerService, ContainerLookupService],
})
export class DockerModule {}
