import {
  Controller,
  Get,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { Permission } from '../../auth/enums/permission.enum';

import { AuditLogService } from './audit-log.service';

@ApiTags('Audit Logs')
@Controller('audit-logs')
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @RequirePermissions(Permission.ADMIN_ACCESS)
  @Get()
  @ApiOperation({ summary: 'Query audit logs (ADMIN only)' })
  @ApiQuery({ name: 'resourceType', required: true })
  @ApiQuery({ name: 'resourceId', required: true })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'offset', required: false })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        data: [
          {
            id: 'uuid',
            actorId: 'user-uuid',
            actorRole: 'admin',
            action: 'blood-unit.status-changed',
            resourceType: 'BloodUnit',
            resourceId: 'unit-uuid',
            previousValue: { status: 'AVAILABLE' },
            nextValue: { status: 'QUARANTINED' },
            ipAddress: '10.0.0.1',
            timestamp: '2026-01-01T00:00:00.000Z',
          },
        ],
        total: 1,
      },
    },
  })
  async findByResource(
    @Query('resourceType') resourceType: string,
    @Query('resourceId') resourceId: string,
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
  ) {
    return this.auditLogService.findByResource(resourceType, resourceId, limit, offset);
  }
}
