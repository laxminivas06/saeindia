import { LatLngPoint } from './mission';

export type MapLayerType = 'street' | 'satellite' | 'topo' | 'dark';

export type MissionDrawingTool = 'select' | 'point' | 'path' | 'polygon' | 'circle' | 'set_home';

export type MissionType = 'WAYPOINTS' | 'PATH' | 'POLYGON_GRID' | 'CIRCLE' | 'SEARCH';

export interface GroundStationWaypoint {
  id: string;
  index: number;
  lat: number;
  lng: number;
  altitude: number;
  speed: number;
  action?: 'TAKEOFF' | 'NAVIGATE' | 'LOITER' | 'SURVEY_PASS' | 'ORBIT' | 'RTL' | 'LAND';
  name?: string;
  distanceFromPreviousMeters?: number;
}

export interface GroundStationMission {
  id: string;
  homePoint: {
    latitude: number;
    longitude: number;
    altitude: number;
    isSet: boolean;
  };
  missionType: MissionType;
  altitude: number; // Planned mission cruise altitude (meters)
  speed: number;    // Planned mission speed (m/s)
  waypoints: GroundStationWaypoint[];
  totalDistance: number;          // Total route distance in meters
  estimatedDuration: number;      // Total estimated duration in seconds
  geometry?: {
    type: 'point' | 'path' | 'polygon' | 'circle';
    coordinates?: LatLngPoint[];
    circleCenter?: LatLngPoint;
    circleRadiusMeters?: number;
    areaSquareMeters?: number;
  };
  isUploaded: boolean;
  createdAt: number;
}

export type GroundStationStateLabel =
  | 'Disconnected'
  | 'Connected'
  | 'Ready'
  | 'Mission Created'
  | 'Mission Uploaded'
  | 'Armed'
  | 'Taking Off'
  | 'Executing Mission'
  | 'Paused'
  | 'Returning'
  | 'Completed'
  | 'Aborted'
  | 'Error';

export interface MapSearchResult {
  displayName: string;
  lat: number;
  lng: number;
  type?: string;
}
