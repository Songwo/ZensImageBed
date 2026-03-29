# ZensImageBed 超详细实战教程：从 0 到 1 搭建一个可长期使用的 Cloudflare R2 图床

> 适合人群：小白、个人开发者、博客作者、独立开发者  
> 技术栈：Next.js 15 + Cloudflare R2 + Cloudflare KV + Edge Runtime  
> 项目定位：登录保护、预签名直传、图库管理、分组排序持久化

---

## 1. 这是什么工具，解决什么问题

`ZensImageBed` 是一个面向个人/小团队的“可控图床”。

它解决的是这几个真实痛点：

1. 公共图床不稳定，或者容易挂链接。
2. 自建对象存储流程复杂，尤其是上传和鉴权。
3. 需要一个“能直接复制 Markdown 链接”的后台，而不是只会存文件。
4. 想省钱、可迁移、可长期维护。

这个项目的核心特点是：

1. 上传时不走服务端中转，浏览器直接把文件 PUT 到 R2，降低服务器压力。
2. 所有管理页面有登录保护，不暴露后台操作。
3. 图库支持搜索、标签、批量删除、链接一键复制。
4. 支持“今天/本周/更早”分组，并把分组内拖拽排序持久化到 KV/R2。

---

## 2. 一图看懂整体架构

```text
Browser (UploadPanel/GalleryPanel)
   | 1) POST /api/upload/presign (带文件信息)
   v
Next.js Edge Route
   | 2) 校验参数 + 频率限制 + 生成 R2 预签名 PUT URL
   v
Browser
   | 3) 直接 PUT 到 Cloudflare R2 (signedUrl + signedHeaders)
   v
R2 Bucket (存图片 + metadata)

Gallery 流程:
Browser -> GET /api/images -> Edge -> R2 ListObjects + HEAD metadata -> 返回列表

排序流程:
Browser -> POST /api/images/order -> Edge -> KV(优先) 或 R2(回退) 持久化
```

为什么这样设计：

1. 安全：前端没有 R2 长期密钥，只拿短时签名 URL。
2. 性能：上传数据不经过 Next.js 服务器，节省带宽与计算。
3. 可扩展：对象元信息（tags/folder/exif/originalname）直接存在对象 metadata，后续做筛选很方便。

---

## 3. 核心原理拆解（真正理解，不只是会用）

## 3.1 登录鉴权原理（JWT + HttpOnly Cookie）

相关文件：`lib/auth.ts`、`middleware.ts`、`app/api/auth/login/route.ts`

流程：

1. 用户在 `/login` 提交密码。
2. 服务端校验 `password === ADMIN_PASSWORD`。
3. 校验通过后生成 JWT（`HS256`，有效期 7 天）。
4. JWT 写入 HttpOnly Cookie：`imagebed_session`。
5. `middleware.ts` 对 `/upload`、`/gallery` 和大多数 `/api/*` 请求做鉴权检查。

关键点：

1. `SESSION_SECRET` 必须配置且足够随机，建议 32+ 字符。
2. `HttpOnly` 阻止前端 JS 读取 Cookie，降低 XSS 窃取风险。
3. `secure` 在生产环境开启，只走 HTTPS。

常见错误：

1. 忘记设置 `SESSION_SECRET`，会直接抛错。
2. `ADMIN_PASSWORD` 没配，登录永远失败。
3. 反向代理路径异常导致 cookie domain/path 不匹配，表现为“刚登录又掉线”。

---

## 3.2 预签名上传原理（为什么能直传）

相关文件：`app/api/upload/presign/route.ts`、`lib/r2.ts`

流程：

1. 前端把待上传文件信息发给 `/api/upload/presign`：
   - `filename`、`contentType`、`size`、`tags`、`folder`、`exif`
2. 服务端做参数校验与限制：
   - zod 校验结构
   - 文件数限制 `MAX_FILES_PER_UPLOAD`
   - 单文件大小限制 `MAX_FILE_SIZE`
   - 频率限制 `checkRateLimit()`
3. 服务端基于 R2 S3 兼容接口生成签名 PUT URL（含签名 query）。
4. 前端使用 `XMLHttpRequest` 直接 PUT 文件到 R2。

为什么这里用 `XMLHttpRequest` 而不是 `fetch`：

1. 需要稳定的上传进度事件（`xhr.upload.onprogress`）。
2. 做多文件逐个上传时，进度条体验更直观。

对象 key 设计：

1. 自动带日期前缀：`YYYY-MM-DD/...`
2. 可选 folder：会清理首尾 `/`
3. 文件名做安全清洗：非 `[a-zA-Z0-9_.-]` 字符替换为 `_`
4. 最终 key 含 UUID，规避同名覆盖冲突。

---

## 3.3 元数据策略（tags/folder/exif/originalName）

相关文件：`lib/r2.ts`、`components/upload-panel.tsx`

项目把业务字段存到 R2 对象 metadata：

1. `x-amz-meta-tags`
2. `x-amz-meta-folder`
3. `x-amz-meta-exif`
4. `x-amz-meta-originalname`

细节处理非常关键：

1. 写入前 `encodeURIComponent`，避免中文/特殊符号造成 header 编码异常。
2. 读取时再 `decodeURIComponent`，保证展示原值。
3. 列表接口会对每个对象做 HEAD，拿 metadata 做 UI 展示和筛选。

这就是你之前常见报错的根因之一：  
`Failed to execute 'setRequestHeader' ... non ISO-8859-1`  
本项目已经通过 metadata 编解码规避了这个问题。

---

## 3.4 图库分组与排序持久化原理

相关文件：`components/gallery-panel.tsx`、`lib/order-store.ts`、`app/api/images/order/route.ts`

逻辑分两层：

1. 分组：按 `uploadedAt` 计算到 `today/week/older`。
2. 排序：每个分组独立维护 key 数组，可拖拽重排。

持久化后端支持：

1. `kv`（推荐）
2. `r2`（回退）

自动选择逻辑：

1. `ORDER_STORAGE_BACKEND=kv` 且 KV 三要素齐全时，走 KV。
2. 显式 `r2` 或 KV 配置缺失时，回退 R2 JSON 文件（`ORDER_R2_KEY`）。

防抖保存机制：

1. 前端拖拽后只标记脏状态，不立即写库。
2. 700ms 防抖后 POST `/api/images/order`。
3. 成功后 toast 显示保存后端（KV/R2）。

---

## 4. 全量环境变量说明（含建议值）

参考：`.env.example`

## 4.1 R2 连接相关

1. `R2_ACCOUNT_ID`
   - Cloudflare 账户 ID
   - 用于拼接 S3 endpoint：`https://<account>.r2.cloudflarestorage.com`
2. `R2_ACCESS_KEY_ID`
   - R2 API token 对应的 Access Key ID
3. `R2_SECRET_ACCESS_KEY`
   - 对应 Secret Key
4. `R2_BUCKET_NAME`
   - 存图桶名
5. `R2_PUBLIC_DOMAIN`
   - 图片公网访问域名（自定义域或 `*.r2.dev`）
   - 注意不要带尾斜杠（代码会做一次去尾斜杠容错）

## 4.2 登录会话相关

1. `ADMIN_PASSWORD`
   - 后台登录密码
2. `SESSION_SECRET`
   - JWT 签名密钥，建议随机高强度字符串

## 4.3 上传限制相关

1. `MAX_FILE_SIZE`
   - 单文件最大字节数
   - 默认 `10485760`（10MB）
2. `MAX_FILES_PER_UPLOAD`
   - 服务端单次签名上限
   - 默认 `20`
3. `NEXT_PUBLIC_MAX_FILES_PER_UPLOAD`
   - 前端可选文件上限
   - 默认 `20`
   - 建议与后端一致，避免“前端可选但后端拒绝”

## 4.4 排序持久化相关

1. `ORDER_STORAGE_BACKEND`
   - `kv` 或 `r2`，默认 `kv`
2. `KV_ORDER_NAMESPACE_ID`
3. `CF_ACCOUNT_ID`
4. `CF_API_TOKEN`
   - 上述三个用于 Cloudflare KV API 读写
5. `ORDER_R2_KEY`
   - 排序 JSON 存在 R2 的对象路径
   - 默认 `.imagebed/meta/order.json`

---

## 5. API 参数详解（写博客最容易加分的一节）

## 5.1 `POST /api/auth/login`

请求体：

```json
{
  "password": "your_admin_password"
}
```

响应：

1. `200`：`{ "ok": true }` 并设置会话 cookie
2. `401`：`{ "message": "密码错误" }`

---

## 5.2 `POST /api/upload/presign`

请求体：

```json
{
  "files": [
    {
      "filename": "cat.png",
      "contentType": "image/png",
      "size": 123456,
      "tags": ["cat", "pet"],
      "folder": "blog",
      "exif": "Apple iPhone 14 2026:01:01 12:00:00"
    }
  ]
}
```

校验与限制：

1. `files` 至少 1 个
2. 单次文件数不超过 `MAX_FILES_PER_UPLOAD`
3. 每个文件 `size > 0` 且不超过 `MAX_FILE_SIZE`
4. 简单内存限流（默认同 key 每分钟 10 次）

成功响应：

```json
{
  "items": [
    {
      "key": "2026-02-24/blog/uuid-cat.png",
      "signedUrl": "https://...签名URL...",
      "signedHeaders": {
        "content-type": "image/png",
        "x-amz-meta-tags": "cat%2Cpet",
        "x-amz-meta-folder": "blog",
        "x-amz-meta-exif": "Apple%20iPhone...",
        "x-amz-meta-originalname": "cat.png"
      },
      "publicUrl": "https://cdn.example.com/2026-02-24/blog/uuid-cat.png"
    }
  ],
  "remaining": 9
}
```

常见失败：

1. `400 Invalid payload`：结构不匹配
2. `400 单次最多上传 N 张`
3. `429 上传过于频繁，请稍后再试`

---

## 5.3 `GET /api/images`

查询参数：

1. `cursor`：分页游标（可选）
2. `limit`：每页数量，1-50，默认 24
3. `search`：文件名或标签搜索
4. `tag`：按标签过滤

返回字段：

1. `items[]`：包含 `key/url/filename/size/uploadedAt/tags/folder/exif`
2. `nextCursor`
3. `hasMore`

---

## 5.4 `POST /api/images/delete`

请求体：

```json
{
  "keys": ["2026-02-24/uuid-a.png", "2026-02-24/uuid-b.png"]
}
```

限制：

1. 最少 1 个
2. 最多 100 个

---

## 5.5 `GET/POST /api/images/order`

`GET`：读取已保存排序。  
`POST`：保存分组排序。

POST 请求体：

```json
{
  "groups": {
    "today": ["key1", "key2"],
    "week": ["key3"],
    "older": []
  }
}
```

约束：

1. 每组最多 10000 条
2. 后端会做去重/清理

---

## 6. 小白部署教程（Cloudflare Pages + R2）

## 6.1 前置准备

1. 一个 Cloudflare 账号
2. 一个 GitHub 仓库（已推送本项目代码）
3. Node.js 20+

## 6.2 创建 R2 Bucket

1. Cloudflare 控制台 -> `R2` -> `Create bucket`
2. 记下 bucket 名（填 `R2_BUCKET_NAME`）
3. 创建 R2 API Token，拿到 `Access Key ID / Secret Access Key`

## 6.3 配置 R2 公网访问域

两种方式：

1. R2 Dev 域名（快）
2. 自定义域（推荐长期使用）

把最终可访问域填入 `R2_PUBLIC_DOMAIN`。

## 6.4 配置 R2 CORS（直传成功的关键）

在 bucket 的 CORS 配置填：

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

如果你漏了当前站点域名，浏览器会直接报跨域错误。

## 6.5 （推荐）创建 KV 命名空间用于排序

1. Cloudflare -> Workers & Pages -> KV -> Create namespace
2. 拿到 `KV_ORDER_NAMESPACE_ID`
3. 创建 API Token，赋予该 namespace 读写权限

## 6.6 连接 Cloudflare Pages

1. Workers & Pages -> Create -> Pages -> Connect to Git
2. 选你的仓库
3. 构建参数：
   - Build command: `npm run cf:build`
   - Build output directory: `.vercel/output/static`
   - Node.js: `20+`

注意：不要把 output 配成 `.next`，可能触发 Cloudflare 单文件 25MiB 限制。

## 6.7 配置环境变量并部署

在 Pages 的 `Settings -> Environment variables` 填入 `.env.example` 对应变量。

建议：

1. `Production` 和 `Preview` 都配置
2. 密钥类变量不要留空
3. `SESSION_SECRET` 每个环境都独立

保存后触发部署，成功后访问：

1. `/login` 登录
2. `/upload` 上传
3. `/gallery` 管理图库

---

## 7. 常见错误与排查手册（高频）

## 7.1 `No 'Access-Control-Allow-Origin' header`

原因：

1. R2 CORS 未配置
2. `AllowedOrigins` 没写你当前域名
3. 预览域名和正式域名漏其一

处理：

1. 按上文 CORS JSON 配置
2. 把 `http://localhost:3000`、`*.pages.dev`、自定义域都加上

## 7.2 登录总是 401 或跳回登录页

原因：

1. `ADMIN_PASSWORD` 错误或为空
2. `SESSION_SECRET` 缺失
3. 生产环境非 HTTPS 导致 secure cookie 不生效

处理：

1. 检查环境变量是否确实生效到当前环境
2. 用浏览器开发者工具确认 `imagebed_session` 是否写入

## 7.3 上传时报大小限制错误

原因：

1. 文件超过 `MAX_FILE_SIZE`
2. 前后端上限不一致

处理：

1. 同时调整 `MAX_FILE_SIZE` 与前端提示文案
2. `NEXT_PUBLIC_MAX_FILES_PER_UPLOAD` 与 `MAX_FILES_PER_UPLOAD` 保持一致

## 7.4 出现 429 上传频繁

原因：

1. 命中内存限流（默认每分钟 10 次）

处理：

1. 调整限流参数（代码层）
2. 对批量上传做队列和重试策略

注意：当前限流是“单实例内存 Map”，多实例下并非全局一致，只适合轻量防刷。

## 7.5 图片能上传但图库看不到

原因：

1. `R2_PUBLIC_DOMAIN` 配错
2. 上传 key 与展示域名拼接异常
3. R2 列表权限/密钥问题

处理：

1. 先去 R2 控制台确认对象是否存在
2. 再看 `/api/images` 响应是否包含该 key

## 7.6 排序保存失败

原因：

1. `ORDER_STORAGE_BACKEND=kv` 但 KV 变量缺失
2. `CF_API_TOKEN` 权限不够

处理：

1. 检查 `CF_ACCOUNT_ID`、`KV_ORDER_NAMESPACE_ID`、`CF_API_TOKEN`
2. 临时切到 `ORDER_STORAGE_BACKEND=r2` 验证功能

---

## 8. 性能与稳定性建议（进阶）

1. 列表接口当前会对每个对象做 HEAD 读取 metadata，图片很多时会增加请求量。
2. 若未来数据量大，建议把 metadata 冗余进索引（KV/D1）减少 HEAD 次数。
3. 上传可从串行改并发池（例如 3-4 并发），显著缩短总耗时。
4. 增加 `content-type` 白名单校验，避免非图片文件误传。
5. 对 API 增加结构化日志，便于线上排查。

---

## 9. 本地开发与发布命令

```bash
npm install
npm run dev
npm run typecheck
npm run build
```

Cloudflare Pages 构建命令：

```bash
npm run cf:build
```

---

## 10. 最后总结（可直接放文章结尾）

`ZensImageBed` 的关键价值不是“能上传图片”这么简单，而是：

1. 用低成本实现了稳定、可控的图床能力。
2. 兼顾了安全（鉴权 + 签名）与体验（直传 + 管理后台）。
3. 通过 KV/R2 排序持久化把“图库运营能力”做完整。

如果你想要一个可长期维护、可迁移、适合个人品牌内容沉淀的图床方案，这个项目是非常实用的一条路线。

---

## 11. GitHub 项目地址

`https://github.com/Songwo/ZensImageBed`

