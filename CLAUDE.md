# CLAUDE.md

This file provides guidance to AI coding agents working with this repository.

**重要提示：**
- 当功能发生变化时，请保持此文件和 `README.md` 同步更新。请更新文档以反映当前状态，但是需要经过我的允许后再修改。
- 所有的注释和日志优先采用中文，保留必要的专业术语部分。
- 所有的依赖包的安装都要先进行搜索，综合判断依赖采用的版本，而不是默认采用某个版本。
- 状态管理上我们全部采用 Jotai 来实现。
- 这是个开源项目，本地存储优先，善用配置文件优于大部分默认采用 localstorage，不采用本地数据库方案。
- 保证充分的组件化以及人类的可读性，每次完成改动后都要思考这一点，运行@code-simplifier 来简化优化代码，保持简单直接不过渡设计的风格。
- 在 UI 设计上采用更现代的方案，UI 组件推荐采用 ShadcnUI，在合适的情况下，用卡片和阴影取代边框，用符合主题的饱满色彩，设置界面要设置背景，为未来做不同主题留下空间。
- 采用 BDD 行为驱动开发的方案。

## 项目概述

Proma 是一个**本地优先的 Web 服务端应用**（企业内部自部署、商业开源），提供 Chat 与 Agent 工作流。Agent 模式基于 **Pi Agent SDK**（`@earendil-works/pi-coding-agent`），通过统一的消息协议、权限桥接与会话管理接入。

Web 前端（renderer）与原桌面端共用同一份 React 源码，浏览器经 `electronAPI` shim 接入服务端（已迁移方法走 HTTP/WS，未迁移方法返回「暂未迁移」错误）。

## Monorepo 结构

Bun workspace monorepo：

```
proma/
├── packages/
│   ├── shared/       # 共享类型、IPC 通道常量、PromaClientAPI 契约、配置、工具函数
│   ├── core/         # AI Provider 适配器、代码高亮服务 (Shiki)
│   ├── ui/           # 共享 UI 组件 (CodeBlock, MermaidBlock)
│   ├── server-core/  # 引擎层：Agent 编排 / 会话 / 渠道 / 对话 + 端口注入（零 Electron 依赖）
│   └── session-core/ # Pi 会话核心
└── apps/
    ├── server/       # Web 服务端（Bun + Hono + 原生 WS + JWT 多用户）
    ├── web/          # Web 前端（Vite + renderer 复用 + electronAPI shim）
    └── cli/          # 会话消费 CLI（list / info / outline / search / export）
```

**包命名规范**：`@proma/*` 作用域（`@proma/shared`、`@proma/core`、`@proma/ui`、`@proma/server-core`、`@proma/session-core`、`@proma/server`、`@proma/web`、`@proma/cli`）

**依赖管理**：package.json 中使用 `workspace:*` 引用内部包

### 包职责详解

#### @proma/shared
- **导出模块**：`./types`、`./config`、`./utils`、`./constants/permission-rules`
- **关键类型**：`AgentMessage`、`ChatMessage`、`Channel`、`PermissionRequest`、`PromaClientAPI`（Web 端 electronAPI 契约单源）
- **依赖**：无运行时依赖（仅 TypeScript）

#### @proma/core
- **导出模块**：`./providers`、`./highlight`、`./types`、`./utils`
- **关键功能**：Provider 适配器注册表、代码高亮（Shiki）
- **依赖**：`@proma/shared`、`shiki`
- **Peer 依赖**：`@modelcontextprotocol/sdk`

#### @proma/ui
- **关键组件**：共享 React UI 组件库（CodeBlock、MermaidBlock）
- **依赖**：`@proma/core`、`beautiful-mermaid`、`shiki`、Radix UI
- **Peer 依赖**：`react@^18.3.0`、`react-dom@^18.3.0`

#### @proma/server-core（引擎层）
- **职责**：从原桌面端 `main/lib/` 剥离的纯业务引擎，**零 Electron 依赖**，可独立运行于 Node/Bun
- **导出模块**：`.`、`./node`、`./*`、`./adapters/*`、`./chat-tools/*`
- **核心服务**：`agent-orchestrator`、`agent-session-manager`、`agent-prompt-builder`、`agent-permission-service`、`agent-workspace-manager`、`channel-manager`、`chat-service`、`conversation-manager`、`attachment-service`、`automation-manager`
- **适配器**（`adapters/`）：`pi-agent-adapter`（Pi SDK）、`runtime-routing-agent-adapter`（路由入口）、`pi-mcp-tools`、`pi-model-registry` 等
- **文件解析**：`office-preview-service`（mammoth/officeparser，DOCX/XLSX/PPTX → HTML）
- **端口注入**：经 `configureServerCore` 注入 `CryptoPort`（加解密）、`EnvProbe`（环境探测）、`StreamSink`（流输出）等端口，隔离平台差异
- **依赖**：`@proma/shared`、`@proma/core`、`@earendil-works/pi-coding-agent`/`pi-agent-core`/`pi-ai`

#### @proma/session-core
- **职责**：Pi 会话核心（会话分叉、对话回退）
- **导出模块**：`.`、`./node`

#### @proma/server（Web 服务端）
- **职责**：Bun + Hono HTTP 服务 + 原生 WebSocket
- **入口**：`src/index.ts` → `bootstrap.ts` → `app.ts`（Hono app）→ `engine.ts`（注入 server-core 端口）
- **路由**（`src/routes/`）：`agent`、`chat`、`channel`、`settings`、`system-prompt`、`chat-tool`、`automation`、`storage`、`file`、`upload`、`user`、`auth`
- **中间件**（`src/middleware/`）：`auth`（JWT 验证）、`role`（管理员鉴权 adminOnly）
- **认证**：`auth/jwt.ts`（JWT，自建账号起步，SSO 后续可选）
- **WebSocket**：`ws.ts`（订阅鉴权 + 按 `ownerUserId` 过滤事件帧）
- **工具**：`utils/user-scope.ts`（`getUserScope`）、`utils/password.ts`、`utils/version.ts`、`utils/env.ts`
- **监听器**：`workspace-watcher.ts`、`chat-tools-watcher.ts`、`automation-scheduler.ts`
- **依赖**：`@proma/shared`、`@proma/server-core`、`hono`

#### @proma/web（Web 前端）
- **职责**：Vite 开发/构建 + renderer 完整复用 + electronAPI shim 注入
- **shim**（`src/shim/`）：`index.ts`（Proxy 兜底）、`migrated.ts`（已迁方法走 HTTP/WS）、`stubs.ts`（safeDefaults）、`http-client.ts`、`ws-client.ts`、`auth-store.ts`、`sync-shims.ts`
- **renderer**（`src/renderer/`）：React UI（与桌面端共用源码）
- **入口注入**：Vite `transformIndexHtml` 在 `<script src="/main.tsx">` 前插虚拟入口 `/@proma-shim/entry`（renderer/index.html 零改动）
- **登录页**：`src/pages/`（JWT 登录守卫）

#### @proma/cli
- **职责**：面向有限上下文 Agent 消费者的命令行工具，提供会话的渐进式读取（`list` / `info` / `outline` / `search` / `export`）

## 常用命令

```bash
# Web 开发模式（推荐 - 并发启动 server[PROMA_DEV=1] + 前端）
bun run dev
#   → 后端 http://127.0.0.1:3000，前端 http://127.0.0.1:5174
#   PROMA_DEV=1 用于跳过生产敏感配置校验（JWT secret / 主密钥）
#   停服务：pkill -f "apps/server/src/index.ts"; pkill -f vite

# 单独启动
bun run dev:server     # 仅后端（PROMA_DEV=1）
bun run dev:web        # 仅前端

# 构建（所有包）
bun run build

# 类型检查（所有包）
bun run typecheck

# 单包类型检查
cd packages/server-core && bun run typecheck

# 测试
bun test
```

## 运行时环境

使用 Bun 代替 Node.js/npm/pnpm：

- `bun install` 安装依赖，`bun run <script>` 运行脚本
- `bun test` 运行测试（内置测试运行器，`import { test, expect } from "bun:test"`）
- Bun 自动加载 .env 文件（无需 dotenv）
- 优先使用 Bun 原生 API：`Bun.file` > `node:fs`，`Bun.$\`command\`` > `execa`
- 服务端用 `bun src/index.ts` 启动（非编译产物），WS 用 Bun 原生 `WebSocket`

## 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| **运行时** | Bun | 1.2.5+ |
| **语言** | TypeScript | 5.0.0+ |
| **Web 框架（server）** | Hono | 4.11.5 |
| **WebSocket** | Bun 原生 WS | — |
| **认证** | JWT（自建账号） | — |
| **前端框架** | React | 18.3.1 |
| **状态管理** | Jotai | 2.17.1 |
| **UI 组件** | Radix UI | 最新 |
| **样式** | Tailwind CSS | 3.4.17 |
| **富文本编辑器** | TipTap | 3.19.0 |
| **代码高亮** | Shiki | 3.22.0 |
| **Markdown** | React Markdown | 10.1.0 |
| **图表** | Beautiful Mermaid | 最新 |
| **数学公式** | KaTeX | 0.16+ |
| **构建工具（前端）** | Vite | 6.0.3 |
| **Agent Runtime** | Pi Agent SDK | `0.80.9`（`@earendil-works/pi-*`） |

## 核心架构

### Web 服务端架构（最重要的架构模式）

请求 → Hono 路由 → middleware（auth JWT + role adminOnly）→ `getUserScope(c)` 取 `{dataRoot, userId}` → 调 server-core 服务 → JSON 响应 / WS 事件。

1. **认证**：`middleware/auth.ts` 校验 JWT，注入用户身份
2. **角色**：`middleware/role.ts` 的 `adminOnly` 包装管理员路由（渠道/系统提示词/Chat 工具/代理/存储/用户管理等写操作）
3. **多用户 scope（红线）**：`utils/user-scope.ts:getUserScope(c)` 返回 `{dataRoot, userId}`；所有涉及文件/会话的操作必须传 scope，路径经 `assertAttachedPathAllowed(resolved, access, scope)` 校验在用户授权目录内。**漏传 scope 会导致数据静默落错根**
4. **WS 事件归属**：路由层直接 emit 的事件必须带 `ownerUserId`（前端只订阅 `*`，按归属过滤）；全局事件（automation/workspace 广播）对所有用户可见
5. **审计**：`adminOnly` 在 `await next()` 后 status<400 自动记一条到 `{dataRoot}/audit.jsonl`

### shim 模式（renderer 复用 + 渐进迁移）

renderer 源码零改动，浏览器注入 `window.electronAPI` shim（`apps/web/src/shim/index.ts`），用 Proxy 兜底覆盖 ~300 个方法，分流顺序：

1. **`createMigrated`**（自有键 → HTTP `invoke('channel:verb')` 或 WS 订阅）——已迁移方法
2. **`safeDefaults`**（展示类返回空值）——列表返回 `[]`、标量返回 null，避免启动期白屏
3. **`onXxx`**（noop unsubscribe）——订阅器占位
4. **`xxxSync`** → resolve
5. **`getPathForFile`** → 空串
6. **`notMigrated`** → reject「该能力暂未迁移到 Web 端」

**每迁移一个通道**：只需在 `shim/migrated.ts` 加一行 + 在 `docs/plans/api-migration-board.md` 标 ✅。

类型契约：`packages/shared/src/types/client-api.ts` 的 `PromaClientAPI` 是 web 与（历史）electron 之间唯一的客户端契约单源。

### server 路由层（`apps/server/src/routes/`）

| 路由文件 | 职责 |
|----------|------|
| `agent.ts` | Agent 会话/消息/工作区/MCP/Skills/权限/挂载（含 `assertAttachedPathAllowed`）|
| `chat.ts` | Chat 对话/消息/流式 |
| `channel.ts` | 渠道管理（adminOnly 写）、模型获取 |
| `settings.ts` | 应用设置、用户档案、ScratchPad |
| `system-prompt.ts` | 系统提示词（adminOnly 写）|
| `chat-tool.ts` | Chat 工具（adminOnly）|
| `automation.ts` | 自动化（含飞书通知已降级为 no-op）|
| `storage.ts` | 存储管理（adminOnly）|
| `file.ts` | 文件预览（office/read-binary/resolve-and-read/write-text）|
| `upload.ts` | 文件上传 |
| `user.ts` | 用户管理（adminOnly，含 user:delete 级联清理）|
| `auth.ts` | 登录/改密/刷新 token |

### server-core 引擎层（`packages/server-core/src/`）

| 服务 | 职责 |
|------|------|
| `agent-orchestrator.ts` | Agent 核心编排：并发守卫、渠道查找、环境变量构建、SDK 路径解析、消息持久化、事件流处理、自动标题生成 |
| `agent-session-manager.ts` | Agent 会话管理：SDK 消息持久化、会话元数据 CRUD、JSONL 存储 |
| `agent-prompt-builder.ts` | Agent 系统提示词构建：动态上下文、内置 Agent、工作区上下文注入 |
| `agent-permission-service.ts` | Agent 权限管理：工具权限检查、权限模式管理 |
| `agent-workspace-manager.ts` | 工作区管理：MCP Server 配置、Skills 配置、工作区 CRUD |
| `chat-service.ts` | Chat 流式调用编排：Provider 适配器集成、消息持久化、AbortController、function calling 工具循环（web_search 等） |
| `conversation-manager.ts` | 对话管理：对话 CRUD、JSONL 消息存储、置顶、上下文分割 |
| `channel-manager.ts` | 渠道管理：渠道 CRUD、API Key 加密（CryptoPort）、连接测试、模型获取 |
| `attachment-service.ts` | 附件管理：存储/读取/删除 |
| `office-preview-service.ts` | 文档解析：DOCX/XLSX/PPTX → HTML、PDF/图片 base64 |
| `automation-manager.ts` | 自动化任务管理 |
| `web-search-service.ts` | 联网搜索/抓取（Tavily），Chat 工具与 Agent WebSearch/WebFetch 共用 |
| `chat-tool-executor.ts` | Chat 工具统一执行器：分发工具调用、推送工具活动事件 |

### AI Provider 适配器（`packages/core/src/providers/`）

基于适配器模式的多 Provider 支持，通过注册表统一管理：

- `ProviderAdapter` 接口：定义统一的 `sendMessage()` 流式方法
- `provider-registry.ts`：Provider 注册表，按 `providerId` 查找适配器
- `sse_reader.ts`：通用 SSE 流读取器（fetch + ReadableStream）

| Provider | 适配器 | API 协议 |
|----------|--------|----------|
| **Anthropic** | `anthropic-adapter.ts` | Messages API |
| **OpenAI** | `openai-adapter.ts` | Chat Completions |
| **DeepSeek** | `anthropic-adapter.ts` | Anthropic 兼容 |
| **智谱 AI** | `openai-adapter.ts` | OpenAI 兼容 |
| **MiniMax** | `anthropic-adapter.ts` | Anthropic 兼容 |
| **豆包** | `openai-adapter.ts` | OpenAI 兼容 |
| **通义千问** | `openai-adapter.ts` | OpenAI 兼容 |
| **Google** | `google-adapter.ts` | Generative Language API |
| **Custom** | `openai-adapter.ts` | 自定义 OpenAI 兼容端点 |

### Jotai 状态管理（`apps/web/src/renderer/atoms/`）

| Atom 文件 | 管理的状态 |
|-----------|-----------|
| `chat-atoms.ts` | 对话列表、当前消息、流式状态（Map 结构支持多对话并行）、模型选择、上下文设置、并排模式、思考模式、待上传附件 |
| `agent-atoms.ts` | Agent 会话列表、当前会话、流式状态、工作区选择、渠道选择、权限/AskUser 请求队列（按 sessionId Map） |
| `active-view.ts` | 主面板视图切换（'conversations' / 'settings'） |
| `app-mode.ts` | 应用模式（Chat / Agent） |
| `settings-tab.ts` | 设置面板当前标签页 |
| `theme.ts` | 主题模式（light / dark / system） |
| `user-profile.ts` | 用户档案（姓名 + 头像） |
| `auth.ts` | 当前用户、角色（`isAdminAtom` / `canManageAtom`） |

### 渲染进程组件架构（`apps/web/src/renderer/components/`）

- **`app-shell/`**：三面板布局（LeftSidebar | NavigatorPanel | MainContentPanel），侧边栏含模式切换、置顶对话、日期分组列表、流式指示器
- **`chat/`**：聊天核心 — ChatView、ChatHeader（模型选择/上下文设置）、ChatInput（Tiptap 富文本编辑器）、ChatMessages、ParallelChatMessages
- **`agent/`**：Agent 模式 — AgentView、AgentHeader、AgentMessages、ToolActivityItem、WorkspaceSelector、PermissionBanner/AskUserBanner
- **`settings/`**：设置面板 — GeneralSettings、AppearanceSettings、ChannelSettings、AgentSettings、McpServerForm、AboutSettings；含 `primitives/` 可复用表单组件
- **`file-browser/`**：文件浏览器
- **`ai-elements/`**：AI 展示组件 — Markdown 渲染、代码块、Mermaid 图、推理折叠、富文本输入
- **`diff/`**：文件预览面板（PreviewPanel/DiffTabContent/PreviewTabContent）
- **`ui/`**：Radix UI 组件（现代化设计，CSS 变量主题）

### 全局 Hooks（`apps/web/src/renderer/hooks/`）

| Hook | 职责 |
|------|------|
| `useGlobalAgentListeners` | 全局 Agent WS 监听器，在 `main.tsx` 顶层挂载，使用 `useStore()` 直接操作 atoms。处理流式事件、完成/错误、标题更新、权限请求、AskUser 请求，永不随组件卸载销毁 |
| `useBackgroundTasks` | 后台任务管理（Agent/Shell 任务的增删改查），按 sessionId 隔离 |

### 渲染进程初始化（`apps/web/src/renderer/main.tsx`）

| 组件 | 职责 |
|------|------|
| `ThemeInitializer` | 主题设置加载、监听系统主题变化（matchMedia + BroadcastChannel）、同步到 DOM |
| `AgentSettingsInitializer` | 加载 Agent 渠道/模型/工作区设置、订阅 MCP/文件变化事件 |
| `AgentListenersInitializer` | 挂载 `useGlobalAgentListeners` |

### 本地文件存储（`~/.proma-web/`）

```
~/.proma-web/
├── channels.json           # 渠道配置（API Key 经 CryptoPort 加密）
├── conversations.json      # 对话索引
├── conversations/          # 消息存储（每对话一个 JSONL）
├── agent-sessions.json     # Agent 会话索引
├── agent-sessions/         # Agent 会话消息存储
├── agent-workspaces/       # Agent 工作区（按 slug 隔离）
├── attachments/            # 附件文件
├── users/{userId}/         # 多用户隔离层（会话目录/sdk-config/等按 userId 分层）
├── audit.jsonl             # 审计日志（adminOnly 操作）
├── user-profile.json
├── settings.json
└── default-skills/         # 播种的默认 Skills
```

**关键设计**：
- JSON 配置 + JSONL 追加日志，无本地数据库，文件可移植
- Web 独立数据根 `~/.proma-web/`（与历史桌面端 `~/.proma/` 隔离，迁移时复制而非移动）
- 多用户：会话归属 userId + API 鉴权 + 存储分层（`users/{userId}/`）；工作区团队共享
- MCP 配置和 Skills 按工作区管理

## Agent Runtime 架构

Proma 的 Agent 模式通过 `RuntimeRoutingAgentAdapter` 统一入口，路由到 **Pi Agent 适配器**：

```text
用户输入 → AgentOrchestrator
  → RuntimeRoutingAgentAdapter
    └→ PiAgentAdapter → Pi Agent SDK (@earendil-works/pi-coding-agent)
  → SDKMessage 兼容消息流 → EventBus / WS → Jotai / React
```

- **Pi Runtime（唯一）**：`PiAgentAdapter`（`packages/server-core/src/adapters/pi-agent-adapter.ts`）使用 `@earendil-works/pi-coding-agent`。通过 `pi-model-registry.ts` 将任意已启用的 Proma 渠道注册为运行时 provider，覆盖 OpenAI Chat Completions / Responses、Google Generative AI 与 Anthropic Messages 协议。
- **会话语义**：会话元数据持久化 `agentRuntime` 与 `sdkSessionId`。切换 runtime 时必须清除旧的 `sdkSessionId`，以免跨 SDK resume；Proma 的 JSONL 消息仍保留并作为历史上下文回填。
- **共享能力**：复用工作区、权限服务、AgentEventBus、SDKMessage 持久化、Skills 与 Proma 内置 Automation / Collaboration 工具。用户 MCP Server 经 `adapters/pi-mcp-tools.ts` 连接并转换为 Pi custom tools。
- **运行时资源**：会话结束/取消时清理资源；不要绕开 `PiAgentAdapter` 或 `cleanupPiRuntimeResources()`。

### 修改 Agent 行为时的检查清单

1. 新增或修改工具时，检查 Pi 的 `defineTool()` / custom-tool 桥接（`pi-mcp-tools.ts`、`pi-builtin-tools.ts`）。
2. 新增模型渠道时，同时检查 `packages/shared/src/types/channel.ts` 与 `pi-model-registry.ts` 的协议、鉴权头、Base URL 映射。
3. 修改路由时同步更新 shared 类型（`PromaClientAPI`）、server handler、shim `migrated.ts`、renderer 调用。
4. 涉及多用户 scope 时，确保路由传 `getUserScope(c)` 且文件操作经 `assertAttachedPathAllowed`。

## 代码风格

- 永远不要使用 `any` 类型 — 创建合适的 interface
- 对象类型优先使用 interface 而不是 type
- 尽可能使用 `import type` 进行仅类型导入
- 注释和日志采用中文，保留专业术语
- **路径别名**：`@/` → `apps/web/src/renderer/`

## TypeScript 配置

- Module: `"Preserve"` + `"moduleResolution": "bundler"`
- JSX: `"react-jsx"`，严格模式启用，Target: ESNext
- 所有包 `"type": "module"`，导入时使用 `.ts` 扩展名

## 版本管理

提交代码时始终递增受影响包的 patch 版本（如 `0.1.18` → `0.1.19`），影响多个包则都要递增。

### 默认 Skills 版本契约（`apps/web/default-skills/` 或 server 播种源）

修改任何 `default-skills/<skill>/` 内容时，**必须同步递增该 Skill `SKILL.md` frontmatter 的 `version` 字段**（patch +1）。

**为什么**：`seedDefaultSkills()` 与 `upgradeDefaultSkillsInWorkspaces()` 通过 semver 比较决定是否将 bundle 中的 Skill 同步到老用户。**version 不变 = 老用户拿不到新内容**。

## 创作参考

遵循 [craft-agents-oss](https://github.com/craftship/craft-agents-oss) 的模式：

- **会话管理**：收件箱/归档工作流
- **权限模式**：safe / ask / allow-all
- **Agent Runtime**：Pi Agent SDK（`@earendil-works/pi-*`）
- **MCP 集成**：Model Context Protocol 用于外部数据源
- **凭证存储**：CryptoPort 加密（生产强制 PROMA_SERVER_MASTER_KEY）
- **配置位置**：`~/.proma-web/`

## 核心特性

### 已实现功能

- ✅ **多 Provider 支持**：Anthropic、OpenAI、DeepSeek、Kimi、智谱、MiniMax、豆包、通义千问、Google、自定义端点
- ✅ **Pi Agent Runtime**：Pi Agent SDK，统一路由、消息协议与权限桥接
- ✅ **多用户隔离**：JWT 认证 + 角色（admin/user）+ 数据 scope 分层 + WS 订阅鉴权
- ✅ **工作区管理**：多工作区隔离、MCP Server 配置、Skills 管理
- ✅ **权限系统**：工具权限检查、用户确认流程
- ✅ **运维可观测**：结构化 logger、`/api/metrics`、审计日志（audit.jsonl）
- ✅ **代理支持**：系统代理检测与配置
- ✅ **文档解析**：PDF、Office、文本文件提取（server-core office-preview-service）
- ✅ **多模态支持**：图片、文档附件
- ✅ **联网搜索**：Chat 与 Agent 双模式内置 web_search（Tavily 集成）——Chat 走 function calling 工具循环、Agent 走 Pi customTools（WebSearch/WebFetch），设置页配置 API Key + 开关后生效
- ✅ **Chat 工具**：内置工具系统 + 动态加载

### 架构亮点

- **并发守卫**：同一会话防止并行请求冲突
- **全局监听**：Agent WS 监听器永不销毁，确保后台会话不丢失
- **权限排队**：按 sessionId 隔离权限请求，支持多会话并行
- **文件监听**：工作区文件、MCP 配置、Chat 工具实时监控（macOS 原生 recursive / Linux 逐目录递归）
- **事件流处理**：SDK 消息流式转换与累积
- **错误映射**：SDK 错误统一转换为应用错误
- **shim 渐进迁移**：renderer 零改动，逐通道迁移到 HTTP/WS

## IPC 迁移看板

`docs/plans/api-migration-board.md` 维护全量通道（命名 280+ / 未命名 21）的迁移状态：✅ 已迁移 / ⏳ 未迁移 / 🔧 降级 / 🚫 Out（桌面专属不迁移）/ 🗑 随桌面移除。每完成一个通道在此标 ✅。
