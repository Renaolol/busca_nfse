import { Controller, Get, Redirect } from '@nestjs/common';

@Controller()
export class AppController {
  @Get()
  @Redirect('/app', 302)
  redirectRootToApp(): void {
    return;
  }
}
