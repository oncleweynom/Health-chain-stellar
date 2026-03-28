import {
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

import {
  QuarantineDisposition,
  QuarantineReasonCode,
  QuarantineReviewState,
  QuarantineTriggerSource,
} from '../enums/quarantine.enums';

export class CreateQuarantineCaseDto {
  @IsUUID('4')
  bloodUnitId: string;

  @IsEnum(QuarantineTriggerSource)
  triggerSource: QuarantineTriggerSource;

  @IsEnum(QuarantineReasonCode)
  reasonCode: QuarantineReasonCode;

  @IsString()
  @IsOptional()
  reason?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsString()
  @IsOptional()
  policyReference?: string;

  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;
}

export class AssignQuarantineReviewerDto {
  @IsString()
  @IsNotEmpty()
  reviewerAssignedTo: string;
}

export class UpdateQuarantineReviewDto {
  @IsEnum(QuarantineReviewState)
  reviewState: QuarantineReviewState;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class FinalizeQuarantineDto {
  @IsEnum(QuarantineDisposition)
  disposition: QuarantineDisposition;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsString()
  @IsOptional()
  policyReference?: string;
}

export class QueryQuarantineCasesDto {
  @IsOptional()
  @IsEnum(QuarantineReviewState)
  reviewState?: QuarantineReviewState;

  @IsOptional()
  @IsEnum(QuarantineTriggerSource)
  triggerSource?: QuarantineTriggerSource;

  @IsOptional()
  @IsEnum(QuarantineReasonCode)
  reasonCode?: QuarantineReasonCode;

  @IsOptional()
  @IsString()
  reviewerAssignedTo?: string;

  @IsOptional()
  @IsUUID('4')
  bloodUnitId?: string;

  @IsOptional()
  @IsString()
  active?: string;
}
