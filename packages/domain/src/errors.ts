import type { OperationResource } from '../../contracts/src/index.js';

export interface OperationConflictDetail {
  operationId: string;
  label: string;
  resources: OperationResource[];
}

export class OperationConflictError extends Error {
  readonly code = 'OPERATION_CONFLICT';
  readonly statusCode = 409;

  constructor(readonly conflicts: OperationConflictDetail[]) {
    super('The requested action conflicts with an active operation.');
    this.name = 'OperationConflictError';
  }
}

export class ValidationError extends Error {
  readonly code = 'VALIDATION_FAILED';
  readonly statusCode = 400;

  constructor(message: string, readonly correctiveAction?: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class AgentUnavailableError extends Error {
  readonly code = 'AGENT_UNAVAILABLE';
  readonly statusCode = 503;

  constructor(message = 'The privileged Winception Agent is unavailable.') {
    super(message);
    this.name = 'AgentUnavailableError';
  }
}
