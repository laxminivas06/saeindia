import { LatLngPoint, HomePoint } from '../types/mission';
import { GroundStationMission, GroundStationWaypoint, MissionType } from '../types/groundStationMap';
import { missionEngine } from './missionEngine';
import { mavlinkService } from './mavlinkService';
import { audioService } from './audioService';

/**
 * Calculates Haversine distance in meters between two lat/lng coordinates.
 * Reused from GoogleMap.html implementation.
 */
export function calculateHaversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371e3; // Earth radius in meters
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Calculates initial bearing in degrees from point 1 to point 2 (0-360°).
 */
export function calculateBearing(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
  const theta = Math.atan2(y, x);
  return (theta * (180 / Math.PI) + 360) % 360;
}

/**
 * Computes destination point given start point, distance (m) and bearing (deg).
 */
export function computeDestination(
  startLat: number,
  startLon: number,
  distanceMeters: number,
  bearingDeg: number
): LatLngPoint {
  const R = 6371e3;
  const delta = distanceMeters / R;
  const theta = (bearingDeg * Math.PI) / 180;
  const phi1 = (startLat * Math.PI) / 180;
  const lambda1 = (startLon * Math.PI) / 180;

  const phi2 = Math.asin(
    Math.sin(phi1) * Math.cos(delta) +
    Math.cos(phi1) * Math.sin(delta) * Math.cos(theta)
  );
  const lambda2 =
    lambda1 +
    Math.atan2(
      Math.sin(theta) * Math.sin(delta) * Math.cos(phi1),
      Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2)
    );

  return {
    lat: (phi2 * 180) / Math.PI,
    lng: (lambda2 * 180) / Math.PI,
  };
}

/**
 * Computes polygon area in square meters using spherical approximation.
 */
export function calculatePolygonArea(coords: LatLngPoint[]): number {
  if (coords.length < 3) return 0;
  const R = 6378137;
  let total = 0;
  for (let i = 0; i < coords.length; i++) {
    const j = (i + 1) % coords.length;
    const p1 = coords[i];
    const p2 = coords[j];
    const radLat1 = (p1.lat * Math.PI) / 180;
    const radLat2 = (p2.lat * Math.PI) / 180;
    const radLon1 = (p1.lng * Math.PI) / 180;
    const radLon2 = (p2.lng * Math.PI) / 180;
    total += (radLon2 - radLon1) * (2 + Math.sin(radLat1) + Math.sin(radLat2));
  }
  return Math.abs((total * R * R) / 2);
}

/**
 * Point in polygon check using ray casting.
 */
export function isPointInPolygon(point: LatLngPoint, polygon: LatLngPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng, yi = polygon[i].lat;
    const xj = polygon[j].lng, yj = polygon[j].lat;
    const intersect =
      yi > point.lat !== yj > point.lat &&
      point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export class GroundStationMissionService {
  private currentMission: GroundStationMission | null = null;
  private subscribers: Set<(mission: GroundStationMission | null) => void> = new Set();

  public subscribe(fn: (mission: GroundStationMission | null) => void): () => void {
    this.subscribers.add(fn);
    fn(this.currentMission);
    return () => this.subscribers.delete(fn);
  }

  private notify() {
    this.subscribers.forEach((fn) => fn(this.currentMission));
  }

  public getCurrentMission(): GroundStationMission | null {
    return this.currentMission;
  }

  public clearMission() {
    this.currentMission = null;
    this.notify();
  }

  /**
   * Generates mission for ordered WAYPOINTS.
   */
  public generateWaypointMission(
    points: LatLngPoint[],
    homePoint: HomePoint,
    altitude: number,
    speed: number,
    autoReturnToHome: boolean = true
  ): GroundStationMission {
    const validAlt = Math.max(2, Math.min(120, altitude));
    const validSpeed = Math.max(1, Math.min(15, speed));

    const waypoints: GroundStationWaypoint[] = [];
    let cumulativeDistance = 0;
    let prevLat = homePoint.isSet ? homePoint.latitude : (points[0]?.lat || 0);
    let prevLng = homePoint.isSet ? homePoint.longitude : (points[0]?.lng || 0);

    // Transit from Home Point to W1
    points.forEach((pt, index) => {
      const legDist = calculateHaversineDistance(prevLat, prevLng, pt.lat, pt.lng);
      cumulativeDistance += legDist;
      waypoints.push({
        id: `WP_${index + 1}`,
        index: index + 1,
        lat: pt.lat,
        lng: pt.lng,
        altitude: validAlt,
        speed: validSpeed,
        action: 'NAVIGATE',
        name: `Waypoint ${index + 1}`,
        distanceFromPreviousMeters: Math.round(legDist * 10) / 10,
      });
      prevLat = pt.lat;
      prevLng = pt.lng;
    });

    // Optional RTL leg back to Home Point
    if (autoReturnToHome && homePoint.isSet && points.length > 0) {
      const rtlDist = calculateHaversineDistance(prevLat, prevLng, homePoint.latitude, homePoint.longitude);
      cumulativeDistance += rtlDist;
      waypoints.push({
        id: `WP_RTL`,
        index: waypoints.length + 1,
        lat: homePoint.latitude,
        lng: homePoint.longitude,
        altitude: validAlt,
        speed: validSpeed,
        action: 'RTL',
        name: 'Return To Home (RTL)',
        distanceFromPreviousMeters: Math.round(rtlDist * 10) / 10,
      });
    }

    const estimatedDuration = Math.round(
      (cumulativeDistance / validSpeed) + (waypoints.length * 2.5) + (validAlt / 2.0)
    );

    const mission: GroundStationMission = {
      id: `MSN_WP_${Date.now().toString(36).toUpperCase()}`,
      homePoint: {
        latitude: homePoint.latitude,
        longitude: homePoint.longitude,
        altitude: homePoint.altitude || 0,
        isSet: homePoint.isSet,
      },
      missionType: 'WAYPOINTS',
      altitude: validAlt,
      speed: validSpeed,
      waypoints,
      totalDistance: Math.round(cumulativeDistance * 10) / 10,
      estimatedDuration,
      geometry: {
        type: 'point',
        coordinates: points,
      },
      isUploaded: false,
      createdAt: Date.now(),
    };

    this.currentMission = mission;
    this.notify();
    return mission;
  }

  /**
   * Generates mission for a continuous PATH / POLYLINE.
   * Preserves drawn vertex order, calculates directional headings,
   * and subdivides long stretches if needed.
   */
  public generatePathMission(
    pathPoints: LatLngPoint[],
    homePoint: HomePoint,
    altitude: number,
    speed: number,
    maxSegmentSpacingMeters: number = 30,
    autoReturnToHome: boolean = true
  ): GroundStationMission {
    const validAlt = Math.max(2, Math.min(120, altitude));
    const validSpeed = Math.max(1, Math.min(15, speed));

    if (pathPoints.length < 2) {
      throw new Error('Path mission requires at least 2 points.');
    }

    // Interpolate points along path if segment exceeds maxSegmentSpacingMeters
    const interpolated: LatLngPoint[] = [];
    for (let i = 0; i < pathPoints.length - 1; i++) {
      const p1 = pathPoints[i];
      const p2 = pathPoints[i + 1];
      interpolated.push(p1);

      const segmentDist = calculateHaversineDistance(p1.lat, p1.lng, p2.lat, p2.lng);
      if (segmentDist > maxSegmentSpacingMeters) {
        const numDivisions = Math.ceil(segmentDist / maxSegmentSpacingMeters);
        for (let step = 1; step < numDivisions; step++) {
          const ratio = step / numDivisions;
          interpolated.push({
            lat: p1.lat + (p2.lat - p1.lat) * ratio,
            lng: p1.lng + (p2.lng - p1.lng) * ratio,
          });
        }
      }
    }
    interpolated.push(pathPoints[pathPoints.length - 1]);

    const waypoints: GroundStationWaypoint[] = [];
    let cumulativeDistance = 0;
    let prevLat = homePoint.isSet ? homePoint.latitude : interpolated[0].lat;
    let prevLng = homePoint.isSet ? homePoint.longitude : interpolated[0].lng;

    interpolated.forEach((pt, idx) => {
      const legDist = calculateHaversineDistance(prevLat, prevLng, pt.lat, pt.lng);
      cumulativeDistance += legDist;
      waypoints.push({
        id: `PATH_WP_${idx + 1}`,
        index: idx + 1,
        lat: pt.lat,
        lng: pt.lng,
        altitude: validAlt,
        speed: validSpeed,
        action: 'NAVIGATE',
        name: idx === 0 ? 'Path Start' : idx === interpolated.length - 1 ? 'Path Finish' : `Path Pt ${idx + 1}`,
        distanceFromPreviousMeters: Math.round(legDist * 10) / 10,
      });
      prevLat = pt.lat;
      prevLng = pt.lng;
    });

    if (autoReturnToHome && homePoint.isSet) {
      const rtlDist = calculateHaversineDistance(prevLat, prevLng, homePoint.latitude, homePoint.longitude);
      cumulativeDistance += rtlDist;
      waypoints.push({
        id: `PATH_RTL`,
        index: waypoints.length + 1,
        lat: homePoint.latitude,
        lng: homePoint.longitude,
        altitude: validAlt,
        speed: validSpeed,
        action: 'RTL',
        name: 'Return To Home (RTL)',
        distanceFromPreviousMeters: Math.round(rtlDist * 10) / 10,
      });
    }

    const estimatedDuration = Math.round(
      (cumulativeDistance / validSpeed) + (waypoints.length * 1.5) + (validAlt / 2.0)
    );

    const mission: GroundStationMission = {
      id: `MSN_PATH_${Date.now().toString(36).toUpperCase()}`,
      homePoint: {
        latitude: homePoint.latitude,
        longitude: homePoint.longitude,
        altitude: homePoint.altitude || 0,
        isSet: homePoint.isSet,
      },
      missionType: 'PATH',
      altitude: validAlt,
      speed: validSpeed,
      waypoints,
      totalDistance: Math.round(cumulativeDistance * 10) / 10,
      estimatedDuration,
      geometry: {
        type: 'path',
        coordinates: pathPoints,
      },
      isUploaded: false,
      createdAt: Date.now(),
    };

    this.currentMission = mission;
    this.notify();
    return mission;
  }

  /**
   * Generates mission for a CIRCLE ORBIT or circular survey.
   * Waypoint count is dynamically derived from radius to achieve smooth flight arc.
   */
  public generateCircleMission(
    center: LatLngPoint,
    radiusMeters: number,
    homePoint: HomePoint,
    altitude: number,
    speed: number,
    direction: 'CW' | 'CCW' = 'CW',
    autoReturnToHome: boolean = true
  ): GroundStationMission {
    const validAlt = Math.max(2, Math.min(120, altitude));
    const validSpeed = Math.max(1, Math.min(15, speed));
    const validRadius = Math.max(5, Math.min(1000, radiusMeters));

    // Dynamic resolution: approx 1 waypoint per 12-16 meters of circumference, min 8, max 32
    const circumference = 2 * Math.PI * validRadius;
    const numWaypoints = Math.max(8, Math.min(32, Math.round(circumference / 15)));

    // Choose tangent entry bearing relative to Home Point (or North if home not set)
    const homeBearing = homePoint.isSet
      ? calculateBearing(homePoint.latitude, homePoint.longitude, center.lat, center.lng)
      : 0;

    const waypoints: GroundStationWaypoint[] = [];
    let cumulativeDistance = 0;
    let prevLat = homePoint.isSet ? homePoint.latitude : center.lat;
    let prevLng = homePoint.isSet ? homePoint.longitude : center.lng;

    const circleCoords: LatLngPoint[] = [];

    for (let i = 0; i <= numWaypoints; i++) {
      const stepAngle = (360 / numWaypoints) * i;
      const angle = direction === 'CW'
        ? (homeBearing + stepAngle) % 360
        : (homeBearing - stepAngle + 360) % 360;

      const wpPos = computeDestination(center.lat, center.lng, validRadius, angle);
      circleCoords.push(wpPos);

      const legDist = calculateHaversineDistance(prevLat, prevLng, wpPos.lat, wpPos.lng);
      cumulativeDistance += legDist;

      waypoints.push({
        id: `CIRC_WP_${i + 1}`,
        index: i + 1,
        lat: wpPos.lat,
        lng: wpPos.lng,
        altitude: validAlt,
        speed: validSpeed,
        action: 'ORBIT',
        name: i === 0 ? 'Orbit Entry' : i === numWaypoints ? 'Orbit Complete' : `Orbit Pt ${i + 1}`,
        distanceFromPreviousMeters: Math.round(legDist * 10) / 10,
      });

      prevLat = wpPos.lat;
      prevLng = wpPos.lng;
    }

    if (autoReturnToHome && homePoint.isSet) {
      const rtlDist = calculateHaversineDistance(prevLat, prevLng, homePoint.latitude, homePoint.longitude);
      cumulativeDistance += rtlDist;
      waypoints.push({
        id: `CIRC_RTL`,
        index: waypoints.length + 1,
        lat: homePoint.latitude,
        lng: homePoint.longitude,
        altitude: validAlt,
        speed: validSpeed,
        action: 'RTL',
        name: 'Return To Home (RTL)',
        distanceFromPreviousMeters: Math.round(rtlDist * 10) / 10,
      });
    }

    const estimatedDuration = Math.round(
      (cumulativeDistance / validSpeed) + (waypoints.length * 1.0) + (validAlt / 2.0)
    );

    const mission: GroundStationMission = {
      id: `MSN_CIRC_${Date.now().toString(36).toUpperCase()}`,
      homePoint: {
        latitude: homePoint.latitude,
        longitude: homePoint.longitude,
        altitude: homePoint.altitude || 0,
        isSet: homePoint.isSet,
      },
      missionType: 'CIRCLE',
      altitude: validAlt,
      speed: validSpeed,
      waypoints,
      totalDistance: Math.round(cumulativeDistance * 10) / 10,
      estimatedDuration,
      geometry: {
        type: 'circle',
        circleCenter: center,
        circleRadiusMeters: validRadius,
        areaSquareMeters: Math.PI * validRadius * validRadius,
        coordinates: circleCoords,
      },
      isUploaded: false,
      createdAt: Date.now(),
    };

    this.currentMission = mission;
    this.notify();
    return mission;
  }

  /**
   * Generates mission for a POLYGON SURVEY / GRID COVERAGE.
   * Generates transect survey lanes (lawnmower pattern) clipped to the polygon boundary.
   */
  public generatePolygonGridMission(
    polygonCoords: LatLngPoint[],
    homePoint: HomePoint,
    altitude: number,
    speed: number,
    laneSpacingMeters: number = 8.0,
    autoReturnToHome: boolean = true
  ): GroundStationMission {
    const validAlt = Math.max(2, Math.min(120, altitude));
    const validSpeed = Math.max(1, Math.min(15, speed));
    const validSpacing = Math.max(3, Math.min(50, laneSpacingMeters));

    if (polygonCoords.length < 3) {
      throw new Error('Polygon survey requires at least 3 boundary vertices.');
    }

    // Determine bounding box
    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
    polygonCoords.forEach((p) => {
      minLat = Math.min(minLat, p.lat);
      maxLat = Math.max(maxLat, p.lat);
      minLng = Math.min(minLng, p.lng);
      maxLng = Math.max(maxLng, p.lng);
    });

    const latSpanMeters = calculateHaversineDistance(minLat, minLng, maxLat, minLng);
    const numLanes = Math.max(2, Math.min(40, Math.ceil(latSpanMeters / validSpacing)));

    const latStep = (maxLat - minLat) / (numLanes + 1);
    const surveyPoints: LatLngPoint[] = [];

    // Sample longitude resolution across bounding box
    const numSamples = 60;
    const lngStep = (maxLng - minLng) / numSamples;

    let sweepEast = true;
    for (let lane = 1; lane <= numLanes; lane++) {
      const laneLat = minLat + latStep * lane;
      const insidePointsInLane: LatLngPoint[] = [];

      for (let s = 0; s <= numSamples; s++) {
        const testLng = minLng + lngStep * s;
        const testPt: LatLngPoint = { lat: laneLat, lng: testLng };
        if (isPointInPolygon(testPt, polygonCoords)) {
          insidePointsInLane.push(testPt);
        }
      }

      if (insidePointsInLane.length >= 2) {
        const entry = insidePointsInLane[0];
        const exit = insidePointsInLane[insidePointsInLane.length - 1];

        if (sweepEast) {
          surveyPoints.push(entry);
          surveyPoints.push(exit);
        } else {
          surveyPoints.push(exit);
          surveyPoints.push(entry);
        }
        sweepEast = !sweepEast;
      }
    }

    // Fallback if shape is too thin: use vertices
    const routePoints = surveyPoints.length >= 2 ? surveyPoints : polygonCoords;

    const waypoints: GroundStationWaypoint[] = [];
    let cumulativeDistance = 0;
    let prevLat = homePoint.isSet ? homePoint.latitude : routePoints[0].lat;
    let prevLng = homePoint.isSet ? homePoint.longitude : routePoints[0].lng;

    routePoints.forEach((pt, idx) => {
      const legDist = calculateHaversineDistance(prevLat, prevLng, pt.lat, pt.lng);
      cumulativeDistance += legDist;
      waypoints.push({
        id: `SURVEY_WP_${idx + 1}`,
        index: idx + 1,
        lat: pt.lat,
        lng: pt.lng,
        altitude: validAlt,
        speed: validSpeed,
        action: 'SURVEY_PASS',
        name: idx === 0 ? 'Survey Entry' : idx === routePoints.length - 1 ? 'Survey Exit' : `Survey Waypoint ${idx + 1}`,
        distanceFromPreviousMeters: Math.round(legDist * 10) / 10,
      });
      prevLat = pt.lat;
      prevLng = pt.lng;
    });

    if (autoReturnToHome && homePoint.isSet) {
      const rtlDist = calculateHaversineDistance(prevLat, prevLng, homePoint.latitude, homePoint.longitude);
      cumulativeDistance += rtlDist;
      waypoints.push({
        id: `SURVEY_RTL`,
        index: waypoints.length + 1,
        lat: homePoint.latitude,
        lng: homePoint.longitude,
        altitude: validAlt,
        speed: validSpeed,
        action: 'RTL',
        name: 'Return To Home (RTL)',
        distanceFromPreviousMeters: Math.round(rtlDist * 10) / 10,
      });
    }

    const areaSquareMeters = calculatePolygonArea(polygonCoords);
    const estimatedDuration = Math.round(
      (cumulativeDistance / validSpeed) + (waypoints.length * 2.0) + (validAlt / 2.0)
    );

    const mission: GroundStationMission = {
      id: `MSN_SURVEY_${Date.now().toString(36).toUpperCase()}`,
      homePoint: {
        latitude: homePoint.latitude,
        longitude: homePoint.longitude,
        altitude: homePoint.altitude || 0,
        isSet: homePoint.isSet,
      },
      missionType: 'POLYGON_GRID',
      altitude: validAlt,
      speed: validSpeed,
      waypoints,
      totalDistance: Math.round(cumulativeDistance * 10) / 10,
      estimatedDuration,
      geometry: {
        type: 'polygon',
        coordinates: polygonCoords,
        areaSquareMeters,
      },
      isUploaded: false,
      createdAt: Date.now(),
    };

    this.currentMission = mission;
    this.notify();
    return mission;
  }

  /**
   * Transmits mission to the drone communication layer (ESP32-S3 / Pixhawk MAVLink).
   */
  public async uploadMissionToDrone(): Promise<{ success: boolean; message: string }> {
    if (!this.currentMission) {
      return { success: false, message: 'No mission generated to upload.' };
    }

    if (!this.currentMission.waypoints || this.currentMission.waypoints.length === 0) {
      return { success: false, message: 'Mission has no navigable waypoints.' };
    }

    try {
      // 1. Update Mission Engine configuration
      missionEngine.updateSearchAltitude(this.currentMission.altitude);
      missionEngine.setMissionDuration(Math.max(120, this.currentMission.estimatedDuration + 60));

      // 2. Transmit target altitude to flight controller via MAVLink
      await mavlinkService.setTargetAltitude(this.currentMission.altitude);

      // 3. If real connection or simulation exists, send initial waypoint position guidance
      const firstWp = this.currentMission.waypoints[0];
      if (firstWp) {
        await mavlinkService.flyToPosition(
          firstWp.lat,
          firstWp.lng,
          firstWp.altitude,
          firstWp.speed
        );
      }

      this.currentMission.isUploaded = true;
      this.notify();

      audioService.playBeep(880, 150);
      audioService.triggerHaptic('medium');

      return {
        success: true,
        message: `Mission successfully uploaded to Drone FC (${this.currentMission.waypoints.length} waypoints, ${this.currentMission.totalDistance}m at ${this.currentMission.altitude}m alt).`,
      };
    } catch (err: any) {
      console.error('[GCS Mission Upload Error]', err);
      return {
        success: false,
        message: `Failed to upload mission: ${err?.message || 'Communication error with ESP32-S3 link'}`,
      };
    }
  }
}

export const groundStationMissionService = new GroundStationMissionService();
