# NF-e event schemas

The manifestation adapter validates the signed `envEvento` document with the official `envConfRecebto_v1.00.xsd` schema before transmission. Its local dependencies are kept beside it so validation does not fetch schema files at runtime:

- `envConfRecebto_v1.00.xsd`
- `leiauteConfRecebto_v1.00.xsd`
- `tiposBasico_v1.03.xsd`
- `xmldsig-core-schema_v1.01.xsd`

These schema files are published in the [SVRS NF-e schema directory](https://dfe-portal.svrs.rs.gov.br/Schemas/PRNFE/). The event layout validates CPF and CNPJ authors, `cOrgao=91`, `tpEvento=210210`, the event ID, and the XMLDSig element. The schema set is versioned with the application; verify the official schema directory when adopting a later event layout.

In the vendored `leiauteConfRecebto_v1.00.xsd`, the line break and indentation before the `dhEvento` pattern were removed. The whitespace was being treated as part of the regex by libxml, which rejected otherwise valid timestamps such as `2026-10-26T16:00:00-03:00`; the pattern itself is unchanged.
