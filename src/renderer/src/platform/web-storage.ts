/**
 * Web 端键值存储：内存镜像 + IndexedDB 持久化（AN-006）。
 *
 * localStorage 只有约 5MB 配额，长篇的正文、不可变版本、候选稿、生成
 * 事件和规划原始响应会把配额写爆并导致静默丢数据。这里保持与原
 * localStorage 适配相同的同步 read/write 接口（调用点零改动），数据
 * 落 IndexedDB；启动时把旧版 localStorage 数据一次性迁入并清理原键。
 *
 * 顺序约定：UI 首次读取前必须等待 `initWebStorage()`（平台端口的
 * `ready()`）；写入立即进内存镜像，持久化为写穿队列，崩溃窗口只有
 * 毫秒级未提交事务。
 */

const DB_NAME = "amy-novel";
const DB_VERSION = 1;
const STORE = "kv";
const KEY_PREFIX = "amy-novel:";
/** 迁移标记不使用数据前缀，避免被当成待迁移数据反复导入。 */
const MIGRATION_MARKER = "amy-novel-storage:migrated";

const memory = new Map<string, string>();
let readyPromise: Promise<void> | null = null;
let dbPromise: Promise<IDBDatabase> | null = null;
let pending: Promise<void> = Promise.resolve();

function warn(message: string, key: string, error: unknown): void {
  console.warn(
    `[web-storage] ${message}（key=${key}）`,
    error instanceof Error ? error.message : error,
  );
}

function openDatabase(): Promise<IDBDatabase> {
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  return new Promise((resolve, reject) => {
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB 打开失败"));
    request.onblocked = () =>
      reject(new Error("IndexedDB 被其他标签页阻塞"));
  });
}

function ensureDatabase(): Promise<IDBDatabase> {
  dbPromise ??= openDatabase();
  return dbPromise;
}

function requestAsPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB 请求失败"));
  });
}

async function putEntry(key: string, value: string): Promise<void> {
  const db = await ensureDatabase(),
    tx = db.transaction(STORE, "readwrite");
  await requestAsPromise(tx.objectStore(STORE).put(value, key));
}

async function deleteEntry(key: string): Promise<void> {
  const db = await ensureDatabase(),
    tx = db.transaction(STORE, "readwrite");
  await requestAsPromise(tx.objectStore(STORE).delete(key));
}

/** 写穿队列：同步更新内存镜像，持久化按提交顺序排队执行。 */
function enqueue(label: string, operation: () => Promise<void>): void {
  pending = pending
    .then(operation)
    .catch((error) => warn("持久化失败", label, error));
}

export function read<T>(key: string, fallback: T): T {
  try {
    const value = memory.get(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function write<T>(key: string, value: T): void {
  const raw = JSON.stringify(value);
  memory.set(key, raw);
  enqueue(key, () => putEntry(key, raw));
}

export function remove(key: string): void {
  memory.delete(key);
  enqueue(key, () => deleteEntry(key));
}

/** 返回内存镜像中匹配前缀的全部键，替代原 localStorage 键扫描。 */
export function keysWithPrefix(prefix: string): string[] {
  return [...memory.keys()].filter((key) => key.startsWith(prefix));
}

/** 旧数据一次性迁移：localStorage 有而 IndexedDB 没有的键导入后清源。 */
async function migrateLegacyKeys(): Promise<void> {
  if (localStorage.getItem(MIGRATION_MARKER) !== null) return;
  const legacy: Array<[string, string]> = [];
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (key && key.startsWith(KEY_PREFIX))
      legacy.push([key, localStorage.getItem(key) ?? ""]);
  }
  if (!legacy.length) {
    localStorage.setItem(MIGRATION_MARKER, "1");
    return;
  }
  try {
    // 只迁移 IndexedDB 尚无的键：迁移中断后重跑不会用旧值覆盖新数据。
    for (const [key, value] of legacy)
      if (!memory.has(key)) {
        memory.set(key, value);
        await putEntry(key, value);
      }
    for (const [key] of legacy) localStorage.removeItem(key);
    localStorage.setItem(MIGRATION_MARKER, "1");
  } catch (error) {
    warn("旧数据迁移失败，将在下次启动重试", KEY_PREFIX, error);
  }
}

/**
 * 启动装载：IndexedDB 现有数据进入内存镜像（只补缺失键，避免覆盖
 * 早于就绪完成的写入），然后执行一次旧 localStorage 迁移。重复调用
 * 返回同一 Promise。
 */
export function initWebStorage(): Promise<void> {
  readyPromise ??= (async () => {
    try {
      const db = await ensureDatabase(),
        tx = db.transaction(STORE, "readonly"),
        store = tx.objectStore(STORE),
        keys = (await requestAsPromise(store.getAllKeys())) as string[],
        values = (await requestAsPromise(store.getAll())) as string[];
      keys.forEach((key, index) => {
        if (!memory.has(key)) memory.set(key, values[index]);
      });
    } catch (error) {
      warn("IndexedDB 装载失败", DB_NAME, error);
    }
    await migrateLegacyKeys();
  })();
  return readyPromise;
}

/** 等待全部排队中的持久化操作完成（测试与关页前兜底用）。 */
export function flushWebStorage(): Promise<void> {
  return pending;
}

/** 仅测试使用：模拟页面重载，清空内存镜像、就绪状态与迁移标记后重新装载。 */
export async function resetWebStorageForTests(): Promise<void> {
  await pending.catch(() => {});
  memory.clear();
  readyPromise = null;
  localStorage.removeItem(MIGRATION_MARKER);
}
