export function buildInfo(env?: Record<string, string | undefined>): { version: string; commit: string; builtAt: string };
export function buildDefines(env?: Record<string, string | undefined>): { __APP_VERSION__: string; __APP_COMMIT__: string; __APP_BUILT_AT__: string };
