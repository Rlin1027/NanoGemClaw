export interface PaginationParams {
  limit: number;
  offset: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

export function parsePagination(
  query: Record<string, any>,
  defaults: { limit?: number; maxLimit?: number } = {},
): PaginationParams {
  const defaultLimit = defaults.limit ?? 50;
  const maxLimit = defaults.maxLimit ?? 200;
  const limit = Math.min(
    Math.max(1, parseInt(query.limit as string) || defaultLimit),
    maxLimit,
  );
  const offset = Math.max(0, parseInt(query.offset as string) || 0);
  return { limit, offset };
}
