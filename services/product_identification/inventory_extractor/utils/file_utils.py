import json
from pathlib import Path
from typing import Dict, Any, Union
from ..models.schemas import DualValidationResult


def save_json(data: Union[Dict[str, Any], list], file_path: Union[str, Path]) -> Path:
    """Guarda un diccionario o lista en formato JSON con codificación UTF-8 e sangrado."""
    path = Path(file_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    return path


def load_json(file_path: Union[str, Path]) -> Any:
    """Carga un archivo JSON desde el disco."""
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"El archivo '{file_path}' no existe.")
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def export_dual_validation_result(
    result: DualValidationResult,
    file_name: str = "inventory_result",
    output_dir: Union[str, Path] = "output"
) -> Path:
    """Exporta el resultado de la doble validación a un archivo JSON en la carpeta output."""
    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    
    out_path = out_dir / f"{file_name}.json"
    result_dict = result.model_dump()
    save_json(result_dict, out_path)
    return out_path
