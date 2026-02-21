import { AwsClient } from "aws4fetch";
import { normalizePublicDomain } from "@/lib/utils";

export type ListedImage = {
  key: string;
  url: string;
  filename: string;
  size: number;
  uploadedAt: string;
  tags: string[];
  folder: string | null;
  exif: string | null;
};

function required(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

function getConfig() {
  const accountId = required("R2_ACCOUNT_ID");
  return {
    accountId,
    bucketName: required("R2_BUCKET_NAME"),
    publicDomain: normalizePublicDomain(required("R2_PUBLIC_DOMAIN")),
    accessKeyId: required("R2_ACCESS_KEY_ID"),
    secretAccessKey: required("R2_SECRET_ACCESS_KEY")
  };
}

let awsClient: AwsClient | null = null;
function getAwsClient() {
  if (awsClient) return awsClient;
  const cfg = getConfig();
  awsClient = new AwsClient({
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    service: "s3",
    region: "auto"
  });
  return awsClient;
}

function endpointBase() {
  const cfg = getConfig();
  return `https://${cfg.accountId}.r2.cloudflarestorage.com/${cfg.bucketName}`;
}

function encodeKey(key: string) {
  return key
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function pickTag(xml: string, tag: string) {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m?.[1] ? decodeXml(m[1]) : null;
}

function parseFolder(key: string) {
  const chunks = key.split("/");
  if (chunks.length <= 2) return null;
  return chunks[1] ?? null;
}

function parseFilename(key: string) {
  const chunks = key.split("/");
  return chunks[chunks.length - 1] ?? key;
}

function decodeMetadataValue(value: string | undefined) {
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function encodeMetadataValue(value: string) {
  return encodeURIComponent(value);
}

async function signedFetch(input: string, init?: RequestInit) {
  return getAwsClient().fetch(input, init);
}

export async function createPresignedPutUrl(input: {
  key: string;
  contentType: string;
  tags: string[];
  folder?: string;
  exif?: string;
  originalName: string;
}) {
  const cfg = getConfig();
  const keyPath = encodeKey(input.key);
  const unsignedUrl = `${endpointBase()}/${keyPath}`;

  const headers: Record<string, string> = {
    "content-type": input.contentType || "application/octet-stream",
    "x-amz-meta-tags": encodeMetadataValue(input.tags.join(",")),
    "x-amz-meta-folder": encodeMetadataValue(input.folder ?? ""),
    "x-amz-meta-exif": encodeMetadataValue(input.exif ?? ""),
    "x-amz-meta-originalname": encodeMetadataValue(input.originalName)
  };

  const signedReq = await getAwsClient().sign(unsignedUrl, {
    method: "PUT",
    headers,
    aws: { signQuery: true, allHeaders: true }
  });

  return {
    signedUrl: signedReq.url,
    signedHeaders: headers,
    publicUrl: `${cfg.publicDomain}/${input.key}`
  };
}

export async function listImages(input: {
  cursor?: string;
  limit: number;
  search?: string;
  tag?: string;
}) {
  const cfg = getConfig();
  const query = new URLSearchParams({
    "list-type": "2",
    "max-keys": String(input.limit)
  });
  if (input.cursor) query.set("continuation-token", input.cursor);

  const listRes = await signedFetch(`${endpointBase()}?${query.toString()}`, { method: "GET" });
  if (!listRes.ok) {
    throw new Error(`R2 list failed (${listRes.status})`);
  }

  const xml = await listRes.text();
  const contents = Array.from(xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g));

  const enriched = await Promise.all(
    contents.map(async (match) => {
      const block = match[1] ?? "";
      const key = pickTag(block, "Key") ?? "";
      const size = Number(pickTag(block, "Size") ?? 0);
      const uploadedAt = pickTag(block, "LastModified") ?? new Date().toISOString();

      const headRes = await signedFetch(`${endpointBase()}/${encodeKey(key)}`, { method: "HEAD" });
      const metadata = headRes.ok
        ? {
            tags: headRes.headers.get("x-amz-meta-tags") ?? "",
            folder: headRes.headers.get("x-amz-meta-folder") ?? "",
            exif: headRes.headers.get("x-amz-meta-exif") ?? "",
            originalname: headRes.headers.get("x-amz-meta-originalname") ?? ""
          }
        : { tags: "", folder: "", exif: "", originalname: "" };

      const filename = decodeMetadataValue(metadata.originalname) || parseFilename(key);
      const tags = decodeMetadataValue(metadata.tags)
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);

      return {
        key,
        url: `${cfg.publicDomain}/${key}`,
        filename,
        size,
        uploadedAt,
        tags,
        folder: decodeMetadataValue(metadata.folder) || parseFolder(key),
        exif: decodeMetadataValue(metadata.exif) || null
      } satisfies ListedImage;
    })
  );

  const filtered = enriched.filter((img) => {
    const matchSearch =
      !input.search ||
      img.filename.toLowerCase().includes(input.search.toLowerCase()) ||
      img.tags.some((t) => t.toLowerCase().includes(input.search!.toLowerCase()));
    const matchTag = !input.tag || img.tags.includes(input.tag);
    return matchSearch && matchTag;
  });

  filtered.sort((a, b) => +new Date(b.uploadedAt) - +new Date(a.uploadedAt));

  const nextCursor = pickTag(xml, "NextContinuationToken");
  const isTruncated = (pickTag(xml, "IsTruncated") ?? "false").toLowerCase() === "true";

  return {
    items: filtered,
    nextCursor,
    hasMore: isTruncated
  };
}

export async function deleteImages(keys: string[]) {
  if (!keys.length) return;

  const body = `<?xml version="1.0" encoding="UTF-8"?><Delete>${keys
    .map((key) => `<Object><Key>${key.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</Key></Object>`)
    .join("")}</Delete>`;

  const res = await signedFetch(`${endpointBase()}?delete`, {
    method: "POST",
    headers: {
      "content-type": "application/xml"
    },
    body
  });

  if (!res.ok) {
    throw new Error(`R2 delete failed (${res.status})`);
  }
}

export async function getObjectText(key: string) {
  const res = await signedFetch(`${endpointBase()}/${encodeKey(key)}`, { method: "GET" });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`R2 get failed (${res.status})`);
  }
  return res.text();
}

export async function putObjectText(key: string, value: string, contentType = "application/json") {
  const res = await signedFetch(`${endpointBase()}/${encodeKey(key)}`, {
    method: "PUT",
    headers: {
      "content-type": contentType
    },
    body: value
  });

  if (!res.ok) {
    throw new Error(`R2 put failed (${res.status})`);
  }
}
