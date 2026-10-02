import React, { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw/dist/leaflet.draw.css';
import 'leaflet-draw';
import { DroneTelemetry, HomePoint, LatLngPoint, MissionState } from '../../types/mission';
import { PixhawkConnectionState } from '../../types/mavlink';
import {
  GroundStationMission,
  GroundStationStateLabel,
  MapLayerType,
  MissionDrawingTool,
  MissionType,
  MapSearchResult,
} from '../../types/groundStationMap';
import {
  groundStationMissionService,
  calculateHaversineDistance,
} from '../../services/groundStationMissionService';
import { audioService } from '../../services/audioService';
import {
  Search,
  Crosshair,
  MapPin,
  Layers,
  Trash2,
  Undo2,
  Navigation,
  Eye,
  Send,
  Play,
  RotateCcw,
  ShieldAlert,
  Sliders,
  Maximize2,
  Compass,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Gauge,
  ArrowRight,
  Maximize,
  ChevronRight,
  ChevronDown,
  Minimize2,
  Circle as CircleIcon,
  Square as SquareIcon,
  Video,
  X,
  Plus,
  Minus,
  User
} from 'lucide-react';

interface GoogleMapGroundStationProps {
  telemetry: DroneTelemetry;
  homePoint: HomePoint;
  pixhawkState: PixhawkConnectionState;
  missionState: MissionState;
  onSetHomePoint: (coords?: { lat: number; lng: number }) => void;
  onStartMission: () => void;
  onEmergencyRTL: () => void;
  className?: string;
  isPipVideoVisible?: boolean;
  onTogglePipVideo?: () => void;
}

export const GoogleMapGroundStation: React.FC<GoogleMapGroundStationProps> = ({
  telemetry,
  homePoint,
  pixhawkState,
  missionState,
  onSetHomePoint,
  onStartMission,
  onEmergencyRTL,
  className = '',
  isPipVideoVisible,
  onTogglePipVideo,
}) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);

  // Layer groups & tile layers
  const activeTileLayerRef = useRef<L.TileLayer | null>(null);
  const droneLayerRef = useRef<L.LayerGroup>(L.layerGroup());
  const homeLayerRef = useRef<L.LayerGroup>(L.layerGroup());
  const missionLayerRef = useRef<L.LayerGroup>(L.layerGroup());
  const drawingLayerRef = useRef<L.FeatureGroup>(new L.FeatureGroup());
  const breadcrumbsLayerRef = useRef<L.Polyline | null>(null);
  const breadcrumbHistoryRef = useRef<L.LatLng[]>([]);

  // State
  const [currentLayerType, setCurrentLayerType] = useState<MapLayerType>('satellite');
  const [activeTool, setActiveTool] = useState<MissionDrawingTool>('select');
  const [activeMissionType, setActiveMissionType] = useState<MissionType>('WAYPOINTS');

  // Mission Parameters
  const [altitude, setAltitude] = useState<number>(30); // 30m default
  const [speed, setSpeed] = useState<number>(5.0); // 5.0 m/s default
  const [gridSpacing, setGridSpacing] = useState<number>(8.0); // for polygon survey
  const [circleRadius, setCircleRadius] = useState<number>(25); // for circle mission
  const [circleDirection, setCircleDirection] = useState<'CW' | 'CCW'>('CW');

  // Drawing geometry state
  const [drawnPoints, setDrawnPoints] = useState<LatLngPoint[]>([]);
  const [circleCenter, setCircleCenter] = useState<LatLngPoint | null>(null);
  const [isDrawingCircleMode, setIsDrawingCircleMode] = useState<boolean>(false);

  // Search state
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<MapSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);

  // Mission Generation & Status
  const [generatedMission, setGeneratedMission] = useState<GroundStationMission | null>(null);
  const [isPreviewActive, setIsPreviewActive] = useState<boolean>(true);
  const [uploadFeedback, setUploadFeedback] = useState<{ success: boolean; message: string } | null>(null);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [isArmingModalOpen, setIsArmingModalOpen] = useState<boolean>(false);
  const [forceBypassChecks, setForceBypassChecks] = useState<boolean>(false);
  const [isSidePanelCollapsed, setIsSidePanelCollapsed] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Auto-Centering and Location Tracking References
  const hasAutoCenteredOnDroneRef = useRef<boolean>(false);
  const operatorMarkerRef = useRef<L.Marker | null>(null);
  const operatorAccuracyCircleRef = useRef<L.Circle | null>(null);
  const [isDetectingOperatorLocation, setIsDetectingOperatorLocation] = useState<boolean>(false);
  const [operatorLocation, setOperatorLocation] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);

  // Drone marker references
  const droneMarkerRef = useRef<L.Marker | null>(null);
  const homeMarkerRef = useRef<L.Marker | null>(null);

  // Flight Controller & Live GPS Fix Validation
  const isFcConnected = pixhawkState.isConnected || telemetry.pixhawkConnected;
  const hasValidFcGps = Boolean(
    telemetry.latitude &&
    telemetry.longitude &&
    Math.abs(telemetry.latitude) > 0.0001 &&
    Math.abs(telemetry.longitude) > 0.0001 &&
    (telemetry.gps?.isLocked || (telemetry.gps?.satellites >= 6 && telemetry.gps?.fixType !== 'NO_FIX' && telemetry.gps?.fixType !== 'NO_GPS'))
  );

  // Derive Unified Ground Station Mission State
  const deriveMissionStateLabel = (): GroundStationStateLabel => {
    if (!isFcConnected) return 'Disconnected';
    if (missionState === 'RTL' || missionState === 'RETURNING_HOME' || missionState === 'EMERGENCY_RTL') return 'Returning';
    if (missionState === 'SEARCHING' || missionState === 'BOX_TRACKING' || missionState === 'QR_SCANNING') return 'Executing Mission';
    if (missionState === 'TAKEOFF' || missionState === 'CLIMBING' || missionState === 'CLIMBING_TO_ALTITUDE') return 'Taking Off';
    if (missionState === 'STARTING') return 'Armed';
    if (missionState === 'ERROR' || missionState === 'FAILSAFE') return 'Error';
    if (missionState === 'ABORTED') return 'Aborted';
    if (missionState === 'MISSION_COMPLETE') return 'Completed';
    if (telemetry.isArmed) return 'Armed';
    if (generatedMission?.isUploaded) return 'Mission Uploaded';
    if (generatedMission) return 'Mission Created';
    return 'Ready';
  };

  const currentGcsState = deriveMissionStateLabel();

  // Dynamic Initial Center: FC GPS coordinates take absolute precedence
  const initialCenter: [number, number] = hasValidFcGps
    ? [telemetry.latitude, telemetry.longitude]
    : homePoint.isSet && homePoint.latitude !== 0
    ? [homePoint.latitude, homePoint.longitude]
    : [17.5415, 78.3930]; // Initial reference only until FC GPS fix is established

  // -------------------------------------------------------------
  // Automatic Map Centering on FC GPS Fix Acquisition
  // -------------------------------------------------------------
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (hasValidFcGps && !hasAutoCenteredOnDroneRef.current) {
      map.setView([telemetry.latitude, telemetry.longitude], 17);
      hasAutoCenteredOnDroneRef.current = true;

      // Automatically adopt current FC coordinates as initial Home Point if not set yet
      if (!homePoint.isSet) {
        onSetHomePoint({ lat: telemetry.latitude, lng: telemetry.longitude });
      }
      audioService.playBeep(880, 80);
    }
  }, [hasValidFcGps, telemetry.latitude, telemetry.longitude, homePoint.isSet, onSetHomePoint]);

  // -------------------------------------------------------------
  // Map Initialization (Reusing layers and config from GoogleMap.html)
  // -------------------------------------------------------------
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    try {
      const map = L.map(mapContainerRef.current, {
        center: initialCenter,
        zoom: 17,
        zoomControl: false, // Custom position control
        attributionControl: false,
      });

      // Add Zoom Control at bottom right
      L.control.zoom({ position: 'bottomright' }).addTo(map);

      // Create Tile Layer (Satellite by default for professional GCS)
      const satelliteLayer = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        {
          attribution: 'Esri World Imagery',
          maxZoom: 19,
        }
      );

      satelliteLayer.addTo(map);
      activeTileLayerRef.current = satelliteLayer;

      // Add layer groups
      droneLayerRef.current.addTo(map);
      homeLayerRef.current.addTo(map);
      missionLayerRef.current.addTo(map);
      drawingLayerRef.current.addTo(map);

      // Breadcrumb path for live flight trail
      const breadcrumbs = L.polyline([], {
        color: '#38bdf8',
        weight: 3,
        opacity: 0.7,
        dashArray: '4, 4',
      }).addTo(map);
      breadcrumbsLayerRef.current = breadcrumbs;

      mapInstanceRef.current = map;

      // Invalidate size after layout settles
      setTimeout(() => {
        map.invalidateSize();
      }, 250);
    } catch (e: any) {
      console.error('[GCS Map Init Failed]', e);
      setErrorMessage(`Map loading failed: ${e?.message || 'Check network connection'}`);
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // -------------------------------------------------------------
  // Map Layer Switcher (Street / Satellite / Topo / Dark)
  // -------------------------------------------------------------
  const switchMapLayer = (type: MapLayerType) => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (activeTileLayerRef.current) {
      map.removeLayer(activeTileLayerRef.current);
    }

    let newLayer: L.TileLayer;
    switch (type) {
      case 'satellite':
        newLayer = L.tileLayer(
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          { maxZoom: 19, attribution: 'Esri World Imagery' }
        );
        break;
      case 'topo':
        newLayer = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
          maxZoom: 17,
          attribution: 'OpenTopoMap',
        });
        break;
      case 'dark':
        newLayer = L.tileLayer(
          'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
          { maxZoom: 19, attribution: 'CartoDB Dark Matter' }
        );
        break;
      case 'street':
      default:
        newLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: 'OpenStreetMap',
        });
        break;
    }

    newLayer.addTo(map);
    activeTileLayerRef.current = newLayer;
    setCurrentLayerType(type);
    audioService.playBeep(650, 60);
  };

  // -------------------------------------------------------------
  // Drone Live Position & Heading Marker
  // -------------------------------------------------------------
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const lat = telemetry.latitude;
    const lng = telemetry.longitude;
    const hasValidGps = Boolean(lat && lng && lat !== 0 && lng !== 0 && telemetry.gps?.isLocked);

    droneLayerRef.current.clearLayers();

    if (!hasValidGps) {
      droneMarkerRef.current = null;
      return;
    }

    const heading = telemetry.heading || 0;
    const isArmed = telemetry.isArmed;

    // Custom SVG Drone Marker with Live Rotation Arrow
    const droneHtml = `
      <div style="transform: rotate(${heading}deg); width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; position: relative;">
        <!-- Heading Indicator Vector -->
        <div style="position: absolute; top: -14px; width: 0; height: 0; border-left: 6px solid transparent; border-right: 6px solid transparent; border-bottom: 12px solid ${isArmed ? '#10b981' : '#38bdf8'}; filter: drop-shadow(0 0 4px ${isArmed ? '#10b981' : '#38bdf8'});"></div>
        <!-- Aircraft SVG Quadcopter -->
        <svg width="40" height="40" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" style="filter: drop-shadow(0 2px 8px rgba(0,0,0,0.8));">
          <!-- Cross Arms -->
          <line x1="8" y1="8" x2="40" y2="40" stroke="#f8fafc" stroke-width="3" stroke-linecap="round"/>
          <line x1="40" y1="8" x2="8" y2="40" stroke="#f8fafc" stroke-width="3" stroke-linecap="round"/>
          <!-- Rotors -->
          <circle cx="8" cy="8" r="6" fill="${isArmed ? '#10b981' : '#0284c7'}" stroke="#ffffff" stroke-width="1.5" opacity="0.9"/>
          <circle cx="40" cy="8" r="6" fill="${isArmed ? '#10b981' : '#0284c7'}" stroke="#ffffff" stroke-width="1.5" opacity="0.9"/>
          <circle cx="40" cy="40" r="6" fill="${isArmed ? '#10b981' : '#0284c7'}" stroke="#ffffff" stroke-width="1.5" opacity="0.9"/>
          <circle cx="8" cy="40" r="6" fill="${isArmed ? '#10b981' : '#0284c7'}" stroke="#ffffff" stroke-width="1.5" opacity="0.9"/>
          <!-- Fuselage Body -->
          <circle cx="24" cy="24" r="8" fill="#0f172a" stroke="${isArmed ? '#10b981' : '#38bdf8'}" stroke-width="2.5"/>
          <circle cx="24" cy="24" r="3.5" fill="${isArmed ? '#34d399' : '#38bdf8'}"/>
        </svg>
      </div>
    `;

    const droneIcon = L.divIcon({
      html: droneHtml,
      className: 'drone-heading-marker',
      iconSize: [44, 44],
      iconAnchor: [22, 22],
    });

    const marker = L.marker([lat, lng], { icon: droneIcon, zIndexOffset: 1000 });
    marker.bindPopup(`
      <div class="space-y-1">
        <div class="font-bold text-sky-400 flex items-center space-x-1">
          <span>DRONE TELEMETRY</span>
          <span class="text-[9px] px-1 py-0.5 rounded ${isArmed ? 'bg-emerald-900 text-emerald-200' : 'bg-slate-800 text-slate-300'}">
            ${isArmed ? 'ARMED' : 'DISARMED'}
          </span>
        </div>
        <div class="text-[10px] text-slate-300">Lat: ${lat.toFixed(6)} | Lon: ${lng.toFixed(6)}</div>
        <div class="text-[10px] text-slate-300">Alt: ${telemetry.altitude.toFixed(1)}m | Spd: ${telemetry.groundSpeed.toFixed(1)} m/s</div>
        <div class="text-[10px] text-slate-300">Heading: ${Math.round(heading)}° | Mode: ${telemetry.flightMode}</div>
      </div>
    `, { className: 'tactical-popup' });

    marker.addTo(droneLayerRef.current);
    droneMarkerRef.current = marker;

    // Record breadcrumbs if armed
    if (isArmed) {
      const newPos = new L.LatLng(lat, lng);
      const history = breadcrumbHistoryRef.current;
      if (history.length === 0 || history[history.length - 1].distanceTo(newPos) > 3) {
        history.push(newPos);
        if (history.length > 300) history.shift();
        if (breadcrumbsLayerRef.current) {
          breadcrumbsLayerRef.current.setLatLngs(history);
        }
      }
    }
  }, [telemetry]);

  // -------------------------------------------------------------
  // Home Point Marker & Radar Beacon
  // -------------------------------------------------------------
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    homeLayerRef.current.clearLayers();

    if (!homePoint.isSet || !homePoint.latitude) {
      homeMarkerRef.current = null;
      return;
    }

    const lat = homePoint.latitude;
    const lng = homePoint.longitude;

    // Pulsing radar ring
    const radarRingHtml = `
      <div style="position: relative; width: 48px; height: 48px; display: flex; align-items: center; justify-content: center;">
        <div class="animate-home-pulse" style="position: absolute; width: 44px; height: 44px; border-radius: 50%; border: 2px solid #0284c7; background: rgba(2, 132, 199, 0.2);"></div>
        <div style="width: 28px; height: 28px; border-radius: 50%; background: #0284c7; border: 2.5px solid #ffffff; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 12px rgba(2, 132, 199, 0.8);">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
            <polyline points="9 22 9 12 15 12 15 22"/>
          </svg>
        </div>
      </div>
    `;

    const homeIcon = L.divIcon({
      html: radarRingHtml,
      className: 'home-marker-pin',
      iconSize: [48, 48],
      iconAnchor: [24, 24],
    });

    const marker = L.marker([lat, lng], {
      icon: homeIcon,
      draggable: !telemetry.isArmed && missionState === 'IDLE' || missionState === 'HOME_SET' || missionState === 'READY',
      zIndexOffset: 900,
    });

    marker.bindPopup(`
      <div class="space-y-1">
        <div class="font-black text-sky-400 flex items-center space-x-1">
          <span>HOME POINT (ORIGIN)</span>
        </div>
        <div class="text-[10px] text-slate-300">Lat: ${lat.toFixed(6)}</div>
        <div class="text-[10px] text-slate-300">Lon: ${lng.toFixed(6)}</div>
        <div class="text-[9px] text-slate-400 mt-1 italic">Drag marker to reposition reference home</div>
      </div>
    `, { className: 'tactical-popup' });

    // Allow dragging Home Point before mission start
    marker.on('dragend', (e) => {
      const target = e.target as L.Marker;
      const pos = target.getLatLng();
      onSetHomePoint({ lat: pos.lat, lng: pos.lng });
      audioService.playBeep(880, 80);
    });

    marker.addTo(homeLayerRef.current);
    homeMarkerRef.current = marker;
  }, [homePoint, telemetry.isArmed, missionState]);

  // -------------------------------------------------------------
  // Map Click & Drawing Handling
  // -------------------------------------------------------------
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const handleMapClick = (e: L.LeafletMouseEvent) => {
      const clickedLat = e.latlng.lat;
      const clickedLng = e.latlng.lng;

      if (activeTool === 'set_home') {
        onSetHomePoint({ lat: clickedLat, lng: clickedLng });
        setActiveTool('select');
        audioService.playBeep(880, 100);
        return;
      }

      if (activeTool === 'point' || activeTool === 'path' || activeTool === 'polygon') {
        const newPts = [...drawnPoints, { lat: clickedLat, lng: clickedLng }];
        setDrawnPoints(newPts);
        audioService.playBeep(720, 60);
      } else if (activeTool === 'circle') {
        if (!circleCenter) {
          setCircleCenter({ lat: clickedLat, lng: clickedLng });
          setIsDrawingCircleMode(true);
          audioService.playBeep(750, 80);
        } else {
          // Second click sets radius
          const rad = calculateHaversineDistance(
            circleCenter.lat,
            circleCenter.lng,
            clickedLat,
            clickedLng
          );
          setCircleRadius(Math.max(5, Math.round(rad)));
          setIsDrawingCircleMode(false);
          audioService.playBeep(880, 100);
        }
      }
    };

    map.on('click', handleMapClick);
    return () => {
      map.off('click', handleMapClick);
    };
  }, [activeTool, drawnPoints, circleCenter, onSetHomePoint]);

  // -------------------------------------------------------------
  // Drawing Layer Visuals (Visualizing active drawing on map)
  // -------------------------------------------------------------
  useEffect(() => {
    drawingLayerRef.current.clearLayers();

    // 1. Draw points / path / polygon vertices
    if (drawnPoints.length > 0) {
      drawnPoints.forEach((pt, idx) => {
        const marker = L.circleMarker([pt.lat, pt.lng], {
          radius: 6,
          color: '#ffffff',
          fillColor: '#38bdf8',
          fillOpacity: 0.9,
          weight: 2,
        });
        marker.addTo(drawingLayerRef.current);
      });

      if (drawnPoints.length >= 2) {
        if (activeMissionType === 'POLYGON_GRID') {
          const poly = L.polygon(
            drawnPoints.map((p) => [p.lat, p.lng]),
            {
              color: '#3b82f6',
              weight: 2.5,
              fillColor: '#3b82f6',
              fillOpacity: 0.2,
              dashArray: '5, 5',
            }
          );
          poly.addTo(drawingLayerRef.current);
        } else {
          const line = L.polyline(
            drawnPoints.map((p) => [p.lat, p.lng]),
            {
              color: '#f59e0b',
              weight: 3,
              dashArray: '4, 4',
            }
          );
          line.addTo(drawingLayerRef.current);
        }
      }
    }

    // 2. Draw Circle if configured
    if (circleCenter) {
      const centerMarker = L.circleMarker([circleCenter.lat, circleCenter.lng], {
        radius: 6,
        color: '#ffffff',
        fillColor: '#10b981',
        fillOpacity: 0.9,
        weight: 2,
      });
      centerMarker.addTo(drawingLayerRef.current);

      const circleVisual = L.circle([circleCenter.lat, circleCenter.lng], {
        radius: circleRadius,
        color: '#10b981',
        weight: 2.5,
        fillColor: '#10b981',
        fillOpacity: 0.2,
      });
      circleVisual.addTo(drawingLayerRef.current);
    }
  }, [drawnPoints, circleCenter, circleRadius, activeMissionType]);

  // -------------------------------------------------------------
  // Mission Generation Hook (Updates immediately when inputs change)
  // -------------------------------------------------------------
  const generateMissionRoute = useCallback(() => {
    setErrorMessage(null);

    try {
      let mission: GroundStationMission | null = null;

      if (activeMissionType === 'WAYPOINTS') {
        if (drawnPoints.length === 0) {
          groundStationMissionService.clearMission();
          setGeneratedMission(null);
          return;
        }
        mission = groundStationMissionService.generateWaypointMission(
          drawnPoints,
          homePoint,
          altitude,
          speed,
          true
        );
      } else if (activeMissionType === 'PATH') {
        if (drawnPoints.length < 2) {
          groundStationMissionService.clearMission();
          setGeneratedMission(null);
          return;
        }
        mission = groundStationMissionService.generatePathMission(
          drawnPoints,
          homePoint,
          altitude,
          speed,
          25,
          true
        );
      } else if (activeMissionType === 'CIRCLE') {
        if (!circleCenter) {
          groundStationMissionService.clearMission();
          setGeneratedMission(null);
          return;
        }
        mission = groundStationMissionService.generateCircleMission(
          circleCenter,
          circleRadius,
          homePoint,
          altitude,
          speed,
          circleDirection,
          true
        );
      } else if (activeMissionType === 'POLYGON_GRID') {
        if (drawnPoints.length < 3) {
          groundStationMissionService.clearMission();
          setGeneratedMission(null);
          return;
        }
        mission = groundStationMissionService.generatePolygonGridMission(
          drawnPoints,
          homePoint,
          altitude,
          speed,
          gridSpacing,
          true
        );
      }

      setGeneratedMission(mission);
    } catch (err: any) {
      console.warn('[Mission Generation Warning]', err);
      setErrorMessage(err?.message || 'Invalid mission geometry');
    }
  }, [
    activeMissionType,
    drawnPoints,
    circleCenter,
    circleRadius,
    circleDirection,
    homePoint,
    altitude,
    speed,
    gridSpacing,
  ]);

  useEffect(() => {
    generateMissionRoute();
  }, [generateMissionRoute]);

  // -------------------------------------------------------------
  // Render Generated Mission Route on Map (Waypoints, Arrows, RTL)
  // -------------------------------------------------------------
  useEffect(() => {
    missionLayerRef.current.clearLayers();
    if (!generatedMission || !generatedMission.waypoints.length) return;

    const wps = generatedMission.waypoints;
    const waypointsLatLng = wps.map((w) => [w.lat, w.lng] as [number, number]);

    // 1. Transit line from Home to Waypoint 1 (dashed sky blue)
    if (homePoint.isSet && wps.length > 0) {
      const transitLine = L.polyline(
        [
          [homePoint.latitude, homePoint.longitude],
          [wps[0].lat, wps[0].lng],
        ],
        {
          color: '#38bdf8',
          weight: 2.5,
          dashArray: '6, 6',
          opacity: 0.8,
        }
      );
      transitLine.bindTooltip('Transit: Home ➔ W1', { sticky: true, className: 'tactical-popup' });
      transitLine.addTo(missionLayerRef.current);
    }

    // 2. Main Flight Path between waypoints
    const mainPath = L.polyline(waypointsLatLng, {
      color: '#0284c7',
      weight: 3.5,
      opacity: 0.9,
    });
    mainPath.addTo(missionLayerRef.current);

    // 3. Waypoint Markers
    wps.forEach((wp, idx) => {
      const isStart = idx === 0;
      const isRtl = wp.action === 'RTL';
      const bgColor = isRtl ? '#ef4444' : isStart ? '#10b981' : '#0284c7';

      const wpHtml = `
        <div style="background: ${bgColor}; color: #ffffff; width: 24px; height: 24px; border-radius: 50%; border: 2px solid #ffffff; font-weight: 800; font-size: 11px; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 6px rgba(0,0,0,0.6); cursor: pointer;">
          ${isRtl ? 'R' : wp.index}
        </div>
      `;

      const wpIcon = L.divIcon({
        html: wpHtml,
        className: 'waypoint-marker-pin',
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });

      const wpMarker = L.marker([wp.lat, wp.lng], {
        icon: wpIcon,
        draggable: !generatedMission.isUploaded && !telemetry.isArmed && (activeMissionType === 'WAYPOINTS'),
      });

      wpMarker.bindPopup(`
        <div class="space-y-1">
          <div class="font-black text-sky-400 flex items-center justify-between">
            <span>${wp.name || `Waypoint ${wp.index}`}</span>
            <span class="text-[9px] px-1 bg-slate-800 text-slate-300 rounded">${wp.action || 'NAV'}</span>
          </div>
          <div class="text-[10px] text-slate-300">Lat: ${wp.lat.toFixed(6)} | Lon: ${wp.lng.toFixed(6)}</div>
          <div class="text-[10px] text-slate-300">Altitude: ${wp.altitude} m | Speed: ${wp.speed} m/s</div>
          ${wp.distanceFromPreviousMeters ? `<div class="text-[9px] text-slate-400">Leg Dist: ${wp.distanceFromPreviousMeters} m</div>` : ''}
        </div>
      `, { className: 'tactical-popup' });

      // If user drags individual waypoint in Waypoint mode: update coordinate
      wpMarker.on('dragend', (e) => {
        const target = e.target as L.Marker;
        const newPos = target.getLatLng();
        setDrawnPoints((prev) => {
          const updated = [...prev];
          if (updated[idx]) {
            updated[idx] = { lat: newPos.lat, lng: newPos.lng };
          }
          return updated;
        });
        audioService.playBeep(700, 50);
      });

      wpMarker.addTo(missionLayerRef.current);
    });
  }, [generatedMission, homePoint, telemetry.isArmed, activeMissionType]);

  // -------------------------------------------------------------
  // Search Nominatim API (Reused from GoogleMap.html)
  // -------------------------------------------------------------
  const handleSearchPlaces = async () => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    setSearchResults([]);

    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
        searchQuery
      )}&limit=5`;
      const res = await fetch(url);
      const data = await res.json();

      if (Array.isArray(data) && data.length > 0) {
        const results: MapSearchResult[] = data.map((d: any) => ({
          displayName: d.display_name,
          lat: parseFloat(d.lat),
          lng: parseFloat(d.lon),
          type: d.type,
        }));
        setSearchResults(results);
      } else {
        setSearchResults([]);
        setErrorMessage('No locations found. Try entering coordinates or city name.');
      }
    } catch (e: any) {
      console.error('[Search Error]', e);
      setErrorMessage('Location search failed. Check network link.');
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectSearchResult = (result: MapSearchResult) => {
    const map = mapInstanceRef.current;
    if (!map) return;

    map.flyTo([result.lat, result.lng], 17, { duration: 1.5 });
    setSearchResults([]);
    setSearchQuery(result.displayName.split(',')[0]);

    // Drop temporary search marker
    const searchMarker = L.circleMarker([result.lat, result.lng], {
      radius: 8,
      color: '#ffffff',
      fillColor: '#f59e0b',
      fillOpacity: 0.9,
      weight: 3,
    })
      .bindPopup(`<div class="font-bold text-xs">${result.displayName}</div>`, {
        className: 'tactical-popup',
      })
      .addTo(map)
      .openPopup();

    setTimeout(() => {
      map.removeLayer(searchMarker);
    }, 15000);
  };

  // -------------------------------------------------------------
  // Map Centering Actions & Operator Geolocation
  // -------------------------------------------------------------
  const handleRecenterDrone = () => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (hasValidFcGps) {
      map.flyTo([telemetry.latitude, telemetry.longitude], map.getZoom(), { duration: 1.2 });
      audioService.playBeep(750, 60);
    } else {
      setErrorMessage('GPS unavailable — waiting for valid FC coordinates');
    }
  };

  const handleCenterDrone = handleRecenterDrone;

  const handleGetOperatorLocation = () => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (!navigator.geolocation) {
      setErrorMessage('Browser geolocation is not supported on this device.');
      return;
    }

    setIsDetectingOperatorLocation(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setIsDetectingOperatorLocation(false);
        const { latitude, longitude, accuracy } = pos.coords;
        setOperatorLocation({ lat: latitude, lng: longitude, accuracy });

        // Update or create operator marker
        if (operatorMarkerRef.current) {
          operatorMarkerRef.current.setLatLng([latitude, longitude]);
        } else {
          const operatorIcon = L.divIcon({
            className: 'operator-location-marker',
            html: `
              <div style="background: #2563eb; width: 30px; height: 30px; border-radius: 50%; border: 2.5px solid #ffffff; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 10px rgba(37, 99, 235, 0.7);">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/>
                  <circle cx="12" cy="7" r="4"/>
                </svg>
              </div>
            `,
            iconSize: [30, 30],
            iconAnchor: [15, 15]
          });

          const marker = L.marker([latitude, longitude], { icon: operatorIcon, zIndexOffset: 700 });
          marker.bindPopup(`
            <div class="space-y-1">
              <div class="font-bold text-blue-400">OPERATOR / DEVICE LOCATION</div>
              <div class="text-[10px] text-slate-300">Lat: ${latitude.toFixed(6)} | Lon: ${longitude.toFixed(6)}</div>
              <div class="text-[10px] text-slate-400">Accuracy: ±${accuracy.toFixed(1)}m</div>
              <div class="text-[9px] text-slate-500 italic mt-1">(Ground Station device position, distinct from drone)</div>
            </div>
          `, { className: 'tactical-popup' });
          marker.addTo(map);
          operatorMarkerRef.current = marker;
        }

        // Update or create accuracy circle
        if (operatorAccuracyCircleRef.current) {
          operatorAccuracyCircleRef.current.setLatLng([latitude, longitude]);
          operatorAccuracyCircleRef.current.setRadius(accuracy);
        } else {
          const circle = L.circle([latitude, longitude], {
            radius: accuracy,
            color: '#3b82f6',
            fillColor: '#3b82f6',
            fillOpacity: 0.1,
            weight: 1,
            dashArray: '3, 3'
          }).addTo(map);
          operatorAccuracyCircleRef.current = circle;
        }

        audioService.playBeep(880, 80);
      },
      (err) => {
        setIsDetectingOperatorLocation(false);
        let msg = 'Unable to get device location.';
        if (err.code === 1) msg = 'Location access was denied in browser settings.';
        else if (err.code === 2) msg = 'Device location is unavailable.';
        else if (err.code === 3) msg = 'Location request timed out.';
        setErrorMessage(msg);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
    );
  };

  const handleCenterHome = () => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (homePoint.isSet && homePoint.latitude) {
      map.flyTo([homePoint.latitude, homePoint.longitude], Math.max(17, map.getZoom()), { duration: 1 });
      audioService.playBeep(700, 60);
    } else {
      setErrorMessage('Home Point has not been set yet.');
    }
  };

  const handleFitMissionBounds = () => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const allPoints: L.LatLng[] = [];
    if (homePoint.isSet) allPoints.push(new L.LatLng(homePoint.latitude, homePoint.longitude));
    if (telemetry.latitude && telemetry.longitude) allPoints.push(new L.LatLng(telemetry.latitude, telemetry.longitude));
    if (generatedMission?.waypoints.length) {
      generatedMission.waypoints.forEach((w) => allPoints.push(new L.LatLng(w.lat, w.lng)));
    } else {
      drawnPoints.forEach((p) => allPoints.push(new L.LatLng(p.lat, p.lng)));
    }

    if (allPoints.length > 0) {
      const bounds = L.latLngBounds(allPoints);
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 19 });
      audioService.playBeep(650, 60);
    }
  };

  // -------------------------------------------------------------
  // Clear & Undo Actions
  // -------------------------------------------------------------
  const handleClearDrawings = () => {
    setDrawnPoints([]);
    setCircleCenter(null);
    groundStationMissionService.clearMission();
    setGeneratedMission(null);
    setUploadFeedback(null);
    audioService.playBeep(450, 100);
  };

  const handleUndoPoint = () => {
    if (drawnPoints.length > 0) {
      setDrawnPoints((prev) => prev.slice(0, -1));
      audioService.playBeep(600, 60);
    }
  };

  // Start mission directly from current FC GPS location (Requirement 7)
  const handleStartFromDroneLocation = () => {
    if (!hasValidFcGps) {
      setErrorMessage('FC GPS coordinates unavailable: waiting for 3D satellite fix.');
      audioService.playBeep(300, 150);
      return;
    }
    const dronePos = { lat: telemetry.latitude, lng: telemetry.longitude };
    if (activeMissionType === 'CIRCLE') {
      setCircleCenter(dronePos);
      audioService.playBeep(880, 80);
    } else {
      setDrawnPoints([
        dronePos,
        ...drawnPoints.filter(
          (p) => calculateHaversineDistance(p.lat, p.lng, dronePos.lat, dronePos.lng) > 1
        ),
      ]);
      audioService.playBeep(880, 80);
    }
  };

  // -------------------------------------------------------------
  // Upload Mission to Drone FC (ESP32-S3 / Pixhawk Layer)
  // -------------------------------------------------------------
  const handleUploadMission = async () => {
    if (!generatedMission) {
      setErrorMessage('Please create or draw a mission first.');
      return;
    }

    setIsUploading(true);
    setUploadFeedback(null);

    const res = await groundStationMissionService.uploadMissionToDrone();
    setIsUploading(false);
    setUploadFeedback(res);

    if (res.success) {
      setGeneratedMission({ ...generatedMission, isUploaded: true });
    }
  };

  // -------------------------------------------------------------
  // Start Mission Flow (With deliberate safety confirmation)
  // -------------------------------------------------------------
  const handleConfirmAndStartFlight = () => {
    setIsArmingModalOpen(false);
    onStartMission();
    audioService.playBeep(880, 150);
  };

  return (
    <div className={`relative flex flex-col w-full h-[620px] sm:h-[680px] lg:h-[750px] bg-sae-dark rounded-2xl border border-slate-800 overflow-hidden select-none font-mono ${className}`}>

      {/* ============================================================ */}
      {/* 1. TOP GROUND CONTROL STATUS BAR                             */}
      {/* ============================================================ */}
      <div className="z-10 flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-slate-900/95 border-b border-slate-800 text-xs text-slate-300">
        
        {/* Left: State Badge & Location Status (Requirement 18 & 3) */}
        <div className="flex items-center space-x-2 sm:space-x-3 overflow-x-auto py-0.5">
          <div className="flex items-center space-x-1.5 shrink-0">
            <span className={`w-2.5 h-2.5 rounded-full ${
              currentGcsState === 'Executing Mission' || currentGcsState === 'Taking Off'
                ? 'bg-emerald-400 animate-pulse'
                : currentGcsState === 'Armed'
                ? 'bg-amber-400'
                : currentGcsState === 'Disconnected'
                ? 'bg-rose-500'
                : 'bg-sky-400'
            }`} />
            <span className="font-extrabold uppercase tracking-wide text-white">
              GCS:
            </span>
            <span className={`px-2 py-0.5 rounded font-black text-[10px] border ${
              currentGcsState === 'Executing Mission'
                ? 'bg-emerald-950/80 border-emerald-500 text-emerald-300'
                : currentGcsState === 'Armed'
                ? 'bg-amber-950/80 border-amber-500 text-amber-300'
                : currentGcsState === 'Disconnected'
                ? 'bg-rose-950/80 border-rose-500 text-rose-300'
                : 'bg-slate-800 border-slate-700 text-sky-300'
            }`}>
              {currentGcsState.toUpperCase()}
            </span>
          </div>

          {/* Location Status Strip (Requirement 18) */}
          <div className="hidden sm:flex items-center space-x-2 text-[11px] text-slate-300 shrink-0 font-mono">
            <span className="text-slate-600">•</span>
            <span className={isFcConnected ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
              FC: {isFcConnected ? 'CONNECTED' : 'WAITING FOR FC...'}
            </span>
            <span className="text-slate-600">•</span>
            <span className={hasValidFcGps ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>
              GPS: {hasValidFcGps ? `${telemetry.gps?.fixType || 'FIXED'} (${telemetry.gps?.satellites || 0} SATS)` : 'WAITING FOR FIX'}
            </span>
            <span className="text-slate-600">•</span>
            <span>
              LAT: <span className="font-bold text-sky-300">{hasValidFcGps ? telemetry.latitude.toFixed(6) : '--'}</span>
            </span>
            <span className="text-slate-600">•</span>
            <span>
              LON: <span className="font-bold text-sky-300">{hasValidFcGps ? telemetry.longitude.toFixed(6) : '--'}</span>
            </span>
            <span className="text-slate-600">•</span>
            <span>
              ALT: <span className="font-bold text-amber-300">{hasValidFcGps ? `${telemetry.altitude.toFixed(1)} m` : '--'}</span>
            </span>
            <span className="text-slate-600">•</span>
            <span className="text-slate-300">
              BATT: <span className="font-bold text-slate-100">{telemetry.batteryPercent}% ({telemetry.batteryVoltage.toFixed(1)}V)</span>
            </span>
          </div>
        </div>

        {/* Right: Quick Tools & Recenter */}
        <div className="flex items-center space-x-1.5 sm:space-x-2 shrink-0">
          <button
            type="button"
            onClick={handleRecenterDrone}
            className="px-2.5 py-1 rounded bg-sky-950/80 hover:bg-sky-900 border border-sky-500/60 text-sky-300 hover:text-white text-[11px] font-black uppercase flex items-center space-x-1.5 transition cursor-pointer shadow-sm shadow-sky-600/20"
            title="Recenter map on current Drone / FC GPS position"
          >
            <Navigation className="w-3.5 h-3.5 fill-sky-400" />
            <span className="hidden sm:inline">RECENTER ON DRONE</span>
          </button>

          {onTogglePipVideo && (
            <button
              type="button"
              onClick={onTogglePipVideo}
              className={`px-2 py-1 rounded text-[11px] font-bold flex items-center space-x-1 border transition cursor-pointer ${
                isPipVideoVisible
                  ? 'bg-sky-600 text-white border-sky-400'
                  : 'bg-slate-800 text-slate-300 border-slate-700 hover:text-white'
              }`}
              title="Toggle Live Video Feed Picture-in-Picture"
            >
              <Video className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">LIVE CAM</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleFitMissionBounds}
            className="p-1 sm:px-2 sm:py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-[11px] font-bold flex items-center space-x-1 transition cursor-pointer"
            title="Fit Mission Bounds"
          >
            <Maximize className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">FIT BOUNDS</span>
          </button>

          <button
            type="button"
            onClick={() => setIsSidePanelCollapsed(!isSidePanelCollapsed)}
            className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-[11px] font-bold flex items-center space-x-1 transition cursor-pointer"
            title="Toggle Mission Configuration Side Panel"
          >
            <Sliders className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden sm:inline">{isSidePanelCollapsed ? 'EXPAND PANEL' : 'COLLAPSE'}</span>
          </button>
        </div>
      </div>

      {/* ============================================================ */}
      {/* 2. MAIN WORKSPACE (MAP + FLOATING OVERLAYS + SIDE PANEL)      */}
      {/* ============================================================ */}
      <div className="relative flex-1 w-full h-full flex overflow-hidden">
        
        {/* LEAFLET GOOGLE MAP VIEW CONTAINER */}
        <div ref={mapContainerRef} className="w-full h-full z-0" />

        {/* ------------------------------------------------------------- */}
        {/* TOP LEFT: SEARCH BAR (GoogleMap.html Nominatim Search)        */}
        {/* ------------------------------------------------------------- */}
        <div className="absolute top-3 left-3 z-[400] w-64 sm:w-80">
          <div className="relative flex items-center bg-slate-900/90 backdrop-blur-md rounded-xl border border-slate-700 shadow-xl overflow-hidden">
            <Search className="w-4 h-4 ml-3 text-slate-400 shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearchPlaces()}
              placeholder="Search location or coordinates..."
              className="w-full bg-transparent px-2.5 py-2 text-xs text-white placeholder-slate-400 focus:outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="p-1.5 text-slate-400 hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={handleSearchPlaces}
              disabled={isSearching}
              className="px-2.5 py-2 bg-sky-600 hover:bg-sky-500 text-white font-bold text-[10px] uppercase transition cursor-pointer"
            >
              {isSearching ? '...' : 'GO'}
            </button>
          </div>

          {/* Search Dropdown Results */}
          {searchResults.length > 0 && (
            <div className="absolute top-11 left-0 w-full bg-slate-900/95 backdrop-blur-md border border-slate-700 rounded-xl shadow-2xl overflow-hidden mt-1 max-h-56 overflow-y-auto">
              {searchResults.map((res, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => handleSelectSearchResult(res)}
                  className="w-full text-left p-2.5 hover:bg-sky-950/60 border-b border-slate-800 text-[11px] text-slate-200 flex items-start space-x-2 transition"
                >
                  <MapPin className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                  <span className="line-clamp-2 leading-tight">{res.displayName}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ------------------------------------------------------------- */}
        {/* TOP RIGHT: MAP LAYER SWITCHER (Street / Sat / Topo / Dark)    */}
        {/* Reused from GoogleMap.html buttons                            */}
        {/* ------------------------------------------------------------- */}
        <div className="absolute top-3 right-3 sm:right-auto sm:left-[350px] z-[400] flex items-center bg-slate-900/90 backdrop-blur-md p-1 rounded-xl border border-slate-700 shadow-xl space-x-1">
          {[
            { id: 'satellite', label: 'SATELLITE' },
            { id: 'street', label: 'STREET' },
            { id: 'topo', label: 'TOPO' },
            { id: 'dark', label: 'DARK' },
          ].map((layer) => (
            <button
              key={layer.id}
              type="button"
              onClick={() => switchMapLayer(layer.id as MapLayerType)}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-extrabold uppercase transition cursor-pointer ${
                currentLayerType === layer.id
                  ? 'bg-sky-600 text-white shadow-md shadow-sky-600/30'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              {layer.label}
            </button>
          ))}
        </div>

        {/* ------------------------------------------------------------- */}
        {/* FLOATING DRAWING TOOLBAR (Left Side on Desktop / Bottom)      */}
        {/* ------------------------------------------------------------- */}
        <div className="absolute left-3 top-16 sm:top-16 z-[400] flex flex-col bg-slate-900/90 backdrop-blur-md p-1.5 rounded-xl border border-slate-700 shadow-2xl space-y-1">
          <div className="text-[9px] font-black uppercase text-slate-400 px-1 py-0.5 text-center">
            DRAW
          </div>

          {/* Waypoint Point Tool */}
          <button
            type="button"
            onClick={() => {
              setActiveTool('point');
              setActiveMissionType('WAYPOINTS');
              audioService.playBeep(700, 60);
            }}
            className={`p-2 rounded-lg text-xs font-bold flex items-center justify-center transition cursor-pointer ${
              activeTool === 'point' && activeMissionType === 'WAYPOINTS'
                ? 'bg-sky-600 text-white shadow-md shadow-sky-600/40'
                : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
            title="Waypoint Mode: Click map to place numbered waypoints"
          >
            <MapPin className="w-4 h-4" />
          </button>

          {/* Path / Polyline Tool */}
          <button
            type="button"
            onClick={() => {
              setActiveTool('path');
              setActiveMissionType('PATH');
              audioService.playBeep(700, 60);
            }}
            className={`p-2 rounded-lg text-xs font-bold flex items-center justify-center transition cursor-pointer ${
              activeTool === 'path' && activeMissionType === 'PATH'
                ? 'bg-amber-600 text-white shadow-md shadow-amber-600/40'
                : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
            title="Path Mode: Draw connected polyline path"
          >
            <Navigation className="w-4 h-4" />
          </button>

          {/* Polygon / Area Survey Tool */}
          <button
            type="button"
            onClick={() => {
              setActiveTool('polygon');
              setActiveMissionType('POLYGON_GRID');
              audioService.playBeep(700, 60);
            }}
            className={`p-2 rounded-lg text-xs font-bold flex items-center justify-center transition cursor-pointer ${
              activeTool === 'polygon' && activeMissionType === 'POLYGON_GRID'
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/40'
                : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
            title="Polygon Grid Mode: Draw area boundary to generate survey lawnmower grid"
          >
            <SquareIcon className="w-4 h-4" />
          </button>

          {/* Circle Mission Tool */}
          <button
            type="button"
            onClick={() => {
              setActiveTool('circle');
              setActiveMissionType('CIRCLE');
              setCircleCenter(null);
              audioService.playBeep(700, 60);
            }}
            className={`p-2 rounded-lg text-xs font-bold flex items-center justify-center transition cursor-pointer ${
              activeTool === 'circle' && activeMissionType === 'CIRCLE'
                ? 'bg-purple-600 text-white shadow-md shadow-purple-600/40'
                : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
            title="Circle Mode: Click center and click/drag radius to generate circular orbit"
          >
            <CircleIcon className="w-4 h-4" />
          </button>

          {/* Set Home Point Tool */}
          <button
            type="button"
            onClick={() => {
              setActiveTool('set_home');
              audioService.playBeep(700, 60);
            }}
            className={`p-2 rounded-lg text-xs font-bold flex items-center justify-center transition cursor-pointer ${
              activeTool === 'set_home'
                ? 'bg-cyan-600 text-white shadow-md shadow-cyan-600/40 animate-pulse'
                : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
            title="Set Home: Click on map to position Home Reference Point"
          >
            <Crosshair className="w-4 h-4 text-cyan-300" />
          </button>

          <div className="w-full border-t border-slate-700/80 my-1" />

          {/* Undo Point */}
          <button
            type="button"
            onClick={handleUndoPoint}
            disabled={drawnPoints.length === 0}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition"
            title="Undo Last Drawn Point"
          >
            <Undo2 className="w-4 h-4" />
          </button>

          {/* Clear All */}
          <button
            type="button"
            onClick={handleClearDrawings}
            disabled={drawnPoints.length === 0 && !circleCenter && !generatedMission}
            className="p-2 rounded-lg text-rose-400 hover:text-white hover:bg-rose-950 disabled:opacity-30 disabled:cursor-not-allowed transition"
            title="Clear Mission Drawings"
          >
            <Trash2 className="w-4 h-4" />
          </button>

          <div className="w-full border-t border-slate-700/80 my-1" />

          {/* Center Drone */}
          <button
            type="button"
            onClick={handleCenterDrone}
            className="p-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition"
            title="Locate / Center Drone"
          >
            <Navigation className="w-4 h-4 text-sky-400" />
          </button>

          {/* Center Home Point */}
          <button
            type="button"
            onClick={handleCenterHome}
            className="p-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition"
            title="Locate Home Point"
          >
            <MapPin className="w-4 h-4 text-cyan-400" />
          </button>

          {/* Operator Device Location (Browser Geolocation - distinct from drone) */}
          <button
            type="button"
            onClick={handleGetOperatorLocation}
            disabled={isDetectingOperatorLocation}
            className={`p-2 rounded-lg text-xs font-bold flex items-center justify-center transition cursor-pointer ${
              isDetectingOperatorLocation
                ? 'bg-blue-900/60 text-blue-200 animate-pulse'
                : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
            title="Locate Operator / Ground Station Device (Browser Geolocation)"
          >
            <User className="w-4 h-4 text-blue-400" />
          </button>
        </div>

        {/* ------------------------------------------------------------- */}
        {/* REQUIREMENT 3: FC GPS FIX STATUS FLOATING WARNING BANNER      */}
        {/* ------------------------------------------------------------- */}
        {!hasValidFcGps && (
          <div className="absolute top-14 left-1/2 -translate-x-1/2 z-[450] bg-slate-900/95 border border-amber-500/80 text-amber-200 px-4 py-2 rounded-xl text-xs flex items-center space-x-2.5 shadow-2xl backdrop-blur-md font-mono animate-pulse">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
            <span className="font-bold tracking-wide">GPS unavailable — waiting for valid FC coordinates</span>
          </div>
        )}

        {/* ------------------------------------------------------------- */}
        {/* ERROR / FEEDBACK FLOATING BANNER                              */}
        {/* ------------------------------------------------------------- */}
        {errorMessage && (
          <div className="absolute top-26 left-1/2 -translate-x-1/2 z-[500] max-w-md bg-rose-950/90 border border-rose-500 text-rose-200 px-3.5 py-2 rounded-xl text-xs flex items-center space-x-2 shadow-2xl backdrop-blur-md">
            <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
            <span className="flex-1 leading-tight">{errorMessage}</span>
            <button
              type="button"
              onClick={() => setErrorMessage(null)}
              className="text-rose-300 hover:text-white p-1"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* ------------------------------------------------------------- */}
        {/* MISSION PLANNING CONTROL PANEL (Side Panel / Collapsible)     */}
        {/* ------------------------------------------------------------- */}
        <div className={`absolute right-3 top-3 bottom-3 z-[400] transition-all duration-300 flex flex-col ${
          isSidePanelCollapsed ? 'w-0 opacity-0 pointer-events-none' : 'w-80 sm:w-96'
        }`}>
          <div className="flex-1 flex flex-col bg-slate-900/95 backdrop-blur-md rounded-2xl border border-slate-700 shadow-2xl overflow-hidden font-mono">
            
            {/* Panel Header */}
            <div className="flex items-center justify-between px-3.5 py-2.5 bg-slate-950/80 border-b border-slate-800">
              <div className="flex items-center space-x-2">
                <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse" />
                <span className="text-xs font-black uppercase tracking-wider text-slate-200">
                  MISSION PLANNER
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsSidePanelCollapsed(true)}
                className="text-slate-400 hover:text-white p-1"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {/* Scrollable Configuration Body */}
            <div className="flex-1 overflow-y-auto p-3.5 space-y-3.5 text-xs">
              
              {/* Mission Type Selector */}
              <div>
                <label className="text-[10px] text-slate-400 uppercase font-extrabold block mb-1.5">
                  1. Mission Pattern Type
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    { id: 'WAYPOINTS', label: 'WAYPOINTS', desc: 'Point-to-point' },
                    { id: 'PATH', label: 'PATH / LINE', desc: 'Ordered corridor' },
                    { id: 'POLYGON_GRID', label: 'AREA GRID', desc: 'Lawnmower survey' },
                    { id: 'CIRCLE', label: 'CIRCLE ORBIT', desc: 'Radial perimeter' },
                  ].map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => {
                        setActiveMissionType(m.id as MissionType);
                        if (m.id === 'WAYPOINTS') setActiveTool('point');
                        if (m.id === 'PATH') setActiveTool('path');
                        if (m.id === 'POLYGON_GRID') setActiveTool('polygon');
                        if (m.id === 'CIRCLE') setActiveTool('circle');
                        audioService.playBeep(700, 50);
                      }}
                      className={`p-2 rounded-xl border text-left transition cursor-pointer ${
                        activeMissionType === m.id
                          ? 'bg-sky-950/80 border-sky-400 text-sky-200 shadow-md shadow-sky-950/40'
                          : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                      }`}
                    >
                      <div className="font-black text-[11px]">{m.label}</div>
                      <div className="text-[9px] text-slate-400 truncate">{m.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* FC Drone Origin Seeding (Requirement 7) */}
              <div className="bg-slate-950/80 p-2.5 rounded-xl border border-sky-500/30 flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Navigation className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                  <div className="flex flex-col">
                    <span className="text-[10px] font-black text-sky-200 uppercase">Start From FC Location</span>
                    <span className="text-[9px] text-slate-400">
                      {hasValidFcGps
                        ? `${telemetry.latitude.toFixed(5)}, ${telemetry.longitude.toFixed(5)}`
                        : 'Waiting for FC GPS fix...'}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleStartFromDroneLocation}
                  disabled={!hasValidFcGps}
                  className="px-2.5 py-1 rounded bg-sky-600 hover:bg-sky-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[10px] font-extrabold uppercase transition cursor-pointer"
                  title="Add current FC GPS coordinates as origin/center"
                >
                  SET ORIGIN
                </button>
              </div>

              {/* Altitude Configuration */}
              <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-400 uppercase font-extrabold">
                    2. Planned Altitude
                  </span>
                  <span className="font-extrabold text-amber-300 text-sm">
                    {altitude} m
                  </span>
                </div>

                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => setAltitude((a) => Math.max(2, a - 5))}
                    className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                  <input
                    type="range"
                    min="2"
                    max="100"
                    step="1"
                    value={altitude}
                    onChange={(e) => setAltitude(parseInt(e.target.value) || 10)}
                    className="flex-1 accent-amber-400 cursor-pointer"
                  />
                  <button
                    type="button"
                    onClick={() => setAltitude((a) => Math.min(120, a + 5))}
                    className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="flex items-center space-x-1.5 pt-1">
                  {[10, 20, 30, 50, 80].map((altVal) => (
                    <button
                      key={altVal}
                      type="button"
                      onClick={() => setAltitude(altVal)}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold border transition ${
                        altitude === altVal
                          ? 'bg-amber-600 text-white border-amber-400'
                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      {altVal}m
                    </button>
                  ))}
                </div>
              </div>

              {/* Speed Configuration */}
              <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-400 uppercase font-extrabold">
                    3. Planned Speed
                  </span>
                  <span className="font-extrabold text-sky-300 text-sm">
                    {speed.toFixed(1)} m/s
                  </span>
                </div>

                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => setSpeed((s) => Math.max(1, +(s - 0.5).toFixed(1)))}
                    className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                  <input
                    type="range"
                    min="1"
                    max="15"
                    step="0.5"
                    value={speed}
                    onChange={(e) => setSpeed(parseFloat(e.target.value) || 3)}
                    className="flex-1 accent-sky-400 cursor-pointer"
                  />
                  <button
                    type="button"
                    onClick={() => setSpeed((s) => Math.min(15, +(s + 0.5).toFixed(1)))}
                    className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="flex items-center space-x-1.5 pt-1">
                  {[2.0, 3.0, 5.0, 8.0].map((sVal) => (
                    <button
                      key={sVal}
                      type="button"
                      onClick={() => setSpeed(sVal)}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold border transition ${
                        speed === sVal
                          ? 'bg-sky-600 text-white border-sky-400'
                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      {sVal} m/s
                    </button>
                  ))}
                </div>
              </div>

              {/* Mode-Specific Parameters */}
              {activeMissionType === 'POLYGON_GRID' && (
                <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-400 uppercase font-extrabold">
                      Lane Spacing (Transect)
                    </span>
                    <span className="font-extrabold text-emerald-300">{gridSpacing}m</span>
                  </div>
                  <input
                    type="range"
                    min="4"
                    max="25"
                    step="1"
                    value={gridSpacing}
                    onChange={(e) => setGridSpacing(parseInt(e.target.value) || 8)}
                    className="w-full accent-emerald-400 cursor-pointer"
                  />
                </div>
              )}

              {activeMissionType === 'CIRCLE' && (
                <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-400 uppercase font-extrabold">
                      Circle Radius
                    </span>
                    <span className="font-extrabold text-purple-300">{circleRadius}m</span>
                  </div>
                  <input
                    type="range"
                    min="5"
                    max="150"
                    step="5"
                    value={circleRadius}
                    onChange={(e) => setCircleRadius(parseInt(e.target.value) || 25)}
                    className="w-full accent-purple-400 cursor-pointer"
                  />
                  <div className="flex items-center space-x-2 pt-1">
                    <span className="text-[10px] text-slate-400 uppercase">Orbit:</span>
                    <button
                      type="button"
                      onClick={() => setCircleDirection('CW')}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold border transition ${
                        circleDirection === 'CW'
                          ? 'bg-purple-600 text-white border-purple-400'
                          : 'bg-slate-900 border-slate-800 text-slate-400'
                      }`}
                    >
                      CLOCKWISE
                    </button>
                    <button
                      type="button"
                      onClick={() => setCircleDirection('CCW')}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold border transition ${
                        circleDirection === 'CCW'
                          ? 'bg-purple-600 text-white border-purple-400'
                          : 'bg-slate-900 border-slate-800 text-slate-400'
                      }`}
                    >
                      COUNTER-CW
                    </button>
                  </div>
                </div>
              )}

              {/* Mission Statistics Card */}
              {generatedMission && (
                <div className="bg-slate-950/90 p-3 rounded-xl border border-sky-500/40 space-y-2">
                  <div className="flex items-center justify-between text-[11px] font-black uppercase text-sky-300 border-b border-slate-800 pb-1">
                    <span>MISSION SUMMARY</span>
                    <span>{generatedMission.waypoints.length} WAYPOINTS</span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div>
                      <span className="text-[9px] text-slate-400 uppercase block">Distance</span>
                      <span className="font-bold text-slate-200">
                        {generatedMission.totalDistance > 1000
                          ? `${(generatedMission.totalDistance / 1000).toFixed(2)} km`
                          : `${generatedMission.totalDistance} m`}
                      </span>
                    </div>

                    <div>
                      <span className="text-[9px] text-slate-400 uppercase block">Est. Duration</span>
                      <span className="font-bold text-slate-200">
                        {Math.floor(generatedMission.estimatedDuration / 60)}m {generatedMission.estimatedDuration % 60}s
                      </span>
                    </div>

                    <div>
                      <span className="text-[9px] text-slate-400 uppercase block">Home Point</span>
                      <span className="font-bold text-cyan-300">
                        {homePoint.isSet ? 'CONFIGURED ✓' : 'NOT SET ⚠'}
                      </span>
                    </div>

                    <div>
                      <span className="text-[9px] text-slate-400 uppercase block">Upload State</span>
                      <span className={`font-bold ${generatedMission.isUploaded ? 'text-emerald-400' : 'text-amber-400'}`}>
                        {generatedMission.isUploaded ? 'UPLOADED ✓' : 'PENDING'}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Upload Feedback Message */}
              {uploadFeedback && (
                <div className={`p-2.5 rounded-xl border text-xs flex items-center space-x-2 ${
                  uploadFeedback.success
                    ? 'bg-emerald-950/70 border-emerald-500/60 text-emerald-300'
                    : 'bg-rose-950/70 border-rose-500/60 text-rose-300'
                }`}>
                  {uploadFeedback.success ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
                  )}
                  <span className="leading-tight">{uploadFeedback.message}</span>
                </div>
              )}

              {/* Force Pre-Arm Bypass Option */}
              <div className="pt-1">
                <label className="flex items-center space-x-2 select-none cursor-pointer">
                  <input
                    type="checkbox"
                    checked={forceBypassChecks}
                    onChange={(e) => setForceBypassChecks(e.target.checked)}
                    className="w-3.5 h-3.5 rounded text-amber-500 accent-amber-500 cursor-pointer"
                  />
                  <span className="text-[10px] text-slate-400 font-bold">
                    No problem, Start Mission (Bypass checks)
                  </span>
                </label>
              </div>

            </div>

            {/* Action Buttons Bar */}
            <div className="p-3 bg-slate-950 border-t border-slate-800 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleUploadMission}
                  disabled={!generatedMission || isUploading}
                  className={`py-2.5 px-3 rounded-xl font-black text-xs uppercase flex items-center justify-center space-x-1.5 transition ${
                    generatedMission && !isUploading
                      ? 'bg-sky-600 hover:bg-sky-500 text-white shadow-lg shadow-sky-600/30 cursor-pointer'
                      : 'bg-slate-800 text-slate-500 border border-slate-700/50 cursor-not-allowed'
                  }`}
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{isUploading ? 'SENDING...' : 'UPLOAD'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setIsArmingModalOpen(true)}
                  disabled={!generatedMission || (telemetry.isArmed && missionState !== 'IDLE')}
                  className={`py-2.5 px-3 rounded-xl font-black text-xs uppercase flex items-center justify-center space-x-1.5 transition ${
                    generatedMission
                      ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/30 cursor-pointer animate-pulse'
                      : 'bg-slate-800 text-slate-500 border border-slate-700/50 cursor-not-allowed'
                  }`}
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>ARM & FLY</span>
                </button>
              </div>

              <button
                type="button"
                onClick={onEmergencyRTL}
                className="w-full py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-black uppercase tracking-wider flex items-center justify-center space-x-1.5 transition cursor-pointer shadow-lg shadow-rose-600/20"
              >
                <ShieldAlert className="w-3.5 h-3.5" />
                <span>EMERGENCY RTL (RETURN HOME)</span>
              </button>
            </div>

          </div>
        </div>

      </div>

      {/* ============================================================ */}
      {/* 3. SAFETY CONFIRMATION MODAL BEFORE FLIGHT EXECUTION         */}
      {/* ============================================================ */}
      {isArmingModalOpen && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
          <div className="w-full max-w-md bg-slate-900 border border-amber-500/60 rounded-2xl p-5 shadow-2xl space-y-4 font-mono">
            <div className="flex items-center space-x-3 text-amber-400">
              <div className="p-2 rounded-xl bg-amber-950 border border-amber-500/50">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-sm font-black uppercase text-white">CONFIRM MISSION LAUNCH</h3>
                <p className="text-[11px] text-slate-400">Pixhawk FC Arming & Autonomous Flight Sequence</p>
              </div>
            </div>

            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-1.5 text-xs text-slate-300">
              <div className="flex justify-between">
                <span className="text-slate-400">Mission Type:</span>
                <span className="font-bold text-white">{generatedMission?.missionType}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Waypoints:</span>
                <span className="font-bold text-white">{generatedMission?.waypoints.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Cruise Altitude:</span>
                <span className="font-bold text-amber-300">{generatedMission?.altitude} meters</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Planned Speed:</span>
                <span className="font-bold text-sky-300">{generatedMission?.speed} m/s</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Origin / Home:</span>
                <span className="font-bold text-cyan-300">
                  {homePoint.latitude.toFixed(5)}, {homePoint.longitude.toFixed(5)}
                </span>
              </div>
            </div>

            <p className="text-[11px] text-amber-300/90 leading-relaxed">
              WARNING: Confirming will command motor arming and autonomous takeoff. Ensure ground clearance is maintained and observers are outside the propeller hazard radius.
            </p>

            <div className="grid grid-cols-2 gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsArmingModalOpen(false)}
                className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold uppercase transition cursor-pointer"
              >
                CANCEL
              </button>
              <button
                type="button"
                onClick={handleConfirmAndStartFlight}
                className="py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black uppercase tracking-wider transition cursor-pointer shadow-lg shadow-emerald-600/40"
              >
                CONFIRM & ARM
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
