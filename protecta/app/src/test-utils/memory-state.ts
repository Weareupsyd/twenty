import { type StateStore } from 'src/lib/service-otp';
export class MemoryState implements StateStore {
  readonly values = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | null> {
    return (this.values.get(key) as T) ?? null;
  }
  async set<T>(key: string, value: T): Promise<void> {
    this.values.set(key, structuredClone(value));
  }
  async delete(key: string): Promise<boolean> {
    return this.values.delete(key);
  }
}
