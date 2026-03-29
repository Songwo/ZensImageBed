# ZensImage

<p align="center">
  <img src="./faviconio-logo/logo.png" alt="ZensImage Logo" width="220" />
</p>

<p align="center">
  一个面向个人/小团队的 Cloudflare R2 图床，支持登录保护、预签名直传、分组排序、批量管理。
</p>

---

## 1. 项目简介

`ZensImage` 是一个基于 Next.js 15 的现代图床应用，重点是“好看 + 好用 + 可低成本长期部署”。

核心特性：

- 登录后才能上传与管理（cookie session）
- 预签名直传 R2（浏览器直传，不走服务器中转）
- 图片管理页支持搜索、标签筛选、无限滚动、批量删除
- 图片链接一键复制（URL / Markdown / HTML / BBCode）
- 按时间分组（今天/本周/更早）并支持分组独立拖拽排序
- 排序持久化到 Cloudflare KV（可回退 R2）
- 深浅主题 + 现代化仪表盘风格

---

## 2. 技术栈

- Next.js 15（App Router + Route Handlers）
- TypeScript（strict）
- Tailwind CSS v4
- shadcn/ui 风格组件
- TanStack Query v5
- zod + react-hook-form
- framer-motion
- sonner
- next-themes
- Cloudflare R2（S3 兼容）
- Cloudflare KV（排序持久化，推荐）

---

## 3. 本地开发

### 3.1 安装依赖

```bash
npm install
```

### 3.2 配置环境变量

复制 `.env.example` 为 `.env.local`，填写你的值：

```bash
cp .env.example .env.local
```

### 3.3 启动开发

```bash
npm run dev
```

打开 `http://localhost:3000`。

---

## 4. 环境变量说明

> 可以直接配置在 Cloudflare Pages 的环境变量里，本地 `.env.local` 仅用于本地调试。

### 4.1 必填

- `R2_ACCOUNT_ID`：Cloudflare Account ID
- `R2_ACCESS_KEY_ID`：R2 API Token 的 Access Key ID
- `R2_SECRET_ACCESS_KEY`：R2 API Token 的 Secret Key
- `R2_BUCKET_NAME`：R2 桶名
- `R2_PUBLIC_DOMAIN`：图片访问域名（自定义域或 `*.r2.dev`）
- `ADMIN_PASSWORD`：登录密码
- `SESSION_SECRET`：会话签名密钥（建议 32+ 随机字符）

### 4.2 上传限制

- `MAX_FILE_SIZE`：单文件最大字节数（默认 `10485760` = 10MB）
- `MAX_FILES_PER_UPLOAD`：服务端单次最多签名文件数（默认 `20`）
- `NEXT_PUBLIC_MAX_FILES_PER_UPLOAD`：前端单次最多选择文件数（默认 `20`）

### 4.3 排序持久化

- `ORDER_STORAGE_BACKEND`：`kv` 或 `r2`（推荐 `kv`）
- `KV_ORDER_NAMESPACE_ID`：使用 KV 时必填
- `CF_ACCOUNT_ID`：使用 KV 时必填
- `CF_API_TOKEN`：使用 KV 时必填（需 KV 读写权限）
- `ORDER_R2_KEY`：使用 R2 存排序时的对象路径（默认 `.imagebed/meta/order.json`）

### 4.4 `.env` 是否需要双引号？

通常不需要，直接 `KEY=value` 即可。

只有这些情况建议加引号：

- 值里有空格
- 值里有 `#`
- 值前后需要保留空白

---

## 5. 小白部署到 Cloudflare（推荐流程）

## 5.1 创建 R2 Bucket

1. Cloudflare 控制台 -> `R2` -> `Create bucket`
2. 记录桶名（对应 `R2_BUCKET_NAME`）
3. 在 R2 中创建 API Token（S3 访问）并拿到：
- Access Key ID
- Secret Access Key

## 5.2 配置 R2 公网访问域

二选一：

1. 使用 R2 Dev 域名（`https://pub-xxx.r2.dev`）
2. 绑定你自己的域名（推荐）

把最终访问域写入：`R2_PUBLIC_DOMAIN`

## 5.3 配置 R2 CORS（非常关键）

如果你要浏览器直传（本项目默认），必须给 Bucket 配 CORS，否则会出现 `No 'Access-Control-Allow-Origin'`。

在 R2 Bucket 的 CORS 配置里填：

```json
[
  {
    "AllowedOrigins": [
      "http://localhost:3000",
      "https://<your-pages-project>.pages.dev",
      "https://<your-custom-domain>"
    ],
    "AllowedMethods": ["GET", "HEAD", "PUT", "POST", "DELETE"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

## 5.4 （可选）创建 KV 用于排序持久化

1. Cloudflare 控制台 -> `Workers & Pages` -> `KV` -> `Create namespace`
2. 记录 namespace id（对应 `KV_ORDER_NAMESPACE_ID`）
3. 创建 API Token，赋予该命名空间读写权限（`CF_API_TOKEN`）

## 5.5 创建 Pages 项目并连接 Git 仓库

1. Cloudflare -> `Workers & Pages` -> `Create application` -> `Pages` -> `Connect to Git`
2. 选择本仓库
3. 构建配置：
- Build command: `npm run cf:build`
- Build output directory: `.vercel/output/static`
- Node.js: `20+`

> 不要把输出目录设置为 `.next`。  
> `.next/cache/webpack/*.pack` 可能超过 Cloudflare Pages 25 MiB 文件限制，出现：
> `Pages only supports files up to 25 MiB in size`。

## 5.6 在 Pages 项目中配置环境变量

Pages 项目 -> `Settings` -> `Environment variables`：

把第 4 节中的变量填进去（建议在 `Production` 和 `Preview` 都配置）。

## 5.7 触发部署

- 点 `Save and Deploy`
- 部署成功后访问你的 Pages 域名

---

## 6. Cloudflare 部署后检查清单

- 能打开 `/login` 并用 `ADMIN_PASSWORD` 登录
- `/upload` 能成功上传（无 CORS 报错）
- `/gallery` 能看到上传文件
- 拖拽排序刷新后不丢（KV/R2 持久化生效）
- 链接复制格式正常

---

## 7. 常见问题

### 7.1 `No 'Access-Control-Allow-Origin' header`

原因：R2 CORS 没配好。

处理：按上文 `5.3` 配置，并确认 `AllowedOrigins` 包含你当前访问域。

### 7.2 `Failed to execute 'setRequestHeader' ... non ISO-8859-1`

原因：请求头包含了中文/Unicode 元数据。

处理：项目已内置编码修复；拉取最新代码并重启服务。

### 7.3 上传 URL 出现双斜杠 `//`

原因：文件夹字段前后多余 `/`。

处理：项目已在服务端自动清洗。

---

## 8. 外部 API 接口（供第三方应用调用）

图床提供了一个直传接口，可让你的 Java/Python/Go 等后端程序直接上传图片，无需登录 session。

### 8.1 接口认证

使用 **API Key** 鉴权，在请求头中携带：

```
Authorization: Bearer <你的 API Key>
```

API Key 可在图床管理后台的 **「API 密钥」** 页面生成和管理（登录后侧边栏可见），也可直接在环境变量中设置静态 Key：

```
API_KEY=your_static_api_key
```

> 后台动态生成的 Key 优先级高于环境变量中的静态 Key。

### 8.2 上传图片

**`POST /api/upload/direct`**

请求格式：`multipart/form-data`

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `file` | File | ✓ | 图片文件 |
| `tags` | String | | 逗号分隔标签，如 `blog,avatar` |
| `folder` | String | | 存储目录，如 `posts` |

响应示例：

```json
{
  "key": "2026-03-29/posts/uuid-photo.jpg",
  "url": "https://your-domain.com/2026-03-29/posts/uuid-photo.jpg",
  "filename": "photo.jpg",
  "size": 102400,
  "remaining": 19
}
```

错误码：`400` 参数错误 | `401` Key 无效 | `429` 频率限制

### 8.3 Java 调用示例（OkHttp）

```java
MediaType MEDIA_TYPE = MediaType.parse("image/jpeg");

RequestBody fileBody = RequestBody.create(new File("/path/to/photo.jpg"), MEDIA_TYPE);

MultipartBody body = new MultipartBody.Builder()
    .setType(MultipartBody.FORM)
    .addFormDataPart("file", "photo.jpg", fileBody)
    .addFormDataPart("tags", "blog,article")
    .addFormDataPart("folder", "posts")
    .build();

Request request = new Request.Builder()
    .url("https://your-imagebed.com/api/upload/direct")
    .header("Authorization", "Bearer " + API_KEY)
    .post(body)
    .build();

try (Response response = client.newCall(request).execute()) {
    String json = response.body().string();
    // 从 json 中取 "url" 字段即为图片公开访问地址
}
```

### 8.4 curl 测试

```bash
curl -X POST https://your-imagebed.com/api/upload/direct \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -F "file=@/path/to/photo.jpg" \
  -F "tags=test" \
  -F "folder=demo"
```

---

## 9. 目录结构（核心）

```text
app/
  api/
    auth/login
    auth/logout
    upload/presign      # 浏览器预签名直传
    upload/direct       # 外部 API 直传（API Key 鉴权）
    images
    images/delete
    images/order
    apikeys             # API Key 管理接口
  login/
  upload/
  gallery/
  settings/apikeys/    # API Key 管理页面
lib/
  auth.ts
  r2.ts
  order-store.ts
  rate-limit.ts
  apikey-store.ts      # API Key 存储
components/
  upload-panel.tsx
  gallery-panel.tsx
  ui/*
```

---

## 9. 脚本命令

- `npm run dev`：本地开发
- `npm run typecheck`：类型检查
- `npm run build`：生产构建

---

## 10. License

可按你的需求改成 MIT / Apache-2.0 / 私有协议。
