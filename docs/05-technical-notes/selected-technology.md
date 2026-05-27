# 核心技术选型

本页解释项目为什么选择这些技术，以及它们在当前代码中的真实落点。

## PostGIS

PostGIS 是项目的空间计算核心。选择它的原因是：出租车点、路网边、bbox、距离、相交关系都可以放到数据库侧计算，避免把大量点拉到后端内存中。

真实用法：

- `taxi_points.geom`、`road_edges.geometry`、`road_nodes.geometry` 都是 PostGIS geometry。
- F1 用 `ST_MakeLine`、`ST_Simplify` 生成折线。
- F2 用 `ST_AsGeoJSON` 输出匹配路线。
- F3/F5 用 `ST_Intersects` 和 `ST_DWithin` 判断点与区域关系。
- F4 用 `ST_Transform`、`ST_MakeEnvelope` 对齐米制网格边界。
- F7/F8 用 `ST_Length(...::geography)`、`ST_Intersects` 和道路几何拼接支持路径挖掘。

## FastAPI

后端 API 使用 FastAPI，入口在 `backend/app/main.py`。项目把路由拆成：

- `health`
- `trajectory`
- `analytics`
- `matched`
- `assistant`

FastAPI 的 Pydantic 参数约束在这里很关键。例如 F8 的 `max_candidate_trips` 限制为 `100-50000`，F4 的 `grid_size_m` 限制为 `100-3000`，可以在请求进入算法前挡住危险参数。

## SQLAlchemy Core

项目没有使用重 ORM 模型，而是用 SQLAlchemy Core 的 `text()` 执行明确 SQL。原因是这些分析任务高度依赖 CTE、窗口函数、PostGIS 函数、`LATERAL`、`jsonb_to_recordset`、`bindparam(expanding=True)` 等数据库能力。

真实例子：

- F1 的多段 CTE 轨迹折线。
- F5 的 A/B 状态机。
- F6 through-flow 的 LATERAL 查询。
- F8 的候选行程和 token 抽取 SQL。

这种方式牺牲了一些 ORM 抽象，但让查询计划和空间函数都更可控。

## PostgreSQL 派生缓存表

F7/F8 不直接在线扫全量原始点和路网，而是预先构建派生表：

- `matched_trip_edges`
- `matched_trip_road_passes`
- `matched_road_hourly_counts`
- `matched_road_group_hourly_counts`
- `trip_od_cache`
- `trip_spatial_index`
- `trip_grid_points`
- `trip_edge_sequence_cache`
- `road_edge_feature_cache`

这些表把“慢的几何匹配、道路边序列、OD 起终点、空间网格触达、道路元数据”提前固化。在线接口只做筛选、聚合、排序和少量几何组装。

## HMM / Viterbi 地图匹配

地图匹配选择 HMM/Viterbi，而不是简单最近道路吸附，是因为 GPS 点有漂移，单点最近道路不一定形成合理路线。HMM 同时考虑：

- GPS 点离候选节点的距离，发射概率。
- 相邻 GPS 点之间的路网距离和直线距离是否一致，转移概率。
- 全局最优候选序列，Viterbi 动态规划。

默认 `search_radius_m=250`、`max_candidates=6`、`sigma_z=80`、`beta=350`。匹配结果写入 `matched_trips` 后，再拆成 `matched_trip_edges` 供路径挖掘使用。

## Web Mercator 米制网格

F4 选择 Web Mercator 米制网格，而不是当前后端继续使用 H3，是因为网格边长以米为单位更直观，适合地图视窗内密度热力展示。

后端做法：

1. bbox 转 EPSG:3857。
2. 按 `grid_size_m` 对齐边界。
3. 点坐标转换到 3857。
4. 用 `floor(x/grid_size_m)`、`floor(y/grid_size_m)` 聚合。
5. 返回每个格子的 4326 边界、中心、点数。

前端仓库仍保留旧的 H3 worker 类型，但当前 F4 主接口是 `/api/v1/analytics/f4-grid-density`。

## H3

H3 当前主要用于 F6 辐射流的外部区域聚合。选择 H3 的原因是外部流向区域可能跨越较大范围，六边形索引更适合做 Top-K 区域汇总和边界绘制。

F6 默认 `h3_resolution=8`，后端兼容新旧 Python h3 API：

- `latlng_to_cell` 或 `geo_to_h3`
- `cell_to_latlng` 或 `h3_to_geo`
- `cell_to_boundary` 或 `h3_to_geo_boundary`

## Jaccard 相似图聚类

F8 选择 Jaccard token 聚类，而不是直接几何聚类，是因为 A/B 路线可能有轻微几何差异、采样差异和路网切分差异。将道路子路径抽象为主要道路 token 后，可以更稳定地识别“同一走廊”。

工程优化包括：

- 相同 token set 压缩。
- token 文档频率排序的 prefix index。
- bitmask 计算交集大小。
- 多阈值梯度自动选择。
- 连通分量形成 cluster。
- ordered feature 子簇拆分保留入口/出口变体。

## React / Vite / 高德地图

前端使用 React + Vite。地图渲染在 `frontend/src/pages/GeoSpatialWorkbench.tsx` 中集中协调，工具面板分为 overview、trajectory、region、decision。

高德地图用于实际交互展示。由于后端返回 WGS84，经前端绘制到高德底图前会做 WGS84 到 GCJ-02 的转换。F7/F8/F9 的线条样式、hover、focus、动画和单路线高亮都在前端完成。

## 进程内缓存

部分重查询使用 Python 进程内 dict 缓存：

- F4：60 秒。
- F6：45 秒。
- F7：45 秒。
- F8 完整响应：300 秒，最多 24 条。
- F8 sampled trip stage：300 秒，最多 8 条。

选择进程内缓存的原因是实现简单、延迟低，适合单后端进程或演示环境。限制是多进程/多实例之间不共享缓存，重启后缓存消失。

## AI 助手 RAG

AI 助手选择 Markdown RAG，是为了让回答和项目文档保持一致。核心设计：

- allowlist 只读取正式文档目录。
- 按 Markdown heading 分块。
- 中文 n-gram + 英文 token + F1-F9 编号 token。
- TF-IDF、heading boost、功能编号加权。
- 无 LLM 时本地 fallback。
- 有 API key 时调用 OpenAI-compatible 接口，并把 sources/meta 返回给前端。

这种设计比直接让 LLM “凭记忆回答项目”更可控，也能在无网络或无 API key 时提供基础可用性。

## 技术取舍总结

| 技术 | 解决的问题 | 主要代价 |
|---|---|---|
| PostGIS | 大规模空间过滤、距离、几何输出 | SQL 较复杂，需要维护索引 |
| HMM/Viterbi | GPS 到道路网络的合理匹配 | 离线计算成本较高，依赖路网质量 |
| 派生缓存表 | F7/F8 在线性能 | 需要额外构建流程和状态管理 |
| Web Mercator 网格 | 米制密度展示直观 | 高纬度形变存在，但北京范围可接受 |
| H3 | 外部区域聚合稳定 | 需要额外 Python 包 |
| Jaccard 聚类 | 高频路线抗噪识别 | token 规则复杂，需要质量过滤 |
| React + 高德地图 | 交互式分析体验 | 坐标系转换和前端状态较复杂 |
| Markdown RAG | 文档可信问答 | 文档质量直接决定回答质量 |

