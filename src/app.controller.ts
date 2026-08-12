import { Controller, Get, Redirect } from '@nestjs/common';
import { Public } from './modules/auth/decorators/public.decorator';

@Controller()
export class AppController {
  @Get()
  @Public()
  @Redirect('/app/', 302)
  redirectRootToApp(): void {
    return;
  }
}
