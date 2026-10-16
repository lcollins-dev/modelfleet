import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UserRole } from './entities/user-role.entity';
import { UserUserRole } from './entities/user-user-role.entity';
import { User } from './entities/user.entity';

import { SetupCheckService } from './setup-check.service';
import { TokenService } from './token.service';
import { UserService } from './user.service';
import { ConfigService } from '@/config/config.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, UserRole, UserUserRole]),
    JwtModule.registerAsync({
      useFactory: (configService: ConfigService) => ({
        secret: configService.userTokenSecret,
        signOptions: {
          expiresIn: configService.userTokenExpiry,
          algorithm: 'HS256',
        },
        verifyOptions: {
          algorithms: ['HS256'],
        },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [SetupCheckService, TokenService, UserService],
  exports: [UserService],
})
export class UserModule {}
