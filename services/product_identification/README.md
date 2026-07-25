# 🎙 Microservicio de Identificación de Productos (Módulo 2)

Microservicio en Python/FastAPI para la extracción estructurada de productos (Producto, Unidad, Cantidad) a partir de transcripciones de voz utilizando **Doble Validación por Consenso (Gemini 2.5 Flash / Pro en Vertex AI)**.

Runs on **Puerto HTTP 8003**.

---

## 🚀 Inicio Rápido

### 1. Variables de Entorno (`.env`)
Copia `.env.example` a `.env` y configura tus credenciales de Google Cloud / Vertex AI:

```env
USE_VERTEX_AI=true
GOOGLE_CLOUD_PROJECT=tu-id-de-proyecto-gcp
GOOGLE_CLOUD_LOCATION=us-central1
GOOGLE_APPLICATION_CREDENTIALS=gen-lang-client-0715489298-735dd2d08718.json
```

### 2. Iniciar Servidor FastAPI (Puerto 8003)

```bash
# Desde la raíz del proyecto
uv run python services/product_identification/server.py --port 8003
```

Documentación interactiva Swagger: `http://localhost:8003/docs`

---

## 🐳 Docker & Docker Compose

```bash
# Iniciar con Docker Compose, desde la raíz del repositorio.
# El archivo raíz docker-compose.yml es la única superficie de despliegue:
# el compose local de este servicio ya no existe.
docker compose up --build product_identification
```

---

## 🧪 Pruebas y Benchmark

La suite de pruebas externas y benchmark de consistencia se encuentra ubicada en `tests/product_identification/`:

```bash
# Ejecutar suite de benchmark de 20 casos
uv run python tests/product_identification/test_inventory_extraction.py

# Ejecutar cliente HTTP de prueba contra el microservicio
uv run python tests/product_identification/test_api_client.py --port 8003
```
