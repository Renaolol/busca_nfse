import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthBootstrapService } from './auth-bootstrap.service';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { PasswordHashService } from './password-hash.service';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordHashService,
    AuthBootstrapService,
    {
      provide: APP_GUARD,
      useClass: AuthGuard
    }
  ],
  exports: [AuthService]
})
export class AuthModule {}
