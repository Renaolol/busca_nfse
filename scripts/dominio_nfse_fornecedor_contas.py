import json
import os
import sys

python_path = os.environ.get('PYTHONPATH', '')
if python_path:
    for extra_path in python_path.split(os.pathsep):
        if extra_path and extra_path not in sys.path:
            sys.path.insert(0, extra_path)

import pyodbc


def normalize_digits(value):
    if value is None:
        return None
    return ''.join(ch for ch in str(value) if ch.isdigit())


def parse_payload():
    raw = sys.stdin.read()
    if not raw.strip():
        raise ValueError('Payload vazio para consulta de fornecedores Dominio')

    payload = json.loads(raw)
    payload['codigoEmpresa'] = int(payload.get('codigoEmpresa') or 0)
    payload['cnpjs'] = [normalize_digits(item) for item in payload.get('cnpjs', []) if normalize_digits(item)]
    if payload['codigoEmpresa'] <= 0:
        raise ValueError('codigoEmpresa invalido para consulta de fornecedores Dominio')
    if not payload['cnpjs']:
        raise ValueError('Nenhum CNPJ informado para consulta de fornecedores Dominio')
    return payload


def main():
    payload = parse_payload()
    placeholders = ','.join('?' for _ in payload['cnpjs'])
    query = f"""
SELECT cgce_for AS cnpj_fornecedor,
       codi_cta
  FROM bethadba.effornece
 WHERE codi_emp = ?
   AND cgce_for IN ({placeholders})
"""

    connection = pyodbc.connect(payload['connectionString'])
    try:
        cursor = connection.cursor()
        params = [payload['codigoEmpresa'], *payload['cnpjs']]
        cursor.execute(query, params)
        for row in cursor.fetchall():
            record = {
                'cnpj_fornecedor': normalize_digits(row.cnpj_fornecedor) or '',
                'codi_cta': str(row.codi_cta).strip() if row.codi_cta is not None else ''
            }
            sys.stdout.write(json.dumps(record, ensure_ascii=False) + '\n')
    finally:
        connection.close()


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        sys.stderr.write(str(exc) + '\n')
        sys.exit(1)
