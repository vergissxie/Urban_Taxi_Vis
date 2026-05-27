# 算法参数手册

本页集中列出 F1-F9、HMM 地图匹配、F8 聚类和 AI 助手的关键参数。默认值以当前代码为准。

## 数据清洗参数

代码：`data_scripts/clean_to_folder_speed_filter.py`

| 参数 | 默认值 | 作用 | 调大影响 | 调小影响 |
|---|---:|---|---|---|
| `--trip-gap-minutes` | `30` | 相邻点时间间隔超过该值切新行程 | 行程更长，可能把停车/断采样连在一起 | 行程更多更碎 |
| `--max-speed-kmh` | `130.0` | 删除超过该速度的当前点 | 保留更多高速/异常点 | 更严格删除跳点，但可能误删真实快速路点 |
| `--speed-filter-rounds` | `3` | 重算速度并重复过滤轮数 | 更彻底清异常，耗时更长 | 可能留下由坏点引起的二次异常 |
| `--min-dt-seconds` | `1.0` | 小于该时间差不做速度异常判断 | 减少短时间抖动误判 | 更可能把极短间隔点判为高速异常 |
| `--bbox` | 默认关闭 | 是否限制到北京保守 bbox | 打开后删除范围外点 | 关闭保留全国范围合法点 |
| `--stop-radius-m` | `200.0` | 停留簇半径 | 更容易合并停留点 | 停留簇更碎 |
| `--stop-minutes` | `20` | 停留最小时长 | 只保留更长停留 | 识别更多短暂停留 |

北京保守 bbox 常量：

```text
lon: 115.4 - 117.6
lat: 39.4 - 41.1
```

## F1 轨迹折线参数

代码：`backend/app/api/trajectory.py`

| 参数 | 默认值 | 约束 | 技术含义 |
|---|---:|---|---|
| `zoom` | `12` | `3-20` | 影响自动简化容差 |
| `use_zoom_simplify` | `true` | bool | 是否自动 `ST_Simplify` |
| `simplify_tolerance` | 空 | `>=0` | 手动覆盖容差 |
| `max_trips` | `300` | `1-5000` | 候选行程和返回折线上限 |
| `max_gap_minutes` | `40` | `1-240` | 超过时间间隔断段 |
| `max_jump_km` | `30.0` | `0.1-500` | 单段距离跳跃断段 |
| `max_speed_kmh` | `140.0` | `10-400` | 单段隐含速度超过则断段 |

自动容差：

```text
tolerance = max(0.00002, 0.2 / 2^clamp(zoom,3,20))
```

## HMM 地图匹配参数

代码：`data_scripts/map_match_taxi_id1.py`、`data_scripts/batch_map_match.py`

| 参数 | 默认值 | 位置 | 技术含义 |
|---|---:|---|---|
| `--max-points` | `200` | 两个脚本 CLI | 长轨迹下采样点数上限，控制 Viterbi 复杂度 |
| `--padding-deg` | `0.01` | 两个脚本 CLI | 按轨迹 bbox 外扩后选局部路网 |
| `search_radius_m` | `250.0` | `match_single_trip` / CLI | GPS 点候选节点搜索半径 |
| `max_candidates` | `6` | `match_single_trip` / CLI | 每个 GPS 点最多候选节点数 |
| `sigma_z` | `80.0` | HMM 固定默认 | 发射概率距离尺度 |
| `beta` | `350.0` | HMM 固定默认 | 转移概率距离差尺度 |
| `stationary_threshold_m` | `30.0` | `batch_map_match.py` | 累计位移低于该值标为 stationary |
| `GRID_SIZE_DEG` | `0.02` | `batch_map_match.py` | 道路边缓存网格 |
| `NODE_GRID_SIZE_DEG` | `0.002` | `batch_map_match.py` | 候选节点缓存网格 |

概率公式：

```text
emission = -0.5 * (distance_m / sigma_z)^2
transition = -abs(network_dist_m - straight_dist_m) / beta
```

调参建议：

- GPS 噪声大、候选经常为空：适当增大 `search_radius_m` 或 `sigma_z`。
- 匹配路线经常绕远：适当减小 `beta`，让网络距离更接近直线距离。
- 运行过慢：减小 `max_points` 或 `max_candidates`，但会降低匹配稳定性。
- 道路稀疏或路网缺口明显：可增大 `padding_deg`，但局部图变大后 Dijkstra 更慢。

## F3 参数

代码：`backend/app/api/analytics.py`

| 参数 | 默认值 | 约束 |
|---|---:|---|
| `taxi_id_min` | `1` | `1-10357` |
| `taxi_id_max` | `10357` | `1-10357` |
| `row_limit` | `10357` | `1-10357` |

F3 主要风险不是算法参数，而是 bbox 数量和时间窗过大导致扫描点数增加。

## F4 参数

| 参数 | 默认值 | 约束 | 影响 |
|---|---:|---|---|
| `grid_size_m` | `500` | `100-3000` | 越小越细，格子更多、查询更慢 |
| `include_vehicle_count` | `false` | bool | 打开后多算 `COUNT(DISTINCT taxi_id)` |
| `max_cells` | `3000` | `1-12000` | 限制返回格子数量 |
| `format` | `compact` | `compact/geojson` | GeoJSON 更重，compact 更适合前端渲染 |
| bbox 限制 | lon `<=0.8`，lat `<=0.6` | 固定 | 超过直接拒绝 |
| 缓存 TTL | `60s` | 固定 | 进程内缓存 |

## F5 参数

阈值推荐：

| 参数 | 默认值 | 约束 |
|---|---:|---|
| `pessimistic_mps` | `2.8` | `0.5-30` |
| `road_winding_factor` | `1.6` | `1.0-3.0` |
| `absolute_minimum_seconds` | `600` | `60-3600` |
| `absolute_maximum_seconds` | `7200` | `600-21600` |

A/B 流向：

| 参数 | 默认值 | 约束 |
|---|---:|---|
| `granularity` | `hour` | `hour/day` |
| `buffer_meters` | `30` | `0-200` |
| `max_transition_seconds` | `1800` | `60-21600` |

`max_transition_seconds` 太大，会把绕行、停留甚至无关经过也算作 A/B 转移；太小，会漏掉真实但慢速的转移。

## F6 参数

| 参数 | 默认值 | 约束 | 说明 |
|---|---:|---|---|
| `granularity` | `hour` | `hour/day` | 时间桶 |
| `direction` | `both` | `outbound/inbound/both` | 流向 |
| `analysis_mode` | `strict_od` | `strict_od/through_flow` | OD 或穿越流 |
| `h3_resolution` | `8` | `6-10` | 外部区域 H3 粒度 |
| `grid_size_m` | `1000` | `500-5000` | 当前保留参数，主聚合使用 H3 |
| `buffer_meters` | `30` | `0-200` | 核心区外扩 |
| `max_transition_seconds` | `3600` | `60-21600` | through-flow 出/入核心后外部点搜索窗口 |
| `top_k` | `30` | `1-100` | 返回外部区域数量 |
| `F6_TRIP_GRID_STEP_DEGREES` | `0.01` | 固定 | `trip_grid_points` 网格步长 |
| 缓存 TTL | `45s` | 固定 | 进程内缓存 |

H3 分辨率越高，区域越细，外部区域数量更多；越低，区域更粗但稳定。

## F7 参数

| 参数/常量 | 默认值 | 作用 |
|---|---:|---|
| `top_k` | `50` | 返回高频走廊数量 |
| `min_group_length_m` | `300` | 路名组长度过滤 |
| `max_trips` | `500` | 在线回退候选行程上限 |
| `scope` | `citywide` | 是否按 bbox 限制 |
| `sort_mode` | `frequency` | 频次或长度加权排序 |
| `F7_EXACT_WINDOW_LIMIT_HOURS` | `6.0` | 小于等于该窗口优先用精确 pass |
| `F7_COMPONENT_CLUSTER_EPS_DEGREES` | `0.00018` | DBSCAN 几何聚类 eps |
| `F7_STITCH_MAX_GAP_M` | `120.0` | 普通拼接最大间隙 |
| `F7_LONG_CORRIDOR_MIN_LENGTH_M` | `1200.0` | 长走廊判定 |
| `F7_LONG_CORRIDOR_MAX_GAP_M` | `260.0` | 长走廊最大拼接间隙 |
| `F7_LONG_CORRIDOR_MAX_ANGLE_PENALTY` | `0.22` | 长走廊跨 gap 方向约束 |
| `F7_FRAGMENT_PENALTY_PER_EXTRA_COMPONENT` | `0.14` | 多 component 置信惩罚 |
| `F7_MIN_DISPLAY_CONFIDENCE` | `0.18` | 展示置信下限 |
| `F7_BACKBONE_MAX_BRANCH_GEOMETRIES` | `80` | 分支几何数量上限 |
| 缓存 TTL | `45s` | 进程内缓存 |

## F8 参数

请求参数：

| 参数 | 默认值 | 约束 |
|---|---:|---|
| `top_k` | `5` | `1-20` |
| `candidate_mode` | `pass_through` | `strict_od/pass_through` |
| `buffer_meters` | `30` | `0-200` |
| `min_support` | `3` | `1-1000` |
| `min_edge_length_m` | `20` | `0-500`，实际至少 20 |
| `min_route_length_m` | `500` | `0-20000` |
| `max_candidate_trips` | `10000` | `100-50000` |

内部参数：

| 参数/常量 | 值 | 作用 |
|---|---:|---|
| `vector_min_edge_length_m` | `max(min_edge_length_m,20)` | 道路 token 最小边长 |
| `major_road_min_length_m` | `max(200,vector_min_edge_length_m)` | 无名主路 token 最小长度 |
| `stop_token_ratio` | `0.9` | 过高频 token 过滤阈值 |
| `similarity_thresholds` | `[0.78,0.7,0.62,0.55,0.48,0.42]` | Jaccard 阈值梯度 |
| `skeleton_support_ratio` | `0.35` | 走廊骨架 token 支持比例 |
| `grid_step_degrees` | `0.01` | A/B 候选网格 |
| `candidate_prefilter_limit` | `min(max(max_candidate_trips*5,max_candidate_trips+1000),50000)` | 网格粗筛上限 |
| 响应缓存 TTL | `300s` | F8 完整响应缓存 |
| 响应缓存条数 | `24` | F8 完整响应缓存上限 |
| sampled stage TTL | `300s` | F8 候选样本阶段缓存 |
| sampled stage 条数 | `8` | sampled stage 缓存上限 |

质量过滤阈值：

| 条件 | 结果 |
|---|---|
| `representative_quality_score < 0.25` | fatal drop |
| `directness_ratio > 5.0` 且质量 `<0.65` | fatal drop |
| `repeat_point_ratio > 0.22` 且质量 `<0.65` | fatal drop |
| `duration_tail_ratio > 5.0` 且质量 `<0.55` | fatal drop |
| `representative_quality_score < 0.35` | warning |
| `directness_ratio > 3.0` 且质量 `<0.82` | warning |
| `repeat_point_ratio > 0.15` 且质量 `<0.75` | warning |

## F9 参数

F9 没有后端参数，只有前端策略状态：

| 策略 | 代码值 | 参数 |
|---|---|---|
| 最快路径 | `fastest` | p50 升序，频次降序 tie-break |
| 最稳路径 | `stable` | p90 升序，p50 升序 tie-break |
| 高频且快 | `frequent_fast` | `tripScore * 1.35 - timePenalty` |

`frequent_fast` 固定权重：

- p50 时间惩罚权重 `0.65`
- avg 时间惩罚权重 `0.35`
- 频次放大系数 `1.35`
- p50/avg 惩罚上限按 `180 min` 截断

## AI 助手参数

检索：

| 参数/常量 | 值 | 作用 |
|---|---:|---|
| `top_k` | 默认 `5`，接口约束 `1-8` | 返回文档片段数量 |
| heading boost | `1.8` | token 出现在标题/heading 时加权 |
| exact compact match | `+2.0` | 问题字符串完整出现在 chunk 时加分 |
| feature in title | `+6.0` | F1-F9 编号出现在标题 |
| feature in content | `+2.0` | F1-F9 编号出现在正文 |
| feature mismatch | `score * 0.03` | 请求特定功能但 chunk 不匹配时降权 |
| implementation detail boost | `+5.0` | 实现细节问题命中逻辑文档 |

LLM：

| 配置 | 默认值 |
|---|---|
| `openai_base_url` | `https://api.openai.com/v1` |
| `openai_model` | `gpt-4o-mini` |
| `openai_api_mode` | `chat_completions` |
| `openai_timeout_seconds` | `30` |
| `openai_max_output_tokens` | `900` |

