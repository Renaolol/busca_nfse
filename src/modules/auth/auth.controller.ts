import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AccessRequestContext, AuthenticatedRequest } from './auth.types';
import { Roles } from './decorators/roles.decorator';
import { Public } from './decorators/public.decorator';
import { AuthService } from './auth.service';
import { AccessEventResponseDto } from './dto/access-event-response.dto';
import { AccessTimeReportResponseDto } from './dto/access-time-report-response.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { ListAccessEventsQueryDto } from './dto/list-access-events-query.dto';
import { ListAccessTimeReportQueryDto } from './dto/list-access-time-report-query.dto';
import { ListSessionsQueryDto } from './dto/list-sessions-query.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { LoginDto } from './dto/login.dto';
import { LoginResponseDto } from './dto/login-response.dto';
import { MeResponseDto } from './dto/me-response.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ResetUserPasswordDto } from './dto/reset-user-password.dto';
import { SessionResponseDto } from './dto/session-response.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserResponseDto } from './dto/user-response.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @ApiOkResponse({ type: LoginResponseDto })
  login(@Body() dto: LoginDto, @Req() request: AuthenticatedRequest): Promise<LoginResponseDto> {
    return this.authService.login(dto, this.toRequestContext(request));
  }

  @Public()
  @Post('refresh')
  @ApiOkResponse({ type: LoginResponseDto })
  refresh(@Body() dto: RefreshTokenDto, @Req() request: AuthenticatedRequest): Promise<LoginResponseDto> {
    return this.authService.refresh(dto, this.toRequestContext(request));
  }

  @Post('logout')
  @HttpCode(204)
  @ApiNoContentResponse()
  async logout(@Req() request: AuthenticatedRequest): Promise<void> {
    if (!request.authUser) {
      return;
    }

    await this.authService.logout(request.authUser, this.toRequestContext(request));
  }

  @Get('me')
  @ApiOkResponse({ type: MeResponseDto })
  me(@Req() request: AuthenticatedRequest): Promise<MeResponseDto> {
    return this.authService.me(request.authUser!);
  }

  @Get('usuarios')
  @Roles('admin')
  @ApiOkResponse({ type: UserResponseDto, isArray: true })
  listUsers(@Query() query: ListUsersQueryDto): Promise<UserResponseDto[]> {
    return this.authService.listUsers(query);
  }

  @Post('usuarios')
  @Roles('admin')
  @ApiOkResponse({ type: UserResponseDto })
  createUser(@Body() dto: CreateUserDto): Promise<UserResponseDto> {
    return this.authService.createUser(dto);
  }

  @Patch('usuarios/:id')
  @Roles('admin')
  @ApiOkResponse({ type: UserResponseDto })
  updateUser(@Param('id') id: string, @Body() dto: UpdateUserDto): Promise<UserResponseDto> {
    return this.authService.updateUser(id, dto);
  }

  @Post('usuarios/:id/reset-password')
  @Roles('admin')
  @ApiOkResponse({ type: UserResponseDto })
  resetPassword(@Param('id') id: string, @Body() dto: ResetUserPasswordDto): Promise<UserResponseDto> {
    return this.authService.resetPassword(id, dto);
  }

  @Get('sessoes')
  @Roles('admin')
  @ApiOkResponse({ type: SessionResponseDto, isArray: true })
  listSessions(@Query() query: ListSessionsQueryDto): Promise<SessionResponseDto[]> {
    return this.authService.listSessions(query);
  }

  @Get('eventos-acesso')
  @Roles('admin')
  @ApiOkResponse({ type: AccessEventResponseDto, isArray: true })
  listAccessEvents(@Query() query: ListAccessEventsQueryDto): Promise<AccessEventResponseDto[]> {
    return this.authService.listAccessEvents(query);
  }

  @Get('relatorio-tempo-acesso')
  @Roles('admin')
  @ApiOkResponse({ type: AccessTimeReportResponseDto, isArray: true })
  listAccessTimeReport(@Query() query: ListAccessTimeReportQueryDto): Promise<AccessTimeReportResponseDto[]> {
    return this.authService.listAccessTimeReport(query);
  }

  private toRequestContext(request: AuthenticatedRequest): AccessRequestContext {
    const userAgentHeader = request.headers?.['user-agent'];
    return {
      ip: request.ip,
      userAgent: Array.isArray(userAgentHeader) ? userAgentHeader[0] : userAgentHeader,
      path: this.resolveRoutePath(request),
      method: request.method
    };
  }

  private resolveRoutePath(request: AuthenticatedRequest): string {
    const base = request.baseUrl ?? '';
    const path = request.route?.path ?? '';
    if (base || path) {
      return `${base}${path || ''}`;
    }

    const originalUrl = request.originalUrl ?? '';
    return originalUrl.split('?')[0] || '/';
  }
}
