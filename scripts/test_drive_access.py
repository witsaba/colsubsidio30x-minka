import json
from pathlib import Path
from google.oauth2 import service_account
from googleapiclient.discovery import build

KEY_PATH = Path("key-gcp.json")
FOLDER_ID = "1e9a69v6Fz5m8o6XWsStagUtJKu-Hnuau"
SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]

def main():
    if not KEY_PATH.exists():
        print(f"Key file {KEY_PATH} not found!")
        return

    creds = service_account.Credentials.from_service_account_file(
        str(KEY_PATH), scopes=SCOPES
    )
    service = build("drive", "v3", credentials=creds)

    print(f"Querying Google Drive folder: {FOLDER_ID}")
    results = (
        service.files()
        .list(
            q=f"'{FOLDER_ID}' in parents and trashed = false",
            fields="files(id, name, mimeType)",
        )
        .execute()
    )
    files = results.get("files", [])

    print(f"Found {len(files)} items in main folder:")
    for item in files:
        print(f"  - [{item['mimeType']}] {item['name']} (ID: {item['id']})")

if __name__ == "__main__":
    main()
