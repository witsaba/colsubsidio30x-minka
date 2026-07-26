"""SQLite Database and CSV Export Manager for Benchmark Results.

Provides structured storage for multi-run benchmarks and exports flat CSV files
optimized for Microsoft Excel and BI dashboards.
"""

import csv
import json
import sqlite3
import time
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent / "benchmark_execution.sqlite"
CSV_EXCEL_PATH = Path(__file__).resolve().parent / "reports" / "reporte_completo_para_excel.csv"


def init_db(db_path: Path = DB_PATH):
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path) as conn:
        cursor = conn.cursor()

        # 1. Test Runs table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS test_runs (
                run_id TEXT PRIMARY KEY,
                timestamp TEXT NOT NULL,
                total_cases INTEGER NOT NULL,
                num_iterations INTEGER NOT NULL,
                stt_vendor TEXT,
                llm_model_a TEXT,
                llm_model_b TEXT,
                overall_f1_mean REAL,
                overall_discrepancy_rate REAL,
                total_cost_usd REAL
            )
        """)

        # 2. Detailed Test Results per Step table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS test_results_detail (
                result_id TEXT PRIMARY KEY,
                run_id TEXT NOT NULL,
                numero_corrida INTEGER DEFAULT 1,
                composite_id TEXT NOT NULL,
                author TEXT NOT NULL,
                dificultad TEXT NOT NULL,
                acertividad TEXT NOT NULL,
                is_garbage INTEGER NOT NULL,
                
                -- STEP 1: STT
                paso1_latencia_ms REAL,
                paso1_duracion_audio_s REAL,
                paso1_costo_stt_usd REAL,
                paso1_precision_digitos_pct REAL,
                paso1_wer_pct REAL,
                paso1_texto_ref TEXT,
                paso1_texto_stt TEXT,
                
                -- STEP 2: LLM Extraction Dual
                paso2_latencia_ms REAL,
                paso2_salida_modelo_a TEXT,
                paso2_salida_modelo_b TEXT,
                paso2_estado_consenso TEXT,
                paso2_puntaje_confianza_pct REAL,
                paso2_precision_extraccion_pct REAL,
                paso2_recall_extraccion_pct REAL,
                paso2_f1_score_extraccion_pct REAL,
                paso2_input_tokens INTEGER,
                paso2_output_tokens INTEGER,
                paso2_costo_llm_usd REAL,
                
                -- STEP 3: Matcher Catalog
                paso3_latencia_ms REAL,
                paso3_producto_buscado TEXT,
                paso3_producto_coincidencia_stock TEXT,
                paso3_estado_match TEXT,
                paso3_score_similitud_pct REAL,
                paso3_requiere_revision_humana TEXT,
                
                -- E2E Flow
                flujo_latencia_total_ms REAL,
                flujo_costo_total_usd REAL,
                flujo_exito_integral TEXT,
                
                FOREIGN KEY (run_id) REFERENCES test_runs(run_id)
            )
        """)
        
        cursor.execute("PRAGMA table_info(test_results_detail)")
        cols = [col[1] for col in cursor.fetchall()]

        if cols and "numero_corrida" not in cols:
            cursor.execute("ALTER TABLE test_results_detail ADD COLUMN numero_corrida INTEGER DEFAULT 1")
            
        conn.commit()


def save_test_run(run_summary: dict, results_detail: list[dict], db_path: Path = DB_PATH):
    init_db(db_path)
    with sqlite3.connect(db_path) as conn:
        cursor = conn.cursor()

        # Check existing table columns to build dynamic insert
        cursor.execute("PRAGMA table_info(test_results_detail)")
        existing_cols = set(col[1] for col in cursor.fetchall())

        # Insert run summary
        cursor.execute("""
            INSERT OR REPLACE INTO test_runs (
                run_id, timestamp, total_cases, num_iterations,
                stt_vendor, llm_model_a, llm_model_b,
                overall_f1_mean, overall_discrepancy_rate, total_cost_usd
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            run_summary["run_id"],
            run_summary["timestamp"],
            run_summary["total_cases"],
            run_summary["num_iterations"],
            run_summary.get("stt_vendor", "deepgram"),
            run_summary.get("llm_model_a", "gemini-2.5-flash"),
            run_summary.get("llm_model_b", "gemini-pro"),
            run_summary.get("overall_f1_mean", 0.0),
            run_summary.get("overall_discrepancy_rate", 0.0),
            run_summary.get("total_cost_usd", 0.0),
        ))

        # Build insert query dynamically based on existing schema
        col_list = [
            "result_id", "run_id", "composite_id", "author",
            "dificultad", "acertividad", "is_garbage",
            "paso1_latencia_ms", "paso1_duracion_audio_s", "paso1_costo_stt_usd",
            "paso1_precision_digitos_pct", "paso1_wer_pct", "paso1_texto_ref", "paso1_texto_stt",
            "paso2_latencia_ms", "paso2_salida_modelo_a", "paso2_salida_modelo_b",
            "paso2_estado_consenso", "paso2_puntaje_confianza_pct",
            "paso2_precision_extraccion_pct", "paso2_recall_extraccion_pct", "paso2_f1_score_extraccion_pct",
            "paso2_input_tokens", "paso2_output_tokens", "paso2_costo_llm_usd",
            "paso3_latencia_ms", "paso3_producto_buscado", "paso3_producto_coincidencia_stock",
            "paso3_estado_match", "paso3_score_similitud_pct", "paso3_requiere_revision_humana",
            "flujo_latencia_total_ms", "flujo_costo_total_usd", "flujo_exito_integral"
        ]

        if "numero_corrida" in existing_cols:
            col_list.append("numero_corrida")
        if "iteration_number" in existing_cols:
            col_list.append("iteration_number")

        col_names_str = ", ".join(col_list)
        placeholders_str = ", ".join(["?"] * len(col_list))

        query = f"INSERT OR REPLACE INTO test_results_detail ({col_names_str}) VALUES ({placeholders_str})"

        for r in results_detail:
            num_corrida = r.get("numero_corrida") or r.get("iteration_number", 1)
            val_tuple = [
                f"{r['run_id']}_{num_corrida}_{r['composite_id']}",
                r["run_id"],
                r["composite_id"],
                r["author"],
                r["dificultad"],
                r["acertividad"],
                1 if r.get("is_garbage") else 0,

                r.get("paso1_latencia_ms", 0.0),
                r.get("paso1_duracion_audio_s", 0.0),
                r.get("paso1_costo_stt_usd", 0.0),
                r.get("paso1_precision_digitos_pct", 0.0),
                r.get("paso1_wer_pct", 0.0),
                r.get("paso1_texto_ref", ""),
                r.get("paso1_texto_stt", ""),

                r.get("paso2_latencia_ms", 0.0),
                json.dumps(r.get("paso2_salida_modelo_a", []), ensure_ascii=False),
                json.dumps(r.get("paso2_salida_modelo_b", []), ensure_ascii=False),
                r.get("paso2_estado_consenso", "EXACT_CONSENSUS"),
                r.get("paso2_puntaje_confianza_pct", 100.0),
                r.get("paso2_precision_extraccion_pct", 0.0),
                r.get("paso2_recall_extraccion_pct", 0.0),
                r.get("paso2_f1_score_extraccion_pct", 0.0),
                r.get("paso2_input_tokens", 0),
                r.get("paso2_output_tokens", 0),
                r.get("paso2_costo_llm_usd", 0.0),

                r.get("paso3_latencia_ms", 0.0),
                r.get("paso3_producto_buscado", ""),
                r.get("paso3_producto_coincidencia_stock", ""),
                r.get("paso3_estado_match", "OMITIDO"),
                r.get("paso3_score_similitud_pct", 0.0),
                r.get("paso3_requiere_revision_humana", "NO"),

                r.get("flujo_latencia_total_ms", 0.0),
                r.get("flujo_costo_total_usd", 0.0),
                r.get("flujo_exito_integral", "EXITOSO"),
            ]

            if "numero_corrida" in existing_cols:
                val_tuple.append(num_corrida)
            if "iteration_number" in existing_cols:
                val_tuple.append(num_corrida)

            cursor.execute(query, val_tuple)

        conn.commit()

    # Export flat CSV for Excel
    export_flat_csv_for_excel(results_detail, CSV_EXCEL_PATH)


def export_flat_csv_for_excel(results_detail: list[dict], csv_path: Path = CSV_EXCEL_PATH):
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    if not results_detail:
        return

    fieldnames = [
        "run_id",
        "numero_corrida",
        "composite_id",
        "author",
        "dificultad",
        "acertividad",
        "is_garbage",
        "paso1_latencia_ms",
        "paso1_duracion_audio_s",
        "paso1_costo_stt_usd",
        "paso1_precision_digitos_pct",
        "paso1_wer_pct",
        "paso1_texto_ref",
        "paso1_texto_stt",
        "paso2_latencia_ms",
        "paso2_estado_consenso",
        "paso2_puntaje_confianza_pct",
        "paso2_precision_extraccion_pct",
        "paso2_recall_extraccion_pct",
        "paso2_f1_score_extraccion_pct",
        "paso2_input_tokens",
        "paso2_output_tokens",
        "paso2_costo_llm_usd",
        "paso3_latencia_ms",
        "paso3_producto_buscado",
        "paso3_producto_coincidencia_stock",
        "paso3_estado_match",
        "paso3_score_similitud_pct",
        "paso3_requiere_revision_humana",
        "flujo_latencia_total_ms",
        "flujo_costo_total_usd",
        "flujo_exito_integral",
    ]

    with csv_path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(results_detail)

    print(f"SUCCESS: Exported Excel-optimized CSV to: {csv_path}")
