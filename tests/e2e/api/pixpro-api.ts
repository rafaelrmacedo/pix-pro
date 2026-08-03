import { APIRequestContext } from '@playwright/test';
import crypto from 'crypto';

export interface SimpleLogger {
  logApiRequest(response: any, payload?: any): void;
}

export class PixProApi {
  protected readonly requestContext: APIRequestContext;
  protected readonly logger: SimpleLogger;

  constructor(requestContext: APIRequestContext, logger: SimpleLogger) {
    this.requestContext = requestContext;
    this.logger = logger;
  }

  generateDevToken(userId: string = 'user-123', secret: string = 'super-secret-key') {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      sub: userId,
      email: 'qa@pixpro.local',
      exp: Math.floor(Date.now() / 1000) + 3600,
    })).toString('base64url');
    const signature = crypto.createHmac('sha256', secret)
      .update(`${header}.${payload}`)
      .digest('base64url');
    return `${header}.${payload}.${signature}`;
  }

  async getHealth(servicePort: number = 4000) {
    const response = await this.requestContext.get(`http://localhost:${servicePort}/health`);
    if (this.logger?.logApiRequest) {
      this.logger.logApiRequest(response);
    }
    return response;
  }

  async getMetrics() {
    const response = await this.requestContext.get('/metrics');
    if (this.logger?.logApiRequest) {
      this.logger.logApiRequest(response);
    }
    return response;
  }

  async register(username: string, password: string) {
    const response = await this.requestContext.post('/api/auth/register', {
      data: { username, password },
    });
    if (this.logger?.logApiRequest) {
      this.logger.logApiRequest(response, { username });
    }
    return response;
  }

  async login(username: string, password: string) {
    const response = await this.requestContext.post('/api/auth/login', {
      data: { username, password },
    });
    if (this.logger?.logApiRequest) {
      this.logger.logApiRequest(response, { username });
    }
    return response;
  }

  async getProfile(token?: string) {
    const authToken = token || this.generateDevToken();
    const response = await this.requestContext.get('/api/auth/profile', {
      headers: {
        'Authorization': `Bearer ${authToken}`,
      },
    });
    if (this.logger?.logApiRequest) {
      this.logger.logApiRequest(response);
    }
    return response;
  }

  async createProject(name: string, description: string, token?: string) {
    const authToken = token || this.generateDevToken();
    const response = await this.requestContext.post('/projects', {
      headers: {
        'Authorization': `Bearer ${authToken}`,
      },
      data: { name, description },
    });
    if (this.logger?.logApiRequest) {
      this.logger.logApiRequest(response, { name, description });
    }
    return response;
  }

  async getProjects(token?: string) {
    const authToken = token || this.generateDevToken();
    const response = await this.requestContext.get('/projects', {
      headers: {
        'Authorization': `Bearer ${authToken}`,
      },
    });
    if (this.logger?.logApiRequest) {
      this.logger.logApiRequest(response);
    }
    return response;
  }

  async getProjectById(id: string, token?: string) {
    const authToken = token || this.generateDevToken();
    const response = await this.requestContext.get(`/projects/${id}`, {
      headers: {
        'Authorization': `Bearer ${authToken}`,
      },
    });
    if (this.logger?.logApiRequest) {
      this.logger.logApiRequest(response);
    }
    return response;
  }

  async createImageJob(prompt: string, projectId: string, token?: string) {
    const authToken = token || this.generateDevToken();
    const response = await this.requestContext.post('/images/jobs', {
      headers: {
        'Authorization': `Bearer ${authToken}`,
      },
      data: { prompt, projectId },
    });
    if (this.logger?.logApiRequest) {
      this.logger.logApiRequest(response, { prompt, projectId });
    }
    return response;
  }
}
