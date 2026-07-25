# Especificación Técnica Hiper-Detallada: Módulo de Base de Datos y Rendimiento In-Memory
## Sistema Voice Inventory Counter — Colsubsidio x 30X

---

## 1. Visión y Principios del Diseño de Datos

El módulo de base de datos de **Voice Inventory Counter** está diseñado como el motor central de almacenamiento, gobernanza, seguridad y rendimiento para la captura de inventarios físicos por voz.

### Principios Fundamentales:
1. **Separación Estricta entre Interacción y Persistencia**:
   - El operador interactúa con una interfaz de velocidad extrema (< 5 ms) servida en RAM.
   - La base de datos relacional (Supabase PostgreSQL) actúa de forma asíncrona para auditoría, gobernanza y exportación al ERP Oracle.
2. **Conteo a Ciegas por Diseño (Blind Counting)**:
   - El operador **nunca tiene acceso al stock teórico**. Esto se logra aislando la vista del catálogo (`v_warehouse_catalogue`) de la vista del auditor (`v_auditor_review`).
3. **Inmutabilidad y Trazabilidad Transaccional**:
   - Las correcciones táctiles por borrado o modificación no destruyen registros; generan eventos auditables en `auditor_actions` y marcan banderas `is_deleted`.
4. **Desacoplamiento del SKU ERP**:
   - La Clave Primaria de cada producto es un `UUID` interno. Los códigos SKU externos son opcionales (`NULLABLE`) para soportar artículos no codificados.

---

## 2. Respuestas y Verificación Técnica de tus Dudas

### A. ¿Se asume o se guardan los archivos de audio en la Base de Datos?
- **Respuesta Categórica: NO. NO SE ALMACENAN ARCHIVOS DE AUDIO.**
- Cumplimiento estricto de **RNF-04 ("Voice is not stored / No persistencia de voz")**:
  - La tabla `voice_captures` en Supabase únicamente almacena **metadatos de telemetría y texto transcrito** (`transcript`, `duration_ms`, `models_total`, `models_agreed`, `vendor_results`).
  - No existe ninguna columna `audio_blob`, `audio_url` ni bucket de almacenamiento para audios.
  - El archivo binario de audio capturado por el botón push-to-talk se envía en flujo cifrado al microservicio `stt`, se convierte a texto en memoria volátil y **se destruye inmediatamente en RAM**.

### B. ¿Cómo está planteada la Búsqueda de Productos en Memoria RAM?
- **Respuesta: Está planteada e integrada de forma perfecta mediante `name_normalized` y `v_warehouse_catalogue`.**
- Tu compañero diseñó la columna **`name_normalized`** en la tabla `products` y la vista dedicada **`v_warehouse_catalogue`** expresamente para la búsqueda ultra-rápida en RAM:
  1. Al iniciar una auditoría, el microservicio `matcher` en Python (FastAPI) ejecuta una sola lectura ligera a `v_warehouse_catalogue` y precarga en la **memoria RAM** los productos de esa bodega activa.
  2. La comparación difusa (*fuzzy matching*) con `RapidFuzz` busca directamente sobre la columna en RAM `name_normalized` (sin tildes ni caracteres especiales).
  3. Tiempo de respuesta resultante: **< 4 milisegundos** a velocidad de CPU, sin tocar la base de datos remota durante el dictado en vivo.

---

## 3. Especificación de Entidades de Base de Datos en Supabase

### 3.1 Catálogo y Geografía Operativa
- **`warehouses`**: Almacena las 56 bodegas y puntos de venta.
- **`products`**: Catálogo maestro de 936 productos con nombres normalizados sin acentos (`name_normalized`).
- **`units`**: Homologación de 5 unidades básicas de medida (`UND`, `KG`, `L`, `CJ`, `BLS`).
- **`warehouse_products`**: Mapeo de existencia de productos por bodega.
- **`warehouse_stock_balances`**: Saldos teóricos históricos del sistema previa al conteo.

### 3.2 Transaccionalidad de Voz y Captura
- **`voice_captures`**: Registro técnico del dictado push-to-talk (duración ms, consenso de 3 modelos LLM, JSONB de vendors). **Sin guardar audio**.
- **`count_records`**: Registros de conteo acumulados con cantidad, unidad y traza de borrado táctil (`is_deleted`, `delete_reason`).

### 3.3 Motor de Anomalías y Rangos Estadísticos
- **`product_count_ranges`**: Rangos esperados (`expected_min`, `expected_max`) calculados estadísticamente del historial para cada producto.
- **`record_anomalies`**: Registro de alertas por unidades incorrectas, variaciones atípicas o saldos negativos.
- **`anomaly_evidence`**: Detalle analítico presentado al auditor para aprobar o rechazar la anomalía.

### 3.4 Consolidación y Exportación a Oracle ERP
- **`audit_plans`**: Planes de auditoría asignados por bodega.
- **`audit_reconciliations`**: **TABLA FINAL** con la cifra aprobada y el desbalance final (`counted_qty - theoretical_qty`).
- **`export_batches` & `export_lines`**: Lotes de exportación en formato *Import Count Sequences* de Oracle (`subinventory`, `item`, `count_qty`, `uom`, `counter`).
- **`auditor_actions`**: Historial de auditoría de modificaciones y aprobaciones.

---

## 4. Vistas Analíticas Disponibles
1. **`v_warehouse_catalogue`**: Catálogo por bodega para la app móvil del operador (**Sin stock teórico**).
2. **`v_auditor_review`**: Consolidado en tiempo real para la plataforma del auditor.
3. **`v_oracle_export_preview`**: Vista previa lista para descargar en formato Oracle ERP.
4. **`v_plan_progress`**: Porcentaje de avance y recuento de anomalías del plan de auditoría.
5. **`v_operator_anomalies`**: Resumen de alertas pendientes por operador.
6. **`v_current_voice_consent`**: Validación de consentimiento legal del usuario.
