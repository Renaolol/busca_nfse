import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AlertsService } from './alerts.service';
import { AlertResponseDto } from './dto/alert-response.dto';
import { AlertResolutionResponseDto } from './dto/alert-resolution-response.dto';
import { QueryAlertsDto } from './dto/query-alerts.dto';
import { UpdateAlertResolutionDto } from './dto/update-alert-resolution.dto';
import { UpdateCteDesacordoResolutionDto } from './dto/update-cte-desacordo-resolution.dto';

@ApiTags('alertas')
@Controller('alertas')
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Get()
  @ApiOkResponse({ type: AlertResponseDto, isArray: true })
  findAll(@Query() query: QueryAlertsDto) {
    return this.alertsService.findAll(query);
  }

  @Get('resolucoes')
  @ApiOkResponse({ type: AlertResolutionResponseDto, isArray: true })
  listResolutions(@Query() query: QueryAlertsDto) {
    return this.alertsService.listResolutions(query);
  }

  @Put('cte-desacordo/:eventId/resolucao')
  @ApiOkResponse({ type: AlertResponseDto })
  updateCteDesacordoResolution(
    @Param('eventId') eventId: string,
    @Body() dto: UpdateCteDesacordoResolutionDto
  ) {
    return this.alertsService.updateCteDesacordoResolution(eventId, dto.resolvido);
  }

  @Put('resolucoes/:alertId')
  @ApiOkResponse({ type: AlertResolutionResponseDto })
  updateResolution(@Param('alertId') alertId: string, @Body() dto: UpdateAlertResolutionDto) {
    return this.alertsService.updateResolution(alertId, dto);
  }
}
