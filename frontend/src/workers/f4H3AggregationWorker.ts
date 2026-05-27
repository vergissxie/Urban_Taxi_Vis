import { cellToBoundary, cellToLatLng, cellToParent } from 'h3-js';

interface F4H3BaseCell {
  h3Id: string;
  count: number;
}

interface F4H3BaseData {
  baseResolution: number;
  totalPoints: number;
  bbox: {
    minLon: number;
    minLat: number;
    maxLon: number;
    maxLat: number;
  };
  gridList: F4H3BaseCell[];
}

interface F4WorkerRequest {
  requestId: number;
  baseData: F4H3BaseData;
  targetResolution: number;
}

interface F4WorkerResultCell {
  h3_id: string;
  resolution: number;
  bounds: [number, number, number, number];
  center: [number, number];
  boundary: Array<[number, number]>;
  point_count: number;
  vehicle_count: null;
  density: number;
}

const ctx: Worker = self as unknown as Worker;

ctx.onmessage = (event: MessageEvent<F4WorkerRequest>) => {
  const { requestId, baseData, targetResolution } = event.data;

  try {
    const aggregated = new Map<string, number>();
    for (const item of baseData.gridList) {
      const parentId = targetResolution === baseData.baseResolution
        ? item.h3Id
        : cellToParent(item.h3Id, targetResolution);
      aggregated.set(parentId, (aggregated.get(parentId) ?? 0) + Number(item.count || 0));
    }

    const result: F4WorkerResultCell[] = Array.from(aggregated.entries())
      .map(([h3Id, count]) => {
        const [lat, lng] = cellToLatLng(h3Id);
        const boundary = cellToBoundary(h3Id).map(([cellLat, cellLng]) => [cellLng, cellLat] as [number, number]);
        const lngs = boundary.map((point) => point[0]);
        const lats = boundary.map((point) => point[1]);
        const bounds: [number, number, number, number] = [
          Math.min(...lngs),
          Math.min(...lats),
          Math.max(...lngs),
          Math.max(...lats),
        ];
        const center: [number, number] = [lng, lat];
        return {
          h3_id: h3Id,
          resolution: targetResolution,
          bounds,
          center,
          boundary,
          point_count: count,
          vehicle_count: null,
          density: count,
        };
      })
      .sort((a, b) => b.density - a.density);

    ctx.postMessage({
      requestId,
      result,
    });
  } catch (error) {
    ctx.postMessage({
      requestId,
      error: error instanceof Error ? error.message : 'F4 H3 worker aggregation failed',
    });
  }
};
