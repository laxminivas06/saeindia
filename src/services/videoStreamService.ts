export type VideoStreamStatus = 'LIVE' | 'CONNECTING' | 'DISCONNECTED';

export interface VideoStreamPacket {
  type: 'FRAME' | 'HEARTBEAT';
  timestamp: number;
  frameDataUrl?: string;
  sourceDevice: string;
  width?: number;
  height?: number;
  fps?: number;
  seq: number;
}

type StreamFrameListener = (frameDataUrl: string | null, status: VideoStreamStatus, packet?: VideoStreamPacket) => void;
type StreamStatusListener = (status: VideoStreamStatus, details?: string) => void;

const VIDEO_CHANNEL_NAME = 'SAE_DRONE_LIVE_VIDEO_STREAM';
const VIDEO_STORAGE_KEY = 'SAE_DRONE_VIDEO_FRAME';
const IP_CAMERA_STORAGE_KEY = 'SAE_DRONE_IP_CAMERA_URL';

class VideoStreamService {
  private channel: BroadcastChannel | null = null;
  private frameListeners: Set<StreamFrameListener> = new Set();
  private statusListeners: Set<StreamStatusListener> = new Set();

  private currentStatus: VideoStreamStatus = 'DISCONNECTED';
  private latestFrameDataUrl: string | null = null;
  private lastPacketTimestamp: number = 0;
  private lastPacketSeq: number = 0;

  // Broadcaster properties (Drone Android)
  private isBroadcasting: boolean = false;
  private broadcastInterval: any = null;
  private broadcastSeq: number = 0;
  private sourceCanvas: HTMLCanvasElement | null = null;
  private sourceCtx: CanvasRenderingContext2D | null = null;

  // Receiver watchdog timer (Ground Station)
  private livenessWatchdog: any = null;
  private reconnectInterval: any = null;

  // External IP Camera Stream URL (e.g. http://192.168.31.194:8080/stream)
  private ipCameraUrl: string = '';

  // Local MediaStream reference (for same-window / shared tab instance)
  private localMediaStream: MediaStream | null = null;

  constructor() {
    this.initChannel();
    this.loadSettings();
    this.startWatchdog();
  }

  private loadSettings() {
    if (typeof window === 'undefined') return;
    try {
      const savedUrl = localStorage.getItem(IP_CAMERA_STORAGE_KEY);
      if (savedUrl) {
        this.ipCameraUrl = savedUrl;
      }
    } catch (e) {
      // ignore
    }
  }

  private initChannel() {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      try {
        this.channel = new BroadcastChannel(VIDEO_CHANNEL_NAME);
        this.channel.onmessage = (event) => {
          this.handleIncomingStreamPacket(event.data);
        };
      } catch (e) {
        console.warn('BroadcastChannel not supported for video stream, falling back to storage sync', e);
      }
    }

    // Fallback: window storage event
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (event) => {
        if (event.key === VIDEO_STORAGE_KEY && event.newValue) {
          try {
            const packet = JSON.parse(event.newValue);
            this.handleIncomingStreamPacket(packet);
          } catch (e) {
            // ignore
          }
        }
      });
    }
  }

  public subscribeStream(fn: StreamFrameListener) {
    this.frameListeners.add(fn);
    fn(this.latestFrameDataUrl, this.currentStatus);
    return () => this.frameListeners.delete(fn);
  }

  public subscribeStatus(fn: StreamStatusListener) {
    this.statusListeners.add(fn);
    fn(this.currentStatus);
    return () => this.statusListeners.delete(fn);
  }

  public getStatus(): VideoStreamStatus {
    return this.currentStatus;
  }

  public getLatestFrame(): string | null {
    return this.latestFrameDataUrl;
  }

  public setIpCameraUrl(url: string) {
    this.ipCameraUrl = url.trim();
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(IP_CAMERA_STORAGE_KEY, this.ipCameraUrl);
      } catch (e) {}
    }
  }

  public getIpCameraUrl(): string {
    return this.ipCameraUrl;
  }

  public setLocalMediaStream(stream: MediaStream | null) {
    this.localMediaStream = stream;
    if (stream && stream.active) {
      this.setStatus('LIVE');
    }
  }

  public getLocalMediaStream(): MediaStream | null {
    return this.localMediaStream;
  }

  /**
   * Called by Drone Android: Starts continuously broadcasting camera frames
   */
  public startBroadcasting(videoElement: HTMLVideoElement, fps: number = 18) {
    this.stopBroadcasting();
    this.isBroadcasting = true;

    if (!this.sourceCanvas) {
      this.sourceCanvas = document.createElement('canvas');
      this.sourceCtx = this.sourceCanvas.getContext('2d', { willReadFrequently: true });
    }

    const intervalMs = Math.round(1000 / fps);

    this.broadcastInterval = setInterval(() => {
      if (!this.isBroadcasting || !videoElement || videoElement.readyState < 2) {
        return;
      }

      try {
        const width = Math.min(640, videoElement.videoWidth || 640);
        const height = Math.min(360, videoElement.videoHeight || 360);

        if (this.sourceCanvas && this.sourceCtx) {
          this.sourceCanvas.width = width;
          this.sourceCanvas.height = height;
          this.sourceCtx.drawImage(videoElement, 0, 0, width, height);

          // Highly optimized JPEG at 0.65 quality for low-latency continuous stream
          const frameDataUrl = this.sourceCanvas.toDataURL('image/jpeg', 0.65);
          this.broadcastSeq++;

          const packet: VideoStreamPacket = {
            type: 'FRAME',
            timestamp: Date.now(),
            frameDataUrl,
            sourceDevice: 'DRONE_ANDROID_CAM_01',
            width,
            height,
            fps,
            seq: this.broadcastSeq
          };

          this.broadcastPacket(packet);

          // Update local status as LIVE
          this.handleIncomingStreamPacket(packet);
        }
      } catch (err) {
        console.warn('Error broadcasting video frame', err);
      }
    }, intervalMs);
  }

  public stopBroadcasting() {
    this.isBroadcasting = false;
    if (this.broadcastInterval) {
      clearInterval(this.broadcastInterval);
      this.broadcastInterval = null;
    }
  }

  private broadcastPacket(packet: VideoStreamPacket) {
    try {
      if (this.channel) {
        this.channel.postMessage(packet);
      }
      // Every 3rd frame or on request, sync through localStorage for cross-browser / cross-process compatibility
      if (packet.seq % 3 === 0 && typeof window !== 'undefined' && window.localStorage) {
        try {
          window.localStorage.setItem(VIDEO_STORAGE_KEY, JSON.stringify(packet));
        } catch (e) {
          // ignore quota limits
        }
      }
    } catch (e) {
      console.warn('Video packet broadcast failed', e);
    }
  }

  private handleIncomingStreamPacket(packet: VideoStreamPacket) {
    if (!packet) return;

    this.lastPacketTimestamp = Date.now();
    this.lastPacketSeq = packet.seq;

    if (packet.type === 'FRAME' && packet.frameDataUrl) {
      this.latestFrameDataUrl = packet.frameDataUrl;
      this.setStatus('LIVE');
      this.notifyFrame(this.latestFrameDataUrl, packet);
    } else if (packet.type === 'HEARTBEAT') {
      if (this.currentStatus !== 'LIVE') {
        this.setStatus('CONNECTING');
      }
    }
  }

  private setStatus(newStatus: VideoStreamStatus, details?: string) {
    if (this.currentStatus !== newStatus) {
      this.currentStatus = newStatus;
      this.statusListeners.forEach((fn) => fn(newStatus, details));
    }
  }

  private notifyFrame(frameDataUrl: string | null, packet?: VideoStreamPacket) {
    this.frameListeners.forEach((fn) => fn(frameDataUrl, this.currentStatus, packet));
  }

  /**
   * Watchdog Timer for Ground Station:
   * Detects stream drops within 2.5 seconds and triggers VIDEO CONNECTION LOST.
   * Clears frozen frames so that an old image is never presented as live.
   */
  private startWatchdog() {
    this.livenessWatchdog = setInterval(() => {
      const now = Date.now();
      const timeSinceLastPacket = now - this.lastPacketTimestamp;

      // If local media stream is active, treat as LIVE
      if (this.localMediaStream && this.localMediaStream.active && this.localMediaStream.getVideoTracks().some(t => t.readyState === 'live')) {
        this.setStatus('LIVE');
        return;
      }

      if (this.lastPacketTimestamp > 0 && timeSinceLastPacket > 2500) {
        // Stream disconnected
        if (this.currentStatus !== 'DISCONNECTED') {
          // Do not present frozen previous frame as live
          this.latestFrameDataUrl = null;
          this.setStatus('DISCONNECTED', 'VIDEO CONNECTION LOST');
          this.notifyFrame(null);
        }
      } else if (this.lastPacketTimestamp === 0 && !this.localMediaStream) {
        if (this.currentStatus !== 'DISCONNECTED') {
          this.setStatus('DISCONNECTED');
        }
      }
    }, 800);

    // Auto-reconnection attempt interval
    this.reconnectInterval = setInterval(() => {
      if (this.currentStatus === 'DISCONNECTED') {
        // Ping channel for heartbeat / stream request
        try {
          if (this.channel) {
            this.channel.postMessage({ type: 'STREAM_REQUEST', timestamp: Date.now() });
          }
        } catch (e) {}
      }
    }, 2000);
  }
}

export const videoStreamService = new VideoStreamService();
