export enum ExecutionErrorCode {
  SIMULATION_FAILED = "simulation_failed",
  TRANSACTION_EXPIRED = "transaction_expired",
  INSUFFICIENT_FUNDS = "insufficient_funds",
  SLIPPAGE_EXCEEDED = "slippage_exceeded",
  POOL_NOT_FOUND = "pool_not_found",
  POSITION_NOT_FOUND = "position_not_found",
  ATA_NOT_FOUND = "ata_not_found",
  JUPITER_API = "jupiter_api",
  PROTOCOL_NOT_SUPPORTED = "protocol_not_supported",
  RETRY_EXHAUSTED = "retry_exhausted",
  WALLET_NOT_CONNECTED = "wallet_not_connected",
  INVALID_TICK_RANGE = "invalid_tick_range",
  MATH_OVERFLOW = "math_overflow",
  UNKNOWN = "unknown",
}

export class ExecutionError extends Error {
  constructor(
    public readonly code: ExecutionErrorCode,
    message: string,
    public readonly cause?: Error,
    public readonly logs: string[] = [],
  ) {
    super(message);
    this.name = 'ExecutionError';
  }

  override toString() {
    return `ExecutionError(code=${this.code}, message=${this.message})`;
  }
}

export function simulation_failed(logs: string[], cause?: Error) {
  return new ExecutionError(ExecutionErrorCode.SIMULATION_FAILED, 'Transaction simulation failed', cause, logs);
}

export function slippage_exceeded(expected: number, got: number) {
  return new ExecutionError(
    ExecutionErrorCode.SLIPPAGE_EXCEEDED,
    `Slippage exceeded: expected>=${expected}, got=${got}`,
  );
}

export function pool_not_found(poolId: string) {
  return new ExecutionError(ExecutionErrorCode.POOL_NOT_FOUND, `Pool not found: ${poolId}`);
}

export function position_not_found(positionId: string) {
  return new ExecutionError(ExecutionErrorCode.POSITION_NOT_FOUND, `Position not found: ${positionId}`);
}

export function protocol_not_supported(protocol: string) {
  return new ExecutionError(ExecutionErrorCode.PROTOCOL_NOT_SUPPORTED, `Protocol not supported: ${protocol}`);
}

export function retry_exhausted(attempts: number, last?: Error) {
  return new ExecutionError(
    ExecutionErrorCode.RETRY_EXHAUSTED,
    `Retry exhausted after ${attempts} attempts`,
    last,
  );
}

export function invalid_tick_range(lower: number, upper: number, spacing: number) {
  return new ExecutionError(
    ExecutionErrorCode.INVALID_TICK_RANGE,
    `Invalid tick range [${lower},${upper}] for spacing=${spacing}`,
  );
}
