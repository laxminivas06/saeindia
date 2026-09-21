/**
 * Main React Root Application Component
 * Responsive Full-Screen Fast Auto-Capture QR Scanner
 */

const { useState, useEffect } = React;

function App() {
  const [activeModal, setActiveModal] = useState(null); // null, 'receiver', 'settings'
  const [toasts, setToasts] = useState([]);

  const showToast = (message) => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, message }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 2500);
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      {/* 100% Full-Screen Edge-to-Edge Scanner */}
      <Scanner 
        showToast={showToast}
        onOpenReceiver={() => setActiveModal('receiver')}
        onOpenSettings={() => setActiveModal('settings')}
      />

      {/* Receiver Dashboard Modal */}
      {activeModal === 'receiver' && (
        <div className="minimal-modal-overlay">
          <div className="modal-header">
            <div className="modal-title">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
              Receiver Dashboard
            </div>
            <button className="floating-icon-btn" onClick={() => setActiveModal(null)} title="Close">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <ReceiverDashboard showToast={showToast} />
          </div>
        </div>
      )}

      {/* Settings / Workbench Modal */}
      {activeModal === 'settings' && (
        <div className="minimal-modal-overlay">
          <div className="modal-header">
            <div className="modal-title">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              Test QR Workbench
            </div>
            <button className="floating-icon-btn" onClick={() => setActiveModal(null)} title="Close">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <QRWorkbench />
          </div>
        </div>
      )}

      {/* Floating Minimal Toast Notifications */}
      {toasts.map(t => (
        <div key={t.id} className="toast-minimal">{t.message}</div>
      ))}
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
