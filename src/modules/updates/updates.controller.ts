import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiParam, ApiTags } from '@nestjs/swagger';
import { AuthenticatedRequest } from '../auth/auth.types';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateSystemUpdateDto } from './dto/create-system-update.dto';
import { DailyUpdateReportResponseDto } from './dto/daily-update-report-response.dto';
import { DownloadUpdateReportResponseDto } from './dto/download-update-report-response.dto';
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

  @Get('relatorios/:id/pdf')
  @Roles('admin', 'comum')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: DownloadUpdateReportResponseDto })
  downloadDailyReportPdf(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.updatesService.getDailyReportPdf(id);
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
