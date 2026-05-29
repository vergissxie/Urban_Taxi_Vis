# 快速开始

本文面向第一次运行或验收演示的用户，说明如何打开系统、切换 Demo/真实模式，并快速体验 F1-F9 与 AI 助手。

## 运行方式

| 模式 | 需要启动 | 是否需要真实数据 | 适合场景 |
|---|---|---:|---|
| 只读 Demo | 前端 | 否 | 课堂演示、快速验收 |
| 应用服务模式 | 前端、后端、PostGIS、Redis | 可以为空 | 查看接口、前后端联调 |
| 真实完整模式 | 应用服务 + 数据脚本构建结果 | 是 | 使用真实出租车数据运行 F1-F8，F9 基于 F8 推荐 |

`DEMO` 是页面左侧的演示开关。打开 Demo 时使用前端内置样例；关闭 Demo 时请求真实 FastAPI 后端。

## 只运行前端 Demo

1. 创建环境变量文件：

```powershell
Copy-Item .env.example .env
```

2. 确认 `.env` 中高德地图 Key 可用：

```env
VITE_AMAP_KEY=your_amap_web_js_key_here
VITE_AMAP_SECURITY_JS_CODE=your_amap_security_js_code_here
```

3. 安装前端依赖：

```powershell
cd frontend
npm install
cd ..
```

4. 启动前端：

```powershell
./scripts/start-frontend.ps1
```

5. 打开页面：

```text
http://localhost:5173
```

端口被占用时可改用：

```powershell
./scripts/start-frontend.ps1 -Port 5174
```

## 启动后端服务

如果要关闭 Demo 使用真实接口，先启动后端、PostGIS 和 Redis：

```powershell
./scripts/start-dev.ps1 -Detach
```

检查容器：

```powershell
docker compose ps
```

常用地址：

| 服务 | 地址 |
|---|---|
| 前端页面 | http://localhost:5173 |
| 后端健康检查 | http://localhost:8000/health |
| Swagger 接口文档 | http://localhost:8000/docs |

注意：`start-dev.ps1` 只启动服务，不会自动导入数据。真实完整模式还要按 `README.md` 运行 `data_scripts/` 数据链路。

## 快速体验顺序

1. 打开页面，确认地图正常加载。
2. 保持 `DEMO` 打开，先体验固定演示数据。
3. 进入 F1/F2，查看原始轨迹和地图匹配轨迹。
4. 进入 F3-F6，依次体验区域查询、网格密度、A/B 流向、辐射流。
5. 进入 F7-F9，先运行 F7/F8，再查看 F9 推荐。
6. 打开 AI 助手，询问功能使用、算法参数或排错问题。

## 停止服务

停止 Docker 服务但保留数据库卷：

```powershell
./scripts/stop-dev.ps1
```

前端开发服务器在对应终端按 `Ctrl+C` 停止。

不要随意执行 `reset-dev.ps1`，它会删除 PostGIS 数据卷，已导入的数据会丢失。
