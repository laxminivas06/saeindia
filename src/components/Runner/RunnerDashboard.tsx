import React, { useEffect, useState } from 'react';
import { RunnerLinkState, DroneQRDispatchPayload } from '../../types/runner';
import { MissionState } from '../../types/mission';
import { runnerCommService } from '../../services/runnerCommService';
import { AckProtocolCard } from './AckProtocolCard';
import { MissionTimer } from '../common/MissionTimer';
import { 
  CheckCircle2, 
  Clock, 
  Radio, 
  Send, 
  ShieldCheck, 
  Sparkles, 
  Wifi, 
  Activity,
  Zap
} from 'lucide-react';
import confetti from 'canvas-confetti';

interface RunnerDashboardProps {
  runnerLink: RunnerLinkState;
  missionState: MissionState;
  remainingSeconds: number;
  elapsedSeconds: number;
  className?: string;
}

export const RunnerDashboard: React.FC<RunnerDashboardProps> = ({
  runnerLink,
  missionState,
  remainingSeconds,
  elapsedSeconds,
  className = ''
}) => {
  const [receivedCode, setReceivedCode] = useState<string | null>(runnerLink.latestReceivedQR || null);
  const [ackDispatched, setAckDispatched] = useState<boolean>(false);
  const [receiptTimestamp, setReceiptTimestamp] = useState<number | null>(null);

  useEffect(() => {
    // Subscribe to direct wireless packets from Drone Android
    const unsubscribe = runnerCommService.subscribeMessages((msg) => {
      if (msg.type === 'QR_DISPATCH') {
        const dispatch = msg as DroneQRDispatchPayload;
        setReceivedCode(dispatch.qrCode);
        setReceiptTimestamp(Date.now());

        // Trigger celebratory confetti effect on code arrival
        try {
          confetti({
            particleCount: 50,
            spread: 60,
            origin: { y: 0.6 }
          });
        } catch (e) {}

        // AUTOMATIC RUNNER ACKNOWLEDGEMENT PROTOCOL (Zero-touch)
        // Automatically transmit ACK back to Drone Android immediately
        runnerCommService.sendAckToDrone(
          dispatch.qrCode,
          dispatch.messageId,
          dispatch.missionId,
          96
        );
        setAckDispatched(true);
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  return (
    <div className={`p-3 sm:p-5 max-w-5xl mx-auto space-y-4 sm:space-y-5 font-mono ${className}`}>
      {/* Top Banner: Runner Status Bar */}
      <div className="bg-slate-900/90 p-4 rounded-xl border border-slate-800 hud-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="text-[11px] text-slate-400 font-bold uppercase tracking-wider">
            RUNNER ANDROID FIELD UNIT
          </div>
          <div className="text-base sm:text-lg font-black text-slate-100 mt-0.5 flex items-center space-x-2">
            <span>RUNNER STATUS:</span>
            <span className="text-emerald-400 flex items-center space-x-1">
              <CheckCircle2 className="w-4 h-4" />
              <span>CONNECTED ✓</span>
            </span>
          </div>
        </div>

        {/* Wireless Link Status */}
        <div className="flex items-center space-x-2 text-xs">
          <div className="bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800 text-slate-300 flex items-center space-x-1.5">
            <Wifi className="w-3.5 h-3.5 text-sky-400" />
            <span>Direct P2P Link ({runnerLink.signalStrengthDbm} dBm)</span>
          </div>
          <div className="bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800 text-emerald-400 font-bold">
            Distance ~12m
          </div>
        </div>
      </div>

      {/* Main Field Stage: Before / After QR Receipt */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left / Hero Box: The Big Rescue Code Display (lg: 7 cols) */}
        <div className="lg:col-span-7">
          {receivedCode ? (
            /* AFTER RECEIVING QR: HIGH-CONTRAST OUTDOOR READABLE HERO */
            <div className="bg-gradient-to-b from-slate-900 to-emerald-950/40 p-6 sm:p-8 rounded-2xl border-2 border-emerald-500 shadow-2xl shadow-emerald-500/20 text-center space-y-4">
              <div className="inline-flex items-center space-x-2 bg-emerald-950 text-emerald-300 border border-emerald-400 px-4 py-1.5 rounded-full text-xs sm:text-sm font-extrabold uppercase tracking-wider shadow-lg">
                <Sparkles className="w-4 h-4" />
                <span>QR CODE RECEIVED AUTOMATICALLY</span>
              </div>

              {/* Huge High-Contrast 2-Digit Rescue Code */}
              <div className="py-4">
                <div className="text-slate-400 text-xs sm:text-sm uppercase tracking-widest font-bold mb-1">
                  OFFICIAL RESCUE PAYLOAD
                </div>
                <div className="text-7xl sm:text-8xl md:text-9xl font-black text-white tracking-widest leading-none drop-shadow-[0_10px_25px_rgba(16,185,129,0.5)]">
                  {receivedCode}
                </div>
              </div>

              {/* Status & Auto-ACK Confirmation Banner */}
              <div className="bg-emerald-900/60 border border-emerald-400/80 p-3.5 rounded-xl text-emerald-200 text-sm sm:text-base font-extrabold flex items-center justify-center space-x-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-300" />
                <span>✓ RECEIVED & ACKNOWLEDGED TO DRONE</span>
              </div>

              <div className="text-xs text-slate-400">
                Timestamp: {receiptTimestamp ? new Date(receiptTimestamp).toLocaleTimeString() : 'NOW'} • Direct Drone Wireless
              </div>
            </div>
          ) : (
            /* BEFORE RECEIVING QR: WAITING HERO */
            <div className="bg-slate-900/80 p-8 sm:p-12 rounded-2xl border border-slate-800 text-center space-y-4 min-h-[340px] flex flex-col items-center justify-center">
              <div className="w-16 h-16 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-sky-400 mx-auto shadow-inner">
                <Radio className="w-8 h-8 animate-pulse" />
              </div>

              <div className="space-y-1">
                <div className="text-xl sm:text-2xl font-black text-white tracking-wide">
                  WAITING FOR QR CODE...
                </div>
                <p className="text-xs sm:text-sm text-slate-400 max-w-sm mx-auto">
                  The drone is currently searching the rescue zone. The decoded 2-digit code will appear here automatically upon visual lock.
                </p>
              </div>

              <div className="bg-slate-950/80 px-4 py-2 rounded-full border border-slate-800 text-xs text-slate-400 flex items-center space-x-2">
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                <span>LISTENING ON DIRECT WIRELESS LINK (10-15m PROXIMITY)</span>
              </div>
            </div>
          )}
        </div>

        {/* Right Side: Mission Timer & Protocol Handshake (lg: 5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          <MissionTimer
            remainingSeconds={remainingSeconds}
            elapsedSeconds={elapsedSeconds}
            missionState={missionState}
          />

          <AckProtocolCard
            runnerLink={runnerLink}
            receivedCode={receivedCode || undefined}
            ackSent={ackDispatched}
          />
        </div>
      </div>
    </div>
  );
};
