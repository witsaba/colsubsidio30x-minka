import sys
import requests
import json
import time

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

def test_microservice_call(port: int = 8003):
    base_url = f"http://127.0.0.1:{port}"
    
    print("--- PRUEBA DE CLIENTE HTTP PARA MICROSERVICIO DE EXTRACCIÓN ---")
    
    # 1. Test Health Endpoint
    print("\n1. Probando GET /health...")
    try:
        r_health = requests.get(f"{base_url}/health")
        print(f"✅ Respuesta Health ({r_health.status_code}): {r_health.json()}")
    except Exception as e:
        print(f"❌ Error conectando a /health: {e}")
        return

    # 2. Test Extract Endpoint
    print("\n2. Probando POST /api/v1/extract...")
    payload = {
        "transcription": "Registremos 15 kilogramos de arroz, 8 litros de aceite de girasol y 25 unidades de huevos."
    }
    
    try:
        t0 = time.time()
        r_extract = requests.post(
            f"{base_url}/api/v1/extract",
            json=payload,
            headers={"Content-Type": "application/json"}
        )
        elapsed = round(time.time() - t0, 2)
        
        print(f"✅ Respuesta API HTTP {r_extract.status_code} ({elapsed}s):")
        print(json.dumps(r_extract.json(), indent=2, ensure_ascii=False))
    except Exception as e:
        print(f"❌ Error conectando a /api/v1/extract: {e}")

if __name__ == "__main__":
    test_microservice_call()
