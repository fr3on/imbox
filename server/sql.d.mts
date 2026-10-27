export function mask(sql: string): { masked: string; kept: string[] };
export function unmask(masked: string, kept: string[]): string;
export function numberPlaceholders(sql: string): { text: string; params: number };
export function splitStatements(sql: string): string[];
