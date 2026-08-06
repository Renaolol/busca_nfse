import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import packageJson from '../../../package.json';
import { Public } from '../auth/decorators/public.decorator';

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @Public()
  health(): { status: string; timestamp: string; version: string } {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: packageJson.version
    };
  }
}
