# 常见问题 FAQ

## 1. 只想演示，需要启动后端吗？

不一定。只读 Demo 只需要启动前端，页面会使用内置演示数据，不访问 PostGIS 或 Redis。

```powershell
./scripts/start-frontend.ps1
```

如果要关闭 `DEMO` 使用真实接口，则需要启动后端：

```powershell
./scripts/start-dev.ps1 -Detach
```

## 2. 完整模式是不是只运行 start-dev.ps1 就够了？

不够。`start-dev.ps1` 只启动后端、PostGIS 和 Redis，不会自动导入原始 GPS、抽取 OSM 路网、跑 HMM 匹配或构建派生表。真实完整模式还需要按 `README.md` 运行 `data_scripts/` 数据链路。

## 3. 为什么页面打开后没有地图？

通常是高德地图 Key 未配置或不可用。检查 `.env`：

```env
VITE_AMAP_KEY=your_amap_web_js_key_here
VITE_AMAP_SECURITY_JS_CODE=your_amap_security_js_code_here
```

修改 `.env` 后需要重启前端。

## 4. Demo 和真实模式有什么区别？

| 模式 | 数据来源 | 特点 |
|---|---|---|
| Demo | 前端内置 fixture/mock | 不依赖数据库，适合演示 |
| 真实模式 | FastAPI + PostGIS | 使用真实数据和派生表，结果受时间范围、区域和数据构建情况影响 |

## 5. F1/F2 没有结果怎么办？

检查：

1. 是否关闭了 `DEMO`。
2. 后端 `/health` 是否正常。
3. `taxi_points` 是否有数据。
4. 查询的 taxi ID 和时间范围是否存在。
5. F2 是否已经生成 `matched_trips`。

## 6. F3 区域查询没有车辆怎么办？

可能原因：

- 区域画得太小或不在数据覆盖范围内。
- 时间范围没有车辆点。
- 真实模式下 `taxi_points` 未导入。
- Demo 模式下参数被固定，建议使用预设流程演示。

## 7. F4 网格密度和 H3 是什么关系？

当前 F4 后端主接口是米制网格密度 `/api/v1/analytics/f4-grid-density`，不是旧版 H3 base-density。F6 中仍可能用 H3 做外部区域聚合，但 F4 的主展示是 Web Mercator 米制网格。

## 8. F5 的 A/B 区域怎么画？

先画 A 区域，再画 B 区域。两个区域不要完全重叠，建议覆盖真实道路和轨迹点。最大转移时间不要太小，否则会漏掉 A 到 B 的出行。

## 9. F6 strict_od 和 through_flow 有什么区别？

| 模式 | 判断依据 | 适合问题 |
|---|---|---|
| `strict_od` | trip 起点和终点 | “从核心区出发/到达核心区的流量” |
| `through_flow` | 轨迹是否经过核心区 | “哪些车流穿过核心区” |

## 10. F7/F8 没有结果怎么办？

优先检查派生表是否构建：

- `matched_trips`
- `matched_trip_edges`
- `matched_trip_road_passes`
- `matched_road_hourly_counts`
- `matched_road_group_hourly_counts`
- `trip_spatial_index`
- `trip_grid_points`
- `trip_token_sequence`
- `trip_edge_sequence_cache`
- `road_edge_feature_cache`

还要检查 A/B 区域、时间范围、Top-K 和候选模式。

## 11. F9 为什么没有单独后端接口？

F9 是前端推荐层。它基于 F8 返回的路线候选，在前端按 `fastest`、`stable`、`frequent_fast` 三种策略排序。因此必须先运行 F8，F9 才有候选路线可以推荐。

## 12. AI 助手没有调用大模型怎么办？

如果没有配置 `OPENAI_API_KEY`，AI 助手会使用本地 Markdown RAG fallback，这是正常行为。需要 LLM 时，配置 `.env` 中的 `OPENAI_API_KEY`、`OPENAI_BASE_URL` 和 `OPENAI_MODEL`，然后重启后端。

## 13. 可以执行 reset-dev.ps1 吗？

谨慎使用。`reset-dev.ps1` 会执行 `docker compose down -v`，删除 PostGIS 数据卷，真实数据和派生表会丢失。只想停止服务时使用：

```powershell
./scripts/stop-dev.ps1
```
