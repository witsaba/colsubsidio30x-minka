import os
import sys
import json
import time
from pathlib import Path
from dotenv import load_dotenv

from rich.console import Console
from rich.table import Table
from rich.panel import Panel

# Agregar la raíz del proyecto y la carpeta del servicio al sys.path
TEST_DIR = Path(__file__).resolve().parent
REPO_ROOT = TEST_DIR.parent.parent
SERVICE_DIR = REPO_ROOT / "services" / "product_identification"

if str(SERVICE_DIR) not in sys.path:
    sys.path.insert(0, str(SERVICE_DIR))
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

load_dotenv(SERVICE_DIR / ".env")
load_dotenv()

from inventory_extractor import DualModelInventoryExtractor, ConsensusStatus
from inventory_extractor.utils import save_json, load_json

console = Console()


def run_benchmark_suite(cases_file: str = None):
    console.print(Panel.fit(
        "[bold cyan]🧪 SUITE DE PRUEBAS DE CONSISTENCIA Y DOBLE VALIDACIÓN (20 CASOS)[/bold cyan]\n"
        "[dim]Evaluando extracción de inventario por voz con Gemini en Vertex AI[/dim]",
        border_style="magenta"
    ))

    test_cases_path = Path(cases_file) if cases_file else TEST_DIR / "test_cases.json"
    if not test_cases_path.exists():
        console.print(f"[bold red]❌ No se encontró el archivo de casos de prueba: {test_cases_path}[/bold red]")
        sys.exit(1)

    test_cases = load_json(test_cases_path)
    console.print(f"[bold green]Se cargaron {len(test_cases)} casos de prueba.[/bold green]\n")

    try:
        extractor = DualModelInventoryExtractor()
    except Exception as e:
        console.print(f"[bold red]❌ Error inicializando el extractor:[/bold red] {e}")
        sys.exit(1)

    results_summary = []
    total_score = 0.0
    passed_cases = 0
    start_time = time.time()

    table = Table(title="Resultados del Benchmark (20 Casos de Voz)", border_style="cyan")
    table.add_column("ID", style="bold white", justify="center")
    table.add_column("Caso de Prueba", style="bold yellow")
    table.add_column("Ítems Extratidos", style="bold cyan", justify="center")
    table.add_column("Consenso", style="bold green", justify="center")
    table.add_column("Score Confianza", style="bold magenta", justify="center")
    table.add_column("Tiempo (s)", style="dim white", justify="center")

    for test_case in test_cases:
        case_id = test_case["id"]
        case_name = test_case["name"]
        transcription = test_case["transcription"]

        console.print(f"[bold yellow]▶ Ejecutando Caso #{case_id}: {case_name}...[/bold yellow]")
        t0 = time.time()

        try:
            val_result = extractor.extract_from_text(transcription)
            elapsed = round(time.time() - t0, 2)

            score = val_result.confidence_score
            total_score += score
            items_count = len(val_result.validated_inventory)

            if score >= 0.70 and items_count >= test_case.get("expected_min_items", 1):
                passed_cases += 1
                status_colored = f"[green]{val_result.consensus_status.value}[/green]"
            else:
                status_colored = f"[yellow]{val_result.consensus_status.value}[/yellow]"

            table.add_row(
                str(case_id),
                case_name,
                str(items_count),
                status_colored,
                f"{score * 100:.0f}%",
                f"{elapsed}s"
            )

            results_summary.append({
                "case_id": case_id,
                "case_name": case_name,
                "transcription": transcription,
                "confidence_score": score,
                "consensus_status": val_result.consensus_status.value,
                "elapsed_seconds": elapsed,
                "items_count": items_count,
                "result_detail": val_result.model_dump()
            })

        except Exception as e:
            elapsed = round(time.time() - t0, 2)
            console.print(f"[bold red]❌ Error en Caso #{case_id}:[/bold red] {e}")
            table.add_row(str(case_id), case_name, "0", "[red]ERROR[/red]", "0%", f"{elapsed}s")
            results_summary.append({
                "case_id": case_id,
                "case_name": case_name,
                "error": str(e),
                "elapsed_seconds": elapsed
            })

    total_elapsed = round(time.time() - start_time, 2)
    avg_score = round(total_score / len(test_cases), 2) if test_cases else 0.0

    console.print("\n")
    console.print(table)

    summary_panel = Panel.fit(
        f"[bold white]📊 RESUMEN FINAL DEL BENCHMARK[/bold white]\n\n"
        f"• Total de Casos Evaluados: [bold cyan]{len(test_cases)}[/bold cyan]\n"
        f"• Casos Aprobados (Consenso >= 70%): [bold green]{passed_cases} / {len(test_cases)}[/bold green]\n"
        f"• Puntaje de Consistencia Promedio: [bold magenta]{avg_score * 100:.1f}%[/bold magenta]\n"
        f"• Tiempo Total de Ejecución: [bold yellow]{total_elapsed} segundos[/bold yellow]",
        border_style="green" if passed_cases == len(test_cases) else "yellow"
    )
    console.print(summary_panel)

    # Guardar reporte en output/benchmark_results.json
    out_dir = SERVICE_DIR / "output"
    out_dir.mkdir(exist_ok=True)
    out_report = out_dir / "benchmark_20_cases_result.json"
    save_json({
        "summary": {
            "total_cases": len(test_cases),
            "passed_cases": passed_cases,
            "average_confidence_score": avg_score,
            "total_elapsed_seconds": total_elapsed,
            "model_a": extractor.model_a,
            "model_b": extractor.model_b
        },
        "details": results_summary
    }, out_report)

    console.print(f"\n[bold green]✔ Reporte completo guardado en:[/bold green] [cyan]{out_report}[/cyan]")


if __name__ == "__main__":
    run_benchmark_suite()
