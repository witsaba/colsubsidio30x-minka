import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent.parent

# Ruta predeterminada del archivo de credenciales de Google Cloud
DEFAULT_CREDENTIALS_FILE = BASE_DIR / "gen-lang-client-0715489298-735dd2d08718.json"

# Nombre del proyecto GCP por defecto
GOOGLE_CLOUD_PROJECT = os.getenv("GOOGLE_CLOUD_PROJECT", "gen-lang-client-0715489298")
GOOGLE_CLOUD_LOCATION = os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1")

# Modelos validados en Vertex AI para la doble validación por consenso
MODEL_A = os.getenv("MODEL_A", "gemini-2.5-flash")
MODEL_B = os.getenv("MODEL_B", "gemini-2.5-pro")

# Unidades permitidas estrictamente
ALLOWED_UNITS = ["KILOGRAMO", "UNIDAD", "PORCION", "LITRO"]
