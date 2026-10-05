import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Video, WifiOff, RefreshCw, Radio, Settings, X } from 'lucide-react';
import { ipCameraService, IpCameraStatus } from '../../services/ipCameraService';

interface LiveVideoFeedProps {
  className?: string;
  large?: boolean;
  onClose?: () => void;
}

export const LiveVideoFeed: React.FC<LiveVideoFeedProps> = ({
  className = '',
  large = false,
  onClose
}) => {
  const [streamUrl, setStreamUrl] = useState<string>(() => ipCameraService.getStreamUrl());
  const [editingUrl, setEditingUrl] = useState(false);
  const [editValue, setEditValue] = useState(streamUrl);
  const [videoState, setVideoState] = useState<IpCameraStatus>('CONNECTING');
  const [retryCount, setRetryCount] = useState(0);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const retryTimerRef = useRef<number | null>(null);

  const clearRetryTimer = () => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  };

  const scheduleRetry = useCallback(() => {
    clearRetryTimer();
    retryTimerRef.current = window.setTimeout(() => {
      setRetryCount((c) => c + 1);
      setVideoState('CONNECTING');
      ipCameraService.setStatus('CONNECTING');
    }, 3000);
  }, []);

  useEffect(() => {
    const unsubUrl = ipCameraService.subscribeUrl((url) => {
      setStreamUrl(url);
      setEditValue(url);
      setRetryCount(0);
      setVideoState('CONNECTING');
    });

    return () => {
      clearRetryTimer();
      unsubUrl();
    };
  }, []);

  // Force img reload on retry
  const imgSrc = streamUrl
    ? `${streamUrl}${streamUrl.includes('?') ? '&' : '?'}_t=${retryCount}`
    : '';

  const handleImgLoad = () => {
    setVideoState('LIVE');
    ipCameraService.setStatus('LIVE');
    clearRetryTimer();
  };

  const handleImgError = () => {
    setVideoState('DISCONNECTED');
    ipCameraService.setStatus('DISCONNECTED');
    scheduleRetry();
  };

  const handleManualRetry = () => {
    clearRetryTimer();
    setRetryCount((c) => c + 1);
    setVideoState('CONNECTING');
    ipCameraService.setStatus('CONNECTING');
  };

  const handleSaveUrl = () => {
    const trimmed = editValue.trim();
    if (trimmed) {
      ipCameraService.setStreamUrl(trimmed);
      setStreamUrl(trimmed);
      setRetryCount(0);
      setVideoState('CONNECTING');
      ipCameraService.setStatus('CONNECTING');
    }
    setEditingUrl(false);
  };

  const stateColor =
    videoState === 'LIVE'
      ? 'text-emerald-400 border-emerald-500/60 bg-emerald-950/80'
      : videoState === 'CONNECTING'
      ? 'text-amber-400 border-amber-500/60 bg-amber-950/80 animate-pulse'
      : 'text-rose-400 border-rose-500/60 bg-rose-950/80';

  const stateLabel =
    videoState === 'LIVE'
      ? 'CAMERA: LIVE'
      : videoState === 'CONNECTING'
      ? 'CAMERA: CONNECTING...'
      : 'CAMERA DISCONNECTED';

  return (
    <div
      className={`relative bg-slate-950 rounded-xl overflow-hidden border border-slate-800 flex flex-col font-mono select-none ${className}`}
    >
      {/* Header overlay */}
      <div className="absolute top-2 left-2 right-2 flex items-center justify-between z-20 pointer-events-none">
        <div
          className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-lg border text-[10px] sm:text-[11px] font-black backdrop-blur-md shadow-md ${stateColor}`}
        >
          {videoState === 'LIVE' ? (
            <Radio className="w-3 h-3 animate-pulse" />
          ) : videoState === 'CONNECTING' ? (
            <RefreshCw className="w-3 h-3 animate-spin" />
          ) : (
            <WifiOff className="w-3 h-3" />
          )}
          <span>{stateLabel}</span>
        </div>

        <div className="flex items-center space-x-1 pointer-events-auto">
          <button
            type="button"
            onClick={handleManualRetry}
            className="p-1.5 rounded-lg bg-slate-900/90 border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800 transition cursor-pointer shadow-sm"
            title="Reconnect video stream"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={() => {
              setEditValue(streamUrl);
              setEditingUrl(true);
            }}
            className="px-2 py-1 rounded-lg bg-slate-900/90 border border-slate-700 text-slate-300 hover:text-white text-[10px] font-bold transition cursor-pointer shadow-sm flex items-center space-x-1"
            title="Configure IP Camera Stream URL"
          >
            <Settings className="w-3 h-3" />
            <span className="hidden xs:inline">URL</span>
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded-lg bg-slate-900/90 border border-slate-700 text-slate-400 hover:text-white hover:bg-rose-950/80 transition cursor-pointer shadow-sm"
              title="Close Camera View"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* URL editor overlay */}
      {editingUrl && (
        <div className="absolute inset-0 z-30 bg-slate-950/95 backdrop-blur-sm flex flex-col items-center justify-center p-4 space-y-3">
          <div className="text-xs font-bold text-slate-200 uppercase tracking-wide">
            IP Camera Stream URL
          </div>
          <div className="text-[10px] text-slate-400 text-center">
            Enter IP camera stream URL (RTSP / HTTP / MJPEG):
            <br />
            <span className="text-sky-300 font-mono">http://192.168.31.194:8080/video</span>
          </div>
          <input
            autoFocus
            type="url"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveUrl();
              if (e.key === 'Escape') setEditingUrl(false);
            }}
            className="w-full max-w-sm px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 text-xs font-mono focus:outline-none focus:border-sky-500"
            placeholder="http://192.168.31.194:8080/video"
          />
          <div className="flex space-x-2">
            <button
              type="button"
              onClick={handleSaveUrl}
              className="px-4 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-black uppercase cursor-pointer"
            >
              SAVE & CONNECT
            </button>
            <button
              type="button"
              onClick={() => setEditingUrl(false)}
              className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-black uppercase cursor-pointer"
            >
              CANCEL
            </button>
          </div>
        </div>
      )}

      {/* Video frame */}
      <div className="relative flex-1 flex items-center justify-center min-h-[180px] bg-slate-950">
        {imgSrc && (
          <img
            ref={imgRef}
            src={imgSrc}
            alt="IP Camera Live Feed"
            onLoad={handleImgLoad}
            onError={handleImgError}
            className={`w-full h-full object-contain sm:object-cover transition-opacity duration-200 ${
              videoState === 'LIVE' ? 'opacity-100' : 'opacity-0'
            }`}
          />
        )}

        {/* Small non-blocking Disconnected / Connecting overlay */}
        {videoState !== 'LIVE' && (
          <div className="flex flex-col items-center justify-center space-y-2 p-4 text-center z-10">
            {videoState === 'CONNECTING' ? (
              <>
                <div className="w-10 h-10 rounded-full border border-amber-500/40 bg-amber-950/40 flex items-center justify-center">
                  <RefreshCw className="w-5 h-5 text-amber-400 animate-spin" />
                </div>
                <div>
                  <div className="text-amber-300 font-extrabold text-xs uppercase">
                    Connecting to IP Camera
                  </div>
                  <div className="text-slate-400 text-[10px] mt-0.5 max-w-[220px] truncate mx-auto">
                    {streamUrl}
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="w-10 h-10 rounded-full border border-rose-500/40 bg-rose-950/40 flex items-center justify-center">
                  <WifiOff className="w-5 h-5 text-rose-400" />
                </div>
                <div>
                  <div className="text-rose-300 font-extrabold text-xs uppercase">
                    Camera Disconnected
                  </div>
                  <div className="text-slate-400 text-[10px] mt-0.5 max-w-[220px] truncate mx-auto">
                    {streamUrl}
                  </div>
                  <div className="text-slate-500 text-[9px] mt-0.5">
                    Auto-reconnecting every 3s...
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleManualRetry}
                  className="mt-1 px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] font-black uppercase flex items-center space-x-1 cursor-pointer transition border border-slate-700"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Retry</span>
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Bottom subtle label */}
      <div className="absolute bottom-1.5 left-2 right-2 flex items-center justify-between z-10 pointer-events-none">
        <div className="bg-slate-900/80 backdrop-blur-md px-2 py-0.5 rounded border border-slate-800 text-[9px] text-slate-400 flex items-center space-x-1">
          <Video className="w-2.5 h-2.5 text-sky-400" />
          <span>IP CAMERA STREAM</span>
        </div>
        {videoState === 'LIVE' && (
          <div className="bg-emerald-950/80 border border-emerald-500/40 px-1.5 py-0.5 rounded text-emerald-300 text-[9px] font-black">
            ● LIVE STREAM
          </div>
        )}
      </div>
    </div>
  );
};

export default LiveVideoFeed;
