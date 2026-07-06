import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('dominio_nfe_export.py', () => {
  const pythonBin = process.env.DOMINIO_PYTHON_BIN || 'python';
  const scriptPath = join(process.cwd(), 'scripts', 'dominio_nfe_export.py');

  it('consulta EFATENDIMENTO_NFE_XML_V2 com fallback para EFATENDIMENTO_NFE_XML', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'dominio-nfe-export-'));
    const pyodbcMockPath = join(tempDir, 'pyodbc.py');
    const capturePath = join(tempDir, 'query.json');
    const connectionCapturePath = join(tempDir, 'connection.json');

    writeFileSync(
      pyodbcMockPath,
      [
        'import json',
        'import os',
        '',
        'class Row:',
        '    def __init__(self, data):',
        '        self.__dict__.update(data)',
        '',
        'class Cursor:',
        '    def execute(self, query, params):',
        "        with open(os.environ['PYODBC_CAPTURE_PATH'], 'w', encoding='utf-8') as fp:",
        "            json.dump({'query': query, 'params': list(params)}, fp)",
        '',
        '    def fetchall(self):',
        "        rows = json.loads(os.environ.get('PYODBC_ROWS_JSON', '[]'))",
        '        return [Row(item) for item in rows]',
        '',
        'class Connection:',
        '    def cursor(self):',
        '        return Cursor()',
        '',
        '    def close(self):',
        '        return None',
        '',
        'def connect(connection_string):',
        "    with open(os.environ['PYODBC_CONNECTION_CAPTURE_PATH'], 'w', encoding='utf-8') as fp:",
        "        json.dump({'connection_string': connection_string}, fp)",
        '    return Connection()',
        ''
      ].join('\n'),
      'utf8'
    );

    const payload = {
      connectionString: 'DSN=ContabilPBI;UID=PBI;PWD=Pbi',
      cnpjs: ['12.345.678/0001-99'],
      limit: 25,
      dataEmissaoInicio: '2026-06-01',
      dataEmissaoFim: '2026-06-30',
      chavesAcesso: ['35260612345678000199550010000001231000001231'],
      catalogoIds: [77],
      catalogoIdMinExclusive: 50,
      sortDirection: 'asc'
    };

    const row = {
      catalogo_id: 77,
      codigo_empresa: 123,
      cnpj_empresa: '12.345.678/0001-99',
      chave_acesso: '35260612345678000199550010000001231000001231',
      data_emissao: '2026-06-29',
      conteudo_xml: '<?xml version="1.0"?><nfeProc />'
    };

    const result = spawnSync(pythonBin, [scriptPath], {
      cwd: process.cwd(),
      input: JSON.stringify(payload),
      encoding: 'utf8',
      env: {
        ...process.env,
        PYTHONPATH: tempDir,
        PYODBC_CAPTURE_PATH: capturePath,
        PYODBC_CONNECTION_CAPTURE_PATH: connectionCapturePath,
        PYODBC_ROWS_JSON: JSON.stringify([row])
      }
    });

    try {
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');

      const queryCapture = JSON.parse(readFileSync(capturePath, 'utf8')) as {
        query: string;
        params: Array<string | number>;
      };
      const connectionCapture = JSON.parse(readFileSync(connectionCapturePath, 'utf8')) as {
        connection_string: string;
      };

      expect(connectionCapture.connection_string).toBe(payload.connectionString);
      expect(queryCapture.query).toContain('EFATENDIMENTO_NFE_XML_V2');
      expect(queryCapture.query).toContain('EFATENDIMENTO_NFE_XML');
      expect(queryCapture.query).toContain('COALESCE(nfe_xml_v2.CONTEUDO_XML, nfe_xml.CONTEUDO_XML)');
      expect(queryCapture.query).toContain('ORDER BY cat.I_CATALOGO ASC');
      expect(queryCapture.params).toEqual([
        '12345678000199',
        50,
        '2026-06-01',
        '2026-06-30',
        '35260612345678000199550010000001231000001231',
        77
      ]);

      const lines = result.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      expect(lines).toHaveLength(1);

      const exportedRecord = JSON.parse(lines[0]) as {
        catalogo_id: number;
        cnpj_empresa: string;
        chave_acesso: string;
        xml_base64: string;
      };
      expect(exportedRecord.catalogo_id).toBe(77);
      expect(exportedRecord.cnpj_empresa).toBe('12345678000199');
      expect(exportedRecord.chave_acesso).toBe('35260612345678000199550010000001231000001231');
      expect(Buffer.from(exportedRecord.xml_base64, 'base64').toString('utf8')).toContain('<nfeProc');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
