import csv
import io
from pathlib import Path
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload

KEY_PATH = Path("key-gcp.json")
SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]

PARTICIPANTS = {
    "adriana": "16M6cI1oUQGRjY62sRCCoD1kdW1aF-80h",
    "daniel": "1nVPywA2U4m55fMFV1-QVeU4lyLwgssib"
}

def get_drive_service():
    creds = service_account.Credentials.from_service_account_file(
        str(KEY_PATH), scopes=SCOPES
    )
    return build("drive", "v3", credentials=creds)

def list_all_files_recursive(service, folder_id, current_path=""):
    results = []
    res = service.files().list(
        q=f"'{folder_id}' in parents and trashed = false",
        fields="files(id, name, mimeType)",
        pageSize=1000
    ).execute()
    
    files = res.get("files", [])
    for f in files:
        path = f"{current_path}/{f['name']}" if current_path else f['name']
        results.append({
            "id": f["id"],
            "name": f["name"],
            "mimeType": f["mimeType"],
            "path": path
        })
        if f["mimeType"] == "application/vnd.google-apps.folder":
            sub_results = list_all_files_recursive(service, f["id"], path)
            results.extend(sub_results)
    return results

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
    service = get_drive_service()
    
    for author, folder_id in PARTICIPANTS.items():
        print(f"\n=======================================================")
        print(f"       AUDITING DRIVE FILES FOR: {author.upper()}")
        print(f"=======================================================")
        
        all_files = list_all_files_recursive(service, folder_id)
        print(f"Total Drive items found in {author}'s folder tree: {len(all_files)}")
        
        sheet_file = None
        audio_files = []
        
        for f in all_files:
            if f["mimeType"] == "application/vnd.google-apps.spreadsheet" or "BD_AUDIOS" in f["name"]:
                sheet_file = f
            elif f["mimeType"] != "application/vnd.google-apps.folder":
                audio_files.append(f)
                
        print(f"  Spreadsheet found: {sheet_file['name'] if sheet_file else 'NONE'} (ID: {sheet_file['id'] if sheet_file else 'NONE'})")
        print(f"  Total audio/binary files found: {len(audio_files)}")
        
        # Build map of stems to files
        stem_map = {}
        for af in audio_files:
            stem = Path(af["name"]).stem.strip()
            stem_map[stem] = af
            
        if sheet_file:
            csv_text = download_sheet_csv(service, sheet_file["id"])
            rows = list(csv.DictReader(io.StringIO(csv_text)))
            print(f"  Spreadsheet rows: {len(rows)}")
            
            missing_audios = []
            found_audios = []
            
            for r in rows:
                raw_id = (
                    r.get("ID_UNICO")
                    or r.get("ID")
                    or r.get("id_unico")
                    or r.get("\ufeffID_UNICO")
                    or ""
                ).strip()
                if not raw_id:
                    continue
                
                if raw_id in stem_map:
                    found_audios.append((raw_id, stem_map[raw_id]["path"]))
                else:
                    missing_audios.append(raw_id)
                    
            print(f"  -> Audios matched to Sheet rows: {len(found_audios)}")
            print(f"  -> Audios MISSING for Sheet rows: {len(missing_audios)}")
            if missing_audios:
                print(f"     Missing IDs: {missing_audios[:30]}{'...' if len(missing_audios) > 30 else ''}")

if __name__ == "__main__":
    main()
