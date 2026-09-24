import React, { useEffect, useRef, useState } from 'react';
import { videoStreamService, VideoStreamStatus } from '../../services/videoStreamService';
import { 
  Camera, 
  Video, 
  VideoOff, 
  RefreshCw, 
  Maximize2, 
  Minimize2, 
  Wifi, 
  WifiOff, 
  Settings, 
  Radio, 
  AlertTriangle,
  Play
} from 'lucide-react';

interface LiveVideoFeedProps {
  className?: string;
  large?: boolean;
}

export const LiveVideoFeed: React.FC<LiveVideoFeedProps> = ({
  className = '',
  large = true
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const [streamStatus, setStreamStatus] = useState<VideoStreamStatus>(videoStreamService.getStatus());
  const [frameUrl, setFrameUrl] = useState<string | null>(videoStreamService.getLatestFrame());
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [ipCameraUrl, setIpCameraUrl] = useState(videoStreamService.getIpCameraUrl());
  const [frameCount, setFrameCount] = useState<number>(0);
  const [fpsEstimate, setFpsEstimate] = useState<number>(0);

  const lastFrameTimeRef = useRef<number>(Date.now());
  const fpsCounterRef = useRef<number>(0);

  useEffect(() => {
    // 1. Subscribe to continuous frame updates
    const unsubStream = videoStreamService.subscribeStream((latestFrame, status, packet) => {
      setStreamStatus(status);
      setFrameUrl(latestFrame);

      if (latestFrame) {
        setFrameCount(c => c + 1);
        fpsCounterRef.current += 1;
      }

      // Check if direct local MediaStream is available
      const localStream = videoStreamService.getLocalMediaStream();
      if (localStream && videoRef.current && videoRef.current.srcObject !== localStream) {
        try {
          videoRef.current.srcObject = localStream;
          videoRef.current.play().catch(() => {});
        } catch (e) {}
      }
    });

    // 2. Subscribe to status changes
    const unsubStatus = videoStreamService.subscribeStatus((status) => {
      setStreamStatus(status);
      if (status === 'DISCONNECTED') {
        setFrameUrl(null);
      }
    });

    // 3. FPS calculation timer
    const fpsTimer = setInterval(() => {
      const now = Date.now();
      const elapsed = (now - lastFrameTimeRef.current) / 1000;
      if (elapsed > 0) {
        setFpsEstimate(Math.round(fpsCounterRef.current / elapsed));
      }
      fpsCounterRef.current = 0;
      lastFrameTimeRef.current = now;
    }, 1500);

    return () => {
      unsubStream();
      unsubStatus();
      clearInterval(fpsTimer);
    };
  }, []);

  const handleToggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  const handleSaveIpCameraUrl = (e: React.FormEvent) => {
    e.preventDefault();
    videoStreamService.setIpCameraUrl(ipCameraUrl);
    setShowConfig(false);
  };

  const localMediaStream = videoStreamService.getLocalMediaStream();
  const hasDirectVideo = !!localMediaStream && localMediaStream.active;

  return (
    <div
      ref={containerRef}
      className={`relative bg-slate-950 rounded-xl overflow-hidden border border-slate-800 hud-border flex flex-col justify-between ${className}`}
      style={{ minHeight: large ? '340px' : '240px' }}
    >
      {/* Top Video HUD Header */}
      <div className="absolute top-2 left-2 right-2 flex items-center justify-between z-20 pointer-events-auto">
        {/* Connection Status Badge */}
        <div className="flex items-center space-x-2">
          <div
            className={`px-2.5 py-1 rounded-md font-mono text-[11px] font-extrabold flex items-center space-x-1.5 backdrop-blur-md border shadow-md ${
              streamStatus === 'LIVE'
                ? 'bg-emerald-950/80 border-emerald-500/50 text-emerald-300'
                : streamStatus === 'CONNECTING'
                ? 'bg-amber-950/80 border-amber-500/50 text-amber-300 animate-pulse'
                : 'bg-rose-950/80 border-rose-500/50 text-rose-300'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                streamStatus === 'LIVE'
                  ? 'bg-emerald-400 animate-ping'
                  : streamStatus === 'CONNECTING'
                  ? 'bg-amber-400'
                  : 'bg-rose-500'
              }`}
              style={{ animationDuration: '2s' }}
            />
            <span>
              {streamStatus === 'LIVE'
                ? 'VIDEO: LIVE'
                : streamStatus === 'CONNECTING'
                ? 'VIDEO: CONNECTING'
                : 'VIDEO: DISCONNECTED'}
            </span>
          </div>

          {streamStatus === 'LIVE' && fpsEstimate > 0 && (
            <span className="hidden sm:inline-block bg-slate-900/80 backdrop-blur-md border border-slate-700/60 px-2 py-1 rounded text-[10px] font-mono text-slate-300">
              {fpsEstimate} FPS • Drone Cam
            </span>
          )}
        </div>

        {/* Quick Toolbar */}
        <div className="flex items-center space-x-1 font-mono text-xs">
          <button
            onClick={() => setShowConfig(!showConfig)}
            className="p-1.5 rounded bg-slate-900/80 hover:bg-slate-800 text-slate-300 border border-slate-700 transition"
            title="IP Camera / Video Stream Configuration"
          >
            <Settings className="w-3.5 h-3.5 text-slate-300" />
          </button>

          <button
            onClick={handleToggleFullscreen}
            className="p-1.5 rounded bg-slate-900/80 hover:bg-slate-800 text-slate-300 border border-slate-700 transition"
            title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen Video'}
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5 text-slate-300" /> : <Maximize2 className="w-3.5 h-3.5 text-slate-300" />}
          </button>
        </div>
      </div>

      {/* Main Video Screen Area */}
      <div className="relative w-full h-full flex-1 flex items-center justify-center bg-black overflow-hidden select-none">
        {/* Direct Local MediaStream Video (if on same device / tab) */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`w-full h-full object-cover ${hasDirectVideo && streamStatus === 'LIVE' ? 'block' : 'hidden'}`}
        />

        {/* Continuous Streamed Image Frame (when streaming from Drone Android via network/channel) */}
        {!hasDirectVideo && frameUrl && streamStatus === 'LIVE' && (
          <img
            ref={imgRef}
            src={frameUrl}
            alt="Drone Android Live Stream"
            className="w-full h-full object-cover block"
          />
        )}

        {/* External IP Camera stream (if URL provided and not using local stream) */}
        {!hasDirectVideo && !frameUrl && ipCameraUrl && streamStatus === 'LIVE' && (
          <img
            src={ipCameraUrl}
            alt="Drone Android IP Camera"
            className="w-full h-full object-cover block"
            onError={() => {
              // Gracefully handle IP camera failure without crash
            }}
          />
        )}

        {/* VIDEO CONNECTION LOST / DISCONNECTED OVERLAY (No frozen frame presented as live) */}
        {streamStatus !== 'LIVE' && (
          <div className="absolute inset-0 bg-slate-950/95 flex flex-col items-center justify-center p-4 text-center z-10 space-y-3 font-mono">
            <div className="w-14 h-14 rounded-full bg-slate-900 border border-rose-500/40 flex items-center justify-center text-rose-400 shadow-inner">
              <VideoOff className="w-7 h-7 animate-pulse" />
            </div>

            <div className="space-y-1 max-w-sm">
              <div className="text-sm sm:text-base font-black text-rose-400 uppercase tracking-wider">
                VIDEO CONNECTION LOST
              </div>
              <p className="text-xs text-slate-400">
                Awaiting continuous video feed from Drone Android camera.
              </p>
            </div>

            <div className="flex items-center space-x-2 text-[11px] text-slate-400 bg-slate-900/90 border border-slate-800 px-3 py-1.5 rounded-lg">
              <RefreshCw className="w-3.5 h-3.5 text-sky-400 animate-spin" />
              <span>Auto-reconnecting continuous IP stream...</span>
            </div>

            {/* Hint for Drone Android mode */}
            <div className="text-[10px] text-slate-400 max-w-xs leading-relaxed border-t border-slate-900 pt-2">
              Tip: Switch to <strong>DRONE ANDROID</strong> mode to activate camera streaming.
            </div>
          </div>
        )}

        {/* Stream Settings / IP Camera Configuration Drawer */}
        {showConfig && (
          <div className="absolute inset-x-2 top-12 z-30 bg-slate-900/95 border border-slate-700 rounded-xl p-3 sm:p-4 backdrop-blur-md shadow-2xl font-mono text-xs space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="font-bold text-slate-200 uppercase flex items-center space-x-1.5">
                <Settings className="w-3.5 h-3.5 text-sky-400" />
                <span>Web / IP Camera Configuration</span>
              </span>
              <button
                onClick={() => setShowConfig(false)}
                className="text-slate-400 hover:text-white px-2 py-0.5 rounded bg-slate-800"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveIpCameraUrl} className="space-y-2">
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  External Drone IP Camera URL (Optional):
                </label>
                <input
                  type="text"
                  value={ipCameraUrl}
                  onChange={(e) => setIpCameraUrl(e.target.value)}
                  placeholder="http://192.168.31.194:8080/stream"
                  className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-sky-500 font-mono text-xs"
                />
              </div>

              <div className="flex justify-between items-center pt-1">
                <span className="text-[10px] text-slate-400">
                  Default: Seamless Direct Drone Broadcast
                </span>
                <button
                  type="submit"
                  className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded font-bold uppercase text-[11px] transition"
                >
                  Save URL
                </button>
              </div>
            </form>
          </div>
        )}
      </div>

      {/* Bottom Video Telemetry Overlay */}
      <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between z-20 pointer-events-none font-mono text-[10px] text-slate-300 bg-slate-900/80 backdrop-blur-md px-2.5 py-1 rounded border border-slate-800/80">
        <div className="flex items-center space-x-2">
          <span className="text-slate-400">SOURCE:</span>
          <span className="font-bold text-slate-200">DRONE ANDROID CAMERA</span>
        </div>
        <div className="flex items-center space-x-3">
          <span>STREAM: <strong className="text-sky-400">CONTINUOUS IP</strong></span>
          <span className="hidden sm:inline text-slate-400">MAVLink: DECOUPLED ✓</span>
        </div>
      </div>
    </div>
  );
};
