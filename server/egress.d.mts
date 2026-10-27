export function isPrivateAddress(address: string): boolean;
export function guardedLookup(host: string, options: object, callback: (err: any, address?: any, family?: number) => void): void;
export function installEgressGuard(env?: Record<string, string | undefined>): boolean;
