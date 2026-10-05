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
import { customRouteService, LiveWaypointProgress } from '../../services/customRouteService';
import { missionEngine } from '../../services/missionEngine';
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
  User,
  Pencil,
  Smartphone
} from 'lucide-react';
import { phoneGpsService, PhoneGpsState } from '../../services/phoneGpsService';

interface GoogleMapGroundStationProps {
  telemetry: DroneTelemetry;
  homePoint: HomePoint;
  pixhawkState: PixhawkConnectionState;
  missionState: MissionState;
  onSetHomePoint: (coords?: { lat: number; lng: number }) => void;
  onStartMission: () => void;
  onEmergencyRTL: () => void;
  onStopAbortMission?: () => void;
  className?: string;
  isPipVideoVisible?: boolean;
  onTogglePipVideo?: () => void;
  targetLocation?: LatLngPoint | null;
  targetLabel?: string;
  isDrawingRoute?: boolean;
  onToggleDrawingRoute?: (drawing: boolean) => void;
  isDrawingReturn?: boolean;
  onToggleDrawingReturn?: (drawing: boolean) => void;
}

export const GoogleMapGroundStation: React.FC<GoogleMapGroundStationProps> = ({
  telemetry,
  homePoint,
  pixhawkState,
  missionState,
  onSetHomePoint,
  onStartMission,
  onEmergencyRTL,
  onStopAbortMission,
  className = '',
  isPipVideoVisible,
  onTogglePipVideo,
  targetLocation,
  targetLabel,
  isDrawingRoute: propIsDrawingRoute,
  onToggleDrawingRoute,
  isDrawingReturn: propIsDrawingReturn,
  onToggleDrawingReturn,
}) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);

  // Layer groups & tile layers
  const activeTileLayerRef = useRef<L.TileLayer | null>(null);
  const droneLayerRef = useRef<L.LayerGroup>(L.layerGroup());
  const homeLayerRef = useRef<L.LayerGroup>(L.layerGroup());
  const missionLayerRef = useRef<L.LayerGroup>(L.layerGroup());
  const customRouteLayerRef = useRef<L.LayerGroup>(L.layerGroup());
  const targetLayerRef = useRef<L.LayerGroup>(L.layerGroup());
  const drawingLayerRef = useRef<L.FeatureGroup>(new L.FeatureGroup());
  const breadcrumbsLayerRef = useRef<L.Polyline | null>(null);
  const breadcrumbHistoryRef = useRef<L.LatLng[]>([]);

  // Custom Route State (Requirement 1, 2, 8, 10, 11)
  const [internalDrawingRoute, setInternalDrawingRoute] = useState<boolean>(false);
  const [internalDrawingReturn, setInternalDrawingReturn] = useState<boolean>(false);
  const isDrawingCustomRoute = propIsDrawingRoute !== undefined ? propIsDrawingRoute : internalDrawingRoute;
  const isDrawingCustomReturn = propIsDrawingReturn !== undefined ? propIsDrawingReturn : internalDrawingReturn;

  const setIsDrawingCustomRoute = (val: boolean) => {
    setInternalDrawingRoute(val);
    if (onToggleDrawingRoute) onToggleDrawingRoute(val);
  };

  const setIsDrawingCustomReturn = (val: boolean) => {
    setInternalDrawingReturn(val);
    if (onToggleDrawingReturn) onToggleDrawingReturn(val);
  };

  const [customMission, setCustomMission] = useState<GroundStationMission | null>(() =>
    customRouteService.getCurrentMission()
  );
  const [liveProgress, setLiveProgress] = useState<LiveWaypointProgress>(() =>
    customRouteService.getProgress()
  );

  useEffect(() => {
    const unsubMission = customRouteService.subscribeMission((m) => {
      setCustomMission(m);
    });
    const unsubProg = customRouteService.subscribeProgress((p) => {
      setLiveProgress(p);
    });
    return () => {
      unsubMission();
      unsubProg();
    };
  }, []);

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
  const hasAutoCenteredOnPhoneRef = useRef<boolean>(false);
  const phoneMarkerRef = useRef<L.Marker | null>(null);
  const phoneAccuracyCircleRef = useRef<L.Circle | null>(null);
  const [phoneGps, setPhoneGps] = useState<PhoneGpsState>(() => phoneGpsService.getState());
  const [showPhoneGpsInfoPanel, setShowPhoneGpsInfoPanel] = useState<boolean>(false);

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
      customRouteLayerRef.current.addTo(map);
      targetLayerRef.current.addTo(map);
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

      // Dedicated ResizeObserver to dynamically resize map whenever container, window, or toolbar wraps
      const resizeObserver = new ResizeObserver(() => {
        if (mapInstanceRef.current) {
          mapInstanceRef.current.invalidateSize();
        }
      });
      if (mapContainerRef.current) {
        resizeObserver.observe(mapContainerRef.current);
      }

      return () => {
        resizeObserver.disconnect();
        if (mapInstanceRef.current) {
          mapInstanceRef.current.remove();
          mapInstanceRef.current = null;
        }
      };
    } catch (e: any) {
      console.error('[GCS Map Init Failed]', e);
      setErrorMessage(`Map loading failed: ${e?.message || 'Check network connection'}`);
    }
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
  // Phone GPS Subscriptions & Auto-Centering (Requirements 2, 4, 8)
  // -------------------------------------------------------------
  useEffect(() => {
    const unsubGps = phoneGpsService.subscribe(setPhoneGps);
    const unsubCenter = phoneGpsService.subscribeCenterMap((coords) => {
      const map = mapInstanceRef.current;
      if (map) {
        map.flyTo([coords.lat, coords.lng], Math.max(18, map.getZoom()), { duration: 1.0 });
        audioService.playBeep(880, 60);
        setShowPhoneGpsInfoPanel(true);
      }
    });
    return () => {
      unsubGps();
      unsubCenter();
    };
  }, []);

  // Auto-center on Phone GPS if FC GPS is not yet established (Requirements 8 & 9)
  useEffect(() => {
    if (hasAutoCenteredOnPhoneRef.current) return;
    if (!hasValidFcGps && phoneGps.status === 'CONNECTED' && phoneGps.latitude && phoneGps.longitude) {
      const map = mapInstanceRef.current;
      if (map) {
        hasAutoCenteredOnPhoneRef.current = true;
        map.setView([phoneGps.latitude, phoneGps.longitude], 18);
      }
    }
  }, [phoneGps.status, phoneGps.latitude, phoneGps.longitude, hasValidFcGps]);

  // -------------------------------------------------------------
  // Phone GPS Marker & Continuous Smooth Tracking (Requirements 1, 2, 3, 7)
  // -------------------------------------------------------------
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (
      !phoneGps.enabled ||
      phoneGps.status !== 'CONNECTED' ||
      phoneGps.latitude === null ||
      phoneGps.longitude === null
    ) {
      if (phoneMarkerRef.current) {
        phoneMarkerRef.current.remove();
        phoneMarkerRef.current = null;
      }
      if (phoneAccuracyCircleRef.current) {
        phoneAccuracyCircleRef.current.remove();
        phoneAccuracyCircleRef.current = null;
      }
      return;
    }

    let lat = phoneGps.latitude;
    let lng = phoneGps.longitude;
    const accuracy = phoneGps.accuracy || 5;
    const heading = phoneGps.heading;

    // Prevent marker hiding if phone and drone are very close together (< 2.5m) (Requirement 7)
    if (hasValidFcGps && telemetry.latitude && telemetry.longitude) {
      const distToDrone = calculateHaversineDistance(lat, lng, telemetry.latitude, telemetry.longitude);
      if (distToDrone < 2.5) {
        // Slight visual separation offset so both markers remain distinctly clickable
        lat += 0.000015;
        lng += 0.000015;
      }
    }

    const headingArrow =
      heading !== null
        ? `<div style="position: absolute; top: -14px; width: 0; height: 0; border-left: 6px solid transparent; border-right: 6px solid transparent; border-bottom: 14px solid #06b6d4; filter: drop-shadow(0 0 5px #06b6d4); transform: rotate(${heading}deg); transform-origin: 50% 35px;"></div>`
        : '';

    const phoneHtml = `
      <div style="position: relative; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center;">
        ${headingArrow}
        <!-- Pulsing radar ring -->
        <div class="animate-ping" style="position: absolute; width: 34px; height: 34px; border-radius: 50%; border: 2px solid #06b6d4; opacity: 0.4;"></div>
        <!-- Smartphone locator badge -->
        <div style="width: 30px; height: 30px; border-radius: 50%; background: #0891b2; border: 2.5px solid #ffffff; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 12px rgba(6, 182, 212, 0.85);">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <rect width="14" height="20" x="5" y="2" rx="2" ry="2"/>
            <line x1="12" x2="12.01" y1="18" y2="18"/>
          </svg>
        </div>
      </div>
    `;

    const phoneIcon = L.divIcon({
      html: phoneHtml,
      className: 'phone-location-marker',
      iconSize: [44, 44],
      iconAnchor: [22, 22],
    });

    const popupContent = `
      <div class="space-y-1.5 p-1 font-mono text-xs select-none">
        <div class="font-bold text-cyan-400 flex items-center justify-between border-b border-cyan-800/80 pb-1">
          <span class="flex items-center space-x-1">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><line x1="12" x2="12.01" y1="18" y2="18"/></svg>
            <span>PHONE GPS</span>
          </span>
          <span class="text-[9px] px-1.5 py-0.2 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-600/50">CONNECTED</span>
        </div>
        <div class="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] text-slate-200 mt-1">
          <div><span class="text-slate-400 text-[10px] block">LATITUDE:</span><span class="font-bold text-slate-100">${phoneGps.latitude.toFixed(6)}</span></div>
          <div><span class="text-slate-400 text-[10px] block">LONGITUDE:</span><span class="font-bold text-slate-100">${phoneGps.longitude.toFixed(6)}</span></div>
          <div><span class="text-slate-400 text-[10px] block">ACCURACY:</span><span class="font-bold text-emerald-400">±${accuracy.toFixed(1)} m</span></div>
          <div><span class="text-slate-400 text-[10px] block">ALTITUDE:</span><span class="font-bold text-amber-300">${phoneGps.altitude !== null ? `${phoneGps.altitude.toFixed(1)} m` : 'N/A'}</span></div>
          <div class="col-span-2"><span class="text-slate-400 text-[10px] block">HEADING:</span><span class="font-bold text-sky-300">${heading !== null ? `${Math.round(heading)}°` : 'N/A'}</span></div>
        </div>
        <div class="text-[9px] text-slate-400 border-t border-slate-800 pt-1 mt-1 flex justify-between">
          <span>Ground Station Reference</span>
          <span>${phoneGps.lastUpdateTime || ''}</span>
        </div>
      </div>
    `;

    // Smooth update without reloading map (Requirement 2.6)
    if (phoneMarkerRef.current) {
      phoneMarkerRef.current.setLatLng([lat, lng]);
      phoneMarkerRef.current.setIcon(phoneIcon);
      phoneMarkerRef.current.setPopupContent(popupContent);
    } else {
      const marker = L.marker([lat, lng], {
        icon: phoneIcon,
        zIndexOffset: 850,
      });
      marker.bindPopup(popupContent, { className: 'tactical-popup' });
      marker.on('click', () => {
        setShowPhoneGpsInfoPanel(true);
      });
      marker.addTo(map);
      phoneMarkerRef.current = marker;
    }

    // Smooth accuracy circle update
    if (phoneAccuracyCircleRef.current) {
      phoneAccuracyCircleRef.current.setLatLng([lat, lng]);
      phoneAccuracyCircleRef.current.setRadius(accuracy);
    } else {
      const circle = L.circle([lat, lng], {
        radius: accuracy,
        color: '#06b6d4',
        fillColor: '#06b6d4',
        fillOpacity: 0.12,
        weight: 1.5,
        dashArray: '4, 4',
      }).addTo(map);
      phoneAccuracyCircleRef.current = circle;
    }
  }, [phoneGps, hasValidFcGps, telemetry.latitude, telemetry.longitude]);

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
    marker.on('dragend', (e: any) => {
      const target = e.target as L.Marker;
      const pos = target.getLatLng();
      onSetHomePoint({ lat: pos.lat, lng: pos.lng });
      audioService.playBeep(880, 80);
    });

    marker.addTo(homeLayerRef.current);
    homeMarkerRef.current = marker;
  }, [homePoint, telemetry.isArmed, missionState]);

  // -------------------------------------------------------------
  // Detected Target / Box Location Marker
  // -------------------------------------------------------------
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    targetLayerRef.current.clearLayers();

    if (!targetLocation || !targetLocation.lat || !targetLocation.lng) return;

    const targetHtml = `
      <div style="position: relative; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center;">
        <div style="position: absolute; width: 40px; height: 40px; border-radius: 8px; border: 2px solid #ef4444; background: rgba(239, 68, 68, 0.25); animation: ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
        <div style="width: 26px; height: 26px; border-radius: 6px; background: #ef4444; border: 2px solid #ffffff; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 14px rgba(239, 68, 68, 0.9);">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <rect width="18" height="18" x="3" y="3" rx="2"/>
            <path d="M9 12h6"/>
            <path d="M12 9v6"/>
          </svg>
        </div>
      </div>
    `;

    const targetIcon = L.divIcon({
      html: targetHtml,
      className: 'target-detected-pin',
      iconSize: [44, 44],
      iconAnchor: [22, 22]
    });

    const marker = L.marker([targetLocation.lat, targetLocation.lng], {
      icon: targetIcon,
      zIndexOffset: 950
    });

    const popupContent = `
      <div class="space-y-1.5 font-mono">
        <div class="font-black text-rose-400 flex items-center space-x-1">
          <span>📦 TARGET BOX DETECTED</span>
        </div>
        <div class="text-[10px] text-slate-300">Lat: ${targetLocation.lat.toFixed(6)}</div>
        <div class="text-[10px] text-slate-300">Lon: ${targetLocation.lng.toFixed(6)}</div>
        ${targetLabel ? `<div class="text-[10px] text-emerald-400 font-bold mt-1">${targetLabel}</div>` : ''}
        <button id="btn-popup-go-target" style="width:100%;margin-top:6px;padding:6px;background:#e11d48;color:#fff;border:none;border-radius:6px;font-weight:800;font-size:11px;cursor:pointer;">
          🎯 GO TO TARGET
        </button>
      </div>
    `;

    marker.bindPopup(popupContent, { className: 'tactical-popup' });
    marker.on('popupopen', () => {
      const btn = document.getElementById('btn-popup-go-target');
      if (btn) {
        btn.onclick = () => {
          customRouteService.goToTarget({ lat: targetLocation.lat, lng: targetLocation.lng });
          marker.closePopup();
        };
      }
    });

    marker.addTo(targetLayerRef.current);
  }, [targetLocation, targetLabel]);

  // -------------------------------------------------------------
  // Map Click & Drawing Handling
  // -------------------------------------------------------------
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const handleMapClick = (e: L.LeafletMouseEvent) => {
      const clickedLat = e.latlng.lat;
      const clickedLng = e.latlng.lng;

      // 1. Custom Route Outbound Drawing (Requirements 2, 3)
      if (isDrawingCustomRoute) {
        const existing = customRouteService.getOutboundPoints();
        let updated: LatLngPoint[];
        if (existing.length === 0) {
          // Requirement 3: WP0 is automatically Home
          if (homePoint.isSet && homePoint.latitude !== 0) {
            updated = [
              { lat: homePoint.latitude, lng: homePoint.longitude },
              { lat: clickedLat, lng: clickedLng }
            ];
          } else {
            updated = [{ lat: clickedLat, lng: clickedLng }];
          }
        } else {
          updated = [...existing, { lat: clickedLat, lng: clickedLng }];
        }
        customRouteService.setOutboundPoints(updated);
        audioService.playBeep(720, 60);
        return;
      }

      // 2. Custom Return Route Drawing (Requirement 11)
      if (isDrawingCustomReturn) {
        const existingRet = customRouteService.getReturnPoints();
        const updatedRet = [...existingRet, { lat: clickedLat, lng: clickedLng }];
        customRouteService.setReturnPoints(updatedRet);
        audioService.playBeep(720, 60);
        return;
      }

      // 3. Set Home Point Tool
      if (activeTool === 'set_home') {
        onSetHomePoint({ lat: clickedLat, lng: clickedLng });
        setActiveTool('select');
        audioService.playBeep(880, 100);
        return;
      }

      // 4. Legacy Pattern Drawing (Grid / Polygon / Circle)
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
  }, [
    activeTool,
    drawnPoints,
    circleCenter,
    onSetHomePoint,
    isDrawingCustomRoute,
    isDrawingCustomReturn,
    homePoint
  ]);

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
      wpMarker.on('dragend', (e: any) => {
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
  // Render Custom Drawn Route on Map (Requirements 1, 3, 4, 9, 10, 11, 14, 15)
  // -------------------------------------------------------------
  useEffect(() => {
    const layer = customRouteLayerRef.current;
    layer.clearLayers();

    if (!customMission || !customMission.waypoints || customMission.waypoints.length === 0) {
      return;
    }

    const outbound = customMission.outboundWaypoints || [];
    const returnWps = customMission.returnWaypoints || [];
    const activeIdx = liveProgress.currentWaypointIndex;
    const completedSet = new Set(liveProgress.completedWaypoints || []);

    // 1. Render Outbound Path (Solid Sky Blue)
    if (outbound.length >= 2) {
      const latlngs = outbound.map((w) => [w.lat, w.lng] as [number, number]);
      const outboundPolyline = L.polyline(latlngs, {
        color: '#0284c7',
        weight: 3.5,
        opacity: 0.9,
      });
      outboundPolyline.bindTooltip('Planned Custom Outbound Route', { sticky: true });
      outboundPolyline.addTo(layer);
    }

    // 2. Render Outbound Waypoint Markers
    outbound.forEach((wp, idx) => {
      const isHome = idx === 0 && (wp.name?.includes('HOME') || wp.action === 'TAKEOFF');
      const isTarget = idx === outbound.length - 1 && outbound.length > 1;
      const isActive = liveProgress.isExecuting && wp.index === activeIdx;
      const isCompleted = completedSet.has(wp.index);

      let pinColor = '#0284c7';
      if (isHome) pinColor = '#10b981';
      else if (isTarget) pinColor = '#ef4444';
      if (isCompleted) pinColor = '#059669';

      const pinHtml = `
        <div style="position: relative; display: flex; align-items: center; justify-content: center;">
          ${isActive ? `
            <div style="position: absolute; width: 38px; height: 38px; border-radius: 50%; border: 2.5px solid #38bdf8; background: rgba(56, 189, 248, 0.25); animation: ping 1.2s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
          ` : ''}
          <div style="background: ${pinColor}; color: #ffffff; width: ${isHome || isTarget ? '28px' : '24px'}; height: ${isHome || isTarget ? '28px' : '24px'}; border-radius: 50%; border: 2px solid #ffffff; font-weight: 800; font-size: 10px; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 8px rgba(0,0,0,0.7); cursor: pointer;">
            ${isCompleted ? '✓' : isHome ? 'H' : isTarget ? '🎯' : wp.index}
          </div>
        </div>
      `;

      const icon = L.divIcon({
        html: pinHtml,
        className: 'custom-wp-pin',
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });

      const marker = L.marker([wp.lat, wp.lng], { icon });
      marker.bindPopup(`
        <div class="space-y-1 font-mono">
          <div class="font-black text-sky-400 flex items-center justify-between">
            <span>${wp.name || `WP${wp.index}`}</span>
            <span class="text-[9px] px-1 bg-slate-800 text-slate-300 rounded">${wp.action || 'NAV'}</span>
          </div>
          <div class="text-[10px] text-slate-300">Lat: ${wp.lat.toFixed(6)} | Lng: ${wp.lng.toFixed(6)}</div>
          <div class="text-[10px] text-slate-300">Altitude: ${wp.altitude}m | Speed: ${wp.speed}m/s</div>
          ${wp.distanceFromPreviousMeters ? `<div class="text-[9px] text-slate-400">Leg Dist: ${wp.distanceFromPreviousMeters}m</div>` : ''}
          ${isCompleted ? '<div class="text-[10px] text-emerald-400 font-bold">STATUS: COMPLETED ✓</div>' : ''}
          ${isActive ? '<div class="text-[10px] text-sky-300 font-bold animate-pulse">STATUS: ACTIVE WAYPOINT ➔</div>' : ''}
        </div>
      `, { className: 'tactical-popup' });

      marker.addTo(layer);
    });

    // 3. Render Return Route (Requirements 9, 10, 11)
    if (returnWps.length > 0) {
      if (customMission.returnBehavior === 'SAME_PATH_BACK' || customMission.returnBehavior === 'CUSTOM_RETURN_PATH') {
        const lastOutbound = outbound[outbound.length - 1];
        const returnCoords: [number, number][] = [];
        if (lastOutbound) returnCoords.push([lastOutbound.lat, lastOutbound.lng]);
        returnWps.forEach((w) => returnCoords.push([w.lat, w.lng]));

        const returnColor = customMission.returnBehavior === 'SAME_PATH_BACK' ? '#f59e0b' : '#ec4899';
        const returnLine = L.polyline(returnCoords, {
          color: returnColor,
          weight: 3,
          dashArray: '6, 6',
          opacity: 0.85,
        });
        returnLine.bindTooltip(`Return Route (${customMission.returnBehavior === 'SAME_PATH_BACK' ? 'Same Path Back' : 'Custom Return'})`, { sticky: true });
        returnLine.addTo(layer);

        // Return Waypoint pins
        returnWps.forEach((wp, idx) => {
          const isFinalHome = idx === returnWps.length - 1;
          const isActive = liveProgress.isExecuting && wp.index === activeIdx;
          const isCompleted = completedSet.has(wp.index);
          const pinColor = isFinalHome ? '#10b981' : returnColor;

          const rHtml = `
            <div style="position: relative; display: flex; align-items: center; justify-content: center;">
              ${isActive ? `
                <div style="position: absolute; width: 34px; height: 34px; border-radius: 50%; border: 2.5px solid ${returnColor}; background: rgba(245, 158, 11, 0.25); animation: ping 1.2s infinite;"></div>
              ` : ''}
              <div style="background: ${pinColor}; color: #ffffff; width: 22px; height: 22px; border-radius: 50%; border: 2px solid #ffffff; font-weight: 800; font-size: 9px; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 6px rgba(0,0,0,0.7); cursor: pointer;">
                ${isCompleted ? '✓' : isFinalHome ? 'H' : `R${idx + 1}`}
              </div>
            </div>
          `;

          const rIcon = L.divIcon({
            html: rHtml,
            className: 'return-wp-pin',
            iconSize: [22, 22],
            iconAnchor: [11, 11],
          });

          const rMarker = L.marker([wp.lat, wp.lng], { icon: rIcon });
          rMarker.bindPopup(`
            <div class="space-y-1 font-mono">
              <div class="font-black text-amber-400 flex items-center justify-between">
                <span>${wp.name || `Return WP${idx + 1}`}</span>
                <span class="text-[9px] px-1 bg-slate-800 text-slate-300 rounded">${wp.action || 'NAV'}</span>
              </div>
              <div class="text-[10px] text-slate-300">Lat: ${wp.lat.toFixed(6)} | Lng: ${wp.lng.toFixed(6)}</div>
              <div class="text-[10px] text-slate-300">Altitude: ${wp.altitude}m | Speed: ${wp.speed}m/s</div>
            </div>
          `, { className: 'tactical-popup' });

          rMarker.addTo(layer);
        });
      } else if (customMission.returnBehavior === 'DIRECT_RTL' || !customMission.returnBehavior) {
        // Direct RTL line from last outbound to home
        const lastOutbound = outbound[outbound.length - 1];
        if (lastOutbound && homePoint.isSet && homePoint.latitude !== 0) {
          const rtlLine = L.polyline(
            [
              [lastOutbound.lat, lastOutbound.lng],
              [homePoint.latitude, homePoint.longitude],
            ],
            {
              color: '#ef4444',
              weight: 2.5,
              dashArray: '6, 6',
              opacity: 0.8,
            }
          );
          rtlLine.bindTooltip('Return: DIRECT RTL Straight to Home', { sticky: true });
          rtlLine.addTo(layer);
        }
      }
    }
  }, [customMission, liveProgress, homePoint]);

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

  const handleRecenterPhone = () => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (phoneGps.status === 'CONNECTED' && phoneGps.latitude !== null && phoneGps.longitude !== null) {
      map.flyTo([phoneGps.latitude, phoneGps.longitude], Math.max(18, map.getZoom()), { duration: 1.0 });
      audioService.playBeep(880, 60);
      setShowPhoneGpsInfoPanel(true);
    } else if (phoneGps.status === 'WAITING_FOR_LOCATION') {
      setErrorMessage('Phone GPS: Waiting for location fix...');
    } else if (phoneGps.status === 'PERMISSION_DENIED') {
      setErrorMessage('Phone GPS: Location permission was denied in browser settings.');
    } else {
      phoneGpsService.startWatching();
      setErrorMessage('Phone GPS: Starting location watch...');
    }
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
    <div className={`relative flex flex-col w-full h-[540px] sm:h-[620px] lg:h-[700px] bg-sae-dark rounded-2xl border border-slate-800 shadow-2xl overflow-hidden isolate select-none font-mono ${className}`}>

      {/* ============================================================ */}
      {/* 1. TOP GROUND CONTROL STATUS BAR                             */}
      {/* ============================================================ */}
      <div className="z-20 flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-slate-900/98 border-b border-slate-800 text-xs text-slate-300 shrink-0">
        
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

          <button
            type="button"
            onClick={handleRecenterPhone}
            className={`px-2.5 py-1 rounded text-[11px] font-black uppercase flex items-center space-x-1.5 transition cursor-pointer border ${
              phoneGps.status === 'CONNECTED'
                ? 'bg-cyan-950/80 hover:bg-cyan-900 border-cyan-500/60 text-cyan-300 hover:text-white shadow-sm shadow-cyan-600/20'
                : 'bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-400'
            }`}
            title="Center map on Phone GPS position (Operator Reference)"
          >
            <Smartphone className="w-3.5 h-3.5 text-cyan-400" />
            <span className="hidden sm:inline">CENTER ON PHONE</span>
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
      {/* 2. DEDICATED SEARCH / MISSION PLANNER TOOLBAR (Requirement 4) */}
      {/* ============================================================ */}
      <div className="z-20 flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-slate-900/90 border-b border-slate-800/80 backdrop-blur-md text-xs shrink-0">
        
        {/* Left: Search Bar & Map Layer Switcher */}
        <div className="flex items-center flex-wrap gap-2">
          {/* Location Search Bar */}
          <div className="relative w-48 sm:w-64">
            <div className="relative flex items-center bg-slate-950/80 rounded-lg border border-slate-700 shadow-sm overflow-hidden">
              <Search className="w-3.5 h-3.5 ml-2.5 text-slate-400 shrink-0" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearchPlaces()}
                placeholder="Search location/coords..."
                className="w-full bg-transparent px-2 py-1.5 text-xs text-white placeholder-slate-400 focus:outline-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="p-1 text-slate-400 hover:text-white"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
              <button
                type="button"
                onClick={handleSearchPlaces}
                disabled={isSearching}
                className="px-2 py-1.5 bg-sky-600 hover:bg-sky-500 text-white font-bold text-[10px] uppercase transition cursor-pointer"
              >
                {isSearching ? '...' : 'GO'}
              </button>
            </div>

            {/* Search Dropdown Results */}
            {searchResults.length > 0 && (
              <div className="absolute top-10 left-0 w-72 sm:w-80 bg-slate-900/98 backdrop-blur-md border border-slate-700 rounded-xl shadow-2xl overflow-hidden mt-1 max-h-56 overflow-y-auto z-[600]">
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

          {/* Map Layer Switcher (Street / Sat / Topo / Dark) */}
          <div className="flex items-center bg-slate-950/80 p-0.5 rounded-lg border border-slate-800 space-x-0.5">
            {[
              { id: 'satellite', label: 'SAT' },
              { id: 'street', label: 'STR' },
              { id: 'topo', label: 'TOPO' },
              { id: 'dark', label: 'DARK' },
            ].map((layer) => (
              <button
                key={layer.id}
                type="button"
                onClick={() => switchMapLayer(layer.id as MapLayerType)}
                className={`px-2 py-1 rounded text-[10px] font-extrabold uppercase transition cursor-pointer ${
                  currentLayerType === layer.id
                    ? 'bg-sky-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                {layer.label}
              </button>
            ))}
          </div>
        </div>

        {/* Right: Mission Planner Route Controls (Requirements 2, 8, 22) */}
        <div className="flex items-center flex-wrap gap-1.5">
          {!telemetry.isArmed && missionState === 'IDLE' ? (
            <>
              {/* 1. DRAW ROUTE (Requirement 2) */}
              <button
                type="button"
                onClick={() => {
                  if (isDrawingCustomRoute) {
                    setIsDrawingCustomRoute(false);
                  } else {
                    setIsDrawingCustomRoute(true);
                    setIsDrawingCustomReturn(false);
                    // Requirement 3: Auto seed WP0 from Pixhawk Home
                    if (customRouteService.getOutboundPoints().length === 0 && homePoint.isSet && homePoint.latitude !== 0) {
                      customRouteService.setOutboundPoints([{ lat: homePoint.latitude, lng: homePoint.longitude }]);
                    }
                  }
                  audioService.playBeep(700, 60);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-black uppercase flex items-center space-x-1.5 transition cursor-pointer min-h-[36px] ${
                  isDrawingCustomRoute
                    ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-md shadow-amber-500/40 animate-pulse'
                    : 'bg-sky-600 hover:bg-sky-500 text-white shadow-md shadow-sky-600/30'
                }`}
                title="Draw Custom Flight Route on Google Maps starting from Home"
              >
                <Pencil className="w-3.5 h-3.5" />
                <span>{isDrawingCustomRoute ? 'DONE DRAWING' : 'DRAW ROUTE'}</span>
              </button>

              {/* 2. DRAW RETURN ROUTE (Requirement 11) */}
              {customRouteService.getReturnBehavior() === 'CUSTOM_RETURN_PATH' && (
                <button
                  type="button"
                  onClick={() => {
                    setIsDrawingCustomReturn(!isDrawingCustomReturn);
                    setIsDrawingCustomRoute(false);
                    audioService.playBeep(700, 60);
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-black uppercase flex items-center space-x-1.5 transition cursor-pointer min-h-[36px] ${
                    isDrawingCustomReturn
                      ? 'bg-purple-500 hover:bg-purple-400 text-white shadow-md animate-pulse'
                      : 'bg-purple-900/80 hover:bg-purple-800 text-purple-200 border border-purple-500/40'
                  }`}
                  title="Draw Custom Return Route from Target to Home"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>{isDrawingCustomReturn ? 'DONE RETURN ROUTE' : 'DRAW RETURN ROUTE'}</span>
                </button>
              )}

              {/* Route Action Buttons when custom mission exists (Requirement 8, 22) */}
              {customMission && customMission.waypoints && customMission.waypoints.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      customRouteService.reverseRoute();
                      audioService.playBeep(650, 60);
                    }}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold uppercase flex items-center space-x-1 transition cursor-pointer min-h-[36px]"
                    title="Reverse Route"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span className="hidden sm:inline">REVERSE</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      customRouteService.clearRoute();
                      setIsDrawingCustomRoute(false);
                      setIsDrawingCustomReturn(false);
                      audioService.playBeep(450, 80);
                    }}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-rose-950 text-rose-300 border border-slate-700 hover:border-rose-500/50 text-xs font-bold uppercase flex items-center space-x-1 transition cursor-pointer min-h-[36px]"
                    title="Clear Route"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span className="hidden sm:inline">CLEAR</span>
                  </button>

                  <button
                    type="button"
                    onClick={async () => {
                      const res = await customRouteService.uploadMission();
                      setUploadFeedback(res);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-sky-950 hover:bg-sky-900 text-sky-200 border border-sky-500/50 text-xs font-black uppercase flex items-center space-x-1.5 transition cursor-pointer min-h-[36px]"
                    title="Upload Route to ESP32 / Pixhawk"
                  >
                    <Send className="w-3.5 h-3.5 text-sky-400" />
                    <span className="hidden sm:inline">SEND TO DRONE</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsArmingModalOpen(true)}
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black uppercase flex items-center space-x-1.5 transition cursor-pointer min-h-[36px] shadow-lg shadow-emerald-600/30 animate-pulse"
                    title="Start Mission"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>START MISSION</span>
                  </button>
                </>
              )}
            </>
          ) : (
            /* During Active Mission Controls (Requirement 22) */
            <div className="flex items-center space-x-2">
              <div className="flex items-center space-x-2 px-2.5 py-1.5 bg-emerald-950/70 border border-emerald-500/40 rounded-lg text-emerald-300 font-extrabold text-[11px] animate-pulse">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <span>MISSION IN PROGRESS</span>
              </div>

              <button
                type="button"
                onClick={() => {
                  if (onStopAbortMission) onStopAbortMission();
                  else missionEngine.abortMission('Operator pressed STOP / ABORT on Map');
                }}
                className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-slate-950 text-xs font-black uppercase flex items-center space-x-1.5 transition cursor-pointer min-h-[36px]"
                title="Stop / Abort Mission and Hover in Loiter"
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>STOP / ABORT</span>
              </button>

              <button
                type="button"
                onClick={onEmergencyRTL}
                className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-black uppercase flex items-center space-x-1.5 transition cursor-pointer min-h-[36px] shadow-lg shadow-rose-600/40"
                title="Immediate Return-to-Launch Failsafe"
              >
                <ShieldAlert className="w-3.5 h-3.5" />
                <span>RTL</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ============================================================ */}
      {/* 3. ACTIVE DRAWING GUIDANCE BANNER (when drawing)              */}
      {/* ============================================================ */}
      {isDrawingCustomRoute && (
        <div className="z-20 px-3 py-1.5 bg-amber-950/95 border-b border-amber-500/60 text-amber-200 text-xs flex items-center justify-between shrink-0 font-mono shadow-md animate-in fade-in">
          <div className="flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
            <span className="font-bold">CLICK ON MAP TO ADD WAYPOINTS (Connecting from WP0 Home)</span>
          </div>
          <button
            type="button"
            onClick={() => setIsDrawingCustomRoute(false)}
            className="px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-[11px] uppercase cursor-pointer"
          >
            DONE DRAWING
          </button>
        </div>
      )}

      {isDrawingCustomReturn && (
        <div className="z-20 px-3 py-1.5 bg-purple-950/95 border-b border-purple-500/60 text-purple-200 text-xs flex items-center justify-between shrink-0 font-mono shadow-md animate-in fade-in">
          <div className="flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-purple-400 animate-ping" />
            <span className="font-bold">CLICK ON MAP TO DRAW CUSTOM RETURN ROUTE BACK TO HOME</span>
          </div>
          <button
            type="button"
            onClick={() => setIsDrawingCustomReturn(false)}
            className="px-2.5 py-1 rounded bg-purple-500 hover:bg-purple-400 text-white font-black text-[11px] uppercase cursor-pointer"
          >
            DONE RETURN ROUTE
          </button>
        </div>
      )}

      {/* ============================================================ */}
      {/* 4. MAIN MAP WORKSPACE CANVAS & IN-CANVAS CONTROLS             */}
      {/* ============================================================ */}
      <div className="relative flex-1 w-full h-full min-h-0 flex overflow-hidden">
        
        {/* LEAFLET GOOGLE MAP VIEW CONTAINER */}
        <div ref={mapContainerRef} className="w-full h-full z-0" />

        {/* ------------------------------------------------------------- */}
        {/* FLOATING DRAWING TOOLBAR (Left Side Palette)                  */}
        {/* ------------------------------------------------------------- */}
        <div className="absolute left-3 top-3 z-[400] flex flex-col bg-slate-900/90 backdrop-blur-md p-1.5 rounded-xl border border-slate-700 shadow-2xl space-y-1">
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

          {/* Phone GPS Location (Standard Geolocation API - distinct from drone) */}
          <button
            type="button"
            onClick={handleRecenterPhone}
            className={`p-2 rounded-lg text-xs font-bold flex items-center justify-center transition cursor-pointer ${
              phoneGps.status === 'CONNECTED'
                ? 'text-cyan-400 hover:bg-cyan-950/80 hover:text-cyan-200'
                : 'text-slate-400 hover:bg-slate-800 hover:text-white'
            }`}
            title="Locate Phone GPS (Operator Reference)"
          >
            <Smartphone className="w-4 h-4 text-cyan-400" />
          </button>
        </div>

        {/* ------------------------------------------------------------- */}
        {/* REQUIREMENT 3: FC GPS FIX STATUS FLOATING WARNING BANNER      */}
        {/* ------------------------------------------------------------- */}
        {!hasValidFcGps && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[450] bg-slate-900/95 border border-amber-500/80 text-amber-200 px-4 py-2 rounded-xl text-xs flex items-center space-x-2.5 shadow-2xl backdrop-blur-md font-mono animate-pulse">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
            <span className="font-bold tracking-wide">GPS unavailable — waiting for valid FC coordinates</span>
          </div>
        )}

        {/* ------------------------------------------------------------- */}
        {/* ERROR / FEEDBACK FLOATING BANNER                              */}
        {/* ------------------------------------------------------------- */}
        {errorMessage && (
          <div className="absolute top-12 left-1/2 -translate-x-1/2 z-[500] max-w-md bg-rose-950/90 border border-rose-500 text-rose-200 px-3.5 py-2 rounded-xl text-xs flex items-center space-x-2 shadow-2xl backdrop-blur-md">
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
                <span className="text-slate-400">Outbound:</span>
                <span className="font-bold text-sky-300">
                  {customMission ? `${customMission.totalDistance} m` : `${generatedMission?.totalDistance || 0} m`}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Return:</span>
                <span className="font-bold text-emerald-400">
                  {customMission?.returnBehavior === 'SAME_PATH_BACK'
                    ? 'Same Path Back'
                    : customMission?.returnBehavior === 'CUSTOM_RETURN_PATH'
                    ? 'Custom Return Path'
                    : customMission?.returnBehavior === 'LAND_AT_HOME'
                    ? 'Land at Home'
                    : 'Direct RTL to Home'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Altitude:</span>
                <span className="font-bold text-amber-300">{customMission?.altitude || altitude} m</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Speed:</span>
                <span className="font-bold text-sky-300">{customMission?.speed || speed} m/s</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Estimated Mission:</span>
                <span className="font-bold text-white">
                  {Math.floor((customMission?.estimatedDuration || generatedMission?.estimatedDuration || 0) / 60)}:
                  {String((customMission?.estimatedDuration || generatedMission?.estimatedDuration || 0) % 60).padStart(2, '0')}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Maximum Allowed:</span>
                <span className="font-bold text-amber-400">
                  {Math.floor(missionEngine.getMissionDurationSeconds() / 60)}:00
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

      {/* Requirement 7: Dedicated Phone GPS Information Panel when Phone Marker is selected */}
      {showPhoneGpsInfoPanel && phoneGps.status === 'CONNECTED' && phoneGps.latitude !== null && phoneGps.longitude !== null && (
        <div className="absolute bottom-4 left-4 z-[480] bg-slate-950/95 border border-cyan-500/70 rounded-xl p-3 shadow-2xl backdrop-blur-md max-w-xs w-full text-xs font-mono space-y-2 animate-in fade-in slide-in-from-bottom-2 select-none">
          <div className="flex items-center justify-between border-b border-cyan-800/80 pb-1.5">
            <div className="flex items-center space-x-1.5 text-cyan-300 font-black">
              <Smartphone className="w-3.5 h-3.5 text-cyan-400" />
              <span>PHONE GPS (OPERATOR)</span>
            </div>
            <button
              type="button"
              onClick={() => setShowPhoneGpsInfoPanel(false)}
              className="text-slate-400 hover:text-white p-0.5 rounded cursor-pointer"
              title="Close panel"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-1 text-slate-200">
            <div className="flex justify-between">
              <span className="text-slate-400 text-[10px]">Latitude:</span>
              <span className="font-bold">{phoneGps.latitude.toFixed(6)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400 text-[10px]">Longitude:</span>
              <span className="font-bold">{phoneGps.longitude.toFixed(6)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400 text-[10px]">Accuracy:</span>
              <span className="font-bold text-emerald-400">±{phoneGps.accuracy ? phoneGps.accuracy.toFixed(1) : '--'} m</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400 text-[10px]">Altitude:</span>
              <span className="font-bold text-amber-300">
                {phoneGps.altitude !== null ? `${phoneGps.altitude.toFixed(1)} m MSL` : 'N/A'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400 text-[10px]">Heading:</span>
              <span className="font-bold text-sky-300">
                {phoneGps.heading !== null ? `${Math.round(phoneGps.heading)}°` : 'N/A'}
              </span>
            </div>
          </div>

          <div className="pt-1.5 border-t border-slate-800/80 flex items-center justify-between text-[10px]">
            <span className="text-cyan-400/90 font-bold">
              {phoneGps.useAsReference ? '✓ Reference Active' : 'Reference Inactive'}
            </span>
            <button
              type="button"
              onClick={handleRecenterPhone}
              className="text-cyan-300 hover:text-white flex items-center space-x-1 cursor-pointer font-bold"
            >
              <Crosshair className="w-3 h-3" />
              <span>Center</span>
            </button>
          </div>
        </div>
      )}

    </div>
  );
};

