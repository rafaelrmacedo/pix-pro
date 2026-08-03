export interface User {
  id: string;
  username: string;
}

export interface AuthResponse {
  access_token: string;
}

export interface Project {
  id: string;
  name: string;
  userId: string;
  createdAt: string;
}

export interface Image {
  id: string;
  project_id: string;
  original_url: string;
  cdn_url: string | null;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  created_at: string;
}

export interface Notification {
  id: string;
  type: string;
  payload: any;
  createdAt: string;
}
