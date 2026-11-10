import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AuthenticatedRequest } from '../auth/auth.types';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateSystemUpdateDto } from './dto/create-system-update.dto';
import { DailyUpdateReportResponseDto } from './dto/daily-update-report-response.dto';
import { SystemUpdateResponseDto } from './dto/system-update-response.dto';
import { UpdatesService } from './updates.service';

@ApiTags('atualizacoes')
@Controller('atualizacoes')
export class UpdatesController {
  constructor(private readonly updatesService: UpdatesService) {}

  @Get('relatorios')
  @ApiOkResponse({ type: DailyUpdateReportResponseDto, isArray: true })
  listDailyReports() {
    return this.updatesService.listDailyReports();
  }

  @Get('registros')
  @Roles('admin')
  @ApiOkResponse({ type: SystemUpdateResponseDto, isArray: true })
  listSystemUpdates() {
    return this.updatesService.listSystemUpdates();
  }

  @Post('registros')
  @Roles('admin')
  @ApiCreatedResponse({ type: SystemUpdateResponseDto })
  createSystemUpdate(@Body() dto: CreateSystemUpdateDto, @Req() request: AuthenticatedRequest) {
    return this.updatesService.createSystemUpdate(dto, request.authUser!);
  }
}
