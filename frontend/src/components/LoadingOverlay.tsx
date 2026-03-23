/**
 * LoadingOverlay
 *
 * Full-screen loading and error states for the mountain view.
 */

interface LoadingOverlayProps {
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

const overlayStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(15, 23, 42, 0.85)",
  zIndex: 30,
  gap: 12,
};

const spinnerStyle: React.CSSProperties = {
  width: 36,
  height: 36,
  border: "3px solid #1e293b",
  borderTop: "3px solid #3b82f6",
  borderRadius: "50%",
  animation: "spin 0.9s linear infinite",
};

export function LoadingOverlay({ loading, error, onRetry }: LoadingOverlayProps) {
  if (!loading && !error) return null;

  return (
    <>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <div style={overlayStyle}>
        {loading && !error && (
          <>
            <div style={spinnerStyle} />
            <span style={{ color: "#64748b", fontSize: 13 }}>Loading mountain…</span>
          </>
        )}
        {error && (
          <>
            <span style={{ color: "#f87171", fontSize: 14, maxWidth: 320, textAlign: "center" }}>
              Failed to load mountain data: {error}
            </span>
            <button
              onClick={onRetry}
              style={{
                padding: "8px 20px",
                borderRadius: 6,
                background: "#1e40af",
                color: "#bfdbfe",
                border: "none",
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              Retry
            </button>
          </>
        )}
      </div>
    </>
  );
}
