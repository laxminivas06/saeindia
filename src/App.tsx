import React, { useState, useEffect } from 'react';
import { AppRole, MissionState, DroneTelemetry, HomePoint, DecodedQRData, PreFlightChecklist } from './types/mission';
import { PixhawkConnectionState } from './types/mavlink';
import { RunnerLinkState } from './types/runner';
import { mavlinkService } from './services/mavlinkService';
import { missionEngine } from './services/missionEngine';
import { runnerCommService } from './services/runnerCommService';
import { visionService } from './services/visionService';
import { authService, UserSession } from './services/authService';
import { Header } from './components/common/Header';
import { LoginScreen } from './components/Auth/LoginScreen';
import { GroundStationDashboard } from './components/GroundStation/GroundStationDashboard';
import { DroneDashboard } from './components/Drone/DroneDashboard';
import { RunnerDashboard } from './components/Runner/RunnerDashboard';
import { MultiRoleSimBench } from './components/Testbench/MultiRoleSimBench';
import { MissionHistoryModal } from './components/History/MissionHistoryModal';

export const App: React.FC = () => {
  const [session, setSession] = useState<UserSession | null>(authService.getSession());
  const [historyOpen, setHistoryOpen] = useState<boolean>(false);

  // Core Real-Time State
  const [telemetry, setTelemetry] = useState<DroneTelemetry>(mavlinkService.getTelemetry());
  const [homePoint, setHomePoint] = useState<HomePoint>(mavlinkService.getHomePoint());
  const [pixhawkState, setPixhawkState] = useState<PixhawkConnectionState>(mavlinkService.getConnectionState());
  const [runnerLink, setRunnerLink] = useState<RunnerLinkState>(runnerCommService.getState());
  const [missionState, setMissionState] = useState<MissionState>(missionEngine.getCurrentState());
  const [remainingSeconds, setRemainingSeconds] = useState<number>(missionEngine.getRemainingSeconds());
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(missionEngine.getElapsedSeconds());
  const [decodedQR, setDecodedQR] = useState<DecodedQRData | null>(missionEngine.getDecodedQR());
  const [runnerAckReceived, setRunnerAckReceived] = useState<boolean>(false);
  const [runnerAckLatencyMs, setRunnerAckLatencyMs] = useState<number>(120);

  // Pre-flight validation status
  const [preFlight, setPreFlight] = useState<{ isReady: boolean; checklist: PreFlightChecklist }>(
    missionEngine.checkPreFlight()
  );

  useEffect(() => {
    // 0. Subscribe to Auth Session
    const unsubAuth = authService.subscribeSession((sess) => {
      setSession(sess);
    });

    // 1. Subscribe to MAVLink Telemetry
    const unsubTelemetry = mavlinkService.subscribeTelemetry((t) => {
      setTelemetry(t);
      setHomePoint(mavlinkService.getHomePoint());
      setPreFlight(missionEngine.checkPreFlight());
    });

    // 2. Subscribe to Pixhawk Connection State
    const unsubConn = mavlinkService.subscribeConnection((c) => {
      setPixhawkState(c);
      setPreFlight(missionEngine.checkPreFlight());
    });

    // 3. Subscribe to Runner Link State
    const unsubRunner = runnerCommService.subscribeState((r) => {
      setRunnerLink(r);
      setPreFlight(missionEngine.checkPreFlight());
    });

    // 4. Subscribe to Mission Engine State Machine & Timer (Persisted)
    const unsubMission = missionEngine.subscribeState((state, elapsed, remaining) => {
      setMissionState(state);
      setElapsedSeconds(elapsed);
      setRemainingSeconds(remaining);
      setDecodedQR(missionEngine.getDecodedQR());
      setPreFlight(missionEngine.checkPreFlight());

      if (state === 'RUNNER_CONFIRMED' || state === 'MISSION_COMPLETE') {
        setRunnerAckReceived(true);
      }
    });

    // 5. Subscribe to Vision QR events
    const unsubVision = visionService.subscribeQR((qr) => {
      setDecodedQR(qr);
    });

    return () => {
      unsubAuth();
      unsubTelemetry();
      unsubConn();
      unsubRunner();
      unsubMission();
      unsubVision();
    };
  }, []);

  // Action Handlers
  const handleSetHomePoint = () => {
    missionEngine.setHomePoint();
    setHomePoint(mavlinkService.getHomePoint());
    setPreFlight(missionEngine.checkPreFlight());
  };

  const handleStartMission = () => {
    missionEngine.startMission();
  };

  const handleEmergencyRTL = () => {
    missionEngine.triggerEmergencyRTL('MANUAL_EMERGENCY_RTL');
  };

  const handleResetMission = () => {
    missionEngine.resetMission();
    setRunnerAckReceived(false);
    setDecodedQR(null);
  };

  const handleQRDetected = (data: DecodedQRData) => {
    setDecodedQR(data);
    missionEngine.handleQRDetected(data);
  };

  const handleLogout = () => {
    authService.logout();
  };

  // If not logged in, show secure Role Access Login Portal
  if (!session) {
    return <LoginScreen onLoginSuccess={(role) => {}} />;
  }

  const currentRole = session.role;

  return (
    <div className="min-h-screen bg-sae-dark text-slate-100 flex flex-col font-sans select-none">
      {/* Tactical Top App Header with Role Badge & Logout */}
      <Header
        currentRole={currentRole}
        missionState={missionState}
        telemetry={telemetry}
        pixhawkState={pixhawkState}
        runnerLink={runnerLink}
        onSwitchRole={handleLogout}
        onOpenHistory={() => setHistoryOpen(true)}
        onResetMission={handleResetMission}
      />

      {/* Main Authenticated Dashboard Screen Based on Active Role */}
      <main className="flex-1 pb-10">
        {currentRole === 'GROUND_STATION' && (
          <GroundStationDashboard
            telemetry={telemetry}
            homePoint={homePoint}
            missionState={missionState}
            remainingSeconds={remainingSeconds}
            elapsedSeconds={elapsedSeconds}
            checklist={preFlight.checklist}
            isReadyForMission={preFlight.isReady}
            pixhawkState={pixhawkState}
            runnerLink={runnerLink}
            onSetHomePoint={handleSetHomePoint}
            onStartMission={handleStartMission}
            onEmergencyRTL={handleEmergencyRTL}
          />
        )}

        {currentRole === 'DRONE' && (
          <DroneDashboard
            telemetry={telemetry}
            missionState={missionState}
            remainingSeconds={remainingSeconds}
            elapsedSeconds={elapsedSeconds}
            decodedQR={decodedQR}
            pixhawkState={pixhawkState}
            runnerLink={runnerLink}
            runnerAckReceived={runnerAckReceived}
            runnerAckLatencyMs={runnerAckLatencyMs}
            onQRDetected={handleQRDetected}
            onEmergencyRTL={handleEmergencyRTL}
          />
        )}

        {currentRole === 'RUNNER' && (
          <RunnerDashboard
            runnerLink={runnerLink}
            missionState={missionState}
            remainingSeconds={remainingSeconds}
            elapsedSeconds={elapsedSeconds}
          />
        )}

        {currentRole === 'TESTBENCH' && (
          <MultiRoleSimBench
            telemetry={telemetry}
            homePoint={homePoint}
            missionState={missionState}
            remainingSeconds={remainingSeconds}
            elapsedSeconds={elapsedSeconds}
            checklist={preFlight.checklist}
            isReadyForMission={preFlight.isReady}
            decodedQR={decodedQR}
            pixhawkState={pixhawkState}
            runnerLink={runnerLink}
            runnerAckReceived={runnerAckReceived}
            runnerAckLatencyMs={runnerAckLatencyMs}
            onSetHomePoint={handleSetHomePoint}
            onStartMission={handleStartMission}
            onEmergencyRTL={handleEmergencyRTL}
            onQRDetected={handleQRDetected}
          />
        )}
      </main>

      {/* Mission History & Blackbox Log Modal */}
      <MissionHistoryModal
        isOpen={historyOpen}
        onClose={() => setHistoryOpen(false)}
      />
    </div>
  );
};

export default App;
