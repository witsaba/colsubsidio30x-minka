# PRD — Contador de Inventario por Voz

**Reto Hotelería · Hackathon Colsubsidio x 30X · Julio 2026**

| Campo | Valor |
| --- | --- |
| Versión | 1.0 (para aprobación en reunión del equipo) |
| Fecha | 24 de julio de 2026 |
| Estado | Borrador para aprobación |
| Equipo | Braejan Arias y Daniel Rosas (implementación técnica) · Adriana Durand y Edith Lavado (documentación, casos de uso, QA) |
| Fuentes | Reunión "Let's define the flow and tech" (23 jul), Anexo PRD (borrador), Doble Diamante, Discovery Consolidado, grupo WhatsApp del reto, dataset `BODEGAS Y STOCK.xlsx` |

---

## 1. Resumen ejecutivo

Cada fin de mes, el equipo de costos de los hoteles y parques de Colsubsidio hace la toma física de inventario en papel: una persona cuenta y anota, otra digita en Oracle y una tercera revisa. Ese paso manual es donde nacen los errores (90 vs 900, gramos vs kilos, caligrafía ilegible) y una latencia de ~2 días hasta que el dato llega al sistema.

**Contador de Inventario por Voz** reemplaza el "papel + digitar" con captura por voz push-to-talk en tablet corporativa. El operario dicta lo que cuenta; la IA extrae {producto, cantidad, unidad}, lo valida por consenso de 3 modelos, lo cruza de forma asíncrona contra el catálogo y el histórico de la bodega, y acumula registros limpios. El auditor administra todo desde una plataforma web: carga el Excel base, crea planes de auditoría, resuelve anomalías y exporta un archivo compatible con Oracle My Inventory. La herramienta no reemplaza el ERP: lo alimenta con datos correctos desde la primera vez.

## 2. Contexto y problema

### 2.1 Situación actual

- Proceso 100% analógico: se imprimen hojas (el sistema genera el listado de productos **sin cantidades**, confirmado por Colsubsidio), el personal cuenta y anota a mano, y otra persona digita en **Oracle My Inventory**.
- Dualidad "contador + digitador" que duplica esfuerzo; el auditor repite el conteo completo como segunda verificación (confirmado por Colsubsidio en el canal del reto).
- Latencia de ~2 días entre conteo físico y dato en el sistema → sin inventario en tiempo real.
- Escala: 48 almacenes en Piscilago, 107+ artículos por almacén; AyB maneja aún más referencias. Categorías heterogéneas: cerrados, abiertos (pesaje fraccionado), transformados por receta, químicos, insumos de zoológico.
- Evidencia en el dataset real: ~5,6% de saldos negativos (descuadres), ~18% de ítems sin código único, ~23% con decimales (pesaje) y unidades mixtas (Unidad/Kg/L/Porción).
- Restricciones: prohibido el celular personal (sí tablets corporativas, confirmado), red corporativa disponible, conteo ciego, salida compatible con Oracle, lógica explicable (no caja negra).

### 2.2 Declaración del problema

El personal de bodega de Colsubsidio captura el conteo físico en papel y lo digita después en Oracle. Este proceso en dos pasos es lento (hasta 2 días de latencia), propenso a error humano (~2%, con casos críticos como 90 vs 900 kg) y exige doble validación, lo que impide tener inventarios confiables en tiempo real.

### 2.3 Pregunta guía

¿Cómo podríamos capturar el conteo físico en el punto de trabajo —sin papel y sin digitación posterior— produciendo un dato confiable, validado y trazable, listo para cargar en Oracle?

## 3. Objetivos y métricas de éxito

| Objetivo | Métrica | Meta |
| --- | --- | --- |
| Eliminar el error de captura | Tasa de error del pipeline | < 1% (consenso de 3 modelos ≈ 99,9%) |
| Reducir la latencia del dato | Conteo → dato disponible | Minutos, no días |
| Captura ágil | Latencia por nota de voz | ≤ 20–30 s |
| Adopción sin fricción | Onboarding autogestionado | ≤ 5 min |
| Alimentar el ERP | Export importable en Oracle My Inventory | Sin ajustes manuales |

## 4. Alcance del MVP

**Dentro del alcance (demo del sábado):** carga de Excel como base de datos, caracterización y aprobación de datos, plan de auditoría por bodega, gestión de usuarios, captura por voz push-to-talk en app móvil, extracción {producto, cantidad, unidad}, consenso de 3 modelos, validación asíncrona con alerta de anomalía, corrección por borrón y cuenta nueva, búsqueda manual de producto, y export en formato Oracle.

**Nice to have (si sobra tiempo):** OCR vía API de Gemini, reporte de reconciliación pulido, onboarding interactivo, señales estadísticas de comparación entre operarios.

**Fuera de alcance (explícito):** conexión directa al ERP Oracle, mapeo de secciones internas de la bodega (viable pero añade complejidad innecesaria en esta etapa — acuerdo de reunión 23 jul), edición/eliminación de registros por voz, actas de vencimiento/eliminación (pendiente de confirmar con la gerente), pedidos de cocina/recetas/menús, compras a proveedores.

## 5. Usuarios y roles

**Operario (app móvil en tablet):** cuenta la bodega dictando por push-to-talk. Trabaja de pie, con las manos ocupadas, en ambiente con actividad operativa (ruido moderado según Colsubsidio). Necesita una herramienta autogestionada que no lo obligue a soltar el producto para escribir. Solo accede a los planes de auditoría a los que fue asignado. Nunca ve el stock teórico (conteo ciego).

**Auditor (plataforma web):** configura la herramienta (carga el Excel, aprueba la caracterización), crea planes de auditoría, gestiona usuarios, crea productos nuevos, revisa registros y anomalías, aprueba/declina/corrige, y genera el export y los reportes. Hoy su función es recontar lo reportado; la herramienta le permite priorizar por anomalías en lugar de recontar todo.

**Nota de contexto (WhatsApp del reto):** Colsubsidio confirmó que el auditor "vuelve a contar lo que la primera persona reportó" y que ambos recorren las mismas zonas en el mismo orden. El sistema debe soportar ese doble conteo y, además, reducir la necesidad de recontar el 100% mediante priorización estadística.

## 6. Solución y decisiones de arquitectura

### 6.1 Flujo extremo a extremo

1. **Setup (auditor, web):** carga `BODEGAS Y STOCK.xlsx` → el sistema caracteriza bodegas, SKU y unidades, y calcula parámetros estadísticos por producto (rango esperado, unidad canónica) → el auditor revisa y aprueba.
2. **Plan de auditoría (auditor, web):** selecciona **una** bodega, define periodo y asigna operarios autorizados.
3. **Conteo (operario, móvil):** elige su plan → se carga el catálogo de esa bodega → mantiene push-to-talk y dicta ("3 kilos de lechuga… 12 botellas de aceite") → suelta y el audio se procesa.
4. **Extracción (motor IA):** transcripción → ITN ("novecientos" → 900) → split multi-ítem → 3 modelos en paralelo devuelven JSON {producto, cantidad, unidad, bodega} → si coinciden, se valida; si no, se reprocesa → match del SKU contra el catálogo (coincidencia difusa; fallback a búsqueda manual).
5. **Validación asíncrona (trigger):** ¿existe el producto en la bodega?, ¿la unidad corresponde?, ¿la cantidad es razonable vs histórico?, ¿genera saldo negativo? → anomalía = advertencia naranja + bloqueo preventivo (tras terminar el audio en curso).
6. **Corrección (operario):** borrón y cuenta nueva — elimina el registro (acción táctil) y vuelve a dictar. La voz nunca edita ni elimina.
7. **Revisión (auditor):** en sitio aprueba/declina/corrige; en oficina el operario resuelve y al auditor le llega reporte con trazabilidad.
8. **Cierre:** export formato Oracle (estilo "Import Count Sequences") + reporte de reconciliación + traza de auditoría.

### 6.2 Decisiones técnicas acordadas (reunión 23 jul)

| Decisión | Justificación |
| --- | --- |
| Dos interfaces: app móvil (operario) + web (auditor) | Dos usuarios con necesidades opuestas: rapidez de ingesta vs revisión/aprobación |
| Push-to-talk, no audio en tiempo real | El tiempo real tiene alta tasa de error, dificultad técnica e interferencia humana |
| Consenso de 3 modelos de IA en JSON | Un solo modelo ≈ 82% de efectividad; el consenso lleva la precisión a ≈ 99,92% (técnica de cálculos aeroespaciales) |
| Validación asíncrona por trigger | No interrumpe el flujo de grabación del operario |
| Voz solo crea registros; corrección = eliminar + regrabar | Evita alucinaciones de la IA en aritmética y edición |
| Excel como fuente de la verdad; sin integración a ERP | La herramienta debe ser autónoma; sin carga de Excel no es viable |
| Supabase como base de datos del MVP | Migración de la estructura del inventario para validar visualización y funcionalidad |
| No se almacena la voz | Riesgo de clonación; sin persistencia no hay riesgo legal significativo (consentimiento laboral cubre el tratamiento) |
| Notas de voz de duración limitada | Control de costo y de error de procesamiento |
| ISO 27001 como marco de seguridad documentado | Valor agregado para la presentación final |
| OCR con API de Gemini solo como nice to have | Validar voz + OCR a la vez juega en contra del cronograma |

## 7. Requerimientos funcionales

### 7.1 Módulo de administración — Auditor (web)

| ID | Requerimiento | Prioridad |
| --- | --- | --- |
| RF-01 | Cargar un archivo Excel de inventario que funcione como base de datos (bodegas, SKU, productos, unidad canónica, histórico). | Must |
| RF-02 | Al cargar el Excel, caracterizar los datos: bodegas, puntos de venta/hoteles y conteo de SKU para validación/aprobación del auditor. | Must |
| RF-03 | Calcular en la carga inicial parámetros estadísticos por producto (rango esperado, unidad canónica) como insumo de detección de anomalías. | Must |
| RF-04 | El auditor puede crear productos nuevos no presentes en la base inicial (descripción, unidad, bodega). La IA nunca crea productos. | Must |
| RF-05 | Módulo de gestión de usuarios: crear, habilitar y deshabilitar operarios bajo el auditor. | Must |
| RF-06 | Crear plan de auditoría asociado a **una sola bodega**, con periodo y operarios autorizados. | Must |
| RF-07 | Restringir el acceso del operario únicamente a los planes en los que fue asignado. | Must |
| RF-08 | Visualizar todos los registros por operario, con anomalías señalizadas. | Must |
| RF-09 | Dos flujos de resolución de anomalías: auditor en sitio (aprueba/declina/corrige) y auditor en oficina (el operario resuelve y al auditor le llega reporte con trazabilidad). | Should |
| RF-10 | Señales estadísticas de comparación entre operarios (p. ej. warnings por operario) para priorizar la auditoría. | Should |

### 7.2 Módulo de ingesta por voz — Operario (app móvil)

| ID | Requerimiento | Prioridad |
| --- | --- | --- |
| RF-11 | El operario selecciona un **plan de auditoría** (no una bodega suelta); el plan determina la bodega y su catálogo. | Must |
| RF-12 | Captura **push-to-talk** (grabar–soltar–procesar), no audio en tiempo real. | Must |
| RF-13 | Limitar la duración de cada nota de voz (costo y error de procesamiento). | Must |
| RF-14 | Split de un audio con múltiples ítems en registros independientes ("2 kg de tomate, 4 de papa y 3 de lechuga" → 3 registros). | Must |
| RF-15 | La IA identifica producto, cantidad y unidad, y hace match del SKU contra el catálogo de la bodega, tolerando nombres coloquiales (ej. "tabla para picar blanca" → TABLA ACRILICA PICAR BLANCO 50X38CM FB; conciliación sugerida por Colsubsidio). | Must |
| RF-16 | Si no hay match, ofrecer búsqueda/selección manual. | Must |
| RF-17 | Normalización Inversa de Texto (ITN): "novecientos" → 900, para neutralizar el error 90 vs 900. | Must |
| RF-18 | Conteo ciego: nunca mostrar el stock teórico al operario (consistente con el proceso actual: el listado se genera sin cantidades). | Must |
| RF-19 | Los registros se acumulan en una lista limpia visible en pantalla. | Must |
| RF-20 | La voz se usa **solo para crear registros**; no edita ni elimina. | Must |
| RF-21 | Corrección por **borrón y cuenta nueva**: eliminar el registro (acción táctil) y volver a dictarlo. | Must |
| RF-22 | Onboarding que enseñe a dictar correctamente (pausado, patrón claro) y la capacidad máxima probada. | Should |

### 7.3 Motor de IA, validación y anomalías

| ID | Requerimiento | Prioridad |
| --- | --- | --- |
| RF-23 | Procesar el audio con **3 modelos de IA en paralelo**, cada uno devolviendo JSON {producto, cantidad, unidad, bodega}. | Must |
| RF-24 | Si los 3 JSON coinciden, el registro se valida; si hay discrepancia, se reprocesa el audio. | Must |
| RF-25 | Validación contra base de datos e histórico de forma **asíncrona** (trigger por evento), sin bloquear la grabación siguiente. | Must |
| RF-26 | La validación chequea: (a) ¿el producto existe en la bodega?, (b) ¿la unidad corresponde al producto? (bloquear gramos↔kilos), (c) ¿la cantidad es razonable vs histórico?, (d) ¿el conteo genera o arrastra saldo negativo? (validación sugerida por Colsubsidio: "mini reto" de los negativos). | Must |
| RF-27 | Distinguir **advertencia** (requiere atención) de **error** (dato inválido). Las anomalías son advertencias. | Must |
| RF-28 | Al detectar anomalía: señalizar en **naranja** y aplicar **bloqueo preventivo** que lleve al operario al registro afectado antes de permitir otro audio. | Must |
| RF-29 | El bloqueo no corta el audio en curso: se espera a que termine la grabación actual. | Should |

### 7.4 Reportes y export

| ID | Requerimiento | Prioridad |
| --- | --- | --- |
| RF-30 | Generar archivo descargable compatible con **Oracle My Inventory** (Excel/CSV, estilo "Import Count Sequences"). | Should |
| RF-31 | Reporte de reconciliación: contado vs sistema, diferencias y descuadres recurrentes. | Should |
| RF-32 | Traza de auditoría de cada registro (quién, cuándo, plan, anomalías). | Should |

## 8. Requerimientos no funcionales

| ID | Categoría | Requerimiento | Meta / criterio |
| --- | --- | --- | --- |
| RNF-01 | Precisión | Tasa de error del pipeline bajo un umbral de cambio de paradigma. | < 1%; consenso de 3 modelos ≈ 99,9% |
| RNF-02 | Rendimiento | Latencia de creación de registro tras soltar el audio. | ≤ 20–30 s por nota de voz |
| RNF-03 | Rendimiento | La validación asíncrona no degrada la experiencia de grabación. | El operario sigue grabando mientras corre el trigger |
| RNF-04 | Seguridad | **No se almacena la voz.** Si en el futuro se guarda: anonimizar (bajar frecuencias) o encriptar, con consentimiento del trabajador. | Sin persistencia de audio en MVP |
| RNF-05 | Seguridad | Canales seguros y encriptación alineados a **ISO 27001**, documentados para el pitch. | Documentado |
| RNF-06 | Usabilidad | Curva de aprendizaje baja, autogestionada, manos libres. | Onboarding ≤ 5 min |
| RNF-07 | Compatibilidad | Funciona en **tablet corporativa** (celular personal prohibido; tablets confirmadas por Colsubsidio, hoy sin uso en este proceso → oportunidad de integración). | Tablet + micrófono |
| RNF-08 | Disponibilidad | Offline-first / tolerante a conectividad intermitente; sincroniza al reconectar. | Captura sin red, sync diferido |
| RNF-09 | Autonomía | Opera independiente del ERP; la fuente de la verdad es el Excel cargado. | Sin integración directa a Oracle |
| RNF-10 | Escalabilidad | Escalable de 1–2 bodegas de muestra a toda la red (48 bodegas Piscilago, hoteles, AyB) sin rediseño. | Arquitectura multi-bodega |
| RNF-11 | Explicabilidad | El usuario siempre ve y valida el dato; no es caja negra (requisito del reto). | Confirmación visible |
| RNF-12 | Costo | Bajo costo: audios acotados y parámetros iniciales que reducen alucinaciones. | Presupuesto de caja de compensación |
| RNF-13 | Trazabilidad | Toda inconsistencia queda documentada como warning para auditoría posterior. | Registro de anomalías persistente |
| RNF-14 | Idioma | Reconocimiento nativo de español de Colombia (es-CO); tolerancia a apodos y términos locales. | WER es-CO objetivo 4–6% |

## 9. Casos de uso

### CU-01 · Configurar la herramienta (Auditor)
- **Precondición:** tiene el Excel de inventario.
- **Flujo:** carga el Excel → el sistema caracteriza bodegas/SKU y calcula parámetros → revisa y aprueba.
- **Postcondición:** base de datos lista. **Cubre:** RF-01, RF-02, RF-03.

### CU-02 · Crear el plan de auditoría (Auditor)
- **Flujo:** selecciona bodega → define periodo → asigna operarios → activa el plan.
- **Postcondición:** plan disponible solo para los asignados. **Cubre:** RF-05, RF-06, RF-07.

### CU-03 · Contar por voz (Operario)
- **Precondición:** plan activo con el operario asignado.
- **Flujo:** elige su plan → se carga el catálogo → push-to-talk: "3 kg de lechuga" → la IA extrae {producto, cantidad, unidad}, aplica ITN y hace match del SKU → el registro entra a la lista limpia.
- **Extensión:** sin match → búsqueda manual (RF-16).
- **Cubre:** RF-11, RF-12, RF-15, RF-17, RF-18, RF-19, RF-23, RF-24.

### CU-04 · Dictar varios ítems en un audio (Operario)
- **Flujo:** "2 kg de tomate, 4 de papa y 3 de lechuga" → split en 3 registros. **Cubre:** RF-13, RF-14.

### CU-05 · Corregir un registro (Operario)
- **Flujo:** identifica el registro errado → lo elimina (táctil) → vuelve a dictar.
- **Regla:** nunca por voz. **Cubre:** RF-20, RF-21.

### CU-06 · Resolver una anomalía (Operario / sistema)
- **Flujo:** el trigger detecta unidad incorrecta, cantidad atípica o saldo negativo → marca en naranja → al terminar el audio en curso, el bloqueo preventivo lleva al registro → corrección por borrón y cuenta nueva.
- **Cubre:** RF-25, RF-26, RF-27, RF-28, RF-29.

### CU-07 · Registrar producto no catalogado (Auditor)
- **Flujo:** aparece un ítem inexistente → el auditor lo crea con descripción, unidad y bodega. **Cubre:** RF-04.

### CU-08 · Revisar y aprobar/rechazar (Auditor)
- **En sitio:** aprueba, declina o corrige el registro con anomalía.
- **En oficina:** el operario resuelve; al auditor le llega reporte con trazabilidad.
- **Priorización:** señales estadísticas por operario. **Cubre:** RF-08, RF-09, RF-10.

### CU-09 · Cerrar y exportar (Auditor / sistema)
- **Flujo:** genera archivo formato Oracle + reporte de reconciliación + traza. **Cubre:** RF-30, RF-31, RF-32.

## 10. Plan de pruebas (QA)

El QA de IA exige, además de pruebas funcionales, **pruebas de estrés hasta el fallo** y una **matriz de fiabilidad** para el pitch (% de precisión, dónde falla, qué no es capaz de hacer).

### 10.1 Pipeline de voz e IA

| ID | Prueba | Criterio de aceptación | Req. |
| --- | --- | --- | --- |
| QA-01 | Reconocimiento es-CO con acentos y ruido de bodega | WER 4–6% | RNF-14 |
| QA-02 | Consenso de 3 modelos con audios controlados | Coincidencia ≥ 99,9%; discrepancia dispara reproceso | RF-23, RF-24 |
| QA-03 | ITN "noventa vs novecientos" y números hablados | 100% de números críticos normalizados | RF-17 |
| QA-04 | Split multi-ítem con distinto nº de productos | Todos los ítems separados correctamente hasta la capacidad máxima probada | RF-14 |
| QA-05 | Match con nombres coloquiales/apodos | Match correcto o fallback a búsqueda manual (nunca dato inventado) | RF-15, RF-16 |

### 10.2 Validación y anomalías

| ID | Prueba | Criterio de aceptación | Req. |
| --- | --- | --- | --- |
| QA-06 | Unidad incorrecta (gramos↔kilos) | Advertencia naranja y bloqueo del avance | RF-26, RF-28 |
| QA-07 | Cantidad atípica vs histórico (salto x10) | Warning sin bloquear la grabación en curso | RF-26, RF-29 |
| QA-08 | Producto inexistente en la bodega | Advertencia y ruta a creación por auditor o búsqueda manual | RF-04, RF-26 |
| QA-09 | Saldo negativo (descuadre) | Se detecta y señaliza (dataset real: ~5,6% negativos) | RF-26 |
| QA-10 | Ítem sin código único | Match por nombre sin romper el flujo (dataset real: ~18% sin código) | RF-15 |
| QA-11 | Validación asíncrona no bloquea grabación | El operario sigue grabando mientras corre el trigger | RF-25, RNF-03 |

### 10.3 Reglas y seguridad

| ID | Prueba | Criterio de aceptación | Req. |
| --- | --- | --- | --- |
| QA-12 | Conteo ciego | Ninguna pantalla del operario muestra stock teórico | RF-18 |
| QA-13 | Voz solo crea registros | Comandos de voz de editar/eliminar no ejecutan cambios | RF-20 |
| QA-14 | Borrón y cuenta nueva | Eliminar + regrabar produce el registro correcto | RF-21 |
| QA-15 | Restricción de acceso por plan | El operario no ve bodegas no asignadas | RF-07 |
| QA-16 | No persistencia de voz | No queda audio almacenado tras el procesamiento | RNF-04 |

### 10.4 Sistema y carga

| ID | Prueba | Criterio de aceptación | Req. |
| --- | --- | --- | --- |
| QA-17 | Carga y caracterización de Excel | Bodegas, SKU y unidades cargadas y aprobables sin error | RF-01, RF-02 |
| QA-18 | Latencia de creación de registro | ≤ 20–30 s por nota de voz | RNF-02 |
| QA-19 | Offline y sincronización | Captura sin red y sync íntegro al reconectar | RNF-08 |
| QA-20 | Export a formato Oracle | Archivo importable sin ajustes manuales; reconciliación correcta | RF-30, RF-31 |
| QA-21 | Estrés hasta el fallo | Capacidad máxima y puntos de quiebre documentados en la matriz | RNF-01 |

### 10.5 Matriz de fiabilidad (entregable del pitch)

Formato por escenario: [escenario] → [% fiabilidad] → [dónde falla] → [qué no es capaz de hacer]. Se llena con QA-01 a QA-21 y respalda el claim de precisión, junto con un **video de la demo** como red de seguridad ante fallos en vivo.

## 11. Hallazgos del cliente integrados (canal WhatsApp del reto, 22–24 jul)

| Hallazgo | Impacto en el PRD |
| --- | --- |
| El sistema actual es **Oracle My Inventory**; recomiendan enfocarse en agilizar la captura (la integración se trabajaría con Colsubsidio si el proyecto gana). | RF-30 apunta a formato compatible; integración fuera de alcance (RNF-09). |
| El **auditor recuenta** lo reportado; el conteo se hace dos veces, ambos recorren las mismas zonas en el mismo orden. | Fundamenta RF-09/RF-10 (priorizar por anomalías en vez de recontar todo) y el flujo de doble conteo. |
| **Tablets confirmadas** en estos entornos; hoy no se usan para este proceso. | RNF-07; oportunidad de integración destacable en el pitch. |
| El personal debe registrar con los **nombres de la base de datos**, pero Colsubsidio sugiere conciliar dictado coloquial con el registro ("tabla para picar blanca" → TABLA ACRILICA PICAR BLANCO 50X38CM FB). | RF-15 incluye coincidencia difusa/semántica. |
| Las **cantidades negativas** son un "mini reto": sugieren incluir una validación. | RF-26(d) y QA-09. |
| El listado de stock se genera **sin cantidades** para diligenciar lo contado. | Confirma el conteo ciego (RF-18). |
| **Ruido ambiental** no significativo más allá de la operación diaria. | Baja el riesgo de QA-01; se mantiene la prueba. |
| Los productos siempre están **en el mismo orden y lugar**. | Simplifica el flujo de conteo; refuerza no mapear secciones en esta etapa. |
| Productos **sin código** y naturaleza de los códigos: Colsubsidio quedó de validar internamente; sin respuesta aún. | Se mantiene QA-10 (match por nombre). Pendiente en §13. |

## 12. Riesgos y mitigaciones

| Riesgo | Mitigación |
| --- | --- |
| Alucinación del ASR/LLM en cantidades | Consenso de 3 modelos + ITN + confirmación visual (RF-17, RF-23, RF-24) |
| Nombres coloquiales sin match | Búsqueda difusa + fallback manual; nunca dato inventado (RF-15, RF-16) |
| Falla en vivo durante el pitch | Video de la demo como red de seguridad; matriz de fiabilidad con límites documentados |
| Conectividad intermitente en bodega | Diseño offline-first con sync diferido (RNF-08) |
| Dependencia de un solo proveedor de IA | 3 modelos de distintos proveedores; arquitectura desacoplada |
| Costo de procesamiento | Audios de duración limitada; control de tokens (RF-13, RNF-12) |
| Definiciones del cliente pendientes (§13) | Preguntas ya enviadas a la gerente; el diseño de planes de auditoría es agnóstico a quién asigna |

## 13. Preguntas abiertas (bloquean lógica de detalle, no el MVP)

1. **¿Quién asigna operarios a bodegas: el auditor o un supervisor?** — Pendiente con la gerente. No respondida en la reunión del 23 jul ni en el canal de WhatsApp. El diseño actual (el auditor crea planes y asigna) es el supuesto de trabajo.
2. **¿Cómo se manejan productos vencidos y eliminados del inventario?** — Pendiente con la gerente.
3. **¿Las actas de vencimiento/eliminación entran en esta etapa?** — Pendiente con la gerente. Fuera de alcance mientras no se confirme.
4. **¿El auditor ve el primer conteo al recontar, o cuenta a ciegas y se comparan?** — Surgida del hallazgo de WhatsApp; afecta la vista del auditor en sitio (RF-09).
5. **Códigos de productos: ¿internos del ERP o de barras? ¿Por qué hay artículos sin código?** — Colsubsidio quedó de validar; afecta el match (RF-15).

## 14. Trazabilidad rápida (RF ↔ CU ↔ QA)

| Área | RF | CU | QA |
| --- | --- | --- | --- |
| Configuración auditor | RF-01…RF-06 | CU-01, CU-02, CU-07 | QA-17 |
| Ingesta por voz | RF-11…RF-22 | CU-03, CU-04, CU-05 | QA-01…QA-05, QA-13, QA-14 |
| IA y validación | RF-23…RF-29 | CU-03, CU-06 | QA-02, QA-06…QA-11 |
| Reglas y seguridad | RF-07, RF-18, RF-20 | CU-05, CU-08 | QA-12, QA-15, QA-16 |
| Reportes / export | RF-30…RF-32 | CU-09 | QA-20 |
| No funcionales | RNF-01…RNF-14 | transversal | QA-18, QA-19, QA-21 |

## 15. Referencias

- Reunión "Let's define the flow and tech" (23 jul 2026) — `meet_define_project.md`
- Anexo PRD (borrador) — Google Docs
- Doble Diamante — Problema y Solución (`04 Hotelería/`)
- Discovery — Consolidado (`04 Hotelería/`)
- Grupo WhatsApp "Reto Hotelería" (22–24 jul) — `Investigación/WhatsApp Chat - Reto Hotelería/_chat.txt`
- Dataset `BODEGAS Y STOCK.xlsx` (`04 Hotelería/`)
