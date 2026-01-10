import dotenv
import os

dotenv.load_dotenv(override=True)

ADMIN_UUID = os.getenv('ADMIN_UUID', 'fda4d49a-54dc-46a7-b7b7-fb40ac179a53')
ADMIN_USERNAME = os.getenv('ADMIN_USERNAME', 'admin_example')
PROTOCOL = os.getenv('PROTOCOL', 'https').lower()
HOST = os.getenv('HOST', '0.0.0.0')
PORT = os.getenv('PORT', '8080')
MAX_CHAT_MESSAGES = int(os.getenv('MAX_CHAT_MESSAGES', '50'))
