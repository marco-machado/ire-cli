import { ConfigValidationError } from "./config.js";
import {
  IreAmbiguousError,
  IreAuthenticationError,
  IreConfigurationError,
  IreNetworkError,
  IreNormalizedOutputError,
  IreNotFoundError,
  IreProviderError,
} from "./errors.js";

export type SuccessEnvelope = {
  success: true;
  schemaVersion: "1.0";
  data: unknown;
  meta: Record<string, unknown>;
};

export type ErrorEnvelope = {
  success: false;
  schemaVersion: "1.0";
  data?: unknown;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta: Record<string, unknown>;
};

export function writeEnvelope(envelope: SuccessEnvelope | ErrorEnvelope): void {
  process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
}

type CodedError = { code: string; message: string; details?: unknown };

function errEnvelope(error: CodedError, meta: Record<string, unknown>): ErrorEnvelope["error"] {
  return error.details !== undefined
    ? { code: error.code, message: error.message, details: error.details }
    : { code: error.code, message: error.message };
}

export function handleProviderError(error: unknown, meta: Record<string, unknown>): boolean {
  if (error instanceof ConfigValidationError || error instanceof IreConfigurationError) {
    writeEnvelope({
      success: false,
      schemaVersion: "1.0",
      error: errEnvelope(error as unknown as CodedError, meta),
      meta,
    });
    process.exitCode = 2;
    return true;
  }

  if (error instanceof IreAmbiguousError) {
    writeEnvelope({
      success: false,
      schemaVersion: "1.0",
      error: errEnvelope(error as unknown as CodedError, meta),
      meta,
    });
    process.exitCode = 7;
    return true;
  }

  if (error instanceof IreAuthenticationError) {
    writeEnvelope({
      success: false,
      schemaVersion: "1.0",
      error: errEnvelope(error as unknown as CodedError, meta),
      meta,
    });
    process.exitCode = 3;
    return true;
  }

  if (error instanceof IreNotFoundError) {
    writeEnvelope({
      success: false,
      schemaVersion: "1.0",
      error: errEnvelope(error as unknown as CodedError, meta),
      meta,
    });
    process.exitCode = 4;
    return true;
  }

  if (error instanceof IreProviderError) {
    writeEnvelope({
      success: false,
      schemaVersion: "1.0",
      error: errEnvelope(error as unknown as CodedError, meta),
      meta,
    });
    process.exitCode = 5;
    return true;
  }

  if (error instanceof IreNetworkError) {
    writeEnvelope({
      success: false,
      schemaVersion: "1.0",
      error: errEnvelope(error as unknown as CodedError, meta),
      meta,
    });
    process.exitCode = 6;
    return true;
  }

  if (error instanceof IreNormalizedOutputError) {
    writeEnvelope({
      success: false,
      schemaVersion: "1.0",
      error: errEnvelope(error as unknown as CodedError, meta),
      meta,
    });
    process.exitCode = 1;
    return true;
  }

  return false;
}
