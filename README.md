# Proma Web（proma-web）

Proma Web 是一个**多用户 Web 部署形态**的通用 AI Agent 平台，是 [proma-ai/Proma](https://github.com/proma-ai/Proma)（上游，AGPL-3.0）的**衍生作品（fork）**：由上游的 Electron 桌面应用演化为「Bun + Hono 服务端 + Web 前端 + CLI」的服务化架构，支持多用户隔离、角色权限、Docker 一键部署。

它不是单纯的聊天框，而是一个可以长期沉淀个人/团队工作流的 Agent 工作台：简单问题用 Chat，复杂任务交给 Agent，数据与配置按用户隔离存储在服务端。

## 功能特性

- **Chat 多模型对话**：支持 Anthropic、OpenAI、DeepSeek、智谱、MiniMax、豆包、通义千问、Google 及自定义 OpenAI 兼容端点；多模态图片输入、文档解析、Markdown / Mermaid / KaTeX / 代码高亮。
- **Agent 工作台**：基于 Pi Agent SDK 的运行时；支持工作区隔离、权限模式（safe / ask / allow-all）、文件操作、长任务流式输出、计划确认与用户追问。
- **工作区 / Skills / MCP**：每个工作区独立配置 Skills、MCP Server 与工作区文件，支持团队沉淀可复用能力。
- **记忆与工具**：Chat 与 Agent 共享记忆能力，支持联网搜索、内置 Chat 工具。
- **多用户与权限**：JWT 认证、admin / 普通用户角色、按用户隔离的数据目录（`~/.proma-web/users/{userId}/`）、API Key 加密存储、操作审计日志。
- **CLI**：`proma session` 子命令（`list` / `info` / `outline` / `search` / `export`），面向有限上下文的 Agent 消费者提供会话渐进式读取。
- **部署**：单镜像 Docker 部署，服务端同源托管前端静态资源。

## 快速开始

### 本地开发

```bash
bun install
bun run dev        # 自动启动 server（:3000）+ web（Vite :5174，注入 electronAPI shim）
```

开发模式需设置 `PROMA_DEV=1`（`bun run dev` 已内置）。生产模式强制要求以下环境变量（缺失即拒绝启动）：

```bash
PROMA_JWT_SECRET          # JWT 签名密钥（openssl rand -hex 32）
PROMA_SERVER_MASTER_KEY   # 渠道 API Key 加密主密钥（32 字节 hex/base64）
PROMA_ADMIN_PASSWORD      # admin 首启密码
```

### Docker 部署

```bash
bun run docker:build        # 本地构建（tag = proma:local）
bun run docker:build:prod   # 生产构建（linux/amd64，tag = <git-sha>）
```

容器默认 `EXPOSE 3000`，数据根 `PROMA_DATA_ROOT=/data`。

### CLI

```bash
bun run --filter='@proma/cli' build   # 编译 dist/proma
./apps/cli/dist/proma session list    # 会话列表
./apps/cli/dist/proma session info <id>
./apps/cli/dist/proma session search <关键词>
./apps/cli/dist/proma session export <id>
```

## 架构

```
apps/
├── server/   # Bun + Hono Web 服务端：JWT 认证、角色权限、WebSocket 实时事件、路由层（chat/agent/channel/settings/upload/storage/automation/file…）
├── web/      # Vite + React 前端：复用 renderer 源码 + electronAPI shim（约 300 个方法）接入服务端
└── cli/      # Proma CLI：会话渐进式读取
packages/
├── server-core/   # 从桌面端剥离的纯业务引擎（零 Electron 依赖）
├── session-core/  # 会话核心
├── core/          # AI Provider 适配器（Anthropic/OpenAI/Google 协议）、代码高亮
├── shared/        # 共享类型、IPC 通道常量
└── ui/            # 共享 UI 组件
```

数据存储：JSON 配置 + JSONL 追加日志，无本地数据库。Web 多用户模式下数据根为 `~/.proma-web/`（`PROMA_DATA_ROOT` 可覆盖）。

## 开发命令

```bash
bun run dev          # 开发模式（server + web）
bun run typecheck    # 全仓类型检查
bun test             # 测试
bun run docker:build # Docker 镜像构建
```

## 技术栈

| 层级 | 技术 |
|------|------|
| 运行时 | Bun 1.2.5+ |
| 服务端 | Hono + 原生 WebSocket |
| 前端 | React 18 + Vite + Tailwind CSS + Radix UI |
| 状态管理 | Jotai |
| Agent SDK | @anthropic-ai/claude-agent-sdk、@earendil-works/pi-* |
| 认证 | JWT（admin / user 角色） |

## 贡献

欢迎提交 Issue 与 Pull Request。向本项目提交 PR 即视为同意将贡献以 [AGPL-3.0](./LICENSE) 授权给项目维护者。

## 致谢

- 上游项目：[proma-ai/Proma](https://github.com/proma-ai/Proma) —— 本项目的 fork 来源与功能基石。
- [Beautiful Mermaid](https://github.com/lukilabs/beautiful-mermaid) 与 [Mermaid](https://mermaid.js.org/)：图表渲染。
- [Craft Agents OSS](https://github.com/lukilabs/craft-agents-oss)：Agent SDK 集成模式参考。

## 许可证

本项目是 [proma-ai/Proma](https://github.com/proma-ai/Proma)（AGPL-3.0）的衍生作品，遵循 [GNU Affero General Public License v3.0](./LICENSE)（与上游一致）开源。

- **衍生声明**：本项目 fork 自上游桌面应用，代码经过 Web 服务化改造（多用户、角色权限、CLI、Docker 部署），完整源码见本仓库。
- **网络服务条款**：依据 AGPL-3.0 第 13 条，任何通过网络与本服务交互的用户均可免费获取本项目完整源码（本仓库即源码，获取不收取任何费用）。
- **商业授权**：如需要将本项目用于无法满足 AGPL-3.0 条款的闭源 / SaaS 场景，请参照上游 [proma-ai/Proma](https://github.com/proma-ai/Proma) 的商业授权渠道（联系上游维护者）。
