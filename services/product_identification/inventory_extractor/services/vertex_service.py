import os
import sys
from pathlib import Path
from typing import Type, TypeVar, Optional
from google import genai
from google.genai import types
from google.genai.errors import APIError, ClientError
from pydantic import BaseModel

from ..config.settings import (
    GOOGLE_CLOUD_PROJECT,
    GOOGLE_CLOUD_LOCATION,
    DEFAULT_CREDENTIALS_FILE
)

T = TypeVar("T", bound=BaseModel)


class VertexService:
    """
    Cliente centralizado para Vertex AI que gestiona autenticación automática
    mediante credenciales JSON de Google Cloud y generación estructurada.
    """

    def __init__(
        self,
        project: Optional[str] = None,
        location: Optional[str] = None,
        credentials_path: Optional[str] = None
    ):
        self.project = project or GOOGLE_CLOUD_PROJECT
        self.location = location or GOOGLE_CLOUD_LOCATION

        # Cargar credenciales JSON si existen
        cred_file = credentials_path or os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
        if cred_file and Path(cred_file).exists():
            os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(Path(cred_file).resolve())
        elif DEFAULT_CREDENTIALS_FILE.exists():
            os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(DEFAULT_CREDENTIALS_FILE.resolve())
        else:
            # Buscar cualquier archivo .json de cuenta de servicio en el espacio de trabajo
            json_keys = list(Path(".").glob("*.json"))
            for jk in json_keys:
                if "gen-lang-client" in jk.name or "key" in jk.name or "service" in jk.name:
                    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(jk.resolve())
                    break

        try:
            self.client = genai.Client(
                vertexai=True,
                project=self.project,
                location=self.location
            )
        except Exception as e:
            raise RuntimeError(f"Error al inicializar Vertex AI Client ({self.project}, {self.location}): {e}") from e

    def extract_structured(self, prompt: str, schema_cls: Type[T], model_name: str) -> T:
        """
        Envía un prompt a Vertex AI y garantiza la respuesta bajo el esquema Pydantic indicado.
        """
        config = types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=schema_cls,
            temperature=0.0,  # Temperatura 0 para mayor determinismo y rigor
        )

        try:
            response = self.client.models.generate_content(
                model=model_name,
                contents=prompt,
                config=config
            )
        except ClientError as ce:
            raise RuntimeError(f"Error en Vertex AI (Modelo '{model_name}'): {ce}") from ce
        except APIError as ae:
            raise RuntimeError(f"Error de servidor en Vertex AI (Modelo '{model_name}'): {ae}") from ae
        except Exception as ex:
            raise RuntimeError(f"Error inesperado consultando a Vertex AI ({model_name}): {ex}") from ex

        if not response or not response.text:
            raise ValueError(f"El modelo '{model_name}' devolvió una respuesta vacía.")

        return schema_cls.model_validate_json(response.text)
