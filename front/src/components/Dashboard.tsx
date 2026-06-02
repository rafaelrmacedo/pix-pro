import React, { useState, useEffect, useRef } from "react";
import { api } from "../services/api";
import { Project, Image } from "../types";

interface DashboardProps {
  username: string;
  onLogout: () => void;
  wsConnected: boolean;
  wsError: boolean;
  // A ref or list callback so App.tsx can notify Dashboard to refresh images
  activeProjectIdRef: React.MutableRefObject<string | null>;
  refreshTrigger: number;
}

export const Dashboard: React.FC<DashboardProps> = ({
  username,
  onLogout,
  wsConnected,
  wsError,
  activeProjectIdRef,
  refreshTrigger,
}) => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [images, setImages] = useState<Image[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingImages, setLoadingImages] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  
  // Health monitoring
  const [gatewayStatus, setGatewayStatus] = useState<"checking" | "online" | "offline">("checking");
  const [serviceBreakers, setServiceBreakers] = useState<Record<string, string>>({});

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load projects list
  const loadProjects = async () => {
    setLoadingProjects(true);
    try {
      const data = await api.getProjects();
      setProjects(data.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
    } catch (err) {
      console.error("Failed to load projects", err);
    } finally {
      setLoadingProjects(false);
    }
  };

  // Load images of active project
  const loadImages = async (projectId: string) => {
    setLoadingImages(true);
    try {
      const data = await api.getProjectImages(projectId);
      setImages(data.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()));
    } catch (err) {
      console.error("Failed to load project images", err);
    } finally {
      setLoadingImages(false);
    }
  };

  // Monitor health status
  const checkHealth = async () => {
    try {
      const health = await api.getGatewayHealth();
      setGatewayStatus("online");
      setServiceBreakers(health.breakers || {});
    } catch {
      setGatewayStatus("offline");
      setServiceBreakers({});
    }
  };

  // Initial load & health polling
  useEffect(() => {
    loadProjects();
    checkHealth();
    const interval = setInterval(checkHealth, 8000);
    return () => clearInterval(interval);
  }, []);

  // Update active project ref for App.tsx WSS listener
  useEffect(() => {
    activeProjectIdRef.current = activeProject ? activeProject.id : null;
    if (activeProject) {
      loadImages(activeProject.id);
    }
  }, [activeProject]);

  // Refresh active project images if requested by App.tsx (via WSS image.processed event)
  useEffect(() => {
    if (activeProject) {
      loadImages(activeProject.id);
    }
  }, [refreshTrigger]);

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim()) return;

    setCreatingProject(true);
    try {
      const project = await api.createProject(newProjectName);
      setNewProjectName("");
      setShowModal(false);
      await loadProjects();
      // Auto-open created project
      setActiveProject(project);
    } catch (err) {
      alert("Failed to create project");
    } finally {
      setCreatingProject(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !activeProject) return;

    setUploading(true);
    setUploadError(null);

    try {
      await api.uploadImage(activeProject.id, files[0]);
      // Immediately refresh list (will show 'processing' status)
      await loadImages(activeProject.id);
    } catch (err: any) {
      setUploadError(err.message || "Failed to upload image");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const triggerFileSelector = () => {
    fileInputRef.current?.click();
  };

  // Drag and Drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    if (!activeProject || uploading) return;

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      setUploading(true);
      setUploadError(null);
      try {
        await api.uploadImage(activeProject.id, files[0]);
        await loadImages(activeProject.id);
      } catch (err: any) {
        setUploadError(err.message || "Failed to upload image");
      } finally {
        setUploading(false);
      }
    }
  };

  return (
    <div className="dashboard-container">
      {/* Top Header */}
      <header className="dashboard-header glass">
        <div className="header-brand">
          <div className="logo-badge-small">
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <h2>PixPro</h2>
        </div>

        {/* Health Widget */}
        <div className="health-bar">
          <div className="health-pill">
            <span className={`status-dot ${gatewayStatus}`}></span>
            <span>API Gateway</span>
          </div>
          <div className="health-pill">
            <span className={`status-dot ${wsConnected ? "online" : wsError ? "error" : "checking"}`}></span>
            <span>WebSocket Live</span>
          </div>

          <div className="services-popover">
            <div className="popover-trigger">
              <svg className="popover-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="popover-content glass">
              <h4>Circuit Breaker Health</h4>
              <ul>
                {Object.entries(serviceBreakers).map(([service, status]) => (
                  <li key={service} className="service-status-item">
                    <span className={`status-dot ${status === "closed" ? "online" : "error"}`}></span>
                    <span>{service}-service: <strong>{status === "closed" ? "OK" : "Tripped"}</strong></span>
                  </li>
                ))}
                {Object.keys(serviceBreakers).length === 0 && <li>Monitoring offline...</li>}
              </ul>
            </div>
          </div>
        </div>

        {/* Profile and Logout */}
        <div className="header-actions">
          <div className="user-profile">
            <div className="avatar">{username.substring(0, 2).toUpperCase()}</div>
            <span className="username">{username}</span>
          </div>
          <button className="btn-logout" onClick={onLogout} title="Logout">
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ width: "20px", height: "20px" }}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 01-3-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>
      </header>

      {/* SSL Warn Banner if WSS failed */}
      {wsError && (
        <div className="ssl-warning-banner glass">
          <div className="banner-icon">⚠️</div>
          <div className="banner-text">
            <strong>Secure WebSocket Offline:</strong> Since we are running locally with self-signed SSL certificates, the browser blocks the WebSocket connection.
            <a href="https://localhost:4004/health" target="_blank" rel="noreferrer">
              {" "}Click here to trust the certificate
            </a>, select "Advanced" & "Proceed to localhost", then refresh this page.
          </div>
        </div>
      )}

      {/* Main Workspace Grid */}
      <main className="dashboard-workspace">
        {!activeProject ? (
          /* ================= PROJECTS GRID VIEW ================= */
          <div className="view-projects-container animate-fade-in">
            <div className="section-title-bar">
              <div>
                <h3>My Image Projects</h3>
                <p className="subtitle">Select an existing project or create a new one to process images.</p>
              </div>
              <button className="btn-primary" onClick={() => setShowModal(true)}>
                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ width: "18px", height: "18px", marginRight: "6px" }}>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                </svg>
                Create Project
              </button>
            </div>

            {loadingProjects ? (
              <div className="loading-state">
                <span className="spinner-large"></span>
                <p>Loading projects list...</p>
              </div>
            ) : projects.length === 0 ? (
              <div className="empty-state glass">
                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" className="empty-icon">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                <h3>No projects found</h3>
                <p>Get started by creating a new project container for your processing pipeline.</p>
                <button className="btn-primary" onClick={() => setShowModal(true)}>Create First Project</button>
              </div>
            ) : (
              <div className="projects-grid">
                {projects.map((project) => (
                  <div key={project.id} className="project-card glass hover-lift" onClick={() => setActiveProject(project)}>
                    <div className="project-card-header">
                      <h4>{project.name}</h4>
                      <span className="project-id">ID: {project.id.substring(0, 8)}...</span>
                    </div>
                    <div className="project-card-footer">
                      <span className="date">Created: {new Date(project.createdAt).toLocaleDateString()}</span>
                      <div className="badge-details">
                        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ width: "14px", height: "14px", marginRight: "4px" }}>
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        Open Pipeline
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* ================= PROJECT DETAIL VIEW ================= */
          <div className="view-project-details animate-fade-in">
            {/* Project Navigation bar */}
            <div className="project-details-header">
              <button className="btn-back" onClick={() => { setActiveProject(null); setImages([]); }}>
                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                Back to Projects
              </button>
              
              <div className="project-title-area">
                <h3>{activeProject.name}</h3>
                <span className="project-details-subtitle">Pipeline ID: <code>{activeProject.id}</code></span>
              </div>
            </div>

            {/* Upload Area */}
            <div 
              className={`upload-zone glass ${uploading ? "uploading" : ""}`}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onClick={triggerFileSelector}
            >
              <input 
                type="file" 
                ref={fileInputRef} 
                style={{ display: "none" }} 
                onChange={handleFileUpload} 
                accept="image/*"
                disabled={uploading}
              />
              
              {uploading ? (
                <div className="upload-progress">
                  <span className="spinner-large"></span>
                  <p>Uploading to secure Cloudflare R2 storage...</p>
                </div>
              ) : (
                <div className="upload-prompt">
                  <div className="upload-icon-circle">
                    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                  </div>
                  <p><strong>Drag & drop</strong> an image here, or <span>click to browse files</span></p>
                  <span className="file-limits">Supports PNG, JPG, GIF up to 5MB</span>
                </div>
              )}
            </div>

            {uploadError && <div className="form-alert error" style={{ marginTop: "12px" }}>{uploadError}</div>}

            {/* Images Grid */}
            <div className="images-section" style={{ marginTop: "32px" }}>
              <h4>Images in pipeline</h4>
              {loadingImages && images.length === 0 ? (
                <div className="loading-state">
                  <span className="spinner-medium"></span>
                  <p>Loading project images...</p>
                </div>
              ) : images.length === 0 ? (
                <div className="empty-state-small glass">
                  <p>No images in this pipeline yet. Drop a file above to request AI processing.</p>
                </div>
              ) : (
                <div className="images-grid">
                  {images.map((image) => (
                    <div key={image.id} className="image-card-container glass">
                      <div className="image-card-header">
                        <span className="image-id">ID: {image.id}</span>
                        <span className={`status-badge ${image.status}`}>
                          {image.status === "processing" && <span className="spinner-tiny"></span>}
                          {image.status}
                        </span>
                      </div>

                      {/* Display original vs processed */}
                      <div className="image-comparison-box">
                        <div className="comparison-pane">
                          <span className="pane-tag">Original</span>
                          <img src={image.original_url} alt="Original uploaded image" className="pipeline-img" />
                        </div>
                        
                        <div className="comparison-pane border-left">
                          <span className="pane-tag">Processed (AI Result)</span>
                          {image.status === "completed" && image.cdn_url ? (
                            <img src={image.cdn_url} alt="AI Processed Result" className="pipeline-img" />
                          ) : image.status === "failed" ? (
                            <div className="img-placeholder error">
                              <span>Failed to process</span>
                            </div>
                          ) : (
                            <div className="img-placeholder pending">
                              <span className="spinner-small" style={{ marginBottom: "8px" }}></span>
                              <span>Waiting for event...</span>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="image-card-footer">
                        <span>Uploaded: {new Date(image.created_at).toLocaleTimeString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* CREATE PROJECT MODAL */}
      {showModal && (
        <div className="modal-overlay">
          <div className="modal-content glass animate-zoom-in">
            <div className="modal-header">
              <h3>Create New Project</h3>
              <button className="btn-close" onClick={() => setShowModal(false)}>&times;</button>
            </div>
            <form onSubmit={handleCreateProject}>
              <div className="form-group" style={{ margin: "20px 0" }}>
                <label htmlFor="projectName">Project Name</label>
                <input
                  id="projectName"
                  type="text"
                  placeholder="e.g. AI Product Processing"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  autoFocus
                  required
                />
              </div>
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={creatingProject}>
                  {creatingProject ? <span className="spinner-small"></span> : "Create Pipeline"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
export default Dashboard;
