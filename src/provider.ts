import type { AuthCheckOptions, AuthCheckResult } from "./auth.js";
import type { ResolvedConfig } from "./config.js";

type ProviderField = { name: string; value: string | null };

export interface Provider {
  readonly name: string;
  authCheck(config: ResolvedConfig, options?: AuthCheckOptions): Promise<AuthCheckResult>;
  configSlice(config: ResolvedConfig): ProviderField[];
}
