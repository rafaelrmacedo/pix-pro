import { useEffect, useState } from "react";

const gatewayUrl = import.meta.env.VITE_API_GATEWAY_URL ?? "http://localhost:4000";

function App() {
  const [gatewayStatus, setGatewayStatus] = useState("checking");

  useEffect(() => {
    const checkGateway = async () => {
      try {
        const response = await fetch(`${gatewayUrl}/health`);
        if (!response.ok) {
          throw new Error("Gateway unavailable");
        }
        setGatewayStatus("online");
      } catch {
        setGatewayStatus("offline");
      }
    };

    checkGateway();
  }, []);

  return (
    <main className="app-shell">
      <section className="card">
        <h1>PixPro</h1>
        <p>Base inicial da SPA em React + TypeScript.</p>

        <ul>
          <li>API Gateway: {gatewayStatus}</li>
          <li>Arquitetura: Microservices + EDA</li>
          <li>Realtime: WebSocket (notification-service)</li>
        </ul>
      </section>
    </main>
  );
}

export default App;

