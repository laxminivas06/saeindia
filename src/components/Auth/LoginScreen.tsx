import React, { useState } from 'react';
import { AppRole } from '../../types/mission';
import { authService, ROLE_CREDENTIALS } from '../../services/authService';
import { 
  Laptop, 
  Plane, 
  Smartphone, 
  KeyRound, 
  ShieldCheck, 
  Lock, 
  Eye, 
  EyeOff, 
  Sparkles, 
  Radio, 
  Layers,
  ArrowRight,
  AlertCircle
} from 'lucide-react';
import { ThemeController } from '../common/ThemeController';

interface LoginScreenProps {
  onLoginSuccess: (role: AppRole) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLoginSuccess }) => {
  const [selectedRole, setSelectedRole] = useState<AppRole>('GROUND_STATION');
  const [callsign, setCallsign] = useState(ROLE_CREDENTIALS.GROUND_STATION.defaultCallsign);
  const [passkey, setPasskey] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleRoleChange = (role: AppRole) => {
    setSelectedRole(role);
    setErrorMsg(null);
    if (role === 'GROUND_STATION') {
      setCallsign(ROLE_CREDENTIALS.GROUND_STATION.defaultCallsign);
    } else if (role === 'DRONE') {
      setCallsign(ROLE_CREDENTIALS.DRONE.defaultCallsign);
    } else if (role === 'RUNNER') {
      setCallsign(ROLE_CREDENTIALS.RUNNER.defaultCallsign);
    } else {
      setCallsign('TESTBENCH_OPERATOR');
    }
  };

  const handleLoginSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const result = authService.login(selectedRole, callsign, passkey);
    if (result.success) {
      onLoginSuccess(selectedRole);
    } else {
      setErrorMsg(result.error || 'Authentication failed');
    }
  };

  const handleQuickLogin = (role: AppRole) => {
    authService.quickLogin(role);
    onLoginSuccess(role);
  };

  const roles = [
    {
      id: 'GROUND_STATION' as AppRole,
      name: 'GROUND STATION',
      icon: Laptop,
      color: 'text-sky-400 border-sky-500/50 bg-sky-950/30'
    },
    {
      id: 'DRONE' as AppRole,
      name: 'DRONE ANDROID',
      icon: Plane,
      color: 'text-amber-400 border-amber-500/50 bg-amber-950/30'
    },
    {
      id: 'RUNNER' as AppRole,
      name: 'RUNNER ANDROID',
      icon: Smartphone,
      color: 'text-emerald-400 border-emerald-500/50 bg-emerald-950/30'
    },
    {
      id: 'TESTBENCH' as AppRole,
      name: 'SIM TESTBENCH',
      icon: Layers,
      color: 'text-purple-400 border-purple-500/50 bg-purple-950/30'
    }
  ];

  const currentRoleConfig = selectedRole !== 'TESTBENCH' && selectedRole !== 'SELECT'
    ? ROLE_CREDENTIALS[selectedRole as keyof typeof ROLE_CREDENTIALS]
    : null;

  return (
    <div className="min-h-screen bg-sae-dark flex flex-col items-center justify-center p-4 sm:p-6 font-mono relative overflow-hidden select-none">
      <div className="absolute inset-0 grid-bg opacity-30 pointer-events-none" />
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-sky-500/10 rounded-full blur-3xl pointer-events-none" />

      {/* Top Right Theme Controller */}
      <div className="absolute top-4 right-4 z-20">
        <ThemeController showLabels />
      </div>

      <div className="relative z-10 w-full max-w-md bg-slate-900/90 border border-slate-700/80 rounded-2xl shadow-2xl p-6 sm:p-8 backdrop-blur-md space-y-6">
        {/* Header Branding */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center space-x-1.5 bg-slate-950 border border-slate-800 px-3 py-1 rounded-full text-xs text-sky-400 font-bold uppercase tracking-wider">
            <Radio className="w-3.5 h-3.5" />
            <span>SAE INDIA SECURE PORTAL</span>
          </div>

          <h1 className="text-xl sm:text-2xl font-black text-white tracking-wide uppercase">
            ROLE ACCESS AUTHENTICATION
          </h1>

          <p className="text-xs text-slate-400">
            Sign in to access your designated field operation panel.
          </p>
        </div>

        {/* 3 Role Selection Tabs */}
        <div className="grid grid-cols-2 gap-2">
          {roles.map((r) => {
            const Icon = r.icon;
            const isSel = selectedRole === r.id;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => handleRoleChange(r.id)}
                className={`p-2.5 rounded-xl border text-xs font-bold flex items-center justify-center space-x-2 transition ${
                  isSel
                    ? `${r.color} ring-1 ring-white/40 shadow-lg`
                    : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{r.name}</span>
              </button>
            );
          })}
        </div>

        {/* Login Form */}
        <form onSubmit={handleLoginSubmit} className="space-y-4">
          {errorMsg && (
            <div className="p-3 bg-rose-950/60 border border-rose-500/50 rounded-xl text-xs text-rose-300 flex items-center space-x-2 animate-pulse">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div>
            <label className="block text-slate-400 text-[11px] uppercase font-bold mb-1">
              Operator Callsign / Station ID
            </label>
            <input
              type="text"
              value={callsign}
              onChange={(e) => setCallsign(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-sm text-white font-mono focus:outline-none focus:border-sky-500 transition"
              placeholder="CALLSIGN_01"
              required
            />
          </div>

          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="text-slate-400 text-[11px] uppercase font-bold">
                Security Passkey
              </label>
              {currentRoleConfig && (
                <span className="text-[10px] text-slate-500">
                  Default: <strong className="text-sky-400">{currentRoleConfig.passkey}</strong>
                </span>
              )}
            </div>

            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={passkey}
                onChange={(e) => setPasskey(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-3 pr-10 py-2.5 text-sm text-white font-mono focus:outline-none focus:border-sky-500 transition"
                placeholder="Enter role passkey..."
                required={selectedRole !== 'TESTBENCH'}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            className="w-full py-3 bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white rounded-xl font-black text-sm uppercase tracking-wider transition flex items-center justify-center space-x-2 shadow-lg shadow-sky-600/30 cursor-pointer"
          >
            <KeyRound className="w-4 h-4" />
            <span>AUTHENTICATE & ENTER</span>
          </button>
        </form>

        {/* 1-Tap Tactical Fast Login Buttons for Rapid Testing */}
        <div className="pt-3 border-t border-slate-800 space-y-2">
          <div className="text-[10px] text-slate-500 uppercase tracking-wider text-center">
            TACTICAL 1-CLICK DEMO ACCESS
          </div>
          <div className="grid grid-cols-3 gap-1.5 text-[10px] font-bold">
            <button
              onClick={() => handleQuickLogin('GROUND_STATION')}
              className="py-2 rounded bg-sky-950/40 border border-sky-500/30 text-sky-400 hover:bg-sky-900/60 transition cursor-pointer"
            >
              GCS Panel
            </button>
            <button
              onClick={() => handleQuickLogin('DRONE')}
              className="py-2 rounded bg-amber-950/40 border border-amber-500/30 text-amber-400 hover:bg-amber-900/60 transition cursor-pointer"
            >
              Drone Core
            </button>
            <button
              onClick={() => handleQuickLogin('RUNNER')}
              className="py-2 rounded bg-emerald-950/40 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-900/60 transition cursor-pointer"
            >
              Runner Unit
            </button>
          </div>
        </div>

        {/* Project & Team Specifications */}
        <div className="pt-3 border-t border-slate-800 text-[11px] text-slate-400 text-center space-y-1">
          <div className="font-bold text-slate-300">Spurthi Engineering College</div>
          <div className="flex items-center justify-center space-x-1.5 text-[10px]">
            <span className="text-sky-400 font-bold">Team Skycon</span>
            <span>•</span>
            <span>SAE Portal for Autonomous Drone</span>
          </div>
          <div className="text-[10px] text-slate-500">
            Team ID: <span className="text-emerald-400 font-mono font-bold">ADDC20260123</span>
          </div>
        </div>
      </div>
    </div>
  );
};
