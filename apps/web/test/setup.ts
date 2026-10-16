import { beforeEach, vi } from 'vitest';

// Node defines its own global localStorage getter, which shadows the jsdom one and reads
// back undefined unless the process was started with --localstorage-file.
const createStorage = (): Storage => {
  const entries = new Map<string, string>();

  return {
    get length() {
      return entries.size;
    },
    key: (index: number) => Array.from(entries.keys())[index] ?? null,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
    removeItem: (key: string) => {
      entries.delete(key);
    },
    clear: () => {
      entries.clear();
    },
  };
};

const storage = createStorage();

Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });

// jsdom lays nothing out, so it has no scrollIntoView.
Element.prototype.scrollIntoView = vi.fn();

beforeEach(() => {
  storage.clear();
});

vi.mock('@/services/LogService', () => ({
  useLogService: () => ({
    createLogger: () => ({
      fatal: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
    }),
  }),
}));
