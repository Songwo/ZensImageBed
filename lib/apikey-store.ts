import { getObjectText, putObjectText } from "@/lib/r2";

const STORE_KEY = ".imagebed/meta/apikeys.json";

export type ApiKey = {
  id: string;
  name: string;
  key: string;
  createdAt: string;
};

async function load(): Promise<ApiKey[]> {
  const text = await getObjectText(STORE_KEY);
  if (!text) return [];
  try {
    return JSON.parse(text) as ApiKey[];
  } catch {
    return [];
  }
}

async function save(keys: ApiKey[]) {
  await putObjectText(STORE_KEY, JSON.stringify(keys));
}

export async function listApiKeys(): Promise<ApiKey[]> {
  return load();
}

export async function createApiKey(name: string): Promise<ApiKey> {
  const keys = await load();
  const entry: ApiKey = {
    id: crypto.randomUUID(),
    name: name.trim(),
    key: `zib_${crypto.randomUUID().replace(/-/g, "")}`,
    createdAt: new Date().toISOString()
  };
  keys.push(entry);
  await save(keys);
  return entry;
}

export async function deleteApiKey(id: string): Promise<boolean> {
  const keys = await load();
  const next = keys.filter((k) => k.id !== id);
  if (next.length === keys.length) return false;
  await save(next);
  return true;
}

export async function verifyApiKey(key: string): Promise<boolean> {
  // 先检查静态环境变量
  const staticKey = process.env.API_KEY;
  if (staticKey && key === staticKey) return true;
  // 再检查动态存储的 Key
  const keys = await load();
  return keys.some((k) => k.key === key);
}
