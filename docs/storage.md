# Storage

Estrutura alvo de objetos:

- `nfse/{ambiente}/{cnpj}/{ano}/{mes}/xml/{chave}.xml`
- `nfse/{ambiente}/{cnpj}/{ano}/{mes}/danfse/{chave}.pdf`
- `nfse/{ambiente}/{cnpj}/{ano}/{mes}/eventos/{chave}_{tipo}.xml`
- `certificados/{cliente_id}/{certificado_id}.bin`

No MVP inicial, o codigo ja usa um provider de storage com implementacao local e interface para migracao futura para S3.
