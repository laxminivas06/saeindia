import { PathPoint, PathBoundary } from '../types/mission';

type PathListener = (points: PathPoint[], isPathActive: boolean, boundary: PathBoundary | null) => void;

const PATH_STORAGE_KEY = 'SAE_MISSION_GPS_PATH';

class PathService {
  private points: PathPoint[] = [];
  private listeners: Set<PathListener> = new Set();

  constructor() {
    this.restorePath();
  }

  private restorePath() {
    if (typeof window === 'undefined') return;
    try {
      const stored = localStorage.getItem(PATH_STORAGE_KEY);
      if (stored) {
        this.points = JSON.parse(stored);
      }
    } catch (e) {
      console.warn('Failed to restore GPS path', e);
    }
  }

  private savePath() {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(PATH_STORAGE_KEY, JSON.stringify(this.points));
    } catch (e) {
      // ignore
    }
    this.notify();
  }

  public subscribe(fn: PathListener) {
    this.listeners.add(fn);
    fn(this.getPath(), this.isPathActive(), this.getBoundary());
    return () => this.listeners.delete(fn);
  }

  public getPath(): PathPoint[] {
    return [...this.points];
  }

  public isPathActive(): boolean {
    return this.points.length > 0;
  }

  public addPoint(latitude: number, longitude: number, altitude: number = 20): PathPoint {
    const pointNumber = this.points.length + 1;
    const newPoint: PathPoint = {
      id: `WP_${Date.now()}_${pointNumber}`,
      pointNumber,
      latitude: parseFloat(latitude.toFixed(6)),
      longitude: parseFloat(longitude.toFixed(6)),
      altitude,
      timestamp: Date.now()
    };

    this.points.push(newPoint);
    this.savePath();
    return newPoint;
  }

  public removePoint(id: string) {
    this.points = this.points.filter(p => p.id !== id);
    // Renumber remaining points sequentially
    this.points = this.points.map((p, idx) => ({
      ...p,
      pointNumber: idx + 1
    }));
    this.savePath();
  }

  public clearPath() {
    this.points = [];
    this.savePath();
  }

  public setPath(points: PathPoint[]) {
    this.points = points.map((p, idx) => ({
      ...p,
      pointNumber: idx + 1
    }));
    this.savePath();
  }

  /**
   * Calculates the operating boundary of the path with a 15m safety corridor margin.
   */
  public getBoundary(): PathBoundary | null {
    if (this.points.length === 0) return null;

    let minLat = this.points[0].latitude;
    let maxLat = this.points[0].latitude;
    let minLon = this.points[0].longitude;
    let maxLon = this.points[0].longitude;

    for (const p of this.points) {
      if (p.latitude < minLat) minLat = p.latitude;
      if (p.latitude > maxLat) maxLat = p.latitude;
      if (p.longitude < minLon) minLon = p.longitude;
      if (p.longitude > maxLon) maxLon = p.longitude;
    }

    // Convert ~15 meters to delta degrees (~0.000135 deg)
    const marginDeg = 0.00015;

    return {
      minLat: minLat - marginDeg,
      maxLat: maxLat + marginDeg,
      minLon: minLon - marginDeg,
      maxLon: maxLon + marginDeg
    };
  }

  /**
   * Path Constraint: Validates if a target coordinate is within the defined boundary corridor.
   */
  public isInsideBoundary(lat: number, lon: number): boolean {
    const boundary = this.getBoundary();
    if (!boundary) return true; // No boundary constraint active if no path defined

    return (
      lat >= boundary.minLat &&
      lat <= boundary.maxLat &&
      lon >= boundary.minLon &&
      lon <= boundary.maxLon
    );
  }

  private notify() {
    const currentPoints = this.getPath();
    const active = this.isPathActive();
    const boundary = this.getBoundary();
    this.listeners.forEach((fn) => fn(currentPoints, active, boundary));
  }
}

export const pathService = new PathService();
