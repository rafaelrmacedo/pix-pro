import { Controller, Get } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Controller()
export class AppController {
  constructor(private dataSource: DataSource) {}

  @Get('health')
  async getHealth() {
    const isDbConnected = this.dataSource.isInitialized;
    return {
      service: 'auth-service',
      status: isDbConnected ? 'ok' : 'error',
      database: isDbConnected ? 'connected' : 'disconnected',
    };
  }

  @Get()
  getHello(): string {
    return 'Auth Service is running';
  }
}
