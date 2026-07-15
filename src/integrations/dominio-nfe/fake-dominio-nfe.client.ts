import { Injectable } from '@nestjs/common';
import { DominioNfeCatalogRecord, DominioNfeXmlRecord, DominioNfeXmlSource } from './dominio-nfe.types';

@Injectable()
export class FakeDominioNfeClient implements DominioNfeXmlSource {
  async listDocuments(): Promise<DominioNfeXmlRecord[]> {
    return [];
  }

  async listCatalog(): Promise<DominioNfeCatalogRecord[]> {
    return [];
  }
}
