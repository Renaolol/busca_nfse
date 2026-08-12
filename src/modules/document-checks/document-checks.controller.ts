import { Body, Controller, Get, Post, Put, Query, Req } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthenticatedRequest } from '../auth/auth.types';
import { DocumentCheckResponseDto } from './dto/document-check-response.dto';
import { ListDocumentChecksQueryDto } from './dto/list-document-checks-query.dto';
import { UpdateDocumentCheckDto } from './dto/update-document-check.dto';
import { DocumentChecksService } from './document-checks.service';

@ApiTags('conferencias-documentos')
@Controller('conferencias-documentos')
export class DocumentChecksController {
  constructor(private readonly documentChecksService: DocumentChecksService) {}

  @Get()
  @Roles('admin', 'comum', 'cliente')
  @ApiOkResponse({ type: DocumentCheckResponseDto, isArray: true })
  list(@Req() request: AuthenticatedRequest, @Query() query: ListDocumentChecksQueryDto) {
    return this.documentChecksService.listForUser(request.authUser!, query);
  }

  @Post('consulta')
  @Roles('admin', 'comum', 'cliente')
  @ApiOkResponse({ type: DocumentCheckResponseDto, isArray: true })
  listByBody(@Req() request: AuthenticatedRequest, @Body() dto: ListDocumentChecksQueryDto) {
    return this.documentChecksService.listForUser(request.authUser!, dto);
  }

  @Put()
  @Roles('admin', 'comum', 'cliente')
  @ApiOkResponse({ type: DocumentCheckResponseDto })
  update(@Req() request: AuthenticatedRequest, @Body() dto: UpdateDocumentCheckDto) {
    return this.documentChecksService.updateForUser(request.authUser!, dto);
  }
}
