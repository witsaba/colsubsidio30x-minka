import argparse
import sys
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

load_dotenv()

from inventory_extractor.api.routes import router as api_router

# Inicialización de la aplicación FastAPI
app = FastAPI(
    title="Microservicio REST de Extracción de Inventario por Voz",
    description=(
        "Microservicio de IA que recibe transcripciones de voz (Speech-to-Text) "
        "y devuelve productos estructurados (Producto, Unidad, Cantidad) "
        "mediante Doble Validación por Consenso (Gemini 2.5 Flash + Pro en Vertex AI)."
    ),
    version="0.1.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

# Permitir CORS para comunicación entre microservicios en puertos distintos
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Endpoint de Salud (Health Check)
@app.get("/health", tags=["Salud"])
def health_check():
    return {
        "status": "healthy",
        "service": "inventory-extractor-microservice",
        "version": "0.1.0"
    }

# Incluir las rutas de extracción de inventario
app.include_router(api_router)

def start_server(host: str = "127.0.0.1", port: int = 8003, reload: bool = False):
    print(f"Iniciando Microservicio REST API en http://{host}:{port}")
    print(f"Documentación interactiva Swagger: http://localhost:{port}/docs")
    uvicorn.run("server:app", host=host, port=port, reload=reload)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Punto de entrada del Microservicio REST FastAPI.")
    parser.add_argument("--port", type=int, default=8003, help="Puerto HTTP para el servicio (por defecto: 8003)")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="Host IP para el servicio (por defecto: 127.0.0.1)")
    parser.add_argument("--reload", action="store_true", help="Activar recarga automática en desarrollo")
    
    args = parser.parse_args()
    start_server(host=args.host, port=args.port, reload=args.reload)
