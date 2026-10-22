import { Injectable } from '@nestjs/common';
import { NfeManifestacaoClient } from './nfe-manifestacao.types';

@Injectable()
export class FakeNfeManifestacaoClient implements NfeManifestacaoClient {
  async sendManifestacao(): Promise<never> {
    throw new Error('Manifestacao desabilitada no cliente SEFAZ mock; nenhum evento foi enviado.');
  }
}
