import concurrent.futures
from typing import Optional

from ..config.settings import MODEL_A, MODEL_B
from ..models.schemas import InventoryExtraction, DualValidationResult
from ..models.validator import ConsensusEngine
from .vertex_service import VertexService


SYSTEM_PROMPT = """Eres un asistente de Inteligencia Artificial especializado en inventarios y control de stock a partir de transcripciones de voz (Voice-to-Text).

REGLAS ESTRICTAS DE EXTRACCIÓN DE PRODUCTOS:
1. Extrae cada producto mencionado en el texto con exactamente TRES campos:
   - "producto": Nombre limpio y descriptivo del producto (ej: "Arroz blanco", "Leche entera", "Manzanas rojas").
   - "unidad": Unidad de medida del producto. DEBE SER ESTRICTAMENTE UNO DE LOS SIGUIENTES 4 VALORES EN MAYÚSCULAS:
     * KILOGRAMO (para kilos, kg, gramos o peso en general)
     * UNIDAD (para piezas, unidades, cajas, paquetes, sacos, botellas, latas, etc.)
     * PORCION (para porciones, platos, raciones, servidas)
     * LITRO (para litros, mililitros o volumen de líquidos)
     Cualquier otra unidad implícita en la voz DEBE mapearse a uno de estos 4 valores permitidos.
   - "cantidad": Valor numérico positivo (entero o decimal) de la cantidad contada.

2. Si en la transcripción de voz se mencionan cantidades con palabras (ej: "diez", "media docena", "un kilo y medio"), conviértelas al valor numérico correspondiente (ej: 10, 6, 1.5).
3. No inventes información. Extrae únicamente lo expresado en la transcripción.

TRANSCRIPCIÓN DE VOZ A ANALIZAR:
\"\"\"
{transcription}
\"\"\"
"""


class DualModelInventoryExtractor:
    """
    Servicio principal que coordina la extracción de productos mediante dos modelos de Gemini
    en Vertex AI y ejecuta la validación por consenso.
    """

    def __init__(
        self,
        model_a: str = MODEL_A,
        model_b: str = MODEL_B,
        vertex_service: Optional[VertexService] = None
    ):
        self.model_a = model_a
        self.model_b = model_b
        self.vertex_service = vertex_service or VertexService()

    def extract_from_text(self, transcription: str) -> DualValidationResult:
        """
        Ejecuta la extracción de inventario enviando la transcripción a ambos modelos (A y B)
        de manera concurrente y calcula el consenso unificado.
        """
        prompt = SYSTEM_PROMPT.format(transcription=transcription.strip())

        # Ejecución concurrente en ambos modelos para maximizar velocidad
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            future_a = executor.submit(
                self.vertex_service.extract_structured,
                prompt=prompt,
                schema_cls=InventoryExtraction,
                model_name=self.model_a
            )
            future_b = executor.submit(
                self.vertex_service.extract_structured,
                prompt=prompt,
                schema_cls=InventoryExtraction,
                model_name=self.model_b
            )

            extraction_a = future_a.result()
            extraction_b = future_b.result()

        # Comparar y validar mediante el motor de consenso
        consensus_result = ConsensusEngine.compare_extractions(
            transcription=transcription,
            extraction_a=extraction_a,
            extraction_b=extraction_b,
            model_a_name=self.model_a,
            model_b_name=self.model_b
        )

        return consensus_result
