import React, { useEffect, useState } from 'react';
import { PixhawkConnectionState } from '../../types/mavlink';
import { RunnerLinkState } from '../../types/runner';
import { DroneTelemetry } from '../../types/mission';
import { videoStreamService, VideoStreamStatus } from '../../services/videoStreamService';
import { 
  Wifi, 
  Cpu, 
  Radio, 
  Plane, 
  Video, 
  Smartphone, 
  CheckCircle2, 
  XCircle, 
  Clock,
  Layers
} from 'lucide-react';

interface ConnectionStatusDeckProps {
  pixhawkState: PixhawkConnectionState;
  runnerLink: RunnerLinkState;
  telemetry: DroneTelemetry;
  className?: string;
}

export const ConnectionStatusDeck: React.FC<ConnectionStatusDeckProps> = ({
  pixhawkState,
  runnerLink,
  telemetry,
  className = ''
}) => {
  const [videoStatus, setVideoStatus] = useState<VideoStreamStatus>(videoStreamService.getStatus());

  useEffect(() => {
    const unsub = videoStreamService.subscribeStatus((status) => {
      setVideoStatus(status);
    });
    return () => {
      unsub();
    };
  }, []);

  // Compute individual actual states
  const wifiConnected = 
    pixhawkState.wifiState === 'CONNECTED' || 
    (pixhawkState.isConnected && pixhawkState.connectionType === 'ESP32_WEBSOCKET') ||
    (typeof navigator !== 'undefined' && navigator.onLine);

  const esp32Connected = 
    pixhawkState.isConnected || 
    pixhawkState.isUsbConnected ||
    pixhawkState.phase === 'SERIAL_OPEN' ||
    pixhawkState.phase === 'MAVLINK_CONNECTED';

  const webSocketConnected = 
    pixhawkState.connectionType === 'ESP32_WEBSOCKET' 
      ? pixhawkState.isConnected 
      : (pixhawkState.phase === 'TELEMETRY_ACTIVE' || pixhawkState.isConnected);

  const mavlinkConnected = pixhawkState.isConnected;

  const droneAndroidConnected = 
    telemetry.pixhawkConnected || 
    telemetry.batteryVoltage > 0 || 
    pixhawkState.bytesReceived > 0;

  const runnerConnected = runnerLink.isConnected;

  const connectionItems = [
    {
      name: 'Wi-Fi',
      icon: Wifi,
      status: wifiConnected ? 'CONNECTED' : 'DISCONNECTED',
      isOk: wifiConnected,
      highlight: wifiConnected ? 'text-sky-400' : 'text-slate-500'
    },
    {
      name: 'ESP32',
      icon: Cpu,
      status: esp32Connected ? 'CONNECTED' : 'DISCONNECTED',
      isOk: esp32Connected,
      highlight: esp32Connected ? 'text-emerald-400' : 'text-slate-500'
    },
    {
      name: 'WebSocket',
      icon: Radio,
      status: webSocketConnected ? 'CONNECTED' : 'DISCONNECTED',
      isOk: webSocketConnected,
      highlight: webSocketConnected ? 'text-indigo-400' : 'text-slate-500'
    },
    {
      name: 'MAVLink',
      icon: Layers,
      status: mavlinkConnected ? 'CONNECTED' : 'DISCONNECTED',
      isOk: mavlinkConnected,
      highlight: mavlinkConnected ? 'text-emerald-400' : 'text-rose-400'
    },
    {
      name: 'Drone Android',
      icon: Plane,
      status: droneAndroidConnected ? 'CONNECTED' : 'WAITING',
      isOk: droneAndroidConnected,
      highlight: droneAndroidConnected ? 'text-amber-400' : 'text-slate-500'
    },
    {
      name: 'Video',
      icon: Video,
      status: videoStatus === 'LIVE' ? 'LIVE' : videoStatus === 'CONNECTING' ? 'CONNECTING' : 'DISCONNECTED',
      isOk: videoStatus === 'LIVE',
      highlight: videoStatus === 'LIVE' ? 'text-emerald-400' : videoStatus === 'CONNECTING' ? 'text-amber-400' : 'text-rose-400'
    },
    {
      name: 'Runner Android',
      icon: Smartphone,
      status: runnerConnected ? 'CONNECTED' : 'DISCONNECTED',
      isOk: runnerConnected,
      highlight: runnerConnected ? 'text-emerald-400' : 'text-slate-500'
    }
  ];

  return (
    <div className={`bg-slate-900/90 p-3 sm:p-4 rounded-xl border border-slate-800 font-mono text-xs ${className}`}>
      <div className="flex items-center justify-between mb-2.5 pb-1.5 border-b border-slate-800">
        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
          SYSTEM CONNECTION STATUS
        </span>
        <span className="text-[10px] text-slate-500">
          7 Independent Subsystems
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-2">
        {connectionItems.map((item) => {
          const Icon = item.icon;
          return (
            <div
              key={item.name}
              className={`p-2 rounded-lg border flex flex-col justify-between transition-colors ${
                item.isOk
                  ? 'bg-slate-950/60 border-slate-800'
                  : 'bg-slate-950/40 border-slate-800/80'
              }`}
            >
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span className="truncate">{item.name}</span>
                <Icon className={`w-3 h-3 ${item.highlight}`} />
              </div>

              <div className="mt-1 flex items-center space-x-1">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    item.isOk ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'
                  }`}
                />
                <span
                  className={`font-black text-[10px] tracking-tight uppercase ${
                    item.isOk ? 'text-emerald-400' : 'text-slate-500'
                  }`}
                >
                  {item.status}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
