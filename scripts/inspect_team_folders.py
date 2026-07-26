from google.oauth2 import service_account
from googleapiclient.discovery import build

def main():
    creds = service_account.Credentials.from_service_account_file(
        'key-gcp.json', scopes=['https://www.googleapis.com/auth/drive.readonly']
    )
    service = build('drive', 'v3', credentials=creds)

    folders = {
        'Adriana': '16M6cI1oUQGRjY62sRCCoD1kdW1aF-80h',
        'Daniel': '1nVPywA2U4m55fMFV1-QVeU4lyLwgssib'
    }

    for author, folder_id in folders.items():
        print(f"=== Folder {author} ({folder_id}) ===")
        res = service.files().list(
            q=f"'{folder_id}' in parents and trashed = false",
            fields="files(id, name, mimeType)"
        ).execute()
        
        items = res.get('files', [])
        for item in items:
            print(f"  - [{item['mimeType']}] {item['name']} (ID: {item['id']})")
            if item['mimeType'] == 'application/vnd.google-apps.folder':
                sub_res = service.files().list(
                    q=f"'{item['id']}' in parents and trashed = false",
                    fields="files(id, name, mimeType)"
                ).execute()
                for sub in sub_res.get('files', []):
                    print(f"      -> [{sub['mimeType']}] {sub['name']} (ID: {sub['id']})")

if __name__ == '__main__':
    main()
