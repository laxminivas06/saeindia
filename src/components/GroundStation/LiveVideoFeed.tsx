import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Video, WifiOff, RefreshCw, Radio } from 'lucide-react';

const VIDEO_URL_KEY = 'drone_video_stream_url';
const DEFAULT_VIDEO_URL = 'http://192.168.31.194:8080/video';

interface LiveVideoFeedProps {
  className?: string;
  large?: boolean;
}

type VideoState = 'CONNECTING' | 'LIVE' | 'DISCONNECTED' | 'NO_URL';

export const LiveVideoFeed: React.FC<LiveVideoFeedProps> = ({ className = '', large = false }) => {
  const [streamUrl, setStreamUrl] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(VIDEO_URL_KEY) || DEFAULT_VIDEO_URL;
    }
    return DEFAULT_VIDEO_URL;
  });
  const [editingUrl, setEditingUrl] = useState(false);
  const [editValue, setEditValue] = useState(streamUrl);
  const [videoState, setVideoState] = useState<VideoState>('CONNECTING');
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
    }, 3000);
  }, []);

  useEffect(() => {
    return () => clearRetryTimer();
  }, []);

  // Force img reload on retry
  const imgSrc = streamUrl
    ? `${streamUrl}${streamUrl.includes('?') ? '&' : '?'}_t=${retryCount}`
    : '';

  const handleImgLoad = () => {
    setVideoState('LIVE');
    clearRetryTimer();
  };

  const handleImgError = () => {
    setVideoState('DISCONNECTED');
    scheduleRetry();
  };

  const handleManualRetry = () => {
    clearRetryTimer();
    setRetryCount((c) => c + 1);
    setVideoState('CONNECTING');
  };

  const handleSaveUrl = () => {
    const trimmed = editValue.trim();
    if (trimmed) {
      localStorage.setItem(VIDEO_URL_KEY, trimmed);
      setStreamUrl(trimmed);
      setRetryCount(0);
      setVideoState('CONNECTING');
    }
    setEditingUrl(false);
  };

  const stateColor = videoState === 'LIVE'
    ? 'text-emerald-400 border-emerald-500/60 bg-emerald-950/70'
    : videoState === 'CONNECTING'
    ? 'text-amber-400 border-amber-500/60 bg-amber-950/70 animate-pulse'
    : 'text-rose-400 border-rose-500/60 bg-rose-950/70';

  const stateLabel = videoState === 'LIVE' ? 'VIDEO: LIVE' : videoState === 'CONNECTING' ? 'VIDEO: CONNECTING...' : 'VIDEO: DISCONNECTED';

  return (
    <div className={`relative bg-slate-950 rounded-xl overflow-hidden border border-slate-800 flex flex-col ${className}`}>
      {/* Header overlay */}
      <div className="absolute top-2 left-2 right-2 flex items-center justify-between z-20 pointer-events-none">
        <div className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-black font-mono backdrop-blur-md ${stateColor}`}>
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
            onClick={handleManualRetry}
            className="p-1.5 rounded-lg bg-slate-900/90 border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800 transition cursor-pointer"
            title="Reconnect video stream"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => { setEditValue(streamUrl); setEditingUrl(true); }}
            className="px-2 py-1.5 rounded-lg bg-slate-900/90 border border-slate-700 text-slate-400 hover:text-white text-[10px] font-mono font-bold transition cursor-pointer"
            title="Set stream URL"
          >
            URL
          </button>
        </div>
      </div>

      {/* URL editor overlay */}
      {editingUrl && (
        <div className="absolute inset-0 z-30 bg-slate-950/95 flex flex-col items-center justify-center p-4 space-y-3">
          <div className="text-xs font-bold text-slate-300 uppercase tracking-wide">Drone Camera Stream URL</div>
          <div className="text-[10px] text-slate-500 text-center">
            Enter the IP camera stream URL from your Drone Android device<br />
            (e.g., <span className="text-purple-300">http://192.168.x.x:8080/video</span>)
          </div>
          <input
            autoFocus
            type="url"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSaveUrl(); if (e.key === 'Escape') setEditingUrl(false); }}
            className="w-full max-w-sm px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 text-xs font-mono focus:outline-none focus:border-sky-500"
            placeholder="http://192.168.x.x:8080/video"
          />
          <div className="flex space-x-2">
            <button
              onClick={handleSaveUrl}
              className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-black uppercase cursor-pointer"
            >
              CONNECT
            </button>
            <button
              onClick={() => setEditingUrl(false)}
              className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-black uppercase cursor-pointer"
            >
              CANCEL
            </button>
          </div>
        </div>
      )}

      {/* Video frame */}
      <div className="relative flex-1 flex items-center justify-center min-h-0">
        {imgSrc && (
          <img
            ref={imgRef}
            src={imgSrc}
            alt="Drone live feed"
            onLoad={handleImgLoad}
            onError={handleImgError}
            className={`absolute inset-0 w-full h-full object-cover transition-opacity ${videoState === 'LIVE' ? 'opacity-100' : 'opacity-0'}`}
          />
        )}

        {/* Disconnected / connecting overlay */}
        {videoState !== 'LIVE' && (
          <div className="flex flex-col items-center justify-center space-y-3 p-4 z-10">
            {videoState === 'CONNECTING' ? (
              <>
                <div className="w-14 h-14 rounded-full border-2 border-amber-500/40 bg-amber-950/30 flex items-center justify-center">
                  <RefreshCw className="w-7 h-7 text-amber-400 animate-spin" />
                </div>
                <div className="text-center">
                  <div className="text-amber-300 font-black text-sm uppercase">Connecting to Drone Camera</div>
                  <div className="text-slate-400 text-[11px] mt-1 font-mono">{streamUrl}</div>
                </div>
              </>
            ) : (
              <>
                <div className="w-14 h-14 rounded-full border-2 border-rose-500/40 bg-rose-950/30 flex items-center justify-center">
                  <WifiOff className="w-7 h-7 text-rose-400" />
                </div>
                <div className="text-center">
                  <div className="text-rose-300 font-black text-sm uppercase">VIDEO CONNECTION LOST</div>
                  <div className="text-slate-400 text-[11px] mt-1 font-mono">{streamUrl}</div>
                  <div className="text-slate-500 text-[10px]">Auto-reconnecting every 3 seconds…</div>
                </div>
                <button
                  onClick={handleManualRetry}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-black uppercase flex items-center space-x-1.5 cursor-pointer transition"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>RETRY NOW</span>
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Bottom status strip */}
      <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between z-10 pointer-events-none">
        <div className="bg-slate-900/80 backdrop-blur-md px-2.5 py-1 rounded border border-slate-800 font-mono text-[10px] text-slate-400 flex items-center space-x-1.5">
          <Video className="w-3 h-3 text-sky-400" />
          <span>DRONE ANDROID CAMERA</span>
        </div>
        {videoState === 'LIVE' && (
          <div className="bg-emerald-950/80 border border-emerald-500/40 px-2 py-1 rounded text-emerald-300 text-[10px] font-black font-mono">
            ● LIVE
          </div>
        )}
      </div>
    </div>
  );
};
