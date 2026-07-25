# Anexo de Comparativa y Evaluación de Modelos de Base de Datos
## Modelo en Supabase (Existente) vs. Modelo Base Diseñado

Este documento presenta una auditoría técnica y comparación punto por punto entre el modelo de base de datos **actualmente desplegado en Supabase por tu compañero** (25 entidades entre tablas y vistas) y la propuesta base de diseño.

---

## 1. Veredicto y Recomendación Ejecutiva

### **Veredicto: ADOPTAR Y UTILIZAR EL MODELO DEL COMPAÑERO**

El modelo desarrollado por tu compañero en Supabase es **excepcionalmente completo, maduro y 100% alineado con las especificaciones del PRD**. No solo incluye la estructura relacional base de bodegas y productos, sino que resuelve directamente casuísticas avanzadas que el PRD exige para la fase de producción y demo.

---

## 2. Matriz Comparativa de Capacidades

| Capacidad / Requerimiento PRD | Modelo Base (Nuestra Propuesta) | Modelo de tu Compañero en Supabase | Análisis y Evaluación |
| :--- | :---: | :---: | :--- |
| **Relación N:M Bodegas - Productos** | `warehouse_stock` | `warehouse_products` + `warehouse_stock_balances` | **Superior en Supabase**: Separa la relación de catálogo por bodega (`warehouse_products`) del balance numérico histórico (`warehouse_stock_balances`). |
| **Normalización de Texto para Matcher** | En Python | Columna `name_normalized` en `products` + Vista `v_warehouse_catalogue` | **Excelente en Supabase**: Mantiene el nombre normalizado sin acentos/caracteres especiales directamente en la BD para indexación rápida. |
| **Incongruencia y Rangos de Anomalía (RF-03, RF-26)** | Evaluación al vuelo | Tabla `product_count_ranges` | **Excelente en Supabase**: Almacena rangos mínimos y máximos esperados (`expected_min`, `expected_max`) derivados del historial del Excel. |
| **Conteo a Ciegas (Blind Counting RF-18)** | RLS en tabla | Vistas específicas (`v_warehouse_catalogue` vs `v_auditor_review`) | **Excelente en Supabase**: Separa la vista del operador (`v_warehouse_catalogue`) de la vista del auditor (`v_auditor_review`) eliminando el stock teórico de la vista del tablet. |
| **Captura y Consenso de Voz (RF-23, RF-24)** | JSON en `count_sessions` | Tabla `voice_captures` | **Superior en Supabase**: Guarda latencia (`duration_ms`), recuento de modelos de consenso (`models_total`, `models_agreed`) y resultados de cada vendor en JSONB (`vendor_results`). |
| **Auditoría y Trazabilidad de Correcciones (RF-21)** | Status `'deleted'` | Campos `is_deleted`, `deleted_by`, `delete_reason` en `count_records` + Tabla `auditor_actions` | **Superior in Supabase**: Registra quién eliminó/modificó cada registro, el valor previo (`previous_quantity`), el nuevo valor y la razón. |
| **Solicitud de Reconteo por la App** | No incluida | Tabla `recount_requests` | **Exclusivo de Supabase**: Permite generar tickets de reconteo asignados a operadores específicos. |
| **Gestión de Exclusiones de Conteo** | No incluida | Tabla `count_exclusions` | **Exclusivo de Supabase**: Registra productos omitidos o dañados durante el recorrido. |
| **Exportación a Oracle ERP (RF-30)** | `oracle_exports` | Lote completo: `export_batches` + `export_lines` + Vista `v_oracle_export_preview` | **Superior en Supabase**: Mapea directamente el formato *Import Count Sequences* de Oracle (`subinventory`, `item`, `count_qty`, `uom`, `counter`). |
| **Cumplimiento Legal ISO 27001 (RNF-04)** | Documentado | Tablas `voice_consents` + Vista `v_current_voice_consent` | **Exclusivo de Supabase**: Registra la aceptación explícita de consentimiento de grabación de voz por operador. |

---

## 3. Desglose del Modelo Existente en Supabase (25 Entidades)

### Tablas Base (19 Tablas)
1. **`units`**: Catálogo de unidades de medida homologadas (`Kg`, `L`, `Unidad`, `Pza`, etc.) con bandera `allows_decimal`.
2. **`profiles`**: Usuarios con su código de contador de Oracle (`counter_code`).
3. **`warehouses`**: Bodegas con trazabilidad de origen (`source_sheet_name`, `source_ordinal`).
4. **`products`**: Catálogo maestro de productos con `name_normalized` para fuzzy matching.
5. **`warehouse_products`**: Mapeo de qué SKUs pertenecen a qué bodega.
6. **`warehouse_stock_balances`**: Saldos teóricos históricos del sistema.
7. **`product_count_ranges`**: Límites estadísticos precalculados para detección de anomalías.
8. **`audit_plans`**: Planes de auditoría con estado y contador esperado de ítems.
9. **`plan_operators`**: Operadores asignados con horas de inicio y fin (`started_at`, `finished_at`).
10. **`voice_captures`**: Registro detallado del dictado push-to-talk (duración, consenso de 3 modelos).
11. **`count_records`**: Conteo físico acumulado con soporte para *soft-deletes* (borrado táctil).
12. **`record_anomalies`**: Registro de anomalías con min/max esperados y notas de resolución.
13. **`anomaly_evidence`**: Evidencia y detalle de desbalances para el auditor.
14. **`auditor_actions`**: Historial de auditoría (quién aprobó, cambió cantidad o unidad).
15. **`recount_requests`**: Solicitudes de reconteo físico de ítems específicos.
16. **`count_exclusions`**: Ítems no contados o excluidos con justificación.
17. **`export_batches`**: Lotes de exportación a Oracle My Inventory con checksum de seguridad.
18. **`export_lines`**: Líneas individuales formateadas para el ERP Oracle.
19. **`voice_consents`**: Consentimientos legales de captura de voz (ISO 27001).

### Vistas Analíticas (6 Vistas)
1. **`v_warehouse_catalogue`**: Vista limpia del catálogo por bodega para la app del operador (sin stock teórico).
2. **`v_auditor_review`**: Vista consolidadora para la plataforma web del auditor con diferencias y desbalances.
3. **`v_oracle_export_preview`**: Previsualización exacta de las filas a importar en Oracle ERP.
4. **`v_plan_progress`**: Progreso en porcentaje del conteo del plan en tiempo real.
5. **`v_operator_anomalies`**: Vista resumida de anomalías abiertas por operador.
6. **`v_current_voice_consent`**: Estado del consentimiento de voz del usuario actual.

---

## 4. Plan de Acción Recomendado

1. **Aprovechar al 100% el esquema de tu compañero en Supabase**.
2. **Generar un Script de Poblado (Seed) específico para su esquema**:
   Poblar las tablas `units`, `warehouses`, `products`, `warehouse_products` y `warehouse_stock_balances` desde nuestro JSON procesado del Excel `BODEGAS Y STOCK.xlsx`.
