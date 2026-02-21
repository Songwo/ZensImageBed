import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type _Object
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { DOMParser as XmldomParser } from "@xmldom/xmldom";
import { normalizePublicDomain } from "@/lib/utils";

if (typeof globalThis.DOMParser === "undefined") {
  (globalThis as { DOMParser?: typeof XmldomParser }).DOMParser = XmldomParser;
}

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
    credentials: {
      accessKeyId: required("R2_ACCESS_KEY_ID"),
      secretAccessKey: required("R2_SECRET_ACCESS_KEY")
    }
  };
}

let client: S3Client | null = null;
function getClient() {
  if (client) return client;
  const cfg = getConfig();
  client = new S3Client({
    region: "auto",
    endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
    credentials: cfg.credentials
  });
  return client;
}

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

function encodeMetadataValue(value: string) {
  return encodeURIComponent(value);
}

function decodeMetadataValue(value: string | undefined) {
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseFilename(key: string) {
  const chunks = key.split("/");
  return chunks[chunks.length - 1] ?? key;
}

function parseFolder(key: string) {
  const chunks = key.split("/");
  if (chunks.length <= 2) return null;
  return chunks[1] ?? null;
}

function objectToListed(obj: _Object, metadata: Record<string, string> | undefined, publicDomain: string): ListedImage {
  const key = obj.Key ?? "";
  const filename = decodeMetadataValue(metadata?.originalname) || parseFilename(key);
  const tags = decodeMetadataValue(metadata?.tags)
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  return {
    key,
    url: `${publicDomain}/${key}`,
    filename,
    size: obj.Size ?? 0,
    uploadedAt: (obj.LastModified ?? new Date()).toISOString(),
    tags,
    folder: decodeMetadataValue(metadata?.folder) || parseFolder(key),
    exif: decodeMetadataValue(metadata?.exif) || null
  };
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
  const encodedTags = encodeMetadataValue(input.tags.join(","));
  const encodedFolder = encodeMetadataValue(input.folder ?? "");
  const encodedExif = encodeMetadataValue(input.exif ?? "");
  const encodedOriginalName = encodeMetadataValue(input.originalName);

  const command = new PutObjectCommand({
    Bucket: cfg.bucketName,
    Key: input.key,
    ContentType: input.contentType,
    Metadata: {
      tags: encodedTags,
      folder: encodedFolder,
      exif: encodedExif,
      originalName: encodedOriginalName
    }
  });

  const signedUrl = await getSignedUrl(getClient(), command, { expiresIn: 60 });
  return {
    signedUrl,
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
  const r2 = getClient();
  const listed = await r2.send(
    new ListObjectsV2Command({
      Bucket: cfg.bucketName,
      MaxKeys: input.limit,
      ContinuationToken: input.cursor
    })
  );

  const objects = (listed.Contents ?? []).filter((obj) => Boolean(obj.Key));

  const enriched = await Promise.all(
    objects.map(async (obj) => {
      const key = obj.Key!;
      const head = await r2.send(new HeadObjectCommand({ Bucket: cfg.bucketName, Key: key }));
      return objectToListed(obj, head.Metadata, cfg.publicDomain);
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

  return {
    items: filtered,
    nextCursor: listed.NextContinuationToken ?? null,
    hasMore: Boolean(listed.IsTruncated)
  };
}

export async function deleteImages(keys: string[]) {
  if (!keys.length) return;
  const cfg = getConfig();
  const r2 = getClient();
  await r2.send(
    new DeleteObjectsCommand({
      Bucket: cfg.bucketName,
      Delete: {
        Objects: keys.map((Key) => ({ Key })),
        Quiet: true
      }
    })
  );
}

async function streamToString(stream: unknown) {
  if (typeof stream !== "object" || stream === null) return "";
  const body = stream as {
    transformToString?: () => Promise<string>;
  };
  if (body.transformToString) {
    return body.transformToString();
  }
  return "";
}

export async function getObjectText(key: string) {
  const cfg = getConfig();
  const r2 = getClient();
  try {
    const object = await r2.send(
      new GetObjectCommand({
        Bucket: cfg.bucketName,
        Key: key
      })
    );
    return streamToString(object.Body);
  } catch (error) {
    const err = error as { name?: string };
    if (err.name === "NoSuchKey") return null;
    throw error;
  }
}

export async function putObjectText(key: string, value: string, contentType = "application/json") {
  const cfg = getConfig();
  const r2 = getClient();
  await r2.send(
    new PutObjectCommand({
      Bucket: cfg.bucketName,
      Key: key,
      Body: value,
      ContentType: contentType
    })
  );
}
