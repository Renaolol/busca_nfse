import { Injectable } from '@nestjs/common';
import { DominioNfeXmlRecord, DominioNfeXmlSource } from './dominio-nfe.types';

@Injectable()
export class FakeDominioNfeClient implements DominioNfeXmlSource {
  async listDocuments(): Promise<DominioNfeXmlRecord[]> {
    return [];
  }
}
