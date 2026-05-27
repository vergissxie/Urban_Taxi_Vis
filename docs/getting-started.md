# 快速启动项目

本文说明如何在本机启动 Urban Taxi Vis。项目当前有三种运行方式：默认只读 Demo、纯前端 mock Demo、完整后端模式。课程演示优先使用只读 Demo；需要验证真实数据库、真实 API 和数据处理链路时，再启动完整后端。

```mermaid
flowchart TD
  A["准备 .env"] --> B{"运行目标"}
  B --> C["只读 Demo<br/>默认 demoReadonly=true"]
  B --> D["纯前端 mock<br/>VITE_DEMO_MODE=true"]
  B --> E["完整后端<br/>Docker Compose"]
  C --> F["启动 Vite 前端"]
  D --> F
  E --> G["启动 backend + PostGIS + Redis"] --> F
  F --> H["打开 http://localhost:5173"]
```

## 运行方式选择

| 模式 | 是否需要后端 | 数据来源 | 适用场景 | 注意事项 |
|---|---:|---|---|---|
| 只读 Demo | 否 | `frontend/src/demo/readonlyFixture.json`，由本地真实后端导出的固定样例 | 课程提交、答辩演示、无数据库环境预览 | 工作台默认进入；参数锁定；不会运行后端计算。 |
| 纯前端 mock Demo | 否 | `frontend/src/demo/mockApi.ts` 的轻量模拟响应 | Docker 不可用、只想快速看界面 | 数据是手写 mock，不适合宣称为真实计算结果。 |
| 完整后端模式 | 是 | PostGIS、Redis、FastAPI、真实数据表和派生缓存表 | 技术答辩、验证算法、重建数据 | 需要 Docker、数据导入和地图匹配/派生表准备。 |

## 环境要求

| 类型 | 要求 |
|---|---|
| 操作系统 | Windows + PowerShell；脚本以 PowerShell 为主。 |
| 前端 | Node.js 18+，npm 可用。 |
| 后端容器 | Docker Desktop，支持 `docker compose`。 |
| 地图 | 浏览器可访问高德地图 Web JS API；`.env` 中需要 `VITE_AMAP_KEY` 和 `VITE_AMAP_SECURITY_JS_CODE`。 |
| 完整数据 | `data/`、`data_scripts/` 和 PostGIS 数据卷可用；若数据库为空，需要先跑数据流程。 |

## .env 配置

根目录 `.env.example` 是 Demo 和完整模式共用的环境变量模板。只读 Demo 由页面状态 `demoReadonly=true` 控制，默认不访问数据库；`VITE_DEMO_MODE=false` 是有意保留，这样退出只读 Demo 后可以切到真实后端。

关键变量如下：

```env
# PostGIS / Redis / FastAPI
POSTGRES_DB=taxi_vis
POSTGRES_USER=taxi_user
POSTGRES_PASSWORD=taxi_pass
POSTGRES_PORT=5432
APP_PORT=8000
REDIS_PORT=6379
DATABASE_URL=postgresql+psycopg2://taxi_user:taxi_pass@localhost:5432/taxi_vis
REDIS_URL=redis://localhost:6379/0

# Frontend / AMap
VITE_API_BASE_URL=http://localhost:8000
VITE_DEMO_MODE=false
VITE_AMAP_KEY=your_amap_web_js_key_here
VITE_AMAP_SECURITY_JS_CODE=your_amap_security_js_code_here

# Optional AI assistant relay
OPENAI_API_KEY=
OPENAI_BASE_URL=https://your-openai-compatible-endpoint/v1
OPENAI_MODEL=gpt-4o-mini
OPENAI_API_MODE=chat_completions
OPENAI_TIMEOUT_SECONDS=30
OPENAI_MAX_OUTPUT_TOKENS=900
```

> 安全提醒：真实 API Key、数据库密码不要提交到公开仓库。当前代码通过 Vite 只向浏览器暴露 `VITE_` 前缀变量。

## 方式一：只读 Demo（推荐课程演示）

只读 Demo 是当前工作台默认展示状态。前端启动后，左侧栏 `DEMO` 标识默认激活，F1-F9 使用固定样例和已导出的分析结果，参数输入被锁定。

1. 复制环境变量模板：

```powershell
Copy-Item .env.example .env
```

2. 填写高德地图 Key：

```env
VITE_AMAP_KEY=your_amap_web_js_key_here
VITE_AMAP_SECURITY_JS_CODE=your_amap_security_js_code_here
```

OpenAI-compatible 配置是可选项；`OPENAI_API_KEY` 留空时，AI 助手只使用本地 Markdown 文档检索回答。

3. 安装并启动前端：

```powershell
cd frontend
npm install
npm run dev -- --host localhost --port 5173
```

也可以从根目录使用脚本：

```powershell
./scripts/start-frontend.ps1
```

4. 打开浏览器：

```text
http://localhost:5173
```

只读 Demo 中可以使用地图工具栏的 F1-F9 快捷按钮切换准备好的样例图层。不要点击左侧 `DEMO` 按钮退出，除非你已经启动完整后端。

## 方式二：纯前端 mock Demo

如果希望所有 axios 请求都由前端 mock adapter 拦截，即使退出 `DEMO` 也不访问后端，可以设置：

```env
VITE_DEMO_MODE=true
VITE_API_BASE_URL=http://localhost:8000
```

然后启动前端：

```powershell
./scripts/start-frontend.ps1
```

该模式的数据来自 `frontend/src/demo/mockApi.ts`，适合临时展示交互，不适合讲真实数据统计值。mock 中的 AI 助手也只使用本地小型知识片段。

## 方式三：完整后端模式

完整模式会启动 FastAPI、PostGIS 和 Redis，前端调用真实接口。

1. 准备 `.env`：

```powershell
Copy-Item .env.example .env
```

2. 检查关键配置：

```env
POSTGRES_DB=taxi_vis
POSTGRES_USER=taxi_user
POSTGRES_PASSWORD=taxi_pass
POSTGRES_PORT=5432
APP_PORT=8000
REDIS_PORT=6379
VITE_API_BASE_URL=http://localhost:8000
VITE_DEMO_MODE=false
```

3. 启动后端、PostGIS、Redis：

```powershell
./scripts/start-dev.ps1 -Detach
```

等价于：

```powershell
docker compose up -d --build
```

4. 启动前端：

```powershell
./scripts/start-frontend.ps1
```

如果 5173 端口被占用：

```powershell
./scripts/start-frontend.ps1 -Port 5174
```

5. 打开工作台后点击左侧 `DEMO`，退出只读模式，开始调用真实后端。

## 本地访问地址

| 服务 | 地址 | 用途 |
|---|---|---|
| 前端工作台 | [http://localhost:5173](http://localhost:5173) | 地图可视化、F1-F9 操作、AI 助手。 |
| 后端根路径 | [http://localhost:8000](http://localhost:8000) | 返回后端运行提示、Swagger 和 health 路径。 |
| 后端 Swagger | [http://localhost:8000/docs](http://localhost:8000/docs) | 查看和调试 FastAPI 接口。 |
| 健康检查 | [http://localhost:8000/health](http://localhost:8000/health) | 检查后端、PostGIS、Redis 是否连通。 |
| PostGIS | `localhost:5432` | 数据库连接端口，账号密码来自 `.env`。 |
| Redis | `localhost:6379` | 缓存服务端口。 |

## 启动后自检

完整模式启动后建议依次执行：

```powershell
docker compose ps
```

期望看到 `taxi-backend`、`taxi-postgis`、`taxi-redis` 均处于运行或健康状态。

```powershell
Invoke-RestMethod http://localhost:8000/health
```

正常返回类似：

```json
{
  "status": "ok",
  "database": "ok",
  "redis": "ok"
}
```

然后打开 `http://localhost:8000/docs`，确认能看到 `/api/v1/trajectories/polylines`、`/api/v1/analytics/f4-grid-density`、`/api/v1/analytics/f8-ab-frequent-routes` 等接口。

## 停止与重置

停止容器：

```powershell
./scripts/stop-dev.ps1
```

如需重置开发环境，可使用：

```powershell
./scripts/reset-dev.ps1
```

注意：重置可能清理容器状态或数据卷。演示前如果数据库已经准备好，不要随意重置。

## 常见问题

| 问题 | 处理方式 |
|---|---|
| 前端地图空白 | 检查 `VITE_AMAP_KEY` 和 `VITE_AMAP_SECURITY_JS_CODE`，并确认浏览器能访问高德地图资源。 |
| 打开页面后一直是固定样例 | 这是默认只读 Demo；点击左侧 `DEMO` 可退出，但退出前必须启动完整后端。 |
| 前端请求真实后端失败 | 检查 `VITE_DEMO_MODE=false`、`VITE_API_BASE_URL=http://localhost:8000`、`docker compose ps` 和 `/health`。 |
| Swagger 打不开 | 查看 `docker compose logs backend`，确认 backend 容器是否启动成功。 |
| F1 没轨迹 | 确认输入 Taxi ID 在 `1-10357` 范围内，时间窗覆盖数据范围，`taxi_points` 已导入。 |
| F4 没网格 | 缩小地图视窗，检查 bbox 是否过大；确认 `taxi_points` 有空间索引和数据。 |
| F7/F8 没结果 | 检查 `matched_trips`、`matched_trip_edges`、`matched_trip_road_passes`、`matched_road_hourly_counts`、`matched_road_group_hourly_counts` 等派生表。 |
| F9 没独立按钮或接口 | 这是当前设计：F9 不再调用独立后端接口，而是在 F8 候选路线中按三种策略推荐。 |
