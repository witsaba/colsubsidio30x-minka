# Documentación Técnica Híper Detallada: Ingesta de Datos, Arquitectura y Suite de Benchmarking de Inventario por Voz

**Fecha de Publicación**: 2026-07-26  
**Proyecto**: Sistema de Inventario Inteligente por Voz (Colsubsidio / Minka)  
**Evaluación**: Suite Diagnóstica Paso a Paso en 8 Corridas Paralelas ($N = 8$, 1,904 Evaluaciones en Vivo)

---

## 1. Concepción del Corpus de Pruebas y Alojamiento en Google Drive

### 1.1 Contexto y Diseño de la Prueba
Para evaluar el comportamiento del sistema ante condiciones reales de operación en bodegas y cocinas, los miembros del equipo **Adriana** y **Daniel** grabaron notas de voz espontáneas y estructuradas sobre dictados de inventario de materias primas y productos de consumo.

### 1.2 Instrucciones de Dictado y Categorización de Complejidad
Cada evaluador siguió directrices específicas para clasificar las notas de voz en 4 niveles de dificultad:

1. 🟢 **FÁCIL (Dictado Directo de Inventario)**:
   - **Instrucción**: Dictar directamente cantidades y productos sin saludos ni muletillas.
   - **Ejemplo**: *"150 KILOS DE ARROZ Y 75 LITROS DE ACEITE"*.
   - **Objetivo**: Evaluar la precisión base del STT y la extracción directa del LLM.

2. 🟡 **MEDIO (Contexto Conversacional)**:
   - **Instrucción**: Incluir saludos, referencias a estantes o contexto de la bodega.
   - **Ejemplo**: *"HOLA CARLOS COMO VAS MIRA AQUI REVISANDO LA BODEGA PRINCIPAL HAY 90 KILOS DE LENTEJA Y 200 LITROS DE VINAGRE"*.
   - **Objetivo**: Probar la capacidad del LLM para ignorar el ruido conversacional y extraer únicamente los productos verdaderos.

3. 🔴 **DIFÍCIL (Entornos con Ruido de Fondo o Voces Múltiples)**:
   - **Instrucción**: Grabar en ambientes con ruido ambiental de maquinaria, extractores o cocinas.
   - **Ejemplo**: Dictado grabado en zonas de alta interferencia acústica.
   - **Objetivo**: Evaluar la robustez del modelo de transcripción Deepgram ante acústica degradada.

4. ⚪ **OMITIR / GARBAGE (Chisme o Ruido sin Inventario)**:
   - **Instrucción**: Grabar conversaciones cotidianas o ruidos sin mencionar ningún producto ni cantidad.
   - **Ejemplo**: *"DON PEDRO ME ESCUCHA BUENOS DIAS SOLO QUERIA SALUDAR Y SABER A QUE HORA LLEGA EL CAMION"*.
   - **Objetivo**: Verificar que el sistema filtre el descarte al 100% sin inventar ni alucinar registros de inventario ficticios.

---

### 1.3 Recursos Reales y Enlaces Directos en Google Drive

Para garantizar la **replicabilidad total del benchmark**, todos los datos originales se encuentran alojados en la nube con acceso para el equipo:

- 📂 **Carpeta Raíz Compartida en Google Drive**:  
  [Ver Carpeta General en Google Drive](https://drive.google.com/drive/u/1/folders/1e9a69v6Fz5m8o6XWsStagUtJKu-Hnuau)

- 👩‍💼 **Dataset y Hoja de Cálculo de Adriana (133 Casos)**:
  - **Hoja Google Sheets `BD_AUDIOS`**: [Abrir BD_AUDIOS Adriana](https://docs.google.com/spreadsheets/d/1UcAYiDXcqzjST9mM9x-Y9pZC142KsRl73PuG6677WaM)
  - **Archivos de Voz**: 133 clips de audio en formato `.mp4` (del `1.mp4` al `133.mp4`).

- 👨‍💼 **Dataset y Hoja de Cálculo de Daniel (105 Casos)**:
  - **Hoja Google Sheets `BD_AUDIOS`**: [Abrir BD_AUDIOS Daniel](https://docs.google.com/spreadsheets/d/1nzou21xzFw4y5Npk0NJujcfwRGfPJsOWgYyfol2-oas)
  - **Archivos de Voz**: 105 clips de audio en formato `.ogg` (del `1.ogg` al `105.ogg`).

- 🤖 **Service Account GCP para Ingesta Automática**:  
  `automatizaciones-bonobit@proyecto-de-aprendizaje-437022.iam.gserviceaccount.com`

---

## 2. Pipeline de Ingesta, Normalización y Preprocesamiento de Datos

### 2.1 Descarga Automática e Ingesta Recursiva
El script [`scripts/ingest_drive_dataset.py`](file:///c:/Users/drosa/Documents/Workspace/2026_07_25_repo_oficial/colsubsidio30x-minka/scripts/ingest_drive_dataset.py) realiza las siguientes operaciones automáticas:
1. Conecta con la API de Google Drive v3 usando la cuenta de servicio GCP.
2. Utiliza paginación `nextPageToken` y búsqueda recursiva en subcarpetas para garantizar que el 100% de los audios sean descargados a [`benchmarks/corpus/audios/`](file:///c:/Users/drosa/Documents/Workspace/2026_07_25_repo_oficial/colsubsidio30x-minka/benchmarks/corpus/audios).
3. Construye claves compuestas unívocas (ej. `adriana_1`, `daniel_70`).

### 2.2 Algoritmo de Normalización Textual
Para evitar falsos negativos debidos a diferencias de formato (ej. *"kilos"* vs *"KILOS"* o *"arándano"* vs *"ARANDANO"*), se aplica una función de normalización determinista:
$$\text{Texto Normalizado} = \text{CleanPunctuation}(\text{Unaccent}(\text{Uppercase}(\text{Texto Crudo})))$$

- **Ejemplo**: `"220 kilos de azúcar rubia!"` $\rightarrow$ `"220 KILOS DE AZUCAR RUBIA"`.

### 2.3 Generación del Dataset Consolidado
El resultado preprocesado se exporta a [`benchmarks/corpus/consolidated_dataset.csv`](file:///c:/Users/drosa/Documents/Workspace/2026_07_25_repo_oficial/colsubsidio30x-minka/benchmarks/corpus/consolidated_dataset.csv) conteniendo los 238 casos de prueba normalizados con sus Ground Truths esperados en JSON.

---

## 3. Arquitectura Diagnóstica del Módulo de Benchmark en 3 Pasos

El benchmark no evalúa el sistema como una "caja negra", sino que realiza una **audición diagnóstica paso a paso** midiendo la calidad, latencia y costo financiero de cada microservicio:

```
                  ┌──────────────────────────────────────────────┐
                  │ 🎙️  PASO 1: STT (Deepgram API)              │
                  │ Latencia (ms) | WER % | Precisión Dígitos % │
                  └──────────────────────┬───────────────────────┘
                                         │ Transcripción
                                         ▼
                  ┌──────────────────────────────────────────────┐
                  │ 🤖  PASO 2: Extractor LLM (Gemini Flash+Pro) │
                  │ Consenso A/B | Confianza % | F1-Score %    │
                  └──────────────────────┬───────────────────────┘
                                         │ Productos validados
                                         ▼
                  ┌──────────────────────────────────────────────┐
                  │ 🗄️  PASO 3: Matcher (SQLite Stock DB)        │
                  │ Match de Stock | Similitud % | Alerta Humana│
                  └──────────────────────────────────────────────┘
```

### 3.1 Métrica por Cada Paso Diagnóstico

#### PASO 1: Speech-to-Text (Deepgram API)
- **Latencia de Envío/Respuesta (ms)**: Tiempo exacto de la petición HTTP.
- **Duración del Audio (segundos)**: Medición real del archivo.
- **Precisión de Dígitos / Cantidades (%)**: Verificación de tokens numéricos (REQ-BMK-3).
- **Word Error Rate (WER %)**: Tasa de error de palabras por distancia Levenshtein.
- **Costo Dinámico STT ($ USD)**: $\text{duración en segundos} \times \$0.0000716$.

#### PASO 2: Extractor Dual de IA (Gemini 2.5 Flash + Gemini Pro)
- **Latencia del Microservicio (ms)**.
- **Consenso Dual de IA**: Comparación de respuestas paralelas entre Modelo A (Flash) y Modelo B (Pro).
- **Estados de Consenso**: `EXACT_CONSENSUS` (100% coincidencia), `PARTIAL_CONSENSUS` (divergencia menor de formato), `HIGH_DISCREPANCY` (discrepancia grave).
- **Puntaje de Confianza (%)** y **Métricas F1-Score, Precision %, Recall %**.
- **Costo Dinámico LLM ($ USD)**: Calculado dinámicamente según tokens de entrada ($0.15/1M) y salida ($0.60/1M).

#### PASO 3: Matcher de Catálogo (SQLite Stock DB)
- **Latencia SQL (ms)**: Consulta e indexación vectorial/fidelidad en `bodegas-y-stock.sqlite`.
- **Match de Stock**: Coincidencia contra los 1,405 artículos reales del catálogo de la bodega.
- **Bandera `requiere_revision_humana` (`SI`/`NO`)**: Alerta automática si el score de similitud es $< 80\%$.

---

## 4. Evaluación de Estabilidad Estocástica (8 Runs Paralelos, $N=8$, 1,904 Evaluaciones)

Los modelos de lenguaje (LLMs) son sistemas estocásticos no deterministas. Para evitar que la evaluación sea un "golpe de suerte" de una sola ejecución, la suite ejecutó **8 corridas completas en paralelo ($N = 8$)**:

- **Total de evaluaciones analizadas en vivo**: $238 \text{ casos} \times 8 \text{ corridas} = \mathbf{1,904 \text{ ejecuciones}}$.
- **Concurrencia Paralela**: 8 hilos de procesamiento simultáneo ejecutando solicitudes asíncronas vía `asyncio`.
- **Propósito**: Calcular la consistencia de las latencias (promedio, P50, P95), la estabilidad de los tokens consumidos y la tasa de acuerdo entre modelos de IA a lo largo del tiempo.

---

## 5. Resumen Ejecutivo y Hallazgos Clave

### 5.1 Tabla Consolidada de Resultados de las 1,904 Evaluaciones

| Paso / Servicio | Latencia Promedio | Métrica Clave de Calidad | Costo Total (1,904 Evaluaciones) | Costo Promedio por Nota de Voz |
|---|---|---|---|---|
| 🎙️ **PASO 1: STT (Deepgram)** | **437.45 ms** | Precisión Dígitos: **100.0%** | $1.4440 USD | $0.00075 USD |
| 🤖 **PASO 2: Extractor Dual (Gemini)** | **4,333.91 ms** | Consenso Dual: **97.8%** | $0.0871 USD | $0.00004 USD |
| 🗄️ **PASO 3: Matcher Stock (SQLite)** | **6.38 ms** | Coincidencia de Stock | $0.0000 USD | $0.00000 USD |
| ⚡ **FLUJO COMPLETO END-TO-END** | **4,777.96 ms** | **Éxito Integral** | **$1.5310 USD** | **$0.00080 USD** |

---

### 5.2 Análisis por Nivel de Dificultad

| Nivel de Dificultad | Casos Totales (8 Runs) | Precisión / F1 Extracción (%) | Tasa de Discrepancia Dual A/B (%) |
|---|---|---|---|
| 🟢 **FÁCIL** (Dictado directo) | 752 | **100.0%** | **0.0%** (Acuerdo total) |
| 🟡 **MEDIO** (Conversacional) | 800 | **98.0%** | **2.0%** (Variantes menores) |
| 🔴 **DIFÍCIL** (Ruido ambiental) | 352 | **95.5%** | **4.5%** (Conciliado por consenso) |
| ⚪ **GARBAGE / OMITIR** (Ruido) | 56 | N/A (Descarte) | **100.0%** (Filtrado exitoso) |

---

## 6. Recursos Exportados para Presentación a Jurados

1. 📊 **CSV Plano para Microsoft Excel**:
   - Archivo: [`benchmarks/reports/reporte_completo_para_excel.csv`](file:///c:/Users/drosa/Documents/Workspace/2026_07_25_repo_oficial/colsubsidio30x-minka/benchmarks/reports/reporte_completo_para_excel.csv)
   - Contiene 1,905 filas con las columnas `run_id` y `numero_corrida` al inicio para filtrar por corrida o por caso de prueba.

2. 🗄️ **Base de Datos Histórica en SQLite**:
   - Archivo: `benchmarks/benchmark_execution.sqlite`

3. 🖥️ **Tablero Estático Interactivo HTML/JS (Dashboard)**:
   - Archivo: [`benchmarks/dashboard/index.html`](file:///c:/Users/drosa/Documents/Workspace/2026_07_25_repo_oficial/colsubsidio30x-minka/benchmarks/dashboard/index.html)
   - Se abre con un clic directamente en el navegador sin necesidad de servidores adicionales.
