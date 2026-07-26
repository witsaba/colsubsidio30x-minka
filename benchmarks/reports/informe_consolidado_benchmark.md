# Informe Estadístico Diagnóstico de Pruebas de Inventario

**Fecha de Ejecución**: 2026-07-26 09:05:03  
**Run ID**: `run_20260726_084433_08a1a2bb`  
**Total de Casos Evaluados**: 1904 (Iteraciones: 8)  
**Modo**: EJECUCIÓN EN VIVO DE SERVICIOS HTTP

---

## 1. Resumen Diagnóstico Paso a Paso (Latencias y Costos Dinámicos)

| Paso / Servicio | Latencia Prom. (ms) | Métrica Clave de Calidad | Costo Real USD (1904 Evaluaciones) |
|---|---|---|---|
| **PASO 1: STT Speech-to-Text (Deepgram)** | 437.45 ms | Precisión Dígitos: 100.0% | $1.4440 USD |
| **PASO 2: Extractor LLM (Gemini Dual)** | 4333.91 ms | F1-Score Extracción: 0.0% | $0.0871 USD |
| **PASO 3: Matcher de Catálogo (SQLite)** | 6.38 ms | Tasa de Match Correcto | $0.0000 USD (Local DB) |
| **FLUJO COMPLETO END-TO-END** | **4777.96 ms** | **Éxito Integral** | **$1.5310 USD** |

---

## 2. Análisis por Nivel de Dificultad y Estabilidad de IA

| Nivel de Dificultad | Casos Totales | Precisión/F1 Extracción (%) | Tasa de Discrepancia Dual A/B (%) |
|---|---|---|---|
| **FÁCIL** (Dictado directo) | 752 | 0.0% | 0.0% |
| **MEDIO** (Contexto conversacional) | 800 | 3.0% | 2.0% |
| **DIFÍCIL** (Ruido de fondo) | 352 | 6.82% | 4.5% |
| **OMITIR / GARBAGE** (Ruido sin inventario) | 56 | N/A (Descarte) | Filtrado Exitoso: 100% |

---

## 3. Exportación de Resultados para Excel y Jurados

Los resultados al máximo detalle por cada paso han sido exportados a:  
📊 [`benchmarks/reports/reporte_completo_para_excel.csv`](file:///C:/Users/drosa/Documents/Workspace/2026_07_25_repo_oficial/colsubsidio30x-minka/benchmarks/reports/reporte_completo_para_excel.csv)  
🗄️ Base de datos histórica SQLite: `benchmarks/benchmark_execution.sqlite`
