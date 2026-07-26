# Catálogo de Scripts Utilitarios e Infraestructura

Este directorio contiene las herramientas de ingesta, auditoría, construcción de bases de datos y verificación de infraestructura para la suite de benchmarking del sistema de inventario por voz.

---

## 📋 Clasificación de Scripts

### 1. Ingesta y Auditoría del Corpus de Voz (Google Drive API)
- 📥 **`ingest_drive_dataset.py`**:
  - **Propósito**: Conecta mediante Service Account a la API de Google Drive, procesa la paginación recursiva de los 238 clips de voz de Adriana y Daniel, descarga los archivos `.mp4` y `.ogg`, normaliza el texto (MAYÚSCULAS, sin tildes, sin puntuación) y genera el archivo consolidado [`benchmarks/corpus/consolidated_dataset.csv`](file:///c:/Users/drosa/Documents/Workspace/2026_07_25_repo_oficial/colsubsidio30x-minka/benchmarks/corpus/consolidated_dataset.csv).
  - **Ejecución**: `python -m uv run python scripts/ingest_drive_dataset.py`

- 🔍 **`audit_drive_files.py`**:
  - **Propósito**: Audita de forma recursiva la totalidad de los archivos de audio e identidades únicas en las hojas de cálculo Google Sheets `BD_AUDIOS` de la carpeta compartida en Drive.
  - **Ejecución**: `python -m uv run python scripts/audit_drive_files.py`

- 🔑 **`test_drive_access.py`** / **`inspect_team_folders.py`**:
  - **Propósito**: Verificadores ligeros de credenciales `key-gcp.json` y exploración de permisos en las carpetas de equipo.
  - **Ejecución**: `python -m uv run python scripts/test_drive_access.py`

---

### 2. Generación de Base de Datos de Stock
- 🗄️ **`build_bodegas_sqlite.py`**:
  - **Propósito**: Lee el catálogo maestro de stock en CSV e ingesta la base de datos relacional SQLite de stock [`data/bodegas-y-stock.sqlite`](file:///c:/Users/drosa/Documents/Workspace/2026_07_25_repo_oficial/colsubsidio30x-minka/data/bodegas-y-stock.sqlite) utilizada por el microservicio Matcher (Puerto 8002).
  - **Ejecución**: `python -m uv run python scripts/build_bodegas_sqlite.py`

---

### 3. Infraestructura y Despliegue
- ⚙️ **`setup-env.sh`**: Script para inicialización interactiva de variables de entorno `.env` en entornos Linux/WSL.
- 🚀 **`smoke-compose.sh`**: Pruebas de humo de conectividad entre contenedores Docker.
