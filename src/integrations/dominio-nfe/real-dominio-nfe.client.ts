import { Injectable } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { DominioNfeXmlRecord, DominioNfeXmlSource } from './dominio-nfe.types';

type PythonRecord = {
  catalogo_id: number;
  codigo_empresa: number;
  cnpj_empresa: string;
  chave_acesso?: string;
  data_emissao?: string;
  xml_base64: string;
};

@Injectable()
export class RealDominioNfeClient implements DominioNfeXmlSource {
  private readonly pythonBin = process.env.DOMINIO_PYTHON_BIN || 'python';
  private readonly connectionString = process.env.DOMINIO_ODBC_CONNECTION_STRING || '';
  private readonly scriptPath = join(process.cwd(), 'scripts', 'dominio_nfe_export.py');

  async listDocuments(params: {
    cnpjs: string[];
    limit?: number;
    dataEmissaoInicio?: string;
    dataEmissaoFim?: string;
    chavesAcesso?: string[];
    catalogoIdMinExclusive?: number;
    sortDirection?: 'asc' | 'desc';
  }): Promise<DominioNfeXmlRecord[]> {
    if (!this.connectionString) {
      throw new Error('DOMINIO_ODBC_CONNECTION_STRING nao configurada para importar XMLs da Dominio');
    }

    const payload = JSON.stringify({
      connectionString: this.connectionString,
      cnpjs: params.cnpjs,
      limit: params.limit,
      dataEmissaoInicio: params.dataEmissaoInicio,
      dataEmissaoFim: params.dataEmissaoFim,
      chavesAcesso: params.chavesAcesso,
      catalogoIdMinExclusive: params.catalogoIdMinExclusive,
      sortDirection: params.sortDirection
    });

    const records = await this.runPythonScript(payload);
    return records.map((record) => ({
      catalogoId: record.catalogo_id,
      codigoEmpresa: record.codigo_empresa,
      cnpjEmpresa: record.cnpj_empresa,
      chaveAcesso: record.chave_acesso,
      dataEmissao: record.data_emissao,
      xmlBase64: record.xml_base64
    }));
  }

  private runPythonScript(payload: string): Promise<PythonRecord[]> {
    return new Promise((resolve, reject) => {
      const processRef = spawn(this.pythonBin, [this.scriptPath], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      processRef.stdout.setEncoding('utf8');
      processRef.stderr.setEncoding('utf8');
      processRef.stdout.on('data', (chunk: string) => {
        stdout += chunk;
      });
      processRef.stderr.on('data', (chunk: string) => {
        stderr += chunk;
      });
      processRef.on('error', (error) => {
        reject(error);
      });
      processRef.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(stderr.trim() || `Falha ao executar importador Dominio. Exit code ${code}.`));
          return;
        }

        const lines = stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
        const records = lines.map((line) => JSON.parse(line) as PythonRecord);
        resolve(records);
      });

      processRef.stdin.write(payload);
      processRef.stdin.end();
    });
  }
}
