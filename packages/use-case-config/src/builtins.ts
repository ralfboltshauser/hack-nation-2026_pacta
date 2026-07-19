import contractorBids from "../../../config/use-cases/contractor-bids/0.1.0.json";
import freightBrokerage from "../../../config/use-cases/freight-brokerage/0.1.0.json";

import { useCaseConfigSchema } from "./schema";

const builtins = {
  contractor_bids: useCaseConfigSchema.parse(contractorBids),
  freight_brokerage: useCaseConfigSchema.parse(freightBrokerage),
} as const;

export type BuiltinUseCaseKey = keyof typeof builtins;

export function getBuiltinUseCase(key: BuiltinUseCaseKey) {
  return structuredClone(builtins[key]);
}

export function listBuiltinUseCases() {
  return Object.values(builtins).map((config) => ({
    key: config.key,
    version: config.version,
    terminology: config.terminology,
  }));
}
