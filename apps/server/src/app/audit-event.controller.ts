import {Controller, Get, HttpService, Param, Query, Req, UseGuards} from '@nestjs/common';
import {BaseFhirController} from './base-fhir.controller';
import {ITofRequest} from './models/tof-request';
import {AuthGuard} from '@nestjs/passport';
import {ApiOAuth2Auth, ApiUseTags} from '@nestjs/swagger';
import {FhirServerBase, User} from './server.decorators';
import {ConfigService} from './config.service';

@Controller('api/auditEvent')
@UseGuards(AuthGuard('bearer'))
@ApiUseTags('Audit')
@ApiOAuth2Auth()
export class AuditEventController extends BaseFhirController {
  resourceType = 'AuditEvent';

  constructor(protected httpService: HttpService, protected configService: ConfigService) {
    super(httpService, configService);
  }

  @Get()
  public search(@User() user, @FhirServerBase() fhirServerBase, @Query() query?: any): Promise<any> {
    return super.baseSearch(user, fhirServerBase, query);
  }

  @Get(':id')
  public get(@FhirServerBase() fhirServerBase, @Query() query, @User() user, @Param('id') id: string) {
    return super.baseGet(fhirServerBase, id, query, user);
  }
}
