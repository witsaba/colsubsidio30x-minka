"""Ingest and consolidate Google Drive datasets from Adriana and Daniel.

This script:
1. Reads Google Sheets (BD_AUDIOS) for Adriana and Daniel.
2. Downloads voice note clips from NOTAS_VOZ (handling Google Drive pagination) into benchmarks/corpus/audios/.
3. Creates composite IDs (e.g. adriana_1, daniel_6).
4. Normalizes transcript text (UPPERCASE, unaccent, punctuation cleanup).
5. Exports benchmarks/corpus/consolidated_dataset.csv.
"""

import csv
import io
import json
import re
import unicodedata
from pathlib import Path

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload

KEY_PATH = Path("key-gcp.json")
SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]

OUTPUT_DIR = Path("benchmarks/corpus")
AUDIOS_DIR = OUTPUT_DIR / "audios"
CONSOLIDATED_CSV = OUTPUT_DIR / "consolidated_dataset.csv"

PARTICIPANTS = {
    "adriana": {
        "folder_id": "16M6cI1oUQGRjY62sRCCoD1kdW1aF-80h",
    },
    "daniel": {
        "folder_id": "1nVPywA2U4m55fMFV1-QVeU4lyLwgssib",
    },
}

_PUNCTUATION = re.compile(r"[^\w\s]", flags=re.UNICODE)


def normalise_text(text: str) -> str:
    """Uppercase, unaccent, clean punctuation and extra spaces."""
    if not text:
        return ""
    decomposed = unicodedata.normalize("NFKD", text)
    unaccented = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    cleaned = _PUNCTUATION.sub(" ", unaccented.upper())
    return " ".join(cleaned.split())


def get_drive_service():
    creds = service_account.Credentials.from_service_account_file(
        str(KEY_PATH), scopes=SCOPES
    )
    return build("drive", "v3", credentials=creds)


def list_folder_contents_paginated(service, folder_id):
    """Retrieve ALL files in folder handling Drive API pagination."""
    all_files = []
    page_token = None
    while True:
        res = (
            service.files()
            .list(
                q=f"'{folder_id}' in parents and trashed = false",
                fields="nextPageToken, files(id, name, mimeType)",
                pageSize=1000,
                pageToken=page_token,
            )
            .execute()
        )
        all_files.extend(res.get("files", []))
        page_token = res.get("nextPageToken")
        if not page_token:
            break
    return all_files


def list_all_files_recursive(service, folder_id):
    """Retrieve all files recursively inside folder tree."""
    results = []
    files = list_folder_contents_paginated(service, folder_id)
    for f in files:
        results.append(f)
        if f["mimeType"] == "application/vnd.google-apps.folder":
            results.extend(list_all_files_recursive(service, f["id"]))
    return results


def download_file(service, file_id, dest_path: Path):
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    request = service.files().get_media(fileId=file_id)
    with open(dest_path, "wb") as fh:
        downloader = MediaIoBaseDownload(fh, request)
        done = False
        while not done:
            status, done = downloader.next_chunk()


def download_sheet_csv(service, spreadsheet_id) -> str:
    request = service.files().export_media(
        fileId=spreadsheet_id, mimeType="text/csv"
    )
    fh = io.BytesIO()
    downloader = MediaIoBaseDownload(fh, request)
    done = False
    while not done:
        status, done = downloader.next_chunk()
    return fh.getvalue().decode("utf-8")


def main():
    print("Starting dataset ingestion from Google Drive (with pagination & recursive search)...")
    service = get_drive_service()

    AUDIOS_DIR.mkdir(parents=True, exist_ok=True)
    consolidated_rows = []

    for author, info in PARTICIPANTS.items():
        print(f"\n--- Ingesting data for: {author.upper()} ---")
        top_items = list_folder_contents_paginated(service, info["folder_id"])

        sheet_id = None
        for item in top_items:
            name = item["name"]
            mime = item["mimeType"]
            if mime == "application/vnd.google-apps.spreadsheet" or "BD_AUDIOS" in name:
                sheet_id = item["id"]

        if not sheet_id:
            print(f"ERROR: Could not find spreadsheet for {author}")
            continue

        # Download spreadsheet CSV
        print(f"Downloading sheet for {author}...")
        csv_text = download_sheet_csv(service, sheet_id)
        reader = list(csv.DictReader(io.StringIO(csv_text)))
        print(f"Read {len(reader)} rows from {author}'s sheet.")

        # Get ALL audio files recursively under author's folder tree
        all_tree_files = list_all_files_recursive(service, info["folder_id"])
        audio_map = {}
        for af in all_tree_files:
            if af["mimeType"] != "application/vnd.google-apps.folder":
                stem = Path(af["name"]).stem.strip()
                audio_map[stem] = af

        print(f"Mapped {len(audio_map)} audio files in Drive tree for {author}.")

        for row in reader:
            raw_id = (
                row.get("ID_UNICO")
                or row.get("ID")
                or row.get("id_unico")
                or row.get("\ufeffID_UNICO")
                or ""
            ).strip()

            if not raw_id:
                continue

            composite_id = f"{author}_{raw_id}"

            texto_audio = (
                row.get("TEXTO_AUDIO") or row.get("texto_audio") or ""
            ).strip()
            texto_norm = normalise_text(texto_audio)

            acertividad = (
                row.get("ACERTIVIDAD") or row.get("acertividad") or "RELEVANTE"
            ).strip().upper()
            is_garbage = acertividad in ("OMITIR", "DESCARTO", "INAUDIBLE")

            dificultad = (
                row.get("DIFICULTAD") or row.get("dificultad") or "MEDIO"
            ).strip().upper()

            json_productos_raw = (
                row.get("JSON PRODUCTOS")
                or row.get("JSON_PRODUCTOS")
                or row.get("json_productos")
                or "[]"
            ).strip()

            try:
                json_productos = json.loads(json_productos_raw)
            except Exception:
                json_productos = []

            # Match audio file
            audio_file_info = audio_map.get(raw_id)
            audio_filename = ""

            if audio_file_info:
                ext = Path(audio_file_info["name"]).suffix or ".wav"
                dest_audio_name = f"{composite_id}{ext}"
                dest_audio_path = AUDIOS_DIR / dest_audio_name

                if not dest_audio_path.exists() or dest_audio_path.stat().st_size == 0:
                    print(f"  Downloading audio clip: {dest_audio_name} (Drive path: {audio_file_info['name']})...")
                    download_file(service, audio_file_info["id"], dest_audio_path)

                audio_filename = dest_audio_name
            else:
                print(f"  WARNING: No audio file found in Drive tree for {composite_id} (ID: {raw_id})")

            consolidated_rows.append({
                "composite_id": composite_id,
                "author": author,
                "original_id": raw_id,
                "condition": "noisy" if dificultad == "DIFICIL" else ("clean" if dificultad == "FACIL" else "spontaneous"),
                "dificultad": dificultad,
                "acertividad": acertividad,
                "is_garbage": is_garbage,
                "raw_transcript": texto_audio,
                "normalized_transcript": texto_norm,
                "json_productos": json.dumps(json_productos, ensure_ascii=False),
                "audio_filename": audio_filename,
            })

    # Write consolidated CSV
    fieldnames = [
        "composite_id",
        "author",
        "original_id",
        "condition",
        "dificultad",
        "acertividad",
        "is_garbage",
        "raw_transcript",
        "normalized_transcript",
        "json_productos",
        "audio_filename",
    ]

    with CONSOLIDATED_CSV.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(consolidated_rows)

    print(f"\nSUCCESS: Consolidated {len(consolidated_rows)} test cases into:")
    print(f"  - CSV: {CONSOLIDATED_CSV}")
    print(f"  - Audios: {AUDIOS_DIR}")


if __name__ == "__main__":
    main()
