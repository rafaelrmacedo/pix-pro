import { AuthResponse, Project, Image } from "../types";

const GATEWAY_URL = import.meta.env.VITE_API_GATEWAY_URL ?? "http://localhost:4000";

class ApiClient {
  private isMock(): boolean {
    return localStorage.getItem("pixpro_mock_mode") === "true";
  }

  private getHeaders(isMultipart = false): HeadersInit {
    const headers: Record<string, string> = {};
    
    if (!isMultipart) {
      headers["Content-Type"] = "application/json";
    }

    const token = localStorage.getItem("pixpro_token");
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    return headers;
  }

  async register(username: string, password: string): Promise<void> {
    localStorage.removeItem("pixpro_mock_mode");
    const res = await fetch(`${GATEWAY_URL}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Registration failed");
    }
  }

  async login(username: string, password: string): Promise<AuthResponse> {
    localStorage.removeItem("pixpro_mock_mode");
    const res = await fetch(`${GATEWAY_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Login failed");
    }

    const data: AuthResponse = await res.json();
    localStorage.setItem("pixpro_token", data.access_token);
    return data;
  }

  logout(): void {
    localStorage.removeItem("pixpro_token");
    localStorage.removeItem("pixpro_mock_mode");
    localStorage.removeItem("pixpro_mock_projects");
    localStorage.removeItem("pixpro_mock_images");
  }

  getToken(): string | null {
    return localStorage.getItem("pixpro_token");
  }

  async getProfile(): Promise<{ id: string; username: string }> {
    if (this.isMock()) {
      return { id: "usr-mock", username: "DevMock" };
    }

    const res = await fetch(`${GATEWAY_URL}/api/auth/profile`, {
      headers: this.getHeaders(),
    });

    if (!res.ok) {
      throw new Error("Failed to fetch profile");
    }

    return res.json();
  }

  async getProjects(): Promise<Project[]> {
    if (this.isMock()) {
      const stored = localStorage.getItem("pixpro_mock_projects");
      if (!stored) {
        const defaults: Project[] = [
          { id: "proj-mock-1", name: "AI Portrait Upscaler", userId: "usr-mock", createdAt: new Date(Date.now() - 3600000 * 24).toISOString() },
          { id: "proj-mock-2", name: "Background Removal Pipeline", userId: "usr-mock", createdAt: new Date(Date.now() - 3600000 * 2).toISOString() }
        ];
        localStorage.setItem("pixpro_mock_projects", JSON.stringify(defaults));
        return defaults;
      }
      return JSON.parse(stored);
    }

    const res = await fetch(`${GATEWAY_URL}/api/projects`, {
      headers: this.getHeaders(),
    });

    if (!res.ok) {
      throw new Error("Failed to fetch projects");
    }

    const data = await res.json();
    return data.projects || [];
  }

  async createProject(name: string): Promise<Project> {
    if (this.isMock()) {
      const stored = localStorage.getItem("pixpro_mock_projects");
      const projects: Project[] = stored ? JSON.parse(stored) : [];
      const newProj: Project = {
        id: `proj-mock-${Date.now()}`,
        name,
        userId: "usr-mock",
        createdAt: new Date().toISOString()
      };
      projects.push(newProj);
      localStorage.setItem("pixpro_mock_projects", JSON.stringify(projects));
      
      // Dispatch mock websocket event for project creation
      window.dispatchEvent(new CustomEvent("mock-ws-event", {
        detail: {
          type: "project.created",
          payload: newProj
        }
      }));

      return newProj;
    }

    const res = await fetch(`${GATEWAY_URL}/api/projects`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify({ name }),
    });

    if (!res.ok) {
      throw new Error("Failed to create project");
    }

    return res.json();
  }

  async getProjectImages(projectId: string): Promise<Image[]> {
    if (this.isMock()) {
      const stored = localStorage.getItem("pixpro_mock_images");
      if (!stored) {
        const defaults: Image[] = [
          {
            id: "img-mock-1",
            project_id: "proj-mock-1",
            original_url: "https://picsum.photos/seed/original1/600/400",
            cdn_url: "https://picsum.photos/seed/processed1/600/400",
            status: "completed",
            created_at: new Date(Date.now() - 3600000 * 23).toISOString()
          }
        ];
        localStorage.setItem("pixpro_mock_images", JSON.stringify(defaults));
        return defaults.filter(img => img.project_id === projectId);
      }
      const images: Image[] = JSON.parse(stored);
      return images.filter(img => img.project_id === projectId);
    }

    const res = await fetch(`${GATEWAY_URL}/api/projects/${projectId}/images`, {
      headers: this.getHeaders(),
    });

    if (!res.ok) {
      throw new Error("Failed to fetch project images");
    }

    const data = await res.json();
    return data.images || [];
  }

  async uploadImage(projectId: string, file: File): Promise<{ imageId: string; originalUrl: string }> {
    if (this.isMock()) {
      const imageId = `img-mock-${Date.now()}`;
      
      // Use a seed for picsum photo matching the file name or ID
      const originalUrl = `https://picsum.photos/seed/orig-${imageId}/600/400`;
      
      const stored = localStorage.getItem("pixpro_mock_images");
      const images: Image[] = stored ? JSON.parse(stored) : [];
      
      const newImg: Image = {
        id: imageId,
        project_id: projectId,
        original_url: originalUrl,
        cdn_url: null,
        status: "pending",
        created_at: new Date().toISOString()
      };
      
      images.push(newImg);
      localStorage.setItem("pixpro_mock_images", JSON.stringify(images));

      // Trigger asynchronous simulation of processing
      this.simulateProcessing(projectId, imageId);

      return { imageId, originalUrl };
    }

    const formData = new FormData();
    formData.append("projectId", projectId);
    formData.append("image", file);

    const res = await fetch(`${GATEWAY_URL}/api/images/jobs`, {
      method: "POST",
      headers: this.getHeaders(true),
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Image upload failed");
    }

    return res.json();
  }

  private simulateProcessing(projectId: string, imageId: string) {
    // 1. After 800ms, change to "processing" and send custom mock event
    setTimeout(() => {
      if (localStorage.getItem("pixpro_mock_mode") !== "true") return;
      this.updateMockImageStatus(imageId, "processing", null);
      window.dispatchEvent(new CustomEvent("mock-ws-event", {
        detail: {
          type: "image.process.requested",
          payload: { imageId, projectId }
        }
      }));

      // 2. After 2500ms, change to "completed" and send custom mock event
      setTimeout(() => {
        if (localStorage.getItem("pixpro_mock_mode") !== "true") return;
        const cdnUrl = `https://picsum.photos/seed/proc-${imageId}/600/400`;
        this.updateMockImageStatus(imageId, "completed", cdnUrl);
        window.dispatchEvent(new CustomEvent("mock-ws-event", {
          detail: {
            type: "image.processed",
            payload: { imageId, projectId, cdn_url: cdnUrl }
          }
        }));
      }, 2500);

    }, 800);
  }

  private updateMockImageStatus(imageId: string, status: Image["status"], cdnUrl: string | null) {
    const stored = localStorage.getItem("pixpro_mock_images");
    if (!stored) return;
    const images: Image[] = JSON.parse(stored);
    const index = images.findIndex(img => img.id === imageId);
    if (index !== -1) {
      images[index].status = status;
      images[index].cdn_url = cdnUrl;
      localStorage.setItem("pixpro_mock_images", JSON.stringify(images));
    }
  }

  async getGatewayHealth(): Promise<{ status: string; breakers: Record<string, string> }> {
    if (this.isMock()) {
      return {
        status: "ok",
        breakers: {
          auth: "closed",
          image: "closed",
          project: "closed",
          notification: "closed"
        }
      };
    }

    const res = await fetch(`${GATEWAY_URL}/health`);
    if (!res.ok) {
      throw new Error("Gateway offline");
    }
    return res.json();
  }
}

export const api = new ApiClient();
