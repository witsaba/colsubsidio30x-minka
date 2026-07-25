# Module 2 — Product Identification & Voice Inventory Extraction Service
FROM python:3.11-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1

COPY services/product_identification/pyproject.toml ./pyproject.toml
COPY services/product_identification/ ./

RUN pip install --no-cache-dir -e .

EXPOSE 8003
CMD ["python", "server.py", "--host", "0.0.0.0", "--port", "8003"]
