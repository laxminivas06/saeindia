import React, { useState } from 'react';
import { 
  X, 
  Wifi, 
  Radio, 
  Smartphone, 
  Cloud, 
  CheckCircle2, 
  AlertCircle, 
  RefreshCw,
  Info,
  Shield,
  Layers
} from 'lucide-react';
import { PixhawkConnectionState } from '../../types/mavlink';
import { PixhawkConnectionCard } from './PixhawkConnectionCard';
import { phoneGpsService, PhoneGpsState } from '../../services/phoneGpsService';
import { mavlinkService } from '../../services/mavlinkService';

interface HardwareConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  pixhawkState: PixhawkConnectionState;
  initialTab?: 'RELAY' | 'WIFI' | 'USB' | 'PHONE_GPS';
}

export const HardwareConnectionModal: React.FC<HardwareConnectionModalProps> = ({
  isOpen,
  onClose,
  pixhawkState,
  initialTab = 'RELAY'
}) => {
  const [activeTab, setActiveTab] = useState<'CARD' | 'PHONE_GPS' | 'HOTSPOT'>('CARD');
  const [phoneGps, setPhoneGps] = useState<PhoneGpsState>(() => phoneGpsService.getState());
  const [isRequestingGps, setIsRequestingGps] = useState(false);

  React.useEffect(() => {
    if (!isOpen) return;
    const unsub = phoneGpsService.subscribe(setPhoneGps);
    return () => unsub();
  }, [isOpen]);

  if (!isOpen) return null;

  const isConnected = pixhawkState.isConnected || pixhawkState.isUsbConnected;
  const isEsp32Connected = pixhawkState.isUsbConnected || (pixhawkState.connectionType === 'ESP32_WEBSOCKET' && pixhawkState.isConnected);

  const handleToggleGps = () => {
    setIsRequestingGps(true);
    if (phoneGps.status === 'CONNECTED' || phoneGps.status === 'WAITING_FOR_LOCATION') {
      phoneGpsService.stopWatching();
    } else {
      phoneGpsService.startWatching();
    }
    setTimeout(() => setIsRequestingGps(false), 500);
  };

  const handleCenterGps = () => {
    phoneGpsService.centerMapOnPhone();
  };

  return (
    <div 
      className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 overflow-y-auto animate-fadeIn"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-slate-900 border-2 border-sky-500/80 rounded-2xl max-w-4xl w-full max-h-[92vh] flex flex-col shadow-2xl shadow-black/80 font-mono text-slate-100 overflow-hidden my-auto">
        
        {/* Modal Header */}
        <div className="px-4 py-3 sm:px-6 sm:py-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-sky-500/20 border border-sky-500/40 text-sky-400">
              <Wifi className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-sm sm:text-base font-black text-white uppercase tracking-wider">
                  Hardware &amp; Wireless Link Manager
                </h2>
                <span className="hidden sm:inline-block text-[10px] px-2 py-0.5 rounded-full font-bold bg-sky-950 border border-sky-500/40 text-sky-300">
                  ESP32 • Pixhawk • Phone GPS
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Connect your Ground Station to the ESP32 wireless bridge and Pixhawk MAVLink flight controller.
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={onClose}
              className="p-1.5 sm:p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition cursor-pointer border border-slate-700"
              title="Close Dialog"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Real-Time Status Ticker Bar */}
        <div className="bg-slate-950/90 border-b border-slate-800/80 px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-xs shrink-0">
          <div className="flex items-center space-x-2 sm:space-x-4">
            {/* ESP32 Status */}
            <div className="flex items-center space-x-1.5">
              <span className="text-[10px] text-slate-400 uppercase font-bold">ESP32:</span>
              <span className={`inline-flex items-center space-x-1 font-bold text-[11px] px-1.5 py-0.5 rounded ${
                isEsp32Connected ? 'bg-emerald-950 text-emerald-400 border border-emerald-500/30' : 'bg-rose-950/60 text-rose-400 border border-rose-500/30'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${isEsp32Connected ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`} />
                <span>{isEsp32Connected ? 'ONLINE' : 'OFFLINE'}</span>
              </span>
            </div>

            {/* Pixhawk MAVLink Status */}
            <div className="flex items-center space-x-1.5">
              <span className="text-[10px] text-slate-400 uppercase font-bold">Pixhawk MAVLink:</span>
              <span className={`inline-flex items-center space-x-1 font-bold text-[11px] px-1.5 py-0.5 rounded ${
                pixhawkState.isConnected ? 'bg-emerald-950 text-emerald-400 border border-emerald-500/30' : 'bg-amber-950/60 text-amber-400 border border-amber-500/30'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${pixhawkState.isConnected ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                <span>{pixhawkState.isConnected ? 'LOCKED ✓' : 'STANDBY'}</span>
              </span>
            </div>

            {/* Phone GPS Status */}
            <div className="flex items-center space-x-1.5">
              <span className="text-[10px] text-slate-400 uppercase font-bold">Phone GPS:</span>
              <span className={`inline-flex items-center space-x-1 font-bold text-[11px] px-1.5 py-0.5 rounded ${
                phoneGps.status === 'CONNECTED' ? 'bg-cyan-950 text-cyan-400 border border-cyan-500/30' : 'bg-slate-800 text-slate-400'
              }`}>
                <span>{phoneGps.status === 'CONNECTED' ? 'LOCKED' : phoneGps.status}</span>
              </span>
            </div>
          </div>

          {/* Quick Sub-navigation */}
          <div className="flex items-center space-x-1">
            <button
              onClick={() => setActiveTab('CARD')}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                activeTab === 'CARD' 
                  ? 'bg-sky-600 text-white shadow-sm' 
                  : 'bg-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              Flight Controller &amp; ESP32 Link
            </button>
            <button
              onClick={() => setActiveTab('HOTSPOT')}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                activeTab === 'HOTSPOT' 
                  ? 'bg-purple-600 text-white shadow-sm' 
                  : 'bg-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              Wi-Fi / Hotspot Info
            </button>
            <button
              onClick={() => setActiveTab('PHONE_GPS')}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                activeTab === 'PHONE_GPS' 
                  ? 'bg-cyan-600 text-white shadow-sm' 
                  : 'bg-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              Phone GPS
            </button>
          </div>
        </div>

        {/* Modal Body / Scrollable Content Area */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-5 space-y-4">
          
          {activeTab === 'HOTSPOT' && (
            <div className="space-y-4">
              <div className="bg-slate-950 p-4 rounded-xl border border-purple-500/30 space-y-3">
                <div className="flex items-center space-x-2 text-purple-400 font-bold text-sm">
                  <Wifi className="w-4 h-4" />
                  <span>ESP32 WI-FI HOTSPOT CREDENTIALS</span>
                </div>
                <p className="text-xs text-slate-300">
                  The ESP32 firmware is configured to connect to your phone's personal hotspot or field Wi-Fi. Turn on your Phone Hotspot with these exact credentials:
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                  <div className="bg-slate-900 p-3 rounded-lg border border-slate-800 space-y-1">
                    <span className="text-[10px] text-slate-400 uppercase font-bold">Hotspot SSID (Name)</span>
                    <div className="text-sm font-mono font-black text-white bg-slate-950 px-2 py-1 rounded border border-slate-800 select-all">
                      drone123
                    </div>
                  </div>

                  <div className="bg-slate-900 p-3 rounded-lg border border-slate-800 space-y-1">
                    <span className="text-[10px] text-slate-400 uppercase font-bold">Hotspot Password</span>
                    <div className="text-sm font-mono font-black text-emerald-400 bg-slate-950 px-2 py-1 rounded border border-slate-800 select-all">
                      drone@123
                    </div>
                  </div>
                </div>

                <div className="bg-sky-950/40 p-3 rounded-lg border border-sky-500/30 text-xs text-sky-200 space-y-1.5">
                  <div className="flex items-center space-x-1.5 font-bold text-sky-300">
                    <Cloud className="w-3.5 h-3.5" />
                    <span>Deployed Cloud Relay Link (Active)</span>
                  </div>
                  <div>
                    Once the ESP32 connects to your hotspot, it automatically reaches the Render Cloud Relay at <code className="bg-slate-900 px-1 py-0.5 rounded text-sky-300">wss://saeindia-szj0.onrender.com/connector</code> without requiring port forwarding.
                  </div>
                  <div>
                    Your web app on <code className="bg-slate-900 px-1 py-0.5 rounded text-sky-300">https://saeindiasphn.netlify.app/</code> connects directly via <code className="bg-slate-900 px-1 py-0.5 rounded text-sky-300">wss://saeindia-szj0.onrender.com/ws</code>.
                  </div>
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  onClick={() => setActiveTab('CARD')}
                  className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-xl text-xs font-bold transition flex items-center space-x-2"
                >
                  <span>Go to Connection Controls</span>
                  <span>→</span>
                </button>
              </div>
            </div>
          )}

          {activeTab === 'PHONE_GPS' && (
            <div className="bg-slate-950 p-4 rounded-xl border border-cyan-500/30 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2 text-cyan-400 font-bold text-sm">
                  <Smartphone className="w-4 h-4" />
                  <span>GROUND STATION PHONE GPS TRACKING</span>
                </div>
                <button
                  onClick={handleToggleGps}
                  disabled={isRequestingGps}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center space-x-1.5 ${
                    phoneGps.status === 'CONNECTED'
                      ? 'bg-rose-950/70 border border-rose-500/40 text-rose-300 hover:bg-rose-900'
                      : 'bg-cyan-600 hover:bg-cyan-500 text-white'
                  }`}
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isRequestingGps ? 'animate-spin' : ''}`} />
                  <span>{phoneGps.status === 'CONNECTED' ? 'Disable Phone GPS' : 'Enable / Re-acquire GPS'}</span>
                </button>
              </div>

              <p className="text-xs text-slate-300">
                Uses your device's native GPS/GNSS receiver to set the Ground Station home point, track your position relative to the drone, and anchor mission waypoints.
              </p>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div className="bg-slate-900 p-2.5 rounded-lg border border-slate-800">
                  <div className="text-[10px] text-slate-400 uppercase font-bold">Status</div>
                  <div className={`font-bold mt-0.5 ${phoneGps.status === 'CONNECTED' ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {phoneGps.status}
                  </div>
                </div>

                <div className="bg-slate-900 p-2.5 rounded-lg border border-slate-800">
                  <div className="text-[10px] text-slate-400 uppercase font-bold">Accuracy</div>
                  <div className="font-bold text-slate-200 mt-0.5">
                    {phoneGps.accuracy !== null ? `±${phoneGps.accuracy.toFixed(1)} m` : 'N/A'}
                  </div>
                </div>

                <div className="bg-slate-900 p-2.5 rounded-lg border border-slate-800">
                  <div className="text-[10px] text-slate-400 uppercase font-bold">Latitude</div>
                  <div className="font-mono text-cyan-300 font-bold mt-0.5 truncate">
                    {phoneGps.latitude !== null ? phoneGps.latitude.toFixed(6) : 'N/A'}
                  </div>
                </div>

                <div className="bg-slate-900 p-2.5 rounded-lg border border-slate-800">
                  <div className="text-[10px] text-slate-400 uppercase font-bold">Longitude</div>
                  <div className="font-mono text-cyan-300 font-bold mt-0.5 truncate">
                    {phoneGps.longitude !== null ? phoneGps.longitude.toFixed(6) : 'N/A'}
                  </div>
                </div>
              </div>

              {phoneGps.status === 'CONNECTED' && (
                <div className="pt-2 flex flex-wrap gap-2">
                  <button
                    onClick={handleCenterGps}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-500/40 rounded-lg text-xs font-bold transition flex items-center space-x-1.5"
                  >
                    <span>🎯 Center Map on My Location</span>
                  </button>
                  <button
                    onClick={async () => {
                      if (phoneGps.latitude && phoneGps.longitude) {
                        await mavlinkService.setHomePoint(phoneGps.latitude, phoneGps.longitude);
                      }
                    }}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-emerald-500/40 rounded-lg text-xs font-bold transition flex items-center space-x-1.5"
                  >
                    <span>🏠 Set Home Point to My Position</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {activeTab === 'CARD' && (
            <div className="w-full">
              <PixhawkConnectionCard
                connectionState={pixhawkState}
                className="w-full shadow-none border-0 p-0"
              />
            </div>
          )}

        </div>

        {/* Modal Footer with Quick Close */}
        <div className="px-4 py-2.5 bg-slate-950 border-t border-slate-800 flex items-center justify-between text-xs shrink-0">
          <div className="text-[11px] text-slate-400">
            Deployed Relay: <span className="text-sky-400 font-mono">wss://saeindia-szj0.onrender.com/ws</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-200 font-bold rounded-lg transition"
          >
            Done
          </button>
        </div>

      </div>
    </div>
  );
};
