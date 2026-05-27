# 配置说明

本文说明项目本地开发和演示所需的环境变量。前端和后端都从仓库根目录 `.env` 读取配置；模板文件为 `.env.example`。

## 配置读取关系

```mermaid
flowchart LR
  ENV[".env"] --> DC["docker-compose.yml"]
  ENV --> BE["backend/app/core/config.py"]
  ENV --> FE["frontend/vite.config.ts envDir='..'"]
  FE --> BROWSER["Vite import.meta.env"]
  BE --> API["FastAPI settings"]
```

前端 Vite 配置了：

```ts
envDir: '..'
```

因此前端会读取仓库根目录 `.env`。只有以 `VITE_` 开头的变量会暴露给浏览器。

## 数据库配置

```env
POSTGRES_DB=taxi_vis
POSTGRES_USER=taxi_user
POSTGRES_PASSWORD=taxi_pass
POSTGRES_PORT=5432
DATABASE_URL=postgresql+psycopg2://taxi_user:taxi_pass@localhost:5432/taxi_vis
```

| 变量 | 说明 |
|---|---|
| `POSTGRES_DB` | 数据库名。 |
| `POSTGRES_USER` | 数据库用户名。 |
| `POSTGRES_PASSWORD` | 数据库密码。 |
| `POSTGRES_PORT` | 暴露到宿主机的数据库端口。 |
| `DATABASE_URL` | 后端本地运行时的数据库连接串。Docker Compose 中会覆盖为连接 `postgis:5432`。 |

## Redis 配置

```env
REDIS_PORT=6379
REDIS_URL=redis://localhost:6379/0
```

| 变量 | 说明 |
|---|---|
| `REDIS_PORT` | Redis 暴露到宿主机的端口。 |
| `REDIS_URL` | 后端本地运行时 Redis 地址。Docker Compose 中会覆盖为连接 `redis:6379`。 |

## FastAPI 配置

```env
APP_HOST=0.0.0.0
APP_PORT=8000
```

| 变量 | 说明 |
|---|---|
| `APP_HOST` | 后端监听地址。Docker 容器中通常为 `0.0.0.0`。 |
| `APP_PORT` | 映射到宿主机的后端端口。 |

Docker Compose 中后端实际命令为：

```text
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

`APP_PORT` 控制宿主机端口映射，例如 `${APP_PORT:-8000}:8000`。

## 前端配置

```env
VITE_API_BASE_URL=http://localhost:8000
VITE_DEMO_MODE=false
VITE_AMAP_KEY=your_amap_web_js_key_here
VITE_AMAP_SECURITY_JS_CODE=your_amap_security_js_code_here
```

| 变量 | 说明 |
|---|---|
| `VITE_API_BASE_URL` | 前端 axios 请求的后端基础地址。 |
| `VITE_DEMO_MODE` | `true` 时启用 axios mock adapter；`false` 时请求真实后端。 |
| `VITE_AMAP_KEY` | 高德地图 Web JS API Key。Demo 和完整模式都需要。 |
| `VITE_AMAP_SECURITY_JS_CODE` | 高德地图安全密钥。Demo 和完整模式都需要。 |

注意区分两个 Demo 概念：

| 名称 | 控制方式 | 说明 |
|---|---|---|
| 只读 Demo | 前端状态 `demoReadonly=true`，页面左侧 `DEMO` 标识 | 默认使用 `readonlyFixture.json`，不访问数据库。 |
| axios mock Demo | `.env` 中 `VITE_DEMO_MODE=true` | 请求被 `frontend/src/demo/mockApi.ts` 接管。 |

## AI 助手配置

```env
OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini
OPENAI_API_MODE=chat_completions
OPENAI_TIMEOUT_SECONDS=30
OPENAI_MAX_OUTPUT_TOKENS=900
```

| 变量 | 说明 |
|---|---|
| `OPENAI_API_KEY` | 可选。为空时 AI 助手只使用本地 Markdown RAG fallback。 |
| `OPENAI_BASE_URL` | OpenAI-compatible 服务的 `/v1` 地址。 |
| `OPENAI_MODEL` | 使用的模型名。 |
| `OPENAI_API_MODE` | `chat_completions` 或 `responses`。 |
| `OPENAI_TIMEOUT_SECONDS` | LLM 请求超时时间。 |
| `OPENAI_MAX_OUTPUT_TOKENS` | 最大输出 token。 |

AI 助手始终先检索本地 Markdown 文档；配置外部 LLM 后，只是在检索片段基础上生成更自然的回答。

## Docker 资源配置

`docker-compose.yml` 支持以下可选变量：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `BACKEND_CPUS` | `6.0` | 后端容器 CPU 限制。 |
| `BACKEND_MEM_LIMIT` | `8g` | 后端容器内存限制。 |
| `POSTGIS_CPUS` | `6.0` | PostGIS 容器 CPU 限制。 |
| `POSTGIS_MEM_LIMIT` | `8g` | PostGIS 容器内存限制。 |
| `POSTGIS_SHARED_BUFFERS` | `1GB` | PostgreSQL shared_buffers。 |
| `POSTGIS_WORK_MEM` | `64MB` | PostgreSQL work_mem。 |
| `REDIS_CPUS` | `1.0` | Redis CPU 限制。 |
| `REDIS_MEM_LIMIT` | `1g` | Redis 内存限制。 |

## 修改配置后的重启规则

| 修改内容 | 需要重启什么 |
|---|---|
| `VITE_*` 前端变量 | 重启前端 Vite。 |
| `DATABASE_URL`、`REDIS_URL` | 重启后端。 |
| Docker Compose 端口或资源限制 | 重启对应容器。 |
| 高德地图 Key | 重启前端并刷新浏览器。 |
| OpenAI-compatible 配置 | 重启后端。 |

## 安全注意

- 不要提交真实高德 Key、OpenAI Key 或数据库密码。
- 课程演示环境可以使用本地 `.env`；公开仓库应只保留 `.env.example`。
- 当前系统未实现 API 鉴权，不建议直接暴露到公网。
