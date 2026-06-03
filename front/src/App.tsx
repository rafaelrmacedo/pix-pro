import { useEffect, useState, useRef } from "react";
import { Login } from "./components/Login";
import { Dashboard } from "./components/Dashboard";
import { Toast, ToastMessage } from "./components/Toast";
import { api } from "./services/api";

function getUsernameFromToken(token: string): string {
  try {
    const payload = token.split(".")[1];
    const decoded = JSON.parse(atob(payload));
    return decoded.username || "User";
  } catch {
    return "User";
  }
}

function App() {
  const [token, setToken] = useState<string | null>(api.getToken());
  const [username, setUsername] = useState<string>("");
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // WebSocket States
  const [wsConnected, setWsConnected] = useState(false);
  const [wsError, setWsError] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const socketRef = useRef<WebSocket | null>(null);
  const activeProjectIdRef = useRef<string | null>(null);
  const reconnectTimeoutRef = useRef<any>(null);

  // Setup username if token exists
  useEffect(() => {
    if (token) {
      setUsername(getUsernameFromToken(token));
    } else {
      setUsername("");
    }
  }, [token]);

  // Toast Helper
  const addToast = (type: string, message: string) => {
    const id = `toast-${Date.now()}-${Math.random()}`;
    const newToast: ToastMessage = {
      id,
      type,
      message,
      timestamp: new Date(),
    };

    setToasts((prev) => [...prev, newToast]);

    // Auto-dismiss after 5 seconds
    setTimeout(() => {
      dismissToast(id);
    }, 5000);
  };

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Secure WebSocket client connection
  const connectWebSocket = (authToken: string) => {
    if (socketRef.current) {
      const oldSocket = socketRef.current;
      socketRef.current = null;
      oldSocket.close();
    }

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }

    const wsUrl = `wss://localhost:4004/ws?token=${authToken}`;
    console.log("[WS] Connecting to secure notification service...");

    const socket = new WebSocket(wsUrl);
    socketRef.current = socket;

    socket.onopen = () => {
      console.log("[WS] Secure Connection established successfully");
      setWsConnected(true);
      setWsError(false);
    };

    socket.onmessage = (event) => {
      try {
        const envelope = JSON.parse(event.data);
        console.log("[WS] Message received:", envelope);

        const type = envelope.type || "info";
        const payload = envelope.payload || {};

        // Normalize payload to handle both notification-service envelope and direct mock payloads
        const eventPayload = payload.payload || payload;
        const imageId = eventPayload.imageId;
        const projectId = eventPayload.projectId;

        // Dispatch notifications to toast alerts
        if (type === "notification.connected") {
          addToast("info", envelope.message || "Connected to notification pipeline.");
        } else if (type === "project.created") {
          const projectName = eventPayload.name || "New Project";
          addToast("project.created", `New project "${projectName}" was successfully created!`);
          // Trigger reload of project list
          setRefreshTrigger((prev) => prev + 1);
        } else if (type === "image.process.requested") {
          addToast("image.process.requested", `Image processing job requested for ID: ${imageId}`);
          if (activeProjectIdRef.current === projectId) {
            setRefreshTrigger((prev) => prev + 1);
          }
        } else if (type === "image.processed") {
          addToast("image.processed", `AI image processing completed for ID: ${imageId}`);
          // If the processed image is for the currently open project, hot reload the image grid
          if (activeProjectIdRef.current === projectId) {
            setRefreshTrigger((prev) => prev + 1);
          }
        }
      } catch (err) {
        console.error("[WS] Failed to parse message payload:", err);
      }
    };

    socket.onerror = (error) => {
      console.error("[WS] Error occurred in connection:", error);
      // If error occurs, it is likely blocked by untrusted self-signed certificate
      setWsError(true);
      setWsConnected(false);
    };

    socket.onclose = (event) => {
      console.log(`[WS] Connection closed (code: ${event.code})`);
      
      if (socketRef.current !== socket) {
        return; // Prevent reconnect loops from stale/cleaned-up sockets
      }

      setWsConnected(false);

      // Reconnect if not manually logged out
      if (token && event.code !== 4001 && event.code !== 4002) {
        reconnectTimeoutRef.current = setTimeout(() => {
          connectWebSocket(authToken);
        }, 5000);
      }
    };
  };

  // Manage WS Lifecycle connected to token state
  useEffect(() => {
    const isMock = localStorage.getItem("pixpro_mock_mode") === "true";
    if (token && !isMock) {
      connectWebSocket(token);
    } else {
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      setWsConnected(isMock);
      setWsError(false);
    }

    return () => {
      if (socketRef.current) {
        const oldSocket = socketRef.current;
        socketRef.current = null;
        oldSocket.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [token]);

  // Listen to mock WSS events for demo offline mode
  useEffect(() => {
    const handleMockEvent = (e: Event) => {
      const customEvent = e as CustomEvent;
      const envelope = customEvent.detail;
      console.log("[Mock WS] Message received:", envelope);

      const type = envelope.type || "info";
      const payload = envelope.payload || {};

      if (type === "project.created") {
        addToast("project.created", `New project "${payload.name}" was successfully created!`);
        setRefreshTrigger((prev) => prev + 1);
      } else if (type === "image.process.requested") {
        addToast("image.process.requested", `Image processing job requested for ID: ${payload.imageId}`);
        if (activeProjectIdRef.current === payload.projectId) {
          setRefreshTrigger((prev) => prev + 1);
        }
      } else if (type === "image.processed") {
        addToast("image.processed", `AI image processing completed for ID: ${payload.imageId}`);
        if (activeProjectIdRef.current === payload.projectId) {
          setRefreshTrigger((prev) => prev + 1);
        }
      }
    };

    window.addEventListener("mock-ws-event", handleMockEvent);
    return () => {
      window.removeEventListener("mock-ws-event", handleMockEvent);
    };
  }, []);

  const handleAuthSuccess = (newToken: string) => {
    setToken(newToken);
  };

  const handleLogout = () => {
    api.logout();
    setToken(null);
  };

  return (
    <div className="app-shell">
      {!token ? (
        <Login onAuthSuccess={handleAuthSuccess} />
      ) : (
        <Dashboard
          username={username}
          onLogout={handleLogout}
          wsConnected={wsConnected}
          wsError={wsError}
          activeProjectIdRef={activeProjectIdRef}
          refreshTrigger={refreshTrigger}
        />
      )}

      <Toast toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

export default App;
