import React, { useState } from "react";
import { api } from "../services/api";

interface LoginProps {
  onAuthSuccess: (token: string) => void;
}

export const Login: React.FC<LoginProps> = ({ onAuthSuccess }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setError("Please fill in all fields.");
      return;
    }

    setError(null);
    setSuccessMsg(null);
    setLoading(true);

    try {
      if (isLogin) {
        const response = await api.login(username, password);
        onAuthSuccess(response.access_token);
      } else {
        await api.register(username, password);
        setSuccessMsg("Registration successful! You can now log in.");
        setIsLogin(true);
        setPassword("");
      }
    } catch (err: any) {
      setError(err.message || "An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleMockLogin = () => {
    localStorage.setItem("pixpro_mock_mode", "true");
    const mockToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c3ItbW9jayIsInVzZXJuYW1lIjoiRGV2TW9jayIsImV4cCI6MTk5OTk5OTk5OX0.mock-sig";
    localStorage.setItem("pixpro_token", mockToken);
    onAuthSuccess(mockToken);
  };

  return (
    <div className="login-wrapper">
      <div className="login-card glass">
        <div className="login-header">
          <div className="logo-badge">
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" className="logo-icon">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <h1>PixPro</h1>
          <p>AI-Powered Microservices Image Processing Platform</p>
        </div>

        <div className="login-tabs">
          <button 
            type="button" 
            className={`tab-btn ${isLogin ? "active" : ""}`}
            onClick={() => { setIsLogin(true); setError(null); setSuccessMsg(null); }}
          >
            Login
          </button>
          <button 
            type="button" 
            className={`tab-btn ${!isLogin ? "active" : ""}`}
            onClick={() => { setIsLogin(false); setError(null); setSuccessMsg(null); }}
          >
            Register
          </button>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          {error && <div className="form-alert error">{error}</div>}
          {successMsg && <div className="form-alert success">{successMsg}</div>}

          <div className="form-group">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              type="text"
              placeholder="Enter your username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={loading}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              required
            />
          </div>

          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? (
              <span className="spinner-small"></span>
            ) : isLogin ? (
              "Sign In"
            ) : (
              "Create Account"
            )}
          </button>

          {isLogin && (
            <button
              type="button"
              className="btn-secondary"
              style={{ marginTop: "12px", width: "100%", border: "1px dashed var(--color-primary)", color: "var(--color-primary)" }}
              onClick={handleMockLogin}
              disabled={loading}
            >
              ⚡ Entrar no Modo Demo (Sem Backend)
            </button>
          )}
        </form>

        <div className="login-footer">
          <p>Sprint 1 • CQRS + RabbitMQ Microservices</p>
        </div>
      </div>
    </div>
  );
};
export default Login;
