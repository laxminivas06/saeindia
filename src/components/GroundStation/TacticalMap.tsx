import React, { useEffect, useRef, useState } from 'react';
import { DroneTelemetry, HomePoint, PathPoint } from '../../types/mission';
import { pathService } from '../../services/pathService';
import { Compass, Crosshair, MapPin, Maximize2, Shield, Radio, Route } from 'lucide-react';

interface TacticalMapProps {
  telemetry: DroneTelemetry;
  homePoint: HomePoint;
  className?: string;
  interactive?: boolean;
  onMapClick?: (latitude: number, longitude: number) => void;
}

export const TacticalMap: React.FC<TacticalMapProps> = ({
  telemetry,
  homePoint,
  className = '',
  interactive = false,
  onMapClick
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const breadcrumbsRef = useRef<Array<{ x: number; y: number }>>([]);
  const [pathPoints, setPathPoints] = useState<PathPoint[]>(pathService.getPath());
  const [isPathActive, setIsPathActive] = useState<boolean>(pathService.isPathActive());

  useEffect(() => {
    const unsub = pathService.subscribe((pts, active) => {
      setPathPoints(pts);
      setIsPathActive(active);
    });
    return () => {
      unsub();
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;

    const render = () => {
      const width = canvas.width;
      const height = canvas.height;
      const centerX = width / 2;
      const centerY = height / 2;

      // Dark tactical grid background
      ctx.fillStyle = '#0a0f1d';
      ctx.fillRect(0, 0, width, height);

      // Draw Grid Lines
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 1;
      const gridSize = 30;
      for (let x = 0; x < width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y < height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      // Draw Range Rings (25m, 50m, 75m, 100m)
      const rings = [45, 90, 135, 180];
      rings.forEach((r, idx) => {
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.15)';
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.arc(centerX, centerY, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = 'rgba(148, 163, 184, 0.5)';
        ctx.font = '9px JetBrains Mono, monospace';
        ctx.fillText(`${(idx + 1) * 25}m`, centerX + r + 3, centerY - 2);
      });

      // Draw Search Grid Box (Competition Autonomous Search Area)
      const searchBoxWidth = 140;
      const searchBoxHeight = 110;
      const searchBoxX = centerX - 30;
      const searchBoxY = centerY - 120;

      ctx.strokeStyle = 'rgba(234, 179, 8, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 3]);
      ctx.strokeRect(searchBoxX, searchBoxY, searchBoxWidth, searchBoxHeight);
      ctx.setLineDash([]);

      // Search Pattern Lawnmower Lines inside Search Area
      ctx.strokeStyle = 'rgba(234, 179, 8, 0.18)';
      ctx.lineWidth = 1;
      for (let i = 1; i <= 4; i++) {
        const lineY = searchBoxY + (searchBoxHeight / 5) * i;
        ctx.beginPath();
        ctx.moveTo(searchBoxX, lineY);
        ctx.lineTo(searchBoxX + searchBoxWidth, lineY);
        ctx.stroke();
      }

      ctx.fillStyle = 'rgba(234, 179, 8, 0.8)';
      ctx.font = '10px JetBrains Mono, monospace';
      ctx.fillText('TARGET SEARCH ZONE (100x80m)', searchBoxX + 4, searchBoxY - 5);

      // Home Point Coordinate (Mapped to Center)
      const homeX = centerX;
      const homeY = centerY + 40;
      const baseLat = homePoint.isSet ? homePoint.latitude : (telemetry.latitude || 17.385044);
      const baseLon = homePoint.isSet ? homePoint.longitude : (telemetry.longitude || 78.486671);

      // Helper to convert lat/lon to canvas x,y
      // Scale: 1 meter = 2.2 pixels
      const getCanvasCoords = (lat: number, lon: number) => {
        const latDiff = (lat - baseLat) * 111320;
        const lonDiff = (lon - baseLon) * 111320 * Math.cos(baseLat * Math.PI / 180);
        return {
          x: homeX + lonDiff * 2.2,
          y: homeY - latDiff * 2.2
        };
      };

      // Draw Home Point Marker
      if (homePoint.isSet) {
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(homeX, homeY, 9, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = '#0284c7';
        ctx.beginPath();
        ctx.arc(homeX, homeY, 5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#38bdf8';
        ctx.font = 'bold 10px JetBrains Mono, monospace';
        ctx.fillText('HOME POINT (LOCKED ✓)', homeX + 12, homeY + 4);
      }

      // Calculate relative Drone Position on Canvas
      const droneCoords = getCanvasCoords(telemetry.latitude, telemetry.longitude);
      const droneX = droneCoords.x;
      const droneY = droneCoords.y;

      // Record Breadcrumb
      if (telemetry.isArmed && (breadcrumbsRef.current.length === 0 || 
          Math.hypot(droneX - breadcrumbsRef.current[breadcrumbsRef.current.length - 1].x, 
                     droneY - breadcrumbsRef.current[breadcrumbsRef.current.length - 1].y) > 4)) {
        breadcrumbsRef.current.push({ x: droneX, y: droneY });
        if (breadcrumbsRef.current.length > 250) breadcrumbsRef.current.shift();
      }

      // Draw Flight Path Breadcrumbs
      if (breadcrumbsRef.current.length > 1) {
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.5)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(breadcrumbsRef.current[0].x, breadcrumbsRef.current[0].y);
        for (let i = 1; i < breadcrumbsRef.current.length; i++) {
          ctx.lineTo(breadcrumbsRef.current[i].x, breadcrumbsRef.current[i].y);
        }
        ctx.stroke();
      }

      // ==========================================
      // DRAW DEFINED GPS PATH / WAYPOINTS
      // ==========================================
      if (pathPoints.length > 0) {
        const pointCoords = pathPoints.map(p => ({
          ...p,
          ...getCanvasCoords(p.latitude, p.longitude)
        }));

        // 1. Draw Path Route Connecting Lines
        if (pointCoords.length > 1) {
          ctx.strokeStyle = 'rgba(245, 158, 11, 0.85)';
          ctx.lineWidth = 2.5;
          ctx.setLineDash([5, 3]);
          ctx.beginPath();
          ctx.moveTo(pointCoords[0].x, pointCoords[0].y);
          for (let i = 1; i < pointCoords.length; i++) {
            ctx.lineTo(pointCoords[i].x, pointCoords[i].y);
          }
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // 2. Draw Waypoint Circles & Labels
        pointCoords.forEach((p, idx) => {
          const isStart = idx === 0;
          const isEnd = idx === pointCoords.length - 1;

          // Outer Glow
          ctx.fillStyle = isStart ? 'rgba(16, 185, 129, 0.3)' : isEnd ? 'rgba(239, 68, 68, 0.3)' : 'rgba(245, 158, 11, 0.25)';
          ctx.beginPath();
          ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
          ctx.fill();

          // Main Marker
          ctx.fillStyle = isStart ? '#10b981' : isEnd ? '#ef4444' : '#f59e0b';
          ctx.beginPath();
          ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.5;
          ctx.stroke();

          // Point Number & Label
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 9px JetBrains Mono, monospace';
          ctx.fillText(`${p.pointNumber}`, p.x - 3, p.y + 3);

          ctx.fillStyle = isStart ? '#34d399' : isEnd ? '#f87171' : '#fbbf24';
          ctx.font = 'bold 9px JetBrains Mono, monospace';
          const label = isStart ? `START (PT 1)` : isEnd ? `END (PT ${p.pointNumber})` : `PT ${p.pointNumber}`;
          ctx.fillText(label, p.x + 10, p.y + 3);
        });
      }

      // Draw Runner Location (Approx 12m from Home Point)
      const runnerX = homeX + 35;
      const runnerY = homeY + 20;

      ctx.fillStyle = '#10b981';
      ctx.beginPath();
      ctx.arc(runnerX, runnerY, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#059669';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = '#34d399';
      ctx.font = '10px JetBrains Mono, monospace';
      ctx.fillText('RUNNER (12m)', runnerX + 8, runnerY + 3);

      // Draw Drone Icon & Heading Vector
      ctx.save();
      ctx.translate(droneX, droneY);
      ctx.rotate((telemetry.heading * Math.PI) / 180);

      // Heading projection line
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.7)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -35);
      ctx.stroke();
      ctx.setLineDash([]);

      // Quadcopter body
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(0, 0, 5, 0, Math.PI * 2);
      ctx.fill();

      // Arms
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-10, -10);
      ctx.lineTo(10, 10);
      ctx.moveTo(10, -10);
      ctx.lineTo(-10, 10);
      ctx.stroke();

      // Rotors
      ctx.fillStyle = telemetry.isArmed ? 'rgba(56, 189, 248, 0.8)' : 'rgba(148, 163, 184, 0.5)';
      [[-10, -10], [10, -10], [10, 10], [-10, 10]].forEach(([rx, ry]) => {
        ctx.beginPath();
        ctx.arc(rx, ry, 3.5, 0, Math.PI * 2);
        ctx.fill();
      });

      ctx.restore();

      // Drone HUD text
      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 10px JetBrains Mono, monospace';
      ctx.fillText(`DRONE (Alt: ${telemetry.altitude.toFixed(1)}m)`, droneX + 14, droneY - 6);

      animId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [telemetry, homePoint, pathPoints]);

  // Handle canvas click to add GPS waypoints
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!interactive || !onMapClick || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const clickX = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const clickY = ((e.clientY - rect.top) / rect.height) * canvas.height;

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const homeX = centerX;
    const homeY = centerY + 40;

    const baseLat = homePoint.isSet ? homePoint.latitude : (telemetry.latitude || 17.385044);
    const baseLon = homePoint.isSet ? homePoint.longitude : (telemetry.longitude || 78.486671);

    // Reverse conversion:
    // x = homeX + lonDiff * 2.2 => lonDiff = (x - homeX) / 2.2
    // y = homeY - latDiff * 2.2 => latDiff = (homeY - y) / 2.2
    const lonMeters = (clickX - homeX) / 2.2;
    const latMeters = (homeY - clickY) / 2.2;

    const deltaLat = latMeters / 111320;
    const deltaLon = lonMeters / (111320 * Math.cos(baseLat * Math.PI / 180));

    const clickedLat = baseLat + deltaLat;
    const clickedLon = baseLon + deltaLon;

    onMapClick(clickedLat, clickedLon);
  };

  return (
    <div className={`relative bg-slate-950 rounded-xl overflow-hidden border border-slate-800 hud-border ${className}`}>
      {/* Top Map Header HUD */}
      <div className="absolute top-2 left-2 right-2 flex items-center justify-between z-10 pointer-events-none">
        <div className="bg-slate-900/90 backdrop-blur-md px-2.5 py-1 rounded border border-slate-700 font-mono text-[11px] text-slate-300 flex items-center space-x-2">
          <Crosshair className="w-3.5 h-3.5 text-sky-400 animate-spin" style={{ animationDuration: '8s' }} />
          <span>TACTICAL MISSION MAP</span>
        </div>

        {/* Path Active Status Badge */}
        <div className="flex items-center space-x-1.5 font-mono text-[10px]">
          <span
            className={`px-2 py-0.5 rounded border font-bold flex items-center space-x-1 ${
              isPathActive
                ? 'bg-amber-950/80 border-amber-500/60 text-amber-300'
                : 'bg-slate-900/80 border-slate-700 text-slate-400'
            }`}
          >
            <Route className="w-3 h-3" />
            <span>{isPathActive ? 'PATH ACTIVE' : 'NO PATH'}</span>
          </span>
          <span className="hidden sm:inline bg-slate-900/90 backdrop-blur-md px-2 py-0.5 rounded border border-slate-700 text-slate-300">
            Scale: 1:200
          </span>
        </div>
      </div>

      <canvas
        ref={canvasRef}
        width={480}
        height={340}
        onClick={handleCanvasClick}
        className={`w-full h-full object-cover block ${interactive ? 'cursor-crosshair' : ''}`}
      />

      {/* Interactive Helper Overlay */}
      {interactive && (
        <div className="absolute top-10 left-2 pointer-events-none font-mono text-[10px] text-amber-300 bg-slate-900/90 px-2 py-0.5 rounded border border-amber-500/30">
          Click map to add GPS waypoints
        </div>
      )}

      {/* Bottom Map Info Footer */}
      <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between z-10 font-mono text-[10px] text-slate-400 bg-slate-900/80 backdrop-blur-md px-2.5 py-1 rounded border border-slate-800">
        <span>Lat: {telemetry.latitude.toFixed(6)}°</span>
        <span>Lon: {telemetry.longitude.toFixed(6)}°</span>
        <span>Dist to Home: <strong className="text-sky-400">{telemetry.distanceToHome}m</strong></span>
      </div>
    </div>
  );
};
