import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PasswordHashService } from './password-hash.service';

@Injectable()
export class AuthBootstrapService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordHashService: PasswordHashService
  ) {}

  async onModuleInit(): Promise<void> {
    const username = this.normalizeUsername(process.env.AUTH_SEED_ADMIN_USERNAME);
    const password = process.env.AUTH_SEED_ADMIN_PASSWORD?.trim();
    const nome = process.env.AUTH_SEED_ADMIN_NOME?.trim() || undefined;

    if (!username && !password) {
      const usersCount = await this.prisma.usuario.count();
      if (usersCount === 0) {
        console.warn('Nenhum usuario cadastrado. Configure AUTH_SEED_ADMIN_USERNAME e AUTH_SEED_ADMIN_PASSWORD para criar o primeiro acesso.');
      }
      return;
    }

    if (!username || !password) {
      throw new Error('AUTH_SEED_ADMIN_USERNAME e AUTH_SEED_ADMIN_PASSWORD devem ser informadas em conjunto');
    }

    const existingUser = await this.prisma.usuario.findUnique({
      where: { username }
    });

    if (existingUser) {
      return;
    }

    const passwordHash = await this.passwordHashService.hash(password);
    await this.prisma.usuario.create({
      data: {
        username,
        nome,
        passwordHash,
        role: 'admin',
        ativo: true,
        passwordChangedAt: new Date()
      }
    });
  }

  private normalizeUsername(value?: string): string | undefined {
    const normalized = String(value || '')
      .trim()
      .toLowerCase();
    return normalized || undefined;
  }
}
