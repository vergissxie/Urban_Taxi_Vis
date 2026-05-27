export type LngLat = [number, number];

export interface TaxiTrajectoryPoint {
  taxiId: number;
  tripId: string;
  timestamp: string;
  longitude: number;
  latitude: number;
  speedKmh?: number;
  heading?: number;
}

export interface TripData {
  taxi_id: number;
  trip_id: string;
  start_time: string;
  end_time: string;
  point_count?: number;
  distance_km?: number;
  duration_min?: number;
  is_matched?: boolean;
}

export interface PointGeometry {
  type: 'Point';
  coordinates: LngLat;
}

export interface LineStringGeometry {
  type: 'LineString';
  coordinates: LngLat[];
}

export interface PolygonGeometry {
  type: 'Polygon';
  coordinates: LngLat[][];
}

export type GeoJSONGeometry = PointGeometry | LineStringGeometry | PolygonGeometry;

export interface GeoJSONFeature<P = Record<string, unknown>, G extends GeoJSONGeometry = GeoJSONGeometry> {
  type: 'Feature';
  geometry: G;
  properties: P;
  id?: string | number;
}

export interface GeoJSONFeatureCollection<P = Record<string, unknown>, G extends GeoJSONGeometry = GeoJSONGeometry> {
  type: 'FeatureCollection';
  features: Array<GeoJSONFeature<P, G>>;
}

export interface QueryTrajectoryParams {
  taxiId: number;
  startTime: string;
  endTime: string;
}
