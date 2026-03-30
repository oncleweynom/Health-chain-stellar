import { SetMetadata } from '@nestjs/common';

export const AUDITABLE_KEY = 'auditable';

export interface AuditableOptions {
  action: string;
  resourceType: string;
  /** Path to the resource ID in route params, defaults to 'id'. */
  resourceIdParam?: string;
}

/**
 * Mark a controller handler as auditable.
 * The AuditLogInterceptor will capture before/after state and write an audit row.
 *
 * @example
 * @Auditable({ action: 'blood-unit.status-changed', resourceType: 'BloodUnit' })
 * @Patch(':id/status')
 * updateStatus(...) {}
 */
export const Auditable = (options: AuditableOptions) =>
  SetMetadata(AUDITABLE_KEY, options);
