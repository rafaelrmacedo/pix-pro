import { Controller, Post, Body, UseGuards, Req, Get } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { User } from 'src/users/users.entity';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async signup(@Body() body: { username: string; password: string }) {
    await this.authService.register(body.username, body.password);
    return { success: true };
  }

  @Post('login')
  @UseGuards(AuthGuard('local'))
  signin(@Req() req: Request) {
    return this.authService.login(req.user as User);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('profile')
  getProfile(@Req() req: Request) {
    return req.user;
  }
}
