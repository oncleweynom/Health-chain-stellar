import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { AuditLogEntity } from './audit-log.entity';

export interface AuditLogParams {
  actorId: string;
  actorRole: string;
  action: string;
  resourceType: string;
  resourceId: string;
  previousValue?: Record<string, unknown> | null;
  nextValue?: Record<string, unknown> | null;
  ipAddress?: string | null;
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(
    @InjectRepository(AuditLogEntity)
    private readonly repo: Repository<AuditLogEntity>,
  ) {}

  /** Insert-only — no update or delete is ever called on this repository. */
  async insert(params: AuditLogParams): Promise<void> {
    try {
      await this.repo.insert({
        actorId: params.actorId,
        actorRole: params.actorRole,
        action: params.action,
        resourceType: params.resourceType,
        resourceId: params.resourceId,
        previousValue: params.previousValue ?? null,
        nextValue: params.nextValue ?? null,
        ipAddress: params.ipAddress ?? null,
      });
    } catch (err) {
      // Audit failures must never break the primary operation
      this.logger.error(
        `Failed to write audit log [${params.action}] for ${params.resourceType}/${params.resourceId}: ${(err as Error).message}`,
      );
    }
  }

  async findByResource(
    resourceType: string,
    resourceId: string,
    limit = 100,
    offset = 0,
  ): Promise<{ data: AuditLogEntity[]; total: number }> {
    const [data, total] = await this.repo.findAndCount({
      where: { resourceType, resourceId },
      order: { timestamp: 'DESC' },
      take: limit,
      skip: offset,
    });
    return { data, total };
  }
}
