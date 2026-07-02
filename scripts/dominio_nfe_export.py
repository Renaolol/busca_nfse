import base64
import json
import sys
from datetime import datetime

import pyodbc


def normalize_digits(value):
    if value is None:
        return None
    return ''.join(ch for ch in str(value) if ch.isdigit())


def parse_payload():
    raw = sys.stdin.read()
    if not raw.strip():
        raise ValueError('Payload vazio para importacao Dominio')
    payload = json.loads(raw)
    payload['cnpjs'] = [normalize_digits(item) for item in payload.get('cnpjs', []) if normalize_digits(item)]
    payload['chavesAcesso'] = [normalize_digits(item) for item in payload.get('chavesAcesso', []) if normalize_digits(item)]
    payload['limit'] = int(payload.get('limit') or 200)
    if payload['limit'] <= 0:
        payload['limit'] = 200
    return payload


def to_bytes(value):
    if value is None:
        return b''
    if isinstance(value, bytes):
        return value
    if isinstance(value, memoryview):
        return value.tobytes()
    if isinstance(value, bytearray):
        return bytes(value)
    if isinstance(value, str):
        return value.encode('utf-8')
    return bytes(value)


def build_query(payload):
    cnpjs = payload['cnpjs']
    if not cnpjs:
        raise ValueError('Nenhum CNPJ informado para consulta Dominio')

    query = f"""
SELECT TOP {payload['limit']}
       cat.ID AS catalogo_id,
       cat.CODI_EMP AS codigo_empresa,
       emp.cgce_emp AS cnpj_empresa,
       cat.CHAVE AS chave_acesso,
       cat.DATA_EMISSAO AS data_emissao,
       xml.CONTEUDO_XML AS conteudo_xml
  FROM bethadba.EFATENDIMENTO_NFE_CATALOGO cat
  JOIN bethadba.EFATENDIMENTO_NFE_XML xml
    ON xml.I_CATALOGO = cat.ID
  JOIN bethadba.geempre emp
    ON emp.codi_emp = cat.CODI_EMP
 WHERE xml.CONTEUDO_XML IS NOT NULL
   AND emp.cgce_emp IN ({','.join('?' for _ in cnpjs)})
"""

    params = list(cnpjs)

    if payload.get('dataEmissaoInicio'):
        query += "   AND cat.DATA_EMISSAO >= ?\n"
        params.append(payload['dataEmissaoInicio'])

    if payload.get('dataEmissaoFim'):
        query += "   AND cat.DATA_EMISSAO <= ?\n"
        params.append(payload['dataEmissaoFim'])

    chaves = payload.get('chavesAcesso') or []
    if chaves:
        query += f"   AND cat.CHAVE IN ({','.join('?' for _ in chaves)})\n"
        params.extend(chaves)

    query += " ORDER BY cat.DATA_EMISSAO DESC, cat.ID DESC"
    return query, params


def main():
    payload = parse_payload()
    query, params = build_query(payload)
    connection = pyodbc.connect(payload['connectionString'])

    try:
        cursor = connection.cursor()
        cursor.execute(query, params)

        for row in cursor.fetchall():
            xml_bytes = to_bytes(row.conteudo_xml)
            if not xml_bytes:
                continue

            emitted_at = None
            if row.data_emissao is not None:
                if isinstance(row.data_emissao, datetime):
                    emitted_at = row.data_emissao.isoformat()
                else:
                    emitted_at = str(row.data_emissao)

            record = {
                'catalogo_id': int(row.catalogo_id),
                'codigo_empresa': int(row.codigo_empresa),
                'cnpj_empresa': normalize_digits(row.cnpj_empresa) or '',
                'chave_acesso': normalize_digits(row.chave_acesso),
                'data_emissao': emitted_at,
                'xml_base64': base64.b64encode(xml_bytes).decode('ascii')
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
