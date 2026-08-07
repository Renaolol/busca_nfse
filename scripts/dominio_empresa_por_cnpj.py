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
        raise ValueError('Payload vazio para consulta de empresa Dominio por CNPJ')

    payload = json.loads(raw)
    payload['cnpjs'] = [normalize_digits(item) for item in payload.get('cnpjs', []) if normalize_digits(item)]
    if not payload['cnpjs']:
        raise ValueError('Nenhum CNPJ informado para consulta de empresa Dominio')
    return payload


def main():
    payload = parse_payload()
    placeholders = ','.join('?' for _ in payload['cnpjs'])
    query = f"""
SELECT cgce_emp AS cnpj_empresa,
       codi_emp AS codigo_empresa
  FROM bethadba.geempre
 WHERE cgce_emp IN ({placeholders})
"""

    connection = pyodbc.connect(payload['connectionString'])
    try:
        cursor = connection.cursor()
        cursor.execute(query, payload['cnpjs'])
        for row in cursor.fetchall():
            record = {
                'cnpj_empresa': normalize_digits(row.cnpj_empresa) or '',
                'codigo_empresa': int(row.codigo_empresa)
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
