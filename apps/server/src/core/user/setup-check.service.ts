import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { User } from './entities/user.entity';

@Injectable()
export class SetupCheckService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SetupCheckService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const pending = await this.userRepository.find({ where: { mustChangePassword: true } });

    for (const user of pending) {
      this.logger.warn(
        { email: user.email },
        'onApplicationBootstrap(): An account still has its initial password - sign in to the web app and set your own now'
      );
    }
  }
}
