# Proma Web (proma-web)

Proma Web is a **multi-user web-deployed AI agent platform** — a derivative work (fork) of [proma-ai/Proma](https://github.com/proma-ai/Proma) (upstream, AGPL-3.0). It evolved from the upstream Electron desktop app into a service-oriented architecture: **Bun + Hono server + Web frontend + CLI**, with multi-user isolation, role-based permissions, and one-image Docker deployment.

## Features

- **Chat with multiple models**: Anthropic, OpenAI, DeepSeek, Zhipu, MiniMax, Doubao, Qwen, Google, and custom OpenAI-compatible endpoints; multimodal image input, document parsing, Markdown / Mermaid / KaTeX / code highlighting.
- **Agent dual runtime**: Claude Agent SDK and Pi Agent SDK; workspace isolation, permission modes (safe / ask / allow-all), file operations, streaming long tasks, plan confirmation and follow-up questions.
- **Workspaces / Skills / MCP**: per-workspace Skills, MCP servers and workspace files.
- **Remote bot bridges**: Feishu / DingTalk / WeChat bots to trigger agent workflows from mobile or group chat.
- **Memory & tools**: shared memory for Chat and Agent, web search, built-in chat tools.
- **Multi-user & permissions**: JWT auth, admin/user roles, per-user data isolation (`~/.proma-web/users/{userId}/`), encrypted API keys, audit log.
- **CLI**: `proma session` subcommands (`list` / `info` / `outline` / `search` / `export`) for progressive reading of sessions.
- **Deployment**: single-image Docker, server serves the frontend static assets.

## Quick Start

```bash
bun install
bun run dev        # starts server (:3000) + web (Vite :5174 with electronAPI shim)
```

Production requires: `PROMA_JWT_SECRET`, `PROMA_SERVER_MASTER_KEY`, `PROMA_ADMIN_PASSWORD`.

Docker:

```bash
bun run docker:build        # local build
bun run docker:build:prod   # production build (linux/amd64)
```

The container exposes port `3000` by default with data root `PROMA_DATA_ROOT=/data`.

## Architecture

```
apps/
├── server/   # Bun + Hono: JWT auth, roles, WebSocket events, routes (chat/agent/channel/settings/upload/storage/automation/file…)
├── web/      # Vite + React: renderer source + electronAPI shim (~300 methods)
└── cli/      # Proma CLI: progressive session reading
packages/
├── server-core/   # pure business engine (zero Electron dependency)
├── session-core/  # session core
├── core/          # AI provider adapters, code highlighting
├── shared/        # shared types, IPC channel constants
└── ui/            # shared UI components
```

Data: JSON config + JSONL append logs, no local database. Web data root: `~/.proma-web/` (overridable via `PROMA_DATA_ROOT`).

## License

This project is a derivative work of [proma-ai/Proma](https://github.com/proma-ai/Proma) (AGPL-3.0) and is licensed under the [GNU Affero General Public License v3.0](./LICENSE).

Per AGPL-3.0 Section 13, all users interacting with this service over a network are entitled to obtain the complete corresponding source at no charge (this repository is the source). For commercial licensing outside AGPL terms, please refer to the upstream project's commercial license channel.
