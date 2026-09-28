import { CoreApiClient } from 'twenty-client-sdk/core';

export type RecordData = Record<string, unknown>;

export type DbFilter = Record<string, { eq?: unknown } | unknown>;

/** Minimal record access used by the Document Generator. */
export type DbClient = {
  findFirst: (
    objectPlural: string,
    filter: DbFilter,
    select: string[],
  ) => Promise<RecordData | null>;
  findMany: (
    objectPlural: string,
    args: {
      filter?: DbFilter;
      first?: number;
      orderBy?: Record<string, string>[];
    },
    select: string[],
  ) => Promise<RecordData[]>;
  create: (objectSingular: string, data: RecordData) => Promise<RecordData>;
  update: (
    objectSingular: string,
    id: string,
    data: RecordData,
  ) => Promise<RecordData>;
};

const capitalize = (value: string): string =>
  value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);

const selection = (
  select: string[],
  objectPlural: string,
): Record<string, boolean | Record<string, boolean>> => {
  const node: Record<string, boolean | Record<string, boolean>> = { id: true };
  for (const field of select) {
    node[field] =
      objectPlural === 'people' && field === 'name'
        ? { firstName: true, lastName: true }
        : true;
  }
  return node;
};

type GraphQlEdge = { node: RecordData };

export class CoreDbClient implements DbClient {
  private readonly client: CoreApiClient;

  constructor(options: { runAs?: 'user' | 'application' } = {}) {
    this.client = new CoreApiClient(options);
  }

  async findFirst(
    objectPlural: string,
    filter: DbFilter,
    select: string[],
  ): Promise<RecordData | null> {
    const rows = await this.findMany(
      objectPlural,
      { filter, first: 1 },
      select,
    );
    return rows[0] ?? null;
  }

  async findMany(
    objectPlural: string,
    args: {
      filter?: DbFilter;
      first?: number;
      orderBy?: Record<string, string>[];
    },
    select: string[],
  ): Promise<RecordData[]> {
    const result = (await this.client.query({
      [objectPlural]: {
        __args: {
          filter: args.filter ?? {},
          first: args.first ?? 100,
          ...(args.orderBy ? { orderBy: args.orderBy } : {}),
        },
        edges: { node: selection(select, objectPlural) },
      },
    })) as Record<string, { edges?: GraphQlEdge[] }>;
    return (result[objectPlural]?.edges ?? []).map((edge) => edge.node);
  }

  async create(objectSingular: string, data: RecordData): Promise<RecordData> {
    const key = `create${capitalize(objectSingular)}`;
    const result = (await this.client.mutation({
      [key]: {
        __args: { data },
        id: true,
      },
    })) as Record<string, RecordData>;
    if (!result[key]?.id)
      throw new Error(`Record mutation ${key} returned no record.`);
    return { ...data, ...result[key] };
  }

  async update(
    objectSingular: string,
    id: string,
    data: RecordData,
  ): Promise<RecordData> {
    const key = `update${capitalize(objectSingular)}`;
    const result = (await this.client.mutation({
      [key]: {
        __args: { id, data },
        id: true,
      },
    })) as Record<string, RecordData>;
    if (!result[key]?.id)
      throw new Error(`Record mutation ${key} returned no record.`);
    return { ...data, ...result[key] };
  }
}

/** In-memory DbClient for unit tests. */
const pluralOf = (objectSingular: string): string => {
  if (objectSingular === 'person') return 'people';
  return objectSingular.endsWith('y')
    ? `${objectSingular.slice(0, -1)}ies`
    : `${objectSingular}s`;
};

export class MemoryDbClient implements DbClient {
  readonly store: Record<string, RecordData[]> = {};
  private seq = 1;

  async findFirst(
    objectPlural: string,
    filter: DbFilter,
    _select: string[],
  ): Promise<RecordData | null> {
    const rows = await this.findMany(
      objectPlural,
      { filter, first: 1 },
      _select,
    );
    return rows[0] ?? null;
  }

  async findMany(
    objectPlural: string,
    args: {
      filter?: DbFilter;
      first?: number;
      orderBy?: Record<string, string>[];
    },
    _select: string[],
  ): Promise<RecordData[]> {
    const rows = this.store[objectPlural] ?? [];
    const filter = args.filter ?? {};
    const matches = (row: RecordData, query: DbFilter): boolean =>
      Object.entries(query).every(([field, condition]) => {
        if (typeof condition === 'object' && condition !== null) {
          const comparison = condition as Record<string, unknown>;
          if ('eq' in comparison) return row[field] === comparison.eq;
        }
        return row[field] === condition;
      });
    const matched = rows.filter((row) => matches(row, filter));
    return matched.slice(0, args.first ?? 100);
  }

  async create(objectSingular: string, data: RecordData): Promise<RecordData> {
    const plural = pluralOf(objectSingular);
    const row = { ...data, id: `test-${this.seq++}` };
    this.store[plural] = [...(this.store[plural] ?? []), row];
    return row;
  }

  async update(
    objectSingular: string,
    id: string,
    data: RecordData,
  ): Promise<RecordData> {
    const plural = pluralOf(objectSingular);
    const rows = this.store[plural] ?? [];
    const index = rows.findIndex((row) => row.id === id);
    if (index === -1) {
      throw new Error(`Record ${id} not found in ${plural}`);
    }
    const updated = { ...rows[index], ...data };
    rows[index] = updated;
    return updated;
  }
}
