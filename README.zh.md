# pipink

[English](./README.md) | 中文

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/OpenRicky/pipink)

## 项目介绍

pipink 是一个基于 Cloudflare Workers 的固定入口代理项目。它对外提供一个稳定的访问地址，并把请求代理到存储在 Workers KV 中的目标链接。

客户端始终访问同一个 Worker 地址；当真实目标链接变化时，运营方只需要通过管理接口或管理页面更新一次运行时配置，而不需要逐个修改客户端。

当前阶段的产品范围刻意保持收敛：pipink 目前只专注于代理转发目标链接。后续会在此基础上继续支持对目标链接返回内容做处理和转换，而不只是简单转发。

## 项目功能

Roadmap：

- [x] 提供稳定的 Worker 访问入口，并代理到可配置目标链接
- [x] 通过 query 参数 token 保护公开代理访问
- [x] 使用 Workers KV 持久化目标链接和访问 token
- [x] 提供管理员登录、退出与配置维护的管理页面
- [x] 使用 Worker 直接代理请求，而不是做 302 重定向
- [ ] 支持对上游响应内容做转换处理
- [ ] 支持面向目标链接内容的格式转换规则
- [ ] 支持更复杂的改写与处理流程

## 快速部署

### 方案 A. 使用 Cloudflare 按钮一键部署

直接点击本 README 顶部的按钮即可从 GitHub 发起部署。

Cloudflare 会基于这个部署模板创建一个新的仓库，并在部署过程中自动创建 `LINK_STORE` KV namespace，同时根据 `.dev.vars.example` 提示你填写 `ADMIN_KEY` 和 `INITIAL_ACCESS_TOKEN`。

仓库里提交的 `wrangler.jsonc` 就是让这件事成立的公开模板。

### 方案 B. 手动部署

### 1. 安装依赖

```bash
pnpm install
```

### 2. 登录 Cloudflare

拉取项目并安装依赖后，再在终端登录 Cloudflare：

```bash
pnpm wrangler login
```

### 3. 修改 Wrangler 配置

仓库现在自带一个可用于 Deploy to Cloudflare 和手动部署的公开 `wrangler.jsonc`。

如果你需要本地或生产私有覆盖配置，先复制一份到被 git 忽略的 `wrangler.local.jsonc` 再修改：

```bash
cp wrangler.jsonc wrangler.local.jsonc
```

当 `wrangler.local.jsonc` 存在时，`pnpm dev` 和 `pnpm deploy:worker` 会优先使用它；不存在时才回退到仓库里提交的 `wrangler.jsonc`。

然后修改你实际使用的配置文件里的这些字段：

- `name`：填写一个唯一的 Worker 名称
- `kv_namespaces[0].id`：执行 `pnpm wrangler kv namespace create LINK_STORE`，把返回的生产环境 ID 填进去
- `observability.enabled`：如果你希望保留 Cloudflare 的日志与观测能力，可以继续保持开启

如果你要绑定自定义域名，可以把下面这段加进 `wrangler.jsonc`。如果只是使用 `workers.dev`，则不需要：

```json
"routes": [
  {
    "pattern": "pipink.example.com",
    "custom_domain": true
  }
]
```

### 4. 设置生产环境密钥

```bash
pnpm wrangler secret put ADMIN_KEY
pnpm wrangler secret put INITIAL_ACCESS_TOKEN
```

`INITIAL_ACCESS_TOKEN` 用来初始化第一个公开访问 token；如果你在手动部署时不设置，pipink 会在首次管理员登录成功后自动生成第一个 token。

如果你使用 Cloudflare 按钮部署，Cloudflare 会在部署流程里提示填写这些 secret，因此你也不需要手动创建 KV namespace。

如果后续你要重置 `ADMIN_KEY`，再次执行 `pnpm wrangler secret put ADMIN_KEY`，然后重新执行 `pnpm deploy:worker` 即可。
如果 Workers KV 里已经保存了访问 token，后续再修改 `INITIAL_ACCESS_TOKEN` 也不会覆盖这个现有 token。

### 5. 部署到 Cloudflare

```bash
pnpm deploy:worker
```

部署完成后，地址通常类似：

```text
https://pipink.<your-subdomain>.workers.dev
https://pipink.<your-subdomain>.workers.dev/admin
```

## 使用方式

### 1. 配置目标链接与访问 token

在浏览器打开 `/admin`，使用 `ADMIN_KEY` 登录后即可配置：

- 上游目标链接
- 公开访问 token

如果你更喜欢直接调用接口，也可以使用管理 API 更新目标链接：

```bash
curl -X PUT "https://pipink.<your-subdomain>.workers.dev/admin/target" \
  -H "Authorization: Bearer your-admin-key" \
  -H "Content-Type: application/json" \
  -d '{"targetUrl":"https://example.com/your-real-link"}'
```

### 2. 调用统一链接

访问统一入口时，只需要在 Worker URL 后带上 `?token=`：

```text
https://pipink.<your-subdomain>.workers.dev/?token=your-access-token
```

这个带 token 的固定地址可以直接提供给客户端使用，而 `/admin` 可以继续用于后续修改目标链接或轮换 token。

## 本地运行与测试

如果你想先在本地验证，再创建本地环境文件：

```bash
cp .dev.vars.example .dev.vars
```

如果你希望本地 `wrangler dev` 使用 preview KV namespace，再额外创建一个，并把 `preview_id` 加到你实际使用的配置文件里的 `kv_namespaces[0]` 下：

```bash
pnpm wrangler kv namespace create LINK_STORE --preview
```

然后启动本地服务：

```bash
pnpm dev
```

本地常用地址：

- `http://127.0.0.1:8787/admin`
- `http://127.0.0.1:8787/?token=your-access-token`

## 开发说明

开始开发前请先安装：

- Node.js 20 或更高版本
- pnpm 10 或更高版本
- 一个 Cloudflare 账号

常用命令：

```bash
pnpm build
pnpm check
pnpm dev
pnpm deploy:worker
```

管理后台使用 Vue 3 与 Vite 构建。静态产物会输出到 `dist` 目录，并由 Cloudflare Workers Static Assets 提供。

## 接口文档

OpenAPI 文档位于 [docs/openapi.yaml](./docs/openapi.yaml)。

## 协议说明

本项目使用 MIT 协议。任何人都可以在遵守 MIT 协议文本的前提下自由使用、修改、分发和再授权。详见 [LICENSE](./LICENSE)。
