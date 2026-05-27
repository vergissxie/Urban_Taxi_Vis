# Urban Taxi Vis 北京出租车轨迹分析与可视化系统

Urban Taxi Vis 是一个面向北京出租车 GPS 数据的轨迹查询、空间统计、道路匹配、路径挖掘和 AI 助手问答系统。项目采用前后端分离架构：前端是 React/Vite 地图分析工作台，后端是 FastAPI API 服务，数据层使用 PostgreSQL/PostGIS 存储轨迹点、路网、地图匹配结果和派生缓存表。

## 演示视频

- [观看完整前端演示视频](./docs/media/demo-video.mp4)

## 功能范围

| 编号 | 功能 |
|---|---|
| F1 | 原始轨迹查询与折线展示 |
| F2 | 离线地图匹配轨迹展示 |
| F3 | 多矩形区域活跃车辆查询 |
| F4 | 米制网格密度分析 |
| F5 | A/B 区域流向与阈值推荐 |
| F6 | 区域辐射流分析 |
| F7 | 高频道路走廊挖掘 |
| F8 | A/B 高频路线挖掘 |
| F9 | 基于 F8 结果的前端策略推荐 |
| AI | Markdown RAG + 可选 OpenAI-compatible LLM 项目助手 |

## 技术栈

| 层次 | 技术 |
|---|---|
| 前端 | React 18、Vite、TypeScript、Ant Design、高德地图 JS API |
| 后端 | FastAPI、SQLAlchemy、Pydantic Settings、Uvicorn |
| 数据库 | PostgreSQL、PostGIS |
| 缓存/辅助服务 | Redis、进程内 TTL 缓存 |
| 数据处理 | Pandas、GeoPandas、pyrosm、H3、HMM/Viterbi |
| 容器 | Docker、Docker Compose |

## 运行模式

项目有三种常见运行方式，请先区分清楚：

| 模式 | 需要启动 | 是否需要真实数据库 | 用途 |
|---|---|---:|---|
| 只读 Demo | 前端 | 否 | 课程演示、无需导入数据 |
| 应用服务模式 | 后端 + PostGIS + Redis + 前端 | 可以为空 | 联调接口、看 Swagger、开发 UI |
| 真实完整模式 | 应用服务 + 数据脚本链路 | 是 | F1-F8 使用真实出租车数据计算，F9 基于 F8 推荐 |

`scripts/start-dev.ps1` 只负责启动后端、PostGIS 和 Redis，不会自动导入原始 GPS、抽取 OSM 路网、跑 HMM 地图匹配或构建 F7/F8 派生表。真实完整模式必须另外运行 `data_scripts/` 中的数据脚本，或者提前提供已经构建好的 PostGIS 数据卷/数据库导出。

## 前后端部署脚本

从项目根目录执行。

1. 创建环境变量文件：

```powershell
Copy-Item .env.example .env
```

2. 启动后端、PostGIS、Redis：

```powershell
./scripts/start-dev.ps1 -Detach
```

等价于：

```powershell
docker compose up -d --build
```

3. 第一次运行前端前安装依赖：

```powershell
cd frontend
npm install
cd ..
```

4. 启动前端开发服务器：

```powershell
./scripts/start-frontend.ps1
```

默认访问地址：

| 服务 | 地址 |
|---|---|
| 前端页面 | http://localhost:5173 |
| 后端 Swagger | http://localhost:8000/docs |
| 健康检查 | http://localhost:8000/health |

常用辅助脚本：

| 脚本 | 作用 |
|---|---|
| `scripts/start-dev.ps1 -Detach` | 后台启动 backend、PostGIS、Redis |
| `scripts/start-frontend.ps1` | 启动 Vite 前端，默认端口 5173 |
| `scripts/stop-dev.ps1` | 停止容器，不删除 PostGIS 数据卷 |
| `scripts/reset-dev.ps1` | 停止并删除数据卷，会清空数据库 |
| `scripts/load-image-env.ps1` | 从 `.env` 加载 OpenAI-compatible 相关环境变量 |

## Demo 模式

Demo 模式只需要前端和高德地图 Key。页面默认有只读 Demo fixture；如果想让 axios 请求也走前端 mock，可以在 `.env` 中设置：

```env
VITE_DEMO_MODE=true
```

然后启动前端：

```powershell
./scripts/start-frontend.ps1
```

Demo 模式不会访问 PostGIS，因此不需要运行数据脚本。

## 真实完整模式

真实完整模式需要先启动服务，再跑数据链路。运行前请确认：

| 资源 | 默认位置 |
|---|---|
| 原始出租车 GPS 日志 | `data/raw/taxi_log_2008_by_id/` |
| OSM PBF 路网文件 | `data/beijing-260401.osm.pbf` |
| 清洗输出目录 | `data/processed/cleaned_data/`，容器内映射为 `/app/cleaned_data` |

推荐顺序如下。全量数据会运行很久，验收前不要随意执行 `reset-dev.ps1`。

```powershell
./scripts/start-dev.ps1 -Detach
```

1. 清洗原始 GPS，并按时间间隔切分 trip：

```powershell
docker compose exec backend python data_scripts/clean_to_folder_speed_filter.py `
  --input-dir /app/taxi_log_2008_by_id `
  --output-dir /app/cleaned_data `
  --trip-gap-minutes 30 `
  --max-speed-kmh 130 `
  --speed-filter-rounds 3 `
  --overwrite
```

2. 导入 `taxi_points`：

```powershell
docker compose exec backend sh -lc 'python data_scripts/to_postgis.py --input-dir /app/cleaned_data --schema /app/data_scripts/schema.sql --host postgis --port 5432 --db "$POSTGRES_DB" --user "$POSTGRES_USER" --password "$POSTGRES_PASSWORD" --truncate'
```

3. 抽取 OSM 路网到 `road_edges`、`road_nodes`：

```powershell
docker compose exec backend python data_scripts/extract_road_network.py `
  --pbf-file /app/data/beijing-260401.osm.pbf
```

4. 离线地图匹配，生成 `matched_trips`：

```powershell
docker compose exec backend python data_scripts/batch_map_match.py `
  --workers 8 `
  --auto-downgrade-workers `
  --min-workers 2
```

小样本冒烟可先加 `--limit 20`。

5. 构建 F6/F7/F8/F9 上游派生表：

```powershell
docker compose exec backend python data_scripts/build_trip_od_cache.py --rebuild
docker compose exec backend python data_scripts/build_matched_trip_edges.py --rebuild
docker compose exec backend python data_scripts/build_matched_trip_road_passes.py --rebuild
docker compose exec backend python data_scripts/build_matched_road_hourly_counts.py --rebuild
docker compose exec backend python data_scripts/build_matched_road_group_hourly_counts.py --rebuild
docker compose exec backend python data_scripts/build_f8_trip_caches.py --rebuild
```

完成后关闭前端左侧 `DEMO`，或确保 `.env` 中：

```env
VITE_DEMO_MODE=false
```

然后重新启动前端。

## 数据脚本与功能对应

更详细的脚本归属表见 [data_scripts/README.md](./data_scripts/README.md)。

| 阶段 | 脚本 | 主要支撑 |
|---|---|---|
| 清洗 | `clean_to_folder_speed_filter.py` | F1-F6 基础数据；F2/F7/F8/F9 上游 |
| 导入 | `to_postgis.py` | `taxi_points` |
| 路网 | `extract_road_network.py` | F2、F7、F8 |
| 匹配 | `batch_map_match.py`，以及其依赖的 `map_match_taxi_id1.py` | F2、F7、F8 |
| OD 缓存 | `build_trip_od_cache.py` | F6、F7、F8 |
| 道路边序列 | `build_matched_trip_edges.py` | F7、F8 |
| 道路聚合 | `build_matched_trip_road_passes.py`、`build_matched_road_hourly_counts.py`、`build_matched_road_group_hourly_counts.py` | F7 |
| 路线缓存 | `build_f8_trip_caches.py` | F6 through-flow、F8、F9 |

## 验证命令

```powershell
docker compose ps
```

```powershell
cd frontend
npm run typecheck
cd ..
```

```powershell
python -m py_compile backend/app/api/analytics.py backend/app/api/trajectory.py backend/app/api/matched.py backend/app/api/assistant.py
```

数据表快速检查：

```powershell
docker compose exec postgis psql -U taxi_user -d taxi_vis -c "SELECT COUNT(*) FROM taxi_points;"
docker compose exec postgis psql -U taxi_user -d taxi_vis -c "SELECT COUNT(*) FROM matched_trips;"
docker compose exec postgis psql -U taxi_user -d taxi_vis -c "SELECT COUNT(*) FROM matched_trip_edges;"
```

## 项目结构

```text
driver_system/
├─ backend/              # FastAPI 后端
├─ frontend/             # React/Vite 前端
├─ data/                 # 原始数据、清洗结果、OSM PBF、导出数据
├─ data_scripts/         # 清洗、导入、地图匹配、派生表构建脚本
├─ docs/                 # 中文项目文档
├─ scripts/              # Windows PowerShell 启停脚本
├─ final/                # 报告、PPT、视频等提交材料
├─ docker-compose.yml    # backend / PostGIS / Redis 编排
└─ .env.example          # 环境变量示例
```

## 文档入口

- [文档总览](./docs/README.md)
- [项目介绍](./docs/01-overview/project-introduction.md)
- [功能清单](./docs/01-overview/feature-list.md)
- [用户操作说明](./docs/02-user-guide/user-manual.md)
- [开发环境搭建](./docs/03-developer-guide/environment-setup.md)
- [构建与运行说明](./docs/03-developer-guide/build-and-run.md)
- [系统架构说明](./docs/04-architecture/system-architecture.md)
- [核心技术说明](./docs/05-technical-notes/README.md)
- [最终提交材料](./final)
