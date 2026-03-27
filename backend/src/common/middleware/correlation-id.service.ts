import { Injectable, Scope } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { Inject } from '@nestjs/common';
import { Request } from 'express';

@Injectable({ scope: Scope.REQUEST })
export class CorrelationIdService {
  constructor(@Inject(REQUEST) private request: Request) {}

  getCorrelationId(): string {
    return this.request.correlationId || 'unknown';
  }
}
