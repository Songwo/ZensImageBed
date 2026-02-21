import { getObjectText, putObjectText } from "@/lib/r2";

const ORDER_R2_KEY = process.env.ORDER_R2_KEY ?? ".imagebed/meta/order.json";

export type OrderGroup = "today" | "week" | "older";
export type GroupOrderPayload = Record<OrderGroup, string[]>;

type SavedOrder = {
  groups: GroupOrderPayload;
  updatedAt: string;
};

type LegacySavedOrder = {
  order: string[];
  updatedAt: string;
};

function createEmptyGroups(): GroupOrderPayload {
  return {
    today: [],
    week: [],
    older: []
  };
}

function normalizeOrder(order: string[]) {
  return Array.from(new Set(order.map((v) => v.trim()).filter(Boolean))).slice(0, 10000);
}

function normalizeGroups(groups?: Partial<GroupOrderPayload>): GroupOrderPayload {
  const empty = createEmptyGroups();
  return {
    today: normalizeOrder(groups?.today ?? empty.today),
    week: normalizeOrder(groups?.week ?? empty.week),
    older: normalizeOrder(groups?.older ?? empty.older)
  };
}

function toGroups(value: SavedOrder | LegacySavedOrder): GroupOrderPayload {
  if ("groups" in value) {
    return normalizeGroups(value.groups);
  }
  return {
    today: [],
    week: [],
    older: normalizeOrder(value.order)
  };
}

function kvConfig() {
  const accountId = process.env.CF_ACCOUNT_ID;
  const namespaceId = process.env.KV_ORDER_NAMESPACE_ID;
  const apiToken = process.env.CF_API_TOKEN;
  if (!accountId || !namespaceId || !apiToken) {
    return null;
  }
  return { accountId, namespaceId, apiToken };
}

function getBackend() {
  const preferred = (process.env.ORDER_STORAGE_BACKEND ?? "kv").toLowerCase();
  const kv = kvConfig();
  if (preferred === "kv" && kv) return "kv" as const;
  if (preferred === "r2") return "r2" as const;
  return kv ? ("kv" as const) : ("r2" as const);
}

async function getFromKv() {
  const kv = kvConfig();
  if (!kv) return null;
  const url = `https://api.cloudflare.com/client/v4/accounts/${kv.accountId}/storage/kv/namespaces/${kv.namespaceId}/values/image-order`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${kv.apiToken}`
    },
    cache: "no-store"
  });

  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`KV read failed (${res.status})`);
  }

  const text = await res.text();
  if (!text) return null;
  return JSON.parse(text) as SavedOrder | LegacySavedOrder;
}

async function putToKv(value: SavedOrder) {
  const kv = kvConfig();
  if (!kv) {
    throw new Error("KV config missing: CF_ACCOUNT_ID / KV_ORDER_NAMESPACE_ID / CF_API_TOKEN");
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${kv.accountId}/storage/kv/namespaces/${kv.namespaceId}/values/image-order`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${kv.apiToken}`,
      "Content-Type": "text/plain"
    },
    body: JSON.stringify(value)
  });

  if (!res.ok) {
    throw new Error(`KV write failed (${res.status})`);
  }
}

async function getFromR2() {
  const text = await getObjectText(ORDER_R2_KEY);
  if (!text) return null;
  return JSON.parse(text) as SavedOrder | LegacySavedOrder;
}

async function putToR2(value: SavedOrder) {
  await putObjectText(ORDER_R2_KEY, JSON.stringify(value));
}

export async function loadImageOrder() {
  const backend = getBackend();
  const saved = backend === "kv" ? await getFromKv() : await getFromR2();

  if (!saved) {
    return {
      groups: createEmptyGroups(),
      updatedAt: null,
      backend
    };
  }

  return {
    groups: toGroups(saved),
    updatedAt: saved.updatedAt,
    backend
  };
}

export async function saveImageOrderGroups(groups: Partial<GroupOrderPayload>) {
  const backend = getBackend();
  const payload: SavedOrder = {
    groups: normalizeGroups(groups),
    updatedAt: new Date().toISOString()
  };

  if (backend === "kv") {
    await putToKv(payload);
  } else {
    await putToR2(payload);
  }

  return {
    ...payload,
    backend
  };
}
