import re
from typing import List, Dict, Tuple
from difflib import SequenceMatcher

from .schemas import (
    ProductItem,
    InventoryExtraction,
    ItemComparisonResult,
    ItemComparisonStatus,
    ConsensusStatus,
    DualValidationResult
)

def normalize_text(text: str) -> str:
    """Normaliza texto eliminando acentos, puntuación y convirtiendo a minúsculas."""
    text = text.lower().strip()
    text = re.sub(r'[áàäâ]', 'a', text)
    text = re.sub(r'[éèëê]', 'e', text)
    text = re.sub(r'[íìïî]', 'i', text)
    text = re.sub(r'[óòöô]', 'o', text)
    text = re.sub(r'[úùüû]', 'u', text)
    text = re.sub(r'ñ', 'n', text)
    text = re.sub(r'[^a-z0-9\s]', '', text)
    return text

def is_similar_product(name_a: str, name_b: str, threshold: float = 0.82) -> bool:
    """Determina si dos nombres de productos son similares mediante similitud de cadenas."""
    norm_a = normalize_text(name_a)
    norm_b = normalize_text(name_b)

    if norm_a == norm_b:
        return True

    # Si uno es subcadena exacta del otro (ej. "harina de trigo" vs "harina")
    if norm_a in norm_b or norm_b in norm_a:
        return True

    ratio = SequenceMatcher(None, norm_a, norm_b).ratio()
    return ratio >= threshold


class ConsensusEngine:
    """
    Motor de Consenso para comparar las respuestas estructuradas de dos modelos de IA
    y calcular el grado de acuerdo y consistencia.
    """

    @staticmethod
    def compare_extractions(
        transcription: str,
        extraction_a: InventoryExtraction,
        extraction_b: InventoryExtraction,
        model_a_name: str,
        model_b_name: str
    ) -> DualValidationResult:
        
        items_a = extraction_a.items
        items_b = extraction_b.items

        matched_b_indices = set()
        comparisons: List[ItemComparisonResult] = []
        validated_inventory: List[ProductItem] = []

        # 1. Comparar items de Modelo A contra Modelo B
        for item_a in items_a:
            best_b_idx = None
            best_similarity = 0.0

            for idx_b, item_b in enumerate(items_b):
                if idx_b in matched_b_indices:
                    continue
                if is_similar_product(item_a.producto, item_b.producto):
                    ratio = SequenceMatcher(None, normalize_text(item_a.producto), normalize_text(item_b.producto)).ratio()
                    if ratio >= best_similarity:
                        best_similarity = ratio
                        best_b_idx = idx_b

            if best_b_idx is not None:
                matched_b_indices.add(best_b_idx)
                item_b = items_b[best_b_idx]

                # Comparar atributos
                unit_match = (item_a.unidad == item_b.unidad)
                qty_match = abs(item_a.cantidad - item_b.cantidad) < 0.001

                if unit_match and qty_match:
                    status = ItemComparisonStatus.MATCH
                    final_item = item_a  # Coincidencia perfecta
                    notes = "Coincidencia exacta de producto, unidad y cantidad entre ambos modelos."
                elif unit_match and not qty_match:
                    status = ItemComparisonStatus.QUANTITY_MISMATCH
                    # Usar Modelo A pero señalar nota
                    final_item = item_a
                    notes = f"Diferencia de cantidad: Modelo A = {item_a.cantidad}, Modelo B = {item_b.cantidad}"
                elif not unit_match and qty_match:
                    status = ItemComparisonStatus.UNIT_MISMATCH
                    final_item = item_a
                    notes = f"Diferencia de unidad: Modelo A = {item_a.unidad}, Modelo B = {item_b.unidad}"
                else:
                    status = ItemComparisonStatus.QUANTITY_MISMATCH
                    final_item = item_a
                    notes = f"Diferencias en unidad y cantidad. A: ({item_a.cantidad} {item_a.unidad}) vs B: ({item_b.cantidad} {item_b.unidad})"

                comparisons.append(ItemComparisonResult(
                    producto=item_a.producto,
                    status=status,
                    model_a_item=item_a,
                    model_b_item=item_b,
                    final_item=final_item,
                    notes=notes
                ))
                validated_inventory.append(final_item)
            else:
                # Solo en Modelo A
                comparisons.append(ItemComparisonResult(
                    producto=item_a.producto,
                    status=ItemComparisonStatus.MODEL_A_ONLY,
                    model_a_item=item_a,
                    model_b_item=None,
                    final_item=item_a,
                    notes="Detectado únicamente por Modelo A."
                ))
                validated_inventory.append(item_a)

        # 2. Agregar los items de Modelo B que no se emparejaron
        for idx_b, item_b in enumerate(items_b):
            if idx_b not in matched_b_indices:
                comparisons.append(ItemComparisonResult(
                    producto=item_b.producto,
                    status=ItemComparisonStatus.MODEL_B_ONLY,
                    model_a_item=None,
                    model_b_item=item_b,
                    final_item=item_b,
                    notes="Detectado únicamente por Modelo B."
                ))
                validated_inventory.append(item_b)

        # 3. Calcular puntaje de confianza global (Confidence Score)
        total_unique = len(comparisons)
        if total_unique == 0:
            confidence = 1.0
            consensus_status = ConsensusStatus.EXACT_CONSENSUS
        else:
            match_count = sum(1 for c in comparisons if c.status == ItemComparisonStatus.MATCH)
            partial_qty_count = sum(1 for c in comparisons if c.status == ItemComparisonStatus.QUANTITY_MISMATCH)
            partial_unit_count = sum(1 for c in comparisons if c.status == ItemComparisonStatus.UNIT_MISMATCH)

            weighted_score = (match_count * 1.0) + (partial_qty_count * 0.6) + (partial_unit_count * 0.4)
            confidence = round(weighted_score / total_unique, 2)

            if confidence >= 0.95:
                consensus_status = ConsensusStatus.EXACT_CONSENSUS
            elif confidence >= 0.70:
                consensus_status = ConsensusStatus.PARTIAL_CONSENSUS
            else:
                consensus_status = ConsensusStatus.HIGH_DISCREPANCY

        return DualValidationResult(
            transcription_input=transcription,
            model_a_name=model_a_name,
            model_b_name=model_b_name,
            consensus_status=consensus_status,
            confidence_score=confidence,
            validated_inventory=validated_inventory,
            item_comparisons=comparisons,
            model_a_raw_count=len(items_a),
            model_b_raw_count=len(items_b)
        )
