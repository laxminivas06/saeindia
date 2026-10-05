import React, { useState, useEffect } from 'react';
import {
  DroneTelemetry,
  HomePoint,
  MissionState,
  PreFlightChecklist as ChecklistType,
  AutonomousMissionConfig,
  TargetBoxDetection,
  DecodedQRData,
  LatLngPoint
} from '../../types/mission';
import { PixhawkConnectionState } from '../../types/mavlink';
import { RunnerLinkState } from '../../types/runner';
import { missionEngine } from '../../services/missionEngine';
import { boxDetectionService } from '../../services/boxDetectionService';
import { visionService } from '../../services/visionService';
import { ipCameraService, IpCameraStatus } from '../../services/ipCameraService';
import { mavlinkService } from '../../services/mavlinkService';
import { GroundStationOperationsBar, SystemDetectionStatus } from './GroundStationOperationsBar';
import { IndependentConnectionStatusBar } from '../common/IndependentConnectionStatusBar';
import { MissionConfigurationCard } from './MissionConfigurationCard';
import { MissionSafetyCard } from './MissionSafetyCard';
import { ReturnBehaviorCard } from './ReturnBehaviorCard';
import { CompactHomePointCard } from './CompactHomePointCard';
import { GoogleMapGroundStation } from './GoogleMapGroundStation';
import { RouteSummaryCard } from './RouteSummaryCard';
import { FlightControllerCard } from './FlightControllerCard';
import { MissionStatusCard } from './MissionStatusCard';
import { VisionStatusCard } from './VisionStatusCard';
import { CollapsibleEventLog } from './CollapsibleEventLog';
import { LiveVideoFeed } from './LiveVideoFeed';
import { customRouteService } from '../../services/customRouteService';
import { ReturnBehavior, GroundStationMission } from '../../types/groundStationMap';
import { Sliders } from 'lucide-react';

interface GroundStationDashboardProps {
  telemetry: DroneTelemetry;
  homePoint: HomePoint;
  missionState: MissionState;
  remainingSeconds: number;
  elapsedSeconds: number;
  checklist: ChecklistType;
  isReadyForMission: boolean;
  pixhawkState: PixhawkConnectionState;
  runnerLink: RunnerLinkState;
  onSetHomePoint: (coords?: { lat: number; lng: number }) => void;
  onStartMission: () => void;
  onEmergencyRTL: () => void;
  onOpenConnectionModal?: () => void;
  onSwitchToManual?: () => void;
}

export const GroundStationDashboard: React.FC<GroundStationDashboardProps> = ({
  telemetry,
  homePoint,
  missionState,
  remainingSeconds,
  elapsedSeconds,
  checklist,
  isReadyForMission,
  pixhawkState,
  runnerLink,
  onSetHomePoint,
  onStartMission,
  onEmergencyRTL,
  onOpenConnectionModal,
  onSwitchToManual
}) => {
  // State
  const [missionConfig, setMissionConfig] = useState<AutonomousMissionConfig>(() =>
    missionEngine.getMissionConfig()
  );
  const [forceBypassChecks, setForceBypassChecks] = useState<boolean>(() =>
    missionEngine.getForceBypassChecks()
  );
  const [boxDetection, setBoxDetection] = useState<TargetBoxDetection>(() =>
    boxDetectionService.getLatestBox()
  );
  const [decodedQR, setDecodedQR] = useState<DecodedQRData | null>(() =>
    missionEngine.getDecodedQR()
  );
  const [targetLocation, setTargetLocation] = useState<LatLngPoint | null>(null);

  // IP Camera & Scanner state
  const [isIpCameraOn, setIsIpCameraOn] = useState<boolean>(() =>
    ipCameraService.isIpCameraEnabled()
  );
  const [cameraStatus, setCameraStatus] = useState<IpCameraStatus>(() =>
    ipCameraService.getStatus()
  );
  const [streamUrl, setStreamUrl] = useState<string>(() =>
    ipCameraService.getStreamUrl()
  );
  const [isScannerOn, setIsScannerOn] = useState<boolean>(() =>
    ipCameraService.isScannerEnabled()
  );

  // Custom Flight Route State
  const [returnBehavior, setReturnBehavior] = useState<ReturnBehavior>(() =>
    customRouteService.getReturnBehavior()
  );
  const [customMission, setCustomMission] = useState<GroundStationMission | null>(() =>
    customRouteService.getCurrentMission()
  );
  const [isDrawingRoute, setIsDrawingRoute] = useState<boolean>(false);
  const [isDrawingReturn, setIsDrawingReturn] = useState<boolean>(false);

  // Subscriptions to Box & QR detection, custom route mission, and IP Camera service
  useEffect(() => {
    const unsubMission = customRouteService.subscribeMission((m) => {
      setCustomMission(m);
    });

    const unsubBox = boxDetectionService.subscribeBox((box) => {
      setBoxDetection(box);
      if (box.isDetected && telemetry.latitude && telemetry.longitude) {
        setTargetLocation({ lat: telemetry.latitude, lng: telemetry.longitude });
      }
    });

    const unsubQR = visionService.subscribeQR((qr) => {
      setDecodedQR(qr);
      if (qr && qr.code && telemetry.latitude && telemetry.longitude) {
        setTargetLocation({ lat: telemetry.latitude, lng: telemetry.longitude });
      }
    });

    const unsubCamToggle = ipCameraService.subscribeToggle(setIsIpCameraOn);
    const unsubCamStatus = ipCameraService.subscribeStatus(setCameraStatus);
    const unsubCamUrl = ipCameraService.subscribeUrl(setStreamUrl);
    const unsubScanner = ipCameraService.subscribeScanner(setIsScannerOn);

    return () => {
      unsubMission();
      unsubBox();
      unsubQR();
      unsubCamToggle();
      unsubCamStatus();
      unsubCamUrl();
      unsubScanner();
    };
  }, [telemetry.latitude, telemetry.longitude]);

  const handleUpdateMissionConfig = (partial: Partial<AutonomousMissionConfig>) => {
    missionEngine.updateMissionConfig(partial);
    setMissionConfig(missionEngine.getMissionConfig());
  };

  const handleReturnBehaviorChange = (behavior: ReturnBehavior) => {
    setReturnBehavior(behavior);
    customRouteService.setReturnBehavior(behavior);
  };

  const isMissionActive =
    missionState !== 'IDLE' &&
    missionState !== 'HOME_SET' &&
    missionState !== 'READY' &&
    missionState !== 'MISSION_COMPLETE' &&
    missionState !== 'ABORTED';

  const handleStartMissionClick = () => {
    missionEngine.startMission(forceBypassChecks);
    onStartMission();
  };

  const handleStopAbortMissionClick = () => {
    missionEngine.abortMission('Manual Operator Stop / Abort');
  };

  const handleArmClick = async () => {
    await mavlinkService.sendArmCommand(forceBypassChecks);
  };

  const handleDisarmClick = async () => {
    await mavlinkService.sendDisarmCommand();
  };

  // Compute Simplified Automatic Detection Status (Requirement 4)
  const isConnected =
    pixhawkState.isConnected || pixhawkState.isUsbConnected || pixhawkState.isRealHardware;

  const isDetecting =
    isScannerOn &&
    (missionState === 'SEARCHING' ||
      missionState === 'OBJECT_DETECTED' ||
      missionState === 'BOX_DETECTED' ||
      missionState === 'INSPECTING' ||
      missionState === 'QR_SCANNING' ||
      Boolean(boxDetection?.isDetected) ||
      Boolean(decodedQR?.code));

  let detectionStatus: SystemDetectionStatus = 'DISCONNECTED';
  if (isMissionActive) {
    detectionStatus = 'MISSION_ACTIVE';
  } else if (isDetecting) {
    detectionStatus = 'DETECTING';
  } else if (isReadyForMission || forceBypassChecks) {
    detectionStatus = 'SYSTEM_READY';
  } else if (isConnected) {
    detectionStatus = 'CONNECTED';
  } else {
    detectionStatus = 'DISCONNECTED';
  }

  return (
    <div className="p-3 sm:p-5 max-w-7xl mx-auto space-y-3.5 sm:space-y-4 font-mono select-none">
      {/* ============================================================ */}
      {/* 0. INDEPENDENT CONNECTION STATUS BAR (Requirement 12)       */}
      {/* Decoupled: GS, Phone GPS, ESP32, Pixhawk, IP Camera status   */}
      {/* ============================================================ */}
      <IndependentConnectionStatusBar 
        pixhawkState={pixhawkState} 
        onOpenConnectionModal={onOpenConnectionModal}
      />

      {/* ============================================================ */}
      {/* 1. OPERATIONS BAR: IP Camera -> Scanner -> Status -> Timer  */}
      {/* ============================================================ */}
      <GroundStationOperationsBar
        isIpCameraOn={isIpCameraOn}
        onToggleIpCamera={(on) => ipCameraService.setIpCameraEnabled(on)}
        isScannerOn={isScannerOn}
        onToggleScanner={(on) => ipCameraService.setScannerEnabled(on)}
        cameraStatus={cameraStatus}
        streamUrl={streamUrl}
        onUpdateStreamUrl={(url) => ipCameraService.setStreamUrl(url)}
        detectionStatus={detectionStatus}
        elapsedSeconds={elapsedSeconds}
        isMissionActive={isMissionActive}
        decodedQR={decodedQR}
        boxDetected={boxDetection?.isDetected}
        isArmed={telemetry.isArmed}
        isFcConnected={isConnected}
        isDroneGpsLocked={Boolean(telemetry.gps?.isLocked)}
        droneSatellites={telemetry.gps?.satellites || 0}
        isReadyForMission={isReadyForMission || forceBypassChecks}
        onArm={handleArmClick}
        onDisarm={handleDisarmClick}
        onStartMission={handleStartMissionClick}
        onStopMission={handleStopAbortMissionClick}
      />

      {/* ============================================================ */}
      {/* 2. PRIMARY WORKSPACE: MAP & ESSENTIAL MISSION CONTROLS       */}
      {/* When IP Camera is ON, designated video feed appears cleanly */}
      {/* Responsive: split column on desktop, stacked on mobile/tab   */}
      {/* ============================================================ */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* Left Column: Map Workspace */}
        <div className={isIpCameraOn ? 'lg:col-span-8 space-y-3' : 'lg:col-span-8 space-y-3'}>
          {/* Compact Home Point card */}
          <CompactHomePointCard
            homePoint={homePoint}
            gps={telemetry.gps}
            onSetHomePoint={onSetHomePoint}
            disabled={isMissionActive}
          />

          {/* Google Map Workspace */}
          <div className="relative rounded-2xl overflow-hidden border border-slate-800 shadow-2xl bg-slate-950 isolate">
            <GoogleMapGroundStation
              telemetry={telemetry}
              homePoint={homePoint}
              pixhawkState={pixhawkState}
              missionState={missionState}
              onSetHomePoint={onSetHomePoint}
              onStartMission={handleStartMissionClick}
              onEmergencyRTL={onEmergencyRTL}
              onStopAbortMission={handleStopAbortMissionClick}
              targetLocation={targetLocation}
              targetLabel={decodedQR?.code ? `QR Code: [${decodedQR.code}]` : 'Box Target Area'}
              isPipVideoVisible={false}
              isDrawingRoute={isDrawingRoute}
              onToggleDrawingRoute={setIsDrawingRoute}
              isDrawingReturn={isDrawingReturn}
              onToggleDrawingReturn={setIsDrawingReturn}
              className="h-[520px] sm:h-[580px] lg:h-[640px]"
            />
          </div>
        </div>

        {/* Right Column: Designated Video Area (when ON) & Flight Controller Card */}
        <div className="lg:col-span-4 space-y-4">
          {/* Designated IP Camera Video Area (Appears immediately when ON, hides cleanly when OFF) */}
          {isIpCameraOn && (
            <div className="rounded-2xl overflow-hidden border border-slate-800 shadow-2xl bg-slate-950 animate-in fade-in zoom-in-95 duration-200">
              <LiveVideoFeed
                className="h-[220px] sm:h-[260px] w-full"
                onClose={() => ipCameraService.setIpCameraEnabled(false)}
              />
            </div>
          )}

          {/* Essential Mission Controls: Timer, Arm, Disarm, Modes, Alt, Start, Stop */}
          <FlightControllerCard
            telemetry={telemetry}
            pixhawkState={pixhawkState}
            missionState={missionState}
            isReadyForMission={isReadyForMission}
            forceBypassChecks={forceBypassChecks}
            elapsedSeconds={elapsedSeconds}
            onStartMission={handleStartMissionClick}
            onStopAbortMission={handleStopAbortMissionClick}
            onEmergencyRTL={onEmergencyRTL}
            onOpenConnectionModal={onOpenConnectionModal}
          />
        </div>
      </div>

      {/* ============================================================ */}
      {/* 3. ROUTE SUMMARY (When user plans / draws waypoints)         */}
      {/* ============================================================ */}
      <RouteSummaryCard
        mission={customMission}
        onEditRoute={() => {
          setIsDrawingRoute(true);
          setIsDrawingReturn(false);
        }}
        onClearRoute={() => {
          customRouteService.clearRoute();
          setIsDrawingRoute(false);
          setIsDrawingReturn(false);
        }}
        onReverseRoute={() => {
          customRouteService.reverseRoute();
        }}
        onUploadToDrone={async () => {
          await customRouteService.uploadMission();
        }}
        onStartMission={handleStartMissionClick}
        isMissionActive={isMissionActive}
      />

      {/* ============================================================ */}
      {/* 4. RETURN BEHAVIOR & MISSION CONFIGURATION                   */}
      {/* ============================================================ */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-6">
          <ReturnBehaviorCard
            returnBehavior={returnBehavior}
            onChangeReturnBehavior={handleReturnBehaviorChange}
            onStartDrawReturnRoute={() => {
              setIsDrawingReturn(true);
              setIsDrawingRoute(false);
            }}
            hasCustomReturnPoints={customRouteService.getReturnPoints().length > 0}
            isMissionActive={isMissionActive}
          />
        </div>

        <div className="lg:col-span-6 flex flex-col justify-between">
          <MissionSafetyCard isMissionActive={isMissionActive} />

          {onSwitchToManual && (
            <div className="mt-3 pt-2 flex justify-end">
              <button
                type="button"
                onClick={onSwitchToManual}
                className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-rose-950/80 text-rose-300 border border-slate-800 hover:border-rose-500/50 text-[11px] font-bold uppercase flex items-center space-x-1.5 transition cursor-pointer"
              >
                <Sliders className="w-3.5 h-3.5 text-rose-400" />
                <span>Manual RC Override</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ============================================================ */}
      {/* 5. MISSION STATUS & VISION STATUS                            */}
      {/* ============================================================ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Mission Status */}
        <MissionStatusCard
          missionState={missionState}
          telemetry={telemetry}
          elapsedSeconds={elapsedSeconds}
          remainingSeconds={remainingSeconds}
          boxDetection={boxDetection}
          decodedQR={decodedQR}
        />

        {/* Vision / Target Status */}
        <VisionStatusCard
          runnerLink={runnerLink}
          boxDetection={boxDetection}
          decodedQR={decodedQR}
        />
      </div>

      {/* ============================================================ */}
      {/* 6. COLLAPSIBLE EVENT LOG                                     */}
      {/* ============================================================ */}
      <CollapsibleEventLog />
    </div>
  );
};

export default GroundStationDashboard;
