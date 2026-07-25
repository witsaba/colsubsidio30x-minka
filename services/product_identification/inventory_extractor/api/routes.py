from typing import List, Optional
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from ..models.schemas import ProductItem, DualValidationResult, ConsensusStatus, ItemComparisonResult
from ..services.extractor_service import DualModelInventoryExtractor

router = APIRouter(prefix="/api/v1", tags=["Inventory Extraction Microservice"])

# Instancia global del extractor
_extractor_instance: Optional[DualModelInventoryExtractor] = None

def get_extractor() -> DualModelInventoryExtractor:
    global _extractor_instance
    if _extractor_instance is None:
        _extractor_instance = DualModelInventoryExtractor()
    return _extractor_instance


class ExtractionRequest(BaseModel):
    transcription: str = Field(
        ...,
        min_length=3,
        description="Texto transcrito por el módulo Voice-to-Text para extraer productos de inventario.",
        json_schema_extra={"example": "Llegaron 15 kilogramos de arroz, 8 litros de aceite de girasol y 25 unidades de huevos."}
    )


class ExtractionResponse(BaseModel):
    status: str = Field(default="success", description="Estado de la respuesta HTTP del microservicio.")
    consensus_status: ConsensusStatus = Field(..., description="Estatus de concordancia entre los modelos A y B.")
    confidence_score: float = Field(..., description="Puntaje de confianza entre 0.0 y 1.0.")
    validated_inventory: List[ProductItem] = Field(default_factory=list, description="Lista final de productos validados.")
    item_comparisons: List[ItemComparisonResult] = Field(default_factory=list, description="Desglose detallado del consenso.")
    model_a_name: str
    model_b_name: str


@router.post(
    "/extract",
    response_model=ExtractionResponse,
    status_code=status.HTTP_200_OK,
    summary="Extraer Productos de Transcripción de Voz",
    description="Procesa un texto de voz aplicando Doble Validación por Consenso (Gemini 2.5 Flash + Pro en Vertex AI) y devuelve productos con unidad restringida."
)
def extract_inventory_endpoint(request: ExtractionRequest):
    if not request.transcription.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La transcripción recibida está vacía."
        )

    try:
        extractor = get_extractor()
        result: DualValidationResult = extractor.extract_from_text(request.transcription)

        return ExtractionResponse(
            status="success",
            consensus_status=result.consensus_status,
            confidence_score=result.confidence_score,
            validated_inventory=result.validated_inventory,
            item_comparisons=result.item_comparisons,
            model_a_name=result.model_a_name,
            model_b_name=result.model_b_name
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error durante el procesamiento en Vertex AI: {str(e)}"
        )
