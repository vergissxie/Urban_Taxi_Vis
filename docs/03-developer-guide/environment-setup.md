# 开发环境搭建

本文说明开发者如何准备本地环境。若只是演示，只需启动前端并使用只读 Demo；若要调试真实接口，需要 Docker、PostGIS 和 Redis。

## 环境要求

| 工具 | 建议版本 | 用途 |
|---|---|---|
| Windows PowerShell | Windows 自带 | 执行项目脚本。 |
| Docker Desktop | 支持 Docker Compose v2 | 启动后端、PostGIS、Redis。 |
| Node.js | 18+ | 运行前端 Vite 项目。 |
| npm | 与 Node.js 匹配 | 安装前端依赖。 |
| Git | 可选 | 版本管理。 |
| Python | 可选 | 本地直接运行数据脚本或语法检查；Docker 模式下非必须。 |

前端依赖包含 React、Vite、TypeScript、Ant Design、Tailwind、h3-js、axios 等。后端 Python 依赖见 `backend/requirements.txt`。

## 打开项目

进入项目根目录：

```powershell
cd E:\Projects\driver_system
```

确认核心目录存在：

```powershell
Get-ChildItem
```

应能看到 `backend`、`frontend`、`data_scripts`、`docs`、`docker-compose.yml` 等。

## 准备 `.env`

```powershell
Copy-Item .env.example .env
```

然后检查：

- `VITE_API_BASE_URL=http://localhost:8000`
- `VITE_DEMO_MODE=false`
- `VITE_AMAP_KEY` 和 `VITE_AMAP_SECURITY_JS_CODE`
- `POSTGRES_*`、`REDIS_*`、`APP_PORT`

如果只是前端只读 Demo，后端数据库变量不会立即影响页面；但地图 Key 仍然影响地图加载。

## 安装前端依赖

```powershell
cd frontend
npm install
cd ..
```

验证类型检查：

```powershell
cd frontend
npm run typecheck
cd ..
```

## 启动前端开发服务器

```powershell
./scripts/start-frontend.ps1
```

默认地址：

```text
http://localhost:5173
```

打开后默认是只读 Demo 状态，可以不启动后端直接查看固定样例。

## 启动后端开发环境

```powershell
./scripts/start-dev.ps1 -Detach
```

检查服务：

```powershell
docker compose ps
```

检查接口：

```text
http://localhost:8000/health
http://localhost:8000/docs
```

## 本地 Python 检查

如果本机 Python 可用，可以运行：

```powershell
python -m py_compile backend/app/api/analytics.py backend/app/api/trajectory.py backend/app/api/matched.py backend/app/api/assistant.py
```

如果本机 Python 环境不可用，可以改在后端容器内执行等价检查。

## 推荐开发顺序

1. 先启动前端，确认 UI 和只读 Demo 正常。
2. 启动 Docker 后端，确认 `/health` 正常。
3. 用 Swagger 测试单个接口。
4. 再到前端退出 `DEMO`，验证真实接口链路。
5. 修改接口后运行 `npm run typecheck` 和 Python 编译检查。
6. 修改文档后检查 Markdown 链接和 Mermaid 图。

## F1-F9 开发注意

| 功能 | 主要注意事项 |
|---|---|
| F1 | 不要把原始轨迹接口写成实时导航；它从 `taxi_points` 连线并切段。 |
| F2 | 匹配轨迹来自离线 `matched_trips`，不是请求时实时匹配。 |
| F3 | 多矩形统计要注意并集去重。 |
| F4 | 当前主接口是 `f4-grid-density`。 |
| F5 | 注意最大转移时间和缓冲距离的参数边界。 |
| F6 | 区分 `strict_od` 与 `through_flow`。 |
| F7 | 优先用道路小时聚合表，缺表时回退。 |
| F8 | 注意候选模式、支持度、缓存表和返回兼容字段。 |
| F9 | 在前端 `GeoWorkbenchDecisionPanel.tsx` 排序 F8 候选，不新增后端 time-bucket 接口。 |

## 停止环境

停止 Docker 服务：

```powershell
./scripts/stop-dev.ps1
```

停止前端：在前端终端按 `Ctrl+C`。
