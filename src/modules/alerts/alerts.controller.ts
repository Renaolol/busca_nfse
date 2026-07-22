import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AlertsService } from './alerts.service';
import { AlertResponseDto } from './dto/alert-response.dto';
import { QueryAlertsDto } from './dto/query-alerts.dto';
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

  @Put('cte-desacordo/:eventId/resolucao')
  @ApiOkResponse({ type: AlertResponseDto })
  updateCteDesacordoResolution(
    @Param('eventId') eventId: string,
    @Body() dto: UpdateCteDesacordoResolutionDto
  ) {
    return this.alertsService.updateCteDesacordoResolution(eventId, dto.resolvido);
  }
}
