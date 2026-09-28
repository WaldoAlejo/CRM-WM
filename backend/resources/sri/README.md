# Esquemas oficiales

Descargados el 2026-09-24 desde la sección técnica de
https://www.sri.gob.ec/facturacion-electronica.

- `factura_V1.1.0.xsd`: paquete oficial «XML y XSD Factura», identificador
  `05546998-6f29-4870-be3b-62650f312a6c`.
- `NotaCredito_V1.1.0.xsd`: paquete «XML y XSD Nota de Crédito», identificador
  `dfc944cd-5f18-4433-a626-3cc64cfc4549`.
- `GuiaRemision_V1.1.0.xsd`: paquete «XML y XSD Guía de Remisión», identificador
  `642ba34d-82d0-49d8-9622-5946f8eda268`.
- `xmldsig-core-schema.xsd`: https://www.w3.org/TR/xmldsig-core/xmldsig-core-schema.xsd.

Se conservan sin modificar. El validador resuelve la importación de XMLDSIG
desde este directorio y no descarga esquemas durante la emisión.

El despliegue debe incluir `resources/sri` en el directorio de trabajo del
backend, junto con `dist` y `node_modules`.
