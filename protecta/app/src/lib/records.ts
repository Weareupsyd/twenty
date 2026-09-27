import { CoreApiClient } from 'twenty-client-sdk/core';
import { pluralOf } from 'src/lib/objects';

export type RecordData = Record<string, unknown>;

export type DbFilter = Record<string, { eq?: unknown } | unknown>;

/** Minimal record access used by Protecta services. */
export type DbClient = {
  findFirst: (
    objectPlural: string,
    filter: DbFilter,
    select: string[],
  ) => Promise<RecordData | null>;
  findMany: (
    objectPlural: string,
    args: { filter?: DbFilter; first?: number },
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

const selection = (select: string[]): Record<string, boolean> => {
  const node: Record<string, boolean> = { id: true };
  for (const field of select) {
    node[field] = true;
  }
  return node;
};

type GraphQlEdge = { node: RecordData };

export class CoreDbClient implements DbClient {
  private readonly client = new CoreApiClient();

  async findFirst(
    objectPlural: string,
    filter: DbFilter,
    select: string[],
  ): Promise<RecordData | null> {
    const rows = await this.findMany(objectPlural, { filter, first: 1 }, select);
    return rows[0] ?? null;
  }

  async findMany(
    objectPlural: string,
    args: { filter?: DbFilter; first?: number },
    select: string[],
  ): Promise<RecordData[]> {
    const result = (await this.client.query({
      [objectPlural]: {
        __args: { filter: args.filter ?? {}, first: args.first ?? 100 },
        edges: { node: selection(select) },
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
    return result[key];
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
    return result[key];
  }
}

/** In-memory DbClient for unit tests. */
export class MemoryDbClient implements DbClient {
  readonly store: Record<string, RecordData[]> = {};
  private seq = 1;

  async findFirst(
    objectPlural: string,
    filter: DbFilter,
    _select: string[],
  ): Promise<RecordData | null> {
    const rows = await this.findMany(objectPlural, { filter, first: 1 }, _select);
    return rows[0] ?? null;
  }

  async findMany(
    objectPlural: string,
    args: { filter?: DbFilter; first?: number },
    _select: string[],
  ): Promise<RecordData[]> {
    const rows = this.store[objectPlural] ?? [];
    const filter = args.filter ?? {};
    const matched = rows.filter((row) =>
      Object.entries(filter).every(([field, condition]) => {
        if (
          typeof condition === 'object' &&
          condition !== null &&
          'eq' in condition
        ) {
          return row[field] === (condition as { eq: unknown }).eq;
        }
        return row[field] === condition;
      }),
    );
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
