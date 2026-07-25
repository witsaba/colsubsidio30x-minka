import os
import sys
import json
from pathlib import Path
from dotenv import load_dotenv

from rich.console import Console
from rich.panel import Panel
from rich.prompt import Prompt, Confirm
from rich.syntax import Syntax
from rich.table import Table

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

load_dotenv()

SERVICE_DIR = Path(__file__).resolve().parent
REPO_ROOT = SERVICE_DIR.parent.parent

if str(SERVICE_DIR) not in sys.path:
    sys.path.insert(0, str(SERVICE_DIR))
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from inventory_extractor import DualModelInventoryExtractor
from inventory_extractor.utils import export_dual_validation_result
from tests.product_identification.test_inventory_extraction import run_benchmark_suite

console = Console()


def display_header():
    console.print(Panel.fit(
        "[bold cyan]🎙 Módulo de Extracción de Inventario de Voz (Doble Validación Gemini)[/bold cyan]\n"
        "[dim]Transforma transcripciones de voz a JSON estructurado (Producto, Unidad, Cantidad)[/dim]\n"
        "[dim white]Unidades Permitidas: [bold green]KILOGRAMO | UNIDAD | PORCION | LITRO[/bold green][/dim white]",
        border_style="magenta"
    ))


def process_voice_paragraph(extractor: DualModelInventoryExtractor):
    console.print("\n[bold green]Ingresa o pega la transcripción de voz a procesar (escribe END en una línea nueva al finalizar):[/bold green]")
    lines = []
    while True:
        try:
            line = input()
            if line.strip() == "END":
                break
            lines.append(line)
        except EOFError:
            break

    transcription = "\n".join(lines).strip()
    if not transcription:
        console.print("[bold red]⚠ No ingresaste ningún texto de voz.[/bold red]")
        return

    console.print(f"\n[bold yellow]⏳ Ejecutando doble validación paralela en Vertex AI con [cyan]{extractor.model_a}[/cyan] y [cyan]{extractor.model_b}[/cyan]...[/bold yellow]")
    try:
        result = extractor.extract_from_text(transcription)

        console.print(f"\n[bold green]✨ Proceso Completado. Estatus de Consenso: [bold magenta]{result.consensus_status.value}[/bold magenta] (Confianza: {result.confidence_score * 100:.0f}%)[/bold green]\n")

        # Mostrar tabla estilizada de inventario validado
        table = Table(title="Inventario Validado Extraído", border_style="green")
        table.add_column("#", justify="center", style="bold white")
        table.add_column("Producto", style="bold yellow")
        table.add_column("Unidad", style="bold cyan", justify="center")
        table.add_column("Cantidad", style="bold green", justify="right")

        for idx, item in enumerate(result.validated_inventory, 1):
            table.add_row(str(idx), item.producto, item.unidad.value, str(item.cantidad))

        console.print(table)

        # Mostrar JSON Completo
        json_output = result.model_dump_json(indent=2)
        console.print("\n[bold cyan]📄 Salida JSON Estructurada Completa:[/bold cyan]")
        console.print(Syntax(json_output, "json", theme="monokai", line_numbers=True))

        if Confirm.ask("\n¿Deseas exportar esta validación a un archivo JSON?", default=True):
            out_path = export_dual_validation_result(result, file_name="inventario_extraido_voz")
            console.print(f"[bold green]✔ Guardado exitosamente en:[/bold green] [cyan]{out_path}[/cyan]")

    except Exception as e:
        console.print(f"[bold red]❌ Error durante la extracción:[/bold red] {e}")


def main():
    display_header()

    try:
        extractor = DualModelInventoryExtractor()
        console.print(f"[dim white]Plataforma:[/dim white] [green]{extractor.vertex_service.location} ({extractor.vertex_service.project})[/green]")
        console.print(f"[dim white]Modelo A:[/dim white] [bold cyan]{extractor.model_a}[/bold cyan] | [dim white]Modelo B:[/dim white] [bold cyan]{extractor.model_b}[/bold cyan]")
    except Exception as e:
        console.print(f"[bold red]❌ Error inicializando cliente Vertex AI:[/bold red] {e}")
        sys.exit(1)

    while True:
        console.print("\n[bold yellow]Menú Principal del Módulo de Inventario:[/bold yellow]")
        console.print(" 1. 🎙 Procesar Transcripción de Voz (Texto directo)")
        console.print(" 2. 🧪 Ejecutar Benchmark de 20 Casos de Prueba (Evaluación de Consistencia)")
        console.print(" 3. ❌ Salir")

        choice = Prompt.ask("\nSelecciona una opción", choices=["1", "2", "3"], default="1")

        if choice == "1":
            process_voice_paragraph(extractor)
        elif choice == "2":
            run_benchmark_suite()
        elif choice == "3":
            console.print("\n[bold magenta]¡Hasta luego! 👋[/bold magenta]")
            break


if __name__ == "__main__":
    main()
