from enum import Enum
from typing import List, Optional
from pydantic import BaseModel, Field


class UnitEnum(str, Enum):
    KILOGRAMO = "KILOGRAMO"
    UNIDAD = "UNIDAD"
    PORCION = "PORCION"
    LITRO = "LITRO"


class ProductItem(BaseModel):
    producto: str = Field(
        ...,
        description="Nombre o descripción limpia del producto en el inventario."
    )
    unidad: UnitEnum = Field(
        ...,
        description="Unidad de medida del producto. Estrictamente una de: KILOGRAMO, UNIDAD, PORCION, LITRO."
    )
    cantidad: float = Field(
        ...,
        description="Cantidad numérica del producto. Debe ser un número mayor a 0."
    )


class InventoryExtraction(BaseModel):
    items: List[ProductItem] = Field(
        default_factory=list,
        description="Lista de productos identificados en la transcripción de voz."
    )


class ItemComparisonStatus(str, Enum):
    MATCH = "MATCH"                           # Coincidencia exacta
    QUANTITY_MISMATCH = "QUANTITY_MISMATCH"   # Mismo producto y unidad, diferente cantidad
    UNIT_MISMATCH = "UNIT_MISMATCH"           # Mismo producto, diferente unidad
    MODEL_A_ONLY = "MODEL_A_ONLY"             # Detectado únicamente por Modelo A
    MODEL_B_ONLY = "MODEL_B_ONLY"             # Detectado únicamente por Modelo B


class ItemComparisonResult(BaseModel):
    producto: str
    status: ItemComparisonStatus
    model_a_item: Optional[ProductItem] = None
    model_b_item: Optional[ProductItem] = None
    final_item: Optional[ProductItem] = None
    notes: Optional[str] = None


class ConsensusStatus(str, Enum):
    EXACT_CONSENSUS = "EXACT_CONSENSUS"       # 100% de coincidencia entre ambos modelos
    PARTIAL_CONSENSUS = "PARTIAL_CONSENSUS"   # Coincidencia parcial (requiere atención mínima)
    HIGH_DISCREPANCY = "HIGH_DISCREPANCY"     # Discrepancia alta entre modelos


class DualValidationResult(BaseModel):
    transcription_input: str
    model_a_name: str
    model_b_name: str
    consensus_status: ConsensusStatus
    confidence_score: float = Field(..., description="Puntaje de confianza global entre 0.0 y 1.0")
    validated_inventory: List[ProductItem] = Field(default_factory=list)
    item_comparisons: List[ItemComparisonResult] = Field(default_factory=list)
    model_a_raw_count: int = 0
    model_b_raw_count: int = 0
